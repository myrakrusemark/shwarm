// Donations (go-live 10.1; A13, DONATE-1..6): the donate modal posts here, we open a Stripe Checkout Session and send
// the person to Stripe's own page, and Stripe's webhook tells us what was paid. Card details, names and emails stay at
// Stripe; we keep the amount, the date, the note if any, and the handle only if the person chose the supporters list
// (the privacy page's promise; migrations/0024_donation.sql).
//   POST /donate          the modal's form: once or monthly, an amount, a note, the supporters-list tick
//   GET  /donate/thanks   where Stripe sends people back after paying
//   POST /hooks/stripe    Stripe's webhook, checked against STRIPE_WEBHOOK_SECRET
// Without STRIPE_SECRET_KEY (production until 10.1 is done) the modal says "checkout opens soon" and /donate is a 404.
// No Stripe SDK: two form-encoded calls' worth of API isn't worth a Node-flavoured dependency in the Worker.
// OPEN (#109): the $10,000 cap, the per-network limit, cancelling monthly by mail, the words on the thanks page.
import { Hono, type Context } from 'hono'
import type { FC } from 'hono/jsx'
import { HANDLE_RE, utf8 } from '@shwarm/protocol'
import { clientIp, formOf, sessionOf, type AuthEnv } from '../auth/request'
import { ipPrefix } from '../auth/session'
import { bump, LIMITS } from '../auth/throttle'
import { notFoundHandler, sendError } from './errors'
import { Layout } from './layout'
import { page } from './viewer'

export type DonateEnv = AuthEnv & {
  SITE_URL?: string
  STRIPE_SECRET_KEY?: string // secret; sk_test_… on staging, sk_live_… on production. Unset: donations are off.
  STRIPE_WEBHOOK_SECRET?: string // secret; whsec_… from the webhook endpoint at Stripe, one per environment
}
type Env = { Bindings: DonateEnv }

export const donate = new Hono<Env>()

/** Whole dollars. OPEN (#109): a builder's default cap, so a slip of the keyboard can't open a $1,000,000 checkout. */
export const AMOUNT_MAX = 10_000
export const NOTE_MAX = 280
export const SUPPORT = 'support@shwarm.org'
const CHECKOUT_API = 'https://api.stripe.com/v1/checkout/sessions'
/** Stripe's own advice: refuse an event whose signature is older than five minutes, so a replay can't be fed in later. */
const TOLERANCE_S = 300

/** The note as one line: control characters and line breaks become spaces, runs of space one, ends trimmed. */
export const cleanNote = (s: unknown) =>
  typeof s === 'string' ? s.replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim() : ''

export type Gift = { freq: 'once' | 'monthly'; amount: number; note: string; handle: string | null; public: boolean }

/** The form body of the Checkout Session call. Exported for the tests. */
export function checkoutParams(g: Gift, origin: string, cancelUrl: string): URLSearchParams {
  const p = new URLSearchParams()
  const monthly = g.freq === 'monthly'
  p.set('mode', monthly ? 'subscription' : 'payment')
  p.set('line_items[0][quantity]', '1')
  p.set('line_items[0][price_data][currency]', 'usd')
  p.set('line_items[0][price_data][unit_amount]', String(g.amount * 100))
  p.set('line_items[0][price_data][product_data][name]', 'donation to shwarm')
  if (monthly) p.set('line_items[0][price_data][recurring][interval]', 'month')
  else p.set('submit_type', 'donate') // the pay button says "donate" (one-time payments only)
  // Stripe puts the session id in for {CHECKOUT_SESSION_ID}; URLSearchParams encodes the braces and Stripe decodes them.
  p.set('success_url', `${origin}/donate/thanks?s={CHECKOUT_SESSION_ID}`)
  p.set('cancel_url', cancelUrl)
  // What the webhook writes into the donation row. The handle goes only when the person chose the supporters list.
  // A monthly gift carries the same on the subscription, where each later month's invoice finds it.
  const meta: Record<string, string> = { freq: g.freq, public: g.public ? '1' : '0' }
  if (g.note) meta.note = g.note
  if (g.public && g.handle) meta.handle = g.handle
  for (const [k, v] of Object.entries(meta)) {
    p.set(`metadata[${k}]`, v)
    if (monthly) p.set(`subscription_data[metadata][${k}]`, v)
  }
  return p
}

/** The site's own origin: SITE_URL when set (staging and production), else this request's. */
const originOf = (c: Context<Env>) => (c.env.SITE_URL ? new URL(c.env.SITE_URL).origin : new URL(c.req.url).origin)

