// Sign-in, step-up and the acts behind emailed links (go-live 2.7, 2.8).
// Nothing here reveals whether an address has an account: an unknown address is checked against a dummy
// hash (same work as a real one), gets the same answer, and is throttled the same way.
import { sha256, toHex } from '@shwarm/protocol'
import { mailStatement } from '../email/outbox'
import { parseEmail } from './email'
import { hashPassword, PBKDF2_ITERATIONS, verifyPassword } from './password'
import { createSession, ipPrefix, sessionId } from './session'
import { openStepUp } from './stepup'
import { blockedFor, bump, clearThrottle, LIMITS } from './throttle'
import { newToken } from './tokens'

// Well-formed, current settings, matches no password: verifying against it costs what a real check costs.
const DUMMY_HASH = `pbkdf2-sha256$i=${PBKDF2_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
const MAX_INPUT = 1024 // longer "passwords" are refused without hashing

export const ipScope = (ip: string | null) => `auth:ip:${ipPrefix(ip) ?? 'unknown'}`
/** Per-address scope, keyed by a hash of the normalized address, so the table holds no addresses of strangers. */
export async function addrScope(raw: string): Promise<string> {
  const norm = parseEmail(raw)?.norm ?? raw.trim().toLowerCase().slice(0, 254)
  return `auth:addr:${toHex(await sha256(norm)).slice(0, 32)}`
}

type Person = { id: number; password_hash: string; status: string; email_verified_at: string | null; email_norm: string }

export type PasswordCheck = { kind: 'ok'; person: Person } | { kind: 'bad' } | { kind: 'slow'; seconds: number }

/** The shared core of sign-in and step-up: throttle check, password check, backoff on failure. */
async function checkPassword(db: D1Database, pepper: string, person: Person | null, addr: string, password: string, ip: string | null, now: number): Promise<PasswordCheck> {
  const ipS = ipScope(ip)
  const wait = Math.max(await blockedFor(db, ipS, now), await blockedFor(db, addr, now))
  if (wait) return { kind: 'slow', seconds: wait }
  const tooLong = password.length > MAX_INPUT
  const v = await verifyPassword(tooLong ? '' : password, person?.password_hash ?? DUMMY_HASH, pepper)
  if (!v.ok || tooLong || !person || person.status !== 'active') {
    const slow = Math.max(await bump(db, ipS, LIMITS.authIp, now), await bump(db, addr, LIMITS.authAddr, now))
    return slow ? { kind: 'slow', seconds: slow } : { kind: 'bad' }
  }
  await clearThrottle(db, addr)
  if (v.needsRehash) {
    await db.prepare('UPDATE person SET password_hash = ? WHERE id = ?').bind(await hashPassword(password, pepper), person.id).run()
  }
  return { kind: 'ok', person }
}

const PERSON_COLS = 'id, password_hash, status, email_verified_at, email_norm'

export type SignInResult = { kind: 'ok'; token: string; verified: boolean } | { kind: 'bad' } | { kind: 'slow'; seconds: number }

/** Checks the password and makes a new session (with the step-up window open: the password was just entered). */
export async function signIn(db: D1Database, pepper: string, email: string, password: string, meta: { ip: string | null; ua: string | null; now?: number }): Promise<SignInResult> {
  const now = meta.now ?? Date.now()
  const e = parseEmail(email)
  const person = e ? await db.prepare(`SELECT ${PERSON_COLS} FROM person WHERE email_norm = ?`).bind(e.norm).first<Person>() : null
  const r = await checkPassword(db, pepper, person, await addrScope(email), password, meta.ip, now)
  if (r.kind !== 'ok') return r
  const token = await createSession(db, r.person.id, { ip: meta.ip, ua: meta.ua }, now)
  await openStepUp(db, await sessionId(token), now)
  return { kind: 'ok', token, verified: r.person.email_verified_at !== null }
}

/** Re-enter the password on a signed-in session; throttled like sign-in. */
export async function stepUp(db: D1Database, pepper: string, personId: number, sid: string, password: string, ip: string | null, now = Date.now()): Promise<PasswordCheck> {
  const person = await db.prepare(`SELECT ${PERSON_COLS} FROM person WHERE id = ?`).bind(personId).first<Person>()
  const r = await checkPassword(db, pepper, person, await addrScope(person?.email_norm ?? `#${personId}`), password, ip, now)
  if (r.kind === 'ok') await openStepUp(db, sid, now)
  return r
}

