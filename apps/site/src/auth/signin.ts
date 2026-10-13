// Sign-in, step-up and the acts behind emailed links (go-live 2.7, 2.8).
// Nothing here reveals whether an address has an account: an unknown address is checked against a dummy
// hash (same work as a real one), gets the same answer, and is throttled the same way.
import { sha256, toHex } from '@shwarm/protocol'
import { mailStatement } from '../email/outbox'
import { parseEmail } from './email'
import { hashPassword, PBKDF2_ITERATIONS, verifyPassword } from './password'
import { createSession, ipPrefix, sessionId, type Session } from './session'
import { openStepUp, STEP_UP_MS, stepUpOpen } from './stepup'
import { clearThrottle, LIMITS, stamp, type Limit } from './throttle'
import { newToken } from './tokens'
import { fill, w } from '../words'

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

/** Misses for one address from one network: says whether that network is clean for that address. */
const netScope = (addr: string, ip: string | null) => `${addr}:net:${ipPrefix(ip) ?? 'unknown'}`

/** A network this address signed in from lately (count 0, window_start = the last good sign-in there). */
const knownScope = (addr: string, net: string) => `${addr}:known:${net}`
export const KNOWN_NETWORK_DAYS = 30 // IP-derived data is kept 30 days (#61)

/**
 * A blocked address still lets its owner in from a familiar network: one this address signed in from in the
 * last 30 days, with no misses for this address since the window began. So wrong passwords sent from
 * elsewhere can't keep the owner out, and a guesser gains nothing unless they're on the owner's own network.
 * OPEN (open-questions #70): the trade-off; a password reset still gets anyone in.
 */
async function familiar(db: D1Database, addr: string, ip: string | null, atNet: Reserved, now: number): Promise<boolean> {
  const net = ipPrefix(ip)
  // this try is already counted for the network (reserve), so clean means it's the only one
  if (!net || atNet.count !== 1) return false
  const row = await db.prepare('SELECT window_start FROM auth_throttle WHERE scope = ?').bind(knownScope(addr, net)).first<{ window_start: string }>()
  return !!row && now - Date.parse(row.window_start) < KNOWN_NETWORK_DAYS * 86_400_000
}

const iso = (ms: number) => new Date(ms).toISOString()

type Reserved = { count: number; blocked_until: string | null }

/**
 * Counts this try in `scope` before its password is checked, and says in the same statement where the scope stands
 * (go-live 9.6). Reading the count first and bumping it after let concurrent guesses all pass the read before any
 * bump landed, so a burst got far past the limit. Same windows and blocks as bump() (throttle.ts), except a blocked
 * scope still counts the try (only the count moves): count > tripAt means it was blocked before this try, and
 * count === tripAt means this try blocks it.
 */
async function reserve(db: D1Database, scope: string, limit: Limit, now: number): Promise<Reserved> {
  const row = await db
    .prepare(
      `INSERT INTO auth_throttle (scope, count, window_start, blocked_until) VALUES (?1, 1, ?2, CASE WHEN 1 >= ?5 THEN ?4 END)
       ON CONFLICT (scope) DO UPDATE SET
         count = CASE WHEN blocked_until > ?2 THEN count + 1 WHEN blocked_until IS NOT NULL OR window_start <= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN blocked_until > ?2 THEN window_start WHEN blocked_until IS NOT NULL OR window_start <= ?3 THEN ?2 ELSE window_start END,
         blocked_until = CASE
           WHEN blocked_until > ?2 THEN blocked_until
           WHEN blocked_until IS NOT NULL OR window_start <= ?3 THEN CASE WHEN 1 >= ?5 THEN ?4 END
           WHEN count + 1 >= ?5 THEN ?4
         END
       RETURNING count, blocked_until`,
    )
    .bind(scope, iso(now), iso(now - limit.windowMs), iso(now + limit.blockMs), limit.tripAt)
    .first<Reserved>()
  return row!
}

