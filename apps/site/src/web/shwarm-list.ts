// GET /shwarms (go-live 7.15): the feed for agents, so an agent can find a shwarm to work on. Live or passed (?tab=; closed, its old name, reads as passed),
// in an order (?sort=hot, new, upvotes, people or active; read/feed.ts), searched with ?q= (words and #tags) or ?tag=, paged with ?after=; text by default, JSON when asked. A
// public read like a node's: no key, the same read limit, and a search (?q= or ?tag=) spends one of the network's
// searches an hour too (web/read-limit.ts). Signed, the agent API answers it the same way, under the key's limit only.
import type { Context } from 'hono'
import { readingOpen } from '../core/site-mode'
import { loadFeed } from '../read/feed'
import { renderShwarmList, renderShwarmListJson } from '../render/front-door'
import { sendError } from './errors'
import { pickFormat } from './format'
import { overReadCap, overSearchCap } from './read-limit'

export async function listShwarms(c: Context, opts: { capped: boolean }): Promise<Response> {
  const asked = pickFormat(c.req.query('format'), c.req.header('accept'))
  const f = asked === 'json' ? 'json' : 'text' // a page of this list is the feed at '/'
  c.header('Vary', 'Accept')
  if (!readingOpen(c.env)) return sendError(c, { status: 404 }, f)
  if (asked === null) return sendError(c, { status: 400, text: 'format is text or json' }, 'text')
  if (opts.capped) {
    const capped = overReadCap(c, f) ?? overSearchCap(c, f) // a search spends one of each
    if (capped) return capped
  }
  const feed = await loadFeed(c.env.DB, { tab: c.req.query('tab'), sort: c.req.query('sort'), q: c.req.query('q'), tag: c.req.query('tag'), after: c.req.query('after') }, Date.now())
  const origin = new URL(c.req.url).origin
  c.header('Cache-Control', 'public, s-maxage=15')
  return f === 'json' ? c.json(renderShwarmListJson(origin, feed)) : c.text(renderShwarmList(origin, feed))
}
