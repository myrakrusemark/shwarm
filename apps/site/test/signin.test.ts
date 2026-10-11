import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pruneThrottle } from '../src/auth/cleanup'
import { hashPassword } from '../src/auth/password'
import { safeNext } from '../src/auth/request'
import { readSession, sessionId } from '../src/auth/session'
import { signIn as signInNow } from '../src/auth/signin'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, GOOD_PASSWORD, linkIn, mails, pepper, sameShape, testEnv, type TestEnv } from './browser'

const MIN = 60_000
let fetcher: ReturnType<typeof fakeFetch>
beforeEach(() => {
  fetcher = fakeFetch(['password1234'])
  vi.stubGlobal('fetch', fetcher)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** A verified account with GOOD_PASSWORD, at handle@example.org. */
async function member(env: TestEnv, handle: string, opts: { verified?: boolean; iterations?: number } = {}) {
  const id = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, opts.iterations) })
  if (opts.verified !== false) env.DB.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(new Date(T0).toISOString(), id)
  return id
}

const signIn = (b: Browser, email: string, password = GOOD_PASSWORD, extra: Record<string, string> = {}) => b.post('/signin', { email, password, ...extra })
const sessions = (env: TestEnv) => env.DB.raw.prepare('SELECT COUNT(*) AS n FROM session').get().n as number

