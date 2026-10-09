import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { requireStepUp, requireVerified } from '../src/auth/stepup'
import app from '../src/index'
import { EXAMPLE_BRANCH } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { stagingWorld } from './node-fixture'

const MIN = 60_000

// The site plus two gated acts, the way later phases will use requireStepUp.
const site = new Hono<{ Bindings: { DB: D1Database } }>()
site.route('/', app)
site.get('/keys', async c => (await requireStepUp(c)) ?? c.text('your keys'))
site.post('/keys/new', async c => (await requireStepUp(c)) ?? c.text('key made'))
site.post('/reply', async c => (await requireVerified(c)) ?? c.text('posted'))

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function signedIn(opts: { verified?: boolean } = {}) {
  const env = testEnv()
  const id = await addPerson(env.DB, 'myra', { hash: await hashPassword(GOOD_PASSWORD, pepper) })
  if (opts.verified !== false) env.DB.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(new Date(T0).toISOString(), id)
  const b = new Browser(env, '203.0.113.9', site)
  expect((await b.post('/signin', { email: 'myra@example.org', password: GOOD_PASSWORD })).status).toBe(303)
  return { env, b }
}

describe('step-up', () => {
  it('allows a gated act inside the 10-minute window and refuses it outside', async () => {
    const { b } = await signedIn()
    // sign-in just took the password, so the window is open
    expect(await (await b.get('/keys')).text()).toBe('your keys')
    vi.setSystemTime(T0 + 9 * MIN)
    expect(await (await b.post('/keys/new')).text()).toBe('key made')

    vi.setSystemTime(T0 + 11 * MIN)
    let res = await b.get('/keys')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/step-up?next=%2Fkeys')
    res = await b.req('/keys/new', { method: 'POST', headers: { referer: 'https://shwarm.org/keys?tab=agents' } })
    expect(res.headers.get('location')).toBe('/step-up?next=%2Fkeys%3Ftab%3Dagents')

    // the step-up page, then the password
    const page = await body(await b.get('/step-up?next=%2Fkeys'))
    expect(page).toContain("confirm it's you")
    expect(page).toContain('signed in as @myra')
    res = await b.post('/step-up', { password: 'not it at all', next: '/keys' })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain("that password doesn't match")
    expect((await b.get('/keys')).status).toBe(303)
    res = await b.post('/step-up', { password: GOOD_PASSWORD, next: '/keys' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/keys')
    expect(await (await b.get('/keys')).text()).toBe('your keys')

    vi.setSystemTime(T0 + 22 * MIN)
    expect((await b.get('/keys')).status).toBe(303)
  })

  it('sends a signed-out visitor to sign in, keeping a same-site next', async () => {
    const b = new Browser(testEnv(), '203.0.113.9', site)
    let res = await b.get('/keys')
    expect(res.headers.get('location')).toBe('/signin?next=%2Fkeys')
    res = await b.get('/step-up?next=/keys')
    expect(res.headers.get('location')).toBe('/signin?next=%2Fstep-up%3Fnext%3D%252Fkeys')
    // a POST from a page on another site never becomes the next
    res = await b.req('/keys/new', { method: 'POST', headers: { referer: 'https://evil.example/x' } })
    expect(res.headers.get('location')).toBe('/signin?next=%2F')
  })

  it('refuses gated and everyday acts to an unverified account, even with the window open', async () => {
    const { env, b } = await signedIn({ verified: false })
    let res = await b.get('/keys')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/check-email')
    res = await b.post('/keys/new')
    expect(res.headers.get('location')).toBe('/check-email')
    res = await b.req('/reply', { method: 'POST' })
    expect(res.headers.get('location')).toBe('/check-email')
    // verified, the same session goes through
    env.DB.raw.prepare('UPDATE person SET email_verified_at = ?').run(new Date(T0).toISOString())
    expect(await (await b.get('/keys')).text()).toBe('your keys')
    expect(await (await b.req('/reply', { method: 'POST' })).text()).toBe('posted')
    // signed out, an everyday act asks for sign-in
    res = await new Browser(env, '203.0.113.9', site).req('/reply', { method: 'POST', headers: { referer: 'https://shwarm.org/w/minecraft-in-doom' } })
    expect(res.headers.get('location')).toBe('/signin?next=%2Fw%2Fminecraft-in-doom')
  })

  it('is throttled like sign-in', async () => {
    const { b } = await signedIn()
    vi.setSystemTime(T0 + 11 * MIN)
    for (let i = 1; i <= 9; i++) expect((await b.post('/step-up', { password: `wrong ${i}`, next: '/keys' })).status).toBe(400)
    const res = await b.post('/step-up', { password: 'wrong 10', next: '/keys' })
    expect(res.status).toBe(429)
    // even the right password waits now
    expect((await b.post('/step-up', { password: GOOD_PASSWORD, next: '/keys' })).status).toBe(429)
    vi.setSystemTime(T0 + 27 * MIN)
    expect((await b.post('/step-up', { password: GOOD_PASSWORD, next: '/keys' })).status).toBe(303)
  })
})

describe('the inline step-up (the sign-off, dead ends, reopening)', () => {
  const S2 = `/w/${EXAMPLE_BRANCH}/s/2`
  /** @bmo_fan, the example branch's author, signed in; #2 waits on their sign-off. */
  async function author() {
    const { db } = await stagingWorld()
    const env = testEnv(db)
    db.raw.prepare("UPDATE person SET password_hash = ?, email = 'bmo_fan@example.org', email_norm = 'bmo_fan@example.org', email_verified_at = ? WHERE handle = 'bmo_fan'")
      .run(await hashPassword(GOOD_PASSWORD, pepper, 1000), new Date(T0).toISOString())
    const b = new Browser(env)
    expect((await b.post('/signin', { email: 'bmo_fan@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    const signOff = async (fields: Record<string, string>) => {
      const token = formTokenIn(await (await b.req(S2, { headers: { accept: 'text/html' } })).text())
      return b.req(S2, { form: { form_token: token, do: 'signoff', ...fields } })
    }
    const window = () => (db.raw.prepare('SELECT step_up_until FROM session').get() as { step_up_until: string }).step_up_until
    return { db, b, signOff, window }
  }

  it('opens the 10-minute window on the session, as /step-up does, even when the act itself is then refused', async () => {
    const { b, signOff, window } = await author()
    vi.setSystemTime(T0 + 11 * MIN)
    expect(await body(await b.req(S2, { headers: { accept: 'text/html' } }))).toContain('type="password"')
    // the right password, but nothing said about what was checked: core refuses the pass, the window is open anyway
    const res = await signOff({ verdict: 'pass', text: '', password: GOOD_PASSWORD })
    expect(res.status).toBe(400)
    const html = await body(res)
    expect(html).toContain('say what you checked.')
    expect(html).not.toContain('type="password"') // the page that comes back doesn't ask again
    expect(window()).toBe(new Date(T0 + 21 * MIN).toISOString())
    // inside the window the sign-off goes through without the password
    vi.setSystemTime(T0 + 20 * MIN)
    expect((await signOff({ verdict: 'pass', text: 'played it tonight.' })).status).toBe(303)
  })

  it('is throttled like sign-in after repeated bad passwords', async () => {
    const { signOff } = await author()
    vi.setSystemTime(T0 + 11 * MIN)
    for (let i = 1; i <= 9; i++) expect((await signOff({ verdict: 'pass', text: 'ok', password: `wrong ${i}` })).status).toBe(400)
    let res = await signOff({ verdict: 'pass', text: 'ok', password: 'wrong 10' })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBeTruthy()
    expect(await body(res)).toContain('there have been too many tries from here.')
    // even the right password waits now, and the draft stays
    res = await signOff({ verdict: 'pass', text: 'my draft', password: GOOD_PASSWORD })
    expect(res.status).toBe(429)
    expect(await body(res)).toContain('>my draft</textarea>')
    vi.setSystemTime(T0 + 27 * MIN)
    resetReadLimit()
    expect((await signOff({ verdict: 'pass', text: 'played it tonight.', password: GOOD_PASSWORD })).status).toBe(303)
  })
})
