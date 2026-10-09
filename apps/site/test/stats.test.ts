// Stats and ranking (go-live 3.7): the pure formulas, then the rollup job on fixed fixtures.
import { describe, expect, it } from 'vitest'
import {
  RANKING,
  byScore,
  firstLine,
  hotMix,
  impact,
  impactBar,
  isHot,
  liveScore,
  lobbyScore,
  people,
  postsPerDay,
  rankingFrom,
  statusLine,
  surge,
  type StatusInput,
} from '../src/core/stats'
import { scheduled } from '../src/jobs'
import { MAX_NODES, rollupSite, rollupStats } from '../src/jobs/stats'
import { getHeaderStats, stripStats } from '../src/web/header-stats'
import { agent, DAY, HOUR, MIN, person, site, T0, World, type P } from './core-fixtures'
import { testDb } from './d1'

const iso = (ms: number) => new Date(ms).toISOString()
const half = (h: number) => Math.pow(0.5, h / 12)

describe('formulas', () => {
  it('live score: counted upvotes in 24h with a 12h half-life, +5 a submission, +20 a pass', () => {
    expect(liveScore({ upvotes: [T0], submissions: [], passes: [] }, T0)).toBe(1)
    expect(liveScore({ upvotes: [T0 - 12 * HOUR], submissions: [], passes: [] }, T0)).toBeCloseTo(0.5, 10)
    expect(liveScore({ upvotes: [T0 - 25 * HOUR, T0 + MIN], submissions: [], passes: [] }, T0)).toBe(0) // outside the window, or not yet
    expect(liveScore({ upvotes: [], submissions: [T0], passes: [T0 - 12 * HOUR] }, T0)).toBeCloseTo(5 + 10, 10)
  })

  it('lobby score: joins in 24h over seats left', () => {
    expect(lobbyScore(2, 2)).toBe(1)
    expect(lobbyScore(1, 8)).toBe(0.125)
    expect(lobbyScore(3, 0)).toBe(3) // never divides by zero
  })

  it('hot: at the floor and twice the 7-day daily average', () => {
    expect(isHot(20, 20)).toBe(true) // a first-day breakthrough
    expect(isHot(19, 19)).toBe(false) // under the floor of 20
    expect(isHot(25, 165)).toBe(false) // 25 < 2 × 165/7: big threads don't stay hot by being big
    expect(isHot(48, 165)).toBe(true)
    expect(isHot(5, 5, { ...RANKING, hot_floor: 5 })).toBe(true)
    expect(surge(30, 70)).toBe(3)
    expect(surge(0, 0)).toBe(0)
  })

  it('impact, posts per day and people', () => {
    expect(impact(33, 6)).toBe(5.5)
    expect(impact(4, 0)).toBe(0)
    expect(impactBar(5.5)).toBe(5)
    expect(impactBar(-1)).toBe(0)
    expect(postsPerDay(14, T0 - 30 * DAY, T0)).toBe(2) // a week's posts over a week
    expect(postsPerDay(6, T0 - 3 * HOUR, T0)).toBe(6) // a young node counts at least one day
    expect(postsPerDay(9, T0 - 3 * DAY, T0)).toBe(3)
    expect(people([1, 2], [2, 3], 1)).toBe(3)
    expect(people([], [], 7)).toBe(1) // the author always
  })

  it('reads the knobs from settings, keeping defaults for anything broken', () => {
    expect(rankingFrom({})).toEqual(RANKING)
    expect(rankingFrom({ hot_floor: 10, hot_mix: 4, ranking: { pass: 30, half_life_hours: 0, window_hours: 'x' } })).toEqual({
      ...RANKING,
      hot_floor: 10,
      hot_mix: 4,
      pass: 30,
    })
  })

  const st = (o: Partial<StatusInput>): string =>
    statusLine({ state: 'live', pinned: null, seatsLeft: 0, deadEndNote: null, submissions: [], branches: { live: 0, closed: 0 }, ...o })

  it('status line: the pinned post first, else recorded state, never the latest post', () => {
    expect(st({ pinned: '\n  where we are: renderer at 61 fps.  \nmore below' })).toBe('where we are: renderer at 61 fps.')
    expect(st({ state: 'lobby', seatsLeft: 29 })).toBe('29 seats from kickoff.')
    expect(st({ state: 'lobby', seatsLeft: 1 })).toBe('1 seat from kickoff.')
    expect(st({})).toBe('no submission yet.')
    expect(st({ branches: { live: 2, closed: 2 } })).toBe('no submission yet · 2 branches closed, 2 live.')
    expect(st({ branches: { live: 1, closed: 0 } })).toBe('no submission yet · 1 branch live.')
    expect(st({ submissions: [{ number: 1, status: 'superseded' }, { number: 2, status: 'in_review' }] })).toBe('submission #2 in review.')
    expect(st({ submissions: [{ number: 1, status: 'failed' }] })).toBe('submission #1 failed.')
    expect(st({ submissions: [{ number: 3, status: 'passed' }] })).toBe('reopened after a repro on submission #3.')
    expect(st({ state: 'closed', submissions: [{ number: 2, status: 'failed' }, { number: 3, status: 'passed' }] })).toBe('passed on submission #3.')
    expect(st({ state: 'dead_end', deadEndNote: "menus can't nest.\nnotes published" })).toBe("menus can't nest.")
    expect(firstLine('x'.repeat(200))).toHaveLength(140)
  })

  it('hot mix: each list by its own rank, about 3 live to 1 lobby', () => {
    const n = (id: number, score: number, created_at = iso(T0)) => ({ id, score, created_at })
    const live = [n(1, 5), n(2, 9), n(3, 1), n(4, 7), n(5, 0)]
    const lobbies = [n(10, 0.5), n(11, 2), n(12, 0.1)]
    expect(hotMix(live, lobbies).map(x => x.id)).toEqual([2, 4, 1, 11, 3, 5, 10, 12])
    expect(hotMix([], lobbies).map(x => x.id)).toEqual([11, 10, 12])
    expect(hotMix(live, [], 2).map(x => x.id)).toEqual([2, 4, 1, 3, 5])
    // ties go to the newer node, then the higher id
    expect([n(1, 1, iso(T0)), n(2, 1, iso(T0 + 1)), n(3, 1, iso(T0 + 1))].sort(byScore).map(x => x.id)).toEqual([3, 2, 1])
  })
})

