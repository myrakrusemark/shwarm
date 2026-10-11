// Sign-up (go-live 2.5). The rules, in order: fields look right, the domain isn't disposable, this network
// and domain aren't signing up too fast, the password isn't breached, the handle is free (handles are public,
// so that answer may differ). After that, no answer shows whether an address has an account (2.7): an address
// that already has one gets a "you already have an account" mail; otherwise the account is made, unverified,
// with a verify link mailed in the same batch. While sign-up is invite-only, an address off the allow-list
// still gets its account (decided Oct 10), recorded in signup_wait so it hears when shwarm opens, and its
// "check your email" page says it's waiting. So that page does show whether an address is invited: the
// trade-off Myra chose. It depends only on the allow-list, never on whether the address has an account. The
// writes run after the response where the runtime allows, so the time taken doesn't tell the cases apart.
// An address that has an account still holds the handle (handle_hold) as long as a new account would, so a later
// "that handle is taken" doesn't tell them apart either (go-live 9.6).
import { handleProblem } from '@shwarm/protocol'
import { mailStatement } from '../email/outbox'
import { UNVERIFIED_DAYS } from './cleanup'
import { formToken, formTokenOk } from './csrf'
import { isDisposable, parseEmail } from './email'
import { hashPassword, isPwned, passwordProblem } from './password'
import { ipPrefix } from './session'
import { bump, LIMITS } from './throttle'
import { signNext } from './request'
import { newToken } from './tokens'

export const DISPLAY_NAME_MAX = 50 // OPEN: no decided limit; 50 is easy to raise
export const PEND_COOKIE = '__Host-shwarm-pend'
export const PEND_SECONDS = 7 * 86_400

export type Errors = Partial<Record<'handle' | 'display_name' | 'email' | 'password' | 'age' | 'terms' | 'turnstile' | 'form', string>>

export type SignupInput = { handle?: string; display_name?: string; email?: string; password?: string; age?: string; terms?: string }

export type SignupResult =
  | { kind: 'errors'; errors: Errors }
  | { kind: 'slow'; seconds: number }
  /**
   * New account or existing address: the caller can't tell, and neither can the visitor. `waiting`: sign-up is
   * invite-only and the address isn't on the allow-list, whether or not it has an account.
   */
  | { kind: 'sent'; pend: string; waiting: boolean }

type Env = { PASSWORD_PEPPER: string; CSRF_SECRET: string }
/** Runs the writes; the route passes one that runs them after the response. The default runs them now. */
export type Defer = (work: () => Promise<unknown>) => Promise<void>
/** `next`: a safeNext() path to come back to; the verify link carries it signed. */
export type SignupContext = { ip: string | null; origin: string; pend?: string; sessionPersonId?: number; now?: number; defer?: Defer; next?: string }

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

/** Control, zero-width and bidi characters out, ends trimmed: a display name (and the about line, 6.2) as stored. */
export const cleanName = (s: string) => s.replace(/[\x00-\x1f\x7f​-‏‪-‮⁦-⁩]/g, '').trim()

// The pending-account cookie: "<handle>.<mac over the handle and the account's creation time>". It proves this
// browser made that pending account, so signing up again here with the same handle replaces it (table B), and
// it lets "send it again" find the account. An address that already has an account gets one signed the same way
// over its handle hold, so the response looks the same either way. (Not over the id: the id is picked when the
// account is written, after the response.)
const pendMac = (env: Env, p: { handle: string; created_at: string }) => formToken(env.CSRF_SECRET, `pend:${p.handle}:${p.created_at}`)
const pendOk = async (env: Env, p: { handle: string; created_at: string }, cookie: string | undefined) => {
  const pend = readPend(cookie)
  return !!pend && pend.handle === p.handle && (await formTokenOk(env.CSRF_SECRET, `pend:${p.handle}:${p.created_at}`, pend.mac))
}

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
  return (await pendOk(env, p, ctx.pend)) ? p : null
}

type Hold = { id: number; handle: string; created_at: string }

const holdOf = (db: D1Database, handle: string) => db.prepare('SELECT id, handle, created_at FROM handle_hold WHERE handle = ?').bind(handle).first<Hold>()

/**
 * Before the handle is checked: an unverified account (as auth/cleanup.ts deletes them) or a hold past its 7 days
 * goes now, so either frees the handle at the same moment, not whenever the hourly cleanup next runs. Only this
 * handle's account; stale holds of any handle, since nothing else removes them.
 */
