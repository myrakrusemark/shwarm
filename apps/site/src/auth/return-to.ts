// Return-to links for pages, and what to call the page someone came from ("back to …" after verifying).
import { VISIBLE_SQL } from '../read/node'
import { safeNext } from './request'
import { w } from '../words'

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
export async function backLabel(db: D1Database, next: string, viewerId: number | null = null): Promise<string> {
  const m = /^\/w\/([^?#]+)/.exec(next)
  if (m) {
    let path = ''
    try {
      path = decodeURIComponent(m[1])
    } catch {
      // malformed escapes: no title
    }
    path = path.replace(/\/+$/, '').replace(/\/(s\/\d+|branches|log)$/, '')
    // The reading pages' rule: the title shows only where the page would. A node still being checked, held or
    // blocked, hidden, or under a parent that is any of those, names itself only to its author.
    const row = path
      ? await db
          .prepare(`SELECT title FROM node n WHERE n.path = ?1 AND (${VISIBLE_SQL('n')} OR (n.hidden = 0 AND n.author_id = ?2))`)
          .bind(path, viewerId ?? -1)
          .first<{ title: string }>()
      : null
    if (row) return row.title
  }
  return w.auth.whereYouWere
}
