// A node's audit log (go-live 5.7; spec "The audit log"; protocol §4): GET /w/<path>/log as JSON. Every row is a
// recorded act (core/audit.ts), newest first, never generated prose.
//   * a shwarm's log covers its branches (by root_id), a branch's covers itself and the branches under it; each row
//     names its node
//   * branches the public can't see are left out, and so are rows whose submission, check or post is hidden
//   * a status change is a row too (decided Oct 14, "One model for every node": every change is a dated line): one to
//     passed is the audit 'passed' row its record wrote (core/status.ts flipStatements); any other is event 'status',
//     read from status_change, since audit_event's events are fixed. A key event, as passes and dead ends are.
//   * ?filter=key (the default) or all; ?before=<event id> pages back from `next`; `total` counts the filter's rows
//     across every page. ?filter=milestones, the name before Oct 9, still works and answers as key
//   * a seeded launch shwarm's log starts with "seeded by @myra at launch" (A18), drawn from the node, not stored
import { isId } from '../core/ids'
import { KEY_EVENTS, nodeHref, seededLogRow } from '../core/audit'
import type { Chain } from './node'
import { NAME_SHOWN } from './names'
import { PUBLIC_NODE } from './visibility'

export type LogFilter = 'key' | 'all'
/** ?filter= as given (absent is key), or null when it's neither; 'milestones' is key's name from before Oct 9. */
export const logFilter = (q: string | undefined): LogFilter | null => (q === undefined || q === 'key' || q === 'milestones' ? 'key' : q === 'all' ? 'all' : null)
export const BAD_FILTER = 'filter is key or all'
/** OPEN: no page size is decided for the JSON log; 50 rows a page. */
export const LOG_PAGE = 50

export type LogRow = {
  id: string | null // null on the seeded row, which isn't stored
  at: string
  event: string
  node: string // the node's path
  title: string
  by: string | null
  submission: string | null
  number: number | null
  detail: string
  evidence: string // a site path
  key: boolean // a key event. Called `milestone` before the v0 freeze (go-live 7.5, OPEN #96: the rename is proposed)
}

export type LogPage = { rows: LogRow[]; total: number; all: number; next: string | null }

/** A status change that isn't to passed (passed is its audit row), as the log names it. */
export const STATUS_EVENT = 'status'
const WORDS = `CASE ? WHEN 'on_track' THEN 'on track' WHEN 'dead_end' THEN 'dead end' ELSE ? END`
const word = (col: string) => WORDS.split('?').join(col)

/**
 * Rows of `n`'s log, audit rows and status changes as one list `a` (src 0 and 1, rid each table's rowid, which orders
 * rows at the same moment), each read from its tree's rows only: its tree's nodes from `n` down (?1 the tree's root id,
 * ?2 n's path, ?3 n's id), the node itself whatever the viewer may see (readChain already decided), the rest only when
 * public. A row tied to a hidden submission post, or whose evidence names a hidden check or post (`#c_…`, `#p_…`), is
 * left out. A migrated status change (migration 0032) repeats an audit row that's already there, so it isn't listed.
 */
const LOG_FROM = `(SELECT x.id, x.at, x.event, x.node_id, x.by_name, x.submission_id, x.number, x.detail, x.evidence,
           x.event IN (${KEY_EVENTS.map(e => `'${e}'`).join(', ')}) AS is_key, 0 AS src, x.rowid AS rid FROM audit_event x
         WHERE x.node_id IN (SELECT id FROM node WHERE id = ?1 OR root_id = ?1)
         UNION ALL
         SELECT h.id, h.at, '${STATUS_EVENT}', h.node_id, NULL, NULL, NULL,
           COALESCE(${word('h.from_status')}, 'no status') || ' → ' || ${word('h.to_status')} || ' · ' || h.backers || ' to ' || h.against,
           '/w/' || hn.path || COALESCE('#' || h.claim_id, ''), 1, 1, h.rowid
         FROM status_change h JOIN node hn ON hn.id = h.node_id
         WHERE (hn.id = ?1 OR hn.root_id = ?1) AND h.to_status <> 'passed' AND h.written_by <> 'migration') a
  JOIN node t ON t.id = a.node_id
  LEFT JOIN post sp ON sp.id = a.submission_id
  LEFT JOIN check_report c ON c.id = CASE WHEN instr(a.evidence, '#c_') > 0 THEN substr(a.evidence, instr(a.evidence, '#') + 1) END
  LEFT JOIN post cp ON cp.id = c.post_id
  LEFT JOIN post ap ON ap.id = CASE WHEN instr(a.evidence, '#p_') > 0 THEN substr(a.evidence, instr(a.evidence, '#') + 1) END
  WHERE (t.id = ?1 OR t.root_id = ?1) AND (t.path = ?2 OR substr(t.path, 1, length(?2) + 1) = ?2 || '/')
    AND (t.id = ?3 OR ${PUBLIC_NODE('t')})
    AND sp.hidden IS NOT 1 AND cp.hidden IS NOT 1 AND ap.hidden IS NOT 1`

