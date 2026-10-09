// Go-live 5.7: GET /w/<path>/log, the audit log as JSON. A full core run (the example's lobby fill, branch and checks;
// the shwarm's pass with the author's sign-off; a branch passed and reopened by a repro; an author's fail; a dead end)
// and every event of it in the log, newest first, each linked to evidence that's really there. Milestones, paging with
// ?before, hidden branches and submissions left out, and the seeded row first on a seeded shwarm.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_EVENTS, MILESTONE_EVENTS } from '../src/core/audit'
import { readChain } from '../src/read/node'
import { readLog, type LogPage, type LogRow } from '../src/read/log'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { agent, SHA, site, stepped } from './core-fixtures'
import { T0 } from './d1'
import { body, Browser, fakeFetch, ORIGIN, testEnv } from './browser'
import { closedWorld } from './result-fixture'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 + 3_600_000)
  resetReadLimit()
  forgetVersions()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const LOG = `/w/${EXAMPLE_ROOT}/log`
const MONSTERS = `${EXAMPLE_BRANCH}/monster-collision`
const BREAK = `${EXAMPLE_BRANCH}/break-blocks`
const TEXTURES = `${EXAMPLE_BRANCH}/texture-pack`

type Ev = { id: string | null; at: string; event: string; node: string; by: string | null; submission?: string; number?: number; detail: string; evidence: string; milestone: boolean }
type NodeLog = { node: string; filter: string; total: number; next: string | null; events: Ev[] }

/** The closed world, plus the rest of a run: the branch passes and is reopened, a sub-branch fails its author check, another is a dead end. */
async function fullRun() {
  const w = await closedWorld()
  const { run, p } = w
  const get = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).get(...args) as any
  const subOf = (path: string, n: number) => get('SELECT s.post_id FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.number = ?', path, n).post_id as string
  // block placement passes on #2 with @bmo_fan's sign-off, then @gunter's repro reopens it
  await run({ type: 'check', actor: stepped(p('bmo_fan')), input: { node: EXAMPLE_BRANCH, on: subOf(EXAMPLE_BRANCH, 2), slot: 'author', verdict: 'pass', text: 'every corner holds.' } })
  await run({ type: 'check', actor: site(p('gunter')), input: { node: EXAMPLE_BRANCH, on: subOf(EXAMPLE_BRANCH, 2), verdict: 'fail', repro: 'place on a corner at y=-120: the block lands one chunk off.' } })
  // two sub-branches: one fails its author check, one is a dead end; a third is still being checked
  const branch = (who: string, title: string, check: unknown) =>
    run({ type: 'createNode', actor: site(p(who)), input: { kind: 'branch', parent: EXAMPLE_BRANCH, title, what: `${title}.`, doneWhen: `${title} works.`, check } })
  await branch('bmo_fan', 'break blocks', { author: true })
  await branch('finn_irl', 'monster collision', { people: { count: 1 }, author: true })
  await branch('lumpy', 'texture pack', { author: true })
  w.db.raw.prepare('UPDATE node SET triage = ? WHERE path IN (?, ?)').run('clear', BREAK, MONSTERS)
  const brk = await run<{ id: string }>({
    type: 'submit',
    actor: agent(p('kestrel'), 'swarm/r-11'),
    input: { node: BREAK, text: 'breaking updates within one frame.', links: [{ url: 'https://codeberg.org/kestrel/mcdoom/break.diff', sha256: SHA('b1') }], howToCheck: 'break 100 blocks.' },
  })
  await run({ type: 'check', actor: stepped(p('bmo_fan')), input: { node: BREAK, on: brk.id, slot: 'author', verdict: 'fail', repro: 'broken blocks leave a ghost collision box.' } })
  await run({ type: 'deadEnd', actor: stepped(p('finn_irl')), input: { node: MONSTERS, note: 'the blockmap is built once per level; an incremental update needs engine changes.' } })
  const env = testEnv(w.db)
  const b = new Browser(env)
  const json = async (path: string): Promise<NodeLog> => JSON.parse(await body(await b.req(path)))
  /** Every page of a log, following next. */
  const all = async (path: string): Promise<{ events: Ev[]; totals: number[] }> => {
    const events: Ev[] = []
    const totals: number[] = []
    let url = path
    for (let i = 0; i < 20; i++) {
      const page = await json(url)
      events.push(...page.events)
      totals.push(page.total)
      if (!page.next) break
      url = `${path}${path.includes('?') ? '&' : '?'}before=${page.next}`
    }
    return { events, totals }
  }
  /** The stored events of these nodes, newest first, as the log orders them. */
  const stored = (paths: string[]) =>
    w.db.raw
      .prepare(`SELECT a.id, a.event FROM audit_event a JOIN node n ON n.id = a.node_id WHERE n.path IN (${paths.map(() => '?').join(', ')}) ORDER BY a.at DESC, a.rowid DESC`)
      .all(...paths) as { id: string; event: string }[]
  return { ...w, b, get, json, all, stored }
}

