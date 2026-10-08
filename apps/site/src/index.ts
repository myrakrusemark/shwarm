import { Hono } from 'hono'

type Env = { DB: D1Database; ENV: string; SITE_MODE: string }

const app = new Hono<{ Bindings: Env }>()

// Health check: proves the Worker runs and can read D1.
app.get('/healthz', async c => {
  const row = await c.env.DB.prepare("SELECT value FROM meta WHERE key = 'schema'").first<{ value: string }>()
  return c.json({ ok: true, env: c.env.ENV, schema: row?.value ?? null })
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

app.get('/', c => {
  c.header('X-Robots-Tag', 'noindex')
  return c.html(HOLDING)
})

export default app
