// Go-live 10.1, donations: the donate modal posts to /donate, which opens a Stripe Checkout Session (form-encoded, no
// SDK) and sends the browser there; Stripe's webhook (/hooks/stripe, checked by hand with WebCrypto) records one row per
// paid Stripe object. Without STRIPE_SECRET_KEY the modal doesn't post and /donate is a 404.
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { hashPassword } from '../src/auth/password'
import { addPerson, T0, testDb } from './d1'
import { body, Browser, fakeFetch, GOOD_PASSWORD, ORIGIN, pepper, testEnv } from './browser'
import { stagingWorld } from './node-fixture'
import { EXAMPLE_ROOT } from '../src/seed/example'
import { forgetVersions } from '../src/web/version-memo'

// Made-up values: these are not Stripe keys and reach nothing (fetch is stubbed).
const KEY = 'sk_test_not_a_real_key_for_tests'
const WHSEC = 'whsec_not_a_real_secret_for_tests'
const SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_test_a1#fid'
const iso = (ms: number) => new Date(ms).toISOString()

type Call = { url: string; headers: Headers; params: URLSearchParams }
let calls: Call[]
let stripeAnswer: () => Response

beforeEach(() => {
  calls = []
  stripeAnswer = () => Response.json({ id: 'cs_test_a1', url: SESSION_URL })
  const others = fakeFetch()
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith('https://api.stripe.com/')) {
      calls.push({ url, headers: new Headers(init?.headers), params: new URLSearchParams(String(init?.body ?? '')) })
      return stripeAnswer()
    }
    return others(input, init)
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function world(withKeys = true) {
  const db = testDb()
  const env = { ...testEnv(db), ...(withKeys ? { STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: WHSEC } : {}) }
  const rows = () => db.raw.prepare('SELECT stripe_id, kind, amount_cents, currency, note, handle, public, created_at FROM donation ORDER BY id').all().map((r: any) => ({ ...r }))
  return { db, env, rows }
}

async function signedIn(env: ReturnType<typeof world>['env'], handle: string) {
  const pid = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
  env.DB.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(iso(T0), pid)
  const b = new Browser(env as any)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}

const give = (b: Browser, form: Record<string, string>, headers: Record<string, string> = {}) => b.req('/donate', { form, headers })

describe('POST /donate', () => {
  it('opens a one-time checkout: amount in cents, a donate button, the note as one line, no handle signed out', async () => {
    const { env } = world()
    const res = await give(new Browser(env as any), { freq: 'once', amount: '25', note: '  keep it\r\nrunning  ', public: '1' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(SESSION_URL)
    expect(calls).toHaveLength(1)
    const { url, headers, params: p } = calls[0]
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions')
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(Object.fromEntries(p)).toEqual({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': '2500',
      'line_items[0][price_data][product_data][name]': 'donation to shwarm',
      submit_type: 'donate',
      success_url: `${ORIGIN}/donate/thanks?s={CHECKOUT_SESSION_ID}`,
      cancel_url: `${ORIGIN}/?donate=cancelled`,
      'metadata[freq]': 'once',
      'metadata[public]': '1',
      'metadata[note]': 'keep it running',
    })
  })

  it('opens a monthly checkout with the handle on the session and the subscription, back to the page it came from', async () => {
    const { env } = world()
    const b = await signedIn(env, 'myra')
    const res = await give(b, { freq: 'monthly', amount: '10', note: 'hi', public: '1' }, { referer: `${ORIGIN}/w/minecraft-in-doom?x=1` })
    expect(res.status).toBe(303)
    const p = calls[0].params
    expect(p.get('mode')).toBe('subscription')
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('1000')
    expect(p.get('line_items[0][price_data][recurring][interval]')).toBe('month')
    expect(p.has('submit_type')).toBe(false) // Stripe allows submit_type on one-time payments only
    expect(p.get('cancel_url')).toBe(`${ORIGIN}/w/minecraft-in-doom?x=1`)
    for (const pre of ['metadata', 'subscription_data[metadata]']) {
      expect(p.get(`${pre}[freq]`), pre).toBe('monthly')
      expect(p.get(`${pre}[handle]`), pre).toBe('myra')
      expect(p.get(`${pre}[note]`), pre).toBe('hi')
      expect(p.get(`${pre}[public]`), pre).toBe('1')
    }
  })

  it('sends no handle when the supporters-list box is unticked, and no cancel page on another site', async () => {
    const { env } = world()
    const b = await signedIn(env, 'myra')
    expect((await give(b, { freq: 'once', amount: '5' }, { referer: 'https://evil.example/x' })).status).toBe(303)
    const p = calls[0].params
    expect(p.get('metadata[public]')).toBe('0')
    expect(p.has('metadata[handle]')).toBe(false)
    expect(p.has('metadata[note]')).toBe(false)
    expect(p.get('cancel_url')).toBe(`${ORIGIN}/?donate=cancelled`)
  })

  it('refuses a bad amount, frequency or note without calling Stripe', async () => {
    const { env } = world()
    // each from its own network: refused tries count toward the limit too
    let n = 0
    const b = () => new Browser(env as any, `192.0.${++n}.9`)
    for (const form of <Record<string, string>[]>[
      { freq: 'once', amount: '0' },
      { freq: 'once', amount: '10001' },
      { freq: 'once', amount: '2.5' },
      { freq: 'once', amount: '-5' },
      { freq: 'once', amount: 'abc' },
      { freq: 'once', amount: '' },
      { freq: 'once' },
      { freq: 'yearly', amount: '25' },
      { amount: '25' },
      { freq: 'once', amount: '25', note: 'x'.repeat(281) },
    ]) {
      expect((await give(b(), form)).status, JSON.stringify(form).slice(0, 60)).toBe(400)
    }
    expect((await give(b(), { freq: 'once', amount: '10000', note: 'x'.repeat(280) })).status).toBe(303)
    expect((await give(b(), { freq: 'once', amount: '1' })).status).toBe(303)
    expect(calls.map(c => c.params.get('line_items[0][price_data][unit_amount]'))).toEqual(['1000000', '100'])
  })

  it('lets one network try 10 times an hour; the 11th waits', async () => {
    const { env } = world()
    const b = new Browser(env as any)
    for (let i = 0; i < 10; i++) expect((await give(b, { freq: 'once', amount: '5' })).status, `try ${i + 1}`).toBe(303)
    const res = await give(b, { freq: 'once', amount: '5' })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(calls).toHaveLength(10)
    // another network is unaffected
    expect((await give(new Browser(env as any, '198.51.100.7'), { freq: 'once', amount: '5' })).status).toBe(303)
  })

  it("says checkout didn't open when Stripe refuses, and logs no key", async () => {
    const { env } = world()
    // a wrong key: Stripe's message repeats a masked copy of it, which the log redacts too
    stripeAnswer = () => Response.json({ error: { type: 'invalid_request_error', code: 'parameter_invalid', message: 'Invalid API Key provided: sk_test_****_key_for_tests' } }, { status: 400 })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await give(new Browser(env as any), { freq: 'once', amount: '25' }, { accept: 'text/html' })
    expect(res.status).toBe(500)
    expect(await body(res)).toContain("checkout didn't open")
    const logged = err.mock.calls.flat().join(' ')
    expect(logged).toContain('parameter_invalid')
    expect(logged).not.toContain(KEY)
    expect(logged).not.toContain('sk_test_')
    expect(logged).toContain('Invalid API Key provided: [key]')
    // and when Stripe can't be reached at all
    stripeAnswer = () => {
      throw new Error('network down')
    }
    expect((await give(new Browser(env as any), { freq: 'once', amount: '25' })).status).toBe(500)
  })

  it('is a 404 and the modal never posts when the Worker has no Stripe key', async () => {
    const { env } = world(false)
    const b = new Browser(env as any)
    expect((await give(b, { freq: 'once', amount: '25' })).status).toBe(404)
    expect((await b.get('/donate/thanks')).status).toBe(404)
    expect(calls).toHaveLength(0)
    const html = await (await b.req('/manifesto', { headers: { accept: 'text/html' } })).text()
    expect(html).toContain('<form class="dn" role="dialog"')
    expect(html).not.toContain('data-checkout')
  })

  it('marks the modal for checkout and shows the thanks page when the key is set', async () => {
    const { env } = world()
    const b = new Browser(env as any)
    const html = await (await b.req('/manifesto', { headers: { accept: 'text/html' } })).text()
    expect(html).toContain('data-checkout="on"')
    expect(html).toMatch(/<input type="hidden" name="freq" id="dn-freq" value="once"\/?>/)
    expect(html).toMatch(/name="amount" id="dn-amount" value="25"/)
    expect(html).toMatch(/<textarea id="dn-note" name="note"/)
    expect(html).toMatch(/name="public" value="1"/)
    const thanks = await b.get('/donate/thanks?s=cs_test_a1')
    expect(thanks.status).toBe(200)
    const text = await body(thanks)
    expect(text).toContain('thank you')
    expect(text).toContain('support@shwarm.org')
  })
})

describe('POST /hooks/stripe', () => {
  const now = () => Math.floor(Date.now() / 1000)
  const sign = (raw: string, t = now(), secret = WHSEC) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`
  const hook = (env: ReturnType<typeof world>['env'], raw: string, sig?: string) =>
    app.fetch(
      new Request(`${ORIGIN}/hooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'stripe-signature': sig } : {}) }, body: raw }),
      env,
    )
  const event = (type: string, object: Record<string, unknown>, id = 'evt_1') => JSON.stringify({ id, type, created: now(), data: { object } })
  const session = (o: Record<string, unknown> = {}) => ({
    id: 'cs_test_a1', object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: 2500, currency: 'usd',
    customer_details: { email: 'someone@example.org', name: 'Some One' },
    metadata: { freq: 'once', note: 'keep it running', handle: 'myra', public: '1' }, ...o,
  })

  it('records a paid session once, however many times Stripe sends it, and keeps no email or name', async () => {
    const { env, rows } = world()
    const raw = event('checkout.session.completed', session())
    for (let i = 0; i < 2; i++) expect((await hook(env, raw, sign(raw))).status).toBe(200)
    // the same session again in another event
    const again = event('checkout.session.async_payment_succeeded', session(), 'evt_2')
    expect((await hook(env, again, sign(again))).status).toBe(200)
    expect(rows()).toEqual([
      { stripe_id: 'cs_test_a1', kind: 'once', amount_cents: 2500, currency: 'usd', note: 'keep it running', handle: 'myra', public: 1, created_at: iso(T0) },
    ])
  })

  it('records a monthly session; a handle without the supporters-list tick is dropped', async () => {
    const { env, rows } = world()
    const raw = event('checkout.session.completed', session({ id: 'cs_test_m1', mode: 'subscription', amount_total: 1000, metadata: { freq: 'monthly', handle: 'myra', public: '0' } }))
    expect((await hook(env, raw, sign(raw))).status).toBe(200)
    expect(rows()).toEqual([{ stripe_id: 'cs_test_m1', kind: 'monthly', amount_cents: 1000, currency: 'usd', note: null, handle: null, public: 0, created_at: iso(T0) }])
  })

  it('records nothing for a session that completed unpaid', async () => {
    const { env, rows } = world()
    const raw = event('checkout.session.completed', session({ payment_status: 'unpaid' }))
    expect((await hook(env, raw, sign(raw))).status).toBe(200)
    expect(rows()).toEqual([])
  })

  it('records a later month from invoice.paid (subscription_cycle) and skips the first invoice', async () => {
    const { env, rows } = world()
    const meta = { freq: 'monthly', note: 'hi', handle: 'myra', public: '1' }
    const first = event('invoice.paid', { id: 'in_1', billing_reason: 'subscription_create', amount_paid: 1000, currency: 'usd', parent: { subscription_details: { metadata: meta } } })
    expect((await hook(env, first, sign(first))).status).toBe(200)
    expect(rows()).toEqual([])
    const later = event('invoice.paid', { id: 'in_2', billing_reason: 'subscription_cycle', amount_paid: 1000, currency: 'usd', parent: { subscription_details: { metadata: meta } } }, 'evt_3')
    expect((await hook(env, later, sign(later))).status).toBe(200)
    // an invoice in the older API shape, metadata under subscription_details
    const older = event('invoice.paid', { id: 'in_3', billing_reason: 'subscription_cycle', amount_paid: 500, currency: 'usd', subscription_details: { metadata: { ...meta, public: '0' } } }, 'evt_4')
    expect((await hook(env, older, sign(older))).status).toBe(200)
    expect(rows()).toEqual([
      { stripe_id: 'in_2', kind: 'renewal', amount_cents: 1000, currency: 'usd', note: 'hi', handle: 'myra', public: 1, created_at: iso(T0) },
      { stripe_id: 'in_3', kind: 'renewal', amount_cents: 500, currency: 'usd', note: 'hi', handle: null, public: 0, created_at: iso(T0) },
    ])
  })

  it('refuses a bad, missing, stale or wrong-secret signature with a bare 400 and records nothing', async () => {
    const { env, rows } = world()
    const raw = event('checkout.session.completed', session())
    const good = sign(raw)
    for (const sig of [
      undefined,
      'garbage',
      good.replace(/v1=(.)/, (_, ch) => `v1=${ch === '0' ? '1' : '0'}`),
      sign(raw, now() - 301),
      sign(raw, now() + 301),
      sign(raw, now(), 'whsec_some_other_secret'),
      sign(raw + ' '),
      `t=${now()}`,
    ]) {
      const res = await hook(env, raw, sig)
      expect(res.status, String(sig)).toBe(400)
      expect(await res.text()).toBe('bad request')
    }
    // the body changed after signing
    expect((await hook(env, raw.replace('2500', '1'), good)).status).toBe(400)
    expect(rows()).toEqual([])
    // a signature 300 s old still counts, and any one good v1 among several does
    expect((await hook(env, raw, `${sign(raw, now() - 300)},v1=${'0'.repeat(64)}`)).status).toBe(200)
    expect(rows()).toHaveLength(1)
  })

  it('refuses everything when the Worker has no webhook secret', async () => {
    const { env, rows } = world(false)
    const raw = event('checkout.session.completed', session())
    expect((await hook(env, raw, sign(raw))).status).toBe(400)
    expect(rows()).toEqual([])
  })

  it("records nothing for a session or subscription /donate didn't open (no once or monthly in its metadata)", async () => {
    const { env, rows } = world()
    const sold = event('checkout.session.completed', session({ id: 'cs_test_x1', metadata: { order: '42' } }))
    const bare = event('checkout.session.completed', session({ id: 'cs_test_x2', metadata: null }), 'evt_5')
    const sub = event('invoice.paid', { id: 'in_9', billing_reason: 'subscription_cycle', amount_paid: 900, currency: 'usd', parent: { subscription_details: { metadata: { plan: 'pro' } } } }, 'evt_6')
    for (const raw of [sold, bare, sub]) expect((await hook(env, raw, sign(raw))).status).toBe(200)
    expect(rows()).toEqual([])
  })

  it('answers 200 to other event types and records nothing', async () => {
    const { env, rows } = world()
    for (const type of ['payment_intent.succeeded', 'customer.subscription.deleted', 'charge.refunded']) {
      const raw = event(type, { id: 'pi_1', amount: 2500, currency: 'usd' })
      expect((await hook(env, raw, sign(raw))).status, type).toBe(200)
    }
    expect(rows()).toEqual([])
  })
})

