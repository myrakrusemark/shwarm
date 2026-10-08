// Sign-up (go-live 2.5). The rules, in order: fields look right, the domain isn't disposable, this network
// and domain aren't signing up too fast, the password isn't breached, the handle is free (handles are public,
// so that answer may differ). After that, every case gets the SAME "check your email" page, so no answer
// shows whether an address has an account (2.7): an address that already has one gets a "you already have an
// account" mail; an address off the allow-list (while sign-up is allow-list only) gets nothing; otherwise the
// account is made, unverified, with a verify link mailed in the same batch. The writes run after the
// response where the runtime allows, so the time taken doesn't tell the cases apart either.
import { handleProblem, toBase64url } from '@shwarm/protocol'
import { mailStatement } from '../email/outbox'
import { formToken, formTokenOk } from './csrf'
import { isDisposable, parseEmail } from './email'
import { hashPassword, isPwned, passwordProblem } from './password'
import { ipPrefix } from './session'
import { bump, LIMITS } from './throttle'
import { newToken } from './tokens'

export const DISPLAY_NAME_MAX = 50 // OPEN: no decided limit; 50 is easy to raise
export const PEND_COOKIE = '__Host-shwarm-pend'
export const PEND_SECONDS = 7 * 86_400

export type Errors = Partial<Record<'handle' | 'display_name' | 'email' | 'password' | 'age' | 'terms' | 'turnstile' | 'form', string>>

export type SignupInput = { handle?: string; display_name?: string; email?: string; password?: string; age?: string; terms?: string }

export type SignupResult =
  | { kind: 'errors'; errors: Errors }
  | { kind: 'slow'; seconds: number }
  /** New account, existing address or not invited: the caller can't tell, and neither can the visitor. */
  | { kind: 'sent'; pend: string }

type Env = { PASSWORD_PEPPER: string; CSRF_SECRET: string }
/** Runs the writes; the route passes one that runs them after the response. The default runs them now. */
export type Defer = (work: () => Promise<unknown>) => Promise<void>
export type SignupContext = { ip: string | null; origin: string; pend?: string; sessionPersonId?: number; now?: number; defer?: Defer }

export const COPY = {
  handlePattern: 'use 2 to 32 lowercase letters, numbers or underscores.',
  handleReserved: 'that handle is reserved. pick another one.',
  handleTaken: 'that handle is taken. pick another one.',
  displayName: `keep it to ${DISPLAY_NAME_MAX} characters.`,
  email: "that doesn't look like an email address.",
  disposable: "we can't take addresses from throwaway mail services.",
  tooShort: 'use at least 10 characters.',
  tooLong: 'use at most 128 characters.',
  pwned: 'that password has turned up in a data breach. pick another one.',
  age: 'you need to be 16 or older to join.',
  terms: 'you need to agree to the terms to join.',
  turnstile: "the bot check didn't go through. please try again.",
}

/** A JSON value from the setting table. */
export async function setting<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db.prepare('SELECT value FROM setting WHERE key = ?').bind(key).first<{ value: string }>()
  return row ? (JSON.parse(row.value) as T) : null
}

const cleanName = (s: string) => s.replace(/[\x00-\x1f\x7f​-‏‪-‮⁦-⁩]/g, '').trim()

// The pending-account cookie: "<handle>.<mac over the handle and the account's creation time>". It proves this
// browser made that pending account, so signing up again here with the same handle replaces it (table B), and
// it lets "send it again" find the account. The other cases set one with a random mac, so the response looks
// the same either way. (Not over the id: the id is picked when the account is written, after the response.)
const pendMac = (env: Env, p: { handle: string; created_at: string }) => formToken(env.CSRF_SECRET, `pend:${p.handle}:${p.created_at}`)
const randomMac = () => toBase64url(crypto.getRandomValues(new Uint8Array(32)))

export function readPend(cookie: string | undefined): { handle: string; mac: string } | null {
  const m = cookie ? /^([a-z0-9_]{2,32})\.([A-Za-z0-9_-]{43})$/.exec(cookie) : null
  return m ? { handle: m[1], mac: m[2] } : null
}

type Pending = { id: number; handle: string; email: string; created_at: string }

