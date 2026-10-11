// Who is looking at a page, for the header strip. Pages render through page(), which reads the session
// once (no database read when there's no session cookie) and hands the viewer to the layout through a
// JSX context, so page components don't pass it down by hand.
import type { Context } from 'hono'
import { html } from 'hono/html'
import { createContext, type Child, type FC } from 'hono/jsx'
import { formToken } from '../auth/csrf'
import { sessionOf } from '../auth/request'
import { here } from '../auth/return-to'
import { unreadCount } from '../read/inbox'
import { actsLimited } from '../core/site-mode'
import { termsEntry } from '../core/terms'

/** A signed-in viewer: their handle, whether their email is verified, unread inbox items, the sign-out form token. */
export type Viewer = { handle: string; verified: boolean; unread: number; token: string }

/**
 * What the layout needs from the request: the viewer, and the page to come back to after signing in. `opensSoon`: the
 * site is in beta (go-live 3.10) and this viewer isn't invited (signed out, or not a founding account or the operator),
 * so join, post, check and "start a shwarm" say it opens soon instead. `checkout`: the Worker has a Stripe key, so the
 * donate modal posts to /donate (go-live 10.1); without one its button says checkout opens soon. `terms`: the viewer hasn't
 * accepted the announced terms version, so the layout shows the banner (go-live 10.2): the version, its effective date
 * ('2026-11-15', null when this deploy doesn't have it) and the page to come back to after "i accept". `origin`: the site's
 * own origin (siteOrigin), for the canonical link and og:url (go-live 11.7).
 */
export type PageInfo = { viewer: Viewer | null; here?: string; opensSoon?: boolean; checkout?: boolean; terms?: { version: string; effective: string | null; next: string }; origin?: string }
export const PageContext = createContext<PageInfo>({ viewer: null })

// Account pages don't send people back to themselves.
const NO_RETURN = /^\/(join|signin|signout|check-email|verify|verified|forgot|reset|step-up|email-change)(\/|\?|$)/

type PageEnv = { Bindings: { DB: D1Database; CSRF_SECRET: string; ENV?: string; SITE_MODE?: string; SITE_URL?: string; STRIPE_SECRET_KEY?: string } }
const envOf = (c: Context) => c.env as PageEnv['Bindings']

/** The site's own origin: SITE_URL when set (staging and production), else this request's. */
export const siteOrigin = (c: Context) => {
  const site = (c.env as { SITE_URL?: string } | undefined)?.SITE_URL
  return site ? new URL(site).origin : new URL(c.req.url).origin
}

/** The Worker has a Stripe key, so the donate modal posts (go-live 10.1). A signed-out page's ETag carries it too (node-routes.tsx etagOf). */
export const checkoutOn = (c: Context) => !!envOf(c).STRIPE_SECRET_KEY

export async function viewerOf<E extends PageEnv>(c: Context<E>): Promise<Viewer | null> {
  const s = await sessionOf(c)
  if (!s) return null
  // "for you N" counts the unread items the inbox shows (read/inbox.ts); 100 or more shows as 99+.
  // OPEN (#83): only "mark read", "mark all read" and a reply read an item; opening one doesn't.
  const unread = s.verified ? await unreadCount(envOf(c).DB, s.personId) : 0
  return { handle: s.handle, verified: s.verified, unread, token: await formToken(envOf(c).CSRF_SECRET, s.id) }
}

/**
 * Only invited accounts act right now (beta, or production in holding: actsLimited) and this request's viewer isn't one
 * (PageInfo `opensSoon`). Reads only the cached session.
 */
export async function opensSoon<E extends PageEnv>(c: Context<E>): Promise<boolean> {
  if (!actsLimited(envOf(c))) return false
  return !(await sessionOf(c))?.member
}

/** Sends a full page: the doctype, then `node` with the viewer in context for the header strip. */
export async function page<E extends PageEnv>(c: Context<E>, node: Child | ReturnType<FC>, status: 200 | 400 | 401 | 403 | 404 | 405 | 410 | 413 | 429 | 500 = 200) {
  const viewer = await viewerOf(c)
  if (viewer) c.header('Cache-Control', 'private, no-store') // a signed-in page is never cached
  const at = here(c)
  const back = at === '/' || NO_RETURN.test(at) ? undefined : at
  const behind = viewer ? (await sessionOf(c))?.termsBehind : null
  const info: PageInfo = {
    viewer,
    here: back,
    ...((await opensSoon(c)) ? { opensSoon: true } : {}),
    ...(checkoutOn(c) ? { checkout: true } : {}),
    ...(behind ? { terms: { version: behind, effective: termsEntry(behind)?.effective ?? null, next: back ?? '/' } } : {}),
    origin: siteOrigin(c),
  }
  return c.html(html`<!doctype html>${<PageContext.Provider value={info}>{node as Child}</PageContext.Provider>}`, status)
}