async function sweepStale(db: D1Database, handle: string, nowMs: number) {
  const cutoff = new Date(nowMs - UNVERIFIED_DAYS * 86_400_000).toISOString()
  const stale = 'SELECT id FROM person WHERE handle = ? AND email_verified_at IS NULL AND created_at < ?'
  const any = await db.prepare(`${stale} UNION ALL SELECT id FROM handle_hold WHERE created_at < ? LIMIT 1`).bind(handle, cutoff, cutoff).first()
  if (!any) return
  await db.batch([
    db.prepare(`UPDATE moderation_action SET person_id = NULL WHERE person_id IN (${stale})`).bind(handle, cutoff),
    db.prepare(`DELETE FROM email_outbox WHERE sent_at IS NULL AND person_id IN (${stale})`).bind(handle, cutoff),
    db.prepare(`DELETE FROM person WHERE id IN (${stale})`).bind(handle, cutoff),
    db.prepare('DELETE FROM handle_hold WHERE created_at < ?').bind(cutoff),
  ])
}

/** Whether this account joined from an address off the allow-list and is waiting for shwarm to open (signup_wait). */
export async function isWaiting(db: D1Database, personId: number): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 AS ok FROM signup_wait WHERE person_id = ? AND mailed_at IS NULL').bind(personId).first())
}

export function verifyMail(db: D1Database, p: { id: number; handle: string; email: string }, token: string, origin: string, now: string, signedNext?: string) {
  const link = `${origin}/verify?t=${token}${signedNext ? `&n=${signedNext}` : ''}`
  return mailStatement(db, { to: p.email, template: 'verify', stream: 'account', personId: p.id, payload: { handle: p.handle, link } }, now)
}

/** The signed return-to for a verify link, bound to that link's token (see signNext). */
const verifyNext = (secret: string, token: string, next?: string) => (next ? signNext(secret, next, `verify:${token}`) : Promise.resolve(undefined))

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

  // 2. throttles: per network, then per email domain. A try the network limit refuses doesn't count against the
  // domain, so one network can't block sign-ups at a big provider (gmail.com) for everyone (go-live 9.7's drill).
  const netWait = await bump(db, `signup:ip:${ipPrefix(ctx.ip) ?? 'unknown'}`, LIMITS.signupIp, nowMs)
  if (netWait) return { kind: 'slow', seconds: netWait }
  const domainWait = await bump(db, `signup:domain:${email.domain}`, LIMITS.signupDomain, nowMs)
  if (domainWait) return { kind: 'slow', seconds: domainWait }

  // 3. breached passwords (fails open if the service is down)
  if (await isPwned(password)) return { kind: 'errors', errors: { password: COPY.pwned } }

  // Hash before branching, so a new account and an existing address take about the same time.
  const hash = await hashPassword(password, env.PASSWORD_PEPPER)

  // 4. the handle. Handles are public, so this answer may differ; nothing after it may depend on the address.
  // A hold (step 5) takes it like an account does; this browser's own pending account or hold doesn't.
  await sweepStale(db, handle, nowMs)
  const mine = await pendingAccount(db, env, handle, ctx)
  const hold = await holdOf(db, handle)
  const myHold = hold && (await pendOk(env, hold, ctx.pend)) ? hold : null
  const taken = await db.prepare('SELECT id FROM person WHERE handle = ?').bind(handle).first<{ id: number }>()
  if ((taken && taken.id !== mine?.id) || (hold && !myHold)) return { kind: 'errors', errors: { handle: COPY.handleTaken } }

  // 5. which case is this? Each one does the same reads and gets the same answer.
  const owner = await db
    .prepare('SELECT id, handle, email, email_verified_at FROM person WHERE email_norm = ?')
    .bind(email.norm)
    .first<{ id: number; handle: string; email: string; email_verified_at: string | null }>()
  const open = (await setting<string>(db, 'signup')) === 'open'
  const invited = await db.prepare('SELECT 1 AS ok FROM signup_allow WHERE email_norm = ?').bind(email.norm).first()
  const termsVersion = (await setting<string>(db, 'terms_version')) ?? '0'
  const waiting = !open && !invited
  const defer: Defer = ctx.defer ?? (work => work().then(() => {}))
  // Replacing this browser's earlier claim on the handle (a pending account or a hold) keeps its creation time, so
  // re-sending the form never restarts the 7-day clock that frees the handle (table B).
  const created_at = mine?.created_at ?? myHold?.created_at ?? now
  const sent: SignupResult = { kind: 'sent', pend: `${handle}.${await pendMac(env, { handle, created_at })}`, waiting }
  const claim = { handle, created_at, replaces: mine?.id, replacesHold: myHold?.id }

  if (owner && owner.id !== mine?.id) {
    // No account, but the handle is held for this browser just as a new account would hold it (go-live 9.6).
    await defer(() =>
      holdHandle(db, claim, mailStatement(db, {
        to: owner.email, template: 'signup_existing', stream: 'account', personId: owner.id,
        payload: { handle: owner.handle, verified: owner.email_verified_at !== null, signin: `${ctx.origin}/signin`, forgot: `${ctx.origin}/forgot` },
      }, now)),
    )
    return sent
  }
  // 6. make the account.
  await defer(() =>
    createAccount(db, { ...claim, displayName, email: email.email, norm: email.norm, hash, termsVersion, waiting }, ctx.origin, nowMs, {
      secret: env.CSRF_SECRET, next: ctx.next,
    }),
  )
  return sent
}

