// Go-live 13.3, the opening mail: the opening box on /admin/switches sends the one "shwarm is open" mail to every active,
// verified account on signup_wait with no mailed_at, marks those rows mailed and writes one public log row, in one
// batch. It refuses while sign-up is allow-list only or the site mode isn't open, sends once when the form goes twice,
// and paces the mail OPENING_PER_DAY a day.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { modLog } from '../src/core/moderation'
import { openingMailStatement, openingMarkStatement, OPENING_PAYLOAD, OPENING_PER_DAY, stillWaiting } from '../src/core/opening'
import { parseSwitchReason, switchReason } from '../src/core/switches'
import { MailRenderError, renderMail } from '../src/email/templates'
import { sweepOutbox } from '../src/jobs/mail'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { addPerson, T0, testDb } from './d1'
import { stagingWorld } from './node-fixture'

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const SITE = 'https://shwarm.org'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
  forgetVersions()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** The staging-like world, @myra an admin, the site mode open and sign-up as given. */
async function world(o: { signup?: 'open' | 'allow_list'; mode?: string } = {}) {
  const w = await stagingWorld()
  const env = { ...testEnv(w.db), SITE_MODE: o.mode ?? 'open' }
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  w.db.raw.prepare('UPDATE person SET is_admin = 1, password_hash = ? WHERE id = ?').run(hash, w.myraId)
  w.db.raw
    .prepare("INSERT INTO setting (key, value, updated_at) VALUES ('signup', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(o.signup ?? 'open'), iso(T0))
  const signedIn = async (handle: string) => {
    if (handle !== 'myra') {
      const id = await addPerson(env.DB, handle, { hash })
      w.db.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(iso(T0), id)
    }
    const b = new Browser(env)
    expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
    return b
  }
  const get = (sql: string, ...a: unknown[]) => w.db.raw.prepare(sql).get(...a)
  const all = (sql: string, ...a: unknown[]) => w.db.raw.prepare(sql).all(...a).map((r: any) => ({ ...r }))
  /** An account on signup_wait: verified unless said, `set` more SQL on the person row, `mailed` a mailed_at. */
  const waiting = async (handle: string, o: { verified?: boolean; set?: string; mailed?: string; wait?: boolean } = {}) => {
    const id = await addPerson(env.DB, handle)
    if (o.verified !== false) w.db.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(iso(T0), id)
    if (o.set) w.db.raw.prepare(`UPDATE person SET ${o.set} WHERE id = ?`).run(id)
    if (o.wait !== false) w.db.raw.prepare('INSERT INTO signup_wait (person_id, joined_at, mailed_at) VALUES (?, ?, ?)').run(id, iso(T0 - DAY), o.mailed ?? null)
    return id
  }
  const mails = () => all("SELECT to_email, person_id, stream, payload, created_at, send_after FROM email_outbox WHERE template = 'opening_notice' ORDER BY person_id")
  const logs = () => all("SELECT by_person, action, reason, public FROM moderation_action WHERE action = 'setting'")
  return { ...w, env, signedIn, get, all, waiting, mails, logs }
}

async function send(b: Browser, reason: string) {
  const token = formTokenIn(await (await b.get('/admin/switches')).text())
  return b.req('/admin/switches', { form: { form_token: token, key: 'opening_mail', reason } })
}

describe('the opening mail template (opening_notice)', () => {
  const ctx = { siteUrl: SITE, stream: 'account' as const }
  const payload = { handle: 'reader_one', ...OPENING_PAYLOAD }

  it('says shwarm is open, links sign-in and the feed, lowercase, on the account stream', () => {
    const m = renderMail('opening_notice', payload, ctx)
    expect(m.subject).toBe('shwarm is open')
    expect(m.text).toContain('hi @reader_one,')
    expect(m.text).toContain("shwarm is open to everyone now. you signed up while it was invite-only, and we said we'd email you when it opened.")
    expect(m.text).toContain(`sign in here:\n\n${SITE}/signin`)
    expect(m.text).toContain(`then find a shwarm to join:\n\n${SITE}/`)
    expect(m.html).toContain(`<a href="${SITE}/signin">`)
    expect(m.html).toContain(`<a href="${SITE}/">`)
    expect(m.text).not.toContain('turn them off')
    expect(m.text.replace(/https:\S+/g, '')).toBe(m.text.replace(/https:\S+/g, '').toLowerCase())
    expect(m.text + m.html).not.toMatch(/[—–]/)
  })

  it('refuses a payload without its links, or with links off the site', () => {
    for (const p of [{ link: undefined }, { feed: undefined }, { link: 'https://evil.example/signin' }, { feed: '//evil.example/' }])
      expect(() => renderMail('opening_notice', { ...payload, ...p }, ctx)).toThrow(MailRenderError)
  })

  it('is sent by the sweep on production', async () => {
    const e = { DB: testDb(), ENV: 'production', SITE_URL: SITE, RESEND_API_KEY: 're_key', MAIL_SECRET: 'mail-secret' } as any
    const id = await addPerson(e.DB, 'reader_one')
    e.DB.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(iso(T0), id)
    e.DB.raw.prepare('INSERT INTO signup_wait (person_id, joined_at) VALUES (?, ?)').run(id, iso(T0))
    e.DB.raw.prepare("INSERT INTO setting (key, value, updated_at) VALUES ('signup', '\"open\"', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(iso(T0))
    await e.DB.batch([openingMailStatement(e.DB, iso(T0)), openingMarkStatement(e.DB, iso(T0))])
    const sent: any[] = []
    const f = (async (_url: string, init: RequestInit) => (sent.push(JSON.parse(String(init.body))), new Response('{"id":"re_1"}', { status: 200 }))) as unknown as typeof fetch
    expect(await sweepOutbox(e, { now: T0, fetch: f })).toMatchObject({ sent: 1 })
    expect(sent.map(s => [s.to, s.subject])).toEqual([[['reader_one@example.org'], 'shwarm is open']])
  })
})

describe('the opening box on /admin/switches (go-live 13.3)', () => {
  it('mails only active, verified waiting accounts without mailed_at, marks them, and logs it publicly', async () => {
    const w = await world()
    const ok = await w.waiting('waiting_one')
    const ok2 = await w.waiting('waiting_two')
    const unverified = await w.waiting('waiting_unverified', { verified: false })
    const suspended = await w.waiting('waiting_suspended', { set: "status = 'suspended'" })
    const closed = await w.waiting('waiting_closed', { set: "status = 'closed'" })
    const mailed = await w.waiting('waiting_mailed', { mailed: iso(T0 - DAY) })
    await w.waiting('not_waiting', { wait: false })
    const b = await w.signedIn('myra')

    const h = await body(await b.get('/admin/switches'))
    expect(h).toContain('opening mail <span>· 2 waiting')
    expect(h).toContain('sending it emails 2 accounts.')
    expect(h).toContain('<button class="btn" type="submit">send the opening mail</button>')

    let res = await send(b, '  ')
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('give a reason. it shows in the public log.')
    expect(w.mails()).toEqual([])

    res = await send(b, 'shwarm opened today')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/switches?done=opening_mail#opening_mail')

    const mail = w.mails()
    expect(mail.map((m: any) => m.person_id)).toEqual([ok, ok2])
    for (const m of mail) {
      expect(m).toMatchObject({ stream: 'account', created_at: iso(T0), send_after: iso(T0) })
      expect(JSON.parse(m.payload)).toEqual({ ...OPENING_PAYLOAD, handle: m.to_email.split('@')[0] })
    }
    const marks = Object.fromEntries(w.all('SELECT person_id, mailed_at FROM signup_wait').map((r: any) => [r.person_id, r.mailed_at]))
    expect(marks).toEqual({ [ok]: iso(T0), [ok2]: iso(T0), [unverified]: null, [suspended]: null, [closed]: null, [mailed]: iso(T0 - DAY) })

    const logs = w.logs()
    expect(logs).toEqual([{ by_person: w.myraId, action: 'setting', reason: 'opening_mail="2": shwarm opened today', public: 1 }])
    expect(parseSwitchReason(logs[0].reason)).toEqual({ key: 'opening_mail', value: '2', reason: 'shwarm opened today' })
    expect(await body(await new Browser(w.env).get('/moderation'))).toContain('the opening mail: queued for 2 accounts')

    const after = await body(await b.get('/admin/switches?done=opening_mail'))
    expect(after).toContain(`the opening mail is queued, ${OPENING_PER_DAY} a day. it's in the public log.`)
    expect(after).toContain('opening mail <span>· 0 waiting')
    expect(after).toContain('nobody is waiting for it.')
    expect(after).not.toContain('send the opening mail</button>')

    // one who verifies later is still waiting, and gets it on the next send
    w.db.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(iso(T0), unverified)
    expect((await send(b, 'one more verified')).status).toBe(303)
    expect(w.mails().map((m: any) => m.person_id)).toEqual([ok, ok2, unverified])
  })

  it('is refused while sign-up is allow-list only, or the site mode is not open', async () => {
    for (const [o, text] of [
      [{ signup: 'allow_list' }, 'sign-up is still allow-list only.'],
      [{ mode: 'beta' }, 'the site is in beta mode. it goes once the site mode is open.'],
      [{ mode: 'holding' }, 'the site is in holding mode.'],
    ] as const) {
      const w = await world(o)
      await w.waiting('waiting_one')
      const b = await w.signedIn('myra')
      const h = await body(await b.get('/admin/switches'))
      expect(h).toContain(text)
      expect(h).not.toContain('send the opening mail</button>')
      const res = await send(b, 'too early')
      expect(res.status).toBe(400)
      expect(await body(res)).toContain(text)
      expect(w.mails()).toEqual([])
      expect(w.all('SELECT mailed_at FROM signup_wait')).toEqual([{ mailed_at: null }])
      expect(w.logs()).toEqual([])
    }
  })

  it('the batch itself does nothing while sign-up is allow-list only', async () => {
    const w = await world({ signup: 'allow_list' })
    await w.waiting('waiting_one')
    const at = iso(T0)
    await w.env.DB.batch([
      openingMailStatement(w.env.DB, at),
      modLog(w.env.DB, { by: w.myraId, action: 'setting', reason: switchReason('opening_mail', '1', 'x'), public: true, at }, stillWaiting()),
      openingMarkStatement(w.env.DB, at),
    ])
    expect(w.mails()).toEqual([])
    expect(w.logs()).toEqual([])
    expect(w.all('SELECT mailed_at FROM signup_wait')).toEqual([{ mailed_at: null }])
  })

  it('sends once when the form goes twice', async () => {
    const w = await world()
    await w.waiting('waiting_one')
    await w.waiting('waiting_two')
    const b = await w.signedIn('myra')
    // two forms loaded before either was sent
    const t1 = formTokenIn(await (await b.get('/admin/switches')).text())
    const t2 = formTokenIn(await (await b.get('/admin/switches')).text())
    expect((await b.req('/admin/switches', { form: { form_token: t1, key: 'opening_mail', reason: 'open' } })).status).toBe(303)
    const again = await b.req('/admin/switches', { form: { form_token: t2, key: 'opening_mail', reason: 'open' } })
    expect(again.status).toBe(400)
    expect(await body(again)).toContain('nobody is waiting for it.')
    expect(w.mails()).toHaveLength(2)
    expect(w.logs()).toHaveLength(1)
    // and the guard, for two forms that both passed the check at once
    const at = iso(T0 + 1000)
    await w.env.DB.batch([
      openingMailStatement(w.env.DB, at),
      modLog(w.env.DB, { by: w.myraId, action: 'setting', reason: switchReason('opening_mail', '2', 'open'), public: true, at }, stillWaiting()),
      openingMarkStatement(w.env.DB, at),
    ])
    expect(w.mails()).toHaveLength(2)
    expect(w.logs()).toHaveLength(1)
    expect(w.all('SELECT mailed_at FROM signup_wait').every((r: any) => r.mailed_at === iso(T0))).toBe(true)
  })

  it(`paces the mail ${OPENING_PER_DAY} a day`, async () => {
    const w = await world()
    for (let i = 0; i < OPENING_PER_DAY + 5; i++) await w.waiting(`waiting_${i}`)
    const b = await w.signedIn('myra')
    expect(await body(await b.get('/admin/switches'))).toContain(`sending it emails ${OPENING_PER_DAY + 5} accounts over 2 days, ${OPENING_PER_DAY} a day.`)
    expect((await send(b, 'big list')).status).toBe(303)
    const rows = w.mails()
    expect(rows).toHaveLength(OPENING_PER_DAY + 5)
    expect(rows.slice(0, OPENING_PER_DAY).every((r: any) => r.send_after === iso(T0))).toBe(true)
    expect(rows.slice(OPENING_PER_DAY).every((r: any) => r.send_after === iso(T0 + DAY))).toBe(true)
    expect(w.all('SELECT person_id FROM signup_wait WHERE mailed_at IS NULL')).toEqual([])
  })

  it('is a plain 404 for anyone but an admin', async () => {
    const w = await world()
    await w.waiting('waiting_one')
    const b = await w.signedIn('tester_one')
    const token = formTokenIn(await (await b.get('/signin')).text())
    expect((await b.req('/admin/switches', { form: { form_token: token, key: 'opening_mail', reason: 'x' } })).status).toBe(404)
    expect(w.mails()).toEqual([])
    expect(w.all('SELECT mailed_at FROM signup_wait')).toEqual([{ mailed_at: null }])
  })
})
