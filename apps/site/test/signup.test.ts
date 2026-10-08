import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteUnverified } from '../src/auth/cleanup'
import { isDisposable, parseEmail } from '../src/auth/email'
import { bump, LIMITS } from '../src/auth/throttle'
import { T0, testDb } from './d1'
import { allow, body, Browser, fakeFetch, joinForm, linkIn, mails, sameShape, setSignup, testEnv } from './browser'

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
    expect(parseEmail('  My.Ra+shwarm@GoogleMail.com ')).toEqual({ email: 'my.ra+shwarm@googlemail.com', norm: 'myra@gmail.com', domain: 'googlemail.com' })
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
    const res = await b.post('/join', joinForm('myra', 'Myra.K+shwarm@gmail.com', { display_name: 'myra k' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/check-email')
    const p = person(env, 'myra')
    expect(p).toMatchObject({ display_name: 'myra k', email: 'myra.k+shwarm@gmail.com', email_norm: 'myrak@gmail.com', email_verified_at: null, founding: 0, terms_version: '0.1' })
    expect(p.terms_accepted_at).toBeTruthy()
    expect(p.age_confirmed_at).toBeTruthy()
    expect(p.password_hash).toMatch(/^pbkdf2-sha256\$i=100000\$/)
    const [m] = mails(env.DB)
    expect(m).toMatchObject({ to_email: 'myra.k+shwarm@gmail.com', template: 'verify', stream: 'account', person_id: p.id })
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

  it('shows the invite-only page to an address off the allow-list', async () => {
    const env = testEnv() // signup setting starts as allow_list
    const b = new Browser(env)
    expect(await (await b.get('/join')).text()).toContain('invite-only for now')
    const res = await b.post('/join', joinForm('stranger', 'stranger@example.org'))
    expect(res.status).toBe(403)
    expect(await body(res)).toContain('invite-only while it')
    expect(person(env, 'stranger')).toBeUndefined()
    expect(mails(env.DB)).toHaveLength(0)
  })

  it('makes an allow-listed address founding when it is verified, not before', async () => {
    const env = testEnv()
    await allow(env.DB, 'myra@gmail.com')
    const b = new Browser(env)
    expect((await b.post('/join', joinForm('myra', 'My.Ra@gmail.com'))).status).toBe(303)
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
