// Go-live 11.3, monitoring inside the Worker: what /healthz reports (the outbox, mail given up, triage holds, a ping to a
// ShwarmTree), the 5xx counter by 10-minute bucket, and the watchdog that mails the admins: each alert once, the
// hourly throttle, the daily cap, and no mail at all while the site is healthy.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { renderMail } from '../src/email/templates'
import { scheduled } from '../src/jobs'
import { HOLD_ALERT_EVERY_MS,
  ALERT_EVERY_MS,
  alertsFrom,
  attention,
  BOUNCES_PER_DAY,
  ERRORS_PER_HOUR,
  MAILS_PER_DAY,
  clearHealthCache,
  HEALTH_CACHE_MS,
  pingTree,
  readFacts,
  readHealth,
  RESEND_ALERT_EVERY_MS,
  RESEND_MIN_ERRORS,
  SIGNUPS_PER_HOUR,
  watchdog,
  WATCH_MINUTE,
} from '../src/jobs/watch'
import { countTraffic, ERROR_BUCKET_CAP, errorCountStatement, resendErrorStatement } from '../src/web/traffic'
import { sweepOutbox } from '../src/jobs/mail'
import { Hono } from 'hono'
import { addPerson, T0, testDb } from './d1'
import { treeNamespace } from './tree'

const MIN = 60_000
const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()
const SITE = 'https://shwarm.org'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type DB = ReturnType<typeof testDb>

function outbox(db: DB, o: { created: number; sendAfter: number; attempts?: number; lastError?: string | null; sentAt?: number | null; providerId?: string | null }) {
  db.raw
    .prepare(
      `INSERT INTO email_outbox (to_email, template, stream, payload, created_at, send_after, attempts, last_error, sent_at, provider_id)
       VALUES ('someone@example.org', 'verify', 'account', '{}', ?, ?, ?, ?, ?, ?)`,
    )
    .run(iso(o.created), iso(o.sendAfter), o.attempts ?? 0, o.lastError ?? null, o.sentAt == null ? null : iso(o.sentAt), o.providerId ?? null)
}

let nodes = 0
function node(db: DB, author: number, triage: string, created: number) {
  const path = `secret-node-${++nodes}`
  db.raw
    .prepare(
      `INSERT INTO node (path, slug, kind, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, triage, created_at)
       VALUES (?, ?, 'shwarm', 't', 'w', 'd', '{"author":true}', 1, 'MIT + CC-BY-4.0', ?, '@ana', 'live', ?, ?)`,
    )
    .run(path, path, author, triage, iso(created))
  return Number(db.raw.prepare('SELECT id FROM node WHERE path = ?').get(path).id)
}

async function world() {
  const db = testDb()
  const myra = await addPerson(db, 'myra')
  db.raw.prepare('UPDATE person SET is_admin = 1 WHERE id = ?').run(myra)
  const ana = await addPerson(db, 'ana')
  db.raw.prepare('UPDATE person SET created_at = ?').run(iso(T0 - 30 * 86_400_000)) // nobody signed up this hour
  return { db, myra, ana }
}

const alerts = (db: DB) =>
  db.raw
    .prepare("SELECT to_email, stream, payload FROM email_outbox WHERE template = 'watchdog_alert' ORDER BY id")
    .all()
    .map((r: any) => ({ ...r, payload: JSON.parse(r.payload) }))

