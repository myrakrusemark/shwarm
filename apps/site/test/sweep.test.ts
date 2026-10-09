import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { enqueueMail, type Mail } from '../src/email/outbox'
import { accountLink } from '../src/email/templates'
import { readUnsubToken } from '../src/email/unsubscribe'
import { MAX_ATTEMPTS, sweepOutbox } from '../src/jobs/mail'
import { addPerson, T0, testDb } from './d1'

const MIN = 60_000
const at = (ms: number) => new Date(ms).toISOString()

type Call = { url: string; headers: Record<string, string>; body: any }

/** A fake Resend: records each call; `fail` makes the next n calls fail; `reply` can answer a call itself. */
function fakeResend(opts: { fail?: number; status?: number; reply?: (n: number) => Response | null } = {}) {
  const calls: Call[] = []
  let fail = opts.fail ?? 0
  const f = (async (url: string, init: RequestInit) => {
    await new Promise(r => setTimeout(r, 1)) // a real network wait, so overlapping sweeps interleave
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    const r = opts.reply?.(calls.length)
    if (r) return r
    if (fail > 0) {
      fail--
      return new Response(JSON.stringify({ name: 'internal_server_error', message: 'try later' }), { status: opts.status ?? 500 })
    }
    return new Response(JSON.stringify({ id: `re_${calls.length}` }), { status: 200 })
  }) as unknown as typeof fetch
  return { f, calls }
}

function env(extra: Record<string, unknown> = {}) {
  return { DB: testDb(), ENV: 'production', SITE_URL: 'https://shwarm.org', RESEND_API_KEY: 're_key', MAIL_SECRET: 'mail-secret', ...extra } as any
}
const verify = (to: string, extra: Partial<Mail> = {}): Mail => ({ to, template: 'verify', stream: 'account', payload: { handle: 'myra', link: accountLink('verify', 'tok') }, ...extra })
const rows = (e: any) => e.DB.raw.prepare('SELECT * FROM email_outbox ORDER BY id').all()

