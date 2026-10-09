// The stats and ranking rollup (go-live 3.7), run by cron every 5 minutes (jobs/index.ts).
//
// Which nodes it rolls up, so a quiet site costs almost nothing:
//   changed  nodes whose changed_at (set by every write through touchNode) is newer than the last run, plus their
//            ancestors, since a branch's submission or pass moves its parent's status line and score
//   warm     nodes whose numbers still move with time alone (a score decaying, a 24-hour or 7-day window sliding),
//            once they are an hour stale
// Each node is rolled up whole from its own rows, so reruns give the same answer. The reads are a fixed handful of
// set-based queries whatever the node count (D1 caps queries per invocation), and the writes are one batch.
// The header counters (site_stats_daily) are counted once an hour.
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
  liveScore,
  lobbyScore,
  people,
  postsPerDay,
  rankingFrom,
  statusLine,
  type Ranking,
  type StatusInput,
} from '../core/stats'

export const MAX_NODES = 250 // per run; more waits for the next run (changed first, then the stalest warm ones)
export const WARM_EVERY_MS = HOUR_MS // a warm node with no new activity is rolled up again after this
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

export type StatsResult = { nodes: number; changed: number; warm: number; person_rows: number; site: boolean }

type NodeRow = {
  id: number
  path: string
  kind: string
  state: StatusInput['state']
  lobby_size: number | null
  author_id: number
  dead_end_note: string | null
  created_at: string
}

export type NodeStats = {
  id: number
  impact: number
  posts_per_day: number
  people: number
  hot: 0 | 1
  score: number
  status_line: string
  upvotes: number
  posts: number
}

