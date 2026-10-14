// The activity strip above the thread (decided Oct 10, review round 2): public posts per UTC day over the last 14
// days, on a shwarm with its branches, on a branch with its sub-branches; drawn as plain bars with the same in words;
// and the page's ETag carrying the UTC day, so a cached page can't keep yesterday's window.
import { jsx } from 'hono/jsx'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newId } from '../src/core/ids'
import { ACTIVITY_DAYS, activityDays, readActivity, type ActivityDay } from '../src/read/activity'
import { resetReadLimit } from '../src/web/read-limit'
import { Activity, activityWords } from '../src/web/node-page'
import { forgetVersions, VERSION_MEMO_MS } from '../src/web/version-memo'
import { addPerson, T0, testDb } from './d1'
import { body, Browser, fakeFetch, testEnv } from './browser'

const DAY = 86_400_000
const HTML = { accept: 'text/html' }

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0) // 2026-10-08 12:00 utc
  resetReadLimit()
  forgetVersions()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** A tree of nodes written straight to the tables: a shwarm, branches, sub-branches, and their posts. */
async function world() {
  const db = testDb()
  const author = await addPerson(db, 'author')
  const poster = await addPerson(db, 'gunter')
  const ids = new Map<string, number>()
  const node = (path: string, o: { hidden?: boolean; triage?: string } = {}) => {
    const up = path.includes('/') ? ids.get(path.replace(/\/[^/]+$/, ''))! : null
    const root = path.includes('/') ? ids.get(path.split('/')[0])! : null
    const r = db.raw
      .prepare(
        `INSERT INTO node (path, slug, kind, parent_id, root_id, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, hidden, triage, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'w', 'd', '{"author":true}', 1, 'MIT', ?, '@author', 'live', ?, ?, ?)`,
      )
      .run(path, path.split('/').pop(), up ? 'branch' : 'shwarm', up, root, path.split('/').pop(), author, o.hidden ? 1 : 0, o.triage ?? 'clear', new Date(T0 - 30 * DAY).toISOString())
    ids.set(path, Number(r.lastInsertRowid))
  }
  const post = (path: string, at: number | string, o: { hidden?: boolean; deleted?: boolean; as?: string } = {}) => {
    const iso = typeof at === 'string' ? at : new Date(at).toISOString()
    db.raw
      .prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, hidden, created_at, deleted_at) VALUES (?, ?, ?, ?, 'post', 'hello', ?, ?, ?)")
      .run(newId('p'), ids.get(path), poster, o.as ?? '@gunter', o.hidden ? 1 : 0, iso, o.deleted ? iso : null)
  }
  const read = (path: string, now = Date.now()) => readActivity(db, ids.get(path)!, now)
  return { db, node, post, read, ids }
}

const counts = (days: ActivityDay[]) => Object.fromEntries(days.filter(d => d.posts).map(d => [d.day, d.posts]))
const total = (days: ActivityDay[]) => days.reduce((t, d) => t + d.posts, 0)