/** A claim on a handle, and the claim this browser made on it before (`replaces`: a pending account; `replacesHold`: a hold). */
type Claim = { handle: string; created_at: string; replaces?: number; replacesHold?: number }

/** The earlier claim goes: a pending account with its unsent mail (its signup_wait row goes with it), or a hold. */
function releaseClaim(db: D1Database, c: Claim): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = []
  if (c.replaces) {
    stmts.push(db.prepare('DELETE FROM email_outbox WHERE person_id = ? AND sent_at IS NULL').bind(c.replaces))
    stmts.push(db.prepare('DELETE FROM person WHERE id = ? AND email_verified_at IS NULL').bind(c.replaces))
  }
  if (c.replacesHold) stmts.push(db.prepare('DELETE FROM handle_hold WHERE id = ?').bind(c.replacesHold))
  return stmts
}

/** The hold (replacing this browser's earlier claim) and the "you already have an account" mail, in one batch. */
async function holdHandle(db: D1Database, c: Claim, mail: D1PreparedStatement) {
  try {
    await db.batch([
      ...releaseClaim(db, c),
      db.prepare('INSERT INTO handle_hold (handle, created_at) SELECT ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM person WHERE handle = ?1)').bind(c.handle, c.created_at),
      mail,
    ])
  } catch (e) {
    // Lost a race for the handle, as in createAccount: the visitor already has the page, and no mail comes.
    if (!String((e as Error)?.message ?? e).includes('handle_hold.handle')) throw e
  }
}

/** `waiting`: off the allow-list while sign-up is invite-only, so it goes on signup_wait (decided Oct 10). */
type NewAccount = Claim & { displayName: string; email: string; norm: string; hash: string; termsVersion: string; waiting: boolean }

/** The account (replacing this browser's earlier claim on the handle), its verify link and the mail, in one batch. */
async function createAccount(db: D1Database, a: NewAccount, origin: string, nowMs: number, back: { secret: string; next?: string }) {
  const now = new Date(nowMs).toISOString()
  for (let attempt = 0; attempt < 3; attempt++) {
    const max = await db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM person').first<{ id: number }>()
    const p = { id: (max?.id ?? 0) + 1, handle: a.handle, email: a.email }
    const { token, stmt } = await newToken(db, p.id, 'verify', nowMs)
    const signedNext = await verifyNext(back.secret, token, back.next)
    const stmts = releaseClaim(db, a)
    stmts.push(
      db
        .prepare(
          `INSERT INTO person (id, handle, display_name, email, email_norm, password_hash, terms_version, terms_accepted_at, age_confirmed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(p.id, a.handle, a.displayName, a.email, a.norm, a.hash, a.termsVersion, now, now, a.created_at),
      stmt,
      verifyMail(db, p, token, origin, now, signedNext),
    )
    if (a.waiting) stmts.push(db.prepare('INSERT INTO signup_wait (person_id, joined_at) VALUES (?, ?)').bind(p.id, now))
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
export async function resendVerify(db: D1Database, env: Env, ctx: { ip: string | null; origin: string; pend?: string; sessionPersonId?: number; now?: number; next?: string }): Promise<number> {
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
  if (!p) {
    // A hold (an address that already has an account) counts presses as a pending account does, so the 429 comes
    // at the same press either way (go-live 9.6). No mail.
    const hold = pend ? await holdOf(db, pend.handle) : null
    return hold && (await pendOk(env, hold, ctx.pend)) ? bump(db, `resend:hold:${hold.id}`, LIMITS.resendPerson, nowMs) : 0
  }
  const wait = await bump(db, `resend:person:${p.id}`, LIMITS.resendPerson, nowMs)
  if (wait) return wait
  const { token, stmt } = await newToken(db, p.id, 'verify', nowMs)
  const signedNext = await verifyNext(env.CSRF_SECRET, token, ctx.next)
  await db.batch([
    db.prepare("UPDATE email_token SET used_at = ? WHERE person_id = ? AND purpose = 'verify' AND used_at IS NULL").bind(now, p.id),
    stmt,
    verifyMail(db, p, token, ctx.origin, now, signedNext),
  ])
  return 0
}
