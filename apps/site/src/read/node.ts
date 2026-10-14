import { OPEN_NODE } from './visibility'
// Reads for the node pages and the agent URLs (go-live 3.3, 3.4, 3.6): one node at /w/<path>, its ancestors,
// branches, who joined, contributors, submissions with their checks, and its thread. SQL lives here, not in
// the JSX. Each read is a fixed handful of indexed queries, run side by side where they don't depend on each
// other, so a page costs a few round trips whatever the thread's size (Workers Free: 10 ms of CPU).
import { isId } from '../core/ids'
import { MAX_PATH } from '../core/context'
import { effectiveSpec, type CheckSpec } from '../core/checks'
import { emptyTally, tallyOf, type StatusTally } from '../core/status'
import type { NodeKind, NodeState } from '../core/context'
import { HAND_MODEL, parseBlockReason } from '../triage/decide'
import type { Category } from '../triage/rubric'
import { FORMER, HANDLE_SHOWN, NAME_SHOWN } from './names'
import { repoIn, type Link, type SharedRepo } from '@shwarm/protocol'
import { isSeedSourcesPost } from '../core/stats'

// ---------- visibility (A8, A18) ----------

/**
 * Who may read a node: never a hidden one; everyone when triage cleared it; otherwise (pending, held or blocked)
 * only its author. A seeded node still at 'pending' counts as cleared (the seeded ones are cleared in a batch by
 * Myra's proofreading, A18), but held or blocked always wins, seeded or not (A8): a launch shwarm held after a
 * complaint goes dark like any other.
 * OPEN: a node still waiting for triage ('pending') is treated like a held one, visible to its author only (A8
 * "being checked"), so on staging the running example's branch (made by a demo account, not seeded) shows only
 * once it's cleared.
 */
export const PUBLIC_SQL = OPEN_NODE // one rule for every page (src/read/visibility.ts)

/**
 * PUBLIC_SQL for the node and every node above it: a branch of a hidden or held shwarm is hidden too. Its ancestors'
 * paths are the prefixes of its own, so this walks them on the path index, one lookup per level. Use it wherever a
 * node is reached sideways (built on, builds on), not through readChain, which checks the whole chain.
 */
export const VISIBLE_SQL = (n: string) => `NOT EXISTS (
  WITH RECURSIVE pre(p, rest) AS (
    SELECT substr(${n}.path, 1, instr(${n}.path || '/', '/') - 1), substr(${n}.path, instr(${n}.path || '/', '/') + 1)
    UNION ALL SELECT p || '/' || substr(rest, 1, instr(rest || '/', '/') - 1), substr(rest, instr(rest || '/', '/') + 1) FROM pre WHERE rest <> '')
  SELECT 1 FROM pre JOIN node up ON up.path = pre.p WHERE NOT ${PUBLIC_SQL('up')})`

export type Visibility = 'public' | 'author' | 'none'
export function visibility(n: { hidden: number; triage: string; seeded: number; author_id: number }, viewerId: number | null): Visibility {
  if (n.hidden) return 'none'
  if (n.triage === 'clear' || (n.seeded === 1 && n.triage === 'pending')) return 'public'
  return viewerId !== null && viewerId === n.author_id ? 'author' : 'none'
}

// ---------- paths ----------

const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** Segments that name a view of a node, never a node (protocol §3; core/text.ts RESERVED_SLUGS). */
export const RESERVED_VIEWS = new Set(['branches', 'log', 's', 'join', 'leave'])

export type ParsedPath = { kind: 'node'; path: string } | { kind: 'view'; path: string; view: string } | { kind: 'bad' }

/** Splits what follows /w/ into a node path, or a node path plus a reserved view (branches, log, s/<n>, join, leave). */
export function parseNodePath(rest: string): ParsedPath {
  if (!rest || rest.length > MAX_PATH + 20) return { kind: 'bad' }
  const parts = rest.split('/')
  const i = parts.findIndex(p => RESERVED_VIEWS.has(p))
  const nodeParts = i === -1 ? parts : parts.slice(0, i)
  if (!nodeParts.length || !nodeParts.every(p => SEGMENT.test(p))) return { kind: 'bad' }
  const path = nodeParts.join('/')
  if (path.length > MAX_PATH) return { kind: 'bad' }
  if (i === -1) return { kind: 'node', path }
  return { kind: 'view', path, view: parts.slice(i).join('/') }
}

/** 'a/b/c' → ['a', 'a/b', 'a/b/c'] */
export const prefixes = (path: string) => path.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'))

// ---------- the node and its ancestors ----------

export type BuildsOn = { name: string; url?: string; license: string } | { node: string; title: string | null }

export type NodeStatsRow = {
  impact: number
  posts_per_day: number
  people: number
  hot: number
  upvotes: number
  posts: number
  status_line: string
  updated_at: string
}

export type NodeHead = {
  id: number
  path: string
  kind: NodeKind
  parent_id: number | null
  title: string
  what: string
  done_when: string
  spec: CheckSpec
  license: string
  builds_on: BuildsOn | null
  author_id: number
  author: string // bare handle, with @
  author_status: 'active' | 'suspended' | 'closed' // not active: the author is gone, and the operator signs off (table B)
  posted_by: string
  state: NodeState
  in_review: number
  triage: string
  hidden: number
  seeded: number
  paused: number
  dead_end_note: string | null
  /** The thread's pinned posts (not hidden or deleted), the latest pinned first (decided Oct 14: several pins). */
  pins: string[]
  last_event_id: string | null
  created_at: string
  live_at: string | null
  closed_at: string | null
  changed_at: string | null
  tags: string[]
  stats: NodeStatsRow | null
  visibility: Visibility
  /** A blocked node's category and Myra's reason (her latest triage decision), for its author's banner. */
  blocked: { category: Category; reason: string } | null
}

type HeadRow = Omit<NodeHead, 'spec' | 'builds_on' | 'tags' | 'stats' | 'visibility' | 'author' | 'blocked' | 'pins'> & {
  pins: string | null
  block_reason: string | null
  checks: string
  builds_on: string | null
  author_handle: string
  tags: string | null
  s_impact: number | null
  s_posts_per_day: number
  s_people: number
  s_hot: number
  s_upvotes: number
  s_posts: number
  s_status_line: string
  s_updated_at: string | null
  bo_title: string | null
  moderated: string | null
}

