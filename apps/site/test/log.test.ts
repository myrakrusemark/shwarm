// Go-live 5.7: GET /w/<path>/log, the audit log as JSON. A full run, as the one model has it (decided Oct 14): the
// shwarm's submission from before Oct 14 with its run and people check, and block placement's that passed its checks,
// both as history; the shwarm passed by its people, then by its author's mark; sub-branches with claims, which are no
// events, one of which becomes a dead end by its people's backing; and the other launch shwarm a dead end the same way.
// Every event of it in the logs, newest first, each linked to evidence that's really there. Key events, paging with
// ?before, hidden branches and submissions left out, and the seeded row first on a seeded shwarm.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_EVENTS, KEY_EVENTS } from '../src/core/audit'
import { readChain } from '../src/read/node'
import { readLog, STATUS_EVENT, type LogPage, type LogRow } from '../src/read/log'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { agent, HOUR, site } from './core-fixtures'
import { body, Browser, fakeFetch, ORIGIN, testEnv } from './browser'
import { PLAIN } from './node-fixture'
import { oldBranchPass, passedWorld, READ_AT } from './pass-fixture'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(READ_AT)
  resetReadLimit()
  forgetVersions()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const LOG = `/w/${EXAMPLE_ROOT}/log`
const PLAIN_LOG = `/w/${PLAIN}/log`
const MONSTERS = `${EXAMPLE_BRANCH}/monster-collision`
const BREAK = `${EXAMPLE_BRANCH}/break-blocks`
const TEXTURES = `${EXAMPLE_BRANCH}/texture-pack`

type Ev = { id: string | null; at: string; event: string; node: string; by: string | null; submission?: string; number?: number; detail: string; evidence: string; key: boolean }
type NodeLog = { node: string; filter: string; total: number; next: string | null; events: Ev[] }

/**
 * The passed world, plus the rest of a run: three sub-branches open under block placement (one gets a blocked claim;
 * another a dead-end claim its people back, so 25 hours on it is a dead end; the third is still being checked), block
 * placement keeps the submission it passed before Oct 14 (history), and the other launch shwarm becomes a dead end by
 * its people's backing too.
 */
