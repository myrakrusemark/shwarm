// The admin console's content side (go-live 9.4): what the queue at /admin reads, and the acts on nodes, posts,
// reports and flags (web/admin-queue.tsx). Each act is one D1 batch: the change, its moderation_action row
// (core/moderation.ts modLog, or the row triage/decide.ts writes itself), and for an act on content the node's version
// (core/context.ts touchNode, the parent's too for a node, since its sidebar lists it) and the site-wide moderation
// version (moderatedStatement), so no cached signed-out page outlives it. Every act writes exactly one row.
//   public rows: hide, unhide, remove_link, clear_triage, block_triage, unpause (acts on content, shown on /moderation)
//   private rows: resolve_report, resolve_flag (nothing public changes, and a public row would say someone reported it)
// Overturning triage and lifting a pause reuse triage/decide.ts, so scripts/triage.mjs and the console write the same rows.
// OPEN: a hidden post has no page of its own, so it simply leaves the thread (as read/node.ts does with hidden = 1); its
// tombstone is its row on the public log. A node gets the 410 tombstone with the reason (read/tombstone.ts).
import { ctxAt, moderatedStatement, touchNode, type Ctx } from './context'
import { isId } from './ids'
import { modLog, modReason } from './moderation'
import { statusLine } from './stats'
import { DecideError, decideStatements, flagsSql, queueSql, unpauseStatements, type Stmt } from '../triage/decide'
import { isCategory } from '../triage/rubric'

/** A refusal: the words to show, and which field they belong to. Nothing was changed. */
export class AdminError extends Error {
  constructor(
    message: string,
    readonly field: 'reason' | 'form' = 'form',
  ) {
    super(message)
  }
}

export type Admin = { personId: number; handle: string }

// OPEN (#107): new wording, every refusal in this file.
export const NEED_REASON = 'say why: one line, up to 500 characters.'

function reasonOf(v: unknown): string {
  const r = modReason(v)
  if (!r) throw new AdminError(NEED_REASON, 'reason')
  return r
}

const stmtsOf = (db: D1Database, s: Stmt[]) => s.map(x => db.prepare(x.sql).bind(...x.args))

// ---------- the queue ----------

/** A triage hold, or a launch shwarm the model flagged or couldn't check (triage/decide.ts queueSql, as `triage.mjs list`). */
export type TriageRow = {
  path: string
  kind: string
  title: string
  triage: string
  seeded: number
  created_at: string
  model: string | null
  answer: string | null
  reason: string | null
  decided_at: string | null
}

/** A node with open flags, or paused (triage/decide.ts flagsSql, as `triage.mjs flags`). */
export type FlagRow = {
  path: string
  kind: string
  title: string
  paused: number
  open: number
  established: number
  reasons: string | null
  by_handles: string | null
  last: string | null
}

/** A report, with what it points at. Admin-only: it names the reporter and carries their words. */
export type ReportRow = {
  id: number
  kind: string
  reason: string | null
  text: string
  contact: string | null
  url: string | null
  created_at: string
  resolved_at: string | null
  resolution: string | null
  node_id: number | null
  post_id: string | null
  node_path: string | null
  node_hidden: number | null
  post_by: string | null
  post_hidden: number | null
  post_deleted: string | null
  by_handle: string | null
}

const REPORT_SQL = `SELECT r.id, r.kind, r.reason, r.text, r.contact, r.url, r.created_at, r.resolved_at, r.resolution, r.node_id, r.post_id,
         COALESCE(n.path, pn.path) AS node_path, COALESCE(n.hidden, pn.hidden) AS node_hidden,
         p.as_name AS post_by, p.hidden AS post_hidden, p.deleted_at AS post_deleted, rp.handle AS by_handle
  FROM report r
  LEFT JOIN post p ON p.id = r.post_id
  LEFT JOIN node n ON n.id = r.node_id
  LEFT JOIN node pn ON pn.id = p.node_id
  LEFT JOIN person rp ON rp.id = r.person_id`

/** A DM's report (core/dm.ts reportDm): its address is 'dm:<id>'. */
export const isDmReport = (r: Pick<ReportRow, 'url'>) => !!r.url?.startsWith('dm:')

export type Queue = { triage: TriageRow[]; flags: FlagRow[]; reports: ReportRow[] }

