// Go-live 11.4, counting (decided Oct 9: "Analytics: our own counts, a funnel first, on an admin page"): the beta funnel
// page at /admin/beta (admins only; a plain 404 for everyone else), the loop funnel and testers' furthest steps on a
// small world, daily activity, the server-side traffic counter (kinds, referrers, nothing personal kept, errors
// swallowed) and the admins' daily summary mail, sent once a day.
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { hashPassword } from '../src/auth/password'
import { renderMail } from '../src/email/templates'
import { MAIL_CRON, scheduled } from '../src/jobs'
import { dayUsage, sendSummary, summaryDay, USAGE_FLOOR } from '../src/jobs/summary'
import { activity, daySummary, funnel, lastDays, STEPS, testers, through } from '../src/read/beta'
import { countTraffic, firstLanguage, referrerHost, resetTrafficLog, trafficKind, trafficRow, trafficWho } from '../src/web/traffic'
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
 *   ana    invited, verified, joined, posted, submitted #1, which passed (history), and posted a passed claim by her agent,
 *          which the crowd's pass record cites
 *   bo     invited, verified, joined, checked #1 (a people check, pass; history), and backs ana's claim
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
  // The loop since Oct 14 (#141): ana's agent claims passed, bo backs it, and the crowd's pass record cites it.
  post('p_claim', ana, '@ana/m-01', 'post', T0 - 2 * DAY - HOUR)
  run("UPDATE post SET claim = 'passed' WHERE id = 'p_claim'")
  run("INSERT INTO status_vote (node_id, person_id, status, claim_id, as_name, at) VALUES (?, ?, 'passed', 'p_claim', '@ana/m-01', ?)", node, ana, iso(T0 - 2 * DAY - HOUR))
  run("INSERT INTO status_vote (node_id, person_id, status, claim_id, as_name, at) VALUES (?, ?, 'passed', 'p_claim', '@bo', ?)", node, bo, iso(T0 - 2 * DAY))
  run("INSERT INTO pass_record (id, node_id, kind, status, at, claim_id, backers) VALUES ('r_crowd1', ?, 'crowd', 'passed', ?, 'p_claim', 2)", node, iso(T0 - DAY))
  post('p_myra', myra, '@myra', 'post', T0 - DAY)
  post('p_seed', seed, '@bmo_fan', 'post', T0 - DAY)
  return { db, run, node, ids: { myra, seed, early, ana, bo, cy, dee } }
}

