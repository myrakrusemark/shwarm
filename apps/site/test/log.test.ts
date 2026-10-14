// Go-live 5.7: GET /w/<path>/log, the audit log as JSON. A full core run (the example's branch and checks, its #2 passing
// its checks while the branch stays live; a sub-branch's failed people check and another's dead-end vote; the shwarm's
// first submission failed by its author, then its pass with the author's sign-off; a dead end, on the other launch
// shwarm, since only a shwarm ends, decided Oct 13) and every event of it in the logs, newest first, each linked to
// evidence that's really there. Key events, paging with ?before, hidden branches and submissions left out, and the seeded
// row first on a seeded shwarm.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_EVENTS, KEY_EVENTS } from '../src/core/audit'
import { readChain } from '../src/read/node'
import { readLog, type LogPage, type LogRow } from '../src/read/log'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { agent, SHA, site, stepped } from './core-fixtures'
import { T0 } from './d1'
import { body, Browser, fakeFetch, ORIGIN, testEnv } from './browser'
import { PLAIN } from './node-fixture'
import { branchPassesItsChecks, closedWorld, RECORDING } from './result-fixture'

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
const PLAIN_LOG = `/w/${PLAIN}/log`
const MONSTERS = `${EXAMPLE_BRANCH}/monster-collision`
const BREAK = `${EXAMPLE_BRANCH}/break-blocks`
const TEXTURES = `${EXAMPLE_BRANCH}/texture-pack`

type Ev = { id: string | null; at: string; event: string; node: string; by: string | null; submission?: string; number?: number; detail: string; evidence: string; key: boolean }
type NodeLog = { node: string; filter: string; total: number; next: string | null; events: Ev[] }

/**
 * The closed world, plus the rest of a run. Before the shwarm passes, which locks its branches with it (OPEN #92): its
 * author fails its first submission; three sub-branches open under block placement (one fails a people check, its crew
 * votes another a dead end, the third is still being checked); and block placement's #2 passes its checks and stays live
 * (decided Oct 13). After: the other launch shwarm becomes a dead end. Only a shwarm ends now, and this one passed.
 */
