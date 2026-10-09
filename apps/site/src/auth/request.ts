// Per-request helpers for the account pages: who is signed in, the pre-session cookie that form tokens bind
// to when nobody is, and safe `next=` paths.
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { fromBase64url, toBase64url, utf8 } from '@shwarm/protocol'
import { formToken, formTokenOk } from './csrf'
import { COOKIE, readSession, type Session } from './session'

export type AuthEnv = {
  DB: D1Database
  ENV: string
  PASSWORD_PEPPER: string
  CSRF_SECRET: string
  TURNSTILE_SECRET?: string
  TURNSTILE_SITE_KEY?: string
}
export type AuthContext = Context<{ Bindings: AuthEnv }>

// Signed out, form tokens bind to this random cookie, so another site can't forge a form for this browser.
export const PRE_COOKIE = '__Host-shwarm-pre'
const PRE_SECONDS = 2 * 3600 // refreshed on every page with a form
export const FORM_FIELD = 'form_token'

export const clientIp = (c: Context) => c.req.header('cf-connecting-ip') ?? null

export type Who = { session: Session | null; token: string | undefined; pre: string | undefined }

// One session read per request, shared by who(), the header strip and anything else that asks.
const sessions = new WeakMap<Request, Promise<Session | null>>()

/** Whether the request carries a session cookie at all (it may still be expired or made up). No database read. */
export const hasSessionCookie = (c: Context) => !!getCookie(c, COOKIE)

/** This request's signed-in session, read at most once. No cookie means no database read. */
export function sessionOf<E extends { Bindings: { DB: D1Database } }>(c: Context<E>): Promise<Session | null> {
  let s = sessions.get(c.req.raw)
  if (!s) {
    const token = getCookie(c, COOKIE)
    s = token ? readSession((c.env as { DB: D1Database }).DB, token) : Promise.resolve(null)
    sessions.set(c.req.raw, s)
  }
  return s
}

export async function who(c: AuthContext): Promise<Who> {
  const token = getCookie(c, COOKIE)
  const session = await sessionOf(c)
  const pre = getCookie(c, PRE_COOKIE)
  return { session, token, pre: pre && /^[A-Za-z0-9_-]{43}$/.test(pre) ? pre : undefined }
}

/** The form token for a page, setting (or refreshing) the pre-session cookie when signed out. */
export async function pageToken(c: AuthContext, w: Who): Promise<string> {
  if (w.session) return formToken(c.env.CSRF_SECRET, w.session.id)
  const pre = w.pre ?? toBase64url(crypto.getRandomValues(new Uint8Array(32)))
  w.pre = pre
  c.header('Set-Cookie', `${PRE_COOKIE}=${pre}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${PRE_SECONDS}`, { append: true })
  return formToken(c.env.CSRF_SECRET, 'pre:' + pre)
}

/** A posted form token is good if it matches this browser's session or its pre-session cookie. */
export async function postedTokenOk(c: AuthContext, w: Who, form: Record<string, unknown>): Promise<boolean> {
  const t = form[FORM_FIELD]
  if (w.session && (await formTokenOk(c.env.CSRF_SECRET, w.session.id, t))) return true
  return !!w.pre && (await formTokenOk(c.env.CSRF_SECRET, 'pre:' + w.pre, t))
}

/** Form fields as single strings (repeated or file fields are ignored). */
export async function formOf(c: Context): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    const body = await c.req.parseBody()
    for (const [k, v] of Object.entries(body)) if (typeof v === 'string') out[k] = v
  } catch {
    // not a form: every field missing
  }
  return out
}

/** A same-site path for `next=`, or null. One leading slash, no scheme or host, no backslashes or control characters. */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return null
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\x00-\x1f\x7f]/.test(raw)) return null
  try {
    const base = 'https://shwarm.invalid'
    const u = new URL(raw, base)
    if (u.origin !== base) return null
    // Check the normalized path too: dot segments collapse, so "/.//evil.example" comes back as "//evil.example".
    const out = u.pathname + u.search + u.hash
    if (out.startsWith('//') || out.includes('\\')) return null
    return out
  } catch {
    return null
  }
}

// Return-to (go-live 3.x/4.1): a `next` path that has to survive a trip through a URL or an emailed link is
// carried signed, "<base64url path>.<mac>", and checked with safeNext() again when it comes back. `scope`
// names the leg it's good for ('check', 'verified', or 'verify:<the email token>'), so one can't stand in
// for another.
const nextMac = (secret: string, path: string, scope: string) => formToken(secret, `next:${scope}:${path}`)

/** `next` (already a safeNext() path) signed for one leg of the trip. */
export async function signNext(secret: string, next: string, scope: string): Promise<string> {
  return `${toBase64url(utf8(next))}.${await nextMac(secret, next, scope)}`
}

/** The same-site path in a signed next, or null if it's missing, altered, from another scope or not same-site. */
export async function openNext(secret: string, signed: unknown, scope: string): Promise<string | null> {
  if (typeof signed !== 'string' || signed.length > 1024) return null
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(signed)
  if (!m) return null
  let path: string
  try {
    path = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(fromBase64url(m[1]))
  } catch {
    return null
  }
  if (!(await formTokenOk(secret, `next:${scope}:${path}`, m[2]))) return null
  return safeNext(path) === path ? path : null
}

/**
 * Runs `work` after the response when the runtime gives an ExecutionContext (so its time doesn't show in the
 * response), else right now. Errors after the response are logged; errors now are thrown.
 */
export async function later(c: Context, work: () => Promise<unknown>): Promise<void> {
  let ctx: { waitUntil(p: Promise<unknown>): void } | undefined
  try {
    ctx = c.executionCtx
  } catch {
    // no ExecutionContext (tests, direct calls)
  }
  if (!ctx) {
    await work()
    return
  }
  ctx.waitUntil(work().catch(e => console.error('deferred work failed', e)))
}
