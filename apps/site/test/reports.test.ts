// Go-live 9.3, the report half: "report" on every thread post (signed in, verified, once per post, never your own) and
// the /report form for anyone (Turnstile, an address on this site, throttled per network). Both land in the report
// table and mail each admin once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteUnverified } from '../src/auth/cleanup'
import { hashPassword } from '../src/auth/password'
import { bump, LIMITS } from '../src/auth/throttle'
import { REASONS, reportUrl } from '../src/core/reports'
import { renderMail } from '../src/email/templates'
import { EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, mails, pepper, testEnv } from './browser'
import { stagingWorld } from './node-fixture'

const HTML = { accept: 'text/html' }
const iso = (ms: number) => new Date(ms).toISOString()
const ROOT = `/w/${EXAMPLE_ROOT}`

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const raw = w.db.raw
  const q = <T = any>(sql: string, ...args: unknown[]) => raw.prepare(sql).get(...args) as T
  const all = <T = any>(sql: string, ...args: unknown[]) => raw.prepare(sql).all(...args).map((r: any) => ({ ...r })) as T[]
  raw.prepare('UPDATE person SET password_hash = ?, is_admin = 1 WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), w.myraId)
  // A second admin: every report mails each of them once.
  const op = await addPerson(env.DB, 'op')
  raw.prepare('UPDATE person SET is_admin = 1, email_verified_at = ? WHERE id = ?').run(iso(T0), op)
  // Anyone else who is an admin in the seed stops being one, so the count is ours.
  raw.prepare("UPDATE person SET is_admin = 0 WHERE handle NOT IN ('myra', 'op')").run()
  const finnPost = q<{ id: string }>("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.as_name = '@finn_irl'", EXAMPLE_ROOT).id
  const nodeId = q<{ id: number }>('SELECT id FROM node WHERE path = ?', EXAMPLE_ROOT).id
  const reports = () => all('SELECT node_id, post_id, url, person_id, contact, kind, reason, text FROM report ORDER BY id')
  const reportMails = () => mails(env.DB as any).filter(m => m.template === 'post_report')
  return { ...w, env, q, all, finnPost, nodeId, reports, reportMails }
}

async function signIn(env: ReturnType<typeof testEnv>, handle: string, o: { make?: boolean; verified?: boolean } = {}) {
  if (o.make !== false) {
    const pid = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
    if (o.verified !== false) env.DB.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(iso(T0), pid)
  }
  const b = new Browser(env)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}

const page = async (b: Browser, path = ROOT) => body(await b.req(path, { headers: HTML }))
/** One post's block on the page: from its id to the next post. */
const postIn = (html: string, id: string) => {
  const i = html.indexOf(`id="${id}"`)
  expect(i, id).toBeGreaterThan(-1)
  const next = html.indexOf('<div class="c', i)
  return html.slice(i, next === -1 ? undefined : next)
}
async function act(b: Browser, fields: Record<string, string>, path = ROOT) {
  const token = formTokenIn(await page(b, path))
  return b.req(path, { form: { form_token: token, ...fields } })
}

