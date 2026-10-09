// Go-live 3.8: the error pages (403, 404, 410, 429, 500) in all three forms, and exact times behind relative ones.
// The browser suite (test/e2e) covers layout, axe and the modal; this covers statuses, bodies and headers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXAMPLE_ROOT } from '../src/seed/example'
import { errorFormat } from '../src/web/format'
import { waitText } from '../src/web/errors'
import { READ_BURST, resetReadLimit, takeRead } from '../src/web/read-limit'
import { body, Browser, fakeFetch, testEnv } from './browser'
import { addPerson, T0 } from './d1'
import { stagingWorld } from './node-fixture'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const HTML = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
const JSON_ = { accept: 'application/json' }
const TEXT = { accept: 'text/plain' }
const ANY = { accept: '*/*' }

async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  return { ...w, env, b: new Browser(env) }
}

const brokenDb = new Proxy({}, { get: () => () => { throw new Error('SQLITE_ERROR: secret internals in node_stats') } }) as D1Database & { raw: any }

describe('which form an error takes', () => {
  it('node URLs follow the node rules; other pages are HTML unless text or JSON is asked for over it', () => {
    expect(errorFormat('/w/x', undefined, '*/*')).toBe('text')
    expect(errorFormat('/w/x', undefined, undefined)).toBe('text')
    expect(errorFormat('/w/x', undefined, HTML.accept)).toBe('html')
    expect(errorFormat('/w/x', 'json', HTML.accept)).toBe('json')
    expect(errorFormat('/w/x', 'xml', HTML.accept)).toBe('text')
    expect(errorFormat('/nope', undefined, '*/*')).toBe('html')
    expect(errorFormat('/nope', undefined, undefined)).toBe('html')
    expect(errorFormat('/nope', undefined, HTML.accept)).toBe('html')
    expect(errorFormat('/nope', undefined, 'application/json')).toBe('json')
    expect(errorFormat('/nope', undefined, 'text/plain')).toBe('text')
    expect(errorFormat('/nope', undefined, 'text/html, text/plain;q=0.5')).toBe('html')
  })

  it('says the wait in words', () => {
    expect(waitText(1)).toBe('1 second')
    expect(waitText(0.2)).toBe('1 second')
    expect(waitText(12)).toBe('12 seconds')
    expect(waitText(600)).toBe('about 10 minutes')
  })
})

