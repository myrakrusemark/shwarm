// Go-live 9.4, the account half of the admin console: /admin/people looks an account up by handle or email and acts on
// it (resend verify, mark verified, unsuppress, end sessions, the allow-list, founding, suspend, unsuspend). Each act
// needs a reason and writes exactly one moderation_action row, public or private, in its own batch. Done when (for this
// slice): Myra resolves a staged "no verify mail" case from this page alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { deleteUnverified } from '../src/auth/cleanup'
import { accountAct } from '../src/core/admin-accounts'
import { renderMail } from '../src/email/templates'
import { addPerson, T0, testDb } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, linkIn, mails, pepper, testEnv } from './browser'

const iso = (ms: number) => new Date(ms).toISOString()
const MIN = 60_000

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** @myra (admin), @op (a second admin), @ana (verified, active) and @cy (signed up, never verified). */
async function world() {
  const db = testDb()
  const env = testEnv(db)
  const raw = db.raw
  const q = <T = any>(sql: string, ...args: unknown[]) => raw.prepare(sql).get(...args) as T
  const all = <T = any>(sql: string, ...args: unknown[]) => raw.prepare(sql).all(...args).map((r: any) => ({ ...r })) as T[]
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  const person = async (handle: string, o: { verified?: boolean; admin?: boolean } = {}) => {
    const id = await addPerson(db, handle, { hash })
    raw.prepare('UPDATE person SET email_verified_at = ?, is_admin = ? WHERE id = ?').run(o.verified === false ? null : iso(T0), o.admin ? 1 : 0, id)
    return id
  }
  const ids = { myra: await person('myra', { admin: true }), op: await person('op', { admin: true }), ana: await person('ana'), cy: await person('cy', { verified: false }) }
  const modRows = () => all('SELECT by_person, action, node_id, post_id, person_id, reason, public FROM moderation_action ORDER BY id')
  return { db, env, raw, q, all, ids, modRows }
}
type W = Awaited<ReturnType<typeof world>>

async function signIn(env: W['env'], handle: string) {
  const b = new Browser(env)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}

const lookup = async (b: Browser, q: string) => b.get(`/admin/people?q=${encodeURIComponent(q)}`)

/** The once-value of the act form for `act` on the page. */
function onceFor(html: string, act: string): string {
  const i = html.indexOf(`name="do" value="${act}"`)
  if (i < 0) throw new Error(`no ${act} form on the page`)
  const m = /name="once" value="([^"]+)"/.exec(html.slice(i))
  return m![1]
}

/** Opens the lookup page for `q` and sends the `act` form on it, with a reason. */
async function act(b: Browser, q: string, act: string, reason = 'checked with them by mail', extra: Record<string, string> = {}) {
  const html = await body(await lookup(b, q))
  const person = /name="person" value="(\d+)"/.exec(html)?.[1]
  const email = /name="email" value="([^"]*)"/.exec(html)?.[1]
  const form: Record<string, string> = { form_token: formTokenIn(html), do: act, once: onceFor(html, act), reason, ...(person ? { person } : { email: email ?? '' }), ...extra }
  return b.req(`/admin/people?q=${encodeURIComponent(q)}`, { form })
}

