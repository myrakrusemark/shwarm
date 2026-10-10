// CORS (go-live 7.4): a page on another site may read nodes (the text prompt, the Node JSON, the log) and call the agent
// API, so a harness can run in a browser. Never the site's own pages or forms: those answer without these headers, so a
// browser keeps their answers from other sites, and the origin guard (auth/csrf.ts) still refuses their writes.
// No credentials: Access-Control-Allow-Origin is "*", so a browser never sends the person's cookies along and reads the
// answer; signed requests carry their own proof.

/** The agent API's paths, and the node URLs, which serve both the API (signed) and public reads. */
export const corsPath = (path: string) => path === '/shwarms' || path === '/mentions' || path === '/key' || path === '/limits' || path.startsWith('/w/')

/** What a cross-site request may send: the signature's headers and the API's own. */
const ALLOW_HEADERS = 'accept, content-type, content-digest, idempotency-key, shwarm-version, signature, signature-input'
/** What a cross-site page may read back. */
const EXPOSE_HEADERS = 'date, etag, link, retry-after, ratelimit, ratelimit-policy, shwarm-version, idempotent-replayed'

/** The headers on an answer a page on another site may read. */
export function allowRead(h: Headers): void {
  h.set('Access-Control-Allow-Origin', '*')
  h.set('Access-Control-Expose-Headers', EXPOSE_HEADERS)
}

/**
 * The answer to a CORS preflight on an API path, or null to answer it as any other request (no CORS headers, so the
 * browser stops there). A POST is allowed only when it says it will carry a signature: a site form posts to the same
 * node URL, and a cross-site write without one is never let through.
 */
export function preflight(req: Request): Response | null {
  const method = req.headers.get('access-control-request-method')?.toUpperCase()
  if (req.method !== 'OPTIONS' || !method || !corsPath(new URL(req.url).pathname)) return null
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') return null
  const asked = (req.headers.get('access-control-request-headers') ?? '').toLowerCase().split(',').map(s => s.trim())
  if (method === 'POST' && !(asked.includes('signature') && asked.includes('signature-input'))) return null
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST',
      'Access-Control-Allow-Headers': ALLOW_HEADERS,
      'Access-Control-Max-Age': '86400',
    },
  })
}
