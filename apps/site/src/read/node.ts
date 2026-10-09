import { OPEN_NODE } from './visibility'
// Reads for the node pages and the agent URLs (go-live 3.3, 3.4, 3.6): one node at /w/<path>, its ancestors,
// branches, variants, seats, contributors, submissions with their checks, and its thread. SQL lives here, not in
// the JSX. Each read is a fixed handful of indexed queries, run side by side where they don't depend on each
// other, so a page costs a few round trips whatever the thread's size (Workers Free: 10 ms of CPU).
import { isId } from '../core/ids'
import { MAX_PATH } from '../core/context'
import type { CheckSpec } from '../core/checks'
import type { NodeKind, NodeState } from '../core/context'
import { HAND_MODEL, parseBlockReason } from '../triage/decide'
import type { Category } from '../triage/rubric'

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
 * node is reached sideways (built on, builds on, variant of), not through readChain, which checks the whole chain.
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
export const RESERVED_VIEWS = new Set(['branches', 'log', 's'])

export type ParsedPath = { kind: 'node'; path: string } | { kind: 'view'; path: string; view: string } | { kind: 'bad' }

/** Splits what follows /w/ into a node path, or a node path plus a reserved view (branches, log, s/<n>). */
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
  variant_of_id: number | null
  title: string
  what: string
  done_when: string
  spec: CheckSpec
  lobby_size: number | null
  license: string
  builds_on: BuildsOn | null
  author_id: number
  author: string // bare handle, with @
  posted_by: string
  state: NodeState
  in_review: number
  triage: string
  hidden: number
  seeded: number
  paused: number
  dead_end_note: string | null
  pinned_post_id: string | null
  last_event_id: string | null
  created_at: string
  live_at: string | null
  closed_at: string | null
  changed_at: string | null
  tags: string[]
  stats: NodeStatsRow | null
  variant_of: { path: string; title: string } | null
  visibility: Visibility
  /** A blocked node's category and Myra's reason (her latest triage decision), for its author's banner. */
  blocked: { category: Category; reason: string } | null
}

type HeadRow = Omit<NodeHead, 'spec' | 'builds_on' | 'tags' | 'stats' | 'variant_of' | 'visibility' | 'author' | 'blocked'> & {
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
  v_path: string | null
  v_title: string | null
  v_public: number | null
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
    variant_of_id: r.variant_of_id,
    title: r.title,
    what: r.what,
    done_when: r.done_when,
    spec: parseJson<CheckSpec>(r.checks, { author: false }),
    lobby_size: r.lobby_size,
    license: r.license,
    builds_on,
    author_id: r.author_id,
    author: '@' + r.author_handle,
    posted_by: r.posted_by,
    state: r.state,
    in_review: r.in_review,
    triage: r.triage,
    hidden: r.hidden,
    seeded: r.seeded,
    paused: r.paused,
    dead_end_note: r.dead_end_note,
    pinned_post_id: r.pinned_post_id,
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
    variant_of: r.v_path && r.v_public ? { path: r.v_path, title: r.v_title ?? '' } : null,
    visibility: visibility(r, viewerId),
    blocked: r.triage === 'blocked' ? parseBlockReason(r.block_reason) : null,
  }
}

/** `moderated` is the version of the last moderation act anywhere (core/context.ts moderatedStatement), for the ETag. */
export type Chain = { node: NodeHead; ancestors: NodeHead[]; moderated: string | null }

/**
 * The node at `path` and every node above it, in one query on the path index. Null when any of them is missing
 * or not visible to this viewer: a branch of a hidden or held shwarm is hidden too.
 */