describe('/admin/people: who gets in', () => {
  it('is a plain 404 for everyone but an active admin, page and form alike', async () => {
    const w = await world()
    const out = new Browser(w.env)
    for (const res of [await out.get('/admin/people'), await out.get('/admin/people?q=ana')]) {
      expect(res.status).toBe(404)
      expect(await body(res)).not.toContain('look up')
    }
    const ana = await signIn(w.env, 'ana')
    expect((await ana.get('/admin/people?q=cy')).status).toBe(404)
    const token = formTokenIn(await (await ana.get('/signin')).text())
    const post = await ana.req('/admin/people?q=cy', { form: { form_token: token, do: 'mark_verified', person: String(w.ids.cy), once: 'a'.repeat(24), reason: 'x' } })
    expect(post.status).toBe(404)
    expect(w.q('SELECT email_verified_at FROM person WHERE id = ?', w.ids.cy).email_verified_at).toBeNull()
    expect(w.modRows()).toEqual([])

    const myra = await signIn(w.env, 'myra')
    const ok = await myra.get('/admin/people')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('private, no-store')
    expect(ok.headers.get('x-robots-tag')).toBe('noindex')
    const html = await body(ok)
    expect(html).toContain('handle or email')
    expect(html).toContain('<b aria-current="page">people</b>')
    expect(html).toContain('/css/admin-accounts.css')
  })

  it('asks for the password again after 10 minutes, and a stale form token is refused', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    const html = await body(await lookup(myra, 'cy'))
    vi.setSystemTime(T0 + 11 * MIN)
    const page = await lookup(myra, 'cy')
    expect(page.status).toBe(303)
    expect(page.headers.get('location')).toBe(`/step-up?next=${encodeURIComponent('/admin/people?q=cy')}`)
    const form = { form_token: formTokenIn(html), do: 'mark_verified', person: String(w.ids.cy), once: onceFor(html, 'mark_verified'), reason: 'known' }
    const post = await myra.req('/admin/people?q=cy', { form })
    expect(post.status).toBe(303)
    expect(post.headers.get('location')).toMatch(/^\/step-up\?next=/)
    expect(w.modRows()).toEqual([])
    vi.setSystemTime(T0)
    const bad = await myra.req('/admin/people?q=cy', { form: { ...form, form_token: 'nope' } })
    expect(bad.status).toBe(403)
    expect(w.modRows()).toEqual([])
  })
})

describe('/admin/people: lookup', () => {
  it('finds an account by handle (with or without @, any case) and by email (case-insensitive, normalized)', async () => {
    const w = await world()
    w.raw.prepare("UPDATE person SET email = 'Ana.Lee+shwarm@gmail.com', email_norm = 'analee@gmail.com' WHERE id = ?").run(w.ids.ana)
    const myra = await signIn(w.env, 'myra')
    for (const q of ['ana', '@ana', 'ANA', 'ana.lee+shwarm@gmail.com', 'ANALEE@GMAIL.COM', 'a.n.a.l.e.e+other@gmail.com']) {
      const html = await body(await lookup(myra, q))
      expect(html, q).toContain('account <span>@ana</span>')
      expect(html, q).toContain(`name="person" value="${w.ids.ana}"`)
    }
    expect(await body(await lookup(myra, 'nobody_here'))).toContain('no account has that handle.')
    const addr = await body(await lookup(myra, 'stranger@example.org'))
    expect(addr).toContain('no account has this address.')
    expect(addr).toContain('mail <span>stranger@example.org</span>')
    expect(addr).toContain('add to the allow-list')
    expect(addr).not.toContain('name="person"')
  })

  it('shows status, verified, founding, established, admin, joined; mail with its state; suppression; allow-list; sessions without tokens; keys; flags and reports', async () => {
    const w = await world()
    const r = (sql: string, ...a: unknown[]) => w.raw.prepare(sql).run(...a)
    r("UPDATE person SET founding = 1, established_at = ? WHERE id = ?", iso(T0), w.ids.ana)
    r("INSERT INTO signup_allow (email_norm, note, added_at) VALUES ('ana@example.org', 'met at the meetup', ?)", iso(T0 - 9 * 86_400_000))
    r("INSERT INTO email_suppression (email_norm, reason, created_at) VALUES ('ana@example.org', 'bounce', ?)", iso(T0))
    r("INSERT INTO email_outbox (to_email, person_id, template, stream, created_at, send_after, attempts, sent_at, provider_id) VALUES ('ana@example.org', ?, 'welcome', 'account', ?, ?, 1, ?, 're_1')", w.ids.ana, iso(T0), iso(T0), iso(T0))
    r("INSERT INTO email_outbox (to_email, person_id, template, stream, created_at, send_after, attempts, sent_at, last_error) VALUES ('ana@example.org', ?, 'reset', 'account', ?, ?, 1, ?, 'skipped: suppressed (bounce)')", w.ids.ana, iso(T0), iso(T0), iso(T0))
    r("INSERT INTO agent_key (id, person_id, name, public_key, can_post_as, created_at) VALUES ('ana-laptop-1', ?, 'claude code · laptop', 'pk', '@ana/m-01', ?)", w.ids.ana, iso(T0))
    const node = Number(
      r(
        `INSERT INTO node (path, slug, kind, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, triage, created_at)
         VALUES ('minecraft-in-doom', 'minecraft-in-doom', 'shwarm', 'minecraft in doom', 'w', 'd', '{}', 1, 'MIT', ?, '@myra', 'live', 'clear', ?)`,
        w.ids.myra, iso(T0),
      ).lastInsertRowid,
    )
    r("INSERT INTO flag (node_id, person_id, reason, created_at) VALUES (?, ?, 'spam', ?)", node, w.ids.ana, iso(T0))
    r("INSERT INTO report (url, person_id, kind, reason, text, created_at) VALUES ('https://shwarm.org/w/x', ?, 'abuse', 'personal_info', 'my address is in it', ?)", w.ids.ana, iso(T0))
    const anaB = await signIn(w.env, 'ana')
    const anaToken = [...anaB.jar.values()].join(' ')
    const myra = await signIn(w.env, 'myra')
    const html = await body(await lookup(myra, 'ana'))
    for (const s of ['<b>active</b>', 'ana@example.org', '2026-10-08 12:00 utc', 'founding</th><td>yes', 'admin</th><td>no', 'met at the meetup', 'on it (bounce)', '<code>welcome</code>', '<b>sent</b>', '<b class="off">not sent</b>', 'skipped: suppressed (bounce)', '1 signed in', 'claude code · laptop', '@ana/m-01', 'works', 'minecraft-in-doom', 'personal_info', 'open']) {
      expect(html, s).toContain(s)
    }
    // No session id or cookie value, ever.
    for (const v of anaToken.split(' ')) expect(html).not.toContain(v)
    const sid = w.q('SELECT id FROM session WHERE person_id = ?', w.ids.ana).id
    expect(html).not.toContain(sid)
  })
})

