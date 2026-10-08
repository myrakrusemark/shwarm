// Sign-up (go-live 2.5). The rules, in order: fields look right, the domain isn't disposable, this network
// and domain aren't signing up too fast, the password isn't breached. Then: an address that already has an
// account gets a "you already have an account" mail and the SAME "check your email" page; an address off the
// allow-list (while sign-up is allow-list only) gets the invite-only page; otherwise the account is made,
// unverified, with a verify link mailed in the same batch.
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
  | { kind: 'invite_only' }
  | { kind: 'slow'; seconds: number }
  /** New account or existing address: the caller can't tell, and neither can the visitor. */
  | { kind: 'sent'; pend: string }

type Env = { PASSWORD_PEPPER: string; CSRF_SECRET: string }
export type SignupContext = { ip: string | null; origin: string; pend?: string; sessionPersonId?: number; now?: number }

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

// The pending-account cookie: "<handle>.<mac over the account's id and creation time>". It proves this browser
// made that pending account, so signing up again here with the same handle replaces it (table B), and it
// lets "send it again" find the account. The existing-address path sets one with a random mac, so the
// response looks the same either way.
const pendMac = (env: Env, p: { id: number; created_at: string }) => formToken(env.CSRF_SECRET, `pend:${p.id}:${p.created_at}`)
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
  return pend && pend.handle === handle && (await formTokenOk(env.CSRF_SECRET, `pend:${p.id}:${p.created_at}`, pend.mac)) ? p : null
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

  // 4. which case is this?
  const mine = await pendingAccount(db, env, handle, ctx)
  const owner = await db
    .prepare('SELECT id, handle, email, email_verified_at FROM person WHERE email_norm = ?')
    .bind(email.norm)
    .first<{ id: number; handle: string; email: string; email_verified_at: string | null }>()
  if (owner && owner.id !== mine?.id) {
    await mailStatement(db, {
      to: owner.email, template: 'signup_existing', stream: 'account', personId: owner.id,
      payload: { handle: owner.handle, verified: owner.email_verified_at !== null, signin: `${ctx.origin}/signin`, forgot: `${ctx.origin}/forgot` },
    }, now).run()
    return { kind: 'sent', pend: `${handle}.${randomMac()}` }
  }

  if ((await setting<string>(db, 'signup')) !== 'open') {
    const allowed = await db.prepare('SELECT 1 AS ok FROM signup_allow WHERE email_norm = ?').bind(email.norm).first()
    if (!allowed) return { kind: 'invite_only' }
  }

  const taken = await db.prepare('SELECT id FROM person WHERE handle = ?').bind(handle).first<{ id: number }>()
  if (taken && taken.id !== mine?.id) return { kind: 'errors', errors: { handle: COPY.handleTaken } }

  // 5. make the account (replacing this browser's pending one), its verify link and the mail, in one batch
  const termsVersion = (await setting<string>(db, 'terms_version')) ?? '0'
  for (let attempt = 0; attempt < 3; attempt++) {
    const max = await db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM person').first<{ id: number }>()
    const p = { id: (max?.id ?? 0) + 1, handle, email: email.email, created_at: now }
    const { token, stmt } = await newToken(db, p.id, 'verify', nowMs)
    const stmts: D1PreparedStatement[] = []
    if (mine) {
      stmts.push(db.prepare('DELETE FROM email_outbox WHERE person_id = ? AND sent_at IS NULL').bind(mine.id))
      stmts.push(db.prepare('DELETE FROM person WHERE id = ? AND email_verified_at IS NULL').bind(mine.id))
    }
    stmts.push(
      db
        .prepare(
          `INSERT INTO person (id, handle, display_name, email, email_norm, password_hash, terms_version, terms_accepted_at, age_confirmed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(p.id, handle, displayName, email.email, email.norm, hash, termsVersion, now, now, now),
      stmt,
      verifyMail(db, p, token, ctx.origin, now),
    )
    try {
      await db.batch(stmts)
      return { kind: 'sent', pend: `${handle}.${await pendMac(env, p)}` }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      if (msg.includes('person.handle')) return { kind: 'errors', errors: { handle: COPY.handleTaken } }
      if (msg.includes('person.email_norm')) return { kind: 'sent', pend: `${handle}.${randomMac()}` } // lost a race to the same address
      if (!msg.includes('person.id') && !msg.includes('PRIMARY KEY')) throw e
      // another sign-up took that id at the same moment: try the next one
    }
  }
  throw new Error('sign-up: could not pick a person id')
}

/** "send it again" on the check-your-email page: a fresh verify link for this browser's unverified account, if any. */
export async function resendVerify(db: D1Database, env: Env, ctx: { origin: string; pend?: string; sessionPersonId?: number; now?: number }) {
  const nowMs = ctx.now ?? Date.now()
  let p: Pending | null = null
  if (ctx.sessionPersonId) {
    p = await db
      .prepare('SELECT id, handle, email, created_at FROM person WHERE id = ? AND email_verified_at IS NULL')
      .bind(ctx.sessionPersonId)
      .first<Pending>()
  }
  const pend = readPend(ctx.pend)
  if (!p && pend) p = await pendingAccount(db, env, pend.handle, { pend: ctx.pend })
  if (!p) return
  const { token, stmt } = await newToken(db, p.id, 'verify', nowMs)
  await db.batch([stmt, verifyMail(db, p, token, ctx.origin, new Date(nowMs).toISOString())])
}
