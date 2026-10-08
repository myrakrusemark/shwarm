// Sessions: one cookie, __Host-shwarm, holding a random token. The database keeps only its sha256,
// so a database copy can't be turned into a signed-in browser. 30-day sliding expiry, rotated at sign-in.
import { sha256, toBase64url, toHex } from '@shwarm/protocol'

export const COOKIE = '__Host-shwarm'
export const SESSION_DAYS = 30
const DAY = 86_400_000
const TOUCH_EVERY = 3_600_000 // write last_seen at most hourly

export type Session = { id: string; personId: number; stepUpUntil: string | null }

const iso = (ms: number) => new Date(ms).toISOString()

export const sessionId = async (token: string) => toHex(await sha256(token))

/** /24 for IPv4, /48 for IPv6: enough to spot a new network, not enough to pin a person. */
export function ipPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::/48'
  const p = ip.split('.')
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0/24` : null
}

/** A short browser summary, not the full user agent. */
export function browserSummary(ua: string | null | undefined): string | null {
  if (!ua) return null
  const name = /Firefox\//.test(ua) ? 'firefox' : /Edg\//.test(ua) ? 'edge' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other'
  const os = /Android/.test(ua) ? 'android' : /iPhone|iPad/.test(ua) ? 'ios' : /Mac OS X/.test(ua) ? 'macos' : /Windows/.test(ua) ? 'windows' : /Linux/.test(ua) ? 'linux' : 'other'
  return `${name} · ${os}`
}

export async function createSession(db: D1Database, personId: number, meta: { ip?: string | null; ua?: string | null }, now = Date.now()) {
  const token = toBase64url(crypto.getRandomValues(new Uint8Array(32)))
  await db
    .prepare('INSERT INTO session (id, person_id, created_at, last_seen_at, expires_at, ip_prefix, browser) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(await sessionId(token), personId, iso(now), iso(now), iso(now + SESSION_DAYS * DAY), ipPrefix(meta.ip), browserSummary(meta.ua))
    .run()
  return token
}

/** The signed-in session for this cookie, sliding its expiry; null if missing, expired or the person can't sign in. */
export async function readSession(db: D1Database, token: string | undefined, now = Date.now()): Promise<Session | null> {
  if (!token || token.length > 100) return null
  const id = await sessionId(token)
  const row = await db
    .prepare(
      `SELECT s.id, s.person_id, s.last_seen_at, s.expires_at, s.step_up_until FROM session s
       JOIN person p ON p.id = s.person_id WHERE s.id = ? AND p.status = 'active'`,
    )
    .bind(id)
    .first<{ id: string; person_id: number; last_seen_at: string; expires_at: string; step_up_until: string | null }>()
  if (!row || Date.parse(row.expires_at) <= now) return null
  if (now - Date.parse(row.last_seen_at) > TOUCH_EVERY) {
    await db.prepare('UPDATE session SET last_seen_at = ?, expires_at = ? WHERE id = ?').bind(iso(now), iso(now + SESSION_DAYS * DAY), id).run()
  }
  return { id, personId: row.person_id, stepUpUntil: row.step_up_until }
}

export async function endSession(db: D1Database, token: string | undefined) {
  if (token) await db.prepare('DELETE FROM session WHERE id = ?').bind(await sessionId(token)).run()
}

/** A password reset or change ends every session (table B). */
export async function endAllSessions(db: D1Database, personId: number) {
  await db.prepare('DELETE FROM session WHERE person_id = ?').bind(personId).run()
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`
}
export const clearCookie = () => `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`