describe('counting (read/activity.ts)', () => {
  it('14 UTC days, oldest first, today last; the first day counts from its midnight, the day before it not at all', async () => {
    const w = await world()
    w.node('mid')
    const days = await w.read('mid')
    expect(days).toHaveLength(ACTIVITY_DAYS)
    expect(days[0].day).toBe('2026-09-25')
    expect(days[13].day).toBe('2026-10-08')
    expect(total(days)).toBe(0)
    w.post('mid', '2026-09-24T23:59:59.999Z') // the 15th day back: out
    w.post('mid', '2026-09-25T00:00:00.000Z') // the first day: in
    w.post('mid', '2026-10-08T11:59:00.000Z') // today, so far
    expect(counts(await w.read('mid'))).toEqual({ '2026-09-25': 1, '2026-10-08': 1 })
  })

  it('buckets by UTC day, not by 24 hours back from now', async () => {
    const w = await world()
    w.node('mid')
    w.post('mid', '2026-10-06T23:59:59.999Z')
    w.post('mid', '2026-10-07T00:00:00.000Z')
    w.post('mid', '2026-10-07T23:59:59.999Z')
    w.post('mid', '2026-10-08T00:00:00.000Z')
    expect(counts(await w.read('mid'))).toEqual({ '2026-10-06': 1, '2026-10-07': 2, '2026-10-08': 1 })
    // Just after midnight the window has moved a day: oct 8 is now yesterday, and sep 25 has left.
    w.post('mid', '2026-09-25T10:00:00.000Z')
    const next = await w.read('mid', Date.parse('2026-10-09T00:00:00.001Z'))
    expect(next[0].day).toBe('2026-09-26')
    expect(next[13]).toEqual({ day: '2026-10-09', posts: 0 })
    expect(counts(next)).toEqual({ '2026-10-06': 1, '2026-10-07': 2, '2026-10-08': 1 })
  })

  it("a shwarm counts its branches' threads; a branch its own and its sub-branches', not its parent's or a sibling's", async () => {
    const w = await world()
    w.node('mid')
    w.node('mid/block')
    w.node('mid/block/deep')
    w.node('mid/block-two') // shares a prefix with mid/block, but isn't under it
    w.node('other') // another tree
    const at = T0 - 60_000
    w.post('mid', at)
    w.post('mid/block', at)
    w.post('mid/block', at)
    w.post('mid/block/deep', at)
    w.post('mid/block-two', at)
    w.post('other', at)
    expect(total(await w.read('mid'))).toBe(5)
    expect(total(await w.read('mid/block'))).toBe(3)
    expect(total(await w.read('mid/block/deep'))).toBe(1)
    expect(total(await w.read('mid/block-two'))).toBe(1)
    expect(total(await w.read('other'))).toBe(1)
  })

  it('only what the public sees: no hidden or deleted posts, nothing on a held, blocked, pending or hidden node or under one', async () => {
    const w = await world()
    w.node('mid')
    w.node('mid/open')
    w.node('mid/held', { triage: 'held' })
    w.node('mid/held/under') // cleared itself, but under a held branch
    w.node('mid/blocked', { triage: 'blocked' })
    w.node('mid/pending', { triage: 'pending' })
    w.node('mid/gone', { hidden: true })
    w.node('mid/gone/under')
    const at = T0 - 60_000
    w.post('mid', at)
    w.post('mid', at, { hidden: true })
    w.post('mid', at, { deleted: true })
    w.post('mid/open', at, { as: '@gunter/agent-7' }) // an agent's post is a post like any other
    for (const p of ['mid/held', 'mid/held/under', 'mid/blocked', 'mid/pending', 'mid/gone', 'mid/gone/under']) w.post(p, at)
    expect(total(await w.read('mid'))).toBe(2)
    expect(total(await w.read('mid/held'))).toBe(0) // its author may see the page; the strip still counts only public posts
  })

  it("checks visibility once per tree, not each node's whole chain: the path tests grow with the nodes, not their square", async () => {
    // Review fix: checking every counted node's ancestors through node_root read the whole tree once per node, so a
    // tree of N nodes made about N² path comparisons (1.7 s on 4,000 nodes). Counting the substr calls on paths shows
    // the shape whatever the machine: a tree of 301 nodes took about 90,000 of them before, a few hundred now.
    const w = await world()
    w.node('mid')
    const at = T0 - 60_000
    w.post('mid', at)
    for (let b = 0; b < 20; b++) {
      w.node(`mid/b${b}`)
      w.post(`mid/b${b}`, at)
      for (let s = 0; s < 14; s++) {
        w.node(`mid/b${b}/s${s}`)
        w.post(`mid/b${b}/s${s}`, at)
      }
    }
    w.node('mid/b0/held', { triage: 'held' }) // still dropped, with what's under it
    w.node('mid/b0/held/under')
    w.post('mid/b0/held', at)
    w.post('mid/b0/held/under', at)
    let pathTests = 0
    w.db.raw.function('substr', { deterministic: true }, (s: string, a: number, n?: number) => {
      if (!/^\d{4}-/.test(s)) pathTests++ // a node path, not a post's created_at
      return n === undefined ? s.slice(a - 1) : s.substr(a - 1, n)
    })
    expect(total(await w.read('mid'))).toBe(301)
    expect(total(await w.read('mid/b0'))).toBe(15)
    expect(total(await w.read('mid/b0/s3'))).toBe(1)
    expect(pathTests).toBeLessThan(3 * 303)
  })

  it('is one query on the indexes (node_parent and post_node), with no scan of the post table', async () => {
    const w = await world()
    w.node('mid')
    w.node('mid/block')
    const seen: string[] = []
    const prepare = w.db.prepare.bind(w.db)
    w.db.prepare = ((sql: string) => (seen.push(sql), prepare(sql))) as typeof w.db.prepare
    await w.read('mid/block')
    expect(seen).toHaveLength(1)
    const plan = w.db.raw
      .prepare(`EXPLAIN QUERY PLAN ${seen[0]}`)
      .all(w.ids.get('mid/block'), activityDays(T0)[0])
      .map((r: { detail: string }) => r.detail)
      .join('\n')
    expect(plan).toMatch(/SEARCH d USING INTEGER PRIMARY KEY \(rowid=\?\)/) // the node itself
    expect(plan).toMatch(/SEARCH vis_d USING INDEX node_root \(root_id=\?\)/) // its chain, once
    expect(plan).toMatch(/SEARCH c USING INDEX node_parent \(parent_id=\?\)/) // the walk down
    expect(plan).toMatch(/SEARCH p USING INDEX post_node \(node_id=\? AND created_at>\?\)/)
    expect(plan).not.toMatch(/post_created/) // not the whole site's recent posts
    expect(plan.replace(/\bSCAN u\b/g, '')).not.toMatch(/\bSCAN\b/) // only the walk's own rows are read in full
  })
})

