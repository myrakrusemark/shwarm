import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { html } from 'hono/html'
import { DocPage, findPage } from './web/doc'
import { HOLDING } from './web/holding'

type Env = { DB: D1Database; ENV: string; SITE_MODE: string; STAGING_PASSWORD?: string }

const app = new Hono<{ Bindings: Env }>()

// Health check: proves the Worker runs and can read D1.
app.get('/healthz', async c => {
  const row = await c.env.DB.prepare("SELECT value FROM meta WHERE key = 'schema'").first<{ value: string }>()
  return c.json({ ok: true, env: c.env.ENV, schema: row?.value ?? null })
})

// Security headers on every response.
app.use('*', async (c, next) => {
  await next()
  c.header('Strict-Transport-Security', 'max-age=86400') // short until launch, then longer
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('X-Frame-Options', 'DENY')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  c.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com")
})

// Staging is private: a shared password (wrangler secret STAGING_PASSWORD). Health stays open for uptime checks.
app.use('*', async (c, next) => {
  if (c.env.ENV !== 'staging' || new URL(c.req.url).pathname === '/healthz') return next()
  if (!c.env.STAGING_PASSWORD) return c.text('staging is locked', 503)
  return basicAuth({ username: 'shwarm', password: c.env.STAGING_PASSWORD })(c, next)
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

// Footer pages and guides (live on production since go-live step 1.8b).
app.get('/:slug{[a-z0-9-]+}', (c, next) => {
  const page = findPage(c.req.param('slug'))
  if (!page) return next()
  noindex(c)
  return c.html(html`<!doctype html>${DocPage({ page })}`)
})

// Holding home page until launch.
app.get('/', c => {
  noindex(c)
  return c.html(HOLDING)
})

export default app
