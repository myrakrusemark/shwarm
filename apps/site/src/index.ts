import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { bodyLimit } from 'hono/body-limit'
import { DocPage, findPage } from './web/doc'
import { home } from './web/feed'
import { originGuard } from './auth/csrf'
import { mailRoutes } from './email/routes'
import { scheduled } from './jobs'
import { auth } from './auth/routes'
import { create } from './web/create'
import { page } from './web/viewer'
import { nodeRoutes } from './web/node-routes'
import { profile } from './web/profile'
import { errorHandler, notFoundHandler, sendError } from './web/errors'
import { forgetVersions } from './web/version-memo'
export { ShwarmTree } from './do/shwarm-tree'

type Env = { DB: D1Database; TREE: DurableObjectNamespace; AI: Ai; TRIAGE_MODEL?: string; ENV: string; SITE_MODE: string; STAGING_PASSWORD?: string; PASSWORD_PEPPER: string; CSRF_SECRET: string }

const app = new Hono<{ Bindings: Env }>()

// Security headers on every response.
app.use('*', async (c, next) => {
  await next()
  c.header('Strict-Transport-Security', 'max-age=86400') // short until launch, then longer
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('X-Frame-Options', 'DENY')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  c.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com")
})

// Request bodies are capped at 256 KB (table B, technical caps), before anything parses them (4.9).
const MAX_BODY = 256 * 1024
app.use('*', bodyLimit({ maxSize: MAX_BODY, onError: c => sendError(c, { status: 413 }) }))

// Health check: proves the Worker runs and can read D1. After the security headers, so they cover it too. A failure
// is a plain JSON 500 for the uptime check, not the site's error page.
app.get('/healthz', async c => {
  c.header('Cache-Control', 'no-store')
  try {
    const row = await c.env.DB.prepare("SELECT value FROM meta WHERE key = 'schema'").first<{ value: string }>()
    return c.json({ ok: true, env: c.env.ENV, schema: row?.value ?? null })
  } catch (err) {
    console.error(JSON.stringify({ at: 'healthz', error: String((err as Error)?.stack ?? err) }))
    return c.json({ ok: false, env: c.env.ENV }, 500)
  }
})

// Staging is private: a shared password (wrangler secret STAGING_PASSWORD). Health stays open for uptime checks,
// and /hooks/* stay open because they check their own secret.
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (c.env.ENV !== 'staging' || path === '/healthz' || path.startsWith('/hooks/')) return next()
  if (!c.env.STAGING_PASSWORD) return c.text('staging is locked', 503)
  return basicAuth({ username: 'shwarm', password: c.env.STAGING_PASSWORD })(c, next)
})

// Writes from other sites are refused (step 2.4). Form tokens are checked in each handler.
app.use('*', originGuard())

// Once a write is done, this isolate forgets the node versions it knew, so its next 304 reads D1 again (4.9).
app.use('*', async (c, next) => {
  await next()
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') forgetVersions()
})

// www → apex.
app.use('*', async (c, next) => {
  const url = new URL(c.req.url)
  if (url.hostname === 'www.shwarm.org') { url.hostname = 'shwarm.org'; return c.redirect(url.toString(), 301) }
  await next()
})

// Search engines stay out until launch day (site_mode "open", step 12.2).
const noindex = (c: { env: Env; header: (k: string, v: string) => void }) => {
  if (c.env.SITE_MODE !== 'open') c.header('X-Robots-Tag', 'noindex')
}

// How to report a security problem (RFC 9116). Expires is required; renew it yearly.
app.get('/.well-known/security.txt', c =>
  c.text(['Contact: mailto:security@shwarm.org', 'Expires: 2027-10-01T00:00:00Z', 'Preferred-Languages: en', 'Canonical: https://shwarm.org/.well-known/security.txt', ''].join('\n')),
)

// Account pages: join, sign in and out, emailed links, step-up (steps 2.5, 2.7, 2.8).
app.route('/', auth)

app.route('/', create) // /new, the create form (step 4.2)
app.route('/w', nodeRoutes) // shwarm and branch pages, text prompt and Node JSON (steps 3.3, 3.4, 3.6)
app.route('/', profile) // /@handle and the name view (step 3.5)

// Footer pages and guides (live on production since go-live step 1.8b).
app.get('/:slug{[a-z0-9-]+}', (c, next) => {
  const doc = findPage(c.req.param('slug'))
  if (!doc) return next()
  noindex(c)
  return page(c, DocPage({ page: doc }))
})

// Home: the feed on staging and in tests, the holding page on production until go-live 3.10 (web/feed.tsx).
app.route('/', home)

app.route('/', mailRoutes) // /unsubscribe, /hooks/resend (step 2.6)

// Error pages (step 3.8): anything unmatched is a 404 page, anything thrown a 500 page with nothing from the error.
app.notFound(notFoundHandler)
app.onError(errorHandler)

// The runtime calls fetch for requests and scheduled for cron (the outbox and triage sweeps, steps 2.6 and 8.1).
export default Object.assign(app, { scheduled })
