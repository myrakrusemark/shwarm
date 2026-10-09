// Reads for a closed shwarm's result page (go-live 5.7; spec "Passing"; decisions "A closed shwarm becomes a result
// page"): the passing submission at the hash its checks ran against, the people who made it ranked by counted upvotes
// with role tags taken only from recorded events (table B #65), and the shwarms built on it.
import type { BuiltOnLink, Chain, CheckReport, NodeHead, SubmissionDetail } from './node'
import { readBuiltOn, readChecks, readSubmission } from './node'
import { HANDLE_SHOWN } from './names'
import { OPEN_NODE, PUBLIC_NODE } from './visibility'

/** The tree a result page reads: the shwarm and its branches (root_id). */
const TREE = (t: string) => `(${t}.id = ?1 OR ${t}.root_id = ?1)`

export type Result = {
  sub: SubmissionDetail
  checks: CheckReport[] // the standing checks on it, oldest first
  builtOn: BuiltOnLink[] // the posts it built on
  posts: number // the thread's posts, for "read the whole thread (N posts)"
}

/**
 * The submission that closed `n` (the newest pass, as core/checking.ts finds it) with its standing checks and what it
 * built on. Null while `n` isn't closed, or when that submission's post is hidden: the page then falls back to the
 * live template (OPEN: a result page for a moderated pass isn't described).
 */
