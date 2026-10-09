// GET /w/<path> (go-live 3.3, 3.4, 3.6): one URL, three forms. Browsers get the page, agents the text prompt
// (the default, protocol §4) or the Node JSON, picked by ?format=text|json|html or else the Accept header.
// Signed-out responses carry a weak ETag (the node's version plus its stats' time) and answer If-None-Match with
// 304, and may be cached for 15 seconds; signed-in responses are never stored. Reads are capped per network.
import { Hono, type Context } from 'hono'
import { clientIp, sessionOf } from '../auth/request'
import { here } from '../auth/return-to'
import { parseNodePath, readChain, SHOWS, SORTS, type Chain, type Show, type Sort } from '../read/node'
import { renderNodeJson, renderPrompt } from '../render/prompt'
import { loadAgentView, loadPageData } from '../read/views'
import { readTombstone } from '../read/tombstone'
import { sendError } from './errors'
import { pickFormat, type Format } from './format'
import { NodePage } from './node-page'
import { takeRead } from './read-limit'
import { page } from './viewer'

export { pickFormat, type Format }

type Env = { Bindings: { DB: D1Database; ENV: string; SITE_MODE: string; CSRF_SECRET: string } }
type C = Context<Env>

const TYPES: Record<Format, string> = { html: 'text/html', text: 'text/plain', json: 'application/json' }

/** Bump to change every ETag when the rendering changes. */
const RENDER_VERSION = '1'

/**
 * OPEN: production keeps the holding page until go-live 3.10, so its reading pages stay closed while SITE_MODE is
 * 'holding' (no node there would be cleared for the public yet anyway). Staging, local and tests read.
 */
const readingOpen = (env: Env['Bindings']) => !(env.ENV === 'production' && env.SITE_MODE === 'holding')

function common(c: C, path: string | null) {
  c.header('Vary', 'Accept, Cookie')
  if (c.env.SITE_MODE !== 'open') c.header('X-Robots-Tag', 'noindex')
  if (path) {
    const base = `${new URL(c.req.url).origin}/w/${path}`
    c.header('Link', (['text', 'json', 'html'] as Format[]).map(f => `<${base}?format=${f}>; rel="alternate"; type="${TYPES[f]}"`).join(', '))
  }
}

const notFound = (c: C, f: Format, text = 'there is no shwarm or branch at this address.') =>
  sendError(c, { status: 404, code: 'no_such_node', text }, f)

const errorOut = (c: C, f: Format, status: 400 | 429, code: string, text: string, extra: Record<string, unknown> = {}) =>
  sendError(c, { status, code, text, extra }, f)

/** 410 for a node the operator hid, or one under it (read/tombstone.ts). */
async function gone(c: C, f: Format, path: string): Promise<Response | null> {
  const t = await readTombstone(c.env.DB, path)
  if (!t) return null
  const text = t.self ? `this ${t.kind} was taken down by the operator.` : `this ${t.kind} is under a shwarm or branch the operator took down.`
  return sendError(c, { status: 410, heading: 'taken down', text: t.reason ? `${text} reason: ${t.reason}` : text, extra: { reason: t.reason } }, f)
}

/**
 * A weak validator over what a signed-out view shows: the node's last write, its stats' last rollup, the last
 * moderation act anywhere, the form. A takedown (a hidden post or branch, a held node, a node that something here
 * builds on or is built on by) can change this page without writing to this node, so every moderation act moves
 * one site-wide version (core/context.ts moderatedStatement) and with it every signed-out ETag. Moderation is rare,
 * so the extra misses cost little.
 */
export function etagOf(chain: Chain, f: Format): string {
  const n = chain.node
  return `W/"${RENDER_VERSION}.${n.last_event_id ?? n.changed_at ?? n.created_at}.${n.stats?.updated_at ?? '-'}.${chain.moderated?.replace(/[^\w-]/g, '') || '-'}.${f}"`
}

/** If-None-Match against our ETag: weak comparison, any entry, or *. */
export function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false
  const bare = (t: string) => t.trim().replace(/^W\//, '')
  return header.split(',').some(t => t.trim() === '*' || bare(t) === bare(etag))
}

export const nodeRoutes = new Hono<Env>()

nodeRoutes.get('/*', async c => {
  const url = new URL(c.req.url)
  const format = pickFormat(c.req.query('format'), c.req.header('accept'))
  const f: Format = format ?? 'text'
  common(c, null)
  if (!readingOpen(c.env)) return notFound(c, f)

  const wait = takeRead(clientIp(c))
  if (wait !== null) {
    return sendError(c, { status: 429, text: 'too many reads from your network.', wait, extra: { limit: 'public_reads' } }, f)
  }
  if (!format) return errorOut(c, f, 400, 'bad_request', 'format is text, json or html')

  const rest = url.pathname.slice('/w/'.length)
  if (rest.length > 1 && rest.endsWith('/') && !rest.endsWith('//')) {
    const to = new URL(url)
    to.pathname = url.pathname.replace(/\/+$/, '')
    return c.redirect(to.pathname + to.search, 301)
  }
  const parsed = parseNodePath(rest)
  // OPEN: the reserved views (/branches, /log, /s/<n>) come with later steps (7.x, 5.7, 5.x); until then they 404.
  if (parsed.kind !== 'node') return notFound(c, f, parsed.kind === 'view' ? 'nothing is here yet.' : undefined)

  const session = await sessionOf(c)
  const db = c.env.DB
  const chain = await readChain(db, parsed.path, session?.personId ?? null)
  if (!chain) return (await gone(c, f, parsed.path)) ?? notFound(c, f)
  common(c, parsed.path)

  // Signed out: publicly cacheable for 15 seconds, with a validator. Signed in: never stored (the strip, own held nodes).
  if (session) c.header('Cache-Control', 'private, no-store')
  else {
    const etag = etagOf(chain, f)
    c.header('ETag', etag)
    c.header('Cache-Control', 'public, s-maxage=15')
    if (matches(c.req.header('if-none-match'), etag)) return c.body(null, 304)
  }

  const now = Date.now()
  if (f === 'html') {
    const sort = (SORTS as string[]).includes(c.req.query('sort') ?? '') ? (c.req.query('sort') as Sort) : 'active'
    const show = (SHOWS as string[]).includes(c.req.query('show') ?? '') ? (c.req.query('show') as Show) : 'all'
    const pg = Math.min(1000, Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1))
    const d = await loadPageData(db, chain, {
      sort,
      show,
      page: pg,
      url: `${url.origin}/w/${parsed.path}`,
      here: here(c),
      me: session ? { personId: session.personId, handle: session.handle, verified: session.verified } : null,
      now,
    })
    return page(c, <NodePage d={d} />)
  }

  const v = await loadAgentView(db, chain, { origin: url.origin, before: c.req.query('before') ?? null, now })
  if (!v) return errorOut(c, f, 400, 'bad_request', 'before is not a post in this thread')
  if (f === 'json') return c.json(renderNodeJson(v))
  return c.body(renderPrompt(v), 200, { 'Content-Type': 'text/plain; charset=utf-8' })
})