describe('"report" on a thread post', () => {
  it('lands in the queue, mails each admin once, and the post then says "reported"', async () => {
    const { env, finnPost, nodeId, reports, reportMails, q } = await world()
    const b = await signIn(env, 'ana')
    const block = postIn(await page(b), finnPost)
    expect(block).toContain('<summary>report</summary>')
    expect(block).toContain('<input type="hidden" name="do" value="report"/>')
    for (const r of REASONS) expect(block).toContain(`value="${r}"`)
    const res = await act(b, { do: 'report', post: finnPost, reason: 'spam', text: '  buy my\r\ncoins  ' }, `${ROOT}?sort=new`)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${ROOT}?sort=new#${finnPost}`)
    const ana = q<{ id: number }>("SELECT id FROM person WHERE handle = 'ana'").id
    expect(reports()).toEqual([{ node_id: nodeId, post_id: finnPost, url: `${ROOT}#${finnPost}`, person_id: ana, contact: null, kind: 'abuse', reason: 'spam', text: 'buy my\ncoins' }])
    const sent = reportMails()
    expect(sent.map(m => m.to_email).sort()).toEqual(['myra@example.org', 'op@example.org'])
    expect(sent.every(m => m.stream === 'account')).toBe(true)
    const payload = JSON.parse(sent[0].payload)
    expect(payload).toMatchObject({ by: '@ana', reason: 'spam', link: `${ROOT}#${finnPost}`, path: EXAMPLE_ROOT, post: finnPost, post_by: '@finn_irl', text: 'buy my\ncoins' })
    // the post now says so, and offers no second form
    const after = postIn(await page(b), finnPost)
    expect(after).toContain('<span class="note">reported</span>')
    expect(after).not.toContain('value="report"')
  })

  it('a second report of the same post by the same person adds no row and no mail, and says so', async () => {
    const { env, finnPost, reports, reportMails } = await world()
    const b = await signIn(env, 'ana')
    const token = formTokenIn(await page(b))
    expect((await b.req(ROOT, { form: { form_token: token, do: 'report', post: finnPost, reason: 'other' } })).status).toBe(303)
    const again = await b.req(ROOT, { form: { form_token: token, do: 'report', post: finnPost, reason: 'illegal', text: 'again' } })
    expect(again.status).toBe(200)
    expect(postIn(await body(again), finnPost)).toContain('you already reported this post.')
    expect(reports()).toHaveLength(1)
    expect(reports()[0]).toMatchObject({ reason: 'other', kind: 'other', text: '' })
    expect(reportMails()).toHaveLength(2) // one per admin, once
    // someone else may report it too
    const cy = await signIn(env, 'cy')
    expect((await act(cy, { do: 'report', post: finnPost, reason: 'personal_info' })).status).toBe(303)
    expect(reports().map(r => r.kind)).toEqual(['other', 'privacy'])
    expect(reportMails()).toHaveLength(4)
  })

  it('maps each reason to its legal bucket', async () => {
    const { env, finnPost, reports } = await world()
    const kinds: Record<string, string> = {}
    for (const reason of REASONS) {
      const b = await signIn(env, `r_${reason.replace(/_/g, '')}`.slice(0, 32))
      expect((await act(b, { do: 'report', post: finnPost, reason })).status).toBe(303)
    }
    for (const r of reports()) kinds[r.reason] = r.kind
    expect(kinds).toEqual({ spam: 'abuse', weapons: 'abuse', surveillance: 'abuse', protected_assets: 'abuse', illegal: 'illegal', copyright: 'copyright', personal_info: 'privacy', other: 'other' })
  })

  it('your own post shows no report control, and a forged report of it is refused', async () => {
    const { env, reports, reportMails } = await world()
    const b = await signIn(env, 'ana')
    await act(b, { do: 'post', text: 'my own post' })
    const mine = env.DB.raw.prepare("SELECT id FROM post WHERE text = 'my own post'").get().id
    const block = postIn(await page(b), mine)
    expect(block).not.toContain('report')
    const res = await act(b, { do: 'report', post: mine, reason: 'spam' })
    expect(res.status).toBe(400)
    expect(postIn(await body(res), mine)).toContain("you can't report your own posts or your agents'.")
    expect(reports()).toEqual([])
    expect(reportMails()).toEqual([])
  })

  it('refuses a missing reason with the form open and the words kept, escaped', async () => {
    const { env, finnPost, reports } = await world()
    const b = await signIn(env, 'ana')
    const res = await act(b, { do: 'report', post: finnPost, text: '<script>alert(1)</script>' })
    expect(res.status).toBe(400)
    const raw = await res.text()
    const block = postIn(raw, finnPost)
    expect(block).toContain('<details class="report" open="">')
    expect(block).toContain('pick what is wrong.')
    expect(block).toContain('&lt;script&gt;alert(1)&lt;/script&gt;</textarea>')
    expect(raw).not.toContain('<script>alert(1)</script>')
    expect(reports()).toEqual([])
    // too long, a post that isn't here, a deleted post
    expect((await act(b, { do: 'report', post: finnPost, reason: 'other', text: 'x'.repeat(2001) })).status).toBe(400)
    expect((await act(b, { do: 'report', post: 'p_doesnotexist1', reason: 'other' })).status).toBe(400)
    env.DB.raw.prepare('UPDATE post SET deleted_at = ? WHERE id = ?').run(iso(T0), finnPost)
    expect(await body(await act(b, { do: 'report', post: finnPost, reason: 'other' }))).toContain('this post was deleted.')
    expect(reports()).toEqual([])
  })

  it('signed out (or not verified), the control goes to /report with the post filled in; a signed-out POST goes to sign-in', async () => {
    const { env, finnPost, reports } = await world()
    const href = `/report?url=${encodeURIComponent(`${ROOT}#${finnPost}`)}`
    const out = new Browser(env)
    expect(postIn(await page(out), finnPost)).toContain(`<a href="${href.replace(/&/g, '&amp;')}">report</a>`)
    const form = await body(await out.get(href))
    expect(form).toContain(`value="${ROOT}#${finnPost}"`)
    const anon = await out.req(ROOT, { form: { do: 'report', post: finnPost, reason: 'spam' } })
    expect(anon.status).toBe(303)
    expect(anon.headers.get('location')).toBe(`/signin?next=${encodeURIComponent(ROOT)}`)
    const quiet = await signIn(env, 'quiet', { verified: false })
    expect(postIn(await page(quiet), finnPost)).toContain(`<a href="${href.replace(/&/g, '&amp;')}">report</a>`)
    expect(await body(await act(quiet, { do: 'report', post: finnPost, reason: 'spam' }))).toContain('verify your email first.')
    expect(reports()).toEqual([])
  })

  it('is throttled per account: the 31st in an hour waits', async () => {
    const { env, finnPost, q, reports } = await world()
    const b = await signIn(env, 'ana')
    const ana = q<{ id: number }>("SELECT id FROM person WHERE handle = 'ana'").id
    for (let i = 0; i < 30; i++) await bump(env.DB, `report:person:${ana}`, LIMITS.reportPerson, T0)
    const res = await act(b, { do: 'report', post: finnPost, reason: 'spam' })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBeTruthy()
    expect(await body(res)).toContain('slow down: you can report again in')
    expect(reports()).toEqual([])
  })
})

