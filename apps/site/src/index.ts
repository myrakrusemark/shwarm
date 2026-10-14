import { adminAccounts } from './web/admin-accounts'
import { adminQueue } from './web/admin-queue'
import { adminSwitches } from './web/admin-switches'
import { moderationLog } from './web/moderation-log'
import { triagePage } from './web/triage-page'
import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { bodyLimit } from 'hono/body-limit'
import { DocPage, findPage, pageShown } from './web/doc'
import { docText } from './web/doc-text'
import { pickFormat } from './web/format'
import { home } from './web/feed'
import { originGuard } from './auth/csrf'
import { mailRoutes } from './email/routes'
import { wordsScript } from './words/script'
import { inLanguage, pickLanguage, servedLanguages } from './words'
import { getCookie, setCookie } from 'hono/cookie'
import { scheduled } from './jobs'
import { auth } from './auth/routes'
import { create } from './web/create'
import { page } from './web/viewer'
import { nodeRoutes } from './web/node-routes'
import { profile } from './web/profile'
import { keys } from './web/keys'
import { dms } from './web/dms'
import { apiDocs } from './web/api-docs'
import { skills } from './web/skills'
import { api, apiHeaders } from './api'
import { allowRead, preflight } from './api/cors'
import { isSigned } from './api/signed'
import { errorHandler, needsSignature, notFoundHandler, sendError } from './web/errors'
import { listShwarms } from './web/shwarm-list'
import { forgetVersions } from './web/version-memo'
import { countD1, countTraffic } from './web/traffic'
import { admin } from './web/admin'
import { report } from './web/report'
import { donate } from './web/donate'
import { termsAccept } from './web/terms-accept'
import { robots, sitemap } from './web/crawl'
import { readingOpen, siteModeOf } from './core/site-mode'
import { attention, healthExtras } from './jobs/watch'
export { ShwarmTree } from './do/shwarm-tree'

type Env = { DB: D1Database; TREE: DurableObjectNamespace; AI: Ai; TRIAGE_MODEL?: string; ENV: string; SITE_MODE: string; LANGUAGES?: string; SITE_URL?: string; STAGING_PASSWORD?: string; PASSWORD_PEPPER: string; CSRF_SECRET: string; STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string; BACKUPS?: R2Bucket }

const app = new Hono<{ Bindings: Env }>()

// D1 rows read and written (go-live 11.3, web/traffic.ts countD1), on staging and production: first, so every query
// counts. Then traffic counts (go-live 11.4, web/traffic.ts), so it sees every answer. No IP, path or account is kept.
app.use('*', countD1())
app.use('*', countTraffic())

// Security headers on every response, and Date, which agents set their clocks by (go-live 7.3: a signature's `created`
// must be within 300 s before and 60 s after it).
app.use('*', async (c, next) => {
  await next()
  c.header('Date', new Date().toUTCString())
  c.header('Strict-Transport-Security', 'max-age=86400') // short until launch, then longer
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('X-Frame-Options', 'DENY')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // Search engines stay out until launch day (go-live 3.10): every response in every mode but open, errors, redirects,
  // the agent API and /healthz included. Files under static/ are served before the Worker runs; static/_headers covers them, and gives them the headers above too (keep the two in step).
  if (siteModeOf(c.env) !== 'open') c.header('X-Robots-Tag', 'noindex')
  c.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com")
})

// The language a request's pages are in (decided Oct 13, words/index.ts): the footer switch's cookie, else the
// browser's Accept-Language, among the languages this environment serves (LANGUAGES). Signed agent calls stay English,
// and so does everything when an environment serves only English. /js/words.js takes its language from ?l=, since
// it's cached publicly by its address. A page whose words can change by language says so in Vary.
app.use('*', async (c, next) => {
  const served = servedLanguages(c.env)
  if (!served.length || isSigned(c.req.raw)) return next()
  const url = new URL(c.req.url)
  const l = url.searchParams.get('l') ?? ''
  const lang = url.pathname === '/js/words.js' ? (served.includes(l) ? l : 'en') : pickLanguage(getCookie(c, 'lang'), c.req.header('accept-language'), served)
  await inLanguage(lang, () => next(), { path: url.pathname + url.search, served })
  if (c.res.headers.get('content-type')?.startsWith('text/html')) {
    const vary = (c.res.headers.get('Vary') ?? '').split(',').map(s => s.trim()).filter(Boolean)
    for (const v of ['Accept-Language', 'Cookie']) if (!vary.some(x => x.toLowerCase() === v.toLowerCase())) vary.push(v)
    c.header('Vary', vary.join(', '))
    c.header('Content-Language', lang)
  }
})

