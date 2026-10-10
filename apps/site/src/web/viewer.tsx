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
import { inBeta } from '../core/site-mode'

/** A signed-in viewer: their handle, whether their email is verified, unread inbox items, the sign-out form token. */
export type Viewer = { handle: string; verified: boolean; unread: number; token: string }

/**
 * What the layout needs from the request: the viewer, and the page to come back to after signing in. `opensSoon`: the
 * site is in beta (go-live 3.10) and this viewer isn't invited (signed out, or not a founding account or the operator),
 * so join, post, check and "start a shwarm" say it opens soon instead.
 */
export type PageInfo = { viewer: Viewer | null; here?: string; opensSoon?: boolean }
export const PageContext = createContext<PageInfo>({ viewer: null })

// Account pages don't send people back to themselves.
const NO_RETURN = /^\/(join|signin|signout|check-email|verify|verified|forgot|reset|step-up|email-change)(\/|\?|$)/

type PageEnv = { Bindings: { DB: D1Database; CSRF_SECRET: string; SITE_MODE?: string } }
const envOf = (c: Context) => c.env as PageEnv['Bindings']

export async function viewerOf<E extends PageEnv>(c: Context<E>): Promise<Viewer | null> {
  const s = await sessionOf(c)
  if (!s) return null
  // "for you N" counts the unread items the inbox shows (read/inbox.ts); 100 or more shows as 99+.
  // OPEN (#83): only "mark read", "mark all read" and a reply read an item; opening one doesn't.
  const unread = s.verified ? await unreadCount(envOf(c).DB, s.personId) : 0
  return { handle: s.handle, verified: s.verified, unread, token: await formToken(envOf(c).CSRF_SECRET, s.id) }
}

/** The site is in beta and this request's viewer may not act (PageInfo `opensSoon`). Reads only the cached session. */
export async function opensSoon<E extends PageEnv>(c: Context<E>): Promise<boolean> {
  if (!inBeta(envOf(c))) return false
  return !(await sessionOf(c))?.member
}

/** Sends a full page: the doctype, then `node` with the viewer in context for the header strip. */
export async function page<E extends PageEnv>(c: Context<E>, node: Child | ReturnType<FC>, status: 200 | 400 | 403 | 404 | 410 | 413 | 429 | 500 = 200) {
  const viewer = await viewerOf(c)
  if (viewer) c.header('Cache-Control', 'private, no-store') // a signed-in page is never cached
  const at = here(c)
  const info: PageInfo = { viewer, here: at === '/' || NO_RETURN.test(at) ? undefined : at, ...((await opensSoon(c)) ? { opensSoon: true } : {}) }
  return c.html(html`<!doctype html>${<PageContext.Provider value={info}>{node as Child}</PageContext.Provider>}`, status)
}
