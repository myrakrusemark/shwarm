// Cross-site request protection: every write needs a same-origin request AND a form token.
// GET and HEAD never change anything. Signed agent API requests carry their own signature and skip this.
import type { MiddlewareHandler } from 'hono'
import { toBase64url, utf8 } from '@shwarm/protocol'
import { needsSignature } from '../web/errors'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Refuse writes whose Origin (or Sec-Fetch-Site) shows another site. A write with neither header is refused too. */
export function sameOrigin(req: Request): boolean {
  if (SAFE.has(req.method)) return true
  const site = req.headers.get('sec-fetch-site')
  if (site) return site === 'same-origin'
  const origin = req.headers.get('origin')
  return origin !== null && origin === new URL(req.url).origin
}

async function mac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toBase64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8('csrf:' + msg))))
}

/** The form token for this browser: bound to the session id when signed in, or to the pre-session cookie. */
export const formToken = (secret: string, binding: string) => mac(secret, binding)

export async function formTokenOk(secret: string, binding: string, token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || token.length > 100) return false
  const want = await mac(secret, binding)
  if (want.length !== token.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ token.charCodeAt(i)
  return diff === 0
}

/** Paths that prove themselves another way and take server-to-server POSTs, which carry no Origin header:
 *  /hooks/* check their own secret (HTTP basic auth, or Stripe's HMAC signature); /unsubscribe checks an HMAC-signed token (RFC 8058 one-click). */
export const selfAuthenticated = (path: string) => path.startsWith('/hooks/') || path === '/unsubscribe'

/** Middleware: same-origin check on every write. Form-token checks happen in each handler, which knows the binding. */
// Requests with an HTTP message signature skip it: they never reach the site's pages or forms (src/index.ts sends them
// to the agent API, which refuses anything whose signature doesn't verify). A cross-site page may send one after a
// CORS preflight (api/cors.ts), but only with a key's signature; without one, its write is refused here.
export const originGuard = (): MiddlewareHandler => async (c, next) => {
  if (selfAuthenticated(c.req.path)) return next()
  if (!c.req.raw.headers.has('signature-input') && !sameOrigin(c.req.raw)) {
    // No Origin and no Sec-Fetch-Site: not a browser, so most likely an agent that hasn't signed yet (go-live 7.12).
    const h = c.req.raw.headers
    if (!h.has('origin') && !h.has('sec-fetch-site')) return needsSignature(c)
    return c.text('this form came from another site, so it was refused.', 403)
  }
  await next()
}
