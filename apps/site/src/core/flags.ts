// Flags (go-live 9.3, the flag half; A7): "flag this shwarm" / "flag this branch" on a node's page.
//   * Humans only, on the site only: no agent API call flags. Signed in with a verified email and an active account;
//     never the node's own author. Not an act the beta limits (core/site-mode.ts), and not behind the password.
//   * One flag per person per node (migration 0022's index). The reasons are the report's (core/reports.ts) without
//     "something else": the hard blocks (triage/rubric.ts), illegal content, copyright and personal information.
//   * Every flag mails the admins once (template 'node_flag').
//   * The third open flag from established accounts (core/context.ts isEstablished: founding, or established_at passed)
//     pauses the node: it takes no writes (core/context.ts loadNode) and its page says "paused for review" to everyone,
//     until the operator unpauses it (scripts/triage.mjs unpause, triage/decide.ts unpauseStatements), which resolves
//     its open flags so the count starts over. Flags from accounts not yet established are kept and mailed, but don't
//     count toward the pause, even after those accounts become established.
// The count and the pause are one D1 batch, which nothing else interleaves with: two flags at once can't both miss the
// third, or both pause. OPEN (#106): the threshold, the words, and whether a paused shwarm's branches pause with it
// (now they don't) wait on Myra.
import { ShwarmError } from '@shwarm/protocol'
import { mailToAdminsStatement } from '../email/outbox'
import { isEstablished, type PersonRow } from './context'
import { newId } from './ids'
import { REASON_LABEL, REASONS, type Reason } from './reports'

/** What a flag can say is wrong: the report's reasons but "something else" (a flag pauses, so it names a rule). */
export const FLAG_REASONS = REASONS.filter((r): r is Exclude<Reason, 'other'> => r !== 'other')
export type FlagReason = (typeof FLAG_REASONS)[number]
export const isFlagReason = (v: unknown): v is FlagReason => typeof v === 'string' && (FLAG_REASONS as readonly string[]).includes(v)
export const FLAG_LABEL: Record<FlagReason, string> = REASON_LABEL

/** Open flags from established accounts that pause a node. OPEN (#106): the number is A7's; Myra may change it. */
export const PAUSE_AT = 3

/** The pause's moderation_action reason (kept private: by_person is the flagger whose flag made the third). */
export const PAUSE_REASON = `flagged by ${PAUSE_AT} established accounts`

/** An established, active account (core/context.ts isEstablished), as SQL on the person alias `p`, judged when the flag `f` was made. */
const ESTABLISHED_THEN = "p.status = 'active' AND (p.founding = 1 OR (p.established_at IS NOT NULL AND p.established_at <= f.created_at))"

/**
 * The batch's conditions, each SQL with plain placeholders and its binds, read before anything in the batch writes:
 * `fresh`, this person has no flag on the node yet (so the INSERT will go in); `pauses`, that flag makes the third
 * from established accounts on a node not paused yet.
 */
function conditions(nodeId: number, personId: number, at: string, selfCounts: boolean) {
  const fresh = { sql: 'NOT EXISTS (SELECT 1 FROM flag WHERE node_id = ? AND person_id = ? AND post_id IS NULL)', args: [nodeId, personId] }
  // Each earlier flag counts if its account was established when it flagged (as upvotes keep the `counted` they had,
  // A6), so flags from new accounts can't start counting later, once those accounts age in.
  const counted = {
    sql: `(SELECT COUNT(*) FROM flag f JOIN person p ON p.id = f.person_id WHERE f.node_id = ? AND f.post_id IS NULL AND f.resolved_at IS NULL AND ${ESTABLISHED_THEN}) + ?`,
    args: [nodeId, selfCounts ? 1 : 0],
  }
  const pauses = {
    sql: `(SELECT paused FROM node WHERE id = ?) = 0 AND ${fresh.sql} AND ${counted.sql} >= ?`,
    args: [nodeId, ...fresh.args, ...counted.args, PAUSE_AT],
  }
  return { fresh, counted, pauses }
}

const bad = (m: string, field: string) => new ShwarmError('bad_request', m, { field })

/**
 * "flag this shwarm" on node `nodeId` (at `path`) by a signed-in person. 'already' when they flagged it before (no row,
 * no mail); 'paused' when this flag paused it; else 'ok'. A refusal is a ShwarmError whose message is the words to show.
 */
