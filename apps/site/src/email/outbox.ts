// The email outbox (go-live 2.6). Every mail is a row written in the same batch as the act that causes it;
// a cron sweep sends due rows through Resend with retries. Callers only ever use enqueueMail / mailStatement.
// Contract shared by sign-up and sign-in (2.5, 2.7) and the sender (2.6). Keep this signature stable.
// Payloads: account templates take { handle, link }, where link is accountLink('verify', token) from ./templates
// (a path; the sender adds SITE_URL). A notices-stream mail also needs personId and { notice: '<type>' }, which
// names the per-type opt-out in person.notice_prefs. The sender and the row states are in ../jobs/mail.ts.

export type MailStream = 'account' | 'security' | 'notices'
export type MailTemplate =
  | 'verify'
  | 'welcome'
  | 'reset'
  | 'password_changed'
  | 'email_change_new'
  | 'email_change_old'
  | 'signup_existing'
  | 'triage_alert' // to the admins: a node triage held or flagged (go-live 8.1, triage/run.ts)
  | 'sign_off_ready' // to a node's author: a submission waits on their sign-off (go-live 5.4, notice 'sign_off')

export type Mail = {
  to: string
  template: MailTemplate
  stream: MailStream
  payload?: Record<string, unknown> // template data, e.g. { handle, link }
  personId?: number | null
  sendAfter?: string // ISO time; defaults to now
}

/** A prepared INSERT, so the mail commits in the same D1 batch as the act (no mail without the act, no act without the mail). */
export function mailStatement(db: D1Database, m: Mail, now = new Date().toISOString()): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO email_outbox (to_email, person_id, template, stream, payload, created_at, send_after)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(m.to.toLowerCase(), m.personId ?? null, m.template, m.stream, JSON.stringify(m.payload ?? {}), now, m.sendAfter ?? now)
}

/**
 * The same INSERT, made only when `when` (a SQL condition with its own binds) holds as the batch reaches it. For
 * mail that must go once per event even when two runs race: the condition reads state an earlier statement in
 * the same batch is about to change (triage/run.ts puts its alert before the UPDATE that holds the node).
 */
export function mailWhenStatement(db: D1Database, m: Mail, when: string, whenArgs: unknown[], now = new Date().toISOString()): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO email_outbox (to_email, person_id, template, stream, payload, created_at, send_after)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${when}`,
    )
    .bind(m.to.toLowerCase(), m.personId ?? null, m.template, m.stream, JSON.stringify(m.payload ?? {}), now, m.sendAfter ?? now, ...whenArgs)
}

/**
 * A mail to a person by id, addressed inside the batch: one row if they are active, none otherwise (a suspended or
 * closed account gets no notices). For acts in core, which know a person's id but not their address.
 */
export function mailToPersonStatement(db: D1Database, m: Omit<Mail, 'to' | 'personId'> & { personId: number }, now = new Date().toISOString()): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO email_outbox (to_email, person_id, template, stream, payload, created_at, send_after)
       SELECT lower(email), id, ?, ?, ?, ?, ? FROM person WHERE id = ? AND status = 'active'`,
    )
    .bind(m.template, m.stream, JSON.stringify(m.payload ?? {}), now, m.sendAfter ?? now, m.personId)
}

export async function enqueueMail(db: D1Database, m: Mail, now?: string): Promise<void> {
  await mailStatement(db, m, now).run()
}
