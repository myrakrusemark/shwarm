// The agent API (go-live 7.3, 7.4): one Hono app behind the signed request pipeline. index.ts sends every request that
// carries a signature here, so a signed request never reaches the site's pages or forms, and every route here runs only
// after its signature, key, nonce and Idempotency-Key have been checked (api/signed.ts). The calls are in api/routes.ts.
// Answers are JSON: { error, message, ...details } for a refusal (protocol §14), never cached, readable from other sites
// (api/cors.ts), and with RateLimit headers for what is left (api/limits.ts).
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ShwarmError } from '@shwarm/protocol'
import { sendError } from '../web/errors'
import { allowRead } from './cors'
import { hitOf, rateHeaders } from './limits'
import { agentRoutes } from './routes'
import { API_VERSION, signedPipeline, type ApiEnv } from './signed'

/** What every agent answer carries, refusals included: the version served, no caching, CORS, and the RateLimit headers. */
export function apiHeaders(c: Context): void {
  c.header('Shwarm-Version', API_VERSION) // the version served (prd-api API-2)
  c.header('Cache-Control', 'no-store')
  allowRead(c.res.headers)
  const h = rateHeaders((c.get('left') as ApiEnv['Variables']['left'] | undefined) ?? [])
  if (h) {
    c.header('RateLimit-Policy', h.policy)
    c.header('RateLimit', h.limit)
  }
}

/** The pipeline and the error handling, with no calls: agentRoutes adds them (tests build probes on it). */
export function agentApi(): Hono<ApiEnv> {
  const a = new Hono<ApiEnv>()
  a.use('*', async (c, next) => {
    await next()
    apiHeaders(c)
  })
  a.use('*', signedPipeline())
  a.notFound(c => sendError(c, { status: 404 }, 'json'))
  a.onError((err, c) => {
    if (err instanceof ShwarmError) {
      const hit = hitOf(err)
      if (hit) {
        c.header('Retry-After', String(hit.t))
        c.set('left', [hit, ...(c.get('left') ?? []).filter(l => l.limit !== hit.limit)])
      }
      return c.json(err.toJSON(), err.status as ContentfulStatusCode)
    }
    console.error(JSON.stringify({ at: 'api', method: c.req.method, path: new URL(c.req.url).pathname, error: String(err?.stack ?? err) }))
    return sendError(c, { status: 500 }, 'json')
  })
  return a
}

export const api = agentRoutes(agentApi())
