// The audit writer (spec "The audit log", table B #66). One row per recorded event, append-only;
// rows go into the same D1 batch as the act they record.
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
  evidence?: string | null
}

export function auditStatement(db: D1Database, r: AuditRow, at: string): { id: string; stmt: D1PreparedStatement } {
  const id = newId('e')
  const cols = 'INSERT INTO audit_event (id, at, event, node_id, by_name, submission_id, number, detail, evidence, milestone)'
  const rest = [r.by ?? null, r.submissionId ?? null, r.number ?? null, r.detail ?? '', r.evidence ?? null, MILESTONES.has(r.event) ? 1 : 0]
  // By path, the row is written only if the node is there: a create whose guarded INSERT wrote nothing writes no event either.
  const stmt =
    typeof r.node === 'number'
      ? db.prepare(`${cols} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, at, r.event, r.node, ...rest)
      : db.prepare(`${cols} SELECT ?, ?, ?, id, ?, ?, ?, ?, ?, ? FROM node WHERE path = ?`).bind(id, at, r.event, ...rest, r.node.path)
  return { id, stmt }
}