describe('/admin/people: the acts', () => {
  it('every act needs a reason; none written, nothing changed', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    for (const reason of ['', '   ', 'x'.repeat(501)]) {
      const res = await act(myra, 'cy', 'mark_verified', reason)
      expect(res.status).toBe(400)
      expect(await body(res)).toContain('give a reason: one line, up to 500 characters.')
    }
    expect(w.q('SELECT email_verified_at FROM person WHERE id = ?', w.ids.cy).email_verified_at).toBeNull()
    expect(w.modRows()).toEqual([])
  })

  it('each act changes its state and writes one row, private except suspend and unsuspend', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    const row = () => w.modRows().at(-1)
    const ok = async (q: string, a: string, reason = `why ${a}`) => {
      const before = w.modRows().length
      const res = await act(myra, q, a, reason)
      expect(res.status, a).toBe(303)
      expect(res.headers.get('location')).toBe(`/admin/people?q=${encodeURIComponent(q)}&done=${a}`)
      expect(w.modRows().length, a).toBe(before + 1)
      return row()
    }
    const ana = w.ids.ana

    expect(await ok('ana', 'founding')).toEqual({ by_person: w.ids.myra, action: 'founding', node_id: null, post_id: null, person_id: ana, reason: 'why founding', public: 0 })
    expect(w.q('SELECT founding, established_at FROM person WHERE id = ?', ana)).toEqual({ founding: 1, established_at: iso(T0) })
    expect((await ok('ana', 'unfounding')).public).toBe(0)
    expect(w.q('SELECT founding, established_at FROM person WHERE id = ?', ana)).toEqual({ founding: 0, established_at: null })

    expect(await ok('ana@example.org', 'allow_add', 'invited at the meetup')).toMatchObject({ action: 'allow_add', person_id: ana, public: 0 })
    expect(w.q("SELECT note FROM signup_allow WHERE email_norm = 'ana@example.org'").note).toBe('invited at the meetup')
    expect(await ok('ana', 'allow_remove')).toMatchObject({ action: 'allow_remove', person_id: ana, public: 0 })
    expect(w.q("SELECT 1 AS ok FROM signup_allow WHERE email_norm = 'ana@example.org'")).toBeUndefined()

    // An address with no account: the allow-list works on it, with no person on the row.
    expect(await ok('new.person@example.org', 'allow_add')).toMatchObject({ action: 'allow_add', person_id: null, public: 0 })
    expect(w.q("SELECT 1 AS ok FROM signup_allow WHERE email_norm = 'new.person@example.org'")).toEqual({ ok: 1 })

    w.raw.prepare("INSERT INTO email_suppression (email_norm, reason, created_at) VALUES ('ana@example.org', 'complaint', ?)").run(iso(T0))
    expect(await ok('ana', 'unsuppress')).toMatchObject({ action: 'unsuppress', person_id: ana, public: 0 })
    expect(w.q('SELECT COUNT(*) AS n FROM email_suppression').n).toBe(0)

    await signIn(w.env, 'ana')
    await signIn(w.env, 'ana')
    w.raw.prepare("INSERT INTO email_token (id, person_id, purpose, new_email, created_at, expires_at) VALUES ('tok', ?, 'email_change', 'ana2@example.org', ?, ?)").run(ana, iso(T0), iso(T0 + 86_400_000))
    expect(w.q('SELECT COUNT(*) AS n FROM session WHERE person_id = ?', ana).n).toBe(2)
    expect(await ok('ana', 'end_sessions')).toMatchObject({ action: 'end_sessions', person_id: ana, public: 0 })
    expect(w.q('SELECT COUNT(*) AS n FROM session WHERE person_id = ?', ana).n).toBe(0)
    expect(w.q("SELECT used_at FROM email_token WHERE id = 'tok'").used_at).toBe(iso(T0))

    expect(await ok('ana', 'suspend', 'spam in three threads')).toMatchObject({ action: 'suspend', person_id: ana, reason: 'spam in three threads', public: 1 })
    expect(w.q('SELECT status FROM person WHERE id = ?', ana).status).toBe('suspended')
    expect(await ok('ana', 'unsuspend', 'appeal upheld')).toMatchObject({ action: 'unsuspend', person_id: ana, public: 1 })
    expect(w.q('SELECT status FROM person WHERE id = ?', ana).status).toBe('active')

    expect(await ok('cy', 'resend_verify')).toMatchObject({ action: 'resend_verify', person_id: w.ids.cy, public: 0 })
    expect(await ok('cy', 'mark_verified')).toMatchObject({ action: 'mark_verified', person_id: w.ids.cy, public: 0 })
    expect(w.q('SELECT email_verified_at FROM person WHERE id = ?', w.ids.cy).email_verified_at).toBe(iso(T0))

    // The done line shows on the page it lands on.
    expect(await body(await lookup(myra, 'cy'))).not.toContain('their email is marked verified.')
    expect(await body(await myra.get('/admin/people?q=cy&done=mark_verified'))).toContain('their email is marked verified.')
  })

  it('refuses an act that changes nothing, with the reason under it, and writes no row', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    const html = await body(await lookup(myra, 'ana'))
    // ana is verified: no resend, no mark verified on her page
    expect(html).not.toContain('value="resend_verify"')
    expect(html).not.toContain('value="mark_verified"')
    expect(html).not.toContain('value="unfounding"') // she isn't founding
    // Sent anyway (an old page): refused.
    const token = formTokenIn(html)
    for (const [a, said] of [
      ['resend_verify', '@ana has a verified email already.'],
      ['mark_verified', '@ana has a verified email already.'],
      ['unsuppress', "that address isn't on the suppression list."],
      ['unsuspend', "@ana isn't suspended."],
      ['end_sessions', "@ana isn't signed in anywhere."],
    ]) {
      const r = await myra.req('/admin/people?q=ana', { form: { form_token: token, do: a, person: String(w.ids.ana), once: `once-${a}-0123456789`, reason: 'testing' } })
      expect(r.status, a).toBe(400)
      expect(await body(r), a).toContain(said)
    }
    expect(w.modRows()).toEqual([])
  })

  it('the same form sent twice (a double click) acts and logs once', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    const html = await body(await lookup(myra, 'ana'))
    const form = { form_token: formTokenIn(html), do: 'suspend', person: String(w.ids.ana), once: onceFor(html, 'suspend'), reason: 'spam' }
    expect((await myra.req('/admin/people?q=ana', { form })).status).toBe(303)
    w.raw.prepare("UPDATE person SET status = 'active' WHERE id = ?").run(w.ids.ana) // as if the second had read her as active
    const again = await myra.req('/admin/people?q=ana', { form })
    expect(again.status).toBe(400)
    expect(await body(again)).toContain('that form was sent already.')
    expect(w.modRows().filter(r => r.action === 'suspend')).toHaveLength(1)
    expect(mails(w.db as any).filter(m => m.template === 'account_suspended')).toHaveLength(1)
  })
})