/** Roll up stats for changed and warm nodes; with `site`, also the header counters for today (and yesterday at 00:00 UTC). */
export async function rollupStats(db: D1Database, now = Date.now(), o: { site?: boolean } = {}): Promise<StatsResult> {
  const settings = await readSettings(db, ['hot_floor', 'hot_mix', 'ranking'])
  const r = rankingFrom(settings)

  // ---- which nodes ----
  const c = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(CURSOR).first<{ value: string }>()
  const cursor = readCursor(c?.value)
  const { results: changedRows } = await db
    .prepare('SELECT id, path, changed_at FROM node WHERE changed_at >= ?1 AND NOT (changed_at = ?1 AND id <= ?2) ORDER BY changed_at, id LIMIT ?3')
    .bind(cursor.at, cursor.id, MAX_NODES + 1)
    .all<{ id: number; path: string; changed_at: string }>()
  // Next time, read from a little before now, so a write stamped just before this run but committed after it is
  // still seen. When there are too many for one run, carry on exactly after the last one taken instead.
  let next: Cursor = { at: iso(now - SLACK_MS), id: 0 }
  if (changedRows.length > MAX_NODES) {
    changedRows.length = MAX_NODES
    const last = changedRows[MAX_NODES - 1]
    next = { at: last.changed_at, id: last.id }
  }
  const ids = new Set(changedRows.map(c => c.id))
  const prefixes = new Set<string>()
  for (const c of changedRows) {
    const parts = c.path.split('/')
    for (let i = 1; i < parts.length; i++) prefixes.add(parts.slice(0, i).join('/'))
  }
  if (prefixes.size) {
    const { results } = await db
      .prepare('SELECT id FROM node WHERE path IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify([...prefixes]))
      .all<{ id: number }>()
    for (const a of results) ids.add(a.id)
  }
  const changed = ids.size
  const room = MAX_NODES - Math.min(ids.size, MAX_NODES)
  if (room > 0) {
    const { results } = await db
      .prepare(
        `SELECT node_id FROM node_stats WHERE (score > 0 OR hot = 1 OR posts_per_day > 0) AND updated_at < ?
         ORDER BY updated_at LIMIT ?`,
      )
      .bind(iso(now - WARM_EVERY_MS), room + changed) // some may already be in the changed set
      .all<{ node_id: number }>()
    for (const w of results) {
      if (ids.size >= MAX_NODES) break
      ids.add(w.node_id)
    }
  }
  const warm = ids.size - changed

  let personRows = 0
  const writes: D1PreparedStatement[] = []
  if (ids.size) {
    const out = await computeNodes(db, [...ids], now, r)
    writes.push(...nodeStatsWrites(db, out.nodes, now))
    writes.push(...out.personWrites)
    personRows = out.personWrites.length
  }
  writes.push(db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(CURSOR, JSON.stringify(next)))
  await db.batch(writes)

  if (o.site) await rollupSite(db, now)
  return { nodes: ids.size, changed, warm, person_rows: personRows, site: !!o.site }
}

/** Every number for these nodes, from their rows; and the person_node_stats statements that bring those rows up to date. */
export async function computeNodes(db: D1Database, ids: number[], now: number, r: Ranking): Promise<{ nodes: NodeStats[]; personWrites: D1PreparedStatement[] }> {
  const J = JSON.stringify(ids)
  const IN = 'IN (SELECT value FROM json_each(?1))'
  const weekAgo = iso(now - WEEK_MS)
  const dayAgo = iso(now - DAY_MS)
  const windowFrom = iso(now - r.window_hours * HOUR_MS)
  const all = async <T>(sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(J, ...args).all<T>()).results

  const nodes = await all<NodeRow>(`SELECT id, path, kind, state, lobby_size, author_id, dead_end_note, created_at FROM node WHERE id ${IN}`)
  const seats = await all<{ node_id: number; person_id: number; joined_at: string }>(
    `SELECT node_id, person_id, joined_at FROM seat WHERE node_id ${IN} AND left_at IS NULL`,
  )
  const posts = await all<{ node_id: number; person_id: number; n: number; n7: number }>(
    `SELECT node_id, person_id, COUNT(*) AS n, SUM(created_at > ?2) AS n7 FROM post WHERE node_id ${IN} AND hidden = 0 GROUP BY node_id, person_id`,
    weekAgo,
  )
  // Counted upvotes on each person's posts: old ones as one count per person, the last 7 days one row per time.
  const ups = await all<{ node_id: number; person_id: number; at: string | null; n: number }>(
    `SELECT p.node_id, p.person_id, CASE WHEN u.created_at > ?2 THEN u.created_at END AS at, COUNT(*) AS n
     FROM post p JOIN upvote u ON u.post_id = p.id
     WHERE p.node_id ${IN} AND p.hidden = 0 AND u.counted = 1
     GROUP BY p.node_id, p.person_id, at`,
    weekAgo,
  )
  // Submissions and passes for the live score, on these nodes (and their branches, when bumps come from branches).
  const tree = r.bumps_from_branches ? ` OR d.root_id IN (SELECT COALESCE(root_id, id) FROM node WHERE id ${IN})` : ''
  const bumps = await all<{ path: string; event: 'submission' | 'passed'; at: string }>(
    `SELECT d.path, a.event, a.at FROM audit_event a JOIN node d ON d.id = a.node_id
     WHERE a.event IN ('submission', 'passed') AND a.at > ?2 AND (d.id ${IN}${tree})`,
    windowFrom,
  )
  const subs = await all<{ node_id: number; number: number; status: StatusInput['submissions'][number]['status'] }>(
    `SELECT node_id, number, status FROM submission WHERE node_id ${IN}`,
  )
  const branches = await all<{ parent_id: number; live: number; closed: number }>(
    `SELECT parent_id, SUM(state = 'live') AS live, SUM(state = 'closed') AS closed FROM node WHERE parent_id ${IN} AND hidden = 0 GROUP BY parent_id`,
  )
  const pinned = await all<{ node_id: number; text: string }>(
    `SELECT n.id AS node_id, p.text FROM node n JOIN post p ON p.id = n.pinned_post_id AND p.node_id = n.id AND p.hidden = 0 WHERE n.id ${IN}`,
  )
  const before = await all<{ node_id: number; person_id: number; posts: number; upvotes: number }>(
    `SELECT node_id, person_id, posts, upvotes FROM person_node_stats WHERE node_id ${IN}`,
  )

  const group = <T extends { node_id: number }>(rows: T[]) => {
    const m = new Map<number, T[]>()
    for (const row of rows) (m.get(row.node_id) ?? m.set(row.node_id, []).get(row.node_id)!).push(row)
    return m
  }
  const seatsBy = group(seats)
  const postsBy = group(posts)
  const upsBy = group(ups)
  const subsBy = group(subs)
  const branchBy = new Map(branches.map(b => [b.parent_id, b]))
  const pinnedBy = new Map(pinned.map(p => [p.node_id, p.text]))

  const out: NodeStats[] = []
  const personWrites: D1PreparedStatement[] = []
  const fresh = new Map<string, { node_id: number; person_id: number; posts: number; upvotes: number }>()
  for (const n of nodes) {
    const created = Date.parse(n.created_at)
    const nodeSeats = seatsBy.get(n.id) ?? []
    const nodePosts = postsBy.get(n.id) ?? []
    const nodeUps = upsBy.get(n.id) ?? []

    // per person: all-time posts and counted upvotes on them (agents roll up to their human)
    const per = new Map<number, { posts: number; upvotes: number }>()
    for (const p of nodePosts) per.set(p.person_id, { posts: p.n, upvotes: 0 })
    for (const u of nodeUps) {
      const x = per.get(u.person_id)
      if (x) x.upvotes += u.n
    }
    for (const [pid, x] of per) fresh.set(`${n.id}:${pid}`, { node_id: n.id, person_id: pid, ...x })

    const totalPosts = nodePosts.reduce((s, p) => s + p.n, 0)
    const totalUps = nodeUps.reduce((s, u) => s + u.n, 0)
    const posts7 = nodePosts.reduce((s, p) => s + p.n7, 0)
    const recentUps: number[] = []
    for (const u of nodeUps) if (u.at) for (let k = 0; k < u.n; k++) recentUps.push(Date.parse(u.at))
    const up7 = recentUps.filter(t => t <= now).length
    const up24 = recentUps.filter(t => t > now - DAY_MS && t <= now).length

    const seatsLeft = Math.max(0, (n.lobby_size ?? 0) - nodeSeats.length)
    let score = 0
    if (n.state === 'lobby') {
      // OPEN: the author's own seat 1 isn't counted as a join, so a brand-new lobby doesn't jump ahead for a day.
      const joins = nodeSeats.filter(s => s.joined_at > dayAgo && s.person_id !== n.author_id).length
      score = lobbyScore(joins, seatsLeft)
    } else if (n.state === 'live') {
      const mine = bumps.filter(b => b.path === n.path || (r.bumps_from_branches && b.path.startsWith(n.path + '/')))
      score = liveScore(
        {
          upvotes: recentUps,
          submissions: mine.filter(b => b.event === 'submission').map(b => Date.parse(b.at)),
          passes: mine.filter(b => b.event === 'passed').map(b => Date.parse(b.at)),
        },
        now,
        r,
      )
    }
    const b = branchBy.get(n.id)
    out.push({
      id: n.id,
      impact: round(impact(totalUps, totalPosts), 3),
      posts_per_day: round(postsPerDay(posts7, created, now), 2),
      people: people(
        nodeSeats.map(s => s.person_id),
        nodePosts.filter(p => p.n7 > 0).map(p => p.person_id),
        n.author_id,
      ),
      hot: n.state === 'live' && isHot(up24, up7, r) ? 1 : 0,
      score: round(score, 4),
      status_line: statusLine({
        state: n.state,
        pinned: pinnedBy.get(n.id) ?? null,
        seatsLeft,
        deadEndNote: n.dead_end_note,
        submissions: subsBy.get(n.id) ?? [],
        branches: { live: b?.live ?? 0, closed: b?.closed ?? 0 },
      }),
      upvotes: totalUps,
      posts: totalPosts,
    })
  }

  // person_node_stats: write only what changed, and drop rows for people with no posts left (all hidden).
  const at = iso(now)
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
  for (const o of before) {
    if (!fresh.has(`${o.node_id}:${o.person_id}`))
      personWrites.push(db.prepare('DELETE FROM person_node_stats WHERE person_id = ? AND node_id = ?').bind(o.person_id, o.node_id))
  }
  return { nodes: out, personWrites }
}

function nodeStatsWrites(db: D1Database, rows: NodeStats[], now: number): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = []
  for (let i = 0; i < rows.length; i += 200) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO node_stats (node_id, impact, posts_per_day, people, hot, score, status_line, upvotes, posts, updated_at)
           SELECT json_extract(j.value, '$.id'), json_extract(j.value, '$.impact'), json_extract(j.value, '$.posts_per_day'),
                  json_extract(j.value, '$.people'), json_extract(j.value, '$.hot'), json_extract(j.value, '$.score'),
                  json_extract(j.value, '$.status_line'), json_extract(j.value, '$.upvotes'), json_extract(j.value, '$.posts'), ?2
           FROM json_each(?1) j WHERE 1
           ON CONFLICT (node_id) DO UPDATE SET impact = excluded.impact, posts_per_day = excluded.posts_per_day, people = excluded.people,
             hot = excluded.hot, score = excluded.score, status_line = excluded.status_line, upvotes = excluded.upvotes,
             posts = excluded.posts, updated_at = excluded.updated_at`,
        )
        .bind(JSON.stringify(rows.slice(i, i + 200)), iso(now)),
    )
  }
  return stmts
}

/**
 * Header counters and daily usage (site_stats_daily), for today so far; at the first run after midnight UTC, also
 * yesterday's final numbers. people = distinct people who posted (themselves or by agent), joined or upvoted in the
 * 24 hours up to then (table B #44); posts = thread posts made that UTC day; shwarms = shwarms and variants on the site.
 * The D1 usage columns stay as they are: D1 reports usage only through Cloudflare's analytics API.
 */
export async function rollupSite(db: D1Database, now = Date.now()): Promise<void> {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS
  const days = [{ start: dayStart, until: now }]
  if (now - dayStart < HOUR_MS) days.push({ start: dayStart - DAY_MS, until: dayStart }) // finish yesterday
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
    stmts.push(
      db
        .prepare(
          `INSERT INTO site_stats_daily (day, shwarms, people, posts, emails_sent, triage_calls) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (day) DO UPDATE SET shwarms = excluded.shwarms, people = excluded.people, posts = excluded.posts,
             emails_sent = excluded.emails_sent, triage_calls = excluded.triage_calls`,
        )
        .bind(from.slice(0, 10), shwarms?.n ?? 0, row?.people ?? 0, row?.posts ?? 0, row?.emails ?? 0, row?.triage ?? 0),
    )
  }
  await db.batch(stmts)
}
