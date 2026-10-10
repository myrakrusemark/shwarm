// Go-live 9.5, the public moderation log: /moderation lists the public moderation_action rows, newest first, paged with
// ?before=, for anyone (signed out included), as a page, JSON or text. Never a private row, a reporter, removed text,
// a title or an email. A taken-down node shows by its path, unlinked, with "(taken down)".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { modLog, type ModRow } from '../src/core/moderation'
import { switchReason } from '../src/core/switches'
import { EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { LOG_PAGE } from '../src/web/moderation-log'
import { body, Browser, fakeFetch, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { hashPassword } from '../src/auth/password'
import { addPerson, T0 } from './d1'
import { PLAIN, stagingWorld } from './node-fixture'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
  forgetVersions()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const HTML = { accept: 'text/html' }
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString()

/**
 * The staging-like world with a log: @myra (admin) took down the plain shwarm and a post in minecraft in doom,
 * suspended @spammer, lifted a pause on minecraft in doom, turned read-only on, and closed @gone's account after
 * marking it founding. Private rows: @flagger's pause (the flag that paused a node) and marking @spammer's email
 * verified.
 */
async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const one = (sql: string, ...a: unknown[]) => w.db.raw.prepare(sql).get(...a)
  w.db.raw.prepare('UPDATE person SET is_admin = 1 WHERE id = ?').run(w.myraId)
  const spammer = await addPerson(env.DB, 'spammer')
  const flagger = await addPerson(env.DB, 'flagger')
  const gone = await addPerson(env.DB, 'gone')
  const root = one('SELECT id FROM node WHERE path = ?', EXAMPLE_ROOT).id as number
  const plain = one('SELECT id, title, what FROM node WHERE path = ?', PLAIN)
  w.db.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, hidden, created_at) VALUES ('p_bad', ?, ?, '@spammer', 'post', 'buy cheap pills here', 1, ?)").run(root, spammer, iso(0))
  w.db.raw.prepare('UPDATE node SET hidden = 1 WHERE id = ?').run(plain.id)
  w.db.raw.prepare("UPDATE person SET status = 'suspended' WHERE id = ?").run(spammer)
  w.db.raw.prepare("UPDATE person SET status = 'closed' WHERE id = ?").run(gone)
  const by = w.myraId
  const rows: Omit<ModRow, 'at'>[] = [
    { by: flagger, action: 'pause', nodeId: root, reason: 'third established flag', public: false },
    { by, action: 'unpause', nodeId: root, reason: 'looked fine', public: true },
    { by, action: 'hide', nodeId: plain.id, reason: 'spam', public: true },
    { by, action: 'hide', postId: 'p_bad', nodeId: root, reason: 'spam in a thread', public: true },
    { by, action: 'mark_verified', personId: spammer, reason: 'mail never came for spammer@example.org', public: false },
    { by, action: 'suspend', personId: spammer, reason: 'repeat spam', public: true },
    { by, action: 'founding', personId: gone, reason: 'invited tester', public: true },
    { by, action: 'setting', reason: switchReason('read_only', true, 'moving the database'), public: true },
  ]
  await env.DB.batch(rows.map((r, i) => modLog(env.DB, { ...r, at: iso(i + 1) })))
  return { ...w, env, plain, spammer, flagger }
}

