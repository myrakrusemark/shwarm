// The email outbox (go-live 2.6). Every mail is a row written in the same batch as the act that causes it;
// a cron sweep sends due rows through Resend with retries. Callers only ever use enqueueMail / mailStatement.
// Contract shared by sign-up and sign-in (2.5, 2.7) and the sender (2.6). Keep this signature stable.

export type MailStream = 'account' | 'security' | 'notices'
export type MailTemplate =
  | 'verify'
  | 'welcome'
  | 'reset'
  | 'password_changed'
  | 'email_change_new'
  | 'email_change_old'
  | 'signup_existing'

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

export async function enqueueMail(db: D1Database, m: Mail, now?: string): Promise<void> {
  await mailStatement(db, m, now).run()
}
