import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { requireStepUp } from '../src/auth/stepup'
import app from '../src/index'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, GOOD_PASSWORD, pepper, testEnv } from './browser'

const MIN = 60_000

// The site plus two gated acts, the way later phases will use requireStepUp.
const site = new Hono<{ Bindings: { DB: D1Database } }>()
site.route('/', app)
site.get('/keys', async c => (await requireStepUp(c)) ?? c.text('your keys'))
site.post('/keys/new', async c => (await requireStepUp(c)) ?? c.text('key made'))

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function signedIn() {
  const env = testEnv()
  const id = await addPerson(env.DB, 'myra', { hash: await hashPassword(GOOD_PASSWORD, pepper) })
  env.DB.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(new Date(T0).toISOString(), id)
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