describe('outbox sweep', () => {
  it('sends a due row once, even when two sweeps overlap', async () => {
    const e = env()
    await enqueueMail(e.DB, verify('Myra@Example.org'), at(T0))
    await enqueueMail(e.DB, verify('later@example.org', { sendAfter: at(T0 + 10 * MIN) }), at(T0))
    const { f, calls } = fakeResend()
    const [a, b] = await Promise.all([sweepOutbox(e, { now: T0, fetch: f }), sweepOutbox(e, { now: T0, fetch: f })])
    expect(a.sent + b.sent).toBe(1)
    expect(calls.length).toBe(1)
    const c = calls[0]
    expect(c.url).toBe('https://api.resend.com/emails')
    expect(c.headers.Authorization).toBe('Bearer re_key')
    expect(c.headers['Idempotency-Key']).toBe('outbox-production-1-20261008120000000')
    expect(c.body).toMatchObject({ from: 'shwarm <hello@mail.shwarm.org>', to: ['myra@example.org'], reply_to: 'support@shwarm.org', subject: 'verify your email for shwarm' })
    expect(c.body.text).toContain('https://shwarm.org/verify?t=tok')
    expect(c.body.headers).toBeUndefined() // account mail has no List-Unsubscribe
    const [sent, later] = rows(e)
    expect(sent).toMatchObject({ sent_at: at(T0), provider_id: 're_1', attempts: 1, last_error: null })
    expect(later).toMatchObject({ sent_at: null, attempts: 0 })
    expect(e.DB.raw.prepare('SELECT emails_sent FROM site_stats_daily').get().emails_sent).toBe(1)
    // a later sweep doesn't send it again
    await sweepOutbox(e, { now: T0 + 2 * MIN, fetch: f })
    expect(calls.length).toBe(1)
  })

  it('retries after 1, 5, 30 and 120 minutes, then gives up and keeps the error', async () => {
    const e = env()
    await enqueueMail(e.DB, verify('myra@example.org'), at(T0))
    const { f, calls } = fakeResend({ fail: 99 })
    let now = T0
    const waits = [1, 5, 30, 120]
    for (let i = 0; i < waits.length; i++) {
      const r = await sweepOutbox(e, { now, fetch: f })
      expect(r.retrying).toBe(1)
      const row = rows(e)[0]
      expect(row.attempts).toBe(i + 1)
      expect(row.send_after).toBe(at(now + waits[i] * MIN))
      expect(row.last_error).toContain('resend 500: try later')
      // not due yet: nothing happens a moment before the wait ends
      await sweepOutbox(e, { now: now + waits[i] * MIN - 1000, fetch: f })
      expect(calls.length).toBe(i + 1)
      now += waits[i] * MIN
    }
    const last = await sweepOutbox(e, { now, fetch: f })
    expect(last.failed).toBe(1)
    const row = rows(e)[0]
    expect(row.attempts).toBe(MAX_ATTEMPTS)
    expect(row.sent_at).toBe(at(now))
    expect(row.provider_id).toBeNull()
    expect(row.last_error).toMatch(/^failed: resend 500/)
    await sweepOutbox(e, { now: now + 86_400_000, fetch: f })
    expect(calls.length).toBe(MAX_ATTEMPTS)
  })

  it('recovers when a send fails once', async () => {
    const e = env()
    await enqueueMail(e.DB, verify('myra@example.org'), at(T0))
    const { f, calls } = fakeResend({ fail: 1 })
    await sweepOutbox(e, { now: T0, fetch: f })
    await sweepOutbox(e, { now: T0 + MIN, fetch: f })
    expect(calls.map(c => c.headers['Idempotency-Key'])).toEqual(['outbox-production-1-20261008120000000', 'outbox-production-1-20261008120000000'])
    expect(rows(e)[0]).toMatchObject({ provider_id: 're_2', last_error: null, attempts: 2 })
  })

  it('retries a row claimed by a sweep that died, after the lease', async () => {
    const e = env()
    await enqueueMail(e.DB, verify('myra@example.org'), at(T0))
    // what a claim leaves behind if the Worker dies before sending
    e.DB.raw.prepare('UPDATE email_outbox SET attempts = 1, send_after = ?').run(at(T0 + 5 * MIN))
    const { f, calls } = fakeResend()
    await sweepOutbox(e, { now: T0 + MIN, fetch: f })
    expect(calls.length).toBe(0)
    await sweepOutbox(e, { now: T0 + 5 * MIN, fetch: f })
    expect(calls.length).toBe(1)
  })

  it('gives up at once on a payload the template can\'t use', async () => {
    const e = env()
    await enqueueMail(e.DB, { to: 'myra@example.org', template: 'verify', stream: 'account', payload: { link: 'https://evil.example/x' } }, at(T0))
    const { f, calls } = fakeResend()
    expect((await sweepOutbox(e, { now: T0, fetch: f })).failed).toBe(1)
    expect(calls.length).toBe(0)
    expect(rows(e)[0].last_error).toBe('failed: link is not on the site')
  })

  it('sends nothing without an API key', async () => {
    const e = env({ RESEND_API_KEY: undefined })
    await enqueueMail(e.DB, verify('myra@example.org'), at(T0))
    const { f, calls } = fakeResend()
    await sweepOutbox(e, { now: T0, fetch: f })
    expect(calls.length).toBe(0)
    expect(rows(e)[0].attempts).toBe(0)
  })

  it('never mails a suppressed address, except security mail', async () => {
    const e = env()
    e.DB.raw.prepare(`INSERT INTO email_suppression (email_norm, reason, created_at) VALUES ('bob@example.org', 'bounce', ?)`).run(at(T0))
    await enqueueMail(e.DB, verify('Bob+shwarm@example.org'), at(T0))
    await enqueueMail(e.DB, { to: 'bob@example.org', template: 'password_changed', stream: 'security', payload: { handle: 'bob' } }, at(T0))
    const { f, calls } = fakeResend()
    const r = await sweepOutbox(e, { now: T0, fetch: f })
    expect(r).toMatchObject({ sent: 1, skipped: 1 })
    expect(calls.map(c => c.body.subject)).toEqual(['your shwarm password was changed'])
    const [skipped] = rows(e)
    expect(skipped).toMatchObject({ provider_id: null, last_error: 'skipped: suppressed (bounce)', sent_at: at(T0) })
  })

  it('on staging, sends only to allow-listed addresses', async () => {
    const e = env({ ENV: 'staging', SITE_URL: 'https://shwarm-staging.myrakrusemark.workers.dev' })
    e.DB.raw.prepare(`INSERT INTO signup_allow (email_norm, added_at) VALUES ('friend@gmail.com', ?)`).run(at(T0))
    await enqueueMail(e.DB, verify('stranger@example.org'), at(T0))
    await enqueueMail(e.DB, verify('Fr.iend+beta@gmail.com'), at(T0))
    await enqueueMail(e.DB, { to: 'stranger@example.org', template: 'password_changed', stream: 'security' }, at(T0))
    const { f, calls } = fakeResend()
    expect(await sweepOutbox(e, { now: T0, fetch: f })).toMatchObject({ sent: 1, skipped: 2 })
    expect(calls.map(c => c.body.to[0])).toEqual(['fr.iend+beta@gmail.com'])
    expect(calls[0].body.text).toContain('https://shwarm-staging.myrakrusemark.workers.dev/verify?t=tok')
    expect(calls[0].headers['Idempotency-Key']).toBe('outbox-staging-2-20261008120000000')
    const r = rows(e)
    expect(r[0].last_error).toBe('skipped: staging: not on the allow-list')
    expect(r[2].last_error).toBe('skipped: staging: not on the allow-list')
  })

  it('holds account mail to 3 an hour per address; the 4th is not sent', async () => {
    const e = env()
    for (let i = 0; i < 4; i++) await enqueueMail(e.DB, { ...verify('myra@example.org'), template: i % 2 ? 'reset' : 'verify', payload: { link: '/reset?t=x' } }, at(T0 + i * MIN))
    await enqueueMail(e.DB, { to: 'myra@example.org', template: 'welcome', stream: 'account' }, at(T0 + 4 * MIN)) // not capped
    const { f, calls } = fakeResend()
    for (let i = 0; i <= 4; i++) await sweepOutbox(e, { now: T0 + i * MIN, fetch: f })
    expect(calls.map(c => c.body.subject)).toEqual(['verify your email for shwarm', 'reset your shwarm password', 'verify your email for shwarm', 'welcome to shwarm'])
    expect(rows(e)[3]).toMatchObject({ provider_id: null, last_error: 'skipped: over the hourly account mail cap' })
    // a plus-address is the same inbox
    await enqueueMail(e.DB, verify('myra+again@example.org'), at(T0 + 10 * MIN))
    await sweepOutbox(e, { now: T0 + 10 * MIN, fetch: f })
    expect(calls.length).toBe(4)
    // an hour after the first one, mail goes again
    await enqueueMail(e.DB, verify('myra@example.org'), at(T0 + 61 * MIN))
    await sweepOutbox(e, { now: T0 + 61 * MIN, fetch: f })
    expect(calls.length).toBe(5)
  })

  it('holds account mail to 10 a day per address', async () => {
    const e = env()
    const { f, calls } = fakeResend()
    for (let i = 0; i < 11; i++) {
      const now = T0 + i * 61 * MIN // a fresh hour each time
      await enqueueMail(e.DB, verify('myra@example.org'), at(now))
      await sweepOutbox(e, { now, fetch: f })
    }
    expect(calls.length).toBe(10)
    expect(rows(e)[10].last_error).toBe('skipped: over the daily account mail cap')
  })

  it('gives notices List-Unsubscribe headers and honors each type\'s opt-out', async () => {
    const e = env()
    const me = await addPerson(e.DB, 'myra')
    e.DB.raw.prepare(`UPDATE person SET notice_prefs = '{"passes":false}' WHERE id = ?`).run(me)
    const notice = (type?: string): Mail => ({ to: 'myra@example.org', template: 'welcome', stream: 'notices', personId: me, payload: { handle: 'myra', notice: type } })
    await enqueueMail(e.DB, notice('mention'), at(T0))
    await enqueueMail(e.DB, notice('passes'), at(T0))
    await enqueueMail(e.DB, notice(undefined), at(T0))
    const { f, calls } = fakeResend()
    expect(await sweepOutbox(e, { now: T0, fetch: f })).toMatchObject({ sent: 1, skipped: 2 })
    const h = calls[0].body.headers
    const url = /^<(https:\/\/shwarm\.org\/unsubscribe\?t=([^>]+))>, <mailto:support@shwarm\.org\?subject=unsubscribe>$/.exec(h['List-Unsubscribe'])
    expect(url).not.toBeNull()
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(await readUnsubToken('mail-secret', url![2], T0)).toEqual({ personId: me, type: 'mention' })
    expect(calls[0].body.text).toContain(url![1])
    const r = rows(e)
    expect(r[1].last_error).toBe('skipped: turned off passes notices')
    expect(r[2].last_error).toBe('skipped: notice has no type')
  })

  it('a one-click unsubscribe stops that notice type only', async () => {
    const e = { ...env(), SITE_MODE: 'holding' }
    const me = await addPerson(e.DB, 'myra')
    const notice = (type: string): Mail => ({ to: 'myra@example.org', template: 'welcome', stream: 'notices', personId: me, payload: { notice: type } })
    const { f, calls } = fakeResend()
    await enqueueMail(e.DB, notice('mention'), at(T0))
    await sweepOutbox(e, { now: T0, fetch: f })
    const link = /<(https:\/\/shwarm\.org[^>]+)>/.exec(calls[0].body.headers['List-Unsubscribe'])![1]
    // what Gmail does with List-Unsubscribe-Post
    const res = await app.request(link, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }, e)
    expect(res.status).toBe(200)
    await enqueueMail(e.DB, notice('mention'), at(T0 + MIN))
    await enqueueMail(e.DB, notice('passes'), at(T0 + MIN))
    await sweepOutbox(e, { now: T0 + MIN, fetch: f })
    expect(calls.length).toBe(2)
    expect(calls[1].body.headers['List-Unsubscribe']).toContain('unsubscribe?t=u1.')
    expect(rows(e)[1].last_error).toBe('skipped: turned off mention notices')
  })
})

