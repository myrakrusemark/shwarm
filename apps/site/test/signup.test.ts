import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteUnverified } from '../src/auth/cleanup'
import { isDisposable, parseEmail } from '../src/auth/email'
import { bump, LIMITS } from '../src/auth/throttle'
import { T0, testDb } from './d1'
import { w as words } from '../src/words'
import { allow, body, Browser, fakeFetch, GOOD_PASSWORD, joinForm, linkIn, mails, sameShape, setSignup, testEnv } from './browser'

const JOIN_INVITE_ONLY = words.auth.joinInviteOnly
const WAITING_HTML = words.auth.waiting

let fetcher: ReturnType<typeof fakeFetch>
beforeEach(() => {
  fetcher = fakeFetch(['password1234', 'correct horse battery staple'])
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const person = (env: ReturnType<typeof testEnv>, handle: string) => env.DB.raw.prepare('SELECT * FROM person WHERE handle = ?').get(handle)

describe('email addresses', () => {
  it('normalizes plus tags everywhere and dots at gmail', () => {
    expect(parseEmail('  Ex.Ample+shwarm@GoogleMail.com ')).toEqual({ email: 'ex.ample+shwarm@googlemail.com', norm: 'example@gmail.com', domain: 'googlemail.com' })
    expect(parseEmail('first.last+x@example.org')?.norm).toBe('first.last@example.org')
    expect(parseEmail('not an email')).toBeNull()
    expect(parseEmail('+tag@example.org')).toBeNull()
    expect(parseEmail('a@b')).toBeNull()
  })

  it('blocks disposable domains and their subdomains, from the bundled list', async () => {
    const db = testDb()
    expect(await isDisposable(db, 'mailinator.com')).toBe(true)
    expect(await isDisposable(db, 'eu.mailinator.com')).toBe(true)
    expect(await isDisposable(db, 'gmail.com')).toBe(false)
    expect(await isDisposable(db, 'example.org')).toBe(false)
  })
})

describe('sign-up', () => {
  it('makes an unverified account and mails a verify link in the same batch', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const b = new Browser(env)
    const res = await b.post('/join', joinForm('myra', 'Ex.Ample+shwarm@gmail.com', { display_name: 'myra k' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/check-email')
    const p = person(env, 'myra')
    expect(p).toMatchObject({ display_name: 'myra k', email: 'ex.ample+shwarm@gmail.com', email_norm: 'example@gmail.com', email_verified_at: null, founding: 0, terms_version: '0.1' })
    expect(p.terms_accepted_at).toBeTruthy()
    // the per-version record (go-live 10.2)
    expect(env.DB.raw.prepare('SELECT person_id, version, accepted_at, how FROM terms_acceptance').all().map((r: any) => ({ ...r }))).toEqual([
      { person_id: p.id, version: '0.1', accepted_at: p.terms_accepted_at, how: 'signup' },
    ])
    expect(p.age_confirmed_at).toBeTruthy()
    expect(p.password_hash).toMatch(/^pbkdf2-sha256\$i=100000\$/)
    const [m] = mails(env.DB)
    expect(m).toMatchObject({ to_email: 'ex.ample+shwarm@gmail.com', template: 'verify', stream: 'account', person_id: p.id })
    const link = linkIn(env.DB, 'verify')
    expect(link).toMatch(/^\/verify\?t=[A-Za-z0-9_-]{43}$/)
    const tok = env.DB.raw.prepare('SELECT * FROM email_token').get()
    expect(link).not.toContain(tok.id) // only the hash is stored
    expect(Date.parse(tok.expires_at) - Date.parse(tok.created_at)).toBe(7 * 86_400_000)
    // the check-email page
    const page = await (await b.get('/check-email')).text()
    expect(page).toContain('check your email')
    expect(page).toContain('send it again')
  })

  it('lowercases the handle and refuses reserved or malformed ones', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const b = new Browser(env)
    let res = await b.post('/join', joinForm('Support', 'a@example.org'))
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('that handle is reserved')
    res = await b.post('/join', joinForm('no spaces', 'a@example.org'))
    expect(await body(res)).toContain('use 2 to 32 lowercase letters')
    res = await b.post('/join', joinForm('Bea_2', 'bea@example.org'))
    expect(res.status).toBe(303)
    expect(person(env, 'bea_2')).toBeTruthy()
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM person').get().n).toBe(1)
  })

  it('refuses a disposable domain', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const res = await new Browser(env).post('/join', joinForm('spammy', 'x@mailinator.com'))
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('throwaway mail services')
    expect(person(env, 'spammy')).toBeUndefined()
    expect(mails(env.DB)).toHaveLength(0)
  })

  it('refuses a breached password, asking with only a hash prefix', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const res = await new Browser(env).post('/join', joinForm('myra', 'myra@example.org', { password: 'password1234' }))
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('turned up in a data breach')
    expect(fetcher.calls.some(u => /^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/.test(u))).toBe(true)
    expect(person(env, 'myra')).toBeUndefined()
  })

  it('checks lengths, the age box and the terms box', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const res = await new Browser(env).post('/join', joinForm('myra', 'myra@example.org', { password: 'short', age: '', terms: '' }))
    const html = await body(res)
    expect(html).toContain('use at least 10 characters')
    expect(html).toContain('16 or older to join')
    expect(html).toContain('agree to the terms')
    expect(html).toContain('value="myra@example.org"') // typed values come back, the password doesn't
    expect(html).not.toContain('value="short"')
  })

  it('refuses a failed Turnstile check', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const res = await new Browser(env).post('/join', joinForm('myra', 'myra@example.org', { 'cf-turnstile-response': 'fail' }))
    expect(res.status).toBe(400)
    expect(await body(res)).toContain("the bot check didn't go through")
    expect(person(env, 'myra')).toBeUndefined()
  })

  it('throttles sign-ups from one network: the 6th in an hour waits', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    for (let i = 1; i <= 5; i++) {
      const res = await new Browser(env, `198.51.100.${i}`).post('/join', joinForm(`user${i}`, `user${i}@example${i}.org`))
      expect(res.status).toBe(303)
    }
    const res = await new Browser(env, '198.51.100.77').post('/join', joinForm('user6', 'user6@example6.org'))
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await body(res)).toContain('too many tries')
    expect(person(env, 'user6')).toBeUndefined()
    // another network is fine
    expect((await new Browser(env, '192.0.2.1').post('/join', joinForm('user7', 'user7@example7.org'))).status).toBe(303)
  })

  it("doesn't count a try the network limit refused against the email domain, so one network can't block a provider", async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    for (let i = 1; i <= 40; i++) await new Browser(env, '198.51.100.9').post('/join', joinForm(`burst${i}`, `burst${i}@example.org`))
    const row = await env.DB.prepare("SELECT count FROM auth_throttle WHERE scope = 'signup:domain:example.org'").first<{ count: number }>()
    expect(row?.count).toBe(5)
    expect((await new Browser(env, '192.0.2.1').post('/join', joinForm('other', 'other@example.org'))).status).toBe(303)
  })

  it('throttles per email domain too (unit)', async () => {
    const db = testDb()
    for (let i = 1; i < LIMITS.signupDomain.tripAt; i++) expect(await bump(db, 'signup:domain:example.org', LIMITS.signupDomain, T0)).toBe(0)
    expect(await bump(db, 'signup:domain:example.org', LIMITS.signupDomain, T0)).toBeGreaterThan(0)
    expect(await bump(db, 'signup:domain:example.org', LIMITS.signupDomain, T0 + 61 * 60_000)).toBe(0) // not for good
  })

  it('lets an address off the allow-list join (decided Oct 10): an account, a verify mail, the waiting words and a signup_wait row', async () => {
    const env = testEnv() // signup setting starts as allow_list
    await allow(env.DB, 'member@example.org')
    expect(await body(await new Browser(env).get('/join'))).toContain(JOIN_INVITE_ONLY)
    const stranger = new Browser(env, '192.0.2.2')
    const res = await stranger.post('/join', joinForm('stranger', 'stranger@example.org'))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/check-email?w=1')
    const p = person(env, 'stranger')
    expect(p).toMatchObject({ email: 'stranger@example.org', email_verified_at: null, founding: 0 })
    expect(mails(env.DB).map(x => [x.template, x.to_email])).toEqual([['verify', 'stranger@example.org']])
    expect(env.DB.raw.prepare('SELECT person_id, joined_at, mailed_at FROM signup_wait').all()).toEqual([{ person_id: p.id, joined_at: expect.any(String), mailed_at: null }])
    const page = await body(await stranger.get('/check-email?w=1'))
    expect(page).toContain(WAITING_HTML)
    expect(page).toContain('we sent the next step to your email address. it will expire after 7 days.')
    expect(page).toContain('name="w" value="1"') // "send it again" keeps the words
    expect((await stranger.post('/check-email', { w: '1' })).headers.get('location')).toBe('/check-email?sent=1&w=1')
    // an invited address gets the page as before, and isn't waiting
    const member = new Browser(env, '192.0.2.1')
    const r2 = await member.post('/join', joinForm('member', 'member@example.org'))
    expect(r2.headers.get('location')).toBe('/check-email')
    const normal = await body(await member.get('/check-email'))
    expect(normal).toContain('we sent the next step to your email address. it will expire after 7 days.')
    expect(normal).toContain('be sure to check your spam folder!')
    expect(normal).not.toContain(WAITING_HTML)
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM signup_wait').get().n).toBe(1)
  })

  it('shows whether an address is invited, the trade-off Myra chose, but never whether it has an account', async () => {
    const env = testEnv()
    await allow(env.DB, 'member@example.org')
    await new Browser(env, '192.0.2.1').post('/join', joinForm('member', 'member@example.org'))
    await new Browser(env, '192.0.2.2').post('/join', joinForm('waiter', 'waiter@example.org'))
    const before = mails(env.DB).length
    // off the list: a new address, and someone typing the waiting account's address with a fresh handle (other networks:
    // one /24 may sign up 5 times an hour)
    const fresh = new Browser(env, '198.51.100.3')
    const probe = new Browser(env, '198.51.100.4')
    const a = await fresh.post('/join', joinForm('fresh', 'fresh@example.org'))
    const b = await probe.post('/join', joinForm('prober', 'waiter@example.org'))
    // on the list: a new invited address, and someone typing the member's address
    await allow(env.DB, 'invitee@example.org')
    const invitee = new Browser(env, '203.0.113.5')
    const probe2 = new Browser(env, '203.0.113.6')
    const c = await invitee.post('/join', joinForm('invitee', 'invitee@example.org'))
    const d = await probe2.post('/join', joinForm('prober2', 'member@example.org'))
    for (const [x, y, bx, by] of [[a, b, fresh, probe], [c, d, invitee, probe2]] as const) {
      expect(x.status).toBe(303)
      expect(y.headers.get('location')).toBe(x.headers.get('location'))
      expect([...by.jar.keys()].sort()).toEqual([...bx.jar.keys()].sort())
      const loc = x.headers.get('location')!
      expect(sameShape(await body(await by.get(loc)))).toBe(sameShape(await body(await bx.get(loc))))
    }
    expect(a.headers.get('location')).not.toBe(c.headers.get('location')) // the invited/not-invited difference
    expect(person(env, 'prober')).toBeUndefined()
    expect(person(env, 'prober2')).toBeUndefined()
    // only each address's owner hears about the probes
    expect(mails(env.DB).slice(before).map(x => [x.template, x.to_email])).toEqual([
      ['verify', 'fresh@example.org'], ['signup_existing', 'waiter@example.org'], ['verify', 'invitee@example.org'], ['signup_existing', 'member@example.org'],
    ])
  })

  it('a waiting account stays waiting when it verifies; signed in, its check-email page still says so', async () => {
    const env = testEnv()
    const b = new Browser(env)
    await b.post('/join', joinForm('bea', 'bea@example.org'))
    expect((await b.post('/signin', { email: 'bea@example.org', password: GOOD_PASSWORD })).headers.get('location')).toBe('/check-email')
    expect(await body(await b.get('/check-email'))).toContain(WAITING_HTML)
    const html = await (await b.get(linkIn(env.DB, 'verify'))).text()
    await b.req('/verify', { form: { form_token: /name="form_token" value="([^"]+)"/.exec(html)![1], t: /name="t" value="([^"]+)"/.exec(html)![1] } })
    expect(person(env, 'bea')).toMatchObject({ founding: 0 })
    expect(person(env, 'bea').email_verified_at).toBeTruthy()
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM signup_wait').get().n).toBe(1)
  })

  it('an address invited after joining becomes founding when it verifies, and stops waiting', async () => {
    const env = testEnv()
    const b = new Browser(env)
    await b.post('/join', joinForm('cy', 'cy@example.org'))
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM signup_wait').get().n).toBe(1)
    await allow(env.DB, 'cy@example.org')
    const html = await (await b.get(linkIn(env.DB, 'verify'))).text()
    await b.req('/verify', { form: { form_token: /name="form_token" value="([^"]+)"/.exec(html)![1], t: /name="t" value="([^"]+)"/.exec(html)![1] } })
    expect(person(env, 'cy')).toMatchObject({ founding: 1 })
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM signup_wait').get().n).toBe(0)
  })

  it('still refuses a disposable domain off the allow-list, and an unverified waiting account goes after 7 days with its row', async () => {
    const env = testEnv()
    const res = await new Browser(env).post('/join', joinForm('spammy', 'x@mailinator.com'))
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('throwaway mail services')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    await new Browser(env, '192.0.2.1').post('/join', joinForm('stale', 'stale@example.org'))
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM signup_wait').get().n).toBe(1)
    expect(await deleteUnverified(env.DB, T0 + 7 * 86_400_000 + 1000)).toBe(1)
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM signup_wait').get().n).toBe(0)
  })

  it("answers a taken handle the same whether or not the address has an account", async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    await new Browser(env, '192.0.2.1').post('/join', joinForm('someone', 'someone@example.org'))
    await new Browser(env, '192.0.2.2').post('/join', joinForm('victim', 'victim@example.org'))
    const before = mails(env.DB).length
    const a = await new Browser(env, '192.0.2.3').post('/join', joinForm('someone', 'victim@example.org'))
    const b = await new Browser(env, '192.0.2.4').post('/join', joinForm('someone', 'nobody@example.org'))
    for (const r of [a, b]) {
      expect(r.status).toBe(400)
      expect(await body(r)).toContain('that handle is taken')
    }
    expect(mails(env.DB)).toHaveLength(before) // no "you already have an account" mail either
  })

  it('holds a handle the same 7 days whether or not the address has an account (go-live 9.6)', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    await new Browser(env, '192.0.2.1').post('/join', joinForm('victim', 'victim@example.org'))
    const held = new Browser(env, '192.0.2.2') // types an address that has an account
    const pending = new Browser(env, '192.0.2.3') // types a new one
    await held.post('/join', joinForm('squat_a', 'victim@example.org'))
    await pending.post('/join', joinForm('squat_b', 'nobody@example.org'))
    expect(person(env, 'squat_a')).toBeUndefined()
    let net = 0
    const tryFrom = (h: string) => new Browser(env, `198.51.${++net}.9`).post('/join', joinForm(h, `third${net}@example.org`))
    const taken = async (h: string) => {
      const r = await tryFrom(h)
      return r.status === 400 && (await body(r)).includes('that handle is taken')
    }
    expect([await taken('squat_a'), await taken('squat_b')]).toEqual([true, true])
    // each browser can send the form again, and the clock that frees the handle doesn't restart
    const cookies = [held.jar.get('__Host-shwarm-pend'), pending.jar.get('__Host-shwarm-pend')]
    vi.setSystemTime(T0 + 6 * 86_400_000)
    expect((await held.post('/join', joinForm('squat_a', 'victim@example.org'))).status).toBe(303)
    expect((await pending.post('/join', joinForm('squat_b', 'nobody@example.org'))).status).toBe(303)
    expect([held.jar.get('__Host-shwarm-pend'), pending.jar.get('__Host-shwarm-pend')]).toEqual(cookies)
    vi.setSystemTime(T0 + 7 * 86_400_000 - 1000)
    expect([await taken('squat_a'), await taken('squat_b')]).toEqual([true, true])
    // both free at the same moment, without waiting for the hourly cleanup
    vi.setSystemTime(T0 + 7 * 86_400_000 + 1000)
    expect([(await tryFrom('squat_a')).status, (await tryFrom('squat_b')).status]).toEqual([303, 303])
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM handle_hold').get().n).toBe(0)
  })

  it("moves a browser's claim on a handle between a hold and a pending account, keeping its clock", async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    await new Browser(env, '192.0.2.1').post('/join', joinForm('victim', 'victim@example.org'))
    const b = new Browser(env, '192.0.2.2')
    await b.post('/join', joinForm('coolname', 'victim@example.org'))
    vi.setSystemTime(T0 + 86_400_000)
    expect((await b.post('/join', joinForm('coolname', 'mine@example.org'))).status).toBe(303)
    expect(person(env, 'coolname')).toMatchObject({ email: 'mine@example.org', created_at: new Date(T0).toISOString() })
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM handle_hold').get().n).toBe(0)
    vi.setSystemTime(T0 + 2 * 86_400_000)
    expect((await b.post('/join', joinForm('coolname', 'Victim+again@example.org'))).status).toBe(303)
    expect(person(env, 'coolname')).toBeUndefined()
    expect(env.DB.raw.prepare('SELECT handle, created_at FROM handle_hold').all()).toEqual([{ handle: 'coolname', created_at: new Date(T0).toISOString() }])
    expect(mails(env.DB).filter(m => m.to_email === 'mine@example.org')).toEqual([]) // the unsent verify mail went with the account
  })

  it('slows "send it again" at the same press whether or not the address has an account (go-live 9.6)', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    await new Browser(env, '192.0.2.1').post('/join', joinForm('victim', 'victim@example.org'))
    const held = new Browser(env, '192.0.2.2')
    const pending = new Browser(env, '192.0.2.3')
    await held.post('/join', joinForm('squat_a', 'victim@example.org'))
    await pending.post('/join', joinForm('squat_b', 'nobody@example.org'))
    for (const b of [held, pending]) for (let i = 0; i < 3; i++) expect((await b.post('/check-email')).status).toBe(303)
    const [x, y] = [await held.post('/check-email'), await pending.post('/check-email')]
    expect([x.status, y.status]).toEqual([429, 429])
    expect(x.headers.get('retry-after')).toBe(y.headers.get('retry-after'))
    // only the new address gets verify links
    expect(mails(env.DB).filter(m => m.template === 'verify').map(m => m.to_email)).toEqual([
      'victim@example.org', 'nobody@example.org', 'nobody@example.org', 'nobody@example.org', 'nobody@example.org',
    ])
  })

  it('does its writes after the response when there is an ExecutionContext', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const b = new Browser(env).withContext()
    // hold the batch until the response is out
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const batch = env.DB.batch.bind(env.DB)
    env.DB.batch = (async (stmts: D1PreparedStatement[]) => (await gate, batch(stmts))) as typeof env.DB.batch
    const res = await b.post('/join', joinForm('myra', 'myra@example.org'))
    expect(res.status).toBe(303)
    expect(b.ctx!.pending).toHaveLength(1)
    expect(person(env, 'myra')).toBeUndefined()
    release()
    await Promise.all(b.ctx!.pending)
    expect(person(env, 'myra')).toBeTruthy()
    expect(mails(env.DB).map(m => m.template)).toEqual(['verify'])
    // the cookie it set still finds the account
    await b.post('/check-email')
    expect(mails(env.DB).map(m => m.template)).toEqual(['verify', 'verify'])
  })

  it('makes an allow-listed address founding when it is verified, not before', async () => {
    const env = testEnv()
    await allow(env.DB, 'example@gmail.com')
    const b = new Browser(env)
    expect((await b.post('/join', joinForm('myra', 'Ex.Ample@gmail.com'))).status).toBe(303)
    expect(person(env, 'myra')).toMatchObject({ founding: 0, established_at: null, email_verified_at: null })
    // the link opens a page; only its button verifies
    const v = new Browser(env, '192.0.2.50') // another device, signed out
    const page = await v.get(linkIn(env.DB, 'verify'))
    expect(page.status).toBe(200)
    const html = await body(page)
    expect(html).toContain('verify my email')
    const t = /name="t" value="([^"]+)"/.exec(html)![1]
    expect(person(env, 'myra').email_verified_at).toBeNull()
    const res = await v.req('/verify', { form: { form_token: /name="form_token" value="([^"]+)"/.exec(html)![1], t } })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/verified')
    const p = person(env, 'myra')
    expect(p.email_verified_at).toBeTruthy()
    expect(p.founding).toBe(1)
    expect(p.established_at).toBeTruthy()
    expect(env.DB.raw.prepare('SELECT used_at FROM signup_allow').get().used_at).toBeTruthy()
    expect(mails(env.DB).map(m => m.template)).toEqual(['verify', 'welcome'])
    expect(await (await v.get('/verified')).text()).toContain('your email is verified')
  })

  it("an open sign-up that isn't on the allow-list verifies without becoming founding", async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const b = new Browser(env)
    await b.post('/join', joinForm('bea', 'bea@example.org'))
    const html = await (await b.get(linkIn(env.DB, 'verify'))).text()
    await b.req('/verify', { form: { form_token: /name="form_token" value="([^"]+)"/.exec(html)![1], t: /name="t" value="([^"]+)"/.exec(html)![1] } })
    expect(person(env, 'bea')).toMatchObject({ founding: 0, established_at: null })
    expect(person(env, 'bea').email_verified_at).toBeTruthy()
  })

  it('answers an address that already has an account with the same page, and mails that address instead', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const first = new Browser(env, '192.0.2.1')
    const r1 = await first.post('/join', joinForm('myra', 'myra@example.org'))
    const attacker = new Browser(env, '192.0.2.2')
    const r2 = await attacker.post('/join', joinForm('someone', 'Myra+x@Example.org'))
    expect(r2.status).toBe(r1.status)
    expect(r2.headers.get('location')).toBe(r1.headers.get('location'))
    expect([...attacker.jar.keys()].sort()).toEqual([...first.jar.keys()].sort()) // same cookies set
    expect(attacker.jar.get('__Host-shwarm-pend')).toMatch(/^someone\.[A-Za-z0-9_-]{43}$/)
    expect(sameShape(await (await attacker.get('/check-email')).text())).toBe(sameShape(await (await first.get('/check-email')).text()))
    expect(person(env, 'someone')).toBeUndefined()
    const m = mails(env.DB)
    expect(m.map(x => x.template)).toEqual(['verify', 'signup_existing'])
    expect(m[1].to_email).toBe('myra@example.org')
    expect(JSON.parse(m[1].payload)).toMatchObject({ handle: 'myra', signin: 'https://shwarm.org/signin', forgot: 'https://shwarm.org/forgot' })
  })

  it('replaces a pending account signed up again from the same browser with the same handle', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const b = new Browser(env)
    await b.post('/join', joinForm('myra', 'typo@exmaple.org'))
    const oldLink = linkIn(env.DB, 'verify')
    const old = person(env, 'myra')
    expect((await b.post('/join', joinForm('myra', 'myra@example.org'))).status).toBe(303)
    const now = person(env, 'myra')
    expect(now.email).toBe('myra@example.org')
    expect(now.id).not.toBe(old.id)
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM person').get().n).toBe(1)
    expect(mails(env.DB).map(m => m.to_email)).toEqual(['myra@example.org']) // the unsent mail to the typo went too
    expect((await b.get(oldLink)).status).toBe(410)
    // another browser can't take or replace it
    const other = new Browser(env, '192.0.2.9')
    const res = await other.post('/join', joinForm('myra', 'other@example.org'))
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('that handle is taken')
    expect(person(env, 'myra').email).toBe('myra@example.org')
  })

  it('keeps the 7-day clock when the same browser signs up again, so a handle is never held for good', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const b = new Browser(env)
    await b.post('/join', joinForm('coolname', 'not-mine@example.org'))
    const first = person(env, 'coolname').created_at
    vi.setSystemTime(T0 + 6 * 86_400_000)
    expect((await b.post('/join', joinForm('coolname', 'not-mine@example.org'))).status).toBe(303)
    expect(person(env, 'coolname').created_at).toBe(first)
    expect(await deleteUnverified(env.DB, T0 + 7 * 86_400_000 + 1000)).toBe(1)
    expect(person(env, 'coolname')).toBeUndefined()
  })

  it('throttles "send it again" and keeps only the newest verify link', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const b = new Browser(env)
    await b.post('/join', joinForm('myra', 'myra@example.org'))
    const first = linkIn(env.DB, 'verify')
    for (let i = 0; i < 3; i++) expect((await b.post('/check-email')).headers.get('location')).toBe('/check-email?sent=1')
    expect((await b.get(first)).status).toBe(410) // replaced by the newer links
    expect((await b.get(linkIn(env.DB, 'verify'))).status).toBe(200)
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM email_token WHERE used_at IS NULL').get().n).toBe(1)
    const res = await b.post('/check-email')
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(mails(env.DB).filter(m => m.template === 'verify')).toHaveLength(4)
    // and per network, even with no account behind the presses
    const other = new Browser(env, '198.51.100.1')
    for (let i = 0; i < 10; i++) expect((await other.post('/check-email')).status).toBe(303)
    expect((await other.post('/check-email')).status).toBe(429)
  })

  it('names the handle on the verify page, and verifying ends sessions made before', async () => {
    const env = testEnv()
    await allow(env.DB, 'invitee@example.org')
    // someone signs up with the invitee's address and signs in while it's unverified
    const attacker = new Browser(env, '192.0.2.66')
    await attacker.post('/join', joinForm('attacker', 'invitee@example.org'))
    expect((await attacker.post('/signin', { email: 'invitee@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    expect(attacker.jar.has('__Host-shwarm')).toBe(true)
    // the invitee opens the link from their mail
    const invitee = new Browser(env, '192.0.2.7')
    const html = await body(await invitee.get(linkIn(env.DB, 'verify')))
    expect(html).toContain('finishes joining as <strong>@attacker</strong>')
    expect(html).toContain("didn't sign up as @attacker? don't press the button")
    // if it's pressed anyway, the session made before is gone
    await invitee.req('/verify', { form: { form_token: /name="form_token" value="([^"]+)"/.exec(html)![1], t: /name="t" value="([^"]+)"/.exec(html)![1] } })
    expect(person(env, 'attacker').email_verified_at).toBeTruthy()
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM session').get().n).toBe(0)
    expect(await body(await attacker.get('/signin'))).not.toContain('signed in as')
  })

  it('keeps the session of the browser that verifies', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const b = new Browser(env)
    await b.post('/join', joinForm('myra', 'myra@example.org'))
    await b.post('/signin', { email: 'myra@example.org', password: GOOD_PASSWORD })
    const html = await (await b.get(linkIn(env.DB, 'verify'))).text()
    await b.req('/verify', { form: { form_token: /name="form_token" value="([^"]+)"/.exec(html)![1], t: /name="t" value="([^"]+)"/.exec(html)![1] } })
    expect(await body(await b.get('/signin'))).toContain("you're signed in as @myra")
  })

  it('sends the verify link again only for the browser that signed up', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const b = new Browser(env)
    await b.post('/join', joinForm('myra', 'myra@example.org'))
    let res = await b.post('/check-email')
    expect(res.headers.get('location')).toBe('/check-email?sent=1')
    expect(mails(env.DB).filter(m => m.template === 'verify')).toHaveLength(2)
    res = await new Browser(env, '192.0.2.9').post('/check-email')
    expect(res.headers.get('location')).toBe('/check-email?sent=1') // same answer
    expect(mails(env.DB).filter(m => m.template === 'verify')).toHaveLength(2) // no mail
  })

  it('deletes unverified accounts and their handles after 7 days', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    await new Browser(env, '192.0.2.1').post('/join', joinForm('stale', 'stale@example.org'))
    await new Browser(env, '192.0.2.2').post('/join', joinForm('kept', 'kept@example.org'))
    env.DB.raw.prepare("UPDATE person SET email_verified_at = ? WHERE handle = 'kept'").run(new Date(T0).toISOString())
    vi.setSystemTime(T0 + 3 * 86_400_000)
    await new Browser(env, '192.0.2.3').post('/join', joinForm('fresh', 'fresh@example.org'))
    expect(await deleteUnverified(env.DB, T0 + 7 * 86_400_000 + 1000)).toBe(1)
    expect(person(env, 'stale')).toBeUndefined()
    expect(person(env, 'kept')).toBeTruthy()
    expect(person(env, 'fresh')).toBeTruthy()
    expect(mails(env.DB).some(m => m.to_email === 'stale@example.org')).toBe(false)
    // the handle is free again
    vi.setSystemTime(T0 + 8 * 86_400_000)
    expect((await new Browser(env, '192.0.2.4').post('/join', joinForm('stale', 'new@example.org'))).status).toBe(303)
  })
})
