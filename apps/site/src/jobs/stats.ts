// The stats and ranking rollup (go-live 3.7), run by its own cron trigger every 5 minutes (jobs/index.ts), so it
// never shares an invocation, or its CPU time, with the mail sweep.
//
// Which nodes it rolls up, so a quiet site costs almost nothing:
//   changed  nodes whose changed_at (set by every write through touchNode) is newer than the last run, plus their
//            ancestors, since a branch's submission or pass moves its parent's status line and score
//   stale    nodes whose numbers move with time alone, once their stale_at comes: an upvote, bump or join leaving
//            its window, the hot flag able to flip, or the hourly refresh of a decaying score and posts per day
//            (spread over a half hour by node id, so nodes rolled up together don't go stale together)
// Each node is rolled up whole from its own rows, so reruns give the same answer. The reads are a fixed handful of
// set-based queries per chunk, aggregated in SQL so each node returns a few rows whatever its upvote count (D1 caps
// queries per invocation, and the free plan's CPU limit is small). Each chunk's writes are one batch, with the
// cursor of the changed nodes it covers, so a run cut short keeps what it finished.
// The header counters (site_stats_daily) are counted once an hour, apart from the node rollup.
//
// Upvotes count only when counted = 1 (A6, established accounts). Agents are never counted: posts and upvotes
// roll up to the human under the name, and "people" is people.
import { readSettings } from '../core/settings'
import {
  DAY_MS,
  HOUR_MS,
  WEEK_MS,
  impact,
  isHot,
  liveScoreFrom,
  lobbyScore,
  postsPerDay,
  rankingFrom,
  statusLine,
  surge,
  type Ranking,
  type StatusInput,
} from '../core/stats'

// Per run; more waits for the next run (changed first, then the stalest). The JS per node is small now that SQL
// does the counting; measure CPU per run on staging before raising it.
export const MAX_NODES = 250
export const CHUNK = 125 // nodes per batch; MAX_NODES / CHUNK chunks keep a run's D1 queries well under the cap
export const WARM_EVERY_MS = HOUR_MS // a decaying score or posts per day with no new activity is refreshed about this often
const SLACK_MS = 2 * 60_000 // a write stamped just before the last run but committed after it is still picked up
const CURSOR = 'stats_cursor' // in the meta table: where the next run starts reading changed nodes

type Cursor = { at: string; id: number }
function readCursor(v: string | undefined): Cursor {
  try {
    const c = JSON.parse(v ?? '')
    if (typeof c?.at === 'string' && Number.isInteger(c?.id)) return c
  } catch {
    // no cursor yet (or a broken one): roll up every node once
  }
  return { at: '', id: 0 }
}

const iso = (ms: number) => new Date(ms).toISOString()
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d
/** The hourly refresh, spread from 45 to 75 minutes by node id, so nodes rolled up together drift apart. */
export const refreshAfter = (id: number) => WARM_EVERY_MS * (0.75 + 0.5 * ((id * 0.6180339887) % 1))

export type StatsResult = { nodes: number; changed: number; warm: number; person_rows: number }

type NodeRow = {
  id: number
  path: string
  kind: string
  state: StatusInput['state']
  lobby_size: number | null
  author_id: number
  dead_end_note: string | null
  created_at: string
  pinned: string | null
}

export type NodeStats = {
  id: number
  impact: number
  posts_per_day: number
  people: number
  hot: 0 | 1
  surge: number | null // the hot badge's ratio, kept only while hot
  score: number
  status_line: string
  upvotes: number
  posts: number
  stale_at: string | null
}

