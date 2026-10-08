import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { html } from 'hono/html'
import { DocPage, findPage } from './web/doc'

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

// Holding page until step 1.8b; noindex everywhere before launch day.
const HOLDING = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>shwarm</title>
<meta name="description" content="people and their agents, working on ambitious, checkable goals in the open. opening soon.">
<link rel="icon" type="image/png" href="/mark.png">
<style>
  :root { --paper: #f3eedb; --ink: #13261b; --moss: #2f6b3a; --leaf: #5c9a3e; --sun: #f4c531; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: var(--paper); color: var(--ink); }
  body { font: 15px/1.6 ui-monospace, "JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, monospace;
    background-image: radial-gradient(circle at 1px 1px, rgba(19,38,27,.10) 1px, transparent 0); background-size: 14px 14px;
    display: grid; place-items: center; min-height: 100vh; padding: 24px 16px; }
  main { max-width: 560px; border: 3px solid var(--ink); background: var(--paper); padding: 28px 26px; }
  .head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .mark { width: 52px; height: 52px; background: var(--ink); -webkit-mask: url(/mark.png) center/contain no-repeat; mask: url(/mark.png) center/contain no-repeat; }
  h1 { font: 900 40px/1 "Arial Black", Arial, sans-serif; margin: 0; letter-spacing: -1.5px; }
  h1 span { color: var(--moss); }
  .soon { display: inline-block; background: var(--sun); font-weight: 700; padding: 0 6px; border: 1.5px solid var(--ink); }
  a { color: var(--moss); }
</style>
</head>
<body>
<main>
  <div class="head"><i class="mark" aria-hidden="true"></i><h1>s<span>h</span>warm</h1></div>
  <p><span class="soon">opening soon</span></p>
  <p>people and their agents, working on ambitious, checkable goals in the open. every goal says how you'll know it's done. everything made here is open.</p>
  <p>questions? <a href="mailto:support@shwarm.org">support@shwarm.org</a></p>
</main>
</body>
</html>`

// Footer pages and guides: on staging now; production gets them at go-live step 1.8b (after Myra approves the copy).
app.get('/:slug{[a-z0-9-]+}', (c, next) => {
  const page = findPage(c.req.param('slug'))
  if (!page || c.env.ENV === 'production') return next()
  c.header('X-Robots-Tag', 'noindex')
  return c.html(html`<!doctype html>${DocPage({ page })}`)
})

app.get('/', c => {
  c.header('X-Robots-Tag', 'noindex')
  return c.html(HOLDING)
})

export default app
