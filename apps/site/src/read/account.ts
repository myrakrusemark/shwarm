// The account modal's read (go-live 6.2): the owner's private settings. Only for the signed-in owner's own profile;
// read/profile.ts, which serves everyone, never reads these columns.
import { parsePrefs } from '../email/notices'

export type Account = {
  handle: string
  display_name: string
  about: string
  links: string // JSON [{label, url}]
  email: string
  created_at: string
  password_changed_at: string | null
  prefs: Record<string, unknown>
  /** An email change waiting on a click from the new address: the address, and when its link stops working. */
  pending: { email: string; until: string } | null
}

export async function readAccount(db: D1Database, personId: number, now = Date.now()): Promise<Account | null> {
  const [p, t] = await Promise.all([
    db
      .prepare('SELECT handle, display_name, about, links, email, created_at, password_changed_at, notice_prefs FROM person WHERE id = ?')
      .bind(personId)
      .first<Omit<Account, 'prefs' | 'pending'> & { notice_prefs: string }>(),
    db
      .prepare(
        `SELECT new_email, expires_at FROM email_token WHERE person_id = ? AND purpose = 'email_change' AND used_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(personId, new Date(now).toISOString())
      .first<{ new_email: string | null; expires_at: string }>(),
  ])
  if (!p) return null
  const { notice_prefs, ...rest } = p
  return { ...rest, prefs: parsePrefs(notice_prefs), pending: t?.new_email ? { email: t.new_email, until: t.expires_at } : null }
}