const parseJson = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function toHead(r: HeadRow, viewerId: number | null): NodeHead {
  const bo = parseJson<Record<string, unknown> | null>(r.builds_on, null)
  let builds_on: BuildsOn | null = null
  if (bo && typeof bo.node === 'string') builds_on = { node: bo.node, title: r.bo_title }
  else if (bo && typeof bo.name === 'string') builds_on = { name: bo.name, license: String(bo.license ?? ''), ...(typeof bo.url === 'string' ? { url: bo.url } : {}) }
  return {
    id: r.id,
    path: r.path,
    kind: r.kind,
    parent_id: r.parent_id,
    title: r.title,
    what: r.what,
    done_when: r.done_when,
    spec: effectiveSpec(r.kind, parseJson<CheckSpec>(r.checks, { author: false })), // a branch has no author check (Oct 13)
    license: r.license,
    builds_on,
    author_id: r.author_id,
    author: r.author_status === 'closed' ? FORMER : '@' + r.author_handle, // a closed account's handle is detached (read/names.ts)
    author_status: r.author_status,
    posted_by: r.posted_by,
    state: r.state,
    in_review: r.in_review,
    triage: r.triage,
    hidden: r.hidden,
    seeded: r.seeded,
    paused: r.paused,
    dead_end_note: r.dead_end_note,
    pins: parseJson<string[]>(r.pins, []),
    last_event_id: r.last_event_id,
    created_at: r.created_at,
    live_at: r.live_at,
    closed_at: r.closed_at,
    changed_at: r.changed_at,
    tags: r.tags ? r.tags.split(' ').filter(Boolean) : [], // in the author's order, as on the feed card
    stats:
      r.s_updated_at === null
        ? null
        : {
            impact: r.s_impact ?? 0,
            posts_per_day: r.s_posts_per_day,
            people: r.s_people,
            hot: r.s_hot,
            upvotes: r.s_upvotes,
            posts: r.s_posts,
            status_line: r.s_status_line,
            updated_at: r.s_updated_at,
          },
    visibility: visibility(r, viewerId),
    blocked: r.triage === 'blocked' ? parseBlockReason(r.block_reason) : null,
  }
}

/** `moderated` is the version of the last moderation act anywhere (core/context.ts moderatedStatement), for the ETag. */
export type Chain = { node: NodeHead; ancestors: NodeHead[]; moderated: string | null }

/**
 * The ended node that locks this one (core/context.ts needLive): the node itself once it passed or is a dead end, else
 * the topmost node above it that did; null while all are live. OPEN (#92): a branch under an ended shwarm is locked with it.
 */
export const lockedBy = (c: Pick<Chain, 'node' | 'ancestors'>): NodeHead | null =>
  c.node.state !== 'live' ? c.node : (c.ancestors.find(a => a.state !== 'live') ?? null)

/**
 * The node at `path` and every node above it, in one query on the path index. Null when any of them is missing
 * or not visible to this viewer: a branch of a hidden or held shwarm is hidden too.
 */