/** A right password was never a miss: takes back its reserved count, and the block it tripped if no one else's count holds it. */
async function refund(db: D1Database, scope: string, limit: Limit) {
  await db
    .prepare('UPDATE auth_throttle SET count = count - 1, blocked_until = CASE WHEN count - 1 < ? THEN NULL ELSE blocked_until END WHERE scope = ? AND count > 0')
    .bind(limit.tripAt, scope)
    .run()
}

/** Seconds to wait after a reservation; 0 when the scope isn't blocked. */
const waitOf = (r: Reserved, now: number) => (r.blocked_until && Date.parse(r.blocked_until) > now ? Math.ceil((Date.parse(r.blocked_until) - now) / 1000) : 0)

/** The shared core of sign-in and step-up: the try counted, the password checked, a right one's count taken back. */
async function checkPassword(db: D1Database, pepper: string, person: Person | null, addr: string, password: string, ip: string | null, now: number): Promise<PasswordCheck> {
  const ipS = ipScope(ip)
  const netS = netScope(addr, ip)
  const atIp = await reserve(db, ipS, LIMITS.authIp, now)
  if (atIp.count > LIMITS.authIp.tripAt) return { kind: 'slow', seconds: waitOf(atIp, now) }
  const atAddr = await reserve(db, addr, LIMITS.authAddr, now)
  const atNet = await reserve(db, netS, LIMITS.authAddr, now)
  const addrWait = atAddr.count > LIMITS.authAddr.tripAt ? waitOf(atAddr, now) : 0
  // The password is checked even while the address is blocked, so a blocked try takes the same time and
  // gets the same answer whether or not the address has an account.
  const tooLong = password.length > MAX_INPUT
  const v = await verifyPassword(tooLong ? '' : password, person?.password_hash ?? DUMMY_HASH, pepper)
  const right = v.ok && !tooLong && !!person && person.status === 'active'
  if (addrWait && !(right && (await familiar(db, addr, ip, atNet, now)))) {
    // a wrong password stays counted; a right one from an unfamiliar network waits, but was never a miss
    if (right) for (const [s, l] of [[ipS, LIMITS.authIp], [addr, LIMITS.authAddr], [netS, LIMITS.authAddr]] as const) await refund(db, s, l)
    return { kind: 'slow', seconds: addrWait }
  }
  if (!right || !person) {
    const slow = Math.max(waitOf(atIp, now), waitOf(atAddr, now), waitOf(atNet, now))
    return slow ? { kind: 'slow', seconds: slow } : { kind: 'bad' }
  }
  await refund(db, ipS, LIMITS.authIp)
  await clearThrottle(db, addr)
  await clearThrottle(db, netS)
  const net = ipPrefix(ip)
  if (net) await stamp(db, knownScope(addr, net), now)
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

/**
 * After the verify button: mark the address verified; an allow-listed address becomes founding and established
 * (A6). Every session of the account ends except `keepSession` (the browser that pressed the button), so
 * someone who signed up with another person's address can't stay signed in once that person verifies it.
 */
export async function markVerified(db: D1Database, personId: number, origin: string, opts: { keepSession?: string; now?: number } = {}) {
  const stmts = await markVerifiedStatements(db, personId, origin, opts)
  if (stmts) await db.batch(stmts)
}

/**
 * markVerified's batch, for a caller that adds its own statements to it (the admin console's "mark email verified",
 * web/admin-accounts.tsx, puts its moderation_action row in). Null when the account is gone or already verified.
 */
export async function markVerifiedStatements(db: D1Database, personId: number, origin: string, opts: { keepSession?: string; now?: number } = {}): Promise<D1PreparedStatement[] | null> {
  const nowMs = opts.now ?? Date.now()
  const now = new Date(nowMs).toISOString()
  const p = await db
    .prepare('SELECT id, handle, email, email_norm, email_verified_at FROM person WHERE id = ?')
    .bind(personId)
    .first<{ id: number; handle: string; email: string; email_norm: string; email_verified_at: string | null }>()
  if (!p || p.email_verified_at) return null
  const invited = await db.prepare('SELECT 1 AS ok FROM signup_allow WHERE email_norm = ?').bind(p.email_norm).first()
  const stmts = [
    db.prepare('UPDATE person SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL').bind(now, p.id),
    db.prepare('DELETE FROM session WHERE person_id = ? AND id != ?').bind(p.id, opts.keepSession ?? ''),
  ]
  if (invited) {
    stmts.push(
      db.prepare('UPDATE person SET founding = 1, established_at = COALESCE(established_at, ?) WHERE id = ?').bind(now, p.id),
      db.prepare('UPDATE signup_allow SET used_at = COALESCE(used_at, ?) WHERE email_norm = ?').bind(now, p.email_norm),
      // invited after joining from off the list: no longer waiting for the opening
      db.prepare('DELETE FROM signup_wait WHERE person_id = ?').bind(p.id),
    )
  }
  stmts.push(
    db.prepare("UPDATE email_token SET used_at = ? WHERE person_id = ? AND purpose = 'verify' AND used_at IS NULL").bind(now, p.id),
    mailStatement(db, { to: p.email, template: 'welcome', stream: 'account', personId: p.id, payload: { handle: p.handle, link: `${origin}/` } }, now),
  )
  return stmts
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
  await setPassword(db, pepper, personId, password, { now: nowMs })
}

/**
 * A new password, from a reset link or the account modal's "change password" (go-live 6.2): every session of the
 * account ends except `keepSession` (the browser that changed it; none after a reset), every reset link and any
 * pending email change link dies, and the "password changed" mail goes to the account's address. Killing the change
 * link is what makes the old address's warning ("if this wasn't you, reset your password") stop a takeover.
 */
export async function setPassword(db: D1Database, pepper: string, personId: number, password: string, opts: { keepSession?: string; now?: number } = {}) {
  const now = new Date(opts.now ?? Date.now()).toISOString()
  const p = await db.prepare('SELECT id, handle, email, email_norm FROM person WHERE id = ?').bind(personId).first<{ id: number; handle: string; email: string; email_norm: string }>()
  if (!p) return
  const hash = await hashPassword(password, pepper)
  await db.batch([
    db.prepare('UPDATE person SET password_hash = ?, password_changed_at = ? WHERE id = ?').bind(hash, now, p.id),
    // endAllSessions, inside the batch, sparing only the browser that made the change
    db.prepare('DELETE FROM session WHERE person_id = ? AND id != ?').bind(p.id, opts.keepSession ?? ''),
    db.prepare("UPDATE email_token SET used_at = ? WHERE person_id = ? AND purpose IN ('reset', 'email_change') AND used_at IS NULL").bind(now, p.id),
    mailStatement(db, { to: p.email, template: 'password_changed', stream: 'security', personId: p.id, payload: { handle: p.handle } }, now),
  ])
  await clearThrottle(db, await addrScope(p.email_norm))
}

export type InlineStepUp = { ok: true } | { refuse: string; status: 400 | 429; wait?: number }

/**
 * The inline step-up (A5) for a form that acts with the person's authority: the sign-off, the author's own box, saving
 * the account. With the 10-minute window open nothing is asked; otherwise the form carries the password, checked and
 * throttled as /step-up does (stepUp, which opens the window on success), so the draft never leaves for the /step-up
 * page. On success the session object's window is moved too, so a page re-rendered after a later refusal doesn't ask again.
 */
export async function inlineStepUp(db: D1Database, pepper: string, session: Session, password: string | undefined, ip: string | null, now = Date.now()): Promise<InlineStepUp> {
  if (stepUpOpen(session, now)) return { ok: true }
  if (!password) return { refuse: w.auth.enterPassword, status: 400 }
  const r = await stepUp(db, pepper, session.personId, session.id, password, ip, now)
  if (r.kind === 'slow') return { refuse: fill(w.auth.tooManyTries, { minutes: Math.max(1, Math.ceil(r.seconds / 60)) }), status: 429, wait: r.seconds }
  if (r.kind === 'bad') return { refuse: w.auth.wrongPassword, status: 400 }
  session.stepUpUntil = new Date(now + STEP_UP_MS).toISOString()
  return { ok: true }
}
