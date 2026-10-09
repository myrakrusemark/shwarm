import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv, type TestEnv } from './browser'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function member(env: TestEnv, handle: string, verified = true) {
  const id = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
  if (verified) env.DB.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(new Date(T0).toISOString(), id)
  return id
}

async function signedIn(env: TestEnv, handle: string) {
  const b = new Browser(env)
  const res = await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })
  expect(res.status).toBe(303)
  return b
}

/** Counts the SQL statements a request prepares. */
function countQueries(env: TestEnv) {
  const seen: string[] = []
  const prepare = env.DB.prepare.bind(env.DB)
  env.DB.prepare = ((sql: string) => (seen.push(sql), prepare(sql))) as typeof env.DB.prepare
  return seen
}

const strip = (html: string) => /<div class="strip">([\s\S]*?)<\/div>/.exec(html)![1]

describe('the header strip', () => {
  it('signed out: welcome, sign in and join that come back to this page, and no database read', async () => {
    const env = testEnv()
    const seen = countQueries(env)
    const html = await body(await new Browser(env).get('/rules'))
    const s = strip(html)
    expect(s).toContain('welcome new friends!')
    expect(s).toContain('<a href="/signin?next=%2Frules">sign in</a><a href="/join?next=%2Frules">join</a>')
    expect(s).not.toContain('sign out')
    expect(seen).toEqual([])
  })

  it("signed out on an account page: sign in and join don't point back at it", async () => {
    const html = await body(await new Browser(testEnv()).get('/forgot'))
    expect(strip(html)).toContain('<a href="/signin">sign in</a><a href="/join">join</a>')
  })

  it('signed in: @handle, for you, keys and a sign-out form, as in the mockups', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const b = await signedIn(env, 'myra')
    const res = await b.get('/rules')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const s = strip(await body(res))
    expect(s).toContain('welcome new friends!')
    expect(s).toContain('<a class="h" href="/@myra">@myra</a>')
    expect(s).toContain('<a href="/@myra#addressed" title="posts addressed to @myra (only you see this)">for you</a>')
    expect(s).toContain('<a href="/keys">keys</a>')
    expect(s).toMatch(/<form class="out" method="post" action="\/signout"><input type="hidden" name="form_token" value="[^"]+"\/><button type="submit">sign out<\/button><\/form>/)
    expect(s).not.toContain('sign in')
    expect(s).not.toContain('verify your email')
  })

  it("the strip's sign-out form signs out", async () => {
    const env = testEnv()
    await member(env, 'myra')
    const b = await signedIn(env, 'myra')
    const token = formTokenIn(strip(await (await b.get('/terms')).text()))
    const res = await b.req('/signout', { form: { form_token: token } })
    expect(res.status).toBe(303)
    expect(b.jar.has('__Host-shwarm')).toBe(false)
    expect(strip(await body(await b.get('/terms')))).toContain('sign in')
  })

  it('shows the unread inbox count', async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    const b = await signedIn(env, 'myra')
    const add = (read: string | null) =>
      env.DB.raw.prepare("INSERT INTO inbox_item (person_id, kind, text, created_at, read_at) VALUES (?, 'mention', '', ?, ?)").run(id, new Date(T0).toISOString(), read)
    add(null)
    add(null)
    add(null)
    add(new Date(T0).toISOString())
    expect(strip(await body(await b.get('/rules')))).toContain('for you<span class="n">3</span></a>')
    for (let i = 0; i < 120; i++) add(null)
    expect(strip(await body(await b.get('/rules')))).toContain('for you<span class="n">99+</span></a>')
  })

  it('unverified: a quiet "verify your email" in place of for you and keys', async () => {
    const env = testEnv()
    await member(env, 'newbie', false)
    const b = await signedIn(env, 'newbie')
    const s = strip(await body(await b.get('/rules')))
    expect(s).toContain('<a class="h" href="/@newbie">@newbie</a>')
    expect(s).toContain('<a class="quiet" href="/check-email">verify your email</a>')
    expect(s).not.toContain('keys')
    expect(s).not.toContain('for you')
    expect(s).toContain('sign out')
  })

  it('reads the session once per request, even on account pages that also need it', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const b = await signedIn(env, 'myra')
    const seen = countQueries(env)
    const html = await body(await b.get('/signin'))
    expect(html).toContain("you're signed in as @myra")
    expect(strip(html)).toContain('@myra')
    expect(seen.filter(q => q.includes('FROM session s'))).toHaveLength(1)
  })
})
