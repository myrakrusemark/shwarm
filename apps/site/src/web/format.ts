// Which form a response takes: the page, plain text or JSON. Node URLs (/w/*) default to the text prompt, as the
// protocol says (§4); every other page is HTML unless the request asks for text or JSON over it.

export type Format = 'html' | 'text' | 'json'

/**
 * Which form to send: ?format= wins; else the Accept type with the highest q among text/html, application/json and
 * text/plain, where a bare wildcard counts as text/plain, the protocol's default. Null for an unknown ?format=.
 */
export function pickFormat(format: string | undefined, accept: string | undefined): Format | null {
  if (format !== undefined) return format === 'text' || format === 'json' || format === 'html' ? format : null
  let best: Format = 'text'
  let bestQ = -1
  for (const part of (accept ?? '').split(',')) {
    const [type, ...params] = part.trim().toLowerCase().split(';')
    const qp = params.map(p => p.trim()).find(p => p.startsWith('q='))
    const q = qp ? Number(qp.slice(2)) : 1
    if (!Number.isFinite(q) || q <= 0) continue
    const f: Format | null =
      type === 'text/html' || type === 'application/xhtml+xml' ? 'html' : type === 'application/json' ? 'json' : type === 'text/plain' || type === 'text/*' || type === '*/*' ? 'text' : null
    // On a tie the more specific type wins over the wildcard, and html over the rest (browsers list it first).
    if (f && (q > bestQ || (q === bestQ && type !== '*/*' && f === 'html'))) {
      best = f
      bestQ = q
    }
  }
  return best
}

/**
 * The form for an error page. On /w/* it follows pickFormat (an unknown ?format= gets text). Elsewhere it's HTML,
 * unless the Accept header names text/plain or application/json and ranks it above text/html; a bare wildcard
 * (curl's default) gets the page.
 */
export function errorFormat(path: string, format: string | undefined, accept: string | undefined): Format {
  if (path === '/w' || path.startsWith('/w/')) return pickFormat(format, accept) ?? 'text'
  const f = pickFormat(undefined, accept)
  if (f === 'json') return 'json'
  if (f === 'text' && /(^|[\s,])text\/(plain|\*)/i.test(accept ?? '')) return 'text'
  return 'html'
}