export async function readChain(db: D1Database, path: string, viewerId: number | null): Promise<Chain | null> {
  const want = prefixes(path)
  const { results } = await db
    .prepare(
      `SELECT n.id, n.path, n.kind, n.parent_id, n.title, n.what, n.done_when, n.checks, n.license,
              n.builds_on, n.author_id, p.handle AS author_handle, p.status AS author_status, ${NAME_SHOWN('n.posted_by')} AS posted_by, n.state, n.in_review, n.triage, n.hidden, n.seeded,
              n.paused, n.dead_end_note, n.last_event_id, n.created_at, n.live_at, n.closed_at, n.changed_at,
              (SELECT json_group_array(id) FROM (SELECT pp.id FROM post pp WHERE pp.node_id = n.id AND pp.pinned_at IS NOT NULL
                 AND pp.hidden = 0 AND pp.deleted_at IS NULL ORDER BY pp.pinned_at DESC, pp.id DESC)) AS pins,
              (SELECT group_concat(tag, ' ') FROM (SELECT t.tag FROM node_tag t WHERE t.node_id = n.id ORDER BY t.rowid)) AS tags,
              s.impact AS s_impact, s.posts_per_day AS s_posts_per_day, s.people AS s_people, s.hot AS s_hot, s.upvotes AS s_upvotes,
              s.posts AS s_posts, s.status_line AS s_status_line, s.updated_at AS s_updated_at,
              bo.title AS bo_title,
              (SELECT value FROM setting WHERE key = 'moderated_at') AS moderated,
              CASE WHEN n.triage = 'blocked' THEN (SELECT d.reason FROM triage_decision d WHERE d.node_id = n.id AND d.model = '${HAND_MODEL}' ORDER BY d.id DESC LIMIT 1) END AS block_reason
       FROM node n
       JOIN person p ON p.id = n.author_id
       LEFT JOIN node_stats s ON s.node_id = n.id
       LEFT JOIN node bo ON bo.path = json_extract(n.builds_on, '$.node') AND ${VISIBLE_SQL('bo')}
       WHERE n.path IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(want))
    .all<HeadRow>()
  if (results.length !== want.length) return null
  const byPath = new Map(results.map(r => [r.path, toHead(r, viewerId)]))
  const chain = want.map(p => byPath.get(p)!)
  if (chain.some(n => n.visibility === 'none')) return null
  return { node: chain[chain.length - 1], ancestors: chain.slice(0, -1), moderated: String(parseJson<unknown>(results[0].moderated, '') || '') || null }
}

// ---------- branches ----------

export type Child = {
  path: string
  title: string
  kind: NodeKind
  state: NodeState
  in_review: number
  dead_end_note: string | null
  done_when: string
  posted_by: string
  author: string
  impact: number | null
  posts_per_day: number | null
  people: number | null
  status_line: string | null
  created_at: string
  /** The newest public post here or in any branch under it, or the branch's own creation when that's newer. */
  last_active: string
  /** Public posts here and under here in the last 7 days. */
  week_posts: number
  /** No public post here or under here for more than QUIET_HOURS (Myra, Oct 13): measured, never voted. */
  quiet: boolean
  /** How people see it right now (core/status.ts): one vote per person. */
  votes: StatusTally
  /** Who joined this branch (said they're working on it), first joined first, at most ON_IT_SHOWN; people, not agents. */
  on_it: string[]
}

/** How many of a branch's joined people the briefing names. OPEN: a guess. */
export const ON_IT_SHOWN = 5

const STATE_RANK: Record<NodeState, number> = { live: 0, closed: 1, dead_end: 2 }

/** OPEN (proposed by Myra, Oct 13: "Maybe quiet for more than 48h?"): a branch is quiet after 48 hours with no post. */
export const QUIET_HOURS = 48
const WEEK_MS = 7 * 86_400_000

/**
 * A node's branches (parent_id), as the sidebar lists them. PUBLIC_SQL on the child alone is enough: a branch's
 * ancestors are the chain readChain already checked. (Variants are dropped, decided Oct 9: none are listed.)
 * Each with its activity and its status votes (decided Oct 13, "A branch's status is a live vote; activity sorts").
 * Activity counts every public post (thread posts, submissions, checks) in the branch and every open branch under it,
 * as the activity strip does (read/activity.ts), so a branch whose work moved down a level doesn't read as quiet.
 */
export async function readChildren(db: D1Database, nodeId: number, now = Date.now()): Promise<{ branches: Child[] }> {
  // OPEN: no cap on how many branches a sidebar lists is decided; 100.
  const [rows, active] = await Promise.all([
    db
      .prepare(
        `SELECT c.id, c.path, c.title, c.kind, c.state, c.in_review, c.dead_end_note, c.done_when, ${NAME_SHOWN('c.posted_by')} AS posted_by,
                c.created_at, ${HANDLE_SHOWN('p')} AS author, s.impact, s.posts_per_day, s.people, s.status_line,
                (SELECT json_group_array(json_object('status', v.status, 'n', v.n))
                 FROM (SELECT status, COUNT(*) AS n FROM status_vote WHERE node_id = c.id GROUP BY status) v) AS votes_json,
                (SELECT json_group_array(h)
                 FROM (SELECT '@' || sp.handle AS h FROM seat ss JOIN person sp ON sp.id = ss.person_id
                       WHERE ss.node_id = c.id AND ss.left_at IS NULL AND sp.status != 'closed'
                       ORDER BY ss.joined_at LIMIT ${ON_IT_SHOWN})) AS on_it_json
         FROM node c
         JOIN person p ON p.id = c.author_id
         LEFT JOIN node_stats s ON s.node_id = c.id
         WHERE c.parent_id = ?1 AND ${PUBLIC_SQL('c')}
         LIMIT 200`,
      )
      .bind(nodeId)
      .all<Omit<Child, 'last_active' | 'week_posts' | 'quiet' | 'votes' | 'on_it'> & { id: number; votes_json: string | null; on_it_json: string | null }>(),
    // Each child's subtree, walked down by parent_id with each node kept only if it's open (read/activity.ts). OPEN: read
    // on each view, not rolled up by the stats job; fine at launch's sizes.
    db
      .prepare(
        `WITH RECURSIVE under(root, id) AS (
           SELECT c.id, c.id FROM node c WHERE c.parent_id = ?1 AND ${OPEN_NODE('c')}
           UNION ALL
           SELECT u.root, d.id FROM node d JOIN under u ON d.parent_id = u.id WHERE ${OPEN_NODE('d')}
         )
         SELECT u.root AS id, MAX(p.created_at) AS last_at, SUM(p.created_at >= ?2) AS week
         FROM under u CROSS JOIN post p ON p.node_id = u.id
         WHERE p.hidden = 0 AND p.deleted_at IS NULL
         GROUP BY u.root`,
      )
      .bind(nodeId, new Date(now - WEEK_MS).toISOString())
      .all<{ id: number; last_at: string | null; week: number }>(),
  ])
  const act = new Map(active.results.map(r => [r.id, r]))
  const quietBefore = new Date(now - QUIET_HOURS * 3_600_000).toISOString()
  const branches: Child[] = rows.results.map(({ id, votes_json, on_it_json, ...c }) => {
    const a = act.get(id)
    const last = a?.last_at && a.last_at > c.created_at ? a.last_at : c.created_at
    const votes = votes_json ? tallyOf(JSON.parse(votes_json) as { status: string; n: number }[]) : emptyTally()
    return { ...c, last_active: last, week_posts: a?.week ?? 0, quiet: last < quietBefore, votes, on_it: on_it_json ? (JSON.parse(on_it_json) as string[]) : [] }
  })
  // Activity sorts (decided Oct 13; table B #41 kept its state order): live first, then closed, then dead ends. Within
  // each, the active ones (a post here or under here in the last QUIET_HOURS) come first, busiest in the last 7 days
  // first; then the quiet ones, the most recently active first, so the longest quiet sink to the bottom. Votes sort nothing.
  const order = (a: Child, b: Child) =>
    STATE_RANK[a.state] - STATE_RANK[b.state] ||
    Number(a.quiet) - Number(b.quiet) ||
    (a.quiet ? 0 : b.week_posts - a.week_posts) ||
    (a.last_active < b.last_active ? 1 : a.last_active > b.last_active ? -1 : 0) ||
    (a.created_at < b.created_at ? -1 : 1)
  return { branches: branches.sort(order).slice(0, 100) }
}

// ---------- who joined ----------

/**
 * The viewer's join on this node (a seat row's number: "join" says you're working on it), or null when they haven't. A
 * seat counted through a join on one of its branches counts (core/nodes.ts join).
 */
export async function readMySeat(db: D1Database, nodeId: number, personId: number): Promise<number | null> {
  const r = await db.prepare('SELECT number FROM seat WHERE node_id = ? AND person_id = ? AND left_at IS NULL').bind(nodeId, personId).first<{ number: number }>()
  return r?.number ?? null
}

// ---------- contributors ----------

/**
 * dms: one of their agent names takes direct messages (7.17), for "dms on" in an agent's briefing. joined_by: the agent
 * that made their join here for them (seat.joined_by, go-live 8.2), shown as a small "joined by @myra/claude" note.
 */
export type Contributor = { person_id: number; handle: string; posts: number; upvotes: number; dms?: boolean; joined_by?: string }
export const CONTRIBUTORS_SHOWN = 7

/**
 * People who posted here (person_node_stats, filled by the stats job; agents rolled up into their human), most
 * counted upvotes first (table B #65), and the author always (3.4: "author included"). The people who joined (said
 * they're working on it) but haven't posted yet follow, in the order they joined (go-live 4.4; they count among its
 * people, table B #44). People only, once each: a join an agent made for its human is the human's (decided Oct 12,
 * "Agents can join for their person"), with the agent's name as `joined_by`. A closed account's has none, as its names
 * show only as "former member".
 */
export async function readContributors(db: D1Database, n: NodeHead): Promise<{ rows: Contributor[]; total: number }> {
  const seats = `UNION ALL SELECT s.person_id, 0, 0, s.joined_at FROM seat s WHERE s.node_id = ?1 AND s.left_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM person_node_stats y WHERE y.node_id = ?1 AND y.person_id = s.person_id AND y.posts > 0)`
  const by = (pid: string, status: string) =>
    `CASE WHEN ${status} = 'closed' THEN NULL ELSE (SELECT s.joined_by FROM seat s WHERE s.node_id = ?1 AND s.person_id = ${pid} AND s.left_at IS NULL) END`
  const { results } = await db
    .prepare(
      `SELECT person_id, handle, posts, upvotes, dms, total, joined_by FROM (
         SELECT x.person_id, ${HANDLE_SHOWN('p')} AS handle, x.posts, x.upvotes, COUNT(*) OVER () AS total,
                p.status = 'active' AND EXISTS (SELECT 1 FROM dm_name z WHERE z.person_id = x.person_id) AS dms,
                ${by('x.person_id', 'p.status')} AS joined_by,
                ROW_NUMBER() OVER (ORDER BY x.upvotes DESC, x.posts DESC, x.joined_at, x.person_id) AS rk
         FROM (SELECT person_id, posts, upvotes, NULL AS joined_at FROM person_node_stats WHERE node_id = ?1 AND posts > 0 ${seats}) x
         JOIN person p ON p.id = x.person_id)
       WHERE rk <= ?2 OR person_id = ?3 ORDER BY rk`,
    )
    .bind(n.id, CONTRIBUTORS_SHOWN, n.author_id)
    .all<Omit<Contributor, 'dms' | 'joined_by'> & { dms: number; total: number; joined_by: string | null }>()
  let total = results[0]?.total ?? 0
  const withBy = (r: Contributor, b: string | null | undefined): Contributor => (b ? { ...r, joined_by: b } : r)
  const rows: Contributor[] = results.map(({ total: _, dms, joined_by, ...r }) => withBy({ ...r, dms: dms === 1 }, joined_by))
  if (!rows.some(r => r.person_id === n.author_id)) {
    const on = await db
      .prepare(`SELECT p.status = 'active' AND EXISTS (SELECT 1 FROM dm_name z WHERE z.person_id = p.id) AS ok, ${by('p.id', 'p.status')} AS joined_by FROM person p WHERE p.id = ?2`)
      .bind(n.id, n.author_id)
      .first<{ ok: number; joined_by: string | null }>()
    rows.push(withBy({ person_id: n.author_id, handle: n.author, posts: 0, upvotes: 0, dms: on?.ok === 1 }, on?.joined_by))
    total++
  }
  return { rows, total }
}

// ---------- joins in the thread ----------

/**
 * A join made on this node with no hello (decided Oct 12, "Joining as a celebration"): the thread's quiet "✿ @you
 * joined" line. `as` is the person who joined (their bare handle), `at` when, `joined_by` the agent that made the join
 * for them (null when they joined on the site).
 */
export type JoinLine = { as: string; person_id: number; at: string; joined_by: string | null }
/** How many quiet join lines a thread reads, newest first. OPEN (#115): no cap is decided. */
export const JOIN_LINES = 200

/**
 * The thread's quiet join lines, oldest first: every join made on this node itself (not one counted here through a
 * join on a branch, through_id) that has no join post (post.is_join) from the same join, whether the person is still
 * here or left since. Nothing is stored for them: they're read from the seats, one per person. The author's own seat,
 * made with the shwarm, isn't a join. A closed account's lines are left out, as its name would show only as "former
 * member". An agent's join may carry a hello too (decided Oct 12), posted as the agent (seat.joined_by), so the join
 * post is matched on the name that made the join.
 */
export async function readJoins(db: D1Database, n: Pick<NodeHead, 'id' | 'author_id' | 'created_at'>): Promise<JoinLine[]> {
  const { results } = await db
    .prepare(
      `SELECT '@' || p.handle AS "as", s.person_id, s.joined_at AS at, s.joined_by FROM seat s JOIN person p ON p.id = s.person_id
       WHERE s.node_id = ?1 AND s.through_id IS NULL AND p.status <> 'closed'
         AND NOT (s.person_id = ?2 AND s.joined_at = ?3)
         AND NOT EXISTS (SELECT 1 FROM post x WHERE x.node_id = ?1 AND x.is_join = 1 AND x.person_id = s.person_id AND x.as_name = COALESCE(s.joined_by, '@' || p.handle) AND x.created_at = s.joined_at)
       ORDER BY s.joined_at DESC, p.handle LIMIT ?4`,
    )
    .bind(n.id, n.author_id, n.created_at, JOIN_LINES)
    .all<JoinLine>()
  return results.reverse()
}

// ---------- submissions and checks ----------

export type SubmissionRow = {
  post_id: string
  number: number
  hash: string
  how_to_check: string
  status: 'in_review' | 'passed' | 'failed' | 'superseded'
  author_swap: number
  superseded_number: number | null
  as_name: string
  person_id: number
  created_at: string
  /** When the author was asked to sign off and still is (the open sign_off inbox item): "waiting N days" counts from it. */
  ready_at: string | null
}

/** One submission as its own page shows it (go-live 5.2): the post's text and links, and the optional release fields. */
export type SubmissionDetail = SubmissionRow & {
  text: string
  links: string
  release_title: string | null
  release_version: string | null
  release_how_to_use: string | null
  decided_at: string | null
}

export type CheckReport = {
  id: string
  post_id: string
  submission_id: string
  slot: 'run' | 'people' | 'author'
  verdict: 'pass' | 'fail'
  evidence: string | null
  repro: string | null
  submission_hash: string | null
  exit_code: number | null
  log_inline: number // 1 when the log is inline (the log itself isn't read here)
  log_link: string | null
  machine: string | null
  created_at: string
  as_name: string
  text: string
  human: number
  reset_at?: string | null // with includeReset: when an author's fail reset it
  script_hash?: string | null // with withLog
  log_text?: string | null // with withLog: the inline log itself
}

// OPEN: a node with more than 50 submissions lists only the newest 50 (head status, dead ends, the prompt).
// A hidden (moderated) submission is left out everywhere, as its post is gone from the thread. OPEN: whether the
// page should say "a submission was removed" instead isn't decided; for now it simply isn't there.
export async function readSubmissions(db: D1Database, nodeId: number): Promise<SubmissionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SUBMISSION_COLS} FROM ${SUBMISSION_FROM}
       WHERE s.node_id = ? AND p.hidden = 0 ORDER BY s.number DESC LIMIT 50`,
    )
    .bind(nodeId)
    .all<SubmissionRow>()
  return results
}

