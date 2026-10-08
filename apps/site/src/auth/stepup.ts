// The password step-up (A5). Sign-off, keys, saving the account, email or password change, export and admin
// acts need the password entered within the last 10 minutes. Entering it at sign-in or on /step-up opens
// the window on that session.
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { COOKIE, readSession, type Session } from './session'
import { safeNext } from './request'

export const STEP_UP_MS = 10 * 60_000

export const stepUpOpen = (s: Session | null, now = Date.now()) => !!s?.stepUpUntil && Date.parse(s.stepUpUntil) > now

export async function openStepUp(db: D1Database, sessionId: string, now = Date.now()) {
  await db.prepare('UPDATE session SET step_up_until = ? WHERE id = ?').bind(new Date(now + STEP_UP_MS).toISOString(), sessionId).run()
}

/** Where to come back to after the step-up: the page itself for a GET, the page the form was on for a POST. */
function backTo(c: Context): string {
  const url = new URL(c.req.url)
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return url.pathname + url.search
  const ref = c.req.header('referer')
  if (ref) {
    try {
      const r = new URL(ref)
      if (r.origin === url.origin) return r.pathname + r.search
    } catch {
      // ignore a malformed referer
    }
  }
  return '/'
}

/**
 * Guard for an everyday bare-handle act (A5): a signed-in session whose email is verified. Returns null when
 * that holds; otherwise a redirect to /signin?next=… (signed out) or /check-email (unverified).
 *
 *   const stop = await requireVerified(c); if (stop) return stop
 */
export async function requireVerified<E extends { Bindings: { DB: D1Database } }>(c: Context<E>, opts: { next?: string; now?: number } = {}): Promise<Response | null> {
  const session = await readSession((c.env as { DB: D1Database }).DB, getCookie(c, COOKIE), opts.now ?? Date.now())
  return gate(c, session, opts.next) ?? null
}

/**
 * Guard for a gated act. Returns null when the session is verified and its window is open; otherwise a
 * redirect to /step-up?next=… (or to /signin when signed out, /check-email when unverified). `next` must be
 * a same-site path; anything else becomes "/".
 *
 *   const stop = await requireStepUp(c); if (stop) return stop
 */
export async function requireStepUp<E extends { Bindings: { DB: D1Database } }>(c: Context<E>, opts: { next?: string; now?: number } = {}): Promise<Response | null> {
  const now = opts.now ?? Date.now()
  const session = await readSession((c.env as { DB: D1Database }).DB, getCookie(c, COOKIE), now)
  const stop = gate(c, session, opts.next)
  if (stop) return stop
  if (stepUpOpen(session, now)) return null
  return c.redirect(`/step-up?next=${encodeURIComponent(safeNext(opts.next ?? backTo(c)) ?? '/')}`, 303)
}

/** Signed out goes to sign-in, unverified goes to check-your-email; undefined when neither. */
function gate(c: Context, session: Session | null, next?: string): Response | undefined {
  if (!session) return c.redirect(`/signin?next=${encodeURIComponent(safeNext(next ?? backTo(c)) ?? '/')}`, 303)
  if (!session.verified) return c.redirect('/check-email', 303)
}