/** Roll up stats for changed and stale nodes. */
export async function rollupStats(db: D1Database, now = Date.now()): Promise<StatsResult> {
  const settings = await readSettings(db, ['hot_floor', 'hot_mix', 'ranking'])
  const r = rankingFrom(settings)

  // ---- which nodes ----
  const c = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(CURSOR).first<{ value: string }>()
  const cursor = readCursor(c?.value)
  const { results: changedRows } = await db
    .prepare('SELECT id, path, changed_at FROM node WHERE changed_at >= ?1 AND NOT (changed_at = ?1 AND id <= ?2) ORDER BY changed_at, id LIMIT ?3')
    .bind(cursor.at, cursor.id, MAX_NODES + 1)
    .all<{ id: number; path: string; changed_at: string }>()
  const prefixes = new Set<string>()
  const ancestors = (path: string) => {
    const parts = path.split('/')
    return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join('/'))
  }
  for (const row of changedRows) for (const a of ancestors(row.path)) prefixes.add(a)
  const idOf = new Map<string, number>()
  if (prefixes.size) {
    const { results } = await db
      .prepare('SELECT id, path FROM node WHERE path IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify([...prefixes]))
      .all<{ id: number; path: string }>()
    for (const a of results) idOf.set(a.path, a.id)
  }

  // Changed nodes in cursor order, each after its ancestors and marked with the cursor that follows it.
  const items: { id: number; cursor?: Cursor }[] = []
  const seen = new Set<number>()
  let taken: Cursor | undefined
  let full = changedRows.length > MAX_NODES
  for (const row of changedRows) {
    const group = ancestors(row.path).map(a => idOf.get(a)).filter((id): id is number => id !== undefined && !seen.has(id))
    if (!seen.has(row.id)) group.push(row.id)
    if (taken && items.length + group.length > MAX_NODES) {
      full = true
      break
    }
    for (const id of group) {
      seen.add(id)
      items.push({ id })
    }
    taken = { at: row.changed_at, id: row.id }
    items[items.length - 1].cursor = taken
  }
  // Next time, read from a little before now, so a write stamped just before this run but committed after it is
  // still seen. When there are too many for one run, carry on exactly after the last one taken instead.
  const next: Cursor = full && taken ? taken : { at: iso(now - SLACK_MS), id: 0 }
  const changed = items.length

  const room = MAX_NODES - Math.min(items.length, MAX_NODES)
  if (room > 0) {
    const { results } = await db
      .prepare('SELECT node_id FROM node_stats WHERE stale_at IS NOT NULL AND stale_at <= ? ORDER BY stale_at LIMIT ?')
      .bind(iso(now), room + changed) // some may already be in the changed set
      .all<{ node_id: number }>()
    for (const w of results) {
      if (items.length >= MAX_NODES) break
      if (!seen.has(w.node_id)) {
        seen.add(w.node_id)
        items.push({ id: w.node_id })
      }
    }
  }
  const warm = items.length - changed

  const saveCursor = (k: Cursor) =>
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(CURSOR, JSON.stringify(k))
  let personRows = 0
  if (!items.length) await db.batch([saveCursor(next)])
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK)
    const last = i + CHUNK >= items.length
    const k = last ? next : chunk.reduce<Cursor | undefined>((m, x) => x.cursor ?? m, undefined)
    const out = await computeNodes(db, chunk.map(x => x.id), now, r)
    const writes = [...nodeStatsWrites(db, out.nodes, now), ...out.personWrites]
    if (k) writes.push(saveCursor(k))
    await db.batch(writes)
    personRows += out.personWrites.length
  }
  return { nodes: items.length, changed, warm, person_rows: personRows }
}