/** Back to the page the modal was opened on when the browser says (same site only), else home. */
function cancelUrlOf(c: Context<Env>, origin: string): string {
  const ref = c.req.header('referer')
  if (ref) {
    try {
      const u = new URL(ref)
      if (u.origin === origin && !u.pathname.startsWith('/donate')) return u.origin + u.pathname + u.search
    } catch {
      // not a URL: home
    }
  }
  return `${origin}/?donate=cancelled`
}

const refuse = (c: Context<Env>, text: string) => sendError(c, { status: 400, heading: "that didn't work", text })

donate.post('/donate', async c => {
  const key = c.env.STRIPE_SECRET_KEY
  if (!key) return notFoundHandler(c)
  c.header('Cache-Control', 'no-store')
  // Per network, before anything else is read: each try opens a Checkout Session at Stripe.
  const wait = await bump(c.env.DB, `donate:ip:${ipPrefix(clientIp(c)) ?? 'unknown'}`, LIMITS.donateIp)
  if (wait) return sendError(c, { status: 429, text: 'too many tries from your network.', wait })
  const f = await formOf(c)
  if (f.freq !== 'once' && f.freq !== 'monthly') return refuse(c, 'pick once or monthly.')
  const amount = /^\d{1,6}$/.test(f.amount ?? '') ? Number(f.amount) : 0
  if (amount < 1 || amount > AMOUNT_MAX) return refuse(c, `pick an amount from $1 to $${AMOUNT_MAX.toLocaleString('en-US')}, in whole dollars.`)
  const note = cleanNote(f.note)
  if ([...note].length > NOTE_MAX) return refuse(c, `a note can be up to ${NOTE_MAX} characters.`)
  const pub = f.public === '1'
  // Only a verified account's handle: an unverified one is deleted after 7 days and its handle can go to someone else.
  const s = pub ? await sessionOf(c) : null
  const gift: Gift = { freq: f.freq, amount, note, handle: s?.verified ? s.handle : null, public: pub }
  const origin = originOf(c)
  const body = checkoutParams(gift, origin, cancelUrlOf(c, origin))
  let url: string | undefined
  try {
    const res = await fetch(CHECKOUT_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // One key per form post: if this call is ever retried, Stripe answers with the same session, not a second one.
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: body.toString(),
    })
    const out = (await res.json().catch(() => null)) as { url?: unknown; error?: { type?: unknown; code?: unknown; message?: unknown } } | null
    if (res.ok && typeof out?.url === 'string' && out.url.startsWith('https://checkout.stripe.com/')) url = out.url
    // Stripe's error has a type, a code and a message about the request. A wrong key's message repeats a masked copy
    // of it (sk_test_****abcd); the redaction keeps even that out of the logs.
    else console.error(JSON.stringify({ at: 'donate', status: res.status, type: out?.error?.type ?? null, code: out?.error?.code ?? null, message: typeof out?.error?.message === 'string' ? redactKeys(out.error.message) : null }))
  } catch (err) {
    console.error(JSON.stringify({ at: 'donate', error: redactKeys(String((err as Error)?.message ?? err)) }))
  }
  if (!url) {
    return sendError(c, {
      status: 500,
      heading: "checkout didn't open",
      text: "we couldn't reach the payment page, so nothing was charged. try again in a minute.",
    })
  }
  return c.redirect(url, 303)
})

const ThanksPage: FC = () => (
  <Layout title="thank you · shwarm">
    {/* the account pages' narrow box, from auth.css */}
    <link rel="stylesheet" href="/css/auth.css" />
    <main id="main" tabindex={-1} class="auth err-page">
      <div class="box">
        <h2>thank you</h2>
        <div class="in">
          <p>your gift helps keep shwarm online. stripe emails you a receipt.</p>
          <p>giving monthly? to stop, write to <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a> and we'll cancel it.</p>
          <p><a href="/">back to shwarm</a></p>
        </div>
      </div>
    </main>
  </Layout>
)

// The ?s= session id isn't read: the webhook, not this page, records what was paid.
donate.get('/donate/thanks', async c => {
  if (!c.env.STRIPE_SECRET_KEY) return notFoundHandler(c)
  c.header('Cache-Control', 'no-store')
  return page(c, <ThanksPage />)
})

// --- the webhook ---

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('')

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Stripe's signature check, done by hand: the header is `t=<unix seconds>,v1=<hex>[,v1=<hex>…]` (more than one v1 while
 * a secret is being rolled), and each v1 is HMAC-SHA256 over "<t>.<raw body>" with the endpoint's secret.
 */