// ---- the job, on fixed fixtures ----

const seed = (p: P) => ({ ...site(p), via: 'seed' as const })

/** One counted upvote row (or uncounted: the voter isn't established, A6). */
function upvote(w: World, postId: string, voter: P, at: number, counted = 1) {
  w.db.raw.prepare('INSERT INTO upvote (post_id, person_id, counted, created_at) VALUES (?, ?, ?, ?)').run(postId, voter.id, counted, iso(at))
}

async function posts(w: World, by: Parameters<World['post']>[0], node: string, n: number, text = 'progress note.') {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    ids.push((await w.post(by, node, `${text} ${i}`)).id)
    w.tick(5 * MIN)
  }
  return ids
}

/**
 * Six shwarms and two lobbies, all started 8 days before T0 by @myra through the seed:
 *   alpha    live; 6 posts in the last 3h (one by carol's agent); 33 counted upvotes an hour ago   → hot
 *   beta     live; 10 posts 6 days ago; 140 upvotes 2–6 days ago and 25 half an hour ago           → not hot (surge too small)
 *   gamma    live; 3 posts, one pinned; 10 counted upvotes an hour ago                              → under the floor
 *   delta    live; 5 posts; 25 upvotes from accounts that aren't established                       → nothing counts
 *   epsilon  live; its branch got submission #1 an hour ago                                         → +5 bump on both
 *   zeta     dead end
 *   lobby-a  5 seats, 2 joins 2h ago; lobby-b 10 seats, 1 join 2h ago
 */
