// Who is looking at a page, for the header strip. Pages render through page(), which reads the session
// once (no database read when there's no session cookie) and hands the viewer to the layout through a
// JSX context, so page components don't pass it down by hand.
import type { Context } from 'hono'
import { html } from 'hono/html'
import { createContext, type Child, type FC } from 'hono/jsx'
import { formToken } from '../auth/csrf'
import { sessionOf } from '../auth/request'
import { here } from '../auth/return-to'

/** A signed-in viewer: their handle, whether their email is verified, unread inbox items, the sign-out form token. */
export type Viewer = { handle: string; verified: boolean; unread: number; token: string }

/** What the layout needs from the request: the viewer, and the page to come back to after signing in. */
export type PageInfo = { viewer: Viewer | null; here?: string }
export const PageContext = createContext<PageInfo>({ viewer: null })

// Account pages don't send people back to themselves.
const NO_RETURN = /^\/(join|signin|signout|check-email|verify|verified|forgot|reset|step-up)(\/|\?|$)/

type PageEnv = { Bindings: { DB: D1Database; CSRF_SECRET: string } }
const envOf = (c: Context) => c.env as PageEnv['Bindings']

export async function viewerOf<E extends PageEnv>(c: Context<E>): Promise<Viewer | null> {
  const s = await sessionOf(c)
  if (!s) return null
  // OPEN: "for you N" counts unread inbox items (not yet opened); 100 or more shows as 99+.
  const unread = s.verified
    ? ((await envOf(c).DB.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM inbox_item WHERE person_id = ? AND read_at IS NULL LIMIT 100)')
        .bind(s.personId)
        .first<number>('n')) ?? 0)
    : 0
  return { handle: s.handle, verified: s.verified, unread, token: await formToken(envOf(c).CSRF_SECRET, s.id) }
}

/** Sends a full page: the doctype, then `node` with the viewer in context for the header strip. */
export async function page<E extends PageEnv>(c: Context<E>, node: Child | ReturnType<FC>, status: 200 | 400 | 403 | 404 | 410 | 413 | 429 | 500 = 200) {
  const viewer = await viewerOf(c)
  if (viewer) c.header('Cache-Control', 'private, no-store') // a signed-in page is never cached
  const at = here(c)
  const info: PageInfo = { viewer, here: at === '/' || NO_RETURN.test(at) ? undefined : at }
  return c.html(html`<!doctype html>${<PageContext.Provider value={info}>{node as Child}</PageContext.Provider>}`, status)
}
