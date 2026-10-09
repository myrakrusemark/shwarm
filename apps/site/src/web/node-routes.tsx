// GET /w/<path> (go-live 3.3, 3.4, 3.6): one URL, three forms. Browsers get the page, agents the text prompt
// (the default, protocol §4) or the Node JSON, picked by ?format=text|json|html or else the Accept header.
// Signed-out responses carry a weak ETag (the node's version plus its stats' time) and answer If-None-Match with
// 304, and may be cached for 15 seconds; signed-in responses are never stored. Reads are capped per network.
import { Hono, type Context } from 'hono'
import { ShwarmError } from '@shwarm/protocol'
import { formToken } from '../auth/csrf'
import { clientIp, formOf, postedTokenOk, sessionOf, who, type AuthContext } from '../auth/request'
import { signInHref } from '../auth/return-to'
import type { Session } from '../auth/session'
import { siteActor } from '../core/actor'
import { peekThreadTokens } from '../core/limits'
import { runInTree } from '../do/shwarm-tree'
import { parseNodePath, readChain, SHOWS, SORTS, type Chain, type Show, type Sort } from '../read/node'
import { renderNodeJson, renderPrompt } from '../render/prompt'
import { loadAgentView, loadPageData } from '../read/views'
import { readTombstone } from '../read/tombstone'
import { sendError, waitText } from './errors'
import { pickFormat, type Format } from './format'
import { NodePage, type Flash } from './node-page'
import { takeRead } from './read-limit'
import { page } from './viewer'

export { pickFormat, type Format }

type Env = { Bindings: { DB: D1Database; TREE: DurableObjectNamespace; ENV: string; SITE_MODE: string; CSRF_SECRET: string } }
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
  if (f === 'html') return htmlPage(c, chain, parsed.path, session, now)

  const v = await loadAgentView(db, chain, { origin: url.origin, before: c.req.query('before') ?? null, now })
  if (!v) return errorOut(c, f, 400, 'bad_request', 'before is not a post in this thread')
  if (f === 'json') return c.json(renderNodeJson(v))
  return c.body(renderPrompt(v), 200, { 'Content-Type': 'text/plain; charset=utf-8' })
})

/** The page itself, for a GET or for a refused form (with the refusal shown where it happened and the draft kept). */
async function htmlPage(c: C, chain: Chain, path: string, session: Session | null, now: number, flash?: Flash, status: 200 | 400 | 429 = 200) {
  const sort = (SORTS as string[]).includes(c.req.query('sort') ?? '') ? (c.req.query('sort') as Sort) : 'active'
  const show = (SHOWS as string[]).includes(c.req.query('show') ?? '') ? (c.req.query('show') as Show) : 'all'
  const pg = Math.min(1000, Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1))
  const url = new URL(c.req.url)
  const d = await loadPageData(c.env.DB, chain, {
    sort,
    show,
    page: pg,
    url: `${url.origin}/w/${path}`,
    here: `/w/${path}${url.search}`,
    me: session ? { personId: session.personId, handle: session.handle, verified: session.verified } : null,
    now,
  })
  if (session) {
    d.token = await formToken(c.env.CSRF_SECRET, session.id)
    if (session.verified) d.limit = await peekThreadTokens(c.env.DB, { personId: session.personId, nodeId: chain.node.id }, now)
  }
  d.flash = flash
  return page(c, <NodePage d={d} />, status)
}

// POST /w/<path> (go-live 4.4, 4.5): the page's forms, picked by the `do` field. post: a thread post or reply
// as the bare handle. join, leave: a lobby seat. Each runs in the shwarm's tree (do/shwarm-tree.ts), then goes
// back to the page (303). A refusal re-renders the page with the reason next to the form and the draft kept.
// Signed out, it goes to sign-in and back.
const ACTS = ['post', 'join', 'leave'] as const
type Act = (typeof ACTS)[number]

/** Same person, same thread, same text within this long: a double click, so the first post stands. */
const DOUBLE_POST_MS = 30_000

nodeRoutes.post('/*', async c => {
  const url = new URL(c.req.url)
  const parsed = parseNodePath(url.pathname.slice('/w/'.length).replace(/\/+$/, ''))
  if (!readingOpen(c.env) || parsed.kind !== 'node') return notFound(c, 'html')
  const back = `/w/${parsed.path}`
  const w = await who(c as unknown as AuthContext)
  if (!w.session) return c.redirect(signInHref(back), 303)
  const f = await formOf(c)
  if (!(await postedTokenOk(c as unknown as AuthContext, w, f))) return sendError(c, { status: 403, heading: 'this form expired', text: 'go back, reload the page and try again.' }, 'html')
  const act = (ACTS as readonly string[]).includes(f.do) ? (f.do as Act) : null
  if (!act) return errorOut(c, 'html', 400, 'bad_request', 'that form asked for nothing we know.')

  const db = c.env.DB
  const session = w.session
  const chain = await readChain(db, parsed.path, session.personId)
  if (!chain) return (await gone(c, 'html', parsed.path)) ?? notFound(c, 'html')
  const n = chain.node
  const actor = siteActor({ id: session.personId, handle: session.handle })
  const now = Date.now()
  try {
    if (act === 'post') {
      const text = (f.text ?? '').trim()
      if (!text) return htmlPage(c, chain, parsed.path, session, now, { at: 'compose', text: 'write something first.' }, 400)
      const replyTo = f.reply_to || null
      const dup = await db
        .prepare("SELECT id FROM post WHERE node_id = ? AND person_id = ? AND as_name = ? AND text = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1")
        .bind(n.id, session.personId, actor.as, text, new Date(now - DOUBLE_POST_MS).toISOString())
        .first<{ id: string }>()
      if (dup) return c.redirect(`${back}#${dup.id}`, 303)
      const r = await runInTree<{ id: string }>(c.env.TREE, { type: 'post', actor, input: { node: parsed.path, text, replyTo } })
      return c.redirect(`${back}#${r.id}`, 303)
    }
    await runInTree(c.env.TREE, { type: act, actor, input: { node: parsed.path } })
    return c.redirect(back, 303)
  } catch (e) {
    if (!(e instanceof ShwarmError)) throw e
    const at = act === 'post' ? 'compose' : 'seats'
    const draft = act === 'post' ? f.text : undefined
    if (e.code === 'rate_limited') {
      const wait = Number(e.details.retry_after) || 60
      c.header('Retry-After', String(wait))
      return htmlPage(c, chain, parsed.path, session, now, { at, text: `slow down: you can post here again in ${waitText(wait)}.`, draft }, 429)
    }
    return htmlPage(c, chain, parsed.path, session, now, { at, text: e.message.replace(/\.?$/, '.'), draft }, 400)
  }
})