async function fixture() {
  const w = new World()
  const myra = await person(w.db, 'myra')
  const bob = await person(w.db, 'bob')
  const carol = await person(w.db, 'carol')
  const dave = await person(w.db, 'dave')
  const erin = await person(w.db, 'erin')
  const voters: P[] = []
  for (let i = 0; i < 30; i++) voters.push(await person(w.db, `voter${String(i).padStart(2, '0')}`))
  const newbies: P[] = []
  for (let i = 0; i < 5; i++) newbies.push(await person(w.db, `newbie${i}`, { founding: false, establishedAt: null }))

  w.now = T0 - 8 * DAY
  for (const title of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']) {
    await w.shwarm(seed(myra), { title, lobby: 2 })
    await w.join(site(bob), title)
  }
  await w.shwarm(seed(myra), { title: 'lobby a', lobby: 5 })
  await w.shwarm(seed(myra), { title: 'lobby b', lobby: 10 })
  await w.branch(seed(myra), 'epsilon')

  w.now = T0 - 6 * DAY
  const betaPosts = await posts(w, site(bob), 'beta', 10)

  w.now = T0 - 3 * HOUR
  const alphaPosts = await posts(w, site(bob), 'alpha', 5)
  const carolPost = (await w.post(agent(carol), 'alpha', 'traced the chunk lookup.')).id

  w.now = T0 - 2 * HOUR
  const gammaPosts = await posts(w, site(bob), 'gamma', 2)
  const pin = (await w.post(site(myra), 'gamma', 'where we are: renderer at 61 fps.\nplacement is next.')).id
  w.db.raw.prepare("UPDATE node SET pinned_post_id = ? WHERE path = 'gamma'").run(pin)
  const deltaPosts = await posts(w, site(bob), 'delta', 5)
  await w.join(site(dave), 'lobby-a')
  await w.join(site(erin), 'lobby-a')
  await w.join(site(dave), 'lobby-b')
  await w.run({ type: 'deadEnd', actor: site(myra), input: { node: 'zeta', note: "menus can't nest.\nnotes published." } })

  w.now = T0 - HOUR
  const sub = await w.submit(site(bob), 'epsilon/block-placement')

  // upvotes, at fixed times
  for (let i = 0; i < 30; i++) upvote(w, alphaPosts[i % 5], voters[i], T0 - HOUR)
  for (let i = 0; i < 3; i++) upvote(w, carolPost, voters[i], T0 - HOUR)
  for (let i = 0; i < 2; i++) upvote(w, carolPost, newbies[i], T0 - HOUR, 0)
  for (let k = 0; k < 140; k++) upvote(w, betaPosts[Math.floor(k / 30)], voters[k % 30], T0 - (2 + (k % 5)) * DAY)
  for (let k = 140; k < 165; k++) upvote(w, betaPosts[Math.floor(k / 30)], voters[k % 30], T0 - 30 * MIN)
  for (let i = 0; i < 10; i++) upvote(w, gammaPosts[0], voters[i], T0 - HOUR)
  for (let k = 0; k < 25; k++) upvote(w, deltaPosts[k % 5], newbies[Math.floor(k / 5)], T0 - HOUR, 0)

  w.now = T0
  return { w, myra, bob, carol, dave, voters, newbies, sub, alphaPosts }
}

const stats = (w: World) => {
  const rows = w.all('SELECT n.path, s.* FROM node_stats s JOIN node n ON n.id = s.node_id ORDER BY n.path')
  return Object.fromEntries(rows.map(r => [r.path, r]))
}
const hotTab = (w: World) => {
  const rows = w.all(
    `SELECT n.id, n.path, n.state, n.created_at, s.score FROM node n JOIN node_stats s ON s.node_id = n.id
     WHERE n.kind IN ('shwarm', 'variant') AND n.state IN ('live', 'lobby')`,
  )
  return hotMix(rows.filter(r => r.state === 'live'), rows.filter(r => r.state === 'lobby')).map(r => r.path)
}