async function fullRun() {
  const w = await closedWorld({
    before: async acts => {
      const { run, p, db } = acts
      // the shwarm's first try: its run and its human check pass, then its author fails it, and every check starts over
      const first = await run<{ id: string; hash: string }>({
        type: 'submit',
        actor: agent(p('finn_irl'), 'f-11'),
        input: {
          node: EXAMPLE_ROOT,
          text: 'v0.9: the nine maps rebuilt from blocks, 12 recipes, 4 new monsters.',
          links: [{ url: 'https://zenodo.org/records/17346200/files/mcdoom-v0.9.pk3', sha256: SHA('9e') }],
          howToCheck: 'run ./bench.sh, then play e1m1 and e1m3 from a pistol start.',
        },
      })
      await run({
        type: 'check',
        actor: site(p('lumpy')),
        input: { node: EXAMPLE_ROOT, on: first.id, slot: 'run', submissionHash: first.hash.slice(0, 7), scriptHash: '5d02b7e', exit: 0, log: 'bench.sh: min 60 fps\nexit 0', env: 'linux, ryzen 5 3600, gtx 1660' },
      })
      await run({ type: 'check', actor: site(p('marceline')), input: { node: EXAMPLE_ROOT, on: first.id, verdict: 'pass', evidence: [RECORDING] } })
      await run({ type: 'check', actor: stepped(p('myra')), input: { node: EXAMPLE_ROOT, on: first.id, slot: 'author', verdict: 'fail', repro: "e1m3: the exploding imp is doom's imp, recolored, not drawn fresh." } })
      // three sub-branches, with people checks: a branch has no author check (decided Oct 13). Two are cleared; texture
      // pack is still being checked
      const branch = (who: string, title: string, check: unknown) =>
        run({ type: 'createNode', actor: site(p(who)), input: { kind: 'branch', parent: EXAMPLE_BRANCH, title, what: `${title}.`, doneWhen: `${title} works.`, check } })
      await branch('bmo_fan', 'break blocks', { people: { count: 1 } })
      await branch('finn_irl', 'monster collision', { people: { count: 1 } })
      await branch('lumpy', 'texture pack', { people: { count: 1 } })
      db.raw.prepare('UPDATE node SET triage = ? WHERE path IN (?, ?)').run('clear', BREAK, MONSTERS)
      // break blocks: its author's people check fails the submission with a repro, and it stays in review
      const brk = await run<{ id: string }>({
        type: 'submit',
        actor: agent(p('kestrel'), 'swarm/r-11'),
        input: { node: BREAK, text: 'breaking updates within one frame.', links: [{ url: 'https://codeberg.org/kestrel/mcdoom/break.diff', sha256: SHA('b1') }], howToCheck: 'break 100 blocks.' },
      })
      await run({ type: 'check', actor: site(p('bmo_fan')), input: { node: BREAK, on: brk.id, verdict: 'fail', repro: 'broken blocks leave a ghost collision box.' } })
      // monster collision: a branch doesn't end, so nobody marks it a dead end; its crew votes dead_end on its status,
      // which is no event, and it stays open (decided Oct 13)
      await run({ type: 'post', actor: site(p('finn_irl')), input: { node: MONSTERS, text: 'the blockmap is built once per level; an incremental update needs engine changes.' } })
      await run({ type: 'status', actor: site(p('finn_irl')), input: { node: MONSTERS, status: 'dead_end' } })
      // then block placement's #2 passes its checks, and the branch stays live
      await branchPassesItsChecks(acts)
    },
  })
  // the other launch shwarm: its author marks it a dead end
  await w.run({ type: 'deadEnd', actor: stepped(w.p('myra')), input: { node: PLAIN, note: 'no bot got past map 3 on the allowed buffers alone. what we tried is in the thread.' } })
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
    // every event type still written happened ('lobby_filled' went with the lobby, Oct 9; nothing reopens), and the seeded
    // row (A18) closes the log. All but the dead end: only a shwarm ends (decided Oct 13) and this one passed, so the dead
    // end is the other launch shwarm's, in its own log, before its seeded row
    expect(new Set(events.map(e => e.event))).toEqual(new Set([...AUDIT_EVENTS.filter(e => e !== 'lobby_filled' && e !== 'reopened' && e !== 'dead_end'), 'seeded']))
    const ended = (await w.all(`${PLAIN_LOG}?filter=all`)).events
    expect(ended.map(e => [e.id, e.event])).toEqual([...w.stored([PLAIN]).map(e => [e.id, e.event]), [null, 'seeded']])
    expect(ended[0]).toMatchObject({ node: PLAIN, event: 'dead_end', by: '@myra', key: true })
    expect(events.at(-1)).toEqual({ id: null, at: expect.any(String), event: 'seeded', node: EXAMPLE_ROOT, by: '@myra', detail: 'seeded by @myra at launch', evidence: `${ORIGIN}/w/${EXAMPLE_ROOT}`, key: true })
    // the shape: each row names its node; the submission and its number when there is one. The shwarm passed on #2
    const passed = events.find(e => e.event === 'passed' && e.node === EXAMPLE_ROOT)!
    const at = (s: { number: number; hash: string }) => `#${s.number} (${s.hash.slice(0, 7)})`
    expect(passed).toMatchObject({ by: null, number: 2, submission: w.sub.id, detail: `${at(w.sub)} passed`, evidence: `${ORIGIN}/w/${EXAMPLE_ROOT}/s/2`, key: true })
    // the author's fail was the shwarm's, on its first submission
    expect(events.find(e => e.event === 'failed')).toMatchObject({ node: EXAMPLE_ROOT, by: null, number: 1, detail: 'the author failed submission #1. every check on the done test starts over', key: false })
    // a branch's submission that passes its checks is a pass in its own words, and the branch stays live (decided Oct 13)
    const two = w.get("SELECT s.post_id, s.number, s.hash FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.status = 'passed'", EXAMPLE_BRANCH)
    expect(events.find(e => e.event === 'passed' && e.node === EXAMPLE_BRANCH)).toMatchObject({
      by: null,
      number: 2,
      submission: two.post_id,
      detail: `${at(two)} passed its checks`,
      evidence: `${ORIGIN}/w/${EXAMPLE_BRANCH}/s/2`,
      key: true,
    })
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

  it('shows the key events by default: branch openings, submissions, passes, dead ends (decided Oct 9)', async () => {
    const w = await fullRun()
    const page = await w.json(LOG)
    expect(page.filter).toBe('key')
    expect(KEY_EVENTS).toEqual(['branch_opened', 'submission', 'passed', 'dead_end'])
    const want = w.stored(TREE).filter(e => (KEY_EVENTS as readonly string[]).includes(e.event))
    expect(page.events.map(e => e.id)).toEqual([...want.map(e => e.id), null])
    expect(page.total).toBe(want.length + 1)
    expect(page.events.every(e => e.key)).toBe(true)
    // each of the four happened, and the seeded row (A18) still closes each log (OPEN #66). The shwarm's pass and the
    // branch's, by its checks, are both key; a dead end ends only a shwarm (decided Oct 13), so it's the other launch shwarm's
    expect(new Set(page.events.map(e => e.event))).toEqual(new Set(['branch_opened', 'submission', 'passed', 'seeded']))
    expect(page.events.filter(e => e.event === 'passed').map(e => e.node)).toEqual([EXAMPLE_ROOT, EXAMPLE_BRANCH])
    expect((await w.json(PLAIN_LOG)).events.map(e => [e.event, e.key])).toEqual([
      ['dead_end', true],
      ['seeded', true],
    ])
    // checks, sign-offs and fails are in the full log only, marked as not key
    const full = (await w.all(`${LOG}?filter=all`)).events
    for (const ev of ['check', 'signed_off', 'failed']) expect(full.filter(e => e.event === ev).map(e => e.key), ev).toContain(false)
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
    // monster collision shows its opening, and only that: its crew's dead-end vote is no event (decided Oct 13)
    expect(events.filter(e => e.node === MONSTERS).map(e => e.event)).toEqual(['branch_opened'])
    w.db.raw.prepare('UPDATE node SET hidden = 1 WHERE path = ?').run(MONSTERS)
    forgetVersions()
    events = (await w.all(`${LOG}?filter=all`)).events
    expect(events.some(e => e.node === MONSTERS)).toBe(false)
    expect(events.at(-1)!.event).toBe('seeded')
    // a hidden submission takes its rows with it: submitted, and its failing check
    const brk = w.get("SELECT s.post_id FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ?", BREAK).post_id
    expect(events.filter(e => e.submission === brk).map(e => e.event).sort()).toEqual(['check', 'submission'])
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
    // the tree is locked once the shwarm passed (OPEN #92), but an upvote on a branch's post still counts
    const brk = w.get('SELECT s.post_id FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ?', BREAK).post_id
    await w.run({ type: 'upvote', actor: site(w.p('lumpy')), input: { node: BREAK, post: brk } })
    forgetVersions()
    expect((await w.b.req(LOG, { headers: { 'if-none-match': etag } })).status).toBe(200)
  })
})