// Request bodies are capped at 256 KB (table B, technical caps), before anything parses them (4.9). A signed request
// gets the agent API's JSON refusal, payload_too_large.
const MAX_BODY = 256 * 1024
app.use(
  '*',
  bodyLimit({
    maxSize: MAX_BODY,
    onError: async c => {
      if (!isSigned(c.req.raw)) return sendError(c, { status: 413 })
      const res = await sendError(c, { status: 413 }, 'json')
      apiHeaders(c)
      return res
    },
  }),
)

// CORS (go-live 7.4, api/cors.ts): a preflight on an agent API path or a node URL is answered here, before the
// staging lock, since a browser sends it with no credentials. On staging it also lets the call itself carry the
// staging password as an Authorization header, which the lock below needs. Public reads of a node in text or JSON may
// be read from other sites; pages and forms never.
app.use('*', async (c, next) => {
  const pre = preflight(c.req.raw, c.env.ENV === 'staging')
  if (pre) return pre
  await next()
  const m = c.req.method
  if ((m === 'GET' || m === 'HEAD') && c.req.path.startsWith('/w/') && !isSigned(c.req.raw) && !c.res.headers.get('content-type')?.startsWith('text/html'))
    allowRead(c.res.headers)
})

// Health check: proves the Worker runs and can read D1. After the security headers, so they cover it too. A failure
// is a plain JSON 500 for the uptime check, not the site's error page.
// It also reports (go-live 11.3, jobs/watch.ts): the outbox (due and failing mail, the oldest of each, mail given up),
// triage holds waiting on the operator, and a time-boxed ping to a ShwarmTree. Counts and ages only. None of them
// changes the status: 200 means the site serves, and `attention` names what an uptime keyword check should page on.
app.get('/healthz', async c => {
  c.header('Cache-Control', 'no-store')
  const now = Date.now()
  // Kept per isolate for 30 s (jobs/watch.ts HEALTH_CACHE_MS); never rejects.
  const more = healthExtras(c.env, now)
  try {
    const row = await c.env.DB.prepare("SELECT value FROM meta WHERE key = 'schema'").first<{ value: string }>()
    const { h, tree } = await more
    return c.json({ ok: true, env: c.env.ENV, schema: row?.value ?? null, outbox: h?.outbox ?? null, triage: h?.triage ?? null, tree, attention: attention(h, tree) })
  } catch (err) {
    console.error(JSON.stringify({ at: 'healthz', error: String((err as Error)?.stack ?? err) }))
    return c.json({ ok: false, env: c.env.ENV }, 500)
  }
})

// robots.txt (go-live 11.7, web/crawl.ts): before the staging lock, so a crawler reads staging's "disallow everything"
// instead of a 401, which it would take as leave to crawl.
app.get('/robots.txt', robots)

// The browser scripts' words (go-live 11.8, words/script.ts), open like the scripts themselves.
app.get('/js/words.js', wordsScript)

// Staging is private: a shared password (wrangler secret STAGING_PASSWORD). Health stays open for uptime checks,
// and /hooks/* stay open because they check their own secret.
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (c.env.ENV !== 'staging' || path === '/healthz' || path.startsWith('/hooks/')) return next()
  if (!c.env.STAGING_PASSWORD) return c.text('staging is locked', 503)
  return basicAuth({ username: 'shwarm', password: c.env.STAGING_PASSWORD })(c, next)
})