describe('stats rollup', () => {
  it('gives the expected impact, hot flag, score and status line for each crafted node', async () => {
    const { w } = await fixture()
    const r = await rollupStats(w.db, T0)
    expect(r.nodes).toBe(9)
    const s = stats(w)

    expect(s.alpha).toMatchObject({ hot: 1, upvotes: 33, posts: 6, impact: 5.5, people: 3, status_line: 'no submission yet.' })
    expect(s.alpha.posts_per_day).toBeCloseTo(6 / 7, 2) // 6 posts this week
    expect(s.alpha.score).toBeCloseTo(33 * half(1), 3)

    expect(s.beta).toMatchObject({ hot: 0, upvotes: 165, posts: 10, impact: 16.5, people: 2 }) // bob's posts are 6 days old: still "people"
    expect(s.beta.posts_per_day).toBeCloseTo(10 / 7, 2)
    expect(s.beta.score).toBeCloseTo(25 * half(0.5), 3) // the old upvotes are outside the window

    expect(s.gamma).toMatchObject({ hot: 0, upvotes: 10, posts: 3, people: 2, status_line: 'where we are: renderer at 61 fps.' })
    expect(s.gamma.impact).toBeCloseTo(3.333, 3)
    expect(s.gamma.score).toBeCloseTo(10 * half(1), 3)

    // 25 upvotes from accounts that aren't established: no impact, no score, not hot
    expect(s.delta).toMatchObject({ hot: 0, upvotes: 0, posts: 5, impact: 0, score: 0 })

    // the branch's submission bumps the branch and its shwarm
    expect(s.epsilon.score).toBeCloseTo(5 * half(1), 3)
    expect(s['epsilon/block-placement'].score).toBeCloseTo(5 * half(1), 3)
    expect(s.epsilon.status_line).toBe('no submission yet · 1 branch live.')
    expect(s['epsilon/block-placement'].status_line).toBe('submission #1 in review.')

    expect(s.zeta).toMatchObject({ score: 0, hot: 0, status_line: "menus can't nest." })
    expect(s['lobby-a']).toMatchObject({ score: 1, people: 3, status_line: '2 seats from kickoff.' })
    expect(s['lobby-b']).toMatchObject({ score: 0.125, people: 2, status_line: '8 seats from kickoff.' })
  })

  it('ranks the hot tab: live by score and lobbies by closeness, 3 to 1, no dead ends', async () => {
    const { w } = await fixture()
    await rollupStats(w.db, T0)
    expect(hotTab(w)).toEqual(['alpha', 'beta', 'gamma', 'lobby-a', 'epsilon', 'delta', 'lobby-b'])
  })

  it('rolls agents up to their human and counts only established upvotes per person', async () => {
    const { w, bob, carol } = await fixture()
    await rollupStats(w.db, T0)
    const rows = w.all(
      `SELECT person_id, posts, upvotes FROM person_node_stats WHERE node_id = (SELECT id FROM node WHERE path = 'alpha') ORDER BY person_id`,
    )
    expect(rows).toEqual([
      { person_id: bob.id, posts: 5, upvotes: 30 },
      { person_id: carol.id, posts: 1, upvotes: 3 }, // carol's agent posted; 2 more upvotes came from new accounts
    ])
    expect(JSON.stringify(w.all('SELECT * FROM node_stats'))).not.toMatch(/m-04|agent/)
  })

  it('counts an upvote once its account is established, and not before', async () => {
    const { w, newbies } = await fixture()
    await rollupStats(w.db, T0)
    expect(stats(w).delta).toMatchObject({ upvotes: 0, hot: 0 })
    // the same people, a week later and established: their new upvotes count (old rows keep counted = 0)
    const deltaPost = w.get("SELECT id FROM post WHERE node_id = (SELECT id FROM node WHERE path = 'delta') ORDER BY created_at LIMIT 1").id
    const fresh: P[] = []
    for (let i = 0; i < 20; i++) fresh.push(await person(w.db, `regular${i}`))
    for (const p of fresh) upvote(w, deltaPost, p, T0 + 10 * MIN)
    w.now = T0 + 15 * MIN
    await w.post(site(newbies[0]), 'delta', 'thanks, all.') // any write marks the node changed
    await rollupStats(w.db, T0 + 15 * MIN)
    expect(stats(w).delta).toMatchObject({ upvotes: 20, hot: 1, posts: 6 })
  })

  it('gives the same rows when run again, and reads nothing new when nothing changed', async () => {
    const { w } = await fixture()
    await rollupStats(w.db, T0)
    const a = { n: w.all('SELECT * FROM node_stats ORDER BY node_id'), p: w.all('SELECT * FROM person_node_stats ORDER BY node_id, person_id') }
    expect(await rollupStats(w.db, T0)).toMatchObject({ nodes: 0 })
    w.db.raw.prepare("DELETE FROM meta WHERE key = 'stats_cursor'").run() // forget the cursor: every node again
    expect(await rollupStats(w.db, T0)).toMatchObject({ nodes: 9 })
    expect({ n: w.all('SELECT * FROM node_stats ORDER BY node_id'), p: w.all('SELECT * FROM person_node_stats ORDER BY node_id, person_id') }).toEqual(a)
  })

  it('rolls up only changed nodes and their ancestors', async () => {
    const { w, bob, myra, sub } = await fixture()
    await rollupStats(w.db, T0)
    w.now = T0 + MIN
    await w.post(site(bob), 'gamma', 'one more.')
    expect(await rollupStats(w.db, T0 + 5 * MIN)).toMatchObject({ nodes: 1, changed: 1, warm: 0 })
    expect(stats(w).gamma.posts).toBe(4)

    // the branch passes: the branch and its shwarm are rolled up, and the shwarm gets the +20 bump
    w.now = T0 + 6 * MIN
    await w.pass(site(myra), 'epsilon/block-placement', sub.id, { text: 'placed 200 times per corner. no failures.' })
    expect(await rollupStats(w.db, T0 + 10 * MIN)).toMatchObject({ nodes: 2, changed: 2 })
    const s = stats(w)
    expect(s.epsilon.status_line).toBe('no submission yet · 1 branch closed.')
    expect(s.epsilon.score).toBeCloseTo(5 * half(70 / 60) + 20 * half(4 / 60), 3)
    expect(s['epsilon/block-placement']).toMatchObject({ score: 0, status_line: 'passed on submission #1.' })
  })

  it('lets warm nodes decay hourly, then cool off and cost nothing', async () => {
    const { w } = await fixture()
    await rollupStats(w.db, T0)
    expect(await rollupStats(w.db, T0 + 30 * MIN)).toMatchObject({ nodes: 0 }) // not stale yet
    const r = await rollupStats(w.db, T0 + 61 * MIN)
    expect(r.warm).toBeGreaterThan(0)
    expect(stats(w).alpha.score).toBeCloseTo(33 * half(2 + 1 / 60), 3)

    // a day later the scores and hot flags are gone; a week later posts per day too, and nothing is warm
    await rollupStats(w.db, T0 + 25 * HOUR)
    expect(stats(w).alpha).toMatchObject({ score: 0, hot: 0 })
    await rollupStats(w.db, T0 + 8 * DAY)
    expect(w.all('SELECT * FROM node_stats WHERE score > 0 OR hot = 1 OR posts_per_day > 0')).toEqual([])
    expect(await rollupStats(w.db, T0 + 8 * DAY + 2 * HOUR)).toMatchObject({ nodes: 0 })
    expect(stats(w).alpha).toMatchObject({ upvotes: 33, posts: 6, impact: 5.5 }) // all-time totals stay
  })

  it('takes a backlog over several runs without skipping any', async () => {
    const w = new World()
    const myra = await person(w.db, 'myra')
    const total = MAX_NODES + 20
    // nodes made straight in SQL, all changed at the same moment
    const insert = w.db.raw.prepare(
      `INSERT INTO node (path, slug, kind, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, created_at, changed_at)
       VALUES (?, ?, 'shwarm', ?, 'w', 'd', '{"author":true}', 2, 'MIT + CC-BY-4.0', ?, '@myra', 'lobby', ?, ?)`,
    )
    for (let i = 0; i < total; i++) insert.run(`n${i}`, `n${i}`, `n${i}`, myra.id, iso(T0), iso(T0))
    expect(await rollupStats(w.db, T0 + MIN)).toMatchObject({ nodes: MAX_NODES })
    expect(await rollupStats(w.db, T0 + 6 * MIN)).toMatchObject({ nodes: 20 })
    expect(w.get('SELECT COUNT(*) AS n FROM node_stats').n).toBe(total)
    expect(await rollupStats(w.db, T0 + 11 * MIN)).toMatchObject({ nodes: 0 })
  })

  it('works on an empty database', async () => {
    const db = testDb()
    expect(await rollupStats(db, T0, { site: true })).toEqual({ nodes: 0, changed: 0, warm: 0, person_rows: 0, site: true })
    expect(db.raw.prepare('SELECT * FROM site_stats_daily').all().map((r: any) => ({ ...r }))).toEqual([
      { day: '2026-10-08', shwarms: 0, people: 0, posts: 0, d1_rows_read: 0, d1_rows_written: 0, emails_sent: 0, triage_calls: 0 },
    ])
    expect(await getHeaderStats(db)).toEqual({ day: '2026-10-08', people: 0, posts: 0, shwarms: 0 })
  })
})