/** Everything waiting on the operator, each list newest first (flags: paused first). */
export async function readQueue(db: D1Database): Promise<Queue> {
  const [triage, flags, reports] = await Promise.all([
    db.prepare(queueSql()).all<TriageRow>(),
    db.prepare(flagsSql()).all<FlagRow>(),
    db.prepare(`${REPORT_SQL} WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC, r.id DESC LIMIT 200`).all<ReportRow>(),
  ])
  return { triage: triage.results, flags: flags.results, reports: reports.results }
}

// ---------- one node, one post, one report ----------

export type AdminNode = {
  id: number
  path: string
  kind: string
  title: string
  what: string
  state: string
  triage: string
  seeded: number
  hidden: number
  paused: number
  parent_id: number | null
  author_handle: string
  author_status: string
  created_at: string
  last_event_id: string | null
}

export type ModRowShown = { id: number; action: string; node_path: string | null; post_id: string | null; reason: string; public: number; created_at: string; by_handle: string }
export type FlagShown = { id: number; reason: string; created_at: string; resolved_at: string | null; by_handle: string }
export type DecisionShown = { model: string; answer: string; reason: string; created_at: string }
export type PostRowShown = { id: string; as_name: string; kind: string; text: string; hidden: number; deleted_at: string | null; created_at: string }

const MOD_SQL = `SELECT m.id, m.action, n.path AS node_path, m.post_id, m.reason, m.public, m.created_at, p.handle AS by_handle
  FROM moderation_action m JOIN person p ON p.id = m.by_person LEFT JOIN node n ON n.id = m.node_id`

const NODE_SQL = `SELECT n.id, n.path, n.kind, n.title, n.what, n.state, n.triage, n.seeded, n.hidden, n.paused, n.parent_id, n.created_at,
         n.last_event_id, p.handle AS author_handle, p.status AS author_status
  FROM node n JOIN person p ON p.id = n.author_id`

export type NodeView = {
  node: AdminNode
  flags: FlagShown[]
  reports: ReportRow[]
  decisions: DecisionShown[]
  posts: PostRowShown[]
  actions: ModRowShown[]
}

/** One node as the operator sees it, hidden or not: its state, flags, reports, triage decisions, posts and acts. */
export async function readNodeView(db: D1Database, path: string): Promise<NodeView | null> {
  if (!path || path.length > 600) return null
  const node = await db.prepare(`${NODE_SQL} WHERE n.path = ?`).bind(path).first<AdminNode>()
  if (!node) return null
  const [flags, reports, decisions, posts, actions] = await Promise.all([
    db
      .prepare('SELECT f.id, f.reason, f.created_at, f.resolved_at, p.handle AS by_handle FROM flag f JOIN person p ON p.id = f.person_id WHERE f.node_id = ? AND f.post_id IS NULL ORDER BY f.resolved_at IS NULL DESC, f.created_at DESC, f.id DESC')
      .bind(node.id)
      .all<FlagShown>(),
    db
      .prepare(`${REPORT_SQL} WHERE r.node_id = ?1 OR p.node_id = ?1 ORDER BY r.resolved_at IS NULL DESC, r.created_at DESC, r.id DESC LIMIT 100`)
      .bind(node.id)
      .all<ReportRow>(),
    db.prepare('SELECT model, answer, reason, created_at FROM triage_decision WHERE node_id = ? ORDER BY id DESC LIMIT 10').bind(node.id).all<DecisionShown>(),
    db
      .prepare('SELECT id, as_name, kind, text, hidden, deleted_at, created_at FROM post WHERE node_id = ? ORDER BY created_at DESC, id DESC LIMIT 50')
      .bind(node.id)
      .all<PostRowShown>(),
    db
      .prepare(`${MOD_SQL} WHERE m.node_id = ?1 OR m.post_id IN (SELECT id FROM post WHERE node_id = ?1) ORDER BY m.created_at DESC, m.id DESC LIMIT 50`)
      .bind(node.id)
      .all<ModRowShown>(),
  ])
  return { node, flags: flags.results, reports: reports.results, decisions: decisions.results, posts: posts.results, actions: actions.results }
}

/** A link as a post stores it (core/posts.ts): {url, sha256} or {repo, commit, path?}. Shown as given. */
export type PostLink = Record<string, unknown>

export type PostView = {
  post: PostRowShown & { node_id: number; node_path: string; links: PostLink[] }
  reports: ReportRow[]
  actions: ModRowShown[]
}