describe('signed-out node page ETag', () => {
  // The key goes in with `wrangler secret put`, no code deploy: a page cached without data-checkout must not 304.
  it('differs with and without the Stripe key, so a cached page picks up the donate form', async () => {
    forgetVersions()
    const { db } = await stagingWorld()
    const html = { accept: 'text/html' }
    const off = new Browser(testEnv(db) as any)
    const on = new Browser({ ...testEnv(db), STRIPE_SECRET_KEY: KEY } as any)
    const before = await off.req(`/w/${EXAMPLE_ROOT}`, { headers: html })
    const etag = before.headers.get('etag')!
    expect(etag).toMatch(/^W\//)
    expect(await before.text()).not.toContain('data-checkout')
    const after = await on.req(`/w/${EXAMPLE_ROOT}`, { headers: { ...html, 'if-none-match': etag } })
    expect(after.status).toBe(200)
    expect(after.headers.get('etag')).not.toBe(etag)
    expect(await after.text()).toContain('data-checkout="on"')
    // and back, when the key is taken out
    const later = await off.req(`/w/${EXAMPLE_ROOT}`, { headers: { ...html, 'if-none-match': after.headers.get('etag')! } })
    expect(later.status).toBe(200)
    // the JSON form has no modal, so its ETag doesn't move
    const j = (b: Browser) => b.req(`/w/${EXAMPLE_ROOT}`, { headers: { accept: 'application/json' } }).then(r => r.headers.get('etag'))
    expect(await j(on)).toBe(await j(off))
  })
})