describe('header counters', () => {
  async function small() {
    const w = new World()
    const myra = await person(w.db, 'myra')
    const bob = await person(w.db, 'bob')
    const carol = await person(w.db, 'carol')
    const dave = await person(w.db, 'dave')
    w.now = T0 - 2 * DAY
    await w.shwarm(seed(myra), { title: 'alpha', lobby: 3 })
    await w.post(site(myra), 'alpha', 'two days ago.')
    w.now = T0 - 20 * HOUR // yesterday, but inside the last 24h
    await w.post(site(bob), 'alpha', 'last night.')
    w.now = T0 - 2 * HOUR
    const p = (await w.post(agent(carol), 'alpha', 'this morning.')).id
    await w.join(site(dave), 'alpha')
    upvote(w, p, bob, T0 - HOUR)
    w.now = T0
    return { w, myra }
  }

  it('counts posts today and people active in the last 24 hours, never agents', async () => {
    const { w } = await small()
    await rollupSite(w.db, T0)
    // posts on oct 8: carol's agent's; people in 24h: bob (posted, upvoted), carol (her agent posted), dave (joined)
    expect(await getHeaderStats(w.db)).toEqual({ day: '2026-10-08', people: 3, posts: 1, shwarms: 1 })
  })

  it('finishes yesterday at the first run after midnight', async () => {
    const { w } = await small()
    const midnight = Date.parse('2026-10-09T00:00:00Z')
    await rollupSite(w.db, midnight)
    const rows = w.all('SELECT day, people, posts FROM site_stats_daily ORDER BY day')
    expect(rows).toEqual([
      { day: '2026-10-08', people: 3, posts: 1 }, // bob's post was on oct 7; his upvote keeps him in the 24 hours
      { day: '2026-10-09', people: 3, posts: 0 },
    ])
  })

  it('stay hidden unless stats_on, or an admin previews them with ?stats', async () => {
    const { w } = await small()
    await rollupSite(w.db, T0)
    const url = 'https://shwarm.org/'
    expect(await stripStats(w.db, null, url)).toBeNull()
    expect(await stripStats(w.db, { is_admin: 0 }, url + '?stats')).toBeNull()
    expect(await stripStats(w.db, { is_admin: 1 }, url)).toBeNull()
    expect(await stripStats(w.db, { is_admin: 1 }, url + '?stats')).toEqual({ people: '3', posts: '1' })
    w.db.raw.prepare("UPDATE setting SET value = 'true' WHERE key = 'stats_on'").run()
    w.db.raw.prepare("UPDATE site_stats_daily SET people = 2418, posts = 3904").run()
    expect(await stripStats(w.db, null, url)).toEqual({ people: '2,418', posts: '3,904' })
  })
})

describe('cron', () => {
  async function fire(db: D1Database, at: string) {
    const waits: Promise<unknown>[] = []
    await scheduled({ scheduledTime: Date.parse(at), cron: '* * * * *', noRetry() {} } as ScheduledController, { DB: db, ENV: 'test', SITE_URL: 'https://shwarm.org' }, {
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      passThroughOnException() {},
    } as unknown as ExecutionContext)
    await Promise.all(waits)
  }
  const cursor = (db: any) => db.raw.prepare("SELECT value FROM meta WHERE key = 'stats_cursor'").get()

  it('runs the rollup every 5 minutes and the header counters on the hour', async () => {
    const db = testDb()
    await fire(db, '2026-10-08T12:03:00Z')
    expect(cursor(db)).toBeUndefined()
    await fire(db, '2026-10-08T12:05:00Z')
    expect(cursor(db)).toBeDefined()
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM site_stats_daily').get().n).toBe(0)
    await fire(db, '2026-10-08T13:00:00Z')
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM site_stats_daily').get().n).toBeGreaterThan(0)
  })
})