const TREE = [EXAMPLE_ROOT, EXAMPLE_BRANCH, BREAK, MONSTERS]

describe('GET /w/<path>/log (5.7)', () => {
  it('lists every event of the run, newest first, each linked to evidence that is there, the seeded row last', async () => {
    const w = await fullRun()
    const { events, totals } = await w.all(`${LOG}?filter=all`)
    const want = w.stored(TREE)
    expect(events.slice(0, -1).map(e => e.id)).toEqual(want.map(e => e.id))
    expect(totals.every(t => t === want.length + 1)).toBe(true)
    // all nine event types happened, and the seeded row (A18) closes the log
    expect(new Set(events.map(e => e.event))).toEqual(new Set([...AUDIT_EVENTS, 'seeded']))
    expect(events.at(-1)).toEqual({ id: null, at: expect.any(String), event: 'seeded', node: EXAMPLE_ROOT, by: '@myra', detail: 'seeded by @myra at launch', evidence: `${ORIGIN}/w/${EXAMPLE_ROOT}`, milestone: true })
    // the shape: each row names its node; the submission and its number when there is one
    const passed = events.find(e => e.event === 'passed' && e.node === EXAMPLE_ROOT)!
    expect(passed).toMatchObject({ by: null, number: 1, submission: w.sub.id, evidence: `${ORIGIN}/w/${EXAMPLE_ROOT}/s/1`, milestone: true })
    expect(events.find(e => e.event === 'lobby_filled')).not.toHaveProperty('submission')
    // every row links to its evidence, and the page it links to has the anchor
    for (const e of events) {
      expect(e.evidence.startsWith(`${ORIGIN}/w/`), e.event).toBe(true)
      const [path, anchor] = e.evidence.slice(ORIGIN.length).split('#')
      const res = await w.b.req(path, { headers: { accept: 'text/html' } })
      expect(res.status, e.evidence).toBe(200)
      if (anchor) expect(await body(res), e.evidence).toContain(`id="${anchor}"`)
    }
  })

  it('shows milestones by default: passes, sign-offs, dead ends, reopenings, branch openings, lobby fills', async () => {
    const w = await fullRun()
    const page = await w.json(LOG)
    expect(page.filter).toBe('milestones')
    const want = w.stored(TREE).filter(e => (MILESTONE_EVENTS as readonly string[]).includes(e.event))
    expect(page.events.map(e => e.id)).toEqual([...want.map(e => e.id), null])
    expect(page.total).toBe(want.length + 1)
    expect(page.events.every(e => e.milestone)).toBe(true)
    expect(new Set(page.events.map(e => e.event))).toEqual(new Set([...MILESTONE_EVENTS, 'seeded']))
    expect(await w.json(`${LOG}?filter=milestones`)).toEqual(page)
  })

  it('pages back with ?before and next; total stays the whole count', async () => {
    const w = await fullRun()
    const full = (await w.json(`${LOG}?filter=all`)).events
    const page = await w.json(`${LOG}?filter=all&before=${full[5].id}`)
    expect(page.events).toEqual(full.slice(6))
    expect(page.total).toBe(full.length)
    // small pages through the read itself: every row once, in order, the seeded row on the last page
    const chain = (await readChain(w.db, EXAMPLE_ROOT, null))!
    const rows: LogRow[] = []
    let before: string | null = null
    for (let i = 0; i < 50; i++) {
      const p: LogPage = (await readLog(w.db, chain, { filter: 'all', before, limit: 4 }))!
      expect(p.rows.length).toBeLessThanOrEqual(4)
      expect(p.total).toBe(full.length)
      rows.push(...p.rows)
      if (!p.next) break
      before = p.next
    }
    expect(rows.map(r => r.id)).toEqual(full.map(e => e.id))
    // a cursor that isn't an event of this log, or isn't an event at all
    const other = w.get("SELECT id FROM audit_event a WHERE a.node_id NOT IN (SELECT id FROM node WHERE path LIKE 'minecraft-in-doom%') LIMIT 1")
    for (const bad of ['nope', 'e_zzzzzzzzzz', ...(other ? [other.id] : [])]) {
      const res = await w.b.req(`${LOG}?before=${bad}`)
      expect(res.status, bad).toBe(400)
      expect(JSON.parse(await body(res))).toMatchObject({ error: 'bad_request', message: 'before is not an event in this log' })
    }
    expect((await w.b.req(`${LOG}?filter=everything`)).status).toBe(400)
  })

  it('leaves out branches the public cannot see, and rows of a hidden submission', async () => {
    const w = await fullRun()
    let events = (await w.all(`${LOG}?filter=all`)).events
    // texture pack is still being checked: its opening isn't in the log
    expect(events.some(e => e.node === TEXTURES)).toBe(false)
    expect(events.some(e => e.node === MONSTERS)).toBe(true)
    w.db.raw.prepare('UPDATE node SET hidden = 1 WHERE path = ?').run(MONSTERS)
    forgetVersions()
    events = (await w.all(`${LOG}?filter=all`)).events
    expect(events.some(e => e.node === MONSTERS)).toBe(false)
    expect(events.at(-1)!.event).toBe('seeded')
    // a hidden submission takes its rows with it: submitted, its checks, the author's fail
    const brk = w.get("SELECT s.post_id FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ?", BREAK).post_id
    expect(events.filter(e => e.submission === brk).map(e => e.event).sort()).toEqual(['failed', 'signed_off', 'submission'])
    w.db.raw.prepare('UPDATE post SET hidden = 1 WHERE id = ?').run(brk)
    forgetVersions()
    const after = await w.all(`${LOG}?filter=all`)
    expect(after.events.some(e => e.submission === brk)).toBe(false)
    expect(after.totals[0]).toBe(after.events.length)
    // a branch hidden as a whole is a tombstone, as its page is
    expect((await w.b.req(`/w/${MONSTERS}/log`)).status).toBe(410)
  })

  it("a branch's log is its own and its sub-branches', with no seeded row", async () => {
    const w = await fullRun()
    const { events } = await w.all(`/w/${EXAMPLE_BRANCH}/log?filter=all`)
    expect(events.map(e => e.id)).toEqual(w.stored([EXAMPLE_BRANCH, BREAK, MONSTERS]).map(e => e.id))
    expect(new Set(events.map(e => e.node))).toEqual(new Set([EXAMPLE_BRANCH, BREAK, MONSTERS]))
    expect(events.some(e => e.event === 'seeded')).toBe(false)
  })

  it('is JSON whatever was asked for, cacheable signed out with an ETag that moves with the tree', async () => {
    const w = await fullRun()
    const res = await w.b.req(LOG, { headers: { accept: 'text/html' } })
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=15')
    const etag = res.headers.get('etag')!
    expect((await w.b.req(LOG, { headers: { 'if-none-match': etag } })).status).toBe(304)
    // a different filter is a different response
    expect((await w.b.req(`${LOG}?filter=all`)).headers.get('etag')).not.toBe(etag)
    await w.run({ type: 'post', actor: site(w.p('lumpy')), input: { node: BREAK, text: 'ghost boxes are back on the list.' } })
    forgetVersions()
    expect((await w.b.req(LOG, { headers: { 'if-none-match': etag } })).status).toBe(200)
  })
})