const resendError = (status: number, name: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ name, message: name.replace(/_/g, ' ') }), { status, headers })

describe('outbox sweep, when things go wrong', () => {
  it('one row\'s database error doesn\'t stop the rest of the batch', async () => {
    const e = env()
    await enqueueMail(e.DB, verify('a@example.org'), at(T0))
    await enqueueMail(e.DB, verify('b@example.org'), at(T0))
    const prepare = e.DB.prepare
    let boom = true
    e.DB.prepare = (sql: string) => {
      if (boom && sql.includes('FROM email_suppression')) {
        boom = false
        throw new Error('D1_ERROR: network')
      }
      return prepare(sql)
    }
    const { f, calls } = fakeResend()
    expect(await sweepOutbox(e, { now: T0, fetch: f })).toMatchObject({ sent: 1, retrying: 1 })
    expect(calls.map(c => c.body.to[0])).toEqual(['b@example.org'])
    expect(rows(e)[0]).toMatchObject({ sent_at: null, attempts: 1, send_after: at(T0 + MIN), last_error: 'D1_ERROR: network' })
    await sweepOutbox(e, { now: T0 + MIN, fetch: f })
    expect(calls.length).toBe(2)
  })

  it('closes a row whose last attempt was claimed but never finished', async () => {
    const e = env()
    await enqueueMail(e.DB, verify('a@example.org'), at(T0))
    // what a claim of the 5th attempt leaves behind if the Worker dies before finishing
    e.DB.raw.prepare('UPDATE email_outbox SET attempts = ?, send_after = ?').run(MAX_ATTEMPTS, at(T0 + 5 * MIN))
    const { f, calls } = fakeResend()
    await sweepOutbox(e, { now: T0 + MIN, fetch: f })
    expect(rows(e)[0].sent_at).toBeNull() // its lease still runs
    await sweepOutbox(e, { now: T0 + 5 * MIN, fetch: f })
    expect(rows(e)[0]).toMatchObject({ sent_at: at(T0 + 5 * MIN), provider_id: null, last_error: 'failed: the last attempt never finished' })
    expect(calls.length).toBe(0)
  })

  it('caps account mail over a rolling hour, not a fixed window', async () => {
    const e = env()
    const { f, calls } = fakeResend()
    for (const t of [0, 58, 59, 60.1, 60.5, 61, 118.5, 119]) {
      await enqueueMail(e.DB, { to: 'v@example.org', template: 'reset', stream: 'account', payload: { link: accountLink('reset', 'x') } }, at(T0 + t * MIN))
      await sweepOutbox(e, { now: T0 + t * MIN, fetch: f })
    }
    // a fixed window let 0, 58, 59, then 60.1, 60.5 and 61 all through; a rolling hour holds 60.5 and 61
    const sent = rows(e).filter((r: any) => r.provider_id).map((r: any) => (Date.parse(r.sent_at) - T0) / MIN)
    expect(sent).toEqual([0, 58, 59, 60.1, 118.5, 119])
    for (const t of sent) expect(sent.filter((u: number) => u > t - 60 && u <= t).length).toBeLessThanOrEqual(3)
  })

  it('sends the same body on every attempt of a notice, so the Idempotency-Key holds', async () => {
    const e = env()
    const me = await addPerson(e.DB, 'myra')
    await enqueueMail(e.DB, { to: 'myra@example.org', template: 'welcome', stream: 'notices', personId: me, payload: { handle: 'myra', notice: 'mention' } }, at(T0))
    const { f, calls } = fakeResend({ fail: 1 })
    await sweepOutbox(e, { now: T0, fetch: f })
    await sweepOutbox(e, { now: T0 + MIN, fetch: f })
    expect(calls.length).toBe(2)
    expect(calls[1].headers['Idempotency-Key']).toBe(calls[0].headers['Idempotency-Key'])
    expect(calls[1].body).toEqual(calls[0].body)
  })

  it('gives each row a key of its own, even when a remade database reuses its id', async () => {
    const keys: string[] = []
    for (const t of [T0, T0 + 3 * MIN]) {
      const e = env({ ENV: undefined })
      e.DB.raw.prepare(`INSERT INTO signup_allow (email_norm, added_at) VALUES ('myra@example.org', ?)`).run(at(t))
      await enqueueMail(e.DB, { to: 'myra@example.org', template: 'welcome', stream: 'account', payload: { handle: 'myra' } }, at(t))
      const { f, calls } = fakeResend()
      await sweepOutbox(e, { now: t, fetch: f })
      keys.push(calls[0].headers['Idempotency-Key'])
    }
    expect(keys[0]).toMatch(/^outbox-dev-1-\d+$/)
    expect(keys[1]).not.toBe(keys[0])
  })

  it('on a 429, holds the row without using an attempt, and sends nothing more that sweep', async () => {
    const e = env()
    for (const to of ['a@example.org', 'b@example.org', 'c@example.org']) await enqueueMail(e.DB, verify(to), at(T0))
    const quota = fakeResend({ reply: () => resendError(429, 'daily_quota_exceeded') })
    const now = T0 + 3 * 3_600_000 // 15:00 UTC
    expect(await sweepOutbox(e, { now, fetch: quota.f })).toMatchObject({ retrying: 3, failed: 0 })
    expect(quota.calls.length).toBe(1)
    const midnight = at(Date.UTC(2026, 9, 9))
    for (const r of rows(e)) expect(r).toMatchObject({ attempts: 0, send_after: midnight, sent_at: null })
    // Retry-After wins when Resend sends one
    const slow = fakeResend({ reply: () => resendError(429, 'rate_limit_exceeded', { 'retry-after': '120' }) })
    e.DB.raw.prepare('UPDATE email_outbox SET send_after = ?').run(at(now))
    await sweepOutbox(e, { now, fetch: slow.f })
    expect(rows(e)[0]).toMatchObject({ attempts: 0, send_after: at(now + 2 * MIN) })
    // after midnight they go
    const ok = fakeResend()
    expect(await sweepOutbox(e, { now: Date.UTC(2026, 9, 9), fetch: ok.f })).toMatchObject({ sent: 3 })
  })

  it('gives up at once on a bad address or a reused key, and retries a key problem on our side', async () => {
    const e = env()
    for (const to of ['a@example.org', 'b@example.org', 'c@example.org']) await enqueueMail(e.DB, verify(to), at(T0))
    const answers = [resendError(422, 'validation_error'), resendError(409, 'invalid_idempotent_request'), resendError(403, 'invalid_api_key')]
    const { f } = fakeResend({ reply: n => answers[n - 1] ?? null })
    expect(await sweepOutbox(e, { now: T0, fetch: f })).toMatchObject({ failed: 2, retrying: 1 })
    const [a, b, c] = rows(e)
    expect(a.last_error).toBe('failed: resend 422: validation error')
    expect(b.last_error).toBe('failed: resend 409: invalid idempotent request')
    expect(c).toMatchObject({ sent_at: null, send_after: at(T0 + MIN), last_error: 'resend 403: invalid api key' })
  })
})

describe('worker entry', () => {
  it('exports fetch and scheduled; scheduled runs the mail and triage sweeps, each in its own waitUntil', async () => {
    expect(typeof app.fetch).toBe('function')
    const e = env({ RESEND_API_KEY: undefined })
    const waits: Promise<unknown>[] = []
    await app.scheduled({} as ScheduledController, e, { waitUntil: (p: Promise<unknown>) => waits.push(p) } as unknown as ExecutionContext)
    expect(waits.length).toBe(2)
    await Promise.all(waits)
  })
})