export async function flagNode(
  db: D1Database,
  o: { by: { personId: number }; nodeId: number; path: string; reason: unknown; env?: string; now?: number },
): Promise<'ok' | 'paused' | 'already'> {
  const nowMs = o.now ?? Date.now()
  const at = new Date(nowMs).toISOString()
  // OPEN (#106): new wording, every refusal below.
  const p = await db
    .prepare('SELECT id, handle, status, email_verified_at, founding, established_at, is_admin FROM person WHERE id = ?')
    .bind(o.by.personId)
    .first<PersonRow>()
  if (!p || p.status !== 'active') throw new ShwarmError('not_permitted', "you can't flag right now.", { reason: p?.status ?? 'gone' })
  if (!p.email_verified_at) throw new ShwarmError('not_permitted', 'verify your email first.', { reason: 'unverified' })
  const n = await db
    .prepare('SELECT id, path, kind, title, author_id, paused FROM node WHERE id = ? AND hidden = 0')
    .bind(o.nodeId)
    .first<{ id: number; path: string; kind: string; title: string; author_id: number; paused: number }>()
  const word = n?.kind === 'branch' ? 'branch' : 'shwarm'
  if (!n) throw bad("that isn't here.", 'node')
  if (n.author_id === p.id) throw new ShwarmError('own_work', `you can't flag your own ${word}.`, { field: 'node' })
  if (!isFlagReason(o.reason)) throw bad('pick what is wrong.', 'reason')
  const reason = o.reason
  const c = conditions(n.id, p.id, at, isEstablished(p, nowMs))
  const payload = { by: '@' + p.handle, reason, kind: word, title: n.title, path: n.path, link: `/w/${n.path}`, pause_at: PAUSE_AT, env: o.env ?? '' }
  const [, , pause, ins] = await db.batch([
    // The pause's record, kept private: by_person is the flagger whose flag made the third.
    db
      .prepare(`INSERT INTO moderation_action (by_person, action, node_id, reason, public, created_at) SELECT ?, 'pause', ?, ?, 0, ? WHERE ${c.pauses.sql}`)
      .bind(p.id, n.id, PAUSE_REASON, at, ...c.pauses.args),
    // One mail per admin, only when the flag goes in, saying whether it paused the node (or it was paused already).
    mailToAdminsStatement(db, { template: 'node_flag', stream: 'account', payload }, at, {
      rows: `SELECT CASE WHEN ${c.pauses.sql} THEN 1 ELSE 0 END AS paused, (SELECT paused FROM node WHERE id = ?) AS was_paused, ${c.counted.sql} AS established WHERE ${c.fresh.sql}`,
      args: [...c.pauses.args, n.id, ...c.counted.args, ...c.fresh.args],
      set: "'$.paused', x.paused, '$.was_paused', x.was_paused, '$.established', x.established",
    }),
    // The pause, with a new version (the signed-out ETag) and changed_at, as touchNode: the banner shows at once.
    db
      .prepare(`UPDATE node SET paused = 1, last_event_id = ?, changed_at = ? WHERE id = ? AND ${c.pauses.sql}`)
      .bind(newId('v'), at, n.id, ...c.pauses.args),
    // Last: the conditions above read the table before this row is in it.
    db
      .prepare('INSERT INTO flag (node_id, post_id, person_id, reason, created_at) VALUES (?, NULL, ?, ?, ?) ON CONFLICT DO NOTHING')
      .bind(n.id, p.id, reason, at),
  ])
  if ((ins.meta.changes ?? 0) === 0) return 'already'
  return (pause.meta.changes ?? 0) > 0 ? 'paused' : 'ok'
}

/** Whether the person flagged this node (open or resolved), for "you flagged this" on the page. */
export async function flaggedBy(db: D1Database, personId: number, nodeId: number): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 FROM flag WHERE node_id = ? AND person_id = ? AND post_id IS NULL').bind(nodeId, personId).first())
}

/** The command the operator runs to lift a pause, as the alert mail says it. */
export const unpauseCommand = (path: string, env: string) =>
  `node scripts/triage.mjs unpause ${path} "<reason>" --env ${env === 'staging' || env === 'production' ? env : '<staging|production>'}`