function linksOf(raw: string | null): PostLink[] {
  try {
    const v = JSON.parse(raw ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** A check's own copies of its links (core/checking.ts): the evidence, the repro's links and the linked log. */
type CheckLinks = { check_id: string | null; evidence: string | null; repro: string | null; log_link: string | null }

const CHECK_LINK_COLS = 'c.id AS check_id, c.evidence, c.repro, c.log_link'

function jsonOf(raw: string | null): unknown {
  try {
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

const reproLinks = (raw: string | null): PostLink[] => {
  const r = jsonOf(raw) as { links?: unknown } | null
  return r && Array.isArray(r.links) ? r.links : []
}
const logLinkOf = (raw: string | null): PostLink[] => {
  const l = jsonOf(raw)
  return l && typeof l === 'object' && !Array.isArray(l) ? [l as PostLink] : []
}

/**
 * Every link a post shows, each once: its own, and for a check those its check_report holds, which the submission page,
 * the text prompt and the API draw from (go-live 9.6). Removing one only from post.links left it showing there.
 */
function shownLinks(postLinks: string, c: CheckLinks): PostLink[] {
  const all = [...linksOf(postLinks), ...(c.check_id ? [...linksOf(c.evidence), ...reproLinks(c.repro), ...logLinkOf(c.log_link)] : [])]
  const seen = new Set<string>()
  return all.filter(l => {
    const k = JSON.stringify(l)
    return seen.has(k) ? false : (seen.add(k), true)
  })
}

export async function readPostView(db: D1Database, id: string): Promise<PostView | null> {
  if (!isId('p', id)) return null
  const row = await db
    .prepare(
      `SELECT p.id, p.node_id, n.path AS node_path, p.as_name, p.kind, p.text, p.links, p.hidden, p.deleted_at, p.created_at, ${CHECK_LINK_COLS}
       FROM post p JOIN node n ON n.id = p.node_id LEFT JOIN check_report c ON c.post_id = p.id WHERE p.id = ?`,
    )
    .bind(id)
    .first<PostRowShown & { node_id: number; node_path: string; links: string } & CheckLinks>()
  if (!row) return null
  const [reports, actions] = await Promise.all([
    db.prepare(`${REPORT_SQL} WHERE r.post_id = ? ORDER BY r.resolved_at IS NULL DESC, r.created_at DESC, r.id DESC`).bind(id).all<ReportRow>(),
    db.prepare(`${MOD_SQL} WHERE m.post_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 50`).bind(id).all<ModRowShown>(),
  ])
  const { check_id, evidence, repro, log_link, ...post } = row
  return { post: { ...post, links: shownLinks(row.links, { check_id, evidence, repro, log_link }) }, reports: reports.results, actions: actions.results }
}

export async function readReport(db: D1Database, id: number): Promise<ReportRow | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return db.prepare(`${REPORT_SQL} WHERE r.id = ?`).bind(id).first<ReportRow>()
}

// ---------- acts on a node ----------

export const NODE_ACTS = ['hide', 'unhide', 'clear', 'block', 'unpause', 'resolve_flags'] as const
export type NodeAct = (typeof NODE_ACTS)[number]
export const isNodeAct = (v: unknown): v is NodeAct => typeof v === 'string' && (NODE_ACTS as readonly string[]).includes(v)

/** The touches every act on a node's content ends with: the node, its parent, the site-wide moderation version. */
function touches(ctx: Ctx, n: Pick<AdminNode, 'id' | 'parent_id'>): D1PreparedStatement[] {
  return [touchNode(ctx, n.id, null), ...(n.parent_id ? [touchNode(ctx, n.parent_id, null)] : []), moderatedStatement(ctx)]
}

/**
 * One act on the node at `path`. `f` is the form: `reason` always; `category` for block; `flag` ('all' or a flag id)
 * for resolve_flags. Throws AdminError, with nothing changed, when the reason is missing or the act changes nothing.
 */
export async function actOnNode(
  db: D1Database,
  by: Admin,
  path: string,
  act: unknown,
  f: { reason?: unknown; category?: unknown; flag?: unknown },
  now = Date.now(),
): Promise<NodeAct> {
  if (!isNodeAct(act)) throw new AdminError('pick an act.')
  const reason = reasonOf(f.reason)
  const n = await db.prepare(`${NODE_SQL} WHERE n.path = ?`).bind(path).first<AdminNode>()
  if (!n) throw new AdminError('there is no node at that path.')
  const ctx = ctxAt(db, now)
  const word = n.kind === 'branch' ? 'branch' : 'shwarm'
  switch (act) {
    case 'hide':
    case 'unhide': {
      const hide = act === 'hide'
      if (!!n.hidden === hide) throw new AdminError(`this ${word} is ${hide ? 'hidden' : 'not hidden'} already.`)
      // Only from the state read: a form sent twice at once changes it and writes its row once.
      const was = { sql: 'EXISTS (SELECT 1 FROM node WHERE id = ? AND hidden = ?)', args: [n.id, n.hidden] }
      await db.batch([
        modLog(db, { by: by.personId, action: act, nodeId: n.id, reason, public: true, at: ctx.at }, was),
        db.prepare('UPDATE node SET hidden = ? WHERE id = ? AND hidden = ?').bind(hide ? 1 : 0, n.id, n.hidden),
        ...touches(ctx, n),
      ])
      return act
    }
    case 'clear':
    case 'block': {
      const to = act === 'clear' ? 'clear' : 'blocked'
      if (n.triage === to) throw new AdminError(`this ${word} is ${to} already.`)
      if (act === 'block' && !isCategory(f.category)) throw new AdminError('pick the category it breaks.')
      let stmts: Stmt[]
      try {
        stmts =
          act === 'clear'
            ? decideStatements({ action: 'clear', path: n.path, reason, by: by.handle, at: ctx.at })
            : decideStatements({ action: 'block', path: n.path, category: String(f.category), reason, by: by.handle, at: ctx.at })
      } catch (e) {
        if (e instanceof DecideError) throw new AdminError(e.message)
        throw e
      }
      // decideStatements writes the moderation_action itself (public), touches the node and its parent and moves the
      // site-wide moderation version: the same file `triage.mjs clear|block` sends. Its rows aren't conditional, so a
      // once-row named by the node and its latest triage decision goes first: a form sent twice at once (both read the
      // same decision) lands once, and the second batch rolls back whole. The hourly prune drops it a day later.
      const last = await db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM triage_decision WHERE node_id = ?').bind(n.id).first<{ id: number }>()
      try {
        await db.batch([
          db.prepare('INSERT INTO auth_throttle (scope, count, window_start) VALUES (?, 0, ?)').bind(`admin:triage:${n.id}:${last?.id ?? 0}`, ctx.at),
          ...stmtsOf(db, stmts),
        ])
      } catch (e) {
        if (/UNIQUE|PRIMARY KEY/i.test(String((e as Error)?.message ?? e))) throw new AdminError(`this ${word} is ${to} already.`)
        throw e
      }
      return act
    }
    case 'unpause': {
      if (!n.paused) throw new AdminError(`this ${word} isn't paused.`)
      // As `triage.mjs unpause`: the public row, every open flag resolved, the node unpaused with a new version. Then
      // the site-wide moderation version, as every act on content ends.
      await db.batch([...stmtsOf(db, unpauseStatements({ path: n.path, reason, by: by.handle, at: ctx.at })), moderatedStatement(ctx)])
      return act
    }
    case 'resolve_flags': {
      const one = f.flag !== 'all'
      const flagId = one ? Number(f.flag) : 0
      if (one && !(Number.isSafeInteger(flagId) && flagId > 0)) throw new AdminError('pick a flag.')
      const where = `node_id = ? AND post_id IS NULL AND resolved_at IS NULL${one ? ' AND id = ?' : ''}`
      const args = one ? [n.id, flagId] : [n.id]
      const open = await db.prepare(`SELECT COUNT(*) AS k FROM flag WHERE ${where}`).bind(...args).first<{ k: number }>()
      if (!open?.k) throw new AdminError(one ? 'that flag is resolved already.' : 'there are no open flags here.')
      // Private: the flags name their flaggers, and nothing public changes (a pause stays until unpause). The row goes
      // first, only while one of them is still open, so a form sent twice at once writes it once.
      await db.batch([
        modLog(db, { by: by.personId, action: 'resolve_flag', nodeId: n.id, reason, public: false, at: ctx.at }, { sql: `EXISTS (SELECT 1 FROM flag WHERE ${where})`, args }),
        db.prepare(`UPDATE flag SET resolved_at = ? WHERE ${where}`).bind(ctx.at, ...args),
      ])
      return act
    }
  }
}

// ---------- acts on a post ----------

export const POST_ACTS = ['hide', 'unhide', 'remove_link'] as const
export type PostAct = (typeof POST_ACTS)[number]
export const isPostAct = (v: unknown): v is PostAct => typeof v === 'string' && (POST_ACTS as readonly string[]).includes(v)

/**
 * One act on post `id`: hide, unhide, or remove_link with `link` (its index in the links /admin/post lists) and `was`
 * (that link as the page showed it, JSON), so a form sent again after the first landed can't take the link that moved up.
 */
export async function actOnPost(db: D1Database, by: Admin, id: string, act: unknown, f: { reason?: unknown; link?: unknown; was?: unknown }, now = Date.now()): Promise<PostAct> {
  if (!isPostAct(act)) throw new AdminError('pick an act.')
  const reason = reasonOf(f.reason)
  const p = isId('p', id)
    ? await db
        .prepare(
          `SELECT p.id, p.node_id, p.kind, p.text, p.links, p.hidden, n.parent_id, ${CHECK_LINK_COLS}
           FROM post p JOIN node n ON n.id = p.node_id LEFT JOIN check_report c ON c.post_id = p.id WHERE p.id = ?`,
        )
        .bind(id)
        .first<{ id: string; node_id: number; kind: string; text: string; links: string; hidden: number; parent_id: number | null } & CheckLinks>()
    : null
  if (!p) throw new AdminError('there is no post with that id.')
  const ctx = ctxAt(db, now)
  const end = [touchNode(ctx, p.node_id, null), moderatedStatement(ctx)]
  if (act === 'remove_link') {
    const links = shownLinks(p.links, p)
    const i = typeof f.link === 'string' && /^\d{1,4}$/.test(f.link) ? Number(f.link) : -1
    if (i < 0 || i >= links.length || f.was !== JSON.stringify(links[i])) throw new AdminError('that link is gone already.')
    const gone = (l: unknown) => JSON.stringify(l) === f.was
    const left = linksOf(p.links).filter(l => !gone(l))
    // Only if the links are still what was read, so two removes at once can't take the wrong one; the row goes first,
    // on the same condition, so a remove that lost that race writes none. A check's links are read from check_report
    // too, so its copies are part of what was read.
    const read = p.check_id
      ? {
          sql: 'EXISTS (SELECT 1 FROM post WHERE id = ? AND links = ?) AND EXISTS (SELECT 1 FROM check_report WHERE id = ? AND evidence IS ? AND repro IS ? AND log_link IS ?)',
          args: [p.id, p.links, p.check_id, p.evidence, p.repro, p.log_link],
        }
      : { sql: 'EXISTS (SELECT 1 FROM post WHERE id = ? AND links = ?)', args: [p.id, p.links] }
    const stmts = [
      modLog(db, { by: by.personId, action: 'remove_link', nodeId: p.node_id, postId: p.id, reason, public: true, at: ctx.at }, read),
      db.prepare(`UPDATE post SET links = ? WHERE id = ? AND ${read.sql}`).bind(JSON.stringify(left), p.id, ...read.args),
    ]
    if (p.check_id) {
      // A check's evidence, its repro's links and its log link are what the submission page shows (go-live 9.6), so the
      // link leaves them too. Run after the post's update, so the post's side of the condition is its links as left.
      // Each copy is rewritten only when the link is in it, so anything else there (a people check's text evidence, the
      // repro's steps) stays as it was.
      const evidence = jsonOf(p.evidence)
      const kept = Array.isArray(evidence) ? evidence.filter(l => !gone(l)) : []
      const evidenceLeft = Array.isArray(evidence) && kept.length < evidence.length ? (kept.length ? JSON.stringify(kept) : null) : p.evidence
      const repro = jsonOf(p.repro) as { links?: unknown } | null
      const reproLeft = repro && Array.isArray(repro.links) && repro.links.some(gone) ? JSON.stringify({ ...repro, links: repro.links.filter(l => !gone(l)) }) : p.repro
      const logLeft = logLinkOf(p.log_link).some(gone) ? null : p.log_link
      stmts.push(
        db
          .prepare(
            `UPDATE check_report SET evidence = ?, repro = ?, log_link = ?
             WHERE id = ? AND evidence IS ? AND repro IS ? AND log_link IS ? AND EXISTS (SELECT 1 FROM post WHERE id = ? AND links = ?)`,
          )
          .bind(evidenceLeft, reproLeft, logLeft, p.check_id, p.evidence, p.repro, p.log_link, p.id, JSON.stringify(left)),
      )
    }
    await db.batch([...stmts, ...end])
    return act
  }
  const hide = act === 'hide'
  if (!!p.hidden === hide) throw new AdminError(`this post is ${hide ? 'hidden' : 'not hidden'} already.`)
  // Only from the state read: a form sent twice at once changes it and writes its row once.
  const was = { sql: 'EXISTS (SELECT 1 FROM post WHERE id = ? AND hidden = ?)', args: [p.id, p.hidden] }
  const deadEnd = p.kind === 'dead_end'
  await db.batch([
    modLog(db, { by: by.personId, action: act, nodeId: p.node_id, postId: p.id, reason, public: true, at: ctx.at }, was),
    // A dead-end note is copied into node.dead_end_note, which the node's page and text, its parent's branch list and the
    // feed's status line read (go-live 9.6). Hiding the post blanks that copy; restoring it puts the post's text back
    // (a dead-end note can't be edited or deleted, so its text is the note). Before the post's update, on its old state.
    ...(deadEnd ? deadEndNoteStatements(db, p, hide, was) : []),
    db.prepare('UPDATE post SET hidden = ? WHERE id = ? AND hidden = ?').bind(hide ? 1 : 0, p.id, p.hidden),
    // A hidden pinned post leaves the feed's status line at once, as a deleted one does (core/posts.ts deletePost); the
    // stats job fills the line in again. It stays pinned, so restoring it brings it back.
    ...(hide
      ? [db.prepare("UPDATE node_stats SET status_line = '' WHERE node_id = ?1 AND EXISTS (SELECT 1 FROM post WHERE id = ?2 AND pinned_at IS NOT NULL)").bind(p.node_id, p.id)]
      : []),
    ...end,
    // The parent's branch list shows a dead end's note, so its page moves too.
    ...(deadEnd && p.parent_id ? [touchNode(ctx, p.parent_id, null)] : []),
  ])
  return act
}

/**
 * The note's copy on the node, and the feed's status line drawn from it (core/stats.ts statusLine): swapped at once
 * rather than left for the stats job, and only where the line is the note's (a pinned post's line stays).
 */
function deadEndNoteStatements(
  db: D1Database,
  p: { id: string; node_id: number; text: string },
  hide: boolean,
  was: { sql: string; args: unknown[] },
): D1PreparedStatement[] {
  const line = (note: string) => statusLine({ state: 'dead_end', pins: [], deadEndNote: note, submissions: [], branches: { live: 0, closed: 0 } })
  const [from, to] = hide ? [p.text, ''] : ['', p.text]
  return [
    db.prepare(`UPDATE node SET dead_end_note = ? WHERE id = ? AND state = 'dead_end' AND ${was.sql}`).bind(to, p.node_id, ...was.args),
    db.prepare(`UPDATE node_stats SET status_line = ? WHERE node_id = ? AND status_line = ? AND ${was.sql}`).bind(line(to), p.node_id, line(from), ...was.args),
  ]
}

// ---------- resolving a report ----------

/** Marks report `id` resolved with the reason as its resolution. A private row: it would name what was reported. */
export async function resolveReport(db: D1Database, by: Admin, id: number, f: { reason?: unknown }, now = Date.now()): Promise<void> {
  const reason = reasonOf(f.reason)
  const r = Number.isSafeInteger(id) && id > 0
    ? await db
        .prepare('SELECT r.id, r.resolved_at, COALESCE(r.node_id, p.node_id) AS node_id, r.post_id FROM report r LEFT JOIN post p ON p.id = r.post_id WHERE r.id = ?')
        .bind(id)
        .first<{ id: number; resolved_at: string | null; node_id: number | null; post_id: string | null }>()
    : null
  if (!r) throw new AdminError('there is no report with that number.')
  if (r.resolved_at) throw new AdminError('this report is resolved already.')
  const at = new Date(now).toISOString()
  // The row first, only while the report is open, so a form sent twice at once resolves it and writes its row once.
  await db.batch([
    modLog(db, { by: by.personId, action: 'resolve_report', nodeId: r.node_id, postId: r.post_id, reason, public: false, at }, {
      sql: 'EXISTS (SELECT 1 FROM report WHERE id = ? AND resolved_at IS NULL)',
      args: [r.id],
    }),
    db.prepare('UPDATE report SET resolved_at = ?, resolution = ? WHERE id = ? AND resolved_at IS NULL').bind(at, reason, r.id),
  ])
}
