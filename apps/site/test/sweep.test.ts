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

/** A fake Resend: records each call; `fail` makes the next n calls fail. */
function fakeResend(opts: { fail?: number; status?: number } = {}) {
  const calls: Call[] = []
  let fail = opts.fail ?? 0
  const f = (async (url: string, init: RequestInit) => {
    await new Promise(r => setTimeout(r, 1)) // a real network wait, so overlapping sweeps interleave
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
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
    expect(c.headers['Idempotency-Key']).toBe('outbox-production-1')
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
    expect(calls.map(c => c.headers['Idempotency-Key'])).toEqual(['outbox-production-1', 'outbox-production-1'])
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
    expect(calls[0].headers['Idempotency-Key']).toBe('outbox-staging-2')
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

describe('worker entry', () => {
  it('exports fetch and scheduled; scheduled runs the sweep', async () => {
    expect(typeof app.fetch).toBe('function')
    const e = env({ RESEND_API_KEY: undefined })
    const waits: Promise<unknown>[] = []
    await app.scheduled({} as ScheduledController, e, { waitUntil: (p: Promise<unknown>) => waits.push(p) } as unknown as ExecutionContext)
    expect(waits.length).toBe(1)
    await Promise.all(waits)
  })
})
