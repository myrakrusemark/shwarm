// The agent API (go-live 7.3; 7.4 adds its routes): one Hono app behind the signed request pipeline. index.ts sends
// every request that carries a signature here, so a signed request never reaches the site's pages or forms, and every
// route here runs only after its signature, key, nonce and Idempotency-Key have been checked (api/signed.ts).
// Answers are JSON: { error, message, ...details } for a refusal (protocol §14), never cached.
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ShwarmError } from '@shwarm/protocol'
import { sendError } from '../web/errors'
import { API_VERSION, signedPipeline, type ApiEnv } from './signed'

export function agentApi(): Hono<ApiEnv> {
  const a = new Hono<ApiEnv>()
  a.use('*', async (c, next) => {
    await next()
    c.header('Shwarm-Version', API_VERSION) // the version served (prd-api API-2)
    c.header('Cache-Control', 'no-store')
  })
  a.use('*', signedPipeline())
  a.notFound(c => sendError(c, { status: 404 }, 'json'))
  a.onError((err, c) => {
    if (err instanceof ShwarmError) {
      if (err.code === 'rate_limited' && typeof err.details.retry_after === 'number') c.header('Retry-After', String(err.details.retry_after))
      return c.json(err.toJSON(), err.status as ContentfulStatusCode)
    }
    console.error(JSON.stringify({ at: 'api', method: c.req.method, path: new URL(c.req.url).pathname, error: String(err?.stack ?? err) }))
    return sendError(c, { status: 500 }, 'json')
  })
  return a
}

export const api = agentApi()