describe('sign in', () => {
  it('signs in, rotating any old session, and opens the step-up window', async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    const b = new Browser(env)
    let res = await signIn(b, 'Myra@Example.org', GOOD_PASSWORD, { next: '/w/minecraft-in-doom' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/w/minecraft-in-doom')
    const first = b.jar.get('__Host-shwarm')!
    const s = await readSession(env.DB, first)
    expect(s?.personId).toBe(id)
    expect(Date.parse(s!.stepUpUntil!)).toBe(T0 + 10 * MIN)
    // signing in again replaces the session instead of adding one
    res = await signIn(b, 'myra@example.org')
    expect(b.jar.get('__Host-shwarm')).not.toBe(first)
    expect(await readSession(env.DB, first)).toBeNull()
    expect(sessions(env)).toBe(1)
    expect(await body(await b.get('/signin'))).toContain("you're signed in as @myra")
  })

  it('sends an unverified account to the check-your-email page, still signed in', async () => {
    const env = testEnv()
    await member(env, 'newbie', { verified: false })
    const b = new Browser(env)
    const res = await signIn(b, 'newbie@example.org')
    expect(res.headers.get('location')).toBe('/check-email')
    const page = await body(await b.get('/check-email'))
    expect(page).toContain("your email isn't verified yet")
    await b.post('/check-email')
    expect(mails(env.DB).filter(m => m.template === 'verify')).toHaveLength(1)
  })

  it('rehashes a password stored with old settings', async () => {
    const env = testEnv()
    await member(env, 'myra', { iterations: 1000 })
    await signIn(new Browser(env), 'myra@example.org')
    expect(env.DB.raw.prepare('SELECT password_hash FROM person').get().password_hash).toMatch(/^pbkdf2-sha256\$i=100000\$/)
  })

  it('answers an unknown email exactly like a wrong password', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const wrong = await signIn(new Browser(env, '192.0.2.1'), 'myra@example.org', 'not the password')
    const unknown = await signIn(new Browser(env, '192.0.2.2'), 'nobody@example.org', 'not the password')
    expect(wrong.status).toBe(400)
    expect(unknown.status).toBe(wrong.status)
    const [a, b] = [await body(wrong), await body(unknown)]
    expect(a).toContain("that email and password don't match.")
    expect(sameShape(b).replace('nobody@example.org', 'X')).toBe(sameShape(a).replace('myra@example.org', 'X'))
    const cookieShape = (r: Response) => (r.headers.get('set-cookie') ?? '').replace(/=[A-Za-z0-9_-]{43};/g, '=…;')
    expect(cookieShape(unknown)).toBe(cookieShape(wrong))
  })

  it('slows the 20th wrong password from one network, and lifts it later', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const b = new Browser(env, '203.0.113.5')
    for (let i = 1; i <= 19; i++) {
      // spread over 5 addresses so the per-address limit (10) isn't what trips
      const res = await signIn(b, `person${i % 5}@example.org`, 'guess ' + i)
      expect(res.status, `try ${i}`).toBe(400)
    }
    const res = await signIn(b, 'person0@example.org', 'guess 20')
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBe(15 * 60)
    expect(await body(res)).toContain('too many tries')
    // the right password from a neighbour on the same /24 waits too
    expect((await signIn(new Browser(env, '203.0.113.77'), 'myra@example.org')).status).toBe(429)
    // another network is unaffected
    expect((await signIn(new Browser(env, '192.0.2.1'), 'myra@example.org')).status).toBe(303)
    // not for good
    vi.setSystemTime(T0 + 16 * MIN)
    expect((await signIn(new Browser(env, '203.0.113.5'), 'myra@example.org')).status).toBe(303)
  })

  it('backs off per address too, across networks, the same for unknown addresses', async () => {
    const env = testEnv()
    await member(env, 'myra')
    for (const email of ['myra@example.org', 'nobody@example.org']) {
      for (let i = 1; i <= 9; i++) expect((await signIn(new Browser(env, `198.51.${i}.1`), email, 'wrong')).status).toBe(400)
      const res = await signIn(new Browser(env, '198.51.10.1'), email, 'wrong')
      expect(res.status).toBe(429)
    }
    vi.setSystemTime(T0 + 16 * MIN)
    expect((await signIn(new Browser(env, '198.51.11.1'), 'myra@example.org')).status).toBe(303)
  })

  it("can't keep the owner out: a familiar network still gets in during an address block", async () => {
    const env = testEnv()
    await member(env, 'myra')
    // myra has signed in from home before
    const home = new Browser(env, '203.0.113.9')
    await signIn(home, 'myra@example.org')
    await home.post('/signout')
    // someone sends 10 wrong passwords for her address from 10 networks
    for (let i = 1; i <= 10; i++) await signIn(new Browser(env, `198.51.${i}.1`), 'myra@example.org', 'wrong')
    // a new network waits, even with the right password; home gets in
    expect((await signIn(new Browser(env, '192.0.2.1'), 'myra@example.org')).status).toBe(429)
    const res = await signIn(new Browser(env, '203.0.113.20'), 'myra@example.org')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
  })

  it('forgets a familiar network after 30 days, and prunes old throttle rows', async () => {
    const env = testEnv()
    await member(env, 'myra')
    await signIn(new Browser(env, '203.0.113.9'), 'myra@example.org')
    vi.setSystemTime(T0 + 31 * 86_400_000)
    for (let i = 1; i <= 10; i++) await signIn(new Browser(env, `198.51.${i}.1`), 'myra@example.org', 'wrong')
    expect((await signIn(new Browser(env, '203.0.113.9'), 'myra@example.org')).status).toBe(429)
    const rows = () => env.DB.raw.prepare('SELECT scope FROM auth_throttle').all().map((r: { scope: string }) => r.scope) as string[]
    expect(rows().some(r => r.includes(':known:'))).toBe(true)
    expect(await pruneThrottle(env.DB, T0 + 31 * 86_400_000 + 20 * MIN)).toBe(1) // only the old stamp; this hour's misses stay
    expect(rows().some(r => r.includes(':known:'))).toBe(false)
    const left = rows().length
    expect(left).toBeGreaterThan(0)
    expect(await pruneThrottle(env.DB, T0 + 33 * 86_400_000)).toBe(left)
    expect(rows()).toEqual([])
  })

  it('a familiar network with a miss for that address waits like any other, and a block looks the same for unknown addresses', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const home = new Browser(env, '203.0.113.9')
    await signIn(home, 'myra@example.org')
    for (const email of ['myra@example.org', 'nobody@example.org']) {
      for (let i = 1; i <= 10; i++) await signIn(new Browser(env, `198.51.${i}.1`), email, 'wrong')
    }
    // from home: one wrong try during the block, then even the right one waits
    const wrong = await signIn(new Browser(env, '203.0.113.30'), 'myra@example.org', 'wrong again')
    const unknown = await signIn(new Browser(env, '203.0.113.31'), 'nobody@example.org', 'wrong again')
    expect(wrong.status).toBe(429)
    expect(unknown.status).toBe(429)
    expect(unknown.headers.get('retry-after')).toBe(wrong.headers.get('retry-after'))
    expect((await signIn(new Browser(env, '203.0.113.32'), 'myra@example.org')).status).toBe(429)
    vi.setSystemTime(T0 + 16 * MIN)
    expect((await signIn(new Browser(env, '203.0.113.33'), 'myra@example.org')).status).toBe(303)
  })

  it("takes back the count of a right password, so sign-ins never use up the network's tries", async () => {
    const env = testEnv()
    await member(env, 'myra')
    const signInRight = () => signInNow(env.DB, pepper, 'myra@example.org', GOOD_PASSWORD, { ip: '203.0.113.9', ua: null })
    expect((await Promise.all(Array.from({ length: 10 }, signInRight))).every(r => r.kind === 'ok')).toBe(true)
    for (let i = 0; i < 15; i++) expect((await signInRight()).kind).toBe('ok')
    // 25 sign-ins later, 19 wrong tries from that network still answer "doesn't match"
    for (let i = 1; i <= 19; i++) expect((await signInNow(env.DB, pepper, `p${i % 5}@example.org`, 'wrong', { ip: '203.0.113.9', ua: null })).kind).toBe('bad')
  })

  it('refuses a suspended account with the same answer as a wrong password', async () => {
    const env = testEnv()
    const id = await member(env, 'spam_bot')
    env.DB.raw.prepare("UPDATE person SET status = 'suspended' WHERE id = ?").run(id)
    const res = await signIn(new Browser(env), 'spam_bot@example.org')
    expect(res.status).toBe(400)
    expect(await body(res)).toContain("that email and password don't match.")
  })

  it('signs out by POST only', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const b = new Browser(env)
    await signIn(b, 'myra@example.org')
    expect((await b.get('/signout')).status).toBe(404)
    expect(sessions(env)).toBe(1)
    const res = await b.post('/signout')
    expect(res.status).toBe(303)
    expect(b.jar.has('__Host-shwarm')).toBe(false)
    expect(sessions(env)).toBe(0)
  })
})