/** Every number for these nodes, from their rows; and the person_node_stats statements that bring those rows up to date. */
export async function computeNodes(db: D1Database, ids: number[], now: number, r: Ranking): Promise<{ nodes: NodeStats[]; personWrites: D1PreparedStatement[] }> {
  const J = JSON.stringify(ids)
  const IN = 'IN (SELECT value FROM json_each(?1))'
  const at = iso(now)
  const weekAgo = iso(now - WEEK_MS)
  const dayAgo = iso(now - DAY_MS)
  const windowFrom = iso(now - r.window_hours * HOUR_MS)
  const since = weekAgo < windowFrom ? weekAgo : windowFrom
  const all = async <T>(sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(J, ...args).all<T>()).results
  // weight of an event at time `col`, halved every half_life_hours (D1 has SQLite's math functions)
  const decayed = (col: string, half: string) => `pow(0.5, (julianday(?2) - julianday(${col})) * 24.0 / ${half})`

  const nodes = await all<NodeRow>(
    `SELECT n.id, n.path, n.kind, n.state, n.lobby_size, n.author_id, n.dead_end_note, n.created_at, pp.text AS pinned
     FROM node n LEFT JOIN post pp ON pp.id = n.pinned_post_id AND pp.node_id = n.id AND pp.hidden = 0 WHERE n.id ${IN}`,
  )
  // Seats, and joins in the last 24 hours (OPEN: the author's own seat 1 isn't counted as a join, so a brand-new
  // lobby doesn't jump ahead for a day).
  const seats = await all<{ node_id: number; seats: number; joins: number; oldest_join: string | null }>(
    `SELECT s.node_id, COUNT(*) AS seats, SUM(s.joined_at > ?2 AND s.person_id <> n.author_id) AS joins,
            MIN(CASE WHEN s.joined_at > ?2 AND s.person_id <> n.author_id THEN s.joined_at END) AS oldest_join
     FROM seat s JOIN node n ON n.id = s.node_id WHERE s.node_id ${IN} AND s.left_at IS NULL GROUP BY s.node_id`,
    dayAgo,
  )
  // People (table B #44): seat holders, humans who posted (themselves or by agent) in the last 7 days, and the author.
  const people = await all<{ node_id: number; n: number }>(
    `SELECT node_id, COUNT(*) AS n FROM (
       SELECT node_id, person_id FROM seat WHERE node_id ${IN} AND left_at IS NULL
       UNION SELECT node_id, person_id FROM post WHERE node_id ${IN} AND hidden = 0 AND created_at > ?2
       UNION SELECT id, author_id FROM node WHERE id ${IN})
     GROUP BY node_id`,
    weekAgo,
  )
  // Per person: posts (all time and this week) and counted upvotes on them. Agents roll up to their human.
  const posts = await all<{ node_id: number; person_id: number; n: number; n7: number; ups: number }>(
    `SELECT p.node_id, p.person_id, COUNT(*) AS n, SUM(p.created_at > ?2) AS n7,
            SUM((SELECT COUNT(*) FROM upvote u WHERE u.post_id = p.id AND u.counted = 1)) AS ups
     FROM post p WHERE p.node_id ${IN} AND p.hidden = 0 GROUP BY p.node_id, p.person_id`,
    weekAgo,
  )
  // Counted upvotes in the time windows, one row per node: the 24-hour and 7-day counts for hot, the live score's
  // decayed sum, and the oldest in each window (when it leaves, the numbers move).
  const ups = await all<{ node_id: number; up24: number; up7: number; oldest24: string | null; oldest7: string | null; decayed: number; oldest_window: string | null }>(
    `SELECT p.node_id,
            SUM(u.created_at > ?3) AS up24, SUM(u.created_at > ?4) AS up7,
            MIN(CASE WHEN u.created_at > ?3 THEN u.created_at END) AS oldest24,
            MIN(CASE WHEN u.created_at > ?4 THEN u.created_at END) AS oldest7,
            SUM(CASE WHEN u.created_at > ?5 THEN ${decayed('u.created_at', '?6')} ELSE 0 END) AS decayed,
            MIN(CASE WHEN u.created_at > ?5 THEN u.created_at END) AS oldest_window
     FROM post p JOIN upvote u ON u.post_id = p.id
     WHERE p.node_id ${IN} AND p.hidden = 0 AND u.counted = 1 AND u.created_at > ?7 AND u.created_at <= ?2
     GROUP BY p.node_id`,
    at,
    dayAgo,
    weekAgo,
    windowFrom,
    r.half_life_hours,
    since,
  )
  // Submissions and passes in the window for the live score, on each node (and its branches, when bumps come from branches).
  const bumps = await all<{ node_id: number; subs: number; passes: number; oldest: string | null }>(
    `WITH t AS (SELECT id, path, COALESCE(root_id, id) AS root FROM node WHERE id ${IN}),
          src AS (SELECT id AS node_id, id AS from_id FROM t
                  UNION ALL SELECT t.id, d.id FROM t JOIN node d ON d.root_id = t.root
                  WHERE ?5 AND substr(d.path, 1, length(t.path) + 1) = t.path || '/')
     SELECT src.node_id,
            SUM(CASE WHEN a.event = 'submission' THEN ${decayed('a.at', '?4')} ELSE 0 END) AS subs,
            SUM(CASE WHEN a.event = 'passed' THEN ${decayed('a.at', '?4')} ELSE 0 END) AS passes,
            MIN(a.at) AS oldest
     FROM src JOIN audit_event a ON a.node_id = src.from_id AND a.at > ?3 AND a.at <= ?2
     WHERE a.event IN ('submission', 'passed')
     GROUP BY src.node_id`,
    at,
    windowFrom,
    r.half_life_hours,
    r.bumps_from_branches ? 1 : 0,
  )
  const subs = await all<{ node_id: number; number: number; status: StatusInput['submissions'][number]['status'] }>(
    // A hidden (moderated) submission doesn't drive the status line, as on the node page (read/node.ts readSubmissions).
    `SELECT s.node_id, s.number, s.status FROM submission s JOIN post p ON p.id = s.post_id WHERE p.hidden = 0 AND s.node_id ${IN}`,
  )
  const branches = await all<{ parent_id: number; live: number; closed: number }>(
    `SELECT parent_id, SUM(state = 'live') AS live, SUM(state = 'closed') AS closed FROM node WHERE parent_id ${IN} AND hidden = 0 GROUP BY parent_id`,
  )
  const before = await all<{ node_id: number; person_id: number; posts: number; upvotes: number }>(
    `SELECT node_id, person_id, posts, upvotes FROM person_node_stats WHERE node_id ${IN}`,
  )

  const group = <T extends { node_id: number }>(rows: T[]) => {
    const m = new Map<number, T[]>()
    for (const row of rows) (m.get(row.node_id) ?? m.set(row.node_id, []).get(row.node_id)!).push(row)
    return m
  }
  const byNode = <T extends { node_id: number }>(rows: T[]) => new Map(rows.map(x => [x.node_id, x]))
  const seatsBy = byNode(seats)
  const peopleBy = byNode(people)
  const postsBy = group(posts)
  const upsBy = byNode(ups)
  const bumpsBy = byNode(bumps)
  const subsBy = group(subs)
  const branchBy = new Map(branches.map(b => [b.parent_id, b]))

  const out: NodeStats[] = []
  const personWrites: D1PreparedStatement[] = []
  const fresh = new Map<string, { node_id: number; person_id: number; posts: number; upvotes: number }>()
  for (const n of nodes) {
    const nodePosts = postsBy.get(n.id) ?? []
    const st = seatsBy.get(n.id)
    const u = upsBy.get(n.id)
    const b = bumpsBy.get(n.id)

    for (const p of nodePosts) fresh.set(`${n.id}:${p.person_id}`, { node_id: n.id, person_id: p.person_id, posts: p.n, upvotes: p.ups })
    const totalPosts = nodePosts.reduce((s, p) => s + p.n, 0)
    const totalUps = nodePosts.reduce((s, p) => s + p.ups, 0)
    const posts7 = nodePosts.reduce((s, p) => s + p.n7, 0)
    const up24 = u?.up24 ?? 0
    const up7 = u?.up7 ?? 0

    const seatsLeft = Math.max(0, (n.lobby_size ?? 0) - (st?.seats ?? 0))
    let score = 0
    if (n.state === 'lobby') score = lobbyScore(st?.joins ?? 0, seatsLeft)
    else if (n.state === 'live') score = liveScoreFrom({ upvotes: u?.decayed ?? 0, submissions: b?.subs ?? 0, passes: b?.passes ?? 0 }, r)
    const hot = n.state === 'live' && isHot(up24, up7, r) ? 1 : 0
    const perDay = round(postsPerDay(posts7, Date.parse(n.created_at), now), 2)

    // When these numbers next move with no new write; the earliest of these, or never.
    const when: number[] = []
    const plus = (t: string | null | undefined, ms: number) => t && when.push(Date.parse(t) + ms)
    if (score > 0 || perDay > 0) when.push(now + refreshAfter(n.id)) // decay, the 7-day posts window, the node's age
    if (n.state === 'live' && score > 0) {
      plus(u?.oldest_window, r.window_hours * HOUR_MS) // the oldest upvote or bump leaves the score's window
      plus(b?.oldest, r.window_hours * HOUR_MS)
    }
    if (hot) plus(u?.oldest24, DAY_MS) // the 24-hour count drops: hot may go off
    else if (n.state === 'live' && up24 >= r.hot_floor) plus(u?.oldest7, WEEK_MS) // the 7-day average drops: hot may come on
    if (n.state === 'lobby' && (st?.joins ?? 0) > 0) plus(st?.oldest_join, DAY_MS) // a join leaves the lobby score's 24 hours

    const br = branchBy.get(n.id)
    out.push({
      id: n.id,
      impact: round(impact(totalUps, totalPosts), 3),
      posts_per_day: perDay,
      people: peopleBy.get(n.id)?.n ?? 1,
      hot,
      surge: hot ? round(surge(up24, up7), 2) : null,
      score: round(score, 4),
      status_line: statusLine({
        state: n.state,
        pinned: n.pinned,
        seatsLeft,
        deadEndNote: n.dead_end_note,
        submissions: subsBy.get(n.id) ?? [],
        branches: { live: br?.live ?? 0, closed: br?.closed ?? 0 },
      }),
      upvotes: totalUps,
      posts: totalPosts,
      stale_at: when.length ? iso(Math.min(...when)) : null,
    })
  }

  // person_node_stats: write only what changed, and drop rows for people with no posts left (all hidden).
  const old = new Map(before.map(b => [`${b.node_id}:${b.person_id}`, b]))
  const upserts = [...fresh.values()].filter(f => {
    const o = old.get(`${f.node_id}:${f.person_id}`)
    return !o || o.posts !== f.posts || o.upvotes !== f.upvotes
  })
  for (let i = 0; i < upserts.length; i += 500) {
    personWrites.push(
      db
        .prepare(
          `INSERT INTO person_node_stats (person_id, node_id, posts, upvotes, updated_at)
           SELECT json_extract(j.value, '$.person_id'), json_extract(j.value, '$.node_id'), json_extract(j.value, '$.posts'),
                  json_extract(j.value, '$.upvotes'), ?2
           FROM json_each(?1) j WHERE 1
           ON CONFLICT (person_id, node_id) DO UPDATE SET posts = excluded.posts, upvotes = excluded.upvotes, updated_at = excluded.updated_at`,
        )
        .bind(JSON.stringify(upserts.slice(i, i + 500)), at),
    )
  }
  const gone = before.filter(o => !fresh.has(`${o.node_id}:${o.person_id}`)).map(o => [o.person_id, o.node_id])
  for (let i = 0; i < gone.length; i += 500) {
    personWrites.push(
      db
        .prepare(
          `DELETE FROM person_node_stats WHERE (person_id, node_id) IN
             (SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]') FROM json_each(?) j)`,
        )
        .bind(JSON.stringify(gone.slice(i, i + 500))),
    )
  }
  return { nodes: out, personWrites }
}

