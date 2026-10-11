// Sessions: one cookie, __Host-shwarm, holding a random token. The database keeps only its sha256,
// so a database copy can't be turned into a signed-in browser. 30-day sliding expiry, rotated at sign-in.
import { sha256, toBase64url, toHex } from '@shwarm/protocol'
import { actsInBeta } from '../core/site-mode'

export const COOKIE = '__Host-shwarm'
export const SESSION_DAYS = 30
const DAY = 86_400_000
const TOUCH_EVERY = 3_600_000 // write last_seen at most hourly

/**
 * `verified`: the person's email is verified. Unverified accounts can read and sign in, nothing else (2.5).
 * `member`: a founding account or the operator, who may act while the site is in beta (core/site-mode.ts).
 * `termsBehind`: the announced terms version when the person hasn't accepted it, else null (go-live 10.2, core/terms.ts).
 */
export type Session = { id: string; personId: number; handle: string; stepUpUntil: string | null; verified: boolean; member: boolean; termsBehind: string | null }

const iso = (ms: number) => new Date(ms).toISOString()

export const sessionId = async (token: string) => toHex(await sha256(token))

/** /24 for IPv4, /48 for IPv6: enough to spot a new network, not enough to pin a person. */
export function ipPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip) // an IPv4 address written as IPv6
  if (mapped) return ipPrefix(mapped[1])
  if (ip.includes(':')) {
    const g = ipv6Groups(ip)
    return g ? g.slice(0, 3).join(':') + '::/48' : null
  }
  const p = ip.split('.')
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0/24` : null
}

/** The 8 groups of an IPv6 address, lowercase without leading zeros, so every spelling of one /48 matches. */
function ipv6Groups(ip: string): string[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, '') // drop a zone id
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s) // ::ffff:1.2.3.4
  if (v4) {
    const b = v4.slice(1).map(Number)
    if (b.some(n => n > 255)) return null
    s = s.slice(0, v4.index) + ((b[0] << 8) | b[1]).toString(16) + ':' + ((b[2] << 8) | b[3]).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const part = (h: string) => (h ? h.split(':') : [])
  const head = part(halves[0])
  const tail = halves.length === 2 ? part(halves[1]) : []
  const fill = 8 - head.length - tail.length
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail]
  if (!groups.every(x => /^[0-9a-f]{1,4}$/.test(x))) return null
  return groups.map(x => parseInt(x, 16).toString(16))
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
      `SELECT s.id, s.person_id, s.last_seen_at, s.expires_at, s.step_up_until, p.handle, p.email_verified_at, p.founding, p.is_admin, p.terms_version,
              (SELECT value FROM setting WHERE key = 'terms_version') AS terms_now FROM session s
       JOIN person p ON p.id = s.person_id WHERE s.id = ? AND p.status = 'active'`,
    )
    .bind(id)
    .first<{ id: string; person_id: number; last_seen_at: string; expires_at: string; step_up_until: string | null; handle: string; email_verified_at: string | null; founding: number; is_admin: number; terms_version: string; terms_now: string | null }>()
  if (!row || Date.parse(row.expires_at) <= now) return null
  if (now - Date.parse(row.last_seen_at) > TOUCH_EVERY) {
    await db.prepare('UPDATE session SET last_seen_at = ?, expires_at = ? WHERE id = ?').bind(iso(now), iso(now + SESSION_DAYS * DAY), id).run()
  }
  return { id, personId: row.person_id, handle: row.handle, stepUpUntil: row.step_up_until, verified: row.email_verified_at !== null, member: actsInBeta(row), termsBehind: termsBehind(row) }
}

/** The announced terms version (the setting, JSON) when it differs from the person's, else null. Plain inequality, not an order. */
function termsBehind(row: { terms_version: string; terms_now: string | null }): string | null {
  if (row.terms_now === null) return null
  let now: unknown
  try {
    now = JSON.parse(row.terms_now)
  } catch {
    return null // unreadable: no banner rather than a broken page
  }
  return typeof now === 'string' && now !== row.terms_version ? now : null
}

export async function endSession(db: D1Database, token: string | undefined) {
  if (token) await db.prepare('DELETE FROM session WHERE id = ?').bind(await sessionId(token)).run()
}

/**
 * "sign out everywhere" (6.2): every session ends, and a pending email change link dies with them, so someone who
 * signed in as the person can't finish moving the account once they're signed out.
 * OPEN (#84): cancelling the pending change here is a builder's default.
 */
export async function endAllSessions(db: D1Database, personId: number) {
  await db.batch([
    db.prepare('DELETE FROM session WHERE person_id = ?').bind(personId),
    db.prepare("UPDATE email_token SET used_at = ? WHERE person_id = ? AND purpose = 'email_change' AND used_at IS NULL").bind(iso(Date.now()), personId),
  ])
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`
}
export const clearCookie = () => `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`