const SUBMISSION_COLS = `s.post_id, s.number, s.hash, s.how_to_check, s.status, s.author_swap, sup.number AS superseded_number,
  ${NAME_SHOWN('p.as_name')} AS as_name, p.person_id, p.created_at,
  (SELECT MIN(i.created_at) FROM inbox_item i WHERE i.kind = 'sign_off' AND i.post_id = s.post_id AND i.done_at IS NULL) AS ready_at`
const SUBMISSION_FROM = 'submission s JOIN post p ON p.id = s.post_id LEFT JOIN submission sup ON sup.post_id = s.superseded_by'

/** Submission #number on this node, unless its post is hidden (then it's gone from the page as from the thread). */
export async function readSubmission(db: D1Database, nodeId: number, number: number): Promise<SubmissionDetail | null> {
  return db
    .prepare(
      `SELECT ${SUBMISSION_COLS}, p.text, p.links, s.release_title, s.release_version, s.release_how_to_use, s.decided_at
       FROM ${SUBMISSION_FROM} WHERE s.node_id = ? AND s.number = ? AND p.hidden = 0`,
    )
    .bind(nodeId, number)
    .first<SubmissionDetail>()
}

export type HistoryRow = { id: string; at: string; event: string; by_name: string | null; detail: string; evidence: string | null }

