// A node's audit log (go-live 5.7; spec "The audit log"; protocol §4): GET /w/<path>/log as JSON, and the milestones on a
// closed shwarm's result page. Every row is a recorded act (core/audit.ts), newest first, never generated prose.
//   * a shwarm's log covers its branches (by root_id), a branch's covers itself and the branches under it; each row
//     names its node
//   * branches the public can't see are left out, and so are rows whose submission, check or post is hidden
//   * ?filter=milestones (the default) or all; ?before=<event id> pages back from `next`; `total` counts the filter's
//     rows across every page
//   * a seeded launch shwarm's log starts with "seeded by @myra at launch" (A18), drawn from the node, not stored
import { isId } from '../core/ids'
import { MILESTONE_EVENTS, nodeHref, seededLogRow } from '../core/audit'
import type { Chain } from './node'
import { PUBLIC_NODE } from './visibility'

export type LogFilter = 'milestones' | 'all'
export const LOG_FILTERS: LogFilter[] = ['milestones', 'all']
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
  milestone: boolean
}

export type LogPage = { rows: LogRow[]; total: number; all: number; next: string | null }

const MILESTONE_SQL = `a.event IN (${MILESTONE_EVENTS.map(e => `'${e}'`).join(', ')})`

/**
 * Rows of `n`'s log: its tree's nodes from `n` down (?1 the tree's root id, ?2 n's path, ?3 n's id), the node itself
 * whatever the viewer may see (readChain already decided), the rest only when public. A row tied to a hidden
 * submission post, or whose evidence names a hidden check or post (`#c_…`, `#p_…`), is left out.
 */
const LOG_FROM = `audit_event a
  JOIN node t ON t.id = a.node_id
  LEFT JOIN post sp ON sp.id = a.submission_id
  LEFT JOIN check_report c ON c.id = CASE WHEN instr(a.evidence, '#c_') > 0 THEN substr(a.evidence, instr(a.evidence, '#') + 1) END
  LEFT JOIN post cp ON cp.id = c.post_id
  LEFT JOIN post ap ON ap.id = CASE WHEN instr(a.evidence, '#p_') > 0 THEN substr(a.evidence, instr(a.evidence, '#') + 1) END
  WHERE (t.id = ?1 OR t.root_id = ?1) AND (t.path = ?2 OR substr(t.path, 1, length(?2) + 1) = ?2 || '/')
    AND (t.id = ?3 OR ${PUBLIC_NODE('t')})
    AND sp.hidden IS NOT 1 AND cp.hidden IS NOT 1 AND ap.hidden IS NOT 1`

/**
 * One page of the log, newest first: `limit` rows older than `before`, with `next` when older ones remain, `total`
 * for the filter and `all` for every event. Null when `before` isn't an event in this log.
 */
export async function readLog(db: D1Database, chain: Chain, o: { filter: LogFilter; before: string | null; limit?: number }): Promise<LogPage | null> {
  const n = chain.node
  const limit = o.limit ?? LOG_PAGE
  const scope = [(chain.ancestors[0] ?? n).id, n.path, n.id] as const
  let cursor: { at: string; rid: number } | null = null
  if (o.before !== null) {
    if (!isId('e', o.before)) return null
    cursor = await db.prepare(`SELECT a.at, a.rowid AS rid FROM ${LOG_FROM} AND a.id = ?4`).bind(...scope, o.before).first<{ at: string; rid: number }>()
    if (!cursor) return null
  }
  const only = o.filter === 'milestones' ? `AND ${MILESTONE_SQL}` : ''
  const older = cursor ? 'AND (a.at < ?4 OR (a.at = ?4 AND a.rowid < ?5))' : ''
  const [{ results }, counts] = await Promise.all([
    db
      .prepare(
        `SELECT a.id, a.at, a.event, t.path AS node, t.title, a.by_name AS by, a.submission_id AS submission, a.number, a.detail, a.evidence,
                (${MILESTONE_SQL}) AS milestone
         FROM ${LOG_FROM} ${only} ${older} ORDER BY a.at DESC, a.rowid DESC LIMIT ${limit + 1}`,
      )
      .bind(...scope, ...(cursor ? [cursor.at, cursor.rid] : []))
      .all<Omit<LogRow, 'milestone' | 'evidence'> & { milestone: number; evidence: string | null }>(),
    db.prepare(`SELECT COUNT(*) AS all_, COALESCE(SUM(${MILESTONE_SQL}), 0) AS ms FROM ${LOG_FROM}`).bind(...scope).first<{ all_: number; ms: number }>(),
  ])
  const rows: LogRow[] = results.map(r => ({ ...r, evidence: r.evidence ?? nodeHref(r.node), milestone: r.milestone === 1 }))
  // A18: the seeded node's first row, the oldest of all, so it closes the last page. It counts under both filters.
  const seeded = seededLogRow(n)
  const extra = seeded ? 1 : 0
  const total = (o.filter === 'all' ? counts?.all_ ?? 0 : counts?.ms ?? 0) + extra
  const all = (counts?.all_ ?? 0) + extra
  if (rows.length > limit) return { rows: rows.slice(0, limit), total, all, next: rows[limit - 1].id }
  if (!seeded) return { rows, total, all, next: null }
  // The seeded row goes after the last stored row; when the page is full, it waits for the next one.
  if (rows.length === limit) return { rows, total, all, next: rows[limit - 1].id }
  const row: LogRow = { id: null, at: seeded.at, event: seeded.event, node: n.path, title: n.title, by: seeded.by, submission: null, number: null, detail: seeded.detail, evidence: nodeHref(n.path), milestone: true }
  return { rows: [...rows, row], total, all, next: null }
}

/**
 * The NodeLog JSON (docs/openapi.yaml NodeLog, LogEvent): each row's evidence as an absolute link. The seeded row
 * has no stored event, so its id is null. OPEN (#81): 'seeded' isn't in LogEventType, and a null id isn't an EventId.
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
      milestone: r.milestone,
    })),
  }
}
