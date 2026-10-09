// The audit writer (spec "The audit log", table B #66). One row per recorded event, append-only;
// rows go into the same D1 batch as the act they record. Every row links its evidence as a site path, so the
// log view and GET /w/<path>/log can link each row without guessing (go-live 5.7).
import { newId } from './ids'

export const AUDIT_EVENTS = [
  'lobby_filled',
  'branch_opened',
  'submission',
  'check',
  'passed',
  'failed',
  'dead_end',
  'signed_off',
  'reopened',
] as const
export type AuditEvent = (typeof AUDIT_EVENTS)[number]

// OPEN: which events are milestones is #66. Default: the ones that change a node's state or open a branch.
const MILESTONES = new Set<AuditEvent>(['lobby_filled', 'branch_opened', 'passed', 'dead_end', 'reopened'])

export type AuditRow = {
  event: AuditEvent
  node: number | { path: string } // a path when the node is inserted in the same batch
  by?: string | null // a name, or null when a submission number stands in
  submissionId?: string | null
  number?: number | null
  detail?: string
  evidence: string // a site path: nodeHref, submissionHref, or either with a #post or #check anchor
}

/** A node's page. Paths are slugs joined by '/', so they need no escaping. */
export const nodeHref = (path: string) => `/w/${path}`
/** A submission's page (go-live 5.2), optionally at one check on it (`#c_…`). */
export const submissionHref = (path: string, number: number, checkId?: string) => `/w/${path}/s/${number}${checkId ? '#' + checkId : ''}`

export function auditStatement(db: D1Database, r: AuditRow, at: string): { id: string; stmt: D1PreparedStatement } {
  const id = newId('e')
  const cols = 'INSERT INTO audit_event (id, at, event, node_id, by_name, submission_id, number, detail, evidence, milestone)'
  const rest = [r.by ?? null, r.submissionId ?? null, r.number ?? null, r.detail ?? '', r.evidence, MILESTONES.has(r.event) ? 1 : 0]
  // By path, the row is written only if the node is there: a create whose guarded INSERT wrote nothing writes no event either.
  const stmt =
    typeof r.node === 'number'
      ? db.prepare(`${cols} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, at, r.event, r.node, ...rest)
      : db.prepare(`${cols} SELECT ?, ?, ?, id, ?, ?, ?, ?, ?, ? FROM node WHERE path = ?`).bind(id, at, r.event, ...rest, r.node.path)
  return { id, stmt }
}

/**
 * A18: "seeded by @myra at launch" in each seeded node's audit log. None of the nine event types (#66) records a
 * create, and audit_event's CHECK allows only those, so log views draw this first row from node.seeded instead of
 * storing it. OPEN: a stored tenth event type would need Myra's yes and a rebuild of the append-only table.
 */
export function seededLogRow(n: { seeded: number; created_at: string; posted_by: string }): { at: string; event: 'seeded'; by: string; detail: string } | null {
  return n.seeded === 1 ? { at: n.created_at, event: 'seeded', by: n.posted_by, detail: `seeded by ${n.posted_by} at launch` } : null
}