describe('forms are only accepted from this site, with this browser’s token', () => {
  it('refuses a cross-origin form post', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const b = new Browser(env)
    const form_token = await b.token()
    for (const path of ['/join', '/signin', '/forgot', '/reset', '/verify', '/step-up', '/signout']) {
      const res = await b.req(path, { form: { form_token, email: 'myra@example.org', password: GOOD_PASSWORD }, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } })
      expect(res.status, path).toBe(403)
    }
    expect(sessions(env)).toBe(0)
  })

  it('refuses a missing, wrong or borrowed form token', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const b = new Browser(env)
    await b.token()
    let res = await b.req('/signin', { form: { email: 'myra@example.org', password: GOOD_PASSWORD, 'cf-turnstile-response': 'x' } })
    expect(res.status).toBe(403)
    expect(await body(res)).toContain('this form expired')
    res = await b.req('/signin', { form: { form_token: 'x'.repeat(43), email: 'myra@example.org', password: GOOD_PASSWORD } })
    expect(res.status).toBe(403)
    const other = await new Browser(env, '192.0.2.8').token() // another browser's token
    res = await b.req('/signin', { form: { form_token: other, email: 'myra@example.org', password: GOOD_PASSWORD } })
    expect(res.status).toBe(403)
    // and with no pre-session cookie at all
    res = await new Browser(env).req('/join', { form: { form_token: other } })
    expect(res.status).toBe(403)
    expect(sessions(env)).toBe(0)
  })

  it('needs a passing Turnstile answer on sign-in', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const res = await signIn(new Browser(env), 'myra@example.org', GOOD_PASSWORD, { 'cf-turnstile-response': 'fail' })
    expect(res.status).toBe(400)
    expect(sessions(env)).toBe(0)
  })
})