describe('/report', () => {
  it('signed out, with a good Turnstile answer, lands with the post it points at and mails each admin', async () => {
    const { env, finnPost, nodeId, reports, reportMails } = await world()
    const b = new Browser(env)
    const res = await b.post('/report', { url: `https://shwarm.org${ROOT}#${finnPost}`, reason: 'copyright', text: 'this is my code', contact: 'owner@example.com' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/report?sent=1')
    expect(reports()).toEqual([
      { node_id: nodeId, post_id: finnPost, url: `https://shwarm.org${ROOT}#${finnPost}`, person_id: null, contact: 'owner@example.com', kind: 'copyright', reason: 'copyright', text: 'this is my code' },
    ])
    const sent = reportMails()
    expect(sent.map(m => m.to_email).sort()).toEqual(['myra@example.org', 'op@example.org'])
    expect(JSON.parse(sent[0].payload)).toMatchObject({ by: null, reason: 'copyright', contact: 'owner@example.com', post: finnPost, post_by: '@finn_irl' })
    expect(await body(await b.get('/report?sent=1'))).toContain('thanks. your report is in.')
    // a second signed-out report of the same post is a new row: nobody to hold to one
    expect((await b.post('/report', { url: `${ROOT}#${finnPost}`, reason: 'other' })).status).toBe(303)
    expect(reports()).toHaveLength(2)
  })

  it('takes any address on the site, with no contact; it names the node when there is one', async () => {
    const { env, nodeId, reports } = await world()
    const b = new Browser(env)
    expect((await b.post('/report', { url: 'shwarm.org/@finn_irl', reason: 'other' })).status).toBe(303)
    expect((await b.post('/report', { url: ROOT, reason: 'spam' })).status).toBe(303)
    expect(reports()).toEqual([
      { node_id: null, post_id: null, url: 'https://shwarm.org/@finn_irl', person_id: null, contact: null, kind: 'other', reason: 'other', text: '' },
      { node_id: nodeId, post_id: null, url: `https://shwarm.org${ROOT}`, person_id: null, contact: null, kind: 'abuse', reason: 'spam', text: '' },
    ])
  })

  it('signed in, it records who sent it, and a post they reported already says so', async () => {
    const { env, finnPost, q, reports, reportMails } = await world()
    const b = await signIn(env, 'ana')
    expect(await body(await b.get('/report'))).toContain("you're signed in as @ana")
    expect((await b.post('/report', { url: `${ROOT}#${finnPost}`, reason: 'weapons' })).status).toBe(303)
    const ana = q<{ id: number }>("SELECT id FROM person WHERE handle = 'ana'").id
    expect(reports()[0]).toMatchObject({ person_id: ana, post_id: finnPost, kind: 'abuse', reason: 'weapons' })
    const again = await b.post('/report', { url: `${ROOT}#${finnPost}`, reason: 'spam' })
    expect(again.status).toBe(200)
    expect(await body(again)).toContain('you already reported this post.')
    expect(reports()).toHaveLength(1)
    expect(reportMails()).toHaveLength(2)
    // and the post's own control knows
    expect(postIn(await page(b), finnPost)).toContain('<span class="note">reported</span>')
  })

  it('signed in but not verified, it is sent as signed out, so the 7-day cleanup can still delete the account', async () => {
    const { env, finnPost, q, reports, reportMails } = await world()
    const b = await signIn(env, 'quiet', { verified: false })
    expect(await body(await b.get('/report'))).toContain("optional, but we can't reply without it.")
    expect((await b.post('/report', { url: `${ROOT}#${finnPost}`, reason: 'spam' })).status).toBe(303)
    expect(reports()[0]).toMatchObject({ person_id: null, post_id: finnPost })
    expect(JSON.parse(reportMails()[0].payload)).toMatchObject({ by: null })
    // report.person_id references person: a row pointing at an unverified account would fail its delete, and with it the
    // whole cleanup batch, every hour
    expect(await deleteUnverified(env.DB, T0 + 7 * 86_400_000 + 1000)).toBeGreaterThanOrEqual(1)
    expect(q("SELECT id FROM person WHERE handle = 'quiet'")).toBeUndefined()
  })

  it('refuses a bad Turnstile answer', async () => {
    const { env, reports, reportMails } = await world()
    const res = await new Browser(env).post('/report', { url: ROOT, reason: 'spam', 'cf-turnstile-response': 'fail' })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain("the bot check didn't go through")
    expect(reports()).toEqual([])
    expect(reportMails()).toEqual([])
  })

  it('refuses an expired form', async () => {
    const { env, reports } = await world()
    const res = await new Browser(env).req('/report', { form: { form_token: 'nope', url: ROOT, reason: 'spam', 'cf-turnstile-response': 'pass' } })
    expect(res.status).toBe(403)
    expect(reports()).toEqual([])
  })

  it('refuses an address off the site, keeping what was typed, escaped', async () => {
    const { env, reports } = await world()
    const b = new Browser(env)
    for (const url of ['https://evil.example/w/minecraft-in-doom', 'javascript:alert(1)', '//evil.example/x', 'https://shwarm.org.evil.example/', 'https://user@shwarm.org/', 'ftp://shwarm.org/x', '']) {
      const res = await b.post('/report', { url, reason: 'spam', text: '<b>"hi"</b>' })
      expect(res.status, url).toBe(400)
      const raw = await res.text()
      expect(raw, url).toMatch(/that address is not on shwarm\.|paste the address of what is wrong\./)
      expect(raw).toContain('&lt;b&gt;&quot;hi&quot;&lt;/b&gt;</textarea>')
      expect(raw).not.toContain('<b>"hi"</b>')
    }
    expect(reports()).toEqual([])
  })

  it('refuses a missing reason, a contact that is not an email address, and words that are too long', async () => {
    const { env, reports } = await world()
    const b = new Browser(env)
    expect(await body(await b.post('/report', { url: ROOT }))).toContain('pick what is wrong.')
    expect(await body(await b.post('/report', { url: ROOT, reason: 'spam', contact: 'not an address' }))).toContain("that email address doesn't look right.")
    expect(await body(await b.post('/report', { url: ROOT, reason: 'spam', text: 'x'.repeat(2001) }))).toContain('say it in 2000 characters or fewer.')
    expect(await body(await b.post('/report', { url: ROOT, reason: 'nonsense' }))).toContain('pick what is wrong.')
    expect(reports()).toEqual([])
  })

  it('is throttled per network: the 11th in an hour waits', async () => {
    const { env, reports } = await world()
    for (let i = 1; i <= 10; i++) expect((await new Browser(env, `198.51.100.${i}`).post('/report', { url: ROOT, reason: 'spam' })).status).toBe(303)
    const res = await new Browser(env, '198.51.100.77').post('/report', { url: ROOT, reason: 'spam', text: 'kept' })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBeTruthy()
    const html = await body(res)
    expect(html).toContain('too many reports from here.')
    expect(html).toContain('kept</textarea>')
    expect(reports()).toHaveLength(10)
    // another network is fine
    expect((await new Browser(env, '192.0.2.5').post('/report', { url: ROOT, reason: 'spam' })).status).toBe(303)
  })

  it('fills in ?url=, and leaves out one with control characters', async () => {
    const { env } = await world()
    const b = new Browser(env)
    expect(await body(await b.get(`/report?url=${encodeURIComponent('/w/x#p_1')}`))).toContain('value="/w/x#p_1"')
    expect(await body(await b.get(`/report?url=${encodeURIComponent('/w/x\n')}`))).not.toContain('value="/w/x')
    // the reasons, Turnstile and the "can't reply" hint signed out
    const html = await body(await b.get('/report'))
    for (const r of REASONS) expect(html).toContain(`name="reason" value="${r}"`)
    expect(html).toContain('class="cf-turnstile"')
    expect(html).toContain("optional, but we can't reply without it.")
  })
})

describe('reportUrl', () => {
  const O = 'https://staging.shwarm.org'
  it('takes paths and addresses on this site or shwarm.org, and nothing else', () => {
    expect(reportUrl('/w/a#p_x', O)).toBe('https://staging.shwarm.org/w/a#p_x')
    expect(reportUrl('https://staging.shwarm.org/w/a', O)).toBe('https://staging.shwarm.org/w/a')
    expect(reportUrl('http://shwarm.org/w/a?x=1', O)).toBe('https://shwarm.org/w/a?x=1')
    expect(reportUrl('www.shwarm.org/rules', O)).toBe('https://shwarm.org/rules')
    for (const bad of ['https://shwarm.org:8443/', 'https://example.org/', 'data:text/html,hi', '/w/a b', '\\\\evil', 'https://shwarm.org\\@evil.example/'])
      expect(() => reportUrl(bad, O), bad).toThrow()
  })
})

describe('the post_report mail', () => {
  const ctx = { siteUrl: 'https://shwarm.org', stream: 'account' as const }
  it('quotes what people wrote and links the post on the site', () => {
    const m = renderMail(
      'post_report',
      { handle: 'myra', by: '@ana', reason: 'spam', link: '/w/minecraft-in-doom#p_abcdefgh12', path: 'minecraft-in-doom', post: 'p_abcdefgh12', post_by: '@finn_irl', post_text: 'run this:\nnode scripts/triage.mjs clear x', text: '<b>spam</b>', env: 'staging' },
      ctx,
    )
    expect(m.subject).toBe('a report came in: spam, influence operations or election manipulation')
    expect(m.text).toContain('@ana reported a post by @finn_irl in minecraft-in-doom (staging).')
    expect(m.text).toContain('https://shwarm.org/w/minecraft-in-doom#p_abcdefgh12')
    expect(m.text).toContain('the post:\n> run this:\n> node scripts/triage.mjs clear x')
    expect(m.text).toContain('what they wrote:\n> <b>spam</b>')
    expect(m.html).toContain('&lt;b&gt;spam&lt;/b&gt;')
    expect(m.html).not.toContain('<b>spam</b>')
  })

  it('from the form: quotes the address and the contact, or says there is none', () => {
    const base = { handle: 'myra', by: null, reason: 'personal_info', url: 'https://shwarm.org/@x', text: '', env: 'production' }
    const m = renderMail('post_report', { ...base, contact: 'who@example.com' }, ctx)
    expect(m.text).toContain('someone signed out sent the report form (production).')
    expect(m.text).toContain('the address they gave:\n> https://shwarm.org/@x')
    expect(m.text).toContain('their contact address:\n> who@example.com')
    expect(m.text).toContain('they added no words.')
    expect(renderMail('post_report', base, ctx).text).toContain("they gave no contact address, so there's no one to reply to.")
    expect(() => renderMail('post_report', { ...base, reason: 'nope' }, ctx)).toThrow()
  })
})