/** The unverified account this browser made, if `handle` is it. */
export async function pendingAccount(db: D1Database, env: Env, handle: string, ctx: { pend?: string; sessionPersonId?: number }): Promise<Pending | null> {
  const p = await db
    .prepare('SELECT id, handle, email, created_at FROM person WHERE handle = ? AND email_verified_at IS NULL')
    .bind(handle)
    .first<Pending>()
  if (!p) return null
  if (ctx.sessionPersonId === p.id) return p
  const pend = readPend(ctx.pend)
  return pend && pend.handle === handle && (await formTokenOk(env.CSRF_SECRET, `pend:${p.handle}:${p.created_at}`, pend.mac)) ? p : null
}

export function verifyMail(db: D1Database, p: { id: number; handle: string; email: string }, token: string, origin: string, now: string) {
  return mailStatement(db, { to: p.email, template: 'verify', stream: 'account', personId: p.id, payload: { handle: p.handle, link: `${origin}/verify?t=${token}` } }, now)
}

export async function signUp(db: D1Database, env: Env, input: SignupInput, ctx: SignupContext): Promise<SignupResult> {
  const nowMs = ctx.now ?? Date.now()
  const now = new Date(nowMs).toISOString()

  // 1. the fields
  const errors: Errors = {}
  const handle = (input.handle ?? '').trim().toLowerCase()
  const hp = handleProblem(handle)
  if (hp) errors.handle = hp === 'reserved' ? COPY.handleReserved : COPY.handlePattern
  const displayName = cleanName(input.display_name ?? '')
  if ([...displayName].length > DISPLAY_NAME_MAX) errors.display_name = COPY.displayName
  const email = parseEmail(input.email)
  if (!email) errors.email = COPY.email
  const password = input.password ?? ''
  const pp = passwordProblem(password)
  if (pp) errors.password = pp === 'too_short' ? COPY.tooShort : COPY.tooLong
  if (!input.age) errors.age = COPY.age
  if (!input.terms) errors.terms = COPY.terms
  if (Object.keys(errors).length || !email) return { kind: 'errors', errors }
  if (await isDisposable(db, email.domain)) return { kind: 'errors', errors: { email: COPY.disposable } }

  // 2. throttles: per network and per email domain
  const wait = Math.max(
    await bump(db, `signup:ip:${ipPrefix(ctx.ip) ?? 'unknown'}`, LIMITS.signupIp, nowMs),
    await bump(db, `signup:domain:${email.domain}`, LIMITS.signupDomain, nowMs),
  )
  if (wait) return { kind: 'slow', seconds: wait }

  // 3. breached passwords (fails open if the service is down)
  if (await isPwned(password)) return { kind: 'errors', errors: { password: COPY.pwned } }

  // Hash before branching, so a new account and an existing address take about the same time.
  const hash = await hashPassword(password, env.PASSWORD_PEPPER)

  // 4. the handle. Handles are public, so this answer may differ; nothing after it may depend on the address.
  const mine = await pendingAccount(db, env, handle, ctx)
  const taken = await db.prepare('SELECT id FROM person WHERE handle = ?').bind(handle).first<{ id: number }>()
  if (taken && taken.id !== mine?.id) return { kind: 'errors', errors: { handle: COPY.handleTaken } }

  // 5. which case is this? Each one does the same reads and gets the same answer.
  const owner = await db
    .prepare('SELECT id, handle, email, email_verified_at FROM person WHERE email_norm = ?')
    .bind(email.norm)
    .first<{ id: number; handle: string; email: string; email_verified_at: string | null }>()
  const open = (await setting<string>(db, 'signup')) === 'open'
  const invited = await db.prepare('SELECT 1 AS ok FROM signup_allow WHERE email_norm = ?').bind(email.norm).first()
  const termsVersion = (await setting<string>(db, 'terms_version')) ?? '0'
  const defer: Defer = ctx.defer ?? (work => work().then(() => {}))
  const decoy: SignupResult = { kind: 'sent', pend: `${handle}.${randomMac()}` }

  if (owner && owner.id !== mine?.id) {
    await defer(() =>
      mailStatement(db, {
        to: owner.email, template: 'signup_existing', stream: 'account', personId: owner.id,
        payload: { handle: owner.handle, verified: owner.email_verified_at !== null, signin: `${ctx.origin}/signin`, forgot: `${ctx.origin}/forgot` },
      }, now).run(),
    )
    return decoy
  }
  // OPEN (open-questions #71): an address off the allow-list gets the same "check your email" page and no
  // mail. That page and /join say sign-up is invite-only for now. A mail saying so would be kinder, but it
  // would mail any address someone types in.
  if (!open && !invited) return decoy

  // 6. make the account. Replacing this browser's pending one keeps its creation time, so re-sending the form
  // never restarts the 7-day clock that frees the handle (table B).
  const created_at = mine?.created_at ?? now
  await defer(() => createAccount(db, { handle, displayName, email: email.email, norm: email.norm, hash, termsVersion, created_at, replaces: mine?.id }, ctx.origin, nowMs))
  return { kind: 'sent', pend: `${handle}.${await pendMac(env, { handle, created_at })}` }
}