/** A log cursor: an audit event's id or a status change's. */
export const isLogId = (s: unknown): s is string => isId('e', s) || isId('h', s)

/**
 * One page of the log, newest first: `limit` rows older than `before`, with `next` when older ones remain, `total`
 * for the filter and `all` for every event. Null when `before` isn't an event in this log.
 */
export async function readLog(db: D1Database, chain: Chain, o: { filter: LogFilter; before: string | null; limit?: number }): Promise<LogPage | null> {
  const n = chain.node
  const limit = o.limit ?? LOG_PAGE
  const scope = [(chain.ancestors[0] ?? n).id, n.path, n.id] as const
  let cursor: { at: string; src: number; rid: number } | null = null
  if (o.before !== null) {
    if (!isLogId(o.before)) return null
    cursor = await db.prepare(`SELECT a.at, a.src, a.rid FROM ${LOG_FROM} AND a.id = ?4`).bind(...scope, o.before).first<{ at: string; src: number; rid: number }>()
    if (!cursor) return null
  }
  const only = o.filter === 'key' ? 'AND a.is_key = 1' : ''
  const older = cursor ? 'AND (a.at < ?4 OR (a.at = ?4 AND (a.src < ?5 OR (a.src = ?5 AND a.rid < ?6))))' : ''
  const [{ results }, counts] = await Promise.all([
    db
      .prepare(
        `SELECT a.id, a.at, a.event, t.path AS node, t.title, ${NAME_SHOWN('a.by_name')} AS by, a.submission_id AS submission, a.number, a.detail, a.evidence,
                a.is_key
         FROM ${LOG_FROM} ${only} ${older} ORDER BY a.at DESC, a.src DESC, a.rid DESC LIMIT ${limit + 1}`,
      )
      .bind(...scope, ...(cursor ? [cursor.at, cursor.src, cursor.rid] : []))
      .all<Omit<LogRow, 'key' | 'evidence'> & { is_key: number; evidence: string | null }>(),
    db.prepare(`SELECT COUNT(*) AS all_, COALESCE(SUM(a.is_key), 0) AS ks FROM ${LOG_FROM}`).bind(...scope).first<{ all_: number; ks: number }>(),
  ])
  const rows: LogRow[] = results.map(({ is_key, ...r }) => ({ ...r, evidence: r.evidence ?? nodeHref(r.node), key: is_key === 1 }))
  // A18: the seeded node's first row, the oldest of all, so it closes the last page. It counts under both filters.
  // OPEN (#93): it isn't one of the four key events, but it stands where a shwarm's opening would; kept under key.
  const seeded = seededLogRow(n)
  const extra = seeded ? 1 : 0
  const total = (o.filter === 'all' ? counts?.all_ ?? 0 : counts?.ks ?? 0) + extra
  const all = (counts?.all_ ?? 0) + extra
  if (rows.length > limit) return { rows: rows.slice(0, limit), total, all, next: rows[limit - 1].id }
  if (!seeded) return { rows, total, all, next: null }
  // The seeded row goes after the last stored row; when the page is full, it waits for the next one.
  if (rows.length === limit) return { rows, total, all, next: rows[limit - 1].id }
  const row: LogRow = { id: null, at: seeded.at, event: seeded.event, node: n.path, title: n.title, by: seeded.by, submission: null, number: null, detail: seeded.detail, evidence: nodeHref(n.path), key: true }
  return { rows: [...rows, row], total, all, next: null }
}

/**
 * The NodeLog JSON (docs/openapi.yaml NodeLog, LogEvent): each row's evidence as an absolute link. The seeded row
 * has no stored event, so its id is null (OPEN #81). `key` marks a key event (OPEN #96: called `milestone` until v0).
 */
export function renderLogJson(path: string, filter: LogFilter, page: LogPage, origin: string) {
  return {
    node: path,
    filter,
    total: page.total,
    next: page.next,
    events: page.rows.map(r => ({
      id: r.id,
      at: r.at,
      event: r.event,
      node: r.node,
      by: r.by,
      ...(r.submission !== null ? { submission: r.submission } : {}),
      ...(r.number !== null ? { number: r.number } : {}),
      detail: r.detail,
      evidence: origin + r.evidence,
      key: r.key,
    })),
  }
}

// ---------- the log's version ----------

/** The tree a log reads: the shwarm and its branches (root_id). */
const TREE = (t: string) => `(${t}.id = ?1 OR ${t}.root_id = ?1)`

/**
 * What else a log shows, as one version for its signed-out ETag (web/node-routes.ts etagOf): the tree's last write and
 * size (a branch's event, a new branch). None of these writes to the node itself, so its own version alone would answer
 * 304 on a stale log.
 */
export async function readTreeVersion(db: D1Database, chain: Chain): Promise<string> {
  const r = await db
    .prepare(`SELECT MAX(t.changed_at) || '.' || COUNT(*) AS tree FROM node t WHERE ${TREE('t')}`)
    .bind((chain.ancestors[0] ?? chain.node).id)
    .first<{ tree: string | null }>()
  return r?.tree ?? '-'
}