describe('forgot and reset', () => {
  it('always says check your email, and mails only a real account', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const b = new Browser(env)
    const known = await b.post('/forgot', { email: 'Myra@example.org' })
    const unknown = await b.post('/forgot', { email: 'nobody@example.org' })
    expect(known.status).toBe(303)
    expect(unknown.headers.get('location')).toBe(known.headers.get('location'))
    expect(known.headers.get('location')).toBe('/check-email?r=reset')
    expect(await body(await b.get('/check-email?r=reset'))).toContain('if that address has an account')
    expect(mails(env.DB).map(m => [m.template, m.to_email])).toEqual([['reset', 'myra@example.org']])
  })

  it('does the reset work after the response, so its time shows nothing', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const b = new Browser(env).withContext()
    const res = await b.post('/forgot', { email: 'myra@example.org' })
    expect(res.headers.get('location')).toBe('/check-email?r=reset')
    expect(b.ctx!.pending).toHaveLength(1)
    await Promise.all(b.ctx!.pending)
    expect(mails(env.DB).map(m => m.template)).toEqual(['reset'])
    await b.post('/forgot', { email: 'nobody@example.org' })
    expect(b.ctx!.pending).toHaveLength(2)
  })

  it('a reset link survives a scanner, sets the password once, ends every session and sends a security mail', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const laptop = new Browser(env, '192.0.2.1')
    const phone = new Browser(env, '192.0.2.2')
    await signIn(laptop, 'myra@example.org')
    await signIn(phone, 'myra@example.org')
    expect(sessions(env)).toBe(2)
    await new Browser(env, '192.0.2.3').post('/forgot', { email: 'myra@example.org' })
    const link = linkIn(env.DB, 'reset')
    const t = new URL('https://x' + link).searchParams.get('t')!

    // a mail scanner fetches the link: nothing happens
    expect((await new Browser(env, '10.0.0.1').get(link)).status).toBe(200)
    expect((await new Browser(env, '10.0.0.2').get(link)).status).toBe(200)

    // a fresh device, signed out
    const other = new Browser(env, '192.0.2.9')
    const page = await body(await other.get(link))
    expect(page).toContain('set new password')
    let res = await other.post('/reset', { t, password: 'a brand new passphrase', password2: 'something else here' })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain("the two passwords don't match")
    res = await other.post('/reset', { t, password: 'password1234', password2: 'password1234' })
    expect(await body(res)).toContain('data breach')
    res = await other.post('/reset', { t, password: 'a brand new passphrase', password2: 'a brand new passphrase' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/signin?done=reset')
    expect(sessions(env)).toBe(0)
    expect(await readSession(env.DB, laptop.jar.get('__Host-shwarm'))).toBeNull()
    expect(mails(env.DB).at(-1)).toMatchObject({ template: 'password_changed', stream: 'security', to_email: 'myra@example.org' })

    // single use
    expect((await other.get(link)).status).toBe(410)
    res = await other.post('/reset', { t, password: 'yet another passphrase', password2: 'yet another passphrase' })
    expect(res.status).toBe(410)
    expect(await body(res)).toContain("this link doesn't work anymore")

    expect((await signIn(new Browser(env, '192.0.2.20'), 'myra@example.org')).status).toBe(400)
    expect((await signIn(new Browser(env, '192.0.2.21'), 'myra@example.org', 'a brand new passphrase')).status).toBe(303)
  })

  it('shows the expired-link page after 1 hour (reset) and 7 days (verify)', async () => {
    const env = testEnv()
    await member(env, 'myra')
    await member(env, 'newbie', { verified: false })
    const b = new Browser(env)
    await b.post('/forgot', { email: 'myra@example.org' })
    await b.post('/check-email') // nothing: this browser has no pending account
    const { newToken } = await import('../src/auth/tokens')
    const { token, stmt } = await newToken(env.DB, 2, 'verify', T0)
    await stmt.run()
    const reset = linkIn(env.DB, 'reset')
    expect((await b.get(reset)).status).toBe(200)
    vi.setSystemTime(T0 + 61 * MIN)
    const res = await b.get(reset)
    expect(res.status).toBe(410)
    expect(await body(res)).toContain('ask for a new reset link')
    expect((await b.get(`/verify?t=${token}`)).status).toBe(200)
    vi.setSystemTime(T0 + 7 * 24 * 60 * MIN + 1)
    expect((await b.get(`/verify?t=${token}`)).status).toBe(410)
    expect((await b.get('/verify?t=made-up')).status).toBe(410)
    expect((await b.get('/reset')).status).toBe(410)
  })

  it('a verify link is used only by its button, once', async () => {
    const env = testEnv()
    await member(env, 'newbie', { verified: false })
    const { newToken } = await import('../src/auth/tokens')
    const { token, stmt } = await newToken(env.DB, 1, 'verify', T0)
    await stmt.run()
    const scanner = new Browser(env, '10.0.0.1')
    for (let i = 0; i < 3; i++) expect((await scanner.get(`/verify?t=${token}`)).status).toBe(200)
    expect(env.DB.raw.prepare('SELECT email_verified_at FROM person').get().email_verified_at).toBeNull()
    const me = new Browser(env)
    const res = await me.post('/verify', { t: token })
    expect(res.status).toBe(303)
    expect(env.DB.raw.prepare('SELECT email_verified_at FROM person').get().email_verified_at).toBeTruthy()
    expect((await me.post('/verify', { t: token })).status).toBe(410)
  })
})