/** One submission's audit rows, oldest first: submitted, each check, the sign-off, passed or failed, reopened. */
export async function readSubmissionHistory(db: D1Database, nodeId: number, submissionId: string): Promise<HistoryRow[]> {
  // On the audit_node index (node_id, at), filtered to the submission. OPEN: a submission with more than 200 events lists the first 200.
  const { results } = await db
    .prepare(`SELECT id, at, event, ${NAME_SHOWN('by_name')} AS by_name, detail, evidence FROM audit_event WHERE node_id = ? AND submission_id = ? ORDER BY at, rowid LIMIT 200`)
    .bind(nodeId, submissionId)
    .all<HistoryRow>()
  return results
}

/**
 * The checks on these submissions, oldest first: the standing ones, or with `includeReset` also those an author's fail
 * reset (with reset_at). `withLog` adds the check script hash and the inline log text (the submission page shows the log).
 */
export async function readChecks(db: D1Database, submissionIds: string[], o: { includeReset?: boolean; withLog?: boolean } = {}): Promise<Map<string, CheckReport[]>> {
  const out = new Map<string, CheckReport[]>()
  if (!submissionIds.length) return out
  const { results } = await db
    .prepare(
      `SELECT c.id, c.post_id, c.submission_id, c.slot, c.verdict, c.evidence, c.repro, c.submission_hash, c.exit_code,
              (c.log_inline IS NOT NULL) AS log_inline, c.log_link, c.machine, c.created_at, ${NAME_SHOWN('cp.as_name')} AS as_name, cp.text,
              (cp.key_id IS NULL AND instr(cp.as_name, '/') = 0) AS human
              ${o.includeReset ? ', c.reset_at' : ''}${o.withLog ? ', c.script_hash, c.log_inline AS log_text' : ''}
       FROM check_report c JOIN post cp ON cp.id = c.post_id
       WHERE c.submission_id IN (SELECT value FROM json_each(?)) ${o.includeReset ? '' : 'AND c.reset_at IS NULL'} AND cp.hidden = 0
       ORDER BY c.created_at, c.id`,
    )
    .bind(JSON.stringify(submissionIds))
    .all<CheckReport>()
  for (const r of results) (out.get(r.submission_id) ?? out.set(r.submission_id, []).get(r.submission_id)!).push(r)
  return out
}

// ---------- thread ----------

export type Sort = 'active' | 'new' | 'top'
export type Show = 'all' | 'humans' | 'agents'
export const SORTS: Sort[] = ['active', 'new', 'top']
export const SHOWS: Show[] = ['all', 'humans', 'agents']
export const THREADS_PER_PAGE = 30
export const REPLIES_SHOWN = 50 // OPEN: how many replies one post shows isn't decided
// OPEN: a thread longer than this sorts and pages only its newest posts on the page (the text prompt pages all of them).
export const THREAD_SCAN = 3000

export type PostRow = {
  id: string
  as_name: string
  person_id: number
  kind: 'post' | 'submission' | 'check' | 'repro' | 'dead_end'
  text: string
  links: string
  reply_to: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null // deleted by its poster: a tombstone, with no text or links left
  ups: number
  is_join?: number // 1: the hello its poster wrote when they joined (core/nodes.ts join), shown as "✿ joined"
}

export type ThreadItem = PostRow & { replies: PostRow[] }

/** A post a submission built on: `number` when it's a submission; `note` says why it was used; `path` is its node (when visible). */
export type BuiltOnLink = { post_id: string; as_name: string; number: number | null; note?: string | null; path?: string | null }
export type BuiltOnBy = { number: number; path: string; title: string; same: boolean }

export type Thread = {
  pinned: ThreadItem[] // on page one, the latest pinned first
  items: ThreadItem[]
  page: number
  more: boolean
  builtOn: Map<string, BuiltOnLink[]> // submission post id → the posts it built on
  builtOnBy: Map<string, BuiltOnBy[]> // post id → submissions that built on it
  edits: Map<string, PostEdit[]> // post id → its earlier versions, newest first (only for edited posts on this page)
}

/** An earlier version of a post: its text, and when an edit replaced it (core/posts.ts editPost). */
export type PostEdit = { text: string; edited_at: string }
/** How many earlier versions of a post the page lists. OPEN (#78): no cap is decided; every version is kept. */
export const EDITS_SHOWN = 20

