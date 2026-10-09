// Emailed links (verify, reset, email change). The link carries a random token; the database keeps only its sha256.
// Opening the link (GET) only looks the token up; the page's button (POST) uses it, so a mail scanner that
// fetches every link leaves it working. Single use, expiring.
import { sha256, toBase64url, toHex } from '@shwarm/protocol'

const HOUR = 3_600_000
// OPEN (#84): an email-change link lasts 24 hours (go-live 6.2 default; no decided number).
export const TOKEN_TTL = { verify: 7 * 24 * HOUR, reset: HOUR, email_change: 24 * HOUR } as const
export type Purpose = keyof typeof TOKEN_TTL

const iso = (ms: number) => new Date(ms).toISOString()
export const tokenId = async (token: string) => toHex(await sha256(token))

/**
 * A new token and the INSERT that stores its hash (run it in the same batch as the mail that carries it). An email
 * change keeps the address it moves to (`newEmail`) on the token, so nothing changes on the account until it's used.
 */
export async function newToken(db: D1Database, personId: number, purpose: Purpose, now = Date.now(), newEmail: string | null = null) {
  const token = toBase64url(crypto.getRandomValues(new Uint8Array(32)))
  const stmt = db
    .prepare('INSERT INTO email_token (id, person_id, purpose, new_email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await tokenId(token), personId, purpose, newEmail, iso(now), iso(now + TOKEN_TTL[purpose]))
  return { token, stmt }
}

const usable = (t: unknown): t is string => typeof t === 'string' && t.length > 0 && t.length <= 100

/** The person a usable token belongs to, without using it up. */
export async function peekToken(db: D1Database, token: unknown, purpose: Purpose, now = Date.now()): Promise<number | null> {
  if (!usable(token)) return null
  const row = await db
    .prepare(
      `SELECT t.person_id FROM email_token t JOIN person p ON p.id = t.person_id
       WHERE t.id = ? AND t.purpose = ? AND t.used_at IS NULL AND t.expires_at > ? AND p.status = 'active'`,
    )
    .bind(await tokenId(token), purpose, iso(now))
    .first<{ person_id: number }>()
  return row?.person_id ?? null
}

/** Use the token up, atomically: only one POST can win. Returns its person, or null if it was already used or expired. */
export async function consumeToken(db: D1Database, token: unknown, purpose: Purpose, now = Date.now()): Promise<number | null> {
  if (!usable(token)) return null
  const row = await db
    .prepare(
      `UPDATE email_token SET used_at = ? WHERE id = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
       AND person_id IN (SELECT id FROM person WHERE status = 'active') RETURNING person_id`,
    )
    .bind(iso(now), await tokenId(token), purpose, iso(now))
    .first<{ person_id: number }>()
  return row?.person_id ?? null
}

export type EmailChange = { personId: number; newEmail: string }

/** The account and new address of a usable email-change token, without using it up. */
export async function peekEmailChange(db: D1Database, token: unknown, now = Date.now()): Promise<EmailChange | null> {
  if (!usable(token)) return null
  const row = await db
    .prepare(
      `SELECT t.person_id, t.new_email FROM email_token t JOIN person p ON p.id = t.person_id
       WHERE t.id = ? AND t.purpose = 'email_change' AND t.used_at IS NULL AND t.expires_at > ? AND p.status = 'active'`,
    )
    .bind(await tokenId(token), iso(now))
    .first<{ person_id: number; new_email: string | null }>()
  return row?.new_email ? { personId: row.person_id, newEmail: row.new_email } : null
}

/** Uses an email-change token up, atomically, as consumeToken does. Returns its account and new address, or null. */
export async function consumeEmailChange(db: D1Database, token: unknown, now = Date.now()): Promise<EmailChange | null> {
  if (!usable(token)) return null
  const row = await db
    .prepare(
      `UPDATE email_token SET used_at = ? WHERE id = ? AND purpose = 'email_change' AND used_at IS NULL AND expires_at > ?
       AND new_email IS NOT NULL AND person_id IN (SELECT id FROM person WHERE status = 'active') RETURNING person_id, new_email`,
    )
    .bind(iso(now), await tokenId(token), iso(now))
    .first<{ person_id: number; new_email: string }>()
  return row ? { personId: row.person_id, newEmail: row.new_email } : null
}