describe('the strip (web/node-page.tsx)', () => {
  const strip = (days: ActivityDay[]) => String(jsx(Activity, { days }))
  const window = (spec: Record<string, number>) => activityDays(T0).map(day => ({ day, posts: spec[day] ?? 0 }))

  it('says it in words: the total, the busiest day (the latest of a tie), "on" when it was all one day', () => {
    expect(activityWords(window({}))).toBeNull()
    expect(activityWords(window({ '2026-10-08': 1 }))).toBe('1 post in the last 14 days, on oct 8')
    expect(activityWords(window({ '2026-10-02': 5 }))).toBe('5 posts in the last 14 days, on oct 2')
    expect(activityWords(window({ '2026-09-25': 4, '2026-10-01': 9, '2026-10-07': 9, '2026-10-08': 2 }))).toBe('24 posts in the last 14 days, most on oct 7')
    expect(activityWords(window({ '2026-10-03': 1200, '2026-10-04': 34 }))).toBe('1,234 posts in the last 14 days, most on oct 3')
  })

  it('a bar per day scaled to the busiest, hidden from screen readers, then the words; nothing when there were no posts', () => {
    const html = strip(window({ '2026-09-25': 1, '2026-10-06': 112, '2026-10-08': 61 }))
    expect(html.startsWith('<div class="activity"><span class="bars" aria-hidden="true">')).toBe(true)
    const bars = [...html.matchAll(/<span style="height:(\d+)%" title="([^"]+)"><\/span>/g)]
    expect(bars).toHaveLength(14)
    expect(bars.map(b => Number(b[1]))).toEqual([8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 54]) // a busy day's 1 is still a visible sliver
    expect(bars[0][2]).toBe('sep 25: 1 post')
    expect(bars[11][2]).toBe('oct 6: 112 posts')
    expect(bars[1][2]).toBe('sep 26: 0 posts')
    expect(html).toContain('<span>174 posts in the last 14 days, most on oct 6</span></div>')
    expect(strip(window({}))).toBe('')
  })
})