export async function readChain(db: D1Database, path: string, viewerId: number | null): Promise<Chain | null> {
  const want = prefixes(path)
  const { results } = await db
    .prepare(
      `SELECT n.id, n.path, n.kind, n.parent_id, n.variant_of_id, n.title, n.what, n.done_when, n.checks, n.lobby_size, n.license,
              n.builds_on, n.author_id, p.handle AS author_handle, n.posted_by, n.state, n.in_review, n.triage, n.hidden, n.seeded,
              n.paused, n.dead_end_note, n.pinned_post_id, n.last_event_id, n.created_at, n.live_at, n.closed_at, n.changed_at,
              (SELECT group_concat(tag, ' ') FROM (SELECT t.tag FROM node_tag t WHERE t.node_id = n.id ORDER BY t.rowid)) AS tags,
              s.impact AS s_impact, s.posts_per_day AS s_posts_per_day, s.people AS s_people, s.hot AS s_hot, s.upvotes AS s_upvotes,
              s.posts AS s_posts, s.status_line AS s_status_line, s.updated_at AS s_updated_at,
              v.path AS v_path, v.title AS v_title, ${VISIBLE_SQL('v')} AS v_public, bo.title AS bo_title,
              (SELECT value FROM setting WHERE key = 'moderated_at') AS moderated,
              CASE WHEN n.triage = 'blocked' THEN (SELECT d.reason FROM triage_decision d WHERE d.node_id = n.id AND d.model = '${HAND_MODEL}' ORDER BY d.id DESC LIMIT 1) END AS block_reason
       FROM node n
       JOIN person p ON p.id = n.author_id
       LEFT JOIN node_stats s ON s.node_id = n.id
       LEFT JOIN node v ON v.id = n.variant_of_id
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

// ---------- branches and variants ----------

export type Child = {
  path: string
  title: string
  kind: NodeKind
  state: NodeState
  in_review: number
  lobby_size: number | null
  dead_end_note: string | null
  done_when: string
  posted_by: string
  author: string
  seats: number
  impact: number | null
  posts_per_day: number | null
  people: number | null
  status_line: string | null
  created_at: string
}

const STATE_RANK: Record<NodeState, number> = { live: 0, lobby: 0, closed: 1, dead_end: 2 }

/**
 * Branches (parent_id) and variants (variant_of_id) of a node, as the sidebar lists them. PUBLIC_SQL on the child
 * alone is enough: a branch's ancestors are the chain readChain already checked, and a variant is top-level.
 */
export async function readChildren(db: D1Database, nodeId: number): Promise<{ branches: Child[]; variants: Child[] }> {
  // OPEN: no cap on how many branches a sidebar lists is decided; 100 each.
  const { results } = await db
    .prepare(
      `SELECT c.path, c.title, c.kind, c.state, c.in_review, c.lobby_size, c.dead_end_note, c.done_when, c.posted_by, c.created_at,
              '@' || p.handle AS author, s.impact, s.posts_per_day, s.people, s.status_line,
              CASE WHEN c.kind = 'branch' THEN 0 ELSE (SELECT COUNT(*) FROM seat st WHERE st.node_id = c.id AND st.left_at IS NULL) END AS seats
       FROM node c
       JOIN person p ON p.id = c.author_id
       LEFT JOIN node_stats s ON s.node_id = c.id
       WHERE (c.parent_id = ?1 OR c.variant_of_id = ?1) AND ${PUBLIC_SQL('c')}
       LIMIT 200`,
    )
    .bind(nodeId)
    .all<Child>()
  // Branch order as mocked (table B #41): live first, then closed, then dead ends; busiest first within each.
  const order = (a: Child, b: Child) =>
    STATE_RANK[a.state] - STATE_RANK[b.state] || (b.posts_per_day ?? 0) - (a.posts_per_day ?? 0) || (a.created_at < b.created_at ? -1 : 1)
  return {
    branches: results.filter(c => c.kind === 'branch').sort(order).slice(0, 100),
    variants: results.filter(c => c.kind === 'variant').sort(order).slice(0, 100),
  }
}

// ---------- seats ----------

export type Seat = { number: number; person_id: number; handle: string; joined_at: string }
export const SEAT_LIST_MAX = 60 // OPEN: how many seats a lobby lists isn't decided; the rest show as "+ N more"

export async function readSeats(db: D1Database, nodeId: number): Promise<{ filled: number; list: Seat[] }> {
  const { results } = await db
    .prepare(
      `SELECT s.number, s.person_id, '@' || p.handle AS handle, s.joined_at, COUNT(*) OVER () AS filled
       FROM seat s JOIN person p ON p.id = s.person_id
       WHERE s.node_id = ? AND s.left_at IS NULL ORDER BY s.number LIMIT ?`,
    )
    .bind(nodeId, SEAT_LIST_MAX)
    .all<Seat & { filled: number }>()
  return { filled: results[0]?.filled ?? 0, list: results.map(({ filled: _, ...s }) => s) }
}

// ---------- contributors ----------

export type Contributor = { person_id: number; handle: string; posts: number; upvotes: number }
export const CONTRIBUTORS_SHOWN = 7

/**
 * People who posted here (person_node_stats, filled by the stats job; agents rolled up into their human), most
 * counted upvotes first (table B #65), and the author always (3.4: "author included").
 */
export async function readContributors(db: D1Database, n: NodeHead): Promise<{ rows: Contributor[]; total: number }> {
  const { results } = await db
    .prepare(
      `SELECT person_id, handle, posts, upvotes, total FROM (
         SELECT x.person_id, '@' || p.handle AS handle, x.posts, x.upvotes, COUNT(*) OVER () AS total,
                ROW_NUMBER() OVER (ORDER BY x.upvotes DESC, x.posts DESC, x.person_id) AS rk
         FROM person_node_stats x JOIN person p ON p.id = x.person_id
         WHERE x.node_id = ? AND x.posts > 0)
       WHERE rk <= ? OR person_id = ? ORDER BY rk`,
    )
    .bind(n.id, CONTRIBUTORS_SHOWN, n.author_id)
    .all<Contributor & { total: number }>()
  let total = results[0]?.total ?? 0
  const rows: Contributor[] = results.map(({ total: _, ...r }) => r)
  if (!rows.some(r => r.person_id === n.author_id)) {
    rows.push({ person_id: n.author_id, handle: n.author, posts: 0, upvotes: 0 })
    total++
  }
  return { rows, total }
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
}

// OPEN: a node with more than 50 submissions lists only the newest 50 (head status, dead ends, the prompt).
// A hidden (moderated) submission is left out everywhere, as its post is gone from the thread. OPEN: whether the
// page should say "a submission was removed" instead isn't decided; for now it simply isn't there.
export async function readSubmissions(db: D1Database, nodeId: number): Promise<SubmissionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.post_id, s.number, s.hash, s.how_to_check, s.status, s.author_swap, sup.number AS superseded_number,
              p.as_name, p.person_id, p.created_at
       FROM submission s JOIN post p ON p.id = s.post_id LEFT JOIN submission sup ON sup.post_id = s.superseded_by
       WHERE s.node_id = ? AND p.hidden = 0 ORDER BY s.number DESC LIMIT 50`,
    )
    .bind(nodeId)
    .all<SubmissionRow>()
  return results
}

