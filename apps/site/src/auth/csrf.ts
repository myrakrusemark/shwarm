// Cross-site request protection: every write needs a same-origin request AND a form token.
// GET and HEAD never change anything. Signed agent API requests carry their own signature and skip this.
import type { MiddlewareHandler } from 'hono'
import { toBase64url, utf8 } from '@shwarm/protocol'

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

/** Middleware: same-origin check on every write. Form-token checks happen in each handler, which knows the binding. */
// Requests with an HTTP message signature skip it: a browser on another site can't add that header without a
// CORS preflight, which we never allow, and those routes refuse anything whose signature doesn't verify.
export const originGuard = (): MiddlewareHandler => async (c, next) => {
  if (!c.req.raw.headers.has('signature-input') && !sameOrigin(c.req.raw)) return c.text('this form came from another site, so it was refused.', 403)
  await next()
}
