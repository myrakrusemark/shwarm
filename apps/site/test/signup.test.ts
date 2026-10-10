import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteUnverified } from '../src/auth/cleanup'
import { isDisposable, parseEmail } from '../src/auth/email'
import { bump, LIMITS } from '../src/auth/throttle'
import { T0, testDb } from './d1'
import { allow, body, Browser, fakeFetch, GOOD_PASSWORD, joinForm, linkIn, mails, sameShape, setSignup, testEnv } from './browser'

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

  it('throttles per email domain too (unit)', async () => {
    const db = testDb()
    for (let i = 1; i < LIMITS.signupDomain.tripAt; i++) expect(await bump(db, 'signup:domain:example.org', LIMITS.signupDomain, T0)).toBe(0)
    expect(await bump(db, 'signup:domain:example.org', LIMITS.signupDomain, T0)).toBeGreaterThan(0)
    expect(await bump(db, 'signup:domain:example.org', LIMITS.signupDomain, T0 + 61 * 60_000)).toBe(0) // not for good
  })

  it('turns away an address off the allow-list with the same answer an existing account gets', async () => {
    const env = testEnv() // signup setting starts as allow_list
    await allow(env.DB, 'member@example.org')
    const m = new Browser(env, '192.0.2.1')
    await m.post('/join', joinForm('member', 'member@example.org'))
    expect(await (await new Browser(env).get('/join')).text()).toContain('invite-only for now')
    // a stranger, and someone typing the member's address with a fresh handle
    const stranger = new Browser(env, '192.0.2.2')
    const probe = new Browser(env, '192.0.2.3')
    const r1 = await stranger.post('/join', joinForm('stranger', 'stranger@example.org'))
    const r2 = await probe.post('/join', joinForm('prober', 'member@example.org'))
    for (const r of [r1, r2]) {
      expect(r.status).toBe(303)
      expect(r.headers.get('location')).toBe('/check-email')
    }
    expect([...stranger.jar.keys()].sort()).toEqual([...probe.jar.keys()].sort())
    const page = await body(await stranger.get('/check-email'))
    expect(page).toContain("invite-only while it's new")
    expect(sameShape(page)).toBe(sameShape(await body(await probe.get('/check-email'))))
    expect(person(env, 'stranger')).toBeUndefined()
    expect(person(env, 'prober')).toBeUndefined()
    // only the member's own address hears about it
    expect(mails(env.DB).map(x => [x.template, x.to_email])).toEqual([['verify', 'member@example.org'], ['signup_existing', 'member@example.org']])
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
