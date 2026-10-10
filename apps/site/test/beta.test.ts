// Go-live 11.4, counting (decided Oct 9: "Analytics: our own counts, a funnel first, on an admin page"): the beta funnel
// page at /admin/beta (admins only; a plain 404 for everyone else), the loop funnel and testers' furthest steps on a
// small world, daily activity, the server-side traffic counter (kinds, referrers, nothing personal kept, errors
// swallowed) and the admins' daily summary mail, sent once a day.
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { hashPassword } from '../src/auth/password'
import { renderMail } from '../src/email/templates'
import { scheduled, STATS_CRON } from '../src/jobs'
import { sendSummary, summaryDay } from '../src/jobs/summary'
import { activity, daySummary, funnel, lastDays, STEPS, testers } from '../src/read/beta'
import { countTraffic, referrerHost, resetTrafficLog, trafficKind, trafficRow } from '../src/web/traffic'
import { addPerson, T0, testDb } from './d1'
import { body, Browser, fakeFetch, GOOD_PASSWORD, pepper, testEnv } from './browser'

const HOUR = 3_600_000
const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/**
 * A small world at T0 (2026-10-08 12:00 utc). @myra is the admin and @bmo_fan a seed account; neither is a tester.
 *   ana    invited, verified, joined, posted, submitted #1, which passed
 *   bo     invited, verified, joined, checked #1 (a people check, pass)
 *   cy     invited, never verified
 *   dee    not invited, verified, joined
 *   early  not invited, never verified
 * eve is invited and never signed up.
 */
async function world() {
  const db = testDb()
  const run = (sql: string, ...args: unknown[]) => db.raw.prepare(sql).run(...args)
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  const person = async (handle: string, joined: number, o: { verified?: boolean; hash?: string } = {}) => {
    const id = await addPerson(db, handle, { hash: o.hash ?? hash })
    run('UPDATE person SET created_at = ?, email_verified_at = ? WHERE id = ?', iso(joined), o.verified === false ? null : iso(joined + HOUR), id)
    return id
  }
  const myra = await person('myra', T0 - 10 * DAY)
  run('UPDATE person SET is_admin = 1 WHERE id = ?', myra)
  const seed = await person('bmo_fan', T0 - DAY, { hash: '!seed: sign-in disabled' })
  const early = await person('early', T0 - 6 * DAY, { verified: false })
  const ana = await person('ana', T0 - 5 * DAY)
  const bo = await person('bo', T0 - 4 * DAY)
  const cy = await person('cy', T0 - DAY, { verified: false })
  const dee = await person('dee', T0 - DAY + HOUR)
  for (const h of ['ana', 'bo', 'cy', 'eve', 'myra']) run("INSERT INTO signup_allow (email_norm, note, added_at) VALUES (?, 'test', ?)", `${h}@example.org`, iso(T0 - 20 * DAY))

  const node = Number(
    run(
      `INSERT INTO node (path, slug, kind, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, triage, created_at)
       VALUES ('minecraft-in-doom', 'minecraft-in-doom', 'shwarm', 'minecraft in doom', 'dig and build while imps attack', 'a gzdoom mod at 60 fps',
               '{"people":{"count":1}}', 1, 'MIT', ?, '@myra', 'live', 'clear', ?)`,
      myra, iso(T0 - 9 * DAY),
    ).lastInsertRowid,
  )
  let seat = 1
  for (const p of [myra, ana, bo, dee]) run('INSERT INTO seat (node_id, person_id, number, joined_at) VALUES (?, ?, ?, ?)', node, p, seat++, iso(T0 - 3 * DAY))
  const post = (id: string, p: number, as: string, kind: string, at: number) =>
    run("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES (?, ?, ?, ?, ?, 'hi', ?)", id, node, p, as, kind, iso(at))
  post('p_ana', ana, '@ana', 'post', T0 - 3 * DAY)
  post('p_sub', ana, '@ana/m-01', 'submission', T0 - 2 * DAY)
  run("INSERT INTO submission (post_id, node_id, number, hash, how_to_check, status, decided_at) VALUES ('p_sub', ?, 1, ?, 'run it', 'passed', ?)", node, 'a'.repeat(64), iso(T0 - DAY))
  post('p_chk', bo, '@bo', 'check', T0 - DAY)
  run("INSERT INTO check_report (id, post_id, submission_id, person_id, slot, verdict, created_at) VALUES ('c_1', 'p_chk', 'p_sub', ?, 'people', 'pass', ?)", bo, iso(T0 - DAY))
  run("INSERT INTO audit_event (id, at, event, node_id, submission_id, number) VALUES ('e_1', ?, 'passed', ?, 'p_sub', 1)", iso(T0 - DAY), node)
  post('p_myra', myra, '@myra', 'post', T0 - DAY)
  post('p_seed', seed, '@bmo_fan', 'post', T0 - DAY)
  return { db, run, node, ids: { myra, seed, early, ana, bo, cy, dee } }
}

