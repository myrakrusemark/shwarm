// The moderation log (go-live 9.4, 9.5; A7: "every action is logged publicly"). Every admin act writes one
// moderation_action row in the same D1 batch as the act, through modLog below, so there is no act without its row. A
// public row shows on the public log (/moderation, read/moderation.ts) as its action, target, category, date and who
// acted; never the reporter and never removed text. A private row (public 0) is for acts that name a member who
// didn't act as a moderator, such as the flagger whose flag made a pause (core/flags.ts), or an account's private
// details (marking an email verified, the allow-list).
// The actions, by name (the column is free text; keep this list and the public log's words in step):
export const MOD_ACTIONS = [
  'hide', // a node or post goes behind a public tombstone (410)
  'unhide',
  'remove_link', // one link taken off a post
  'suspend', // an account: sessions end, keys revoked, mail with the reason
  'unsuspend',
  'pause', // a node takes no writes (core/flags.ts, the third established flag)
  'unpause',
  'clear_triage', // the operator overturns triage: the node goes public
  'block_triage', // or is blocked
  'founding', // the founding (invited) flag set or removed on an account
  'unfounding',
  'resend_verify',
  'unsuppress', // an address taken off the mail suppression list
  'mark_verified',
  'end_sessions',
  'allow_add', // the sign-up allow-list
  'allow_remove',
  'resolve_report',
  'resolve_flag',
  'setting', // a site switch: site mode, sign-up, read-only, pause new nodes
] as const
export type ModAction = (typeof MOD_ACTIONS)[number]

/** The reason a public row carries: one line, required, up to this long. */
export const MOD_REASON_MAX = 500

export type ModRow = {
  by: number // the admin's person id
  action: ModAction
  nodeId?: number | null
  postId?: string | null
  personId?: number | null
  reason: string
  public: boolean
  at: string
}

/** A reason as typed: one line, trimmed. Null when it is empty or too long (the form says so). */
export function modReason(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const r = v.replace(/\s+/g, ' ').trim()
  return r && r.length <= MOD_REASON_MAX ? r : null
}

/**
 * The moderation_action INSERT for one act, to go in the act's own batch. `when` (an SQL condition and its binds) makes
 * the row only if it holds: put it before the act's change, with the same condition on the change, so a form sent twice
 * at once (both read the old state) writes neither the change nor the row the second time.
 */
export function modLog(db: D1Database, r: ModRow, when?: { sql: string; args: unknown[] }): D1PreparedStatement {
  const cols = 'INSERT INTO moderation_action (by_person, action, node_id, post_id, person_id, reason, public, created_at)'
  const vals = [r.by, r.action, r.nodeId ?? null, r.postId ?? null, r.personId ?? null, r.reason, r.public ? 1 : 0, r.at]
  if (!when) return db.prepare(`${cols} VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(...vals)
  return db.prepare(`${cols} SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${when.sql}`).bind(...vals, ...when.args)
}