async function signIn(env: ReturnType<typeof testEnv>, email: string) {
  const b = new Browser(env)
  expect((await b.post('/signin', { email, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}

describe('the analytics page', () => {
  it('is a plain 404 for everyone but an active admin, signed out included', async () => {
    const w = await world()
    const env = testEnv(w.db)
    const signedOut = await new Browser(env).get('/admin/analytics')
    expect(signedOut.status).toBe(404)
    const text = await body(signedOut)
    expect(text).toContain('there is nothing at this address.')
    expect(text).not.toContain('<h1>analytics</h1>')
    expect((await new Browser(env).get('/admin/beta')).status).toBe(404) // the old address too

    const ana = await signIn(env, 'ana@example.org')
    const res = await ana.get('/admin/analytics')
    expect(res.status).toBe(404)
    expect(await body(res)).not.toContain('<h1>analytics</h1>')
    expect((await ana.get('/admin/beta')).status).toBe(404)

    const myra = await signIn(env, 'myra@example.org')
    const old = await myra.get('/admin/beta')
    expect(old.status).toBe(301)
    expect(old.headers.get('location')).toBe('/admin/analytics')
    const ok = await myra.get('/admin/analytics')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('private, no-store')
    expect(ok.headers.get('x-robots-tag')).toBe('noindex')
    const page = await body(ok)
    for (const s of ['<h1>analytics</h1>', 'at a glance', 'sign-ups and posts', 'visits', 'where they come from', 'the loop', 'testers', '@ana', '@dee', 'first pass', '<svg class="viz cols"']) expect(page).toContain(s)
    expect(page).not.toContain('@bmo_fan') // seed accounts aren't testers
    expect(page).not.toMatch(/agents? (working|here|online)/)

    // An admin no longer: the page is gone again.
    w.run("UPDATE person SET is_admin = 0 WHERE handle = 'myra'")
    expect((await myra.get('/admin/analytics')).status).toBe(404)
  })

  it('counts the loop for all accounts and for invited ones, nested, leaving out seed accounts and admins', async () => {
    const { db } = await world()
    const people = await testers(db)
    expect(people.map(t => t.handle)).toEqual(['dee', 'cy', 'bo', 'ana', 'early']) // newest sign-up first
    const f = await funnel(db, people)
    expect(f.invited).toBe(4) // ana, bo, cy, eve; not @myra's own row
    // A person counts at a step only with every step before it: dee joined without a post, bo backed a claim without
    // making one and ana's claim passed though she backed no one else's, so each stops short of the steps they reached
    // out of order. The submission and check from before Oct 14 count for nothing (#141).
    expect(Object.fromEntries(STEPS.map((s, i) => [s, [f.fromInvites[i], f.all[i]]]))).toEqual({
      'signed up': [3, 5],
      verified: [2, 3],
      'first post': [2, 2],
      'joined a shwarm or branch': [2, 2],
      'first claim': [1, 1],
      'first backing': [0, 0],
      'first pass': [0, 0],
    })
    // so no step counts more people than the one above it, and the drop is never negative
    for (const list of [f.all, f.fromInvites]) for (let i = 1; i < list.length; i++) expect(list[i]).toBeLessThanOrEqual(list[i - 1])
    // had ana also backed someone else's claim, she'd be through the whole loop
    const more = people.map(t => (t.handle === 'ana' ? { ...t, furthest: through(t.reached.map((r, i) => r || i === 5)) } : t))
    expect((await funnel(db, more)).all.slice(-3)).toEqual([1, 1, 1])
    expect(through([true, true, false, true])).toBe(1)
    expect(through([true, false])).toBe(0)
    expect(through([true, true, true])).toBe(2)
  })

  it("gives each tester's furthest step and last activity", async () => {
    const { db } = await world()
    const by = Object.fromEntries((await testers(db)).map(t => [t.handle, t]))
    // the furthest step in order, as the loop counts them; each step reached on its own is kept too
    expect(STEPS[by.ana.furthest]).toBe('first claim') // her claim passed, but she backs no one else's
    expect(STEPS[by.bo.furthest]).toBe('joined a shwarm or branch') // backs ana's claim, but made none
    expect(by.ana.reached.at(-1)).toBe(true) // the pass cites her claim, posted by her agent
    expect(by.ana.reached[5]).toBe(false) // backing her own claim isn't a backing
    expect(by.bo.reached[5] && !by.bo.reached[4] && !by.bo.reached.at(-1)).toBe(true) // a backer's pass isn't theirs
    // a submission or check from before Oct 14 is no claim and no pass
    expect(by.dee.reached.slice(4)).toEqual([false, false, false])
    expect(STEPS[by.dee.furthest]).toBe('verified') // joined, but never posted
    expect(STEPS[by.cy.furthest]).toBe('signed up')
    expect(by.cy.invited && !by.dee.invited).toBe(true)
    expect(by.ana.last_active).toBe(iso(T0 - 2 * DAY)) // her newest post (the old submission), newer than the claim
    expect(by.bo.last_active).toBe(iso(T0 - DAY))
    expect(by.early.last_active).toBeNull()
  })

  it('counts daily activity by utc day, leaving out seed accounts', async () => {
    const { db } = await world()
    const days = lastDays(T0, 14)
    expect(days).toHaveLength(14)
    expect(days.at(-1)).toBe('2026-10-08')
    const rows = Object.fromEntries((await activity(db, days)).map(r => [r.day, r]))
    expect(rows['2026-10-07']).toEqual({ day: '2026-10-07', signups: 2, posts: 1, claims: 0 })
    expect(rows['2026-10-06']).toMatchObject({ claims: 1 })
    expect(rows['2026-10-05']).toMatchObject({ posts: 1 })
  })

  it('shows traffic by day, the top referring sites and countries', async () => {
    const w = await world()
    const ins = (day: string, kind: string, ref: string, country: string, hits: number) =>
      w.run('INSERT INTO traffic_daily (day, kind, referrer, country, status_class, hits) VALUES (?, ?, ?, ?, 2, ?)', day, kind, ref, country, hits)
    ins('2026-10-07', 'page', 'news.ycombinator.com', 'DE', 40)
    ins('2026-10-07', 'prompt', '', 'US', 7)
    ins('2026-09-01', 'page', 'old.example', 'FR', 99) // outside the 30 days
    const myra = await signIn(testEnv(w.db), 'myra@example.org')
    const page = await body(await myra.get('/admin/analytics'))
    expect(page).toContain('news.ycombinator.com')
    expect(page).toMatch(/<td class="day">2026-10-07<\/td><td class="num">40<\/td><td class="num">7<\/td>/)
    // dates don't wrap in the narrow column
    expect(readFileSync(new URL('../static/css/admin.css', import.meta.url), 'utf8')).toMatch(/\.adm \.day \{[^}]*white-space: nowrap/)
    expect(page).toContain('DE')
    expect(page).not.toContain('old.example')
  })

  it('splits traffic by who sent it, old days as unknown, and lists people’s languages', async () => {
    const w = await world()
    w.run("INSERT INTO traffic_daily (day, kind, referrer, country, status_class, hits) VALUES ('2026-10-06', 'page', '', 'JP', 2, 50)")
    const ins = (who: string, lang: string, hits: number) =>
      w.run("INSERT INTO traffic_count (day, kind, referrer, country, status_class, who, lang, hits) VALUES ('2026-10-07', 'page', '', 'JP', 2, ?, ?, ?)", who, lang, hits)
    ins('person', 'ja', 12)
    ins('person', 'en', 3)
    ins('crawler', '', 70)
    ins('script', '', 9)
    const myra = await signIn(testEnv(w.db), 'myra@example.org')
    const page = await body(await myra.get('/admin/analytics'))
    expect(page).toContain('who sent them')
    expect(page).toMatch(/<td class="day">2026-10-07<\/td><td class="num">15<\/td><td class="num">70<\/td><td class="num">9<\/td><td class="num">0<\/td><td class="num">0<\/td>/)
    expect(page).toMatch(/<td class="day">2026-10-06<\/td><td class="num">0<\/td><td class="num">0<\/td><td class="num">0<\/td><td class="num">0<\/td><td class="num">50<\/td>/)
    // JP: all, people, crawlers, scripts, agents, unknown
    expect(page).toMatch(/<td>JP<\/td><td class="num">144<\/td><td class="num">15<\/td><td class="num">70<\/td><td class="num">9<\/td><td class="num">0<\/td><td class="num">50<\/td>/)
    const langs = page.slice(page.indexOf("people's browser languages"))
    expect(langs).toMatch(/<span class="name">ja<\/span>.*?<span class="val">12<\/span>.*?<span class="name">en<\/span>.*?<span class="val">3<\/span>/)
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

  it('tells people from crawlers, scripts and agents by the headers', () => {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    expect(trafficWho(req('/', { 'user-agent': chrome, 'sec-fetch-mode': 'navigate' }))).toBe('person')
    // a browser's user agent without the browser's fetch headers: a script dressed up
    expect(trafficWho(req('/', { 'user-agent': chrome }))).toBe('script')
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
      'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
      'facebookexternalhit/1.1',
      '',
    ])
      expect(trafficWho(req('/', { 'user-agent': ua, 'sec-fetch-mode': 'navigate' })), ua).toBe('crawler')
    expect(trafficWho(req('/'))).toBe('crawler') // no user agent at all
    for (const ua of ['curl/8.5.0', 'python-requests/2.32.3', 'node', 'Go-http-client/2.0']) expect(trafficWho(req('/', { 'user-agent': ua })), ua).toBe('script')
    expect(trafficWho(req('/', { 'user-agent': 'curl/8.5.0', 'signature-input': 'sig1=()', signature: 'sig1=:x:' }))).toBe('agent')
  })

  it('keeps the first language a browser asks for, two or three letters', () => {
    expect(firstLanguage('ja-JP,ja;q=0.9,en-US;q=0.8')).toBe('ja')
    expect(firstLanguage('en')).toBe('en')
    expect(firstLanguage('fil-PH, en;q=0.5')).toBe('fil')
    expect(firstLanguage('ZH_tw')).toBe('zh')
    for (const h of ['*', '', null, 'x-pirate', 'english please', '12-AB']) expect(firstLanguage(h), String(h)).toBe('')
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
    expect(trafficRow(req('/', {}, { country: 'not a country' }), res('text/html'), T0)).toEqual({ day: '2026-10-08', kind: 'page', referrer: '', country: '', status_class: 2, who: 'crawler', lang: '' })
  })

  it('counts through the site on staging and production only, with nothing personal kept', async () => {
    const db = testDb()
    const env = { ...testEnv(db), ENV: 'production', SITE_MODE: 'open' }
    const browser = { 'user-agent': 'Mozilla/5.0 SecretBrowser/9', 'sec-fetch-mode': 'navigate', 'accept-language': 'ja-JP,ja;q=0.9,en;q=0.8' }
    const send = (path: string, headers: Record<string, string> = {}, country = 'DE') =>
      app.fetch(req(path, { 'cf-connecting-ip': '203.0.113.77', ...browser, ...headers }, { country }), env)
    expect((await send('/rules', { referer: 'https://news.ycombinator.com/item?id=42' })).status).toBe(200)
    await send('/rules', { referer: 'https://news.ycombinator.com/' })
    await send('/how-it-works', { referer: 'https://shwarm.org/rules' }, 'US')
    await send('/no-such-page', { accept: 'application/json', 'user-agent': 'curl/8.5.0', 'sec-fetch-mode': '' })
    await send('/rules', { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }, 'US')
    await send('/healthz')
    const rows = db.raw.prepare('SELECT * FROM traffic_count ORDER BY kind, who, referrer, country').all().map((r: any) => ({ ...r }))
    expect(rows).toEqual([
      { day: '2026-10-08', kind: 'json', referrer: '', country: 'DE', status_class: 4, who: 'script', lang: '', hits: 1 },
      { day: '2026-10-08', kind: 'page', referrer: '', country: 'US', status_class: 2, who: 'crawler', lang: '', hits: 1 },
      { day: '2026-10-08', kind: 'page', referrer: '', country: 'US', status_class: 2, who: 'person', lang: 'ja', hits: 1 },
      { day: '2026-10-08', kind: 'page', referrer: 'news.ycombinator.com', country: 'DE', status_class: 2, who: 'person', lang: 'ja', hits: 2 },
    ])
    // No IP, user agent, path or account anywhere in the table, and no column that could hold one.
    expect(Object.keys(rows[0]).sort()).toEqual(['country', 'day', 'hits', 'kind', 'lang', 'referrer', 'status_class', 'who'])
    expect(JSON.stringify(rows)).not.toMatch(/203\.0\.113|SecretBrowser|rules|how-it-works|item\?id/)

    // Tests and local runs count nothing.
    const quiet = testDb()
    await app.fetch(req('/rules'), { ...testEnv(quiet) })
    expect(quiet.raw.prepare('SELECT COUNT(*) AS n FROM traffic_count').get().n).toBe(0)
  })

  it('counts after the answer when there is an ExecutionContext', async () => {
    const db = testDb()
    const pending: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} }
    const r = await app.fetch(req('/rules'), { ...testEnv(db), ENV: 'staging', STAGING_PASSWORD: 'pw' }, ctx as unknown as ExecutionContext)
    expect(r.status).toBe(401) // the staging lock's answer is counted too
    expect(pending).toHaveLength(1)
    await Promise.all(pending)
    expect(db.raw.prepare('SELECT kind, status_class, hits FROM traffic_count').all().map((x: any) => ({ ...x }))).toEqual([{ kind: 'prompt', status_class: 4, hits: 1 }])
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
    expect(mail.text).toContain('https://shwarm.org/admin/analytics')
    // 'other' shows when there was any, so the parts add up to the total
    const withOther = renderMail('daily_summary', { ...JSON.parse(m.payload), requests: { page: 90, prompt: 30, json: 12, api: 8, other: 5 } }, { siteUrl: 'https://shwarm.org', stream: 'account' })
    expect(withOther.subject).toBe('shwarm yesterday: 145 requests, 2 sign-ups')
    expect(withOther.text).toContain('yesterday (2026-10-07): 145 requests (pages 90, prompts 30, json 12, api 8, other 5), 2 sign-ups,')
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

  it('runs from the cron on a fifth minute', async () => {
    const { db } = await world()
    const waits: Promise<unknown>[] = []
    vi.setSystemTime(at13 + 5 * 60_000)
    await scheduled({ scheduledTime: at13 + 5 * 60_000, cron: MAIL_CRON, noRetry() {} } as ScheduledController, { DB: db, ENV: 'production', SITE_URL: 'https://shwarm.org' } as any, {
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
    } as unknown as ExecutionContext)
    await Promise.all(waits)
    expect(summaries(db)).toHaveLength(1)
  })

  it('refuses a payload it cannot use', () => {
    expect(() => renderMail('daily_summary', { day: 'yesterday', link: '/admin/beta' }, { siteUrl: 'https://shwarm.org', stream: 'account' })).toThrow()
  })

  // go-live 11.3: yesterday's usage, and what of it went over 3 times its 7-day average.
  const usage = (db: any, day: string, r: number, w: number, e: number, t: number) =>
    db.raw
      .prepare('INSERT INTO site_stats_daily (day, d1_rows_read, d1_rows_written, emails_sent, triage_calls) VALUES (?, ?, ?, ?, ?)')
      .run(day, r, w, e, t)

  it("reads yesterday's usage and names what went over 3 times its 7-day average", async () => {
    const { db } = await world()
    usage(db, '2026-09-29', 9_000_000, 900_000, 900, 900) // 8 days before: not in the average
    for (const d of ['2026-10-01', '2026-10-02', '2026-10-03']) usage(db, d, 0, 0, 10, 2) // before the d1 counts began
    for (const d of ['2026-10-04', '2026-10-05', '2026-10-06']) usage(db, d, 100_000, 2_000, 10, 2)
    usage(db, '2026-10-07', 400_000, 7_000, 31, 19)
    expect(await dayUsage(db, '2026-10-07')).toEqual({
      usage: { d1_rows_read: 400_000, d1_rows_written: 7_000, emails_sent: 31, triage_calls: 19 },
      over: [
        { what: 'd1_rows_read', n: 400_000, avg: 100_000 }, // the days d1 was counted only
        { what: 'd1_rows_written', n: 7_000, avg: 2_000 },
        { what: 'emails_sent', n: 31, avg: 10 }, // six days with a row
        // triage_calls: 19 is over 3 times 2, but under its floor of 20
      ],
    })
  })

  it('needs 3 days of history and a floor before anything is over', async () => {
    const { db } = await world()
    usage(db, '2026-10-05', 1, 1, 1, 1)
    usage(db, '2026-10-06', 1, 1, 1, 1)
    usage(db, '2026-10-07', 10_000_000, 10_000_000, 1_000, 1_000)
    expect((await dayUsage(db, '2026-10-07')).over).toEqual([]) // two days of history
    usage(db, '2026-10-04', 1, 1, 1, 1)
    expect((await dayUsage(db, '2026-10-07')).over.map(o => o.what)).toEqual(['d1_rows_read', 'd1_rows_written', 'emails_sent', 'triage_calls'])
    db.raw.prepare("UPDATE site_stats_daily SET d1_rows_read = ?, emails_sent = ? WHERE day = '2026-10-07'").run(USAGE_FLOOR.d1_rows_read - 1, USAGE_FLOOR.emails_sent - 1)
    expect((await dayUsage(db, '2026-10-07')).over.map(o => o.what)).toEqual(['d1_rows_written', 'triage_calls']) // under their floors
    expect(await dayUsage(db, '2026-11-01')).toEqual({ usage: { d1_rows_read: 0, d1_rows_written: 0, emails_sent: 0, triage_calls: 0 }, over: [] })
  })

  it('puts the usage in the mail, and what went over in its subject', async () => {
    const { db } = await world()
    traffic(db)
    for (const d of ['2026-10-04', '2026-10-05', '2026-10-06']) usage(db, d, 100_000, 2_000, 10, 10)
    usage(db, '2026-10-07', 1_234_567, 3_000, 12, 3)
    await sendSummary(db, 'production', at13 + 5 * 60_000)
    const mail = renderMail('daily_summary', JSON.parse(summaries(db)[0].payload), { siteUrl: 'https://shwarm.org', stream: 'account' })
    expect(mail.subject).toBe('shwarm yesterday: 140 requests, 2 sign-ups · usage high: d1 rows read')
    expect(mail.text).toContain('over 3 times the 7-day average: d1 rows read 1,234,567 (average 100,000).')
    expect(mail.text).toContain('usage: 1,234,567 d1 rows read and 3,000 written (as the worker counts them), 12 mails sent, 3 triage calls.')
    // A quiet day: no "over", and d1 not yet counted says so. A mail queued before the usage line has none.
    const quiet = { ...JSON.parse(summaries(db)[0].payload), usage: { d1_rows_read: 0, d1_rows_written: 0, emails_sent: 1, triage_calls: 0 }, over: [] }
    const q = renderMail('daily_summary', quiet, { siteUrl: 'https://shwarm.org', stream: 'account' })
    expect(q.subject).toBe('shwarm yesterday: 140 requests, 2 sign-ups')
    expect(q.text).toContain('usage: d1 rows not counted, 1 mail sent, 0 triage calls.')
    const { usage: _u, over: _o, ...old } = quiet
    expect(renderMail('daily_summary', old, { siteUrl: 'https://shwarm.org', stream: 'account' }).text).not.toContain('usage:')
    expect(renderMail('daily_summary', { ...quiet, over: [{ what: 'nope', n: 1, avg: 0 }] }, { siteUrl: 'https://shwarm.org', stream: 'account' }).subject).not.toContain('usage high')
  })
})