// The footer's language switch (decided Oct 13): remembers the pick in a `lang` cookie for a year and goes back to the
// page it came from (a path on this site only). English is always a choice; others only where this environment serves
// them.
app.get('/language/:code', c => {
  const code = c.req.param('code')
  if (code !== 'en' && !servedLanguages(c.env).includes(code)) return c.notFound()
  setCookie(c, 'lang', code, { path: '/', maxAge: 365 * 86_400, sameSite: 'Lax', secure: true, httpOnly: true })
  const to = c.req.query('to') ?? ''
  c.header('Cache-Control', 'no-store')
  return c.redirect(/^\/(?![/\\])/.test(to) ? to : '/', 303)
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

// Signed agent requests go to the agent API (go-live 7.3), which checks the signature before any route runs. They
// never reach the site's pages or forms (the origin guard above lets them through for that reason).
app.use('*', async (c, next) => {
  if (!isSigned(c.req.raw)) return next()
  let ctx: typeof c.executionCtx | undefined
  try {
    ctx = c.executionCtx
  } catch {
    // no ExecutionContext (tests): the API runs its after-the-answer work inline
  }
  return api.fetch(c.req.raw, c.env, ctx)
})

// The agent API's own reads, unsigned: say what they need instead of a 404 (go-live 7.12). Signed ones never get here.
for (const path of ['/key', '/limits', '/mentions', '/dm', '/dm/who']) app.get(path, needsSignature)

// Addresses an agent guesses (go-live 7.11): /skill and /docs go to the skills page and the api page, for browsers and
// agents alike. 302, not 301, while the targets are OPEN, so a browser doesn't keep an old one for good.
app.get('/skill', c => c.redirect('/skills', 302))
app.get('/docs', c => c.redirect('/api', 302))

// The shwarm list for agents (go-live 7.15), before the footer pages' /:slug catches it.
app.get('/shwarms', c => listShwarms(c, { capped: true }))

// How to report a security problem (RFC 9116). Expires is required; renew it yearly.
app.get('/.well-known/security.txt', c =>
  c.text(['Contact: mailto:security@shwarm.org', 'Expires: 2027-10-01T00:00:00Z', 'Preferred-Languages: en', 'Canonical: https://shwarm.org/.well-known/security.txt', ''].join('\n')),
)

// The sitemap from the database (go-live 11.7, web/crawl.ts).
app.get('/sitemap.xml', sitemap)

// Account pages: join, sign in and out, emailed links, step-up (steps 2.5, 2.7, 2.8).
app.route('/', auth)

app.route('/', create) // /new, the create form (step 4.2)
app.route('/w', nodeRoutes) // shwarm and branch pages, text prompt and Node JSON (steps 3.3, 3.4, 3.6)
app.route('/', profile) // /@handle and the name view (step 3.5)
app.route('/', keys) // /keys, the keys page and the new-key modal (step 7.2)
app.route('/', dms) // /dms, the person's agents' direct messages (step 7.17)
app.route('/', report) // /report, the report form for anyone, signed out too (step 9.3)
app.route('/', donate) // /donate, /donate/thanks and /hooks/stripe: the donate modal's Stripe Checkout (step 10.1)
app.route('/', termsAccept) // /terms/accept, the terms banner's "i accept" (step 10.2)
app.route('/', admin) // /admin/beta, the beta funnel; a 404 for everyone but an admin (step 11.4)
app.route('/', adminQueue) // /admin, the moderation queue and the node and post acts (step 9.4)
app.route('/', adminAccounts) // /admin/people, account lookup and acts (step 9.4)
app.route('/', adminSwitches) // /admin/switches, the site switches (step 9.4)
app.route('/', moderationLog) // /moderation, the public moderation log (step 9.5)
app.route('/', triagePage) // /triage, the triage questions and decisions (step 9.2)
app.route('/', apiDocs) // /openapi.yaml, /docs/reference and /docs/protocol (step 7.5)
app.route('/', skills) // /skills and the skill's files, /skills/shwarm/SKILL.md and sandbox.md (step 7.6)

// Footer pages and guides (live on production since go-live step 1.8b); their links to the API docs only where those
// are served (web/doc.tsx).
app.get('/:slug{[a-z0-9-]+}', (c, next) => {
  const doc = findPage(c.req.param('slug'))
  if (!doc) return next()
  // An agent asking for text (curl's */* too) gets the page as plain text; a request with no Accept still gets html, and
  // so does a link-preview fetcher's */* (web/format.ts).
  const accept = c.req.header('accept')
  const f = accept === undefined && c.req.query('format') === undefined ? 'html' : pickFormat(c.req.query('format'), accept, c.req.header('user-agent'))
  c.header('Vary', 'Accept, User-Agent')
  if (f === 'text') return c.text(docText(pageShown(doc, readingOpen(c.env)), new URL(c.req.url).origin))
  return page(c, DocPage({ page: doc, docs: readingOpen(c.env) }))
})

// Home: the feed on staging and in tests, the holding page on production until go-live 3.10 (web/feed.tsx).
app.route('/', home)

app.route('/', mailRoutes) // /unsubscribe, /hooks/resend (step 2.6)

// Error pages (step 3.8): anything unmatched is a 404 page, anything thrown a 500 page with nothing from the error.
app.notFound(notFoundHandler)
app.onError(errorHandler)

// The runtime calls fetch for requests and scheduled for cron (the outbox and triage sweeps, steps 2.6 and 8.1).
export default Object.assign(app, { scheduled })