describe('/moderation', () => {
  it('lists public rows newest first for a signed-out reader, cacheable, with targets in plain words', async () => {
    const w = await world()
    const res = await new Browser(w.env).req('/moderation', { headers: HTML })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=60')
    const h = await body(res)
    const table = h.slice(h.indexOf('<tbody>'), h.indexOf('</tbody>'))
    const cells = [...table.matchAll(/<tr id="m(\d+)">(.*?)<\/tr>/g)].map(m => m[2].replace(/<[^>]+>/g, '|').replace(/\|+/g, '|'))
    expect(cells).toEqual([
      '|2026-10-08|changed a switch|read-only: on|moving the database|@myra|',
      '|2026-10-08|marked as invited|former member|invited tester|@myra|',
      '|2026-10-08|suspended|@spammer|repeat spam|@myra|',
      '|2026-10-08|took down|a post in |minecraft-in-doom| (taken down)|spam in a thread|@myra|',
      '|2026-10-08|took down|bot-beats-freedoom| (taken down)|spam|@myra|',
      '|2026-10-08|lifted a pause|minecraft-in-doom|looked fine|@myra|',
    ])
    // a node the public sees is linked; a taken-down one isn't
    expect(h).toContain(`<a href="/w/${EXAMPLE_ROOT}">${EXAMPLE_ROOT}</a>`)
    expect(h).not.toContain(`href="/w/${PLAIN}"`)
  })

  it('never shows private rows, reporters, removed text, titles or emails', async () => {
    const w = await world()
    for (const r of [
      await new Browser(w.env).req('/moderation', { headers: HTML }),
      await new Browser(w.env).get('/moderation?format=json'),
      await new Browser(w.env).get('/moderation?format=text'),
    ]) {
      const t = await body(r)
      for (const never of ['third established flag', '@flagger', 'flagger', 'mail never came', 'example.org', 'buy cheap pills', w.plain.title, w.plain.what, 'paused for review', 'marked an email verified'])
        expect(t).not.toContain(never)
    }
  })

  it('answers agents in JSON and text', async () => {
    const w = await world()
    const b = new Browser(w.env)
    for (const res of [await b.get('/moderation?format=json'), await b.req('/moderation', { headers: { accept: 'application/json' } })]) {
      expect(res.headers.get('content-type')).toContain('application/json')
      const j = (await res.json()) as any
      expect(j.older).toBeNull()
      expect(j.rows).toHaveLength(6)
      expect(j.rows[0]).toEqual({ id: expect.any(Number), at: iso(8), action: 'setting', words: 'changed a switch', target: { kind: 'switch', key: 'read_only', name: 'read-only', value: true }, reason: 'moving the database', by: '@myra' })
      expect(j.rows.find((r: any) => r.reason === 'spam').target).toEqual({ kind: 'node', path: PLAIN, shown: false })
      expect(j.rows.find((r: any) => r.reason === 'spam in a thread').target).toEqual({ kind: 'post', node: EXAMPLE_ROOT, nodeShown: true, shown: false })
      expect(j.rows.find((r: any) => r.action === 'suspend').target).toEqual({ kind: 'person', name: '@spammer' })
    }
    const text = await (await b.req('/moderation', { headers: { accept: '*/*' } })).text()
    expect(text.split('\n')[0]).toBe('2026-10-08  @myra changed a switch: read-only → on. moving the database')
    expect(text).toContain(`@myra took down: ${PLAIN} (taken down). spam`)
  })

  it('pages with ?before=, newest first', async () => {
    const w = await world()
    const extra = Array.from({ length: LOG_PAGE }, (_, i) => modLog(w.env.DB, { by: w.myraId, action: 'unpause', nodeId: null, reason: `r${i}`, public: true, at: iso(100 + i) }))
    await w.env.DB.batch(extra)
    const b = new Browser(w.env)
    const first = (await (await b.get('/moderation?format=json')).json()) as any
    expect(first.rows).toHaveLength(LOG_PAGE)
    expect(first.rows[0].reason).toBe(`r${LOG_PAGE - 1}`)
    expect(first.rows.at(-1).reason).toBe('r0')
    const ids = first.rows.map((r: any) => r.id)
    expect(ids).toEqual([...ids].sort((a: number, z: number) => z - a))
    expect(first.older).toBe(`/moderation?format=json&before=${ids.at(-1)}`)
    const second = (await (await b.get(first.older)).json()) as any
    expect(second.rows.map((r: any) => r.reason)).toEqual(['moving the database', 'invited tester', 'repeat spam', 'spam in a thread', 'spam', 'looked fine'])
    expect(second.older).toBeNull()

    const page1 = await body(await b.req('/moderation', { headers: HTML }))
    expect(page1).toContain(`<a href="/moderation?before=${ids.at(-1)}">older entries</a>`)
    const page2 = await body(await b.req(`/moderation?before=${ids.at(-1)}`, { headers: HTML }))
    expect(page2).toContain('<h2>older entries</h2>')
    expect(page2).toContain('<a href="/moderation">newest</a>')
    expect(page2).not.toContain('?before=')
    // a junk before is ignored
    expect(((await (await b.get('/moderation?format=json&before=abc')).json()) as any).rows[0].reason).toBe(`r${LOG_PAGE - 1}`)
  })

  it('says when the log is empty, and is private when signed in', async () => {
    const w = await stagingWorld()
    const env = testEnv(w.db)
    expect(await body(await new Browser(env).req('/moderation', { headers: HTML }))).toContain('nothing in the log yet.')
    w.db.raw.prepare('UPDATE person SET password_hash = ?, is_admin = 1 WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), w.myraId)
    const b = new Browser(env)
    expect((await b.post('/signin', { email: 'myra@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    expect((await b.req('/moderation', { headers: HTML })).headers.get('cache-control')).toBe('private, no-store')
  })

  it('is linked from the rules page', async () => {
    const w = await stagingWorld()
    expect(await body(await new Browser(testEnv(w.db)).req('/rules', { headers: HTML }))).toContain('href="/moderation"')
  })
})