describe('next= stays on this site', () => {
  it('accepts only same-site paths', () => {
    expect(safeNext('/w/minecraft-in-doom?tab=new#p_1')).toBe('/w/minecraft-in-doom?tab=new#p_1')
    for (const bad of ['//evil.example', '/\\evil.example', '\\\\evil.example', 'https://evil.example/', 'evil.example', '/\t/evil.example', 'javascript:alert(1)', '', '/' + 'a'.repeat(600), '/.//evil.example/x', '/..//evil.example', '/%2e//evil.example', '/%2E%2E//evil.example', '/a/..//evil.example']) {
      expect(safeNext(bad), bad).toBeNull()
    }
    expect(safeNext(undefined)).toBeNull()
  })

  it('ignores an outside next on the sign-in page and after signing in', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const b = new Browser(env)
    expect(await body(await b.get('/signin?next=//evil.example'))).not.toContain('evil.example')
    expect(await body(await b.get('/signin?next=%2F.%2F%2Fevil.example%2Fphish'))).not.toContain('evil.example')
    for (const next of ['https://evil.example/', '//evil.example', '/\\evil.example', '/.//evil.example/phish', '/..//evil.example', '/%2e//evil.example']) {
      const res = await signIn(b, 'myra@example.org', GOOD_PASSWORD, { next })
      expect(res.headers.get('location'), next).toBe('/')
    }
  })

  it('ignores an outside next after a step-up', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const b = new Browser(env)
    await signIn(b, 'myra@example.org')
    expect(await body(await b.get('/step-up?next=https://evil.example'))).not.toContain('evil.example')
    for (const next of ['//evil.example/keys', '/.//evil.example/keys', '/%2e//evil.example']) {
      const res = await b.post('/step-up', { password: GOOD_PASSWORD, next })
      expect(res.headers.get('location'), next).toBe('/')
    }
  })
})

it('keeps only hashes of session tokens', async () => {
  const env = testEnv()
  await member(env, 'myra')
  const b = new Browser(env)
  await signIn(b, 'myra@example.org')
  expect(env.DB.raw.prepare('SELECT id FROM session').get().id).toBe(await sessionId(b.jar.get('__Host-shwarm')!))
})