/** After the verify button: mark the address verified; an allow-listed address becomes founding and established (A6). */
export async function markVerified(db: D1Database, personId: number, origin: string, nowMs = Date.now()) {
  const now = new Date(nowMs).toISOString()
  const p = await db
    .prepare('SELECT id, handle, email, email_norm, email_verified_at FROM person WHERE id = ?')
    .bind(personId)
    .first<{ id: number; handle: string; email: string; email_norm: string; email_verified_at: string | null }>()
  if (!p || p.email_verified_at) return
  const invited = await db.prepare('SELECT 1 AS ok FROM signup_allow WHERE email_norm = ?').bind(p.email_norm).first()
  const stmts = [db.prepare('UPDATE person SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL').bind(now, p.id)]
  if (invited) {
    stmts.push(
      db.prepare('UPDATE person SET founding = 1, established_at = COALESCE(established_at, ?) WHERE id = ?').bind(now, p.id),
      db.prepare('UPDATE signup_allow SET used_at = COALESCE(used_at, ?) WHERE email_norm = ?').bind(now, p.email_norm),
    )
  }
  stmts.push(
    db.prepare("UPDATE email_token SET used_at = ? WHERE person_id = ? AND purpose = 'verify' AND used_at IS NULL").bind(now, p.id),
    mailStatement(db, { to: p.email, template: 'welcome', stream: 'account', personId: p.id, payload: { handle: p.handle, link: `${origin}/` } }, now),
  )
  await db.batch(stmts)
}

/** Forgot password: a reset link if the address has an active account; nothing otherwise. The page is the same. */
export async function sendReset(db: D1Database, email: string, origin: string, nowMs = Date.now()) {
  const e = parseEmail(email)
  if (!e) return
  const p = await db
    .prepare("SELECT id, handle, email FROM person WHERE email_norm = ? AND status = 'active'")
    .bind(e.norm)
    .first<{ id: number; handle: string; email: string }>()
  if (!p) return
  const { token, stmt } = await newToken(db, p.id, 'reset', nowMs)
  // Per-address caps (3 an hour, 10 a day) are enforced by the outbox sender (2.6).
  await db.batch([
    stmt,
    mailStatement(db, { to: p.email, template: 'reset', stream: 'account', personId: p.id, payload: { handle: p.handle, link: `${origin}/reset?t=${token}` } }, new Date(nowMs).toISOString()),
  ])
}

/** After the reset button (token already used up): new password, every session ended, every other reset link dead, a security mail. */
export async function applyReset(db: D1Database, pepper: string, personId: number, password: string, nowMs = Date.now()) {
  const now = new Date(nowMs).toISOString()
  const p = await db.prepare('SELECT id, handle, email, email_norm FROM person WHERE id = ?').bind(personId).first<{ id: number; handle: string; email: string; email_norm: string }>()
  if (!p) return
  const hash = await hashPassword(password, pepper)
  await db.batch([
    db.prepare('UPDATE person SET password_hash = ? WHERE id = ?').bind(hash, p.id),
    db.prepare('DELETE FROM session WHERE person_id = ?').bind(p.id), // same as endAllSessions, inside the batch
    db.prepare("UPDATE email_token SET used_at = ? WHERE person_id = ? AND purpose = 'reset' AND used_at IS NULL").bind(now, p.id),
    mailStatement(db, { to: p.email, template: 'password_changed', stream: 'security', personId: p.id, payload: { handle: p.handle } }, now),
  ])
  await clearThrottle(db, await addrScope(p.email_norm))
}
