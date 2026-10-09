// Return-to links for pages, and what to call the page someone came from ("back to …" after verifying).
import { safeNext } from './request'

/** `path` with ?next= when `next` is a same-site path (else plain `path`). */
export const withNext = (path: string, next?: string | null) => {
  const n = safeNext(next)
  return n ? `${path}?next=${encodeURIComponent(n)}` : path
}

/** The "join" and "sign in" links a page shows signed out: they come back to `here` afterwards. */
export const joinHref = (here?: string | null) => withNext('/join', here)
export const signInHref = (here?: string | null) => withNext('/signin', here)

/** This request's own path and query, for joinHref(here(c)). */
export const here = (c: { req: { url: string } }) => {
  const u = new URL(c.req.url)
  return u.pathname + u.search
}

/** "back to <title>" for a node page (/w/<path>, its submissions, branches or log); else "where you were". */
export async function backLabel(db: D1Database, next: string): Promise<string> {
  const m = /^\/w\/([^?#]+)/.exec(next)
  if (m) {
    let path = ''
    try {
      path = decodeURIComponent(m[1])
    } catch {
      // malformed escapes: no title
    }
    path = path.replace(/\/+$/, '').replace(/\/(s\/\d+|branches|log)$/, '')
    // OPEN: a node held or blocked by triage, or hidden, never shows its title here; pending ones do, like the reading pages.
    const row = path
      ? await db.prepare("SELECT title FROM node WHERE path = ? AND hidden = 0 AND triage NOT IN ('held', 'blocked')").bind(path).first<{ title: string }>()
      : null
    if (row) return row.title
  }
  return 'where you were'
}