describe('the strip on the pages', () => {
  it('heads the thread on the shwarm and the branch page, above the sort line, with no names or agents in it', async () => {
    const w = await world()
    w.node('mid')
    w.node('mid/block')
    w.post('mid', T0 - DAY, { as: '@gunter/agent-7' })
    w.post('mid/block', T0 - 60_000)
    const b = new Browser(testEnv(w.db))
    const shwarm = await body(await b.req('/w/mid', { headers: HTML }))
    const strip = /<div class="thread"><div class="activity">([\s\S]*?)<\/div><div class="sorter">/.exec(shwarm)
    expect(strip).not.toBeNull()
    expect(strip![1]).toContain('2 posts in the last 14 days, most on oct 8')
    expect(strip![1]).not.toMatch(/@|gunter|agent/)
    const branch = await body(await b.req('/w/mid/block', { headers: HTML }))
    expect(branch).toMatch(/<div class="thread"><div class="activity">[\s\S]*?1 post in the last 14 days, on oct 8<\/span><\/div><div class="sorter">/)
    // A quiet thread draws no strip at all.
    w.node('quiet')
    expect(await body(await b.req('/w/quiet', { headers: HTML }))).not.toContain('class="activity"')
  })
})

describe('caching: the window moves at UTC midnight with no write', () => {
  // The validator carried the UTC day until Oct 13; it carries the UTC hour now, since a branch turns quiet after 48 hours
  // with no write (read/node.ts QUIET_HOURS), and the text and JSON list quiet branches too.
  it("the ETag carries the UTC hour: 304 within the hour, a new page after it and after midnight; the text and JSON forms too", async () => {
    const w = await world()
    w.node('mid')
    w.post('mid', '2026-09-25T09:00:00.000Z') // in the window today, out of it tomorrow
    const b = new Browser(testEnv(w.db))
    const first = await b.req('/w/mid', { headers: HTML })
    const etag = first.headers.get('etag')!
    expect(etag).toMatch(/\.2026-10-08T12"$/)
    expect(await body(first)).toContain('1 post in the last 14 days, on sep 25')
    const json = (await b.req('/w/mid?format=json')).headers.get('etag')!
    expect(json).toMatch(/\.2026-10-08T12"$/)

    vi.setSystemTime(Date.parse('2026-10-08T12:59:59.999Z'))
    expect((await b.req('/w/mid', { headers: { ...HTML, 'if-none-match': etag } })).status).toBe(304)
    expect((await b.req('/w/mid?format=json', { headers: { 'if-none-match': json } })).status).toBe(304)

    vi.setSystemTime(Date.parse('2026-10-08T13:00:00.000Z'))
    const later = await b.req('/w/mid', { headers: { ...HTML, 'if-none-match': etag } })
    expect(later.status).toBe(200)
    expect(later.headers.get('etag')).toMatch(/\.2026-10-08T13"$/)
    expect((await b.req('/w/mid?format=json', { headers: { 'if-none-match': json } })).status).toBe(200)

    vi.setSystemTime(Date.parse('2026-10-09T00:00:00.000Z'))
    const next = await b.req('/w/mid', { headers: { ...HTML, 'if-none-match': later.headers.get('etag')! } })
    expect(next.status).toBe(200)
    expect(next.headers.get('etag')).toMatch(/\.2026-10-09T00"$/)
    expect(await body(next)).not.toContain('class="activity"') // sep 25 left the window
  })

  it("a validator this isolate remembers (the 15-second memo) doesn't carry a page over midnight", async () => {
    const w = await world()
    w.node('mid')
    w.post('mid', '2026-09-25T09:00:00.000Z')
    const b = new Browser(testEnv(w.db))
    vi.setSystemTime(Date.parse('2026-10-08T23:59:59.000Z'))
    const etag = (await b.req('/w/mid', { headers: HTML })).headers.get('etag')!
    vi.setSystemTime(Date.parse('2026-10-08T23:59:59.000Z') + VERSION_MEMO_MS / 2) // past midnight, inside the memo's window
    const after = await b.req('/w/mid', { headers: { ...HTML, 'if-none-match': etag } })
    expect(after.status).toBe(200)
    expect(after.headers.get('etag')).not.toBe(etag)
  })
})