type NewAccount = { handle: string; displayName: string; email: string; norm: string; hash: string; termsVersion: string; created_at: string; replaces?: number }

/** The account (replacing this browser's pending one), its verify link and the mail, in one batch. */
async function createAccount(db: D1Database, a: NewAccount, origin: string, nowMs: number) {
  const now = new Date(nowMs).toISOString()
  for (let attempt = 0; attempt < 3; attempt++) {
    const max = await db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM person').first<{ id: number }>()
    const p = { id: (max?.id ?? 0) + 1, handle: a.handle, email: a.email }
    const { token, stmt } = await newToken(db, p.id, 'verify', nowMs)
    const stmts: D1PreparedStatement[] = []
    if (a.replaces) {
      stmts.push(db.prepare('DELETE FROM email_outbox WHERE person_id = ? AND sent_at IS NULL').bind(a.replaces))
      stmts.push(db.prepare('DELETE FROM person WHERE id = ? AND email_verified_at IS NULL').bind(a.replaces))
    }
    stmts.push(
      db
        .prepare(
          `INSERT INTO person (id, handle, display_name, email, email_norm, password_hash, terms_version, terms_accepted_at, age_confirmed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(p.id, a.handle, a.displayName, a.email, a.norm, a.hash, a.termsVersion, now, now, a.created_at),
      stmt,
      verifyMail(db, p, token, origin, now),
    )
    try {
      await db.batch(stmts)
      return
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      // Lost a race for the handle or the address: the visitor already has the "check your email" page, and no
      // mail comes. Rare; signing up again shows the handle taken, or mails the address's owner.
      if (msg.includes('person.handle') || msg.includes('person.email_norm')) return
      if (!msg.includes('person.id') && !msg.includes('PRIMARY KEY')) throw e
      // another sign-up took that id at the same moment: try the next one
    }
  }
  throw new Error('sign-up: could not pick a person id')
}

/**
 * "send it again" on the check-your-email page: a fresh verify link for this browser's unverified account, if
 * any. Throttled per network and per account; the new link replaces the older ones. Returns seconds to wait, or 0.
 */
export async function resendVerify(db: D1Database, env: Env, ctx: { ip: string | null; origin: string; pend?: string; sessionPersonId?: number; now?: number }): Promise<number> {
  const nowMs = ctx.now ?? Date.now()
  const now = new Date(nowMs).toISOString()
  const ipWait = await bump(db, `resend:ip:${ipPrefix(ctx.ip) ?? 'unknown'}`, LIMITS.resendIp, nowMs)
  if (ipWait) return ipWait
  let p: Pending | null = null
  if (ctx.sessionPersonId) {
    p = await db
      .prepare('SELECT id, handle, email, created_at FROM person WHERE id = ? AND email_verified_at IS NULL')
      .bind(ctx.sessionPersonId)
      .first<Pending>()
  }
  const pend = readPend(ctx.pend)
  if (!p && pend) p = await pendingAccount(db, env, pend.handle, { pend: ctx.pend })
  if (!p) return 0
  const wait = await bump(db, `resend:person:${p.id}`, LIMITS.resendPerson, nowMs)
  if (wait) return wait
  const { token, stmt } = await newToken(db, p.id, 'verify', nowMs)
  await db.batch([
    db.prepare("UPDATE email_token SET used_at = ? WHERE person_id = ? AND purpose = 'verify' AND used_at IS NULL").bind(now, p.id),
    stmt,
    verifyMail(db, p, token, ctx.origin, now),
  ])
  return 0
}