async function fullRun() {
  const w = await passedWorld()
  const { run, p, db } = w
  // three sub-branches, with no checks (decided Oct 14). Two are cleared; texture pack is still being checked
  const branch = (who: string, title: string) =>
    run({ type: 'createNode', actor: site(p(who)), input: { kind: 'branch', parent: EXAMPLE_BRANCH, title, what: `${title}.`, doneWhen: `${title} works.` } })
  await branch('bmo_fan', 'break blocks')
  await branch('finn_irl', 'monster collision')
  await branch('lumpy', 'texture pack')
  db.raw.prepare('UPDATE node SET triage = ? WHERE path IN (?, ?)').run('clear', BREAK, MONSTERS)
  // break blocks: an agent's post, and its author's blocked claim
  await run({ type: 'post', actor: agent(p('kestrel'), 'swarm/r-11'), input: { node: BREAK, text: 'breaking updates within one frame.' } })
  await run({ type: 'join', actor: site(p('bmo_fan')), input: { node: BREAK } })
  await run({ type: 'post', actor: site(p('bmo_fan')), input: { node: BREAK, text: 'broken blocks leave a ghost collision box.', claim: 'blocked' } })
  // monster collision: its crew's dead-end claim, backed by two more over nobody on track
  const deadEnd = async (node: string, by: string, text: string, backers: string[]) => {
    for (const who of [by, ...backers]) await run({ type: 'join', actor: site(p(who)), input: { node } })
    const c = await run<{ id: string }>({ type: 'post', actor: site(p(by)), input: { node, text, claim: 'dead_end' } })
    for (const who of backers) await run({ type: 'back', actor: site(p(who)), input: { node, post: c.id, on: true } })
  }
  await deadEnd(MONSTERS, 'finn_irl', 'the blockmap is built once per level; an incremental update needs engine changes.', ['lumpy', 'gunter'])
  // and block placement's submission that passed its checks before Oct 14
  oldBranchPass(w.acts)
  // the other launch shwarm: its people claim a dead end and back it
  await deadEnd(PLAIN, 'lumpy', 'no bot got past map 3 on the allowed buffers alone. what we tried is in the thread.', ['marceline', 'gunter'])
  // 25 hours on, an on-track vote on each saves its change to dead end
  w.clock.now += 25 * HOUR
  for (const node of [MONSTERS, PLAIN]) {
    await run({ type: 'join', actor: site(p('kestrel')), input: { node } })
    await run({ type: 'status', actor: site(p('kestrel')), input: { node, status: 'on_track' } })
  }
  const get = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).get(...args) as any
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
  /** The stored events of these nodes, newest first, as the log orders them: audit rows, and status changes not to passed. */
  const stored = (paths: string[]) => {
    const ins = paths.map(() => '?').join(', ')
    return w.db.raw
      .prepare(
        `SELECT id, event FROM (
           SELECT a.id, a.event, a.at, 0 AS src, a.rowid AS rid FROM audit_event a JOIN node n ON n.id = a.node_id WHERE n.path IN (${ins})
           UNION ALL
           SELECT h.id, 'status', h.at, 1, h.rowid FROM status_change h JOIN node n ON n.id = h.node_id WHERE n.path IN (${ins}) AND h.to_status <> 'passed')
         ORDER BY at DESC, src DESC, rid DESC`,
      )
      .all(...paths, ...paths) as { id: string; event: string }[]
  }
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
    // the events of a run since Oct 14, and the history from before: no lobby (Oct 9), no fails, sign-offs or reopens
    // (Oct 14). The seeded row (A18) closes the log. The other launch shwarm's dead end is in its own log
    expect(new Set(events.map(e => e.event))).toEqual(new Set(['branch_opened', 'submission', 'check', 'passed', STATUS_EVENT, 'seeded']))
    expect(AUDIT_EVENTS).toEqual(expect.arrayContaining(['branch_opened', 'submission', 'check', 'passed']))
    const ended = (await w.all(`${PLAIN_LOG}?filter=all`)).events
    expect(ended.map(e => [e.id, e.event])).toEqual([...w.stored([PLAIN]).map(e => [e.id, e.event]), [null, 'seeded']])
    expect(ended[0]).toMatchObject({ node: PLAIN, event: STATUS_EVENT, by: null, detail: 'on track → dead end · 3 to 0', key: true })
    expect(events.at(-1)).toEqual({ id: null, at: expect.any(String), event: 'seeded', node: EXAMPLE_ROOT, by: '@myra', detail: 'seeded by @myra at launch', evidence: `${ORIGIN}/w/${EXAMPLE_ROOT}`, key: true })
    // the shwarm passed twice over: its people's pass, citing the claim, naming no one; then its author's mark
    const passes = events.filter(e => e.event === 'passed' && e.node === EXAMPLE_ROOT)
    expect(passes).toEqual([
      expect.objectContaining({ by: '@myra', detail: 'the author marks it passed', evidence: `${ORIGIN}/w/${EXAMPLE_ROOT}#${w.claim}`, key: true }),
      expect.objectContaining({ by: null, detail: 'backed by 5 to 1', evidence: `${ORIGIN}/w/${EXAMPLE_ROOT}#${w.claim}`, key: true }),
    ])
    expect(passes.some(e => 'submission' in e)).toBe(false)
    // monster collision became a dead end by its people's backing: a status row, citing their claim
    const claim = w.get("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.claim = 'dead_end'", MONSTERS).id
    expect(events.filter(e => e.event === STATUS_EVENT)).toEqual([
      expect.objectContaining({ node: MONSTERS, by: null, detail: 'on track → dead end · 3 to 0', evidence: `${ORIGIN}/w/${MONSTERS}#${claim}`, key: true }),
    ])
    // the shwarm's submission from before Oct 14, with its run and people check, and block placement's old pass in its own words
    const at = (s: { number: number; hash: string }) => `#${s.number} (${s.hash.slice(0, 7)})`
    expect(events.filter(e => e.submission === w.old.id).map(e => e.event)).toEqual(['check', 'check', 'submission'])
    const old = w.get("SELECT s.post_id, s.number, s.hash FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.status = 'passed'", EXAMPLE_BRANCH)
    expect(events.find(e => e.event === 'passed' && e.node === EXAMPLE_BRANCH)).toMatchObject({
      by: null,
      number: 1,
      submission: old.post_id,
      detail: `${at(old)} passed its checks`,
      evidence: `${ORIGIN}/w/${EXAMPLE_BRANCH}/s/1`,
      key: true,
    })
    // claims are no events; only a change of status is
    expect(events.filter(e => e.node === BREAK || e.node === MONSTERS).map(e => e.event)).toEqual([STATUS_EVENT, 'branch_opened', 'branch_opened'])
    expect(w.get('SELECT state FROM node WHERE path = ?', EXAMPLE_BRANCH).state).toBe('live')
    expect(events.find(e => e.event === 'branch_opened')).not.toHaveProperty('submission')
    // every row links to its evidence, and the page it links to has the anchor
    for (const e of [...events, ...ended]) {
      expect(e.evidence.startsWith(`${ORIGIN}/w/`), e.event).toBe(true)
      const [path, anchor] = e.evidence.slice(ORIGIN.length).split('#')
      const res = await w.b.req(path, { headers: { accept: 'text/html' } })
      expect(res.status, e.evidence).toBe(200)
      if (anchor) expect(await body(res), e.evidence).toContain(`id="${anchor}"`)
    }
  })

  it('shows the key events by default: branch openings, submissions, passes, dead ends and every change of status (decided Oct 9, Oct 14)', async () => {
    const w = await fullRun()
    const page = await w.json(LOG)
    expect(page.filter).toBe('key')
    expect(KEY_EVENTS).toEqual(['branch_opened', 'submission', 'passed', 'dead_end'])
    const want = w.stored(TREE).filter(e => (KEY_EVENTS as readonly string[]).includes(e.event) || e.event === STATUS_EVENT)
    expect(page.events.map(e => e.id)).toEqual([...want.map(e => e.id), null])
    expect(page.total).toBe(want.length + 1)
    expect(page.events.every(e => e.key)).toBe(true)
    // the seeded row (A18) still closes each log (OPEN #66). The shwarm's two passes and the branch's old one, by its
    // checks, are all key; so is each change of status, here a dead end by backing (no author marks a dead end since Oct 14)
    expect(new Set(page.events.map(e => e.event))).toEqual(new Set(['branch_opened', 'submission', 'passed', STATUS_EVENT, 'seeded']))
    expect(page.events.filter(e => e.event === 'passed').map(e => e.node)).toEqual([EXAMPLE_ROOT, EXAMPLE_ROOT, EXAMPLE_BRANCH])
    expect((await w.json(PLAIN_LOG)).events.map(e => [e.event, e.key])).toEqual([
      [STATUS_EVENT, true],
      ['seeded', true],
    ])
    // the old checks are in the full log only, marked as not key
    const full = (await w.all(`${LOG}?filter=all`)).events
    expect(full.filter(e => e.event === 'check').map(e => e.key)).toEqual([false, false])
    expect(full.filter(e => !e.key).every(e => !(KEY_EVENTS as readonly string[]).includes(e.event))).toBe(true)
    // ?filter=key says so; ?filter=milestones, its name before Oct 9, still answers, as key
    expect(await w.json(`${LOG}?filter=key`)).toEqual(page)
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
    // a newline or a character a header can't carry is a 400 too, not a 500 from the ETag
    for (const bad of ['nope', 'e_zzzzzzzzzz', '', '%0Ax', '%0D%00', '%E2%98%83', ...(other ? [other.id] : [])]) {
      const res = await w.b.req(`${LOG}?before=${bad}`)
      expect(res.status, bad).toBe(400)
      expect(JSON.parse(await body(res))).toMatchObject({ error: 'bad_request', message: 'before is not an event in this log' })
    }
    const res = await w.b.req(`${LOG}?filter=everything`)
    expect(res.status).toBe(400)
    expect(JSON.parse(await body(res))).toMatchObject({ error: 'bad_request', message: 'filter is key or all' })
  })

  it('leaves out branches the public cannot see, and rows of a hidden submission', async () => {
    const w = await fullRun()
    let events = (await w.all(`${LOG}?filter=all`)).events
    // texture pack is still being checked: its opening isn't in the log
    expect(events.some(e => e.node === TEXTURES)).toBe(false)
    // monster collision shows its opening and its change to dead end; its crew's claim is no event of its own
    expect(events.filter(e => e.node === MONSTERS).map(e => e.event)).toEqual([STATUS_EVENT, 'branch_opened'])
    w.db.raw.prepare('UPDATE node SET hidden = 1 WHERE path = ?').run(MONSTERS)
    forgetVersions()
    events = (await w.all(`${LOG}?filter=all`)).events
    expect(events.some(e => e.node === MONSTERS)).toBe(false)
    expect(events.at(-1)!.event).toBe('seeded')
    // a hidden submission takes its rows with it: the shwarm's #1 from before Oct 14, with its run and its people check
    const one = w.old.id
    expect(events.filter(e => e.submission === one).map(e => e.event).sort()).toEqual(['check', 'check', 'submission'])
    w.db.raw.prepare('UPDATE post SET hidden = 1 WHERE id = ?').run(one)
    forgetVersions()
    const after = await w.all(`${LOG}?filter=all`)
    expect(after.events.some(e => e.submission === one)).toBe(false)
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
    // nothing locks after a pass (decided Oct 14): an upvote on a branch's post counts, and moves it
    const post = w.get("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.claim IS NULL AND p.kind = 'post'", BREAK).id
    await w.run({ type: 'upvote', actor: site(w.p('lumpy')), input: { node: BREAK, post } })
    forgetVersions()
    expect((await w.b.req(LOG, { headers: { 'if-none-match': etag } })).status).toBe(200)
  })
})
