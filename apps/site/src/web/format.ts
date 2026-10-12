// Which form a response takes: the page, plain text or JSON. Node URLs (/w/*) default to the text prompt, as the
// protocol says (§4); every other page is HTML unless the request asks for text or JSON over it.

export type Format = 'html' | 'text' | 'json'

// Link-preview fetchers (go-live 11.7). They read the og: tags of the HTML page, but most send `Accept: */*` (Slackbot,
// Discordbot, Twitterbot, facebookexternalhit) or no Accept at all (Bluesky's Cardyb), which on /w/* is the text prompt:
// Bluesky showed a shared shwarm as the prompt's first lines under a bare URL (Oct 12). One that asks for nothing by name
// gets the page. An agent that sends one of these names still gets text or JSON by asking for it.
const PREVIEW_UA =
  /\b(slackbot|discordbot|cardyb|mastodon|pleroma|akkoma|misskey|twitterbot|facebookexternalhit|facebot|linkedinbot|telegrambot|whatsapp|redditbot|skypeuripreview|iframely|embedly|mattermost|zulip|vkshare|pinterestbot)\b/i

/** Whether a User-Agent is a known link-preview fetcher (chat apps, social sites, unfurl services). */
export const previewFetcher = (ua: string | undefined): boolean => !!ua && PREVIEW_UA.test(ua)

/**
 * Which form to send: ?format= wins; else the Accept type with the highest q among text/html, application/json and
 * text/plain, where a bare wildcard counts as text/plain, the protocol's default. Null for an unknown ?format=.
 * A link-preview fetcher (`ua`, previewFetcher) that names no type, only a wildcard or nothing, gets html.
 */
export function pickFormat(format: string | undefined, accept: string | undefined, ua?: string): Format | null {
  if (format !== undefined) return format === 'text' || format === 'json' || format === 'html' ? format : null
  let best: Format = 'text'
  let bestQ = -1
  let named = false // a type other than a wildcard was chosen
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
      named = type !== '*/*' && type !== 'text/*'
    }
  }
  return !named && previewFetcher(ua) ? 'html' : best
}

/**
 * The form for an error page. On /w/* it follows pickFormat (an unknown ?format= gets text). Elsewhere it's HTML
 * when the Accept header asks for text/html above the rest (every browser does), JSON when it ranks
 * application/json first, and one line of text otherwise, a bare wildcard (curl's default) included (go-live 7.13). No Accept
 * header at all keeps the page.
 */
export function errorFormat(path: string, format: string | undefined, accept: string | undefined): Format {
  if (path === '/w' || path.startsWith('/w/')) return pickFormat(format, accept) ?? 'text'
  const f = pickFormat(undefined, accept)
  if (f === 'json') return 'json'
  if (f === 'text' && accept !== undefined) return 'text' // no HTML asked for (curl's */*, or no Accept): an agent gets one line (go-live 7.13)
  return 'html'
}