function nodeStatsWrites(db: D1Database, rows: NodeStats[], now: number): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = []
  for (let i = 0; i < rows.length; i += 200) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO node_stats (node_id, impact, posts_per_day, people, hot, surge, score, status_line, upvotes, posts, stale_at, updated_at)
           SELECT json_extract(j.value, '$.id'), json_extract(j.value, '$.impact'), json_extract(j.value, '$.posts_per_day'),
                  json_extract(j.value, '$.people'), json_extract(j.value, '$.hot'), json_extract(j.value, '$.surge'), json_extract(j.value, '$.score'),
                  json_extract(j.value, '$.status_line'), json_extract(j.value, '$.upvotes'), json_extract(j.value, '$.posts'),
                  json_extract(j.value, '$.stale_at'), ?2
           FROM json_each(?1) j WHERE 1
           ON CONFLICT (node_id) DO UPDATE SET impact = excluded.impact, posts_per_day = excluded.posts_per_day, people = excluded.people,
             hot = excluded.hot, surge = excluded.surge, score = excluded.score, status_line = excluded.status_line, upvotes = excluded.upvotes,
             posts = excluded.posts, stale_at = excluded.stale_at, updated_at = excluded.updated_at`,
        )
        .bind(JSON.stringify(rows.slice(i, i + 200)), iso(now)),
    )
  }
  return stmts
}

/** Days before today whose unfinished rows are still redone (a row is unfinished until counted after its day ended). */
export const SITE_CATCH_UP_DAYS = 7

/** Whether the header counters should be counted now, off the hour: today's were never counted, or not for an hour. */
export async function siteStale(db: D1Database, now = Date.now()): Promise<boolean> {
  const row = await db
    .prepare('SELECT computed_at FROM site_stats_daily WHERE day = ?')
    .bind(iso(now).slice(0, 10))
    .first<{ computed_at: string | null }>()
  return !row?.computed_at || Date.parse(row.computed_at) <= now - HOUR_MS
}

/**
 * Header counters and daily usage (site_stats_daily), for today so far, and the final numbers for any earlier day
 * whose row was last counted before that day ended (a missed or failed run at midnight is made up by the next run).
 * people = distinct people who posted (themselves or by agent), joined or upvoted in the 24 hours up to then
 * (table B #44); posts = thread posts made that UTC day; shwarms = shwarms and variants on the site.
 * The D1 usage columns stay as they are: D1 reports usage only through Cloudflare's analytics API.
 */
export async function rollupSite(db: D1Database, now = Date.now()): Promise<void> {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS
  const days = [{ start: dayStart, until: now, today: true }]
  const { results: earlier } = await db
    .prepare('SELECT day, computed_at FROM site_stats_daily WHERE day >= ? AND day < ? ORDER BY day')
    .bind(iso(dayStart - SITE_CATCH_UP_DAYS * DAY_MS).slice(0, 10), iso(dayStart).slice(0, 10))
    .all<{ day: string; computed_at: string | null }>()
  for (const e of earlier) {
    const start = Date.parse(`${e.day}T00:00:00Z`)
    if (!e.computed_at || Date.parse(e.computed_at) < start + DAY_MS) days.push({ start, until: start + DAY_MS, today: false }) // finish it
  }
  // In the first hour after midnight, yesterday too, even with no row yet.
  const yesterday = iso(dayStart - DAY_MS).slice(0, 10)
  if (now - dayStart < HOUR_MS && !earlier.some(e => e.day === yesterday)) days.push({ start: dayStart - DAY_MS, until: dayStart, today: false })
  const shwarms = await db
    .prepare("SELECT COUNT(*) AS n FROM node WHERE kind IN ('shwarm', 'variant') AND hidden = 0 AND triage <> 'blocked'")
    .first<{ n: number }>()
  const stmts: D1PreparedStatement[] = []
  for (const d of days) {
    const from = iso(d.start)
    const until = iso(d.until)
    const dayAgo = iso(d.until - DAY_MS)
    // OPEN: a hand triage decision's model is the admin's handle; a model call's is a Workers AI id ('@cf/…').
    const row = await db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM post WHERE created_at >= ?1 AND created_at < ?2 AND hidden = 0) AS posts,
           (SELECT COUNT(*) FROM (
              SELECT person_id FROM post WHERE created_at > ?3 AND created_at <= ?2
              UNION SELECT person_id FROM seat WHERE joined_at > ?3 AND joined_at <= ?2
              UNION SELECT person_id FROM upvote WHERE created_at > ?3 AND created_at <= ?2)) AS people,
           (SELECT COUNT(*) FROM email_outbox WHERE provider_id IS NOT NULL AND sent_at >= ?1 AND sent_at < ?2) AS emails,
           (SELECT COUNT(*) FROM triage_decision WHERE created_at >= ?1 AND created_at < ?2 AND model LIKE '@%') AS triage`,
      )
      .bind(from, until, dayAgo)
      .first<{ posts: number; people: number; emails: number; triage: number }>()
    // An earlier day keeps the shwarm count from its last run that day (only a row never counted takes today's).
    stmts.push(
      db
        .prepare(
          `INSERT INTO site_stats_daily (day, shwarms, people, posts, emails_sent, triage_calls, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (day) DO UPDATE SET
             shwarms = CASE WHEN ? OR site_stats_daily.computed_at IS NULL THEN excluded.shwarms ELSE site_stats_daily.shwarms END, people = excluded.people, posts = excluded.posts,
             emails_sent = excluded.emails_sent, triage_calls = excluded.triage_calls, computed_at = excluded.computed_at`,
        )
        .bind(from.slice(0, 10), shwarms?.n ?? 0, row?.people ?? 0, row?.posts ?? 0, row?.emails ?? 0, row?.triage ?? 0, iso(now), d.today ? 1 : 0),
    )
  }
  await db.batch(stmts)
}