describe('/admin/people: suspend', () => {
  it('ends sessions, revokes keys, queues the mail with the reason, hands waiting sign-offs to the operator; they can no longer sign in or act', async () => {
    const w = await world()
    const r = (sql: string, ...a: unknown[]) => w.raw.prepare(sql).run(...a)
    const ana = w.ids.ana
    // ana authors a shwarm whose submission #1 waits on her sign-off.
    const node = Number(
      r(
        `INSERT INTO node (path, slug, kind, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, triage, created_at)
         VALUES ('minecraft-in-doom', 'minecraft-in-doom', 'shwarm', 'minecraft in doom', 'w', 'd', '{"author":true}', 1, 'MIT', ?, '@ana', 'live', 'clear', ?)`,
        ana, iso(T0),
      ).lastInsertRowid,
    )
    r("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_sub', ?, ?, '@ana/m-01', 'submission', 'done', ?)", node, ana, iso(T0))
    r("INSERT INTO submission (post_id, node_id, number, hash, how_to_check) VALUES ('p_sub', ?, 1, ?, 'run it')", node, 'a'.repeat(64))
    r("INSERT INTO inbox_item (person_id, kind, node_id, post_id, text, created_at) VALUES (?, 'sign_off', ?, 'p_sub', '#1 is ready', ?)", ana, node, iso(T0))
    r("INSERT INTO agent_key (id, person_id, name, public_key, can_post_as, created_at) VALUES ('ana-1', ?, 'one', 'pk', '@ana/m-01', ?)", ana, iso(T0))
    r("INSERT INTO agent_key (id, person_id, name, public_key, can_post_as, created_at, revoked_at) VALUES ('ana-2', ?, 'two', 'pk', '@ana/m-02', ?, ?)", ana, iso(T0), iso(T0 - MIN))
    r("INSERT INTO email_token (id, person_id, purpose, created_at, expires_at) VALUES ('reset-tok', ?, 'reset', ?, ?)", ana, iso(T0), iso(T0 + MIN * 60))
    // Suppressed: the suspension mail still goes (security stream).
    r("INSERT INTO email_suppression (email_norm, reason, created_at) VALUES ('ana@example.org', 'bounce', ?)", iso(T0))
    const anaB = await signIn(w.env, 'ana')
    expect((await anaB.get('/keys')).status).toBe(200)
    const myra = await signIn(w.env, 'myra')
    vi.setSystemTime(T0 + MIN)

    const res = await act(myra, 'ana', 'suspend', 'posted a stranger\'s home address')
    expect(res.status).toBe(303)
    expect(await body(await myra.get(res.headers.get('location')!))).toContain('suspended. their sessions ended')
    expect(w.q('SELECT status FROM person WHERE id = ?', ana).status).toBe('suspended')
    expect(w.q('SELECT COUNT(*) AS n FROM session WHERE person_id = ?', ana).n).toBe(0)
    expect(w.all('SELECT id, revoked_at FROM agent_key WHERE person_id = ? ORDER BY id', ana)).toEqual([
      { id: 'ana-1', revoked_at: iso(T0 + MIN) },
      { id: 'ana-2', revoked_at: iso(T0 - MIN) }, // already revoked: its date stays
    ])
    expect(w.q("SELECT used_at FROM email_token WHERE id = 'reset-tok'").used_at).toBe(iso(T0 + MIN))
    const sent = mails(w.db as any)
    const mail = sent.find(m => m.template === 'account_suspended')!
    expect(mail).toMatchObject({ to_email: 'ana@example.org', stream: 'security', person_id: ana })
    const shown = renderMail('account_suspended', JSON.parse(mail.payload), { siteUrl: 'https://shwarm.org', stream: 'security' })
    expect(shown.subject).toBe('your shwarm account is suspended')
    expect(shown.text).toContain("the reason: posted a stranger's home address")
    expect(shown.text).toContain('hi @ana,')
    // The author-gone rule: each active admin gets the sign-off, item and mail.
    expect(w.all("SELECT person_id FROM inbox_item WHERE kind = 'sign_off' AND post_id = 'p_sub' ORDER BY person_id").map(x => x.person_id)).toEqual([ana, w.ids.myra, w.ids.op].sort((a, b) => a - b))
    const handed = sent.filter(m => m.template === 'sign_off_ready')
    expect(handed.map(m => m.to_email).sort()).toEqual(['myra@example.org', 'op@example.org'])
    expect(JSON.parse(handed[0].payload)).toMatchObject({ author_gone: true, author: 'ana', number: 1, link: '/w/minecraft-in-doom/s/1' })
    // Public row.
    expect(w.modRows()).toEqual([{ by_person: w.ids.myra, action: 'suspend', node_id: null, post_id: null, person_id: ana, reason: "posted a stranger's home address", public: 1 }])

    // Their old browser is signed out, and they can't sign in again.
    expect((await anaB.get('/keys')).status).toBe(303)
    const again = new Browser(w.env)
    const signin = await again.post('/signin', { email: 'ana@example.org', password: GOOD_PASSWORD })
    expect(signin.status).not.toBe(303)
    expect(w.q('SELECT COUNT(*) AS n FROM session WHERE person_id = ?', ana).n).toBe(0)

    // Unsuspended: they sign in again; the keys stay revoked.
    expect((await act(myra, 'ana', 'unsuspend', 'appeal upheld')).status).toBe(303)
    expect((await new Browser(w.env).post('/signin', { email: 'ana@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    expect(w.q("SELECT revoked_at FROM agent_key WHERE id = 'ana-1'").revoked_at).toBe(iso(T0 + MIN))
  })

  it("can't be done to yourself; another admin can be suspended, and then can't use admin", async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    expect(await body(await lookup(myra, 'myra'))).not.toContain('value="suspend"')
    const html = await body(await lookup(myra, 'op'))
    const self = await myra.req('/admin/people?q=myra', { form: { form_token: formTokenIn(html), do: 'suspend', person: String(w.ids.myra), once: 'self-once-0123456789', reason: 'test' } })
    expect(self.status).toBe(400)
    expect(await body(self)).toContain("you can't suspend yourself.")
    expect(w.q('SELECT status FROM person WHERE id = ?', w.ids.myra).status).toBe('active')
    const op = await signIn(w.env, 'op')
    expect((await act(myra, 'op', 'suspend', 'lost laptop')).status).toBe(303)
    expect((await op.get('/admin/people')).status).toBe(404)
  })
})

describe('/admin/people: resend verify', () => {
  it('queues a fresh verify mail whose link works, and the old link stops', async () => {
    const w = await world()
    const r = (sql: string, ...a: unknown[]) => w.raw.prepare(sql).run(...a)
    r("INSERT INTO email_token (id, person_id, purpose, created_at, expires_at) VALUES ('old', ?, 'verify', ?, ?)", w.ids.cy, iso(T0), iso(T0 + 86_400_000))
    const myra = await signIn(w.env, 'myra')
    expect((await act(myra, 'cy', 'resend_verify', 'their first mail bounced')).status).toBe(303)
    const m = mails(w.db as any).filter(x => x.template === 'verify')
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ to_email: 'cy@example.org', stream: 'account', person_id: w.ids.cy })
    expect(w.q("SELECT used_at FROM email_token WHERE id = 'old'").used_at).toBe(iso(T0))
    // The link verifies cy.
    const cy = new Browser(w.env)
    const link = linkIn(w.db as any, 'verify')
    expect((await cy.get(link)).status).toBe(200)
    const t = new URL(link, 'https://shwarm.org').searchParams.get('t')!
    const done = await cy.post('/verify', { t })
    expect(done.status).toBe(303)
    expect(w.q('SELECT email_verified_at FROM person WHERE id = ?', w.ids.cy).email_verified_at).not.toBeNull()
  })

  it('is refused for a verified account, by a direct call too', async () => {
    const w = await world()
    const r = await accountAct(w.db, { by: w.ids.myra, act: 'resend_verify', personId: w.ids.ana, reason: 'x', once: 'direct-once-0123456789', origin: 'https://shwarm.org' })
    expect(r).toEqual({ refused: '@ana has a verified email already.' })
    expect(mails(w.db as any)).toEqual([])
    expect(w.modRows()).toEqual([])
  })
})

describe('/admin/people: the staged "no verify mail" case', () => {
  /** cy signed up; her verify mail was skipped (staging: not on the allow-list) and her address is suppressed after a bounce. */
  async function staged() {
    const w = await world()
    const r = (sql: string, ...a: unknown[]) => w.raw.prepare(sql).run(...a)
    r("INSERT INTO email_outbox (to_email, person_id, template, stream, created_at, send_after, attempts, sent_at, last_error) VALUES ('cy@example.org', ?, 'verify', 'account', ?, ?, 1, ?, 'skipped: staging: not on the allow-list')", w.ids.cy, iso(T0), iso(T0), iso(T0))
    r("INSERT INTO email_suppression (email_norm, reason, created_at) VALUES ('cy@example.org', 'bounce', ?)", iso(T0))
    return w
  }

  it('the page shows why, and allow-list + unsuppress + resend gets a mail that can go', async () => {
    const w = await staged()
    const myra = await signIn(w.env, 'myra')
    const html = await body(await lookup(myra, 'CY@example.org'))
    for (const s of ['not verified', 'skipped: staging: not on the allow-list', 'on it (bounce)', 'take off the suppression list', 'resend the verify mail', 'mark email verified', 'add to the allow-list']) expect(html, s).toContain(s)
    expect((await act(myra, 'cy@example.org', 'allow_add', 'beta tester')).status).toBe(303)
    expect((await act(myra, 'cy@example.org', 'unsuppress', 'the bounce was a full inbox')).status).toBe(303)
    expect((await act(myra, 'cy@example.org', 'resend_verify', 'first one never went')).status).toBe(303)
    const after = await body(await lookup(myra, 'cy@example.org'))
    expect(after).toContain('<b class="off">waiting</b>')
    expect(after).toContain('suppression list: not on it.')
    expect(w.modRows().map(x => [x.action, x.person_id, x.public])).toEqual([
      ['allow_add', w.ids.cy, 0],
      ['unsuppress', w.ids.cy, 0],
      ['resend_verify', w.ids.cy, 0],
    ])
    // The new mail clears every check the sender makes before it sends.
    expect(w.q("SELECT 1 AS ok FROM signup_allow WHERE email_norm = 'cy@example.org'")).toEqual({ ok: 1 })
    expect(w.q('SELECT COUNT(*) AS n FROM email_suppression').n).toBe(0)
    expect(w.q("SELECT COUNT(*) AS n FROM email_outbox WHERE template = 'verify' AND sent_at IS NULL").n).toBe(1)
  })

  it('or mark verified: she can sign in and act, with the welcome mail queued and a private row', async () => {
    const w = await staged()
    const myra = await signIn(w.env, 'myra')
    expect((await act(myra, 'cy', 'mark_verified', 'confirmed by phone')).status).toBe(303)
    expect(w.q('SELECT email_verified_at FROM person WHERE id = ?', w.ids.cy).email_verified_at).toBe(iso(T0))
    expect(mails(w.db as any).filter(m => m.template === 'welcome').map(m => m.to_email)).toEqual(['cy@example.org'])
    expect(w.modRows()).toEqual([{ by_person: w.ids.myra, action: 'mark_verified', node_id: null, post_id: null, person_id: w.ids.cy, reason: 'confirmed by phone', public: 0 }])
    const cy = await signIn(w.env, 'cy')
    expect((await cy.get('/keys')).status).toBe(200)
  })
})

describe('the hourly cleanup', () => {
  it('still deletes an unverified account an admin acted on, keeping the log row', async () => {
    const w = await world()
    const r = await accountAct(w.db, { by: w.ids.myra, act: 'resend_verify', personId: w.ids.cy, reason: 'resent', once: 'cleanup-once-0123456789', origin: 'https://shwarm.org' })
    expect(r).toEqual({ ok: true })
    w.raw.prepare('UPDATE person SET created_at = ? WHERE id = ?').run(iso(T0 - 8 * 86_400_000), w.ids.cy)
    expect(await deleteUnverified(w.db, T0)).toBe(1)
    expect(w.modRows()).toEqual([{ by_person: w.ids.myra, action: 'resend_verify', node_id: null, post_id: null, person_id: null, reason: 'resent', public: 0 }])
  })
})