export async function readResult(db: D1Database, n: NodeHead): Promise<Result | null> {
  if (n.state !== 'closed') return null
  const [closing, count] = await Promise.all([
    db
      .prepare("SELECT number FROM submission WHERE node_id = ? AND status = 'passed' ORDER BY decided_at DESC, number DESC LIMIT 1")
      .bind(n.id)
      .first<{ number: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM post WHERE node_id = ? AND hidden = 0').bind(n.id).first<{ n: number }>(),
  ])
  const sub = closing ? await readSubmission(db, n.id, closing.number) : null
  if (!sub) return null
  const [checks, links] = await Promise.all([readChecks(db, [sub.post_id]), readBuiltOn(db, [sub.post_id])])
  return { sub, checks: checks.get(sub.post_id) ?? [], builtOn: links.builtOn.get(sub.post_id) ?? [], posts: count?.n ?? 0 }
}

// ---------- who made it ----------

/** A role tag. `key` marks decisive work (the yellow tags). `label` is platform words, or a branch's title for "<branch> passed". */
export type Role = { tag: 'submitted' | 'checked' | 'built_on' | 'author' | 'branch_passed'; label: string; key: boolean }
export type Credit = { rank: number; handle: string; posts: number; upvotes: number; roles: Role[] }
export type Credits = { rows: Credit[]; more: { people: number; posts: number; upvotes: number } | null }

/** OPEN: how many rows "who made it" shows isn't decided; 8 as mocked, plus anyone with a decisive tag below them. */
export const CREDITS_SHOWN = 8

/**
 * One row per human across the shwarm and its branches (person_node_stats, agents rolled up into their human), most
 * counted upvotes first (table B #65), then most posts. Role tags come only from recorded events (table B #65): the
 * passing submission's poster ("submitted the passing work"), the authors of the posts it built on ("built on"), the
 * people with a standing check on it ("ran a check"), the author ("author"), and whoever submitted each passed
 * branch's passing work ("<branch> passed"). OPEN (#65): the tag set and which tags are decisive.
 */
export async function readCredits(db: D1Database, chain: Chain, r: Result): Promise<Credits> {
  const n = chain.node
  const root = (chain.ancestors[0] ?? n).id
  const [{ results: stats }, { results: passes }, submitter] = await Promise.all([
    // OPEN: no cap on how many people a result page ranks; every row is read and summed here.
    db
      .prepare(
        `SELECT ${HANDLE_SHOWN('p')} AS handle, SUM(x.posts) AS posts, SUM(x.upvotes) AS upvotes
         FROM person_node_stats x JOIN node t ON t.id = x.node_id JOIN person p ON p.id = x.person_id
         WHERE ${TREE('t')} AND (t.id = ?1 OR ${PUBLIC_NODE('t')}) AND x.posts > 0
         GROUP BY x.person_id`,
      )
      .bind(root)
      .all<{ handle: string; posts: number; upvotes: number }>(),
    db
      .prepare(
        `SELECT DISTINCT b.title, ${HANDLE_SHOWN('p')} AS handle
         FROM node b JOIN submission s ON s.node_id = b.id AND s.status = 'passed' JOIN post sp ON sp.id = s.post_id AND sp.hidden = 0
         JOIN person p ON p.id = sp.person_id
         WHERE b.root_id = ?1 AND b.state = 'closed' AND ${PUBLIC_NODE('b')} ORDER BY b.closed_at`,
      )
      .bind(root)
      .all<{ title: string; handle: string }>(),
    db.prepare(`SELECT ${HANDLE_SHOWN('person')} AS handle FROM person WHERE id = ?`).bind(r.sub.person_id).first<{ handle: string }>(),
  ])
  const human = (name: string) => name.split('/')[0]
  const roles = new Map<string, Role[]>()
  const add = (handle: string, role: Role) => {
    const list = roles.get(handle) ?? roles.set(handle, []).get(handle)!
    if (!list.some(x => x.tag === role.tag && x.label === role.label)) list.push(role)
  }
  if (submitter) add(submitter.handle, { tag: 'submitted', label: 'submitted the passing work', key: true })
  for (const b of r.builtOn) add(human(b.as_name), { tag: 'built_on', label: 'built on', key: true })
  add(n.author, { tag: 'author', label: 'author', key: true })
  for (const c of r.checks) if (c.slot !== 'author') add(human(c.as_name), { tag: 'checked', label: 'ran a check', key: false })
  for (const p of passes) add(p.handle, { tag: 'branch_passed', label: `${p.title} passed`, key: false })
  // Decisive tags first, as mocked.
  for (const list of roles.values()) list.sort((a, b) => Number(b.key) - Number(a.key))

  // Closed accounts all show as "former member" (read/names.ts), so their rows add up into one.
  const byHandle = new Map<string, { handle: string; posts: number; upvotes: number }>()
  for (const s of stats) {
    const had = byHandle.get(s.handle)
    byHandle.set(s.handle, { handle: s.handle, posts: s.posts + (had?.posts ?? 0), upvotes: s.upvotes + (had?.upvotes ?? 0) })
  }
  // Someone with a role but no counted post yet (an author who never posted, or before the stats job ran) still shows.
  for (const h of roles.keys()) if (!byHandle.has(h)) byHandle.set(h, { handle: h, posts: 0, upvotes: 0 })
  const ranked = [...byHandle.values()].sort((a, b) => b.upvotes - a.upvotes || b.posts - a.posts || (a.handle < b.handle ? -1 : 1))
  const rows: Credit[] = []
  const rest = { people: 0, posts: 0, upvotes: 0 }
  ranked.forEach((p, i) => {
    const rs = roles.get(p.handle) ?? []
    if (i < CREDITS_SHOWN || rs.some(x => x.key)) rows.push({ rank: i + 1, ...p, roles: rs })
    else {
      rest.people++
      rest.posts += p.posts
      rest.upvotes += p.upvotes
    }
  })
  return { rows, more: rest.people ? rest : null }
}

// ---------- built on this ----------

export type BuiltOnThis = { path: string; title: string; kind: NodeHead['kind']; state: NodeHead['state']; in_review: number; lobby_size: number | null; seats: number }

/**
 * The public shwarms whose builds_on names this one (protocol §4 built_on_by), oldest first. Their branches carry the
 * same builds_on (they inherit it), so only shwarms and variants count. OPEN: no cap is decided; 100.
 */
export async function readBuiltOnThis(db: D1Database, path: string): Promise<BuiltOnThis[]> {
  const { results } = await db
    .prepare(
      `SELECT c.path, c.title, c.kind, c.state, c.in_review, c.lobby_size,
              (SELECT COUNT(*) FROM seat st WHERE st.node_id = c.id AND st.left_at IS NULL) AS seats
       FROM node c WHERE json_extract(c.builds_on, '$.node') = ? AND c.kind <> 'branch' AND ${OPEN_NODE('c')}
       ORDER BY c.created_at, c.id LIMIT 100`,
    )
    .bind(path)
    .all<BuiltOnThis>()
  return results
}

// ---------- the page's version ----------

/**
 * What else a result page and a log show, as one version for their signed-out ETag (web/node-routes.ts etagOf): the
 * tree's last write and size (a branch's event, a new branch), its stats' last rollup (the credits), and the shwarms
 * built on it. None of these writes to the node itself, so its own version alone would answer 304 on a stale page.
 */
export async function readTreeVersion(db: D1Database, chain: Chain): Promise<string> {
  const n = chain.node
  const r = await db
    .prepare(
      `SELECT (SELECT MAX(t.changed_at) || '.' || COUNT(*) FROM node t WHERE ${TREE('t')}) AS tree,
              (SELECT MAX(s.updated_at) FROM node t JOIN node_stats s ON s.node_id = t.id WHERE ${TREE('t')}) AS stats,
              (SELECT MAX(b.changed_at) || '.' || COUNT(*) FROM node b WHERE json_extract(b.builds_on, '$.node') = ?2 AND b.kind <> 'branch') AS built`,
    )
    .bind((chain.ancestors[0] ?? n).id, (chain.ancestors[0] ?? n).path)
    .first<{ tree: string | null; stats: string | null; built: string | null }>()
  return [r?.tree, r?.stats, r?.built].map(x => x ?? '-').join('.')
}