describe('health facts', () => {
  it('reads zeros and nulls from an empty site', async () => {
    const { db } = await world()
    expect(await readHealth(db, T0)).toEqual({
      outbox: { due: 0, oldest_due_s: null, failing: 0, oldest_failing_s: null, given_up_1h: 0, given_up_24h: 0 },
      triage: { held: 0, oldest_held_s: null },
    })
  })

  it('counts due, failing and given-up mail, and holds waiting on the operator', async () => {
    const { db, ana } = await world()
    outbox(db, { created: T0 - 8 * MIN, sendAfter: T0 - 7 * MIN }) // due 7 minutes
    outbox(db, { created: T0 - MIN, sendAfter: T0 - 30_000 }) // due 30 s
    outbox(db, { created: T0 - 6 * MIN, sendAfter: T0 + 4 * MIN, attempts: 2, lastError: 'resend 401: api key is invalid' }) // failing
    outbox(db, { created: T0 - HOUR, sendAfter: T0 + 9 * MIN, attempts: 0, lastError: 'waiting: its node is still being checked' }) // on purpose
    outbox(db, { created: T0 - HOUR, sendAfter: T0 - HOUR, sentAt: T0 - 50 * MIN, providerId: 're_1' }) // sent
    outbox(db, { created: T0 - HOUR, sendAfter: T0 - HOUR, sentAt: T0 - 30 * MIN, lastError: 'failed: resend 422: bad address' }) // given up this hour
    outbox(db, { created: T0 - 6 * HOUR, sendAfter: T0 - 6 * HOUR, sentAt: T0 - 5 * HOUR, lastError: 'failed: the last attempt never finished' }) // today
    outbox(db, { created: T0 - 3 * 86_400_000, sendAfter: T0, sentAt: T0 - 2 * 86_400_000, lastError: 'failed: old' }) // too old
    outbox(db, { created: T0 - HOUR, sendAfter: T0 - HOUR, sentAt: T0 - 10 * MIN, lastError: 'skipped: suppressed (bounce)' }) // not a failure
    const held = node(db, ana, 'held', T0 - 40 * MIN)
    db.raw
      .prepare("INSERT INTO triage_decision (node_id, model, rubric, answer, reason, created_at) VALUES (?, '@m', 'r', 'yes', 'x', ?)")
      .run(held, iso(T0 - 20 * MIN))
    node(db, ana, 'held', T0 - 12 * MIN) // held at once (triage off): no decision row
    node(db, ana, 'pending', T0 - 90 * MIN)
    node(db, ana, 'clear', T0 - 90 * MIN)
    expect(await readHealth(db, T0)).toEqual({
      outbox: { due: 2, oldest_due_s: 420, failing: 1, oldest_failing_s: 360, given_up_1h: 1, given_up_24h: 2 },
      triage: { held: 2, oldest_held_s: 1200 },
    })
  })

  it('names what needs attention, by the same limits as the watchdog', () => {
    const h = (o: Partial<Record<string, number | null>>) => ({
      outbox: { due: 0, oldest_due_s: null, failing: 0, oldest_failing_s: null, given_up_1h: 0, given_up_24h: 0, ...o },
      triage: { held: 0, oldest_held_s: (o.held_s as number) ?? null },
    })
    expect(attention(h({}), { ok: true, ms: 3 })).toEqual([])
    expect(attention(h({ oldest_due_s: 300 }), null)).toEqual([])
    expect(attention(h({ oldest_due_s: 301 }), null)).toEqual(['outbox_late'])
    expect(attention(h({ oldest_failing_s: 400, given_up_1h: 1, held_s: 901 }), { ok: false, ms: 2000 })).toEqual([
      'outbox_late',
      'outbox_given_up',
      'triage_hold_late',
      'tree_down',
    ])
    expect(attention(null, { ok: true, ms: 1 })).toEqual(['checks_failed'])
  })
})

