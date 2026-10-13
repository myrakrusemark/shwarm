// Mail routes (go-live 2.6): one-click unsubscribe and Resend's bounce and complaint webhook.
// Both take server-to-server POSTs with no Origin header, so originGuard lets these paths through
// (see selfAuthenticated in auth/csrf.ts): the unsubscribe token is HMAC-signed, and the hook checks basic auth.
import { Hono } from 'hono'
import { html } from 'hono/html'
import type { FC } from 'hono/jsx'
import { sha256, utf8 } from '@shwarm/protocol'
import { Layout } from '../web/layout'
import { fill, w } from '../words'
import type { MailEnv } from './env'
import { emailNorm } from './norm'
import { noticeLabel, readUnsubToken } from './unsubscribe'

export const mailRoutes = new Hono<{ Bindings: MailEnv }>()

const Page: FC<{ h: string; text: string; token?: string }> = ({ h, text, token }) => (
  <Layout title={w.email.unsubscribeTitle}>
    {/* the skip link in Layout lands here */}
    <main id="main" tabindex={-1}>
      <div class="dochead">
        <h1>{h}</h1>
        <p>{text}</p>
      </div>
      <div style="margin: 18px 0 48px">
        {token && (
          <form method="post" action={`/unsubscribe?t=${token}`}>
            <input type="hidden" name="List-Unsubscribe" value="One-Click" />
            <button class="btn" type="submit">{w.email.unsubscribeButton}</button>
          </form>
        )}
      </div>
    </main>
  </Layout>
)

const page = (p: { h: string; text: string; token?: string }) => html`<!doctype html>${Page(p)}`

const BAD_LINK = () => ({ h: w.email.badLinkHeading, text: w.email.badLinkText })

mailRoutes.get('/unsubscribe', async c => {
  c.header('X-Robots-Tag', 'noindex')
  if (!c.env.MAIL_SECRET) return c.html(page(BAD_LINK()), 503)
  const t = await readUnsubToken(c.env.MAIL_SECRET, c.req.query('t'))
  if (!t) return c.html(page(BAD_LINK()), 400)
  const label = noticeLabel(t.type)
  return c.html(page({ h: w.email.unsubscribeHeading, text: fill(w.email.unsubscribeAsk, { label }), token: c.req.query('t') }))
})

// RFC 8058 one-click, and the button on the page above: the body must be List-Unsubscribe=One-Click.
mailRoutes.post('/unsubscribe', async c => {
  c.header('X-Robots-Tag', 'noindex')
  if (!c.env.MAIL_SECRET) return c.html(page(BAD_LINK()), 503)
  const type = c.req.header('content-type') ?? ''
  if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)\b/i.test(type)) return c.text('expected List-Unsubscribe=One-Click', 400)
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>)
  if (body['List-Unsubscribe'] !== 'One-Click') return c.text('expected List-Unsubscribe=One-Click', 400)
  const t = await readUnsubToken(c.env.MAIL_SECRET, c.req.query('t'))
  if (!t) return c.html(page(BAD_LINK()), 400)
  // Turns off this one notice type; every other preference stays.
  await c.env.DB.prepare(
    `UPDATE person SET notice_prefs = json_set(CASE WHEN json_valid(notice_prefs) THEN notice_prefs ELSE '{}' END, ?, json('false')) WHERE id = ?`,
  )
    .bind(`$.${t.type}`, t.personId)
    .run()
  const label = noticeLabel(t.type)
  return c.html(page({ h: w.email.unsubscribedHeading, text: fill(w.email.unsubscribedText, { label }) }))
})

/** Constant-time check of an HTTP basic auth header against one user and password. */
export async function basicAuthOk(header: string | undefined, user: string, password: string): Promise<boolean> {
  const m = /^Basic ([A-Za-z0-9+/=]{1,512})$/.exec(header ?? '')
  let given = ''
  if (m) {
    try {
      given = atob(m[1])
    } catch {
      given = ''
    }
  }
  const [a, b] = await Promise.all([sha256(utf8(given)), sha256(utf8(`${user}:${password}`))])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return m !== null && diff === 0
}

// Resend's webhook, set up as https://resend:<RESEND_WEBHOOK_SECRET>@<site>/hooks/resend.
// Bounces and complaints put the address on the suppression list; security mail still goes to it.
mailRoutes.post('/hooks/resend', async c => {
  const secret = c.env.RESEND_WEBHOOK_SECRET
  if (!secret || !(await basicAuthOk(c.req.header('authorization'), 'resend', secret))) {
    return c.text('unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="hooks"' })
  }
  if (Number(c.req.header('content-length') ?? 0) > 262_144) return c.text('too large', 413)
  const ev = (await c.req.json().catch(() => null)) as { type?: unknown; data?: { to?: unknown; bounce?: { type?: unknown } } } | null
  if (!ev || typeof ev.type !== 'string') return c.json({ ok: false, error: 'bad event' }, 400)
  // A soft bounce (mailbox full, server down) isn't a reason to stop mailing someone.
  const reason =
    ev.type === 'email.bounced' ? (ev.data?.bounce?.type === 'Transient' ? null : 'bounce') : ev.type === 'email.complained' ? 'complaint' : null
  if (!reason) return c.json({ ok: true, ignored: ev.type })
  const to = Array.isArray(ev.data?.to) ? ev.data.to : [ev.data?.to]
  const addrs = to
    .filter((s): s is string => typeof s === 'string' && s.length <= 320)
    .map(s => (/<([^<>]+)>\s*$/.exec(s)?.[1] ?? s).trim())
    .filter(s => /^[^\s@]+@[^\s@]+$/.test(s))
    .slice(0, 50)
  const now = new Date().toISOString()
  if (addrs.length) {
    await c.env.DB.batch(
      addrs.map(a =>
        c.env.DB.prepare('INSERT INTO email_suppression (email_norm, reason, created_at) VALUES (?, ?, ?) ON CONFLICT (email_norm) DO NOTHING').bind(
          emailNorm(a),
          reason,
          now,
        ),
      ),
    )
  }
  console.log('hooks/resend', reason, addrs.length) // counts only, no addresses in logs
  return c.json({ ok: true, suppressed: addrs.length })
})