describe('404', () => {
  it('an unknown page is the 404 page, with the security headers and never cached', async () => {
    const { b } = await world()
    const res = await b.req('/no-such-page', { headers: HTML })
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    expect(res.headers.get('cache-control')).toMatch(/no-store/)
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    const html = await body(res)
    expect(html).toContain('<title>not found · shwarm</title>')
    expect(html).toContain('there is nothing at this address.')
    expect(html).toContain('<main id="main"')
    expect(html).toContain('sign in') // the header strip, as on every page
  })

  it('agents that ask get text or JSON', async () => {
    const { b } = await world()
    const j = await b.req('/no-such-page', { headers: JSON_ })
    expect(j.status).toBe(404)
    expect(await j.json()).toEqual({ error: 'not_found', message: 'there is nothing at this address.' })
    const t = await b.req('/no-such-page', { headers: TEXT })
    expect(t.status).toBe(404)
    expect(t.headers.get('content-type')).toMatch(/^text\/plain/)
    expect(await t.text()).toBe('404 not_found: there is nothing at this address.\n')
  })

  it('a signed-in reader sees their strip on the 404 page', async () => {
    const { env, b } = await world()
    const { hashPassword } = await import('../src/auth/password')
    const { GOOD_PASSWORD, pepper } = await import('./browser')
    const pid = await addPerson(env.DB, 'reader', { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
    env.DB.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(new Date(T0).toISOString(), pid)
    expect((await b.post('/signin', { email: 'reader@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    const res = await b.req('/no-such-page', { headers: HTML })
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await body(res)).toContain('@reader')
  })

  it('an unknown node keeps its no_such_node code in every form', async () => {
    const { b } = await world()
    expect(await (await b.req('/w/no-such-shwarm', { headers: ANY })).text()).toBe('404 no_such_node: there is no shwarm or branch at this address.\n')
    expect(await (await b.req('/w/no-such-shwarm', { headers: JSON_ })).json()).toMatchObject({ error: 'no_such_node' })
    const page = await b.req('/w/no-such-shwarm', { headers: HTML })
    expect(page.status).toBe(404)
    expect(await body(page)).toContain('there is no shwarm or branch at this address.')
  })

  it('profiles that can’t show answer agents in text or JSON too', async () => {
    const { env, b } = await world()
    const closed = await addPerson(env.DB, 'gone_one', { status: 'closed' })
    const held = await addPerson(env.DB, 'held_one', { status: 'suspended' })
    env.DB.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id IN (?, ?)').run(new Date(T0).toISOString(), closed, held)
    expect((await b.req('/@nobody_here', { headers: HTML })).status).toBe(404)
    expect(await (await b.req('/@nobody_here', { headers: JSON_ })).json()).toEqual({ error: 'not_found', message: 'nobody goes by that handle here.' })
    const gone = await b.req('/@gone_one', { headers: TEXT })
    expect(gone.status).toBe(410)
    expect(await gone.text()).toBe('410 gone: this account was closed. what it posted stays in the threads.\n')
    const susp = await b.req('/@held_one', { headers: JSON_ })
    expect(susp.status).toBe(403)
    expect(await susp.json()).toMatchObject({ error: 'forbidden' })
    expect((await b.req('/@held_one', { headers: HTML })).status).toBe(403)
  })

  it('production profiles, closed until the beta, are the 404 page too', async () => {
    const { db } = await world()
    const b = new Browser({ ...testEnv(db), ENV: 'production' })
    const res = await b.req('/@myra', { headers: HTML })
    expect(res.status).toBe(404)
    expect(await body(res)).toContain('there is nothing at this address.')
  })
})

describe('410 tombstone', () => {
  it('a hidden shwarm says it was taken down, with the public reason, and nothing of its own', async () => {
    const { env, b, myraId } = await world()
    env.DB.raw.prepare('UPDATE node SET hidden = 1 WHERE path = ?').run(EXAMPLE_ROOT)
    env.DB.raw
      .prepare("INSERT INTO moderation_action (by_person, action, node_id, reason, public, created_at) SELECT ?, 'hide', id, 'a court order.', 1, ? FROM node WHERE path = ?")
      .run(myraId, new Date(T0).toISOString(), EXAMPLE_ROOT)
    const page = await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML })
    expect(page.status).toBe(410)
    expect(page.headers.get('cache-control')).toBe('no-store')
    const html = await body(page)
    expect(html).toContain('<title>taken down · shwarm</title>')
    expect(html).toContain('this shwarm was taken down by the operator. reason: a court order.')
    expect(html).not.toContain('minecraft in doom')
    expect(await (await b.req(`/w/${EXAMPLE_ROOT}`, { headers: JSON_ })).json()).toEqual({
      error: 'gone',
      message: 'this shwarm was taken down by the operator. reason: a court order.',
      reason: 'a court order.',
    })
  })

  it('a private reason stays private; a path that never existed is still a 404', async () => {
    const { env, b, myraId } = await world()
    env.DB.raw.prepare('UPDATE node SET hidden = 1 WHERE path = ?').run(EXAMPLE_ROOT)
    env.DB.raw
      .prepare("INSERT INTO moderation_action (by_person, action, node_id, reason, public, created_at) SELECT ?, 'hide', id, 'internal note', 0, ? FROM node WHERE path = ?")
      .run(myraId, new Date(T0).toISOString(), EXAMPLE_ROOT)
    const text = await (await b.req(`/w/${EXAMPLE_ROOT}`, { headers: ANY })).text()
    expect(text).toBe('410 gone: this shwarm was taken down by the operator.\n')
    expect((await b.req(`/w/${EXAMPLE_ROOT}/never-was`, { headers: ANY })).status).toBe(404)
  })
})

describe('429', () => {
  it('a reader past the cap gets the wait, in Retry-After and on the page', async () => {
    const { b } = await world()
    for (let i = 0; i < READ_BURST + 5; i++) takeRead(b.ip)
    const page = await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML })
    expect(page.status).toBe(429)
    const wait = Number(page.headers.get('retry-after'))
    expect(wait).toBeGreaterThan(0)
    const html = await body(page)
    expect(html).toContain('<title>slow down · shwarm</title>')
    expect(html).toContain(`too many reads from your network. try again in ${waitText(wait)}.`)
    const j = await b.req(`/w/${EXAMPLE_ROOT}`, { headers: JSON_ })
    expect(await j.json()).toMatchObject({ error: 'rate_limited', limit: 'public_reads', retry_after: Number(j.headers.get('retry-after')) })
    expect(await (await b.req(`/w/${EXAMPLE_ROOT}`, { headers: ANY })).text()).toMatch(/^429 rate_limited: too many reads from your network\. try again in \d+ seconds?\.\n$/)
  })
})

describe('500', () => {
  it('a thrown error is a 500 page with nothing from the error in it, and it is logged', async () => {
    const { db } = await world()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const b = new Browser({ ...testEnv(db), DB: brokenDb })
    const res = await b.req('/@myra', { headers: HTML })
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const html = await body(res)
    expect(html).toContain('<title>something broke · shwarm</title>')
    expect(html).not.toMatch(/SQLITE|secret|node_stats|at \w+ \(/)
    expect(log).toHaveBeenCalled()
    expect(String(log.mock.calls[0][0])).toContain('secret internals') // the log keeps what the page leaves out
  })

  it('agents get the 500 as text or JSON, still without internals', async () => {
    const { db } = await world()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const b = new Browser({ ...testEnv(db), DB: brokenDb })
    const t = await b.req(`/w/${EXAMPLE_ROOT}`, { headers: ANY })
    expect(t.status).toBe(500)
    expect(await t.text()).toBe('500 server_error: something went wrong on our side. try again in a minute.\n')
    const j = await b.req('/@myra', { headers: JSON_ })
    expect(j.status).toBe(500)
    expect(await j.json()).toEqual({ error: 'server_error', message: 'something went wrong on our side. try again in a minute.' })
  })

  it('a signed-in reader still gets the page when reading the session is what fails', async () => {
    const { db } = await world()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const b = new Browser({ ...testEnv(db), DB: brokenDb })
    b.jar.set('__Host-shwarm', 'a-session-token-the-broken-database-cannot-read')
    const res = await b.req('/@myra', { headers: HTML })
    expect(res.status).toBe(500)
    const html = await body(res)
    expect(html).toContain('something went wrong on our side.')
    expect(html).toContain('sign in')
  })
})

describe('exact times (3.8)', () => {
  it('relative times on the profile carry the exact time', async () => {
    const { b } = await world()
    const html = await body(await b.req('/@myra', { headers: HTML }))
    const times = [...html.matchAll(/<time datetime="([^"]+)" title="([^"]+)">([^<]+)<\/time>/g)]
    expect(times.length).toBeGreaterThan(0)
    for (const [, at, title, text] of times) {
      expect(title).toBe(`${at.slice(0, 10)} ${at.slice(11, 16)} utc`)
      expect(text).toMatch(/ago|just now/)
    }
  })
})