/** The standing checks (not reset by an author's fail) on these submissions, oldest first. */
export async function readChecks(db: D1Database, submissionIds: string[]): Promise<Map<string, CheckReport[]>> {
  const out = new Map<string, CheckReport[]>()
  if (!submissionIds.length) return out
  const { results } = await db
    .prepare(
      `SELECT c.id, c.post_id, c.submission_id, c.slot, c.verdict, c.evidence, c.repro, c.submission_hash, c.exit_code,
              (c.log_inline IS NOT NULL) AS log_inline, c.log_link, c.machine, c.created_at, cp.as_name, cp.text,
              (cp.key_id IS NULL AND instr(cp.as_name, '/') = 0) AS human
       FROM check_report c JOIN post cp ON cp.id = c.post_id
       WHERE c.submission_id IN (SELECT value FROM json_each(?)) AND c.reset_at IS NULL AND cp.hidden = 0
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
  ups: number
}

export type ThreadItem = PostRow & { replies: PostRow[] }

export type BuiltOnLink = { post_id: string; as_name: string; number: number | null }
export type BuiltOnBy = { number: number; path: string; title: string; same: boolean }

export type Thread = {
  pinned: ThreadItem | null
  items: ThreadItem[]
  page: number
  more: boolean
  builtOn: Map<string, BuiltOnLink[]> // submission post id → the posts it built on
  builtOnBy: Map<string, BuiltOnBy[]> // post id → submissions that built on it
}

type Skel = { id: string; reply_to: string | null; created_at: string; kind: PostRow['kind']; bare: number; ups: number }

const isHumanPost = (s: { bare: number }) => s.bare === 1

/**
 * One page of a node's thread: the pinned post first, then top-level posts by the chosen sort, each with one level
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
  const groups = new Map<string, { root: Skel; replies: Skel[]; last: string }>()
  for (const s of skel) {
    if (!keep(s) && s.id !== n.pinned_post_id) continue
    const r = rootOf(s)
    const g = groups.get(r.id) ?? groups.set(r.id, { root: r, replies: [], last: r.created_at }).get(r.id)!
    if (r.id !== s.id) g.replies.push(s)
    if (s.created_at > g.last) g.last = s.created_at
  }
  // The pinned post leads page one with its replies, whatever the sort and filter.
  const pinnedGroup = n.pinned_post_id ? groups.get(n.pinned_post_id) : undefined
  if (pinnedGroup) groups.delete(pinnedGroup.root.id)
  const list = [...groups.values()]
  if (o.sort === 'new') list.sort((a, b) => cmpDesc(a.root.created_at, b.root.created_at) || cmpDesc(a.root.id, b.root.id))
  else if (o.sort === 'top') list.sort((a, b) => b.root.ups - a.root.ups || cmpDesc(a.root.created_at, b.root.created_at))
  else list.sort((a, b) => cmpDesc(a.last, b.last) || cmpDesc(a.root.created_at, b.root.created_at))
  const page = Math.max(1, o.page)
  const slice = list.slice((page - 1) * THREADS_PER_PAGE, page * THREADS_PER_PAGE)
  const showPinned = page === 1 && pinnedGroup !== undefined

  const ids: string[] = []
  for (const g of showPinned ? [pinnedGroup!, ...slice] : slice) {
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
  const links = await readBuiltOn(db, ids)
  return {
    pinned: showPinned ? item(pinnedGroup!.root, pinnedGroup!.replies) : null,
    items: slice.map(g => item(g.root, g.replies)).filter((x): x is ThreadItem => !!x),
    page,
    more: list.length > page * THREADS_PER_PAGE,
    ...links,
    builtOnBy: new Map([...links.builtOnBy].map(([k, v]) => [k, v.map(b => ({ ...b, same: b.path === n.path }))])),
  }
}

const cmpDesc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0)

export async function readPosts(db: D1Database, ids: string[]): Promise<PostRow[]> {
  if (!ids.length) return []
  const { results } = await db
    .prepare(
      `SELECT p.id, p.as_name, p.person_id, p.kind, p.text, p.links, p.reply_to, p.created_at, p.edited_at, 0 AS ups
       FROM post p WHERE p.id IN (SELECT value FROM json_each(?)) AND p.hidden = 0`,
    )
    .bind(JSON.stringify(ids))
    .all<PostRow>()
  return results
}

/** Both directions of "built on" for these posts: what each submission built on, and which submissions built on each post. */
export async function readBuiltOn(db: D1Database, ids: string[]): Promise<{ builtOn: Map<string, BuiltOnLink[]>; builtOnBy: Map<string, { number: number; path: string; title: string }[]> }> {
  const builtOn = new Map<string, BuiltOnLink[]>()
  const builtOnBy = new Map<string, { number: number; path: string; title: string }[]>()
  if (!ids.length) return { builtOn, builtOnBy }
  const { results } = await db
    .prepare(
      `SELECT 'on' AS dir, b.submission_id AS key, b.post_id AS post_id, p.as_name, ps.number, NULL AS path, NULL AS title
       FROM built_on b JOIN post p ON p.id = b.post_id LEFT JOIN submission ps ON ps.post_id = b.post_id
       WHERE b.submission_id IN (SELECT value FROM json_each(?1)) AND p.hidden = 0
       UNION ALL
       SELECT 'by', b.post_id, s.post_id, NULL, s.number, n.path, n.title
       FROM built_on b JOIN submission s ON s.post_id = b.submission_id JOIN node n ON n.id = s.node_id
       JOIN post sp ON sp.id = s.post_id
       WHERE b.post_id IN (SELECT value FROM json_each(?1)) AND sp.hidden = 0 AND ${VISIBLE_SQL('n')}`,
    )
    .bind(JSON.stringify(ids))
    .all<{ dir: 'on' | 'by'; key: string; post_id: string; as_name: string | null; number: number | null; path: string | null; title: string | null }>()
  for (const r of results) {
    if (r.dir === 'on') (builtOn.get(r.key) ?? builtOn.set(r.key, []).get(r.key)!).push({ post_id: r.post_id, as_name: r.as_name!, number: r.number })
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

const PROMPT_POST_SQL = `SELECT p.id, p.as_name, p.person_id, p.kind, p.text, p.links, p.reply_to, p.created_at, p.edited_at,
    (SELECT COUNT(*) FROM upvote u WHERE u.post_id = p.id AND u.counted = 1) AS ups,
    s.number, s.how_to_check, c.slot AS check_slot, c.verdict AS check_verdict, cs.number AS check_on, c.repro AS check_repro,
    c.exit_code AS check_exit
  FROM post p
  LEFT JOIN submission s ON s.post_id = p.id
  LEFT JOIN check_report c ON c.post_id = p.id
  LEFT JOIN submission cs ON cs.post_id = c.submission_id`

/**
 * The newest posts (or those older than `before`), newest first, plus one more to say whether older ones exist;
 * and the pinned post on the first page. Null when `before` isn't a post in this thread.
 */
export async function readPromptPosts(db: D1Database, n: NodeHead, before: string | null): Promise<{ pinned: PromptPost | null; posts: PromptPost[]; next: string | null } | null> {
  let cursor: { created_at: string; id: string } | null = null
  if (before !== null) {
    if (!isId('p', before)) return null
    cursor = await db.prepare('SELECT created_at, id FROM post WHERE id = ? AND node_id = ?').bind(before, n.id).first<{ created_at: string; id: string }>()
    if (!cursor) return null
  }
  const where = cursor ? 'AND (p.created_at < ?3 OR (p.created_at = ?3 AND p.id < ?4))' : ''
  const args: unknown[] = [n.id, PROMPT_POSTS + 1, ...(cursor ? [cursor.created_at, cursor.id] : [])]
  const pinnedQ =
    !cursor && n.pinned_post_id
      ? db.prepare(`${PROMPT_POST_SQL} WHERE p.id = ? AND p.node_id = ? AND p.hidden = 0`).bind(n.pinned_post_id, n.id).first<PromptPost>()
      : Promise.resolve(null)
  const [{ results }, pinned] = await Promise.all([
    db
      .prepare(`${PROMPT_POST_SQL} WHERE p.node_id = ?1 AND p.hidden = 0 ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ?2`)
      .bind(...args)
      .all<PromptPost>(),
    pinnedQ,
  ])
  const page = results.slice(0, PROMPT_POSTS)
  const next = results.length > PROMPT_POSTS ? page[page.length - 1].id : null
  return { pinned: pinned ?? null, posts: page.filter(p => p.id !== pinned?.id), next }
}