async function signIn(env: ReturnType<typeof testEnv>, email: string) {
  const b = new Browser(env)
  expect((await b.post('/signin', { email, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}

describe('the beta funnel page', () => {
  it('is a plain 404 for everyone but an active admin, signed out included', async () => {
    const w = await world()
    const env = testEnv(w.db)
    const signedOut = await new Browser(env).get('/admin/beta')
    expect(signedOut.status).toBe(404)
    const text = await body(signedOut)
    expect(text).toContain('there is nothing at this address.')
    expect(text).not.toContain('beta funnel')

    const ana = await signIn(env, 'ana@example.org')
    const res = await ana.get('/admin/beta')
    expect(res.status).toBe(404)
    expect(await body(res)).not.toContain('beta funnel')

    const myra = await signIn(env, 'myra@example.org')
    const ok = await myra.get('/admin/beta')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('private, no-store')
    expect(ok.headers.get('x-robots-tag')).toBe('noindex')
    const page = await body(ok)
    for (const s of ['beta funnel', 'the loop', 'testers', 'daily activity', 'traffic', '@ana', '@dee', 'part of a pass']) expect(page).toContain(s)
    expect(page).not.toContain('@bmo_fan') // seed accounts aren't testers
    expect(page).not.toMatch(/agents? (working|here|online)/)

    // An admin no longer: the page is gone again.
    w.run("UPDATE person SET is_admin = 0 WHERE handle = 'myra'")
    expect((await myra.get('/admin/beta')).status).toBe(404)
  })

  it('counts the loop for all accounts and for invited ones, leaving out seed accounts and admins', async () => {
    const { db } = await world()
    const people = await testers(db)
    expect(people.map(t => t.handle)).toEqual(['dee', 'cy', 'bo', 'ana', 'early']) // newest sign-up first
    const f = await funnel(db, people)
    expect(f.invited).toBe(4) // ana, bo, cy, eve; not @myra's own row
    expect(Object.fromEntries(STEPS.map((s, i) => [s, [f.fromInvites[i], f.all[i]]]))).toEqual({
      'signed up': [3, 5],
      verified: [2, 3],
      'first post': [2, 2],
      'joined a shwarm or branch': [2, 3],
      'first submission': [1, 1],
      'first check given': [1, 1],
      'part of a pass': [2, 2],
    })
  })

  it("gives each tester's furthest step and last activity", async () => {
    const { db } = await world()
    const by = Object.fromEntries((await testers(db)).map(t => [t.handle, t]))
    expect(STEPS[by.ana.furthest]).toBe('part of a pass') // submitted the passing work
    expect(STEPS[by.bo.furthest]).toBe('part of a pass') // checked it
    expect(STEPS[by.dee.furthest]).toBe('joined a shwarm or branch')
    expect(STEPS[by.cy.furthest]).toBe('signed up')
    expect(by.cy.invited && !by.dee.invited).toBe(true)
    expect(by.ana.last_active).toBe(iso(T0 - 2 * DAY)) // the submission, newer than the post
    expect(by.bo.last_active).toBe(iso(T0 - DAY))
    expect(by.early.last_active).toBeNull()
  })

  it('counts daily activity by utc day, leaving out seed accounts', async () => {
    const { db } = await world()
    const days = lastDays(T0, 14)
    expect(days).toHaveLength(14)
    expect(days.at(-1)).toBe('2026-10-08')
    const rows = Object.fromEntries((await activity(db, days)).map(r => [r.day, r]))
    expect(rows['2026-10-07']).toEqual({ day: '2026-10-07', signups: 2, posts: 1, submissions: 0, checks: 1, passes: 1 })
    expect(rows['2026-10-06']).toMatchObject({ submissions: 1 })
    expect(rows['2026-10-05']).toMatchObject({ posts: 1 })
  })

  it('shows traffic by day, the top referring sites and countries', async () => {
    const w = await world()
    const ins = (day: string, kind: string, ref: string, country: string, hits: number) =>
      w.run('INSERT INTO traffic_daily (day, kind, referrer, country, status_class, hits) VALUES (?, ?, ?, ?, 2, ?)', day, kind, ref, country, hits)
    ins('2026-10-07', 'page', 'news.ycombinator.com', 'DE', 40)
    ins('2026-10-07', 'prompt', '', 'US', 7)
    ins('2026-09-01', 'page', 'old.example', 'FR', 99) // outside the 14 days
    const myra = await signIn(testEnv(w.db), 'myra@example.org')
    const page = await body(await myra.get('/admin/beta'))
    expect(page).toContain('news.ycombinator.com')
    expect(page).toMatch(/2026-10-07<\/td><td class="num">40<\/td><td class="num">7<\/td>/)
    expect(page).toContain('DE')
    expect(page).not.toContain('old.example')
  })
})

describe('the traffic counter', () => {
  const req = (path: string, headers: Record<string, string> = {}, cf?: object) => Object.assign(new Request('https://shwarm.org' + path, { headers }), cf ? { cf } : {})
  const res = (type: string | null, status = 200) => new Response(type ? 'x' : null, { status, headers: type ? { 'content-type': type } : {} })

  it('names the kind from the answer, or from the request when it has no body', () => {
    expect(trafficKind(req('/'), res('text/html; charset=UTF-8'))).toBe('page')
    expect(trafficKind(req('/w/minecraft-in-doom'), res('text/plain; charset=UTF-8'))).toBe('prompt')
    expect(trafficKind(req('/w/minecraft-in-doom?format=json'), res('application/json'))).toBe('json')
    expect(trafficKind(req('/w/minecraft-in-doom', { 'signature-input': 'sig1=()', signature: 'sig1=:x:' }), res('application/json'))).toBe('api')
    expect(trafficKind(req('/robots.txt'), res('application/xml'))).toBe('other')
    // a 304 on a node URL: as the route would pick it; a redirect after a form: the page
    expect(trafficKind(req('/w/minecraft-in-doom'), res(null, 304))).toBe('prompt')
    expect(trafficKind(req('/w/minecraft-in-doom', { accept: 'application/json' }), res(null, 304))).toBe('json')
    expect(trafficKind(req('/w/minecraft-in-doom', { accept: 'text/html' }), res(null, 304))).toBe('page')
    expect(trafficKind(req('/signin'), res(null, 303))).toBe('page')
  })

  it('keeps only another site’s host as the referrer', () => {
    expect(referrerHost('https://news.ycombinator.com/item?id=42', 'shwarm.org')).toBe('news.ycombinator.com')
    expect(referrerHost('https://Lobste.rs/', 'shwarm.org')).toBe('lobste.rs')
    expect(referrerHost('https://shwarm.org/w/minecraft-in-doom', 'shwarm.org')).toBe('')
    expect(referrerHost('https://www.shwarm.org/', 'shwarm.org')).toBe('')
    expect(referrerHost('https://shwarm-staging.myrakrusemark.workers.dev/', 'shwarm-staging.myrakrusemark.workers.dev')).toBe('')
    expect(referrerHost('android-app://com.slack/', 'shwarm.org')).toBe('')
    expect(referrerHost('not a url', 'shwarm.org')).toBe('')
    expect(referrerHost(undefined, 'shwarm.org')).toBe('')
  })

  it('skips health, hooks, static files and preflights', () => {
    for (const p of ['/healthz', '/hooks/resend', '/css/site.css', '/js/site.js', '/img/shwarm-mark.png']) expect(trafficRow(req(p), res('text/plain')), p).toBeNull()
    expect(trafficRow(new Request('https://shwarm.org/w/x', { method: 'OPTIONS' }), res(null, 204))).toBeNull()
    expect(trafficRow(req('/', {}, { country: 'not a country' }), res('text/html'), T0)).toEqual({ day: '2026-10-08', kind: 'page', referrer: '', country: '', status_class: 2 })
  })

  it('counts through the site on staging and production only, with nothing personal kept', async () => {
    const db = testDb()
    const env = { ...testEnv(db), ENV: 'production', SITE_MODE: 'open' }
    const send = (path: string, headers: Record<string, string> = {}, country = 'DE') =>
      app.fetch(req(path, { 'cf-connecting-ip': '203.0.113.77', 'user-agent': 'Mozilla/5.0 SecretBrowser/9', ...headers }, { country }), env)
    expect((await send('/rules', { referer: 'https://news.ycombinator.com/item?id=42' })).status).toBe(200)
    await send('/rules', { referer: 'https://news.ycombinator.com/' })
    await send('/how-it-works', { referer: 'https://shwarm.org/rules' }, 'US')
    await send('/no-such-page', { accept: 'application/json' })
    await send('/healthz')
    const rows = db.raw.prepare('SELECT * FROM traffic_daily ORDER BY kind, referrer, country').all().map((r: any) => ({ ...r }))
    expect(rows).toEqual([
      { day: '2026-10-08', kind: 'json', referrer: '', country: 'DE', status_class: 4, hits: 1 },
      { day: '2026-10-08', kind: 'page', referrer: '', country: 'US', status_class: 2, hits: 1 },
      { day: '2026-10-08', kind: 'page', referrer: 'news.ycombinator.com', country: 'DE', status_class: 2, hits: 2 },
    ])
    // No IP, user agent, path or account anywhere in the table, and no column that could hold one.
    expect(Object.keys(rows[0]).sort()).toEqual(['country', 'day', 'hits', 'kind', 'referrer', 'status_class'])
    expect(JSON.stringify(rows)).not.toMatch(/203\.0\.113|SecretBrowser|rules|how-it-works|item\?id/)

    // Tests and local runs count nothing.
    const quiet = testDb()
    await app.fetch(req('/rules'), { ...testEnv(quiet) })
    expect(quiet.raw.prepare('SELECT COUNT(*) AS n FROM traffic_daily').get().n).toBe(0)
  })

  it('counts after the answer when there is an ExecutionContext', async () => {
    const db = testDb()
    const pending: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} }
    const r = await app.fetch(req('/rules'), { ...testEnv(db), ENV: 'staging', STAGING_PASSWORD: 'pw' }, ctx as unknown as ExecutionContext)
    expect(r.status).toBe(401) // the staging lock's answer is counted too
    expect(pending).toHaveLength(1)
    await Promise.all(pending)
    expect(db.raw.prepare('SELECT kind, status_class, hits FROM traffic_daily').all().map((x: any) => ({ ...x }))).toEqual([{ kind: 'prompt', status_class: 4, hits: 1 }])
  })

  it('never lets a counting error touch the response, and logs it once', async () => {
    resetTrafficLog()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mini = new Hono<{ Bindings: { DB: D1Database; ENV: string } }>()
    mini.use('*', countTraffic())
    mini.get('/', c => c.text('ok'))
    const throwing = { prepare() { throw new Error('d1 is down') } } as unknown as D1Database
    const rejecting = { prepare: () => ({ bind: () => ({ run: () => Promise.reject(new Error('too many writes')) }) }) } as unknown as D1Database
    for (const DB of [throwing, rejecting, throwing]) {
      const r = await mini.request('/', {}, { DB, ENV: 'production' })
      expect(r.status).toBe(200)
      expect(await r.text()).toBe('ok')
    }
    expect(err).toHaveBeenCalledTimes(1)
    resetTrafficLog()
  })
})

describe('the daily summary', () => {
  const at13 = Date.parse('2026-10-08T13:00:00Z')
  const traffic = (db: any) => {
    for (const [kind, hits] of [['page', 90], ['prompt', 30], ['json', 12], ['api', 8]] as const)
      db.raw.prepare("INSERT INTO traffic_daily (day, kind, referrer, country, status_class, hits) VALUES ('2026-10-07', ?, '', '', 2, ?)").run(kind, hits)
  }
  const summaries = (db: any) => db.raw.prepare("SELECT to_email, stream, payload FROM email_outbox WHERE template = 'daily_summary' ORDER BY id").all()

  it('covers yesterday from 13:00 utc on', () => {
    expect(summaryDay(at13 - 1)).toBe('2026-10-06')
    expect(summaryDay(at13)).toBe('2026-10-07')
    expect(summaryDay(at13 + 10 * HOUR)).toBe('2026-10-07')
  })

  it("counts yesterday's line", async () => {
    const { db } = await world()
    traffic(db)
    expect(await daySummary(db, '2026-10-07')).toEqual({
      day: '2026-10-07',
      requests: { page: 90, prompt: 30, json: 12, api: 8, other: 0 },
      signups: 2, // cy and dee; not the seed account
      first_posts: 2, // bo's check and @myra's post; the seed account's doesn't count
      first_submissions: 0,
      checks: 1,
      passes: 1,
    })
    expect((await daySummary(db, '2026-10-06')).first_submissions).toBe(1)
  })

  it('mails every active admin once a day, on the account stream', async () => {
    const { db, run } = await world()
    traffic(db)
    expect(await sendSummary(db, 'production', at13 + 5 * 60_000)).toBe('2026-10-07')
    // a second run sends nothing more
    expect(await sendSummary(db, 'production', at13 + 10 * 60_000)).toBeNull()
    expect(summaries(db)).toHaveLength(1)
    const [m] = summaries(db)
    expect(m.to_email).toBe('myra@example.org')
    expect(m.stream).toBe('account')
    const mail = renderMail('daily_summary', JSON.parse(m.payload), { siteUrl: 'https://shwarm.org', stream: 'account' })
    expect(mail.subject).toBe('shwarm yesterday: 140 requests, 2 sign-ups')
    expect(mail.text).toContain('hi @myra,')
    expect(mail.text).toContain(
      'yesterday (2026-10-07): 140 requests (pages 90, prompts 30, json 12, api 8), 2 sign-ups, 2 first posts, 0 first submissions, 1 check, 1 pass.',
    )
    expect(mail.text).toContain('https://shwarm.org/admin/beta')
    expect(mail.text.replace(/https:\S+/g, '')).toBe(mail.text.replace(/https:\S+/g, '').toLowerCase())

    // The next day: one more, raced by two runs at once.
    run("UPDATE person SET is_admin = 1 WHERE handle = 'dee'")
    run("UPDATE person SET status = 'suspended' WHERE handle = 'dee'") // an admin no longer active gets none
    const next = at13 + DAY + 60_000
    const both = await Promise.all([sendSummary(db, 'staging', next), sendSummary(db, 'staging', next)])
    expect(both).toContain('2026-10-08')
    const all = summaries(db)
    expect(all).toHaveLength(2)
    expect(JSON.parse(all[1].payload).day).toBe('2026-10-08')
    expect(renderMail('daily_summary', JSON.parse(all[1].payload), { siteUrl: 'https://shwarm.org', stream: 'account' }).subject).toBe(
      'shwarm staging yesterday: 0 requests, 0 sign-ups',
    )
  })

  it('runs from the stats cron', async () => {
    const { db } = await world()
    const waits: Promise<unknown>[] = []
    vi.setSystemTime(at13 + 60_000)
    await scheduled({ scheduledTime: at13 + 60_000, cron: STATS_CRON, noRetry() {} } as ScheduledController, { DB: db, ENV: 'production', SITE_URL: 'https://shwarm.org' } as any, {
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
    } as unknown as ExecutionContext)
    await Promise.all(waits)
    expect(summaries(db)).toHaveLength(1)
  })

  it('refuses a payload it cannot use', () => {
    expect(() => renderMail('daily_summary', { day: 'yesterday', link: '/admin/beta' }, { siteUrl: 'https://shwarm.org', stream: 'account' })).toThrow()
  })
})