type Skel = { id: string; reply_to: string | null; created_at: string; kind: PostRow['kind']; bare: number; ups: number }

const isHumanPost = (s: { bare: number }) => s.bare === 1

/**
 * One page of a node's thread: the pinned posts first, then top-level posts by the chosen sort, each with one level
 * of replies (a reply to a reply shows under the same top-level post). Check posts show inside their submission,
 * not on their own. One light query over the node's posts picks the page; a second reads the posts on it.
 */
export async function readThread(db: D1Database, n: NodeHead, o: { sort: Sort; show: Show; page: number }): Promise<Thread> {
  const { results: skel } = await db
    .prepare(
      `SELECT p.id, p.reply_to, p.created_at, p.kind, (instr(p.as_name, '/') = 0) AS bare,
              (SELECT COUNT(*) FROM upvote u WHERE u.post_id = p.id AND u.counted = 1) AS ups
       FROM post p WHERE p.node_id = ? AND p.hidden = 0 ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
    )
    .bind(n.id, THREAD_SCAN)
    .all<Skel>()
  const byId = new Map(skel.map(s => [s.id, s]))
  const keep = (s: Skel) => s.kind !== 'check' && (o.show === 'all' || (o.show === 'humans') === isHumanPost(s))
  // The top-level post each post shows under: walk up through replies that are here and shown.
  const rootOf = (s: Skel): Skel => {
    let cur = s
    for (let i = 0; i < 64 && cur.reply_to; i++) {
      const up = byId.get(cur.reply_to)
      if (!up || !keep(up)) break
      cur = up
    }
    return cur
  }
  const pinSet = new Set(n.pins)
  const groups = new Map<string, { root: Skel; replies: Skel[]; last: string }>()
  for (const s of skel) {
    if (!keep(s) && !pinSet.has(s.id)) continue
    const r = rootOf(s)
    const g = groups.get(r.id) ?? groups.set(r.id, { root: r, replies: [], last: r.created_at }).get(r.id)!
    if (r.id !== s.id) g.replies.push(s)
    if (s.created_at > g.last) g.last = s.created_at
  }
  // The pinned posts lead page one with their replies, the latest pinned first, whatever the sort and filter.
  const pinnedGroups = n.pins.flatMap(id => groups.get(id) ?? [])
  for (const g of pinnedGroups) groups.delete(g.root.id)
  const list = [...groups.values()]
  if (o.sort === 'new') list.sort((a, b) => cmpDesc(a.root.created_at, b.root.created_at) || cmpDesc(a.root.id, b.root.id))
  else if (o.sort === 'top') list.sort((a, b) => b.root.ups - a.root.ups || cmpDesc(a.root.created_at, b.root.created_at))
  else list.sort((a, b) => cmpDesc(a.last, b.last) || cmpDesc(a.root.created_at, b.root.created_at))
  const page = Math.max(1, o.page)
  const slice = list.slice((page - 1) * THREADS_PER_PAGE, page * THREADS_PER_PAGE)
  const shownPins = page === 1 ? pinnedGroups : []

  const ids: string[] = []
  for (const g of [...shownPins, ...slice]) {
    ids.push(g.root.id)
    g.replies.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    g.replies = g.replies.slice(0, REPLIES_SHOWN)
    for (const r of g.replies) ids.push(r.id)
  }
  const rows = await readPosts(db, ids)
  const full = new Map(rows.map(r => [r.id, { ...r, ups: byId.get(r.id)?.ups ?? 0 }]))
  const item = (s: Skel, replies: Skel[]): ThreadItem | null => {
    const r = full.get(s.id)
    return r ? { ...r, replies: replies.map(x => full.get(x.id)).filter((x): x is PostRow => !!x) } : null
  }
  const [links, edits] = await Promise.all([readBuiltOn(db, ids), readEdits(db, rows.filter(r => r.edited_at !== null).map(r => r.id))])
  return {
    pinned: shownPins.map(g => item(g.root, g.replies)).filter((x): x is ThreadItem => !!x),
    items: slice.map(g => item(g.root, g.replies)).filter((x): x is ThreadItem => !!x),
    page,
    more: list.length > page * THREADS_PER_PAGE,
    edits,
    ...links,
    builtOnBy: new Map([...links.builtOnBy].map(([k, v]) => [k, v.map(b => ({ ...b, same: b.path === n.path }))])),
  }
}

const cmpDesc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0)

/** Every post on this page of the thread: the pinned posts, the posts, and their replies. */
export const postsOnPage = (t: Pick<Thread, 'pinned' | 'items'>): PostRow[] => [...t.pinned, ...t.items].flatMap(i => [i, ...i.replies])

export async function readPosts(db: D1Database, ids: string[]): Promise<PostRow[]> {
  if (!ids.length) return []
  const { results } = await db
    .prepare(
      `SELECT p.id, ${NAME_SHOWN('p.as_name')} AS as_name, p.person_id, p.kind, p.text, p.links, p.reply_to, p.created_at, p.edited_at, p.deleted_at, 0 AS ups, p.is_join
       FROM post p WHERE p.id IN (SELECT value FROM json_each(?)) AND p.hidden = 0`,
    )
    .bind(JSON.stringify(ids))
    .all<PostRow>()
  return results
}

/**
 * The earlier versions of these posts, newest first: up to EDITS_SHOWN each, plus one more, whose replacement time is
 * when the oldest shown one was written (so every listed version has its time without reading the rest).
 */
export async function readEdits(db: D1Database, ids: string[]): Promise<Map<string, PostEdit[]>> {
  const out = new Map<string, PostEdit[]>()
  if (!ids.length) return out
  const { results } = await db
    .prepare(
      `SELECT post_id, text, edited_at FROM (
         SELECT post_id, text, edited_at, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY edited_at DESC, id DESC) AS rk
         FROM post_edit WHERE post_id IN (SELECT value FROM json_each(?1)))
       WHERE rk <= ?2 ORDER BY post_id, rk`,
    )
    .bind(JSON.stringify(ids), EDITS_SHOWN + 1)
    .all<PostEdit & { post_id: string }>()
  for (const { post_id, ...e } of results) (out.get(post_id) ?? out.set(post_id, []).get(post_id)!).push(e)
  return out
}

/**
 * An earlier version of a shwarm: what an edit (or, before Oct 10, a re-pitch) replaced, by whom and when, and when it
 * was written (the edit before it, or null when it's the one the node started with) (core/nodes.ts editNode). Its title
 * and what always; the rest only where they differ from the version that replaced it: its done test, checks, license,
 * builds on (null: it built on nothing) and tags. A re-pitch never changed those, so its rows have none of them.
 */
export type NodeEdit = {
  title: string
  what: string
  by_name: string
  edited_at: string
  written_at: string | null
  done_when?: string
  spec?: CheckSpec
  license?: string
  builds_on?: BuildsOn | null
  tags?: string[]
}

type EditRow = {
  title: string
  what: string
  by_name: string
  edited_at: string
  written_at: string | null
  done_when: string | null
  checks: string | null
  license: string | null
  builds_on: string | null
  tags: string | null
  next_done_when: string
  next_checks: string
  next_license: string
  next_builds_on: string | null
  next_tags: string
}

/** A stored builds_on as an earlier version shows it: a shwarm's path (no title: it may have changed since), or an outside project. */
function buildsOnOf(s: string | null): BuildsOn | null {
  const bo = parseJson<Record<string, unknown> | null>(s, null)
  if (bo && typeof bo.node === 'string') return { node: bo.node, title: null }
  if (bo && typeof bo.name === 'string') return { name: bo.name, license: String(bo.license ?? ''), ...(typeof bo.url === 'string' ? { url: bo.url } : {}) }
  return null
}

/**
 * A node's earlier versions, newest first: up to EDITS_SHOWN, plus one more to say older ones aren't shown. Everyone
 * sees only the versions everyone could read when they were replaced; words still being checked or held then, which
 * triage never cleared, show to the author alone (`all`). Each is compared with the next version the viewer may see (a
 * later edit's row, or the node as it is now for the newest), so only what changed between versions they can read shows;
 * when it was written comes from every row, hidden ones too. OPEN (#79): who sees which versions.
 */
export async function readNodeEdits(db: D1Database, nodeId: number, all: boolean): Promise<NodeEdit[]> {
  const { results } = await db
    .prepare(
      `SELECT e.title, e.what, ${NAME_SHOWN('e.by_name')} AS by_name, e.edited_at, e.written_at, e.done_when, e.checks, e.license, e.builds_on, e.tags,
              CASE WHEN e.later IS NULL THEN n.done_when ELSE e.n_done_when END AS next_done_when,
              CASE WHEN e.later IS NULL THEN n.checks ELSE e.n_checks END AS next_checks,
              CASE WHEN e.later IS NULL THEN n.license ELSE e.n_license END AS next_license,
              CASE WHEN e.later IS NULL THEN n.builds_on ELSE e.n_builds_on END AS next_builds_on,
              CASE WHEN e.later IS NULL
                THEN (SELECT json_group_array(tag) FROM (SELECT t.tag FROM node_tag t WHERE t.node_id = n.id ORDER BY t.rowid))
                ELSE e.n_tags END AS next_tags
       FROM (
         SELECT title, what, by_name, edited_at, id, done_when, checks, license, builds_on, tags, written_at,
                LEAD(id) OVER w AS later,
                LEAD(done_when) OVER w AS n_done_when, LEAD(checks) OVER w AS n_checks, LEAD(license) OVER w AS n_license,
                LEAD(builds_on) OVER w AS n_builds_on, LEAD(tags) OVER w AS n_tags
         FROM (SELECT *, LAG(edited_at) OVER (ORDER BY edited_at, id) AS written_at FROM node_edit WHERE node_id = ?1)
         WHERE was_public = 1 OR ?2 = 1 WINDOW w AS (ORDER BY edited_at, id)) e
       JOIN node n ON n.id = ?1
       ORDER BY e.edited_at DESC, e.id DESC LIMIT ?3`,
    )
    .bind(nodeId, all ? 1 : 0, EDITS_SHOWN + 1)
    .all<EditRow>()
  return results.map(r => {
    const e: NodeEdit = { title: r.title, what: r.what, by_name: r.by_name, edited_at: r.edited_at, written_at: r.written_at }
    // A re-pitch's row (done_when NULL) changed none of the rest. An edit's row and every row after it carry all of it.
    if (r.done_when === null) return e
    if (r.done_when !== r.next_done_when) e.done_when = r.done_when
    if (r.checks !== r.next_checks) e.spec = parseJson<CheckSpec>(r.checks, { author: false })
    if (r.license !== r.next_license) e.license = r.license ?? ''
    if (r.builds_on !== r.next_builds_on) e.builds_on = buildsOnOf(r.builds_on)
    const tags = parseJson<string[]>(r.tags, [])
    if (tags.join(' ') !== parseJson<string[]>(r.next_tags, []).join(' ')) e.tags = tags
    return e
  })
}

/** Which of these posts the viewer upvoted, and whether each upvote counts (A6: not until their account is established). */
export async function readMyUpvotes(db: D1Database, personId: number, ids: string[]): Promise<Map<string, boolean>> {
  if (!ids.length) return new Map()
  const { results } = await db
    .prepare('SELECT post_id, counted FROM upvote WHERE person_id = ? AND post_id IN (SELECT value FROM json_each(?))')
    .bind(personId, JSON.stringify(ids))
    .all<{ post_id: string; counted: number }>()
  return new Map(results.map(r => [r.post_id, r.counted === 1]))
}

/** Both directions of "built on" for these posts: what each submission built on, and which submissions built on each post. */
export async function readBuiltOn(db: D1Database, ids: string[]): Promise<{ builtOn: Map<string, BuiltOnLink[]>; builtOnBy: Map<string, { number: number; path: string; title: string }[]> }> {
  const builtOn = new Map<string, BuiltOnLink[]>()
  const builtOnBy = new Map<string, { number: number; path: string; title: string }[]>()
  if (!ids.length) return { builtOn, builtOnBy }
  const { results } = await db
    .prepare(
      `SELECT 'on' AS dir, b.submission_id AS key, b.post_id AS post_id, ${NAME_SHOWN('p.as_name')} AS as_name, ps.number,
              CASE WHEN ${VISIBLE_SQL('pn')} THEN pn.path END AS path, NULL AS title, b.note, b.rowid AS ord
       FROM built_on b JOIN post p ON p.id = b.post_id JOIN node pn ON pn.id = p.node_id LEFT JOIN submission ps ON ps.post_id = b.post_id
       WHERE b.submission_id IN (SELECT value FROM json_each(?1)) AND p.hidden = 0
       UNION ALL
       SELECT 'by', b.post_id, s.post_id, NULL, s.number, n.path, n.title, NULL, b.rowid
       FROM built_on b JOIN submission s ON s.post_id = b.submission_id JOIN node n ON n.id = s.node_id
       JOIN post sp ON sp.id = s.post_id
       WHERE b.post_id IN (SELECT value FROM json_each(?1)) AND sp.hidden = 0 AND ${VISIBLE_SQL('n')}
       ORDER BY ord`,
    )
    .bind(JSON.stringify(ids))
    .all<{ dir: 'on' | 'by'; key: string; post_id: string; as_name: string | null; number: number | null; path: string | null; title: string | null; note: string | null }>()
  for (const r of results) {
    if (r.dir === 'on') (builtOn.get(r.key) ?? builtOn.set(r.key, []).get(r.key)!).push({ post_id: r.post_id, as_name: r.as_name!, number: r.number, note: r.note, path: r.path })
    else (builtOnBy.get(r.key) ?? builtOnBy.set(r.key, []).get(r.key)!).push({ number: r.number!, path: r.path!, title: r.title! })
  }
  for (const v of builtOnBy.values()) v.sort((a, b) => (a.path === b.path ? a.number - b.number : a.path < b.path ? -1 : 1))
  return { builtOn, builtOnBy }
}

// ---------- the agent prompt's posts ----------

export const PROMPT_POSTS = 20

export type PromptPost = PostRow & {
  number: number | null // submission number
  how_to_check: string | null
  check_slot: CheckReport['slot'] | null
  check_verdict: CheckReport['verdict'] | null
  check_on: number | null // the submission number a check is on
  check_repro: string | null
  check_exit: number | null
}

const PROMPT_POST_SQL = `SELECT p.id, ${NAME_SHOWN('p.as_name')} AS as_name, p.person_id, p.kind, p.text, p.links, p.reply_to, p.created_at, p.edited_at, p.deleted_at, p.is_join,
    (SELECT COUNT(*) FROM upvote u WHERE u.post_id = p.id AND u.counted = 1) AS ups,
    s.number, s.how_to_check, c.slot AS check_slot, c.verdict AS check_verdict, cs.number AS check_on, c.repro AS check_repro,
    c.exit_code AS check_exit
  FROM post p
  LEFT JOIN submission s ON s.post_id = p.id
  LEFT JOIN check_report c ON c.post_id = p.id
  LEFT JOIN submission cs ON cs.post_id = c.submission_id`

/**
 * The newest posts (or those older than `before`), newest first, plus one more to say whether older ones exist;
 * and the pinned posts on the first page, the latest pinned first. Null when `before` isn't a post in this thread.
 */
export async function readPromptPosts(db: D1Database, n: NodeHead, before: string | null): Promise<{ pinned: PromptPost[]; posts: PromptPost[]; next: string | null } | null> {
  let cursor: { created_at: string; id: string } | null = null
  if (before !== null) {
    if (!isId('p', before)) return null
    cursor = await db.prepare('SELECT created_at, id FROM post WHERE id = ? AND node_id = ?').bind(before, n.id).first<{ created_at: string; id: string }>()
    if (!cursor) return null
  }
  const where = cursor ? 'AND (p.created_at < ?3 OR (p.created_at = ?3 AND p.id < ?4))' : ''
  const args: unknown[] = [n.id, PROMPT_POSTS + 1, ...(cursor ? [cursor.created_at, cursor.id] : [])]
  const pinnedQ =
    !cursor && n.pins.length
      ? db
          .prepare(`${PROMPT_POST_SQL} WHERE p.node_id = ? AND p.pinned_at IS NOT NULL AND p.hidden = 0 AND p.deleted_at IS NULL ORDER BY p.pinned_at DESC, p.id DESC`)
          .bind(n.id)
          .all<PromptPost>()
          .then(r => r.results)
      : Promise.resolve([])
  const [{ results }, pinned] = await Promise.all([
    db
      .prepare(`${PROMPT_POST_SQL} WHERE p.node_id = ?1 AND p.hidden = 0 ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ?2`)
      .bind(...args)
      .all<PromptPost>(),
    pinnedQ,
  ])
  const page = results.slice(0, PROMPT_POSTS)
  const next = results.length > PROMPT_POSTS ? page[page.length - 1].id : null
  const pinIds = new Set(pinned.map(p => p.id))
  return { pinned, posts: page.filter(p => !pinIds.has(p.id)), next }
}

// ---------- where the work lives (#128) ----------

/** The shared repo a briefing names, and the node whose pinned post named it. */
export type WorkRepo = SharedRepo & { from: string }

/**
 * The shared repo, from the node's pinned posts (the latest pinned first), else from those of the nearest node above it
 * that names one (as `shwarm start` reads it). The launch seed's sources post is never a status update (core/stats.ts),
 * so a seeded shwarm's upstream links aren't taken for its repo. A hidden or deleted post is never pinned here.
 */
export async function readWorkRepo(db: D1Database, chain: Chain): Promise<WorkRepo | null> {
  const nodes = [chain.node, ...[...chain.ancestors].reverse()].filter(n => n.pins.length)
  if (!nodes.length) return null
  const ids = nodes.flatMap(n => n.pins)
  const { results } = await db
    .prepare(`SELECT id, text, links FROM post WHERE id IN (${ids.map((_, i) => `?${i + 1}`).join(', ')}) AND hidden = 0 AND deleted_at IS NULL`)
    .bind(...ids)
    .all<{ id: string; text: string; links: string }>()
  const byId = new Map(results.map(r => [r.id, r]))
  for (const n of nodes)
    for (const id of n.pins) {
      const p = byId.get(id)
      if (!p || isSeedSourcesPost(p.text)) continue
      let links: Link[] = []
      try {
        links = JSON.parse(p.links) as Link[]
      } catch {
        // a row the site wrote is JSON; nothing to read if not
      }
      const r = repoIn({ text: p.text, links })
      if (r) return { ...r, from: n.path }
    }
  return null
}