export async function stripeSignatureOk(secret: string, header: string | undefined, raw: string, nowS = Date.now() / 1000): Promise<boolean> {
  if (!header || header.length > 2048) return false
  let t: number | null = null
  const sigs: string[] = []
  for (const part of header.split(',')) {
    const i = part.indexOf('=')
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v)
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) sigs.push(v)
  }
  if (t === null || !sigs.length || Math.abs(nowS - t) > TOLERANCE_S) return false
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const want = hex(await crypto.subtle.sign('HMAC', key, utf8(`${t}.${raw}`)))
  let ok = false
  for (const s of sigs) ok = sameHex(want, s) || ok // every one is compared, so the time taken says nothing
  return ok
}

/** A Stripe key, even a masked one, never reaches the logs: secret (sk_) and restricted (rk_) keys, test or live. */
export const redactKeys = (s: string) => s.replace(/\b[sr]k_(test|live)_\S*/g, '[key]')

type Meta = { freq?: unknown; note?: unknown; handle?: unknown; public?: unknown } | null | undefined
type StripeObject = {
  id?: unknown
  mode?: unknown
  payment_status?: unknown
  amount_total?: unknown
  amount_paid?: unknown
  currency?: unknown
  billing_reason?: unknown
  metadata?: Meta
  subscription_details?: { metadata?: Meta } | null // invoices before Stripe's 2025-03-31 API
  parent?: { subscription_details?: { metadata?: Meta } | null } | null // invoices since
}
type Row = { stripeId: string; kind: 'once' | 'monthly' | 'renewal'; amount: number; currency: string; meta: Meta }

/** The row an event asks for, or null when it asks for none. */
function rowOf(type: string, o: StripeObject): Row | null {
  if (typeof o.id !== 'string' || o.id.length > 255 || typeof o.currency !== 'string') return null
  // A session that completed with its money in (card), or a monthly one (its first invoice is paid with it). A slower
  // payment method completes unpaid; async_payment_succeeded follows once the money is in, carrying the same session.
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    // Only a session /donate opened (its metadata says once or monthly): anything else sold on the same Stripe account
    // isn't a donation.
    const freq = o.metadata?.freq
    if (freq !== 'once' && freq !== 'monthly') return null
    const monthly = o.mode === 'subscription'
    if (!monthly && o.payment_status !== 'paid') return null
    if (typeof o.amount_total !== 'number') return null
    return { stripeId: o.id, kind: monthly ? 'monthly' : 'once', amount: o.amount_total, currency: o.currency, meta: o.metadata }
  }
  // Later months only; the first invoice (billing_reason subscription_create) is the session above.
  if (type === 'invoice.paid' && o.billing_reason === 'subscription_cycle') {
    if (typeof o.amount_paid !== 'number') return null
    const meta = o.parent?.subscription_details?.metadata ?? o.subscription_details?.metadata
    if (meta?.freq !== 'monthly') return null // a subscription /donate didn't open
    return { stripeId: o.id, kind: 'renewal', amount: o.amount_paid, currency: o.currency, meta }
  }
  return null
}

donate.post('/hooks/stripe', async c => {
  const secret = c.env.STRIPE_WEBHOOK_SECRET
  const raw = await c.req.text() // the signature covers these exact bytes, so read them before any parsing
  if (!secret || !(await stripeSignatureOk(secret, c.req.header('stripe-signature'), raw))) return c.text('bad request', 400)
  let ev: { type?: unknown; created?: unknown; data?: { object?: StripeObject } } | null = null
  try {
    ev = JSON.parse(raw)
  } catch {
    ev = null
  }
  if (!ev || typeof ev.type !== 'string' || !ev.data?.object) return c.text('bad request', 400)
  const row = rowOf(ev.type, ev.data.object)
  if (!row) return c.json({ ok: true, ignored: ev.type })
  const m = row.meta ?? {}
  const pub = m.public === '1'
  const note = cleanNote(m.note)
  const handle = pub && typeof m.handle === 'string' && HANDLE_RE.test(m.handle) ? m.handle : null
  const at = typeof ev.created === 'number' ? new Date(ev.created * 1000).toISOString() : new Date().toISOString()
  // Stripe resends an event until it gets a 200, and two events can name one object: one row per Stripe id.
  const r = await c.env.DB.prepare(
    `INSERT INTO donation (stripe_id, kind, amount_cents, currency, note, handle, public, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (stripe_id) DO NOTHING`,
  )
    .bind(row.stripeId, row.kind, Math.round(row.amount), row.currency.toLowerCase().slice(0, 3), note ? [...note].slice(0, NOTE_MAX).join('') : null, handle, pub ? 1 : 0, at)
    .run()
  console.log('hooks/stripe', ev.type, row.kind, r.meta?.changes ? 'recorded' : 'already') // no amounts or notes in logs
  return c.json({ ok: true })
})