describe('the tree ping', () => {
  it('answers from a real tree without touching its queue', async () => {
    const { db } = await world()
    const t = treeNamespace(db)
    const r = await pingTree(t.ns)
    expect(r?.ok).toBe(true)
    expect(t.names).toEqual([':healthz'])
  })

  it('reports a tree that hangs as down, within its time box', async () => {
    vi.useRealTimers()
    const hung = { idFromName: () => ({}), get: () => ({ fetch: () => new Promise(() => {}) }) } as unknown as DurableObjectNamespace
    const start = Date.now()
    const r = await pingTree(hung, 50)
    expect(r?.ok).toBe(false)
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('reports a tree that throws as down, and none without a binding', async () => {
    const broken = { idFromName: () => ({}), get: () => ({ fetch: async () => { throw new Error('gone') } }) } as unknown as DurableObjectNamespace
    expect((await pingTree(broken))?.ok).toBe(false)
    expect(await pingTree(undefined)).toBeNull()
  })
})

describe('/healthz', () => {
  beforeEach(() => clearHealthCache())
  it('keeps its fields and 200, and adds the outbox, triage, the tree and attention, with nothing personal', async () => {
    const { db, ana } = await world()
    outbox(db, { created: T0 - 10 * MIN, sendAfter: T0 - 9 * MIN })
    node(db, ana, 'held', T0 - 30 * MIN)
    const env = { ENV: 'production', SITE_MODE: 'holding', DB: db, TREE: treeNamespace(db).ns }
    const res = await app.request('/healthz', {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const text = await res.text()
    const j = JSON.parse(text)
    expect(j).toMatchObject({
      ok: true,
      env: 'production',
      schema: '1',
      outbox: { due: 1, oldest_due_s: 540, failing: 0, oldest_failing_s: null, given_up_1h: 0, given_up_24h: 0 },
      triage: { held: 1, oldest_held_s: 1800 },
      tree: { ok: true },
      attention: ['outbox_late', 'triage_hold_late'],
    })
    expect(typeof j.tree.ms).toBe('number')
    expect(text).not.toMatch(/@|example\.org|secret-node|ana|myra/)
  })

  it('stays 200 when the extra checks fail, and says so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = { ENV: 'test', SITE_MODE: 'holding', DB: { prepare: () => ({ first: async () => ({ value: '1' }) }) } } as any
    const res = await app.request('/healthz', {}, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, env: 'test', schema: '1', outbox: null, triage: null, tree: null, attention: ['checks_failed'] })
  })

  it('keeps its extra fields per isolate for a while, so repeated hits cost one batch and one ping a window', async () => {
    const { db } = await world()
    const t = treeNamespace(db)
    const batch = vi.spyOn(db, 'batch')
    const env = { ENV: 'production', SITE_MODE: 'holding', DB: db, TREE: t.ns }
    for (let i = 0; i < 3; i++) expect((await app.request('/healthz', {}, env)).status).toBe(200)
    expect(batch).toHaveBeenCalledTimes(1)
    expect(t.names).toEqual([':healthz'])
    vi.setSystemTime(T0 + HEALTH_CACHE_MS)
    await app.request('/healthz', {}, env)
    expect(batch).toHaveBeenCalledTimes(2)
    expect(t.names).toEqual([':healthz', ':healthz'])
  })
})

describe('5xx counter', () => {
  it('counts 5xx answers by 10-minute bucket on production, and nothing else', async () => {
    const { db } = await world()
    const w = new Hono<{ Bindings: any }>()
    w.use('*', countTraffic())
    w.get('/ok', c => c.text('ok'))
    w.get('/boom', c => c.text('no', 500))
    w.get('/busy', c => c.text('no', 503))
    const env = { ENV: 'production', DB: db }
    await w.request('/ok', {}, env)
    await w.request('/boom', {}, env)
    await w.request('/busy', {}, env)
    await w.request('/boom', {}, { ENV: 'test', DB: db })
    expect(db.raw.prepare("SELECT scope, count, window_start FROM auth_throttle WHERE scope LIKE 'watch:5xx:%'").all()).toEqual([
      { scope: 'watch:5xx:2026-10-08T12:0', count: 2, window_start: '2026-10-08T12:00:00.000Z' },
    ])
    expect(db.raw.prepare('SELECT SUM(hits) AS n FROM traffic_count WHERE status_class = 5').get().n).toBe(2)
  })

  it('stops counting a bucket at its cap, so an outage writes a bounded number of rows', async () => {
    const { db } = await world()
    for (let i = 0; i < ERROR_BUCKET_CAP + 5; i++) await errorCountStatement(db, T0).run()
    expect(db.raw.prepare("SELECT count FROM auth_throttle WHERE scope LIKE 'watch:5xx:%'").get().count).toBe(ERROR_BUCKET_CAP)
  })

  it('reads the last hour as the current bucket and the five before it', async () => {
    const { db } = await world()
    const add = async (at: number, n: number) => {
      for (let i = 0; i < n; i++) await errorCountStatement(db, at).run()
    }
    await add(T0 - 61 * MIN, 50) // 10:59: too old
    await add(T0 - 50 * MIN, 3) // 11:10
    await add(T0 - 5 * MIN, 4) // 11:55
    await add(T0, 1) // 12:00
    expect((await readFacts(db, T0)).errors_1h).toBe(8)
  })
})

describe('watchdog', () => {
  it('sends nothing while the site is healthy', async () => {
    const { db, ana } = await world()
    outbox(db, { created: T0 - MIN, sendAfter: T0 - MIN }) // due a minute: fine
    outbox(db, { created: T0 - 3 * HOUR, sendAfter: T0 - 3 * HOUR, sentAt: T0 - 2 * HOUR, lastError: 'failed: x' }) // given up, but not this hour
    node(db, ana, 'held', T0 - 5 * MIN)
    const r = await watchdog({ DB: db, ENV: 'production' }, T0)
    expect(r).toEqual({ firing: [], sent: [], capped: false })
    expect(alerts(db)).toEqual([])
    expect(db.raw.prepare("SELECT value FROM meta WHERE key = 'watchdog'").get()).toBeUndefined()
  })

  // Each kind of alert: how to make it fire, and what its mail says.
  const cases: [string, (db: DB, ana: number) => Promise<void> | void, RegExp][] = [
    ['outbox_late', db => outbox(db, { created: T0 - 7 * MIN, sendAfter: T0 - 6 * MIN }), /mail late: 1 mail is due and unsent, the oldest for 6 minutes/],
    [
      'outbox_late',
      db => outbox(db, { created: T0 - 6 * MIN, sendAfter: T0 + 4 * MIN, attempts: 2, lastError: 'resend 401: bad key' }),
      /1 mail failed an attempt and waits to try again, the oldest written 6 minutes ago/,
    ],
    [
      'outbox_given_up',
      db => outbox(db, { created: T0 - HOUR, sendAfter: T0 - HOUR, sentAt: T0 - 10 * MIN, lastError: 'failed: resend 422' }),
      /mail given up: the outbox gave up on 1 mail in the last hour/,
    ],
    ['triage_hold_late', (db, ana) => void node(db, ana, 'held', T0 - 16 * MIN), /triage hold waiting: 1 node waits for you, the oldest for 16 minutes/],
    [
      'signups',
      async db => {
        for (let i = 0; i <= SIGNUPS_PER_HOUR; i++) await addPerson(db, `new_${i}`)
        await addPerson(db, 'seeded_one', { hash: '!seed' }) // a seed account doesn't count
      },
      new RegExp(`sign-ups: ${SIGNUPS_PER_HOUR + 1} in the last hour, over ${SIGNUPS_PER_HOUR}`),
    ],
    [
      'errors',
      async db => {
        for (let i = 0; i <= ERRORS_PER_HOUR; i++) await errorCountStatement(db, T0 - 20 * MIN).run()
      },
      new RegExp(`server errors: ${ERRORS_PER_HOUR + 1} 5xx answers in the last hour, over ${ERRORS_PER_HOUR}`),
    ],
    [
      'bounces',
      db => {
        for (let i = 0; i <= BOUNCES_PER_DAY; i++)
          db.raw.prepare('INSERT INTO email_suppression (email_norm, reason, created_at) VALUES (?, ?, ?)').run(`b${i}@example.org`, i ? 'bounce' : 'complaint', iso(T0 - 2 * HOUR))
        db.raw.prepare("INSERT INTO email_suppression (email_norm, reason, created_at) VALUES ('m@example.org', 'manual', ?)").run(iso(T0)) // not a bounce
      },
      new RegExp(`bounces: ${BOUNCES_PER_DAY + 1} addresses bounced or complained in the last day, over ${BOUNCES_PER_DAY}`),
    ],
    [
      'resend_errors',
      async db => {
        for (const at of [T0 - 20 * HOUR, T0 - 2 * HOUR, T0 - 5 * MIN]) await resendErrorStatement(db, at).run()
        for (let i = 0; i < 100; i++) outbox(db, { created: T0 - 3 * HOUR, sendAfter: T0 - 3 * HOUR, sentAt: T0 - 3 * HOUR + i * 1000, providerId: `re_${i}` })
      },
      /resend errors: 3 of 103 sends failed in the last day \(3%\), over 2%/,
    ],
  ]

  for (const [kind, setup, words] of cases) {
    it(`${kind}: one mail to each admin, once an hour while it lasts (${words.source.slice(0, 40)}…)`, async () => {
      const { db, ana } = await world()
      const other = await addPerson(db, 'op_two')
      db.raw.prepare('UPDATE person SET is_admin = 1, created_at = ? WHERE id = ?').run(iso(T0 - 30 * 86_400_000), other)
      await setup(db, ana)
      const r = await watchdog({ DB: db, ENV: 'staging' }, T0)
      expect(r).toEqual({ firing: [kind], sent: [kind], capped: false })
      const sent = alerts(db)
      expect(sent.map((m: any) => m.to_email)).toEqual(['myra@example.org', 'op_two@example.org'])
      expect(sent[0].stream).toBe('account')
      expect(sent[0].payload).toMatchObject({ handle: 'myra', env: 'staging', link: '/admin', alerts: [{ kind }] })
      const mail = renderMail('watchdog_alert', sent[0].payload, { siteUrl: SITE, stream: 'account' })
      expect(mail.subject).toMatch(/^shwarm staging needs a look: /)
      expect(mail.text).toMatch(words)
      expect(mail.text).toContain(`${SITE}/admin`)
      expect(mail.text).not.toContain('secret-node')

      // The sweep sends the alert (else it would be late mail itself an hour on).
      db.raw.prepare("UPDATE email_outbox SET sent_at = ?, provider_id = 're_x' WHERE template = 'watchdog_alert'").run(iso(T0 + MIN))
      // Five minutes later it still fires, but its hour isn't up: no mail.
      expect(await watchdog({ DB: db, ENV: 'staging' }, T0 + 5 * MIN)).toEqual({ firing: [kind], sent: [], capped: false })
      expect(await watchdog({ DB: db, ENV: 'staging' }, T0 + ALERT_EVERY_MS - 1)).toMatchObject({ sent: [] })
      expect(alerts(db)).toHaveLength(2)
    })
  }

  it('a triage hold reminds every 12 hours, not every hour, so one stuck hold can\'t spend the day\'s cap', async () => {
    const { db, ana } = await world()
    void node(db, ana, 'held', T0 - 16 * MIN)
    expect((await watchdog({ DB: db, ENV: 'staging' }, T0)).sent).toEqual(['triage_hold_late'])
    db.raw.prepare("UPDATE email_outbox SET sent_at = ?, provider_id = 're_x' WHERE template = 'watchdog_alert'").run(iso(T0 + MIN))
    expect((await watchdog({ DB: db, ENV: 'staging' }, T0 + 2 * HOUR)).sent).toEqual([])
    expect((await watchdog({ DB: db, ENV: 'staging' }, T0 + HOLD_ALERT_EVERY_MS)).sent).toEqual(['triage_hold_late'])
  })

  it('mails a kind again once its hour is up, and only the kinds whose hour is up', async () => {
    const { db } = await world()
    outbox(db, { created: T0 - 7 * MIN, sendAfter: T0 - 6 * MIN }) // late from T0 on
    expect((await watchdog({ DB: db, ENV: 'production' }, T0)).sent).toEqual(['outbox_late'])
    // At +30 min mail is given up too: that one goes at once, outbox_late waits for its hour.
    outbox(db, { created: T0, sendAfter: T0, sentAt: T0 + 29 * MIN, lastError: 'failed: resend 422' })
    expect((await watchdog({ DB: db, ENV: 'production' }, T0 + 30 * MIN)).sent).toEqual(['outbox_given_up'])
    expect((await watchdog({ DB: db, ENV: 'production' }, T0 + 45 * MIN)).sent).toEqual([])
    expect((await watchdog({ DB: db, ENV: 'production' }, T0 + HOUR)).sent).toEqual(['outbox_late'])
    const sent = alerts(db).map((m: any) => m.payload.alerts.map((a: any) => a.kind))
    expect(sent).toEqual([['outbox_late'], ['outbox_given_up'], ['outbox_late']])
    expect(renderMail('watchdog_alert', alerts(db)[0].payload, { siteUrl: SITE, stream: 'account' }).subject).toBe('shwarm needs a look: mail late')
  })

  it('puts every fresh alert in one mail', async () => {
    const { db, ana } = await world()
    outbox(db, { created: T0 - 7 * MIN, sendAfter: T0 - 6 * MIN })
    node(db, ana, 'held', T0 - 20 * MIN)
    expect((await watchdog({ DB: db, ENV: 'production' }, T0)).sent).toEqual(['outbox_late', 'triage_hold_late'])
    const sent = alerts(db)
    expect(sent).toHaveLength(1)
    expect(renderMail('watchdog_alert', sent[0].payload, { siteUrl: SITE, stream: 'account' }).subject).toBe('shwarm needs a look: mail late, triage hold waiting')
  })

  it(`sends at most ${MAILS_PER_DAY} mails a UTC day, then starts again the next day`, async () => {
    const { db } = await world()
    outbox(db, { created: T0 - 7 * MIN, sendAfter: T0 - 6 * MIN })
    let t = T0
    for (let i = 0; i < MAILS_PER_DAY; i++, t += HOUR) expect((await watchdog({ DB: db, ENV: 'production' }, t)).sent).toEqual(['outbox_late'])
    expect(await watchdog({ DB: db, ENV: 'production' }, t)).toEqual({ firing: ['outbox_late'], sent: [], capped: true })
    expect(alerts(db)).toHaveLength(MAILS_PER_DAY)
    const nextDay = Date.parse('2026-10-09T00:03:00Z')
    expect((await watchdog({ DB: db, ENV: 'production' }, nextDay)).sent).toEqual(['outbox_late'])
  })

  it('sends one mail when two runs read the same mark', async () => {
    const { db } = await world()
    outbox(db, { created: T0 - 7 * MIN, sendAfter: T0 - 6 * MIN })
    await Promise.all([watchdog({ DB: db, ENV: 'production' }, T0), watchdog({ DB: db, ENV: 'production' }, T0)])
    expect(alerts(db)).toHaveLength(1)
  })

  it('refuses a mail with no alerts or an unknown kind', () => {
    const r = (p: Record<string, unknown>) => () => renderMail('watchdog_alert', { link: '/admin', ...p }, { siteUrl: SITE, stream: 'account' })
    expect(r({ alerts: [] })).toThrow()
    expect(r({ alerts: [{ kind: 'nope' }] })).toThrow()
    expect(r({ alerts: [{ kind: 'errors', n: 11, limit: 10 }] })).not.toThrow()
  })

  it('only fires the alerts the facts call for', () => {
    const f = {
      outbox: { due: 0, oldest_due_s: null, failing: 0, oldest_failing_s: null, given_up_1h: 0, given_up_24h: 5 },
      triage: { held: 1, oldest_held_s: 60 },
      signups_1h: SIGNUPS_PER_HOUR,
      errors_1h: ERRORS_PER_HOUR,
      bounces_24h: BOUNCES_PER_DAY,
      resend_errors_24h: 2,
      sent_24h: 1,
      mark: null,
    }
    expect(alertsFrom(f)).toEqual([])
  })
})

describe('resend error rate', () => {
  const facts = (errors: number, sent: number) => ({
    outbox: { due: 0, oldest_due_s: null, failing: 0, oldest_failing_s: null, given_up_1h: 0, given_up_24h: 0 },
    triage: { held: 0, oldest_held_s: null },
    signups_1h: 0,
    errors_1h: 0,
    bounces_24h: 0,
    resend_errors_24h: errors,
    sent_24h: sent,
    mark: null,
  })

  it('fires over 2% of the day\'s sends, and only with a few errors behind it', () => {
    const kinds = (e: number, s: number) => alertsFrom(facts(e, s)).map(a => a.kind)
    expect(kinds(RESEND_MIN_ERRORS - 1, 1)).toEqual([]) // 2 of 3 failed: too few to page on
    expect(kinds(RESEND_MIN_ERRORS, 0)).toEqual(['resend_errors']) // every send failing
    expect(kinds(3, 147)).toEqual([]) // exactly 2%
    expect(kinds(3, 146)).toEqual(['resend_errors'])
    expect(kinds(4, 500)).toEqual([]) // under 1%
    expect(alertsFrom(facts(5, 45))).toEqual([{ kind: 'resend_errors', n: 5, calls: 50, percent: 10, limit: 2 }])
  })

  it('reads the errors of the last 24 hours and the mail sent in them', async () => {
    const { db } = await world()
    await resendErrorStatement(db, T0 - 25 * HOUR).run() // too old
    await resendErrorStatement(db, T0 - 23 * HOUR - 30 * MIN).run() // 12:30 yesterday: the current hour and the 23 before it only
    await resendErrorStatement(db, T0 - 23 * HOUR + 30 * MIN).run() // 13:30 yesterday
    await resendErrorStatement(db, T0 - HOUR).run()
    await resendErrorStatement(db, T0 - HOUR + MIN).run() // same hour
    await resendErrorStatement(db, T0).run()
    outbox(db, { created: T0 - 2 * HOUR, sendAfter: T0 - 2 * HOUR, sentAt: T0 - 2 * HOUR, providerId: 're_1' })
    outbox(db, { created: T0 - 30 * HOUR, sendAfter: T0 - 30 * HOUR, sentAt: T0 - 25 * HOUR, providerId: 're_2' }) // too old
    outbox(db, { created: T0 - 2 * HOUR, sendAfter: T0 - 2 * HOUR, sentAt: T0 - HOUR, lastError: 'failed: resend 422' }) // not sent
    const f = await readFacts(db, T0)
    expect({ errors: f.resend_errors_24h, sent: f.sent_24h }).toEqual({ errors: 4, sent: 1 })
    expect(db.raw.prepare("SELECT scope, count FROM auth_throttle WHERE scope = 'watch:resend:2026-10-08T11'").get()).toEqual({ scope: 'watch:resend:2026-10-08T11', count: 2 })
  })

  it('reminds every 12 hours while the day stays over, not every hour', async () => {
    const { db } = await world()
    for (let i = 0; i < 3; i++) await resendErrorStatement(db, T0 - MIN).run()
    expect((await watchdog({ DB: db, ENV: 'production' }, T0)).sent).toEqual(['resend_errors'])
    db.raw.prepare("UPDATE email_outbox SET sent_at = ?, provider_id = 're_x' WHERE template = 'watchdog_alert'").run(iso(T0 + MIN))
    expect((await watchdog({ DB: db, ENV: 'production' }, T0 + 2 * HOUR)).sent).toEqual([])
    for (let i = 0; i < 3; i++) await resendErrorStatement(db, T0 + 11 * HOUR).run()
    expect((await watchdog({ DB: db, ENV: 'production' }, T0 + RESEND_ALERT_EVERY_MS)).sent).toEqual(['resend_errors'])
  })

  it('the outbox sweep counts each failed call to resend, and nothing else', async () => {
    const { db, myra } = await world()
    const e = { DB: db, ENV: 'production', SITE_URL: SITE, RESEND_API_KEY: 're_key', MAIL_SECRET: 'mail-secret' } as any
    const add = (template: string, payload: Record<string, unknown>) =>
      db.raw
        .prepare("INSERT INTO email_outbox (to_email, person_id, template, stream, payload, created_at, send_after) VALUES ('myra@example.org', ?, ?, 'account', ?, ?, ?)")
        .run(myra, template, JSON.stringify(payload), iso(T0), iso(T0))
    add('welcome', { handle: 'myra' })
    add('welcome', { handle: 'myra' })
    add('verify', { handle: 'myra' }) // no link: the template refuses it, which isn't resend's error
    let calls = 0
    const f = (async () => (++calls === 1 ? new Response('{"message":"internal"}', { status: 500 }) : new Response('{"id":"re_ok"}', { status: 200 }))) as unknown as typeof fetch
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await sweepOutbox(e, { now: T0, fetch: f })).toMatchObject({ sent: 1, retrying: 1, failed: 1 })
    expect(db.raw.prepare("SELECT scope, count FROM auth_throttle WHERE scope LIKE 'watch:resend:%'").all()).toEqual([{ scope: 'watch:resend:2026-10-08T12', count: 1 }])
    const r = await readFacts(db, T0)
    expect({ errors: r.resend_errors_24h, sent: r.sent_24h }).toEqual({ errors: 1, sent: 1 })
  })
})

describe('the cron', () => {
  const run = async (env: Record<string, unknown>, at: number) => {
    const waits: Promise<unknown>[] = []
    await scheduled({ scheduledTime: at, cron: '* * * * *' } as ScheduledController, env as any, { waitUntil: (p: Promise<unknown>) => waits.push(p) } as any)
    await Promise.all(waits)
  }

  it(`runs the watchdog at minute ${WATCH_MINUTE} of every 5, on staging and production only`, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { db } = await world()
    outbox(db, { created: T0 - 7 * MIN, sendAfter: T0 - 6 * MIN })
    const base = { DB: db, SITE_URL: SITE }
    await run({ ...base, ENV: 'test' }, T0 + WATCH_MINUTE * MIN)
    await run({ ...base, ENV: 'production' }, T0 + (WATCH_MINUTE + 1) * MIN)
    expect(alerts(db)).toHaveLength(0)
    await run({ ...base, ENV: 'production' }, T0 + WATCH_MINUTE * MIN)
    expect(alerts(db)).toHaveLength(1)
  })
})
