// Go-live 10.2, terms versions: the banner a signed-in page shows while the person is behind the announced version,
// "i accept v<n>" (POST /terms/accept), announcing a bundled version from /admin/switches (the notice mail, the setting
// and a public log row in one batch), the terms_acceptance record, and the changelog the footer page carries.
// The bundle is mocked with a v0.2 so there is something to announce; the docs test reads the real terms.json.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAccount } from '../src/auth/close'
import { hashPassword } from '../src/auth/password'
import { parseSwitchReason } from '../src/core/switches'
import { latestTerms, NOTICE_PER_DAY, noticeStatement, termsDate, termsEntry } from '../src/core/terms'
import { readExport } from '../src/read/export'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { addPerson, T0 } from './d1'
import { stagingWorld } from './node-fixture'

vi.mock('../src/content/terms.json', () => ({
  default: [
    { version: '0.1', effective: '2026-10-08', changes: ['first beta draft.'] },
    { version: '0.2', effective: '2026-11-15', changes: ['terms: a notice period before changes.', 'privacy: what a report keeps.'] },
  ],
}))

const MIN = 60_000
const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

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

/** The staging-like world, @myra an admin; `signedIn` gives a browser signed in (password just entered). */
async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  w.db.raw.prepare('UPDATE person SET is_admin = 1, password_hash = ? WHERE id = ?').run(hash, w.myraId)
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
  const announce = (v: string) => w.db.raw.prepare("UPDATE setting SET value = ? WHERE key = 'terms_version'").run(JSON.stringify(v))
  const acceptances = (id: number) => all('SELECT version, accepted_at, how FROM terms_acceptance WHERE person_id = ? ORDER BY version', id)
  return { ...w, env, signedIn, get, all, announce, acceptances }
}

/** POSTs the banner's form from `path`, with that page's token unless one is given. */
async function accept(b: Browser, path: string, fields: Record<string, string> = {}) {
  const token = formTokenIn(await (await b.get(path)).text())
  return b.req('/terms/accept', { form: { form_token: token, version: '0.2', next: path, ...fields } })
}

describe('the terms banner', () => {
  it('shows to nobody signed out, and not to someone on the announced version', async () => {
    const w = await world()
    expect(await body(await new Browser(w.env).get('/terms'))).not.toContain('terms-due')
    const b = await w.signedIn('myra')
    const h = await body(await b.get('/keys'))
    expect(h).toContain('@myra')
    expect(h).not.toContain('terms-due')
  })

  it('shows once the setting moves on; "i accept" records it once and goes back', async () => {
    const w = await world()
    const b = await w.signedIn('myra')
    w.announce('0.2')
    const h = await body(await b.get('/keys'))
    expect(h).toContain('<div class="terms-due" role="region" aria-label="new terms">')
    expect(h).toContain('the terms and privacy notice change on nov 15, 2026 (v0.2).')
    expect(h).toContain('<a href="/terms#changelog">what changed</a>')
    expect(h).toContain('<button class="btn plain" type="submit">i accept v0.2</button>')
    expect(h).toContain('<input type="hidden" name="next" value="/keys"/>')
    // on the footer pages too
    expect(await body(await b.get('/terms'))).toContain('i accept v0.2')

    const res = await accept(b, '/keys')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/keys')
    expect(w.get('SELECT terms_version, terms_accepted_at FROM person WHERE id = ?', w.myraId)).toEqual({ terms_version: '0.2', terms_accepted_at: iso(T0) })
    expect(w.acceptances(w.myraId)).toEqual([{ version: '0.2', accepted_at: iso(T0), how: 'banner' }])
    expect(await body(await b.get('/keys'))).not.toContain('terms-due')

    // again (a second tab): nothing changes
    vi.setSystemTime(T0 + MIN)
    const token = formTokenIn(await (await b.get('/keys')).text())
    expect((await b.req('/terms/accept', { form: { form_token: token, version: '0.2', next: '/keys' } })).status).toBe(303)
    expect(w.get('SELECT terms_accepted_at FROM person WHERE id = ?', w.myraId).terms_accepted_at).toBe(iso(T0))
    expect(w.acceptances(w.myraId)).toHaveLength(1)
  })

  it('a version the setting has no bundle entry for shows without a date', async () => {
    const w = await world()
    const b = await w.signedIn('myra')
    w.announce('0.9')
    const h = await body(await b.get('/keys'))
    expect(h).toContain('the terms and privacy notice change (v0.9).')
    expect(h).toContain('i accept v0.9')
  })

  it('refuses a forged or missing token, and records nothing', async () => {
    const w = await world()
    const b = await w.signedIn('myra')
    w.announce('0.2')
    expect((await b.req('/terms/accept', { form: { form_token: 'nope', version: '0.2', next: '/keys' } })).status).toBe(403)
    expect((await b.req('/terms/accept', { form: { version: '0.2', next: '/keys' } })).status).toBe(403)
    // another site's form: the origin guard
    const token = formTokenIn(await (await b.get('/keys')).text())
    const cross = await b.req('/terms/accept', { form: { form_token: token, version: '0.2' }, headers: { origin: 'https://evil.example' } })
    expect(cross.status).toBe(403)
    expect(w.get('SELECT terms_version FROM person WHERE id = ?', w.myraId).terms_version).toBe('0.1')
    expect(w.acceptances(w.myraId)).toEqual([])
  })

  it('records nothing for a version that is no longer the announced one', async () => {
    const w = await world()
    const b = await w.signedIn('myra')
    w.announce('0.2')
    const res = await accept(b, '/keys', { version: '0.1' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/keys')
    expect(w.get('SELECT terms_version FROM person WHERE id = ?', w.myraId).terms_version).toBe('0.1')
    expect(w.acceptances(w.myraId)).toEqual([])
    expect(await body(await b.get('/keys'))).toContain('i accept v0.2')
  })

  it('goes back only on the site', async () => {
    const w = await world()
    const b = await w.signedIn('myra')
    w.announce('0.2')
    const res = await accept(b, '/keys', { next: '//evil.example/x' })
    expect(res.headers.get('location')).toBe('/')
    expect(w.acceptances(w.myraId)).toHaveLength(1)
  })

  it('signed out, it sends to sign in', async () => {
    const w = await world()
    w.announce('0.2')
    const out = new Browser(w.env)
    const token = await out.token()
    const res = await out.req('/terms/accept', { form: { form_token: token, version: '0.2', next: '/keys' } })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/^\/signin\?next=%2Fkeys/)
  })

  it('works while the site is read-only, and for an unverified account', async () => {
    const w = await world()
    w.db.raw.prepare("UPDATE setting SET value = 'true' WHERE key = 'read_only'").run()
    w.db.raw.prepare('UPDATE person SET email_verified_at = NULL WHERE id = ?').run(w.myraId)
    const b = await w.signedIn('myra')
    w.announce('0.2')
    const res = await accept(b, '/check-email')
    expect(res.status).toBe(303)
    expect(w.acceptances(w.myraId)).toEqual([{ version: '0.2', accepted_at: iso(T0), how: 'banner' }])
  })
})

describe('announcing a version on /admin/switches', () => {
  /** Active, verified, on v0.1: who gets the notice. Plus one of each kind who doesn't. */
  async function people(w: Awaited<ReturnType<typeof world>>) {
    const add = async (handle: string, set: string) => {
      const id = await addPerson(w.env.DB, handle)
      w.db.raw.prepare(`UPDATE person SET ${set} WHERE id = ?`).run(id)
      return id
    }
    const verified = `email_verified_at = '${iso(T0)}'`
    const on = await add('reader_one', verified)
    await add('suspended_one', `${verified}, status = 'suspended'`)
    await add('closed_one', `${verified}, status = 'closed'`)
    await add('unverified_one', 'founding = 0')
    await add('already_there', `${verified}, terms_version = '0.2'`)
    return { on }
  }
  const noticed = (w: Awaited<ReturnType<typeof world>>) =>
    w.all("SELECT id FROM person WHERE status = 'active' AND email_verified_at IS NOT NULL AND terms_version IS NOT '0.2' ORDER BY id").map((r: any) => r.id)

  async function send(b: Browser, reason: string, value = '0.2') {
    const token = formTokenIn(await (await b.get('/admin/switches')).text())
    return b.req('/admin/switches', { form: { form_token: token, key: 'terms_version', value, reason } })
  }

  it('shows the box: the version people have, the next one, and how many it mails', async () => {
    const w = await world()
    await people(w)
    const b = await w.signedIn('myra')
    const h = await body(await b.get('/admin/switches'))
    expect(h).toContain('terms version <span>· v0.1')
    expect(h).toContain('the newest version in this deploy is v0.2, in effect from nov 15, 2026.')
    expect(h).toContain(`announcing it emails ${noticed(w).length} accounts`)
    expect(h).toContain('<button class="btn" type="submit">announce v0.2</button>')
  })

  it('mails active verified accounts not on it, raises the setting and logs it publicly, in one go', async () => {
    const w = await world()
    const { on } = await people(w)
    const b = await w.signedIn('myra')
    const expected = noticed(w)
    expect(expected).toContain(on)

    let res = await send(b, '   ')
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('give a reason. it shows in the public log.')
    expect(w.all("SELECT id FROM email_outbox WHERE template = 'terms_notice'")).toEqual([])

    res = await send(b, 'a notice period and the report section')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/switches?done=terms_version#terms_version')
    expect(JSON.parse(w.get("SELECT value FROM setting WHERE key = 'terms_version'").value)).toBe('0.2')
    const logs = w.all("SELECT by_person, action, reason, public FROM moderation_action WHERE action = 'setting'")
    expect(logs).toEqual([{ by_person: w.myraId, action: 'setting', reason: 'terms_version="0.2": a notice period and the report section', public: 1 }])
    expect(parseSwitchReason(logs[0].reason)).toEqual({ key: 'terms_version', value: '0.2', reason: 'a notice period and the report section' })

    const mail = w.all("SELECT to_email, person_id, stream, payload, created_at, send_after FROM email_outbox WHERE template = 'terms_notice' ORDER BY person_id")
    expect(mail.map((m: any) => m.person_id)).toEqual(expected)
    for (const m of mail) {
      expect(m).toMatchObject({ stream: 'account', created_at: iso(T0), send_after: iso(T0) })
      const p = JSON.parse(m.payload)
      expect(p).toMatchObject({ version: '0.2', effective: '2026-11-15', changes: termsEntry('0.2')!.changes, link: '/terms#changelog' })
      expect(p.handle).toMatch(/^[a-z0-9_]+$/)
    }
    expect(mail.find((m: any) => m.person_id === on)).toMatchObject({ to_email: 'reader_one@example.org' })

    expect(await body(await b.get('/admin/switches?done=terms_version'))).toContain("terms version is now v0.2. it's in the public log.")
    expect(await body(await new Browser(w.env).get('/moderation'))).toContain('terms version: v0.2')
    // the admin is behind now too
    expect(await body(await b.get('/admin/switches'))).toContain('i accept v0.2')

    // sent again: refused (not newer), and no more mail or log rows
    res = await send(b, 'again')
    expect(res.status).toBe(400)
    expect(await body(res)).toContain("v0.2 isn't newer than v0.2")
    expect(w.all("SELECT id FROM email_outbox WHERE template = 'terms_notice'")).toHaveLength(expected.length)
    expect(w.all("SELECT id FROM moderation_action WHERE action = 'setting'")).toHaveLength(1)
    // and the guard, for two forms that both passed the check at once
    await noticeStatement(w.env.DB, latestTerms(), iso(T0)).run()
    expect(w.all("SELECT id FROM email_outbox WHERE template = 'terms_notice'")).toHaveLength(expected.length)
  })

  it(`staggers the mail ${NOTICE_PER_DAY} a day`, async () => {
    const w = await world()
    for (let i = 0; i < NOTICE_PER_DAY + 5; i++) {
      const id = await addPerson(w.env.DB, `reader_${i}`)
      w.db.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(iso(T0), id)
    }
    const b = await w.signedIn('myra')
    const n = noticed(w).length
    expect(n).toBeGreaterThan(NOTICE_PER_DAY)
    expect(n).toBeLessThanOrEqual(2 * NOTICE_PER_DAY)
    expect(await body(await b.get('/admin/switches'))).toContain(`announcing it emails ${n} accounts over 2 days`)
    expect((await send(b, 'big list')).status).toBe(303)
    const rows = w.all("SELECT person_id, send_after FROM email_outbox WHERE template = 'terms_notice' ORDER BY person_id")
    expect(rows).toHaveLength(n)
    expect(rows.slice(0, NOTICE_PER_DAY).every((r: any) => r.send_after === iso(T0))).toBe(true)
    expect(rows.slice(NOTICE_PER_DAY).every((r: any) => r.send_after === iso(T0 + DAY))).toBe(true)
  })

  it('refuses a version that takes effect too soon, or one this deploy lacks', async () => {
    const w = await world()
    vi.setSystemTime(Date.parse('2026-10-20T12:00:00Z')) // 25 days before nov 15
    const b = await w.signedIn('myra')
    let res = await send(b, 'too soon')
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('v0.2 takes effect on nov 15, 2026, less than 30 days away. move its date in scripts/pages/content.py, export and deploy.')
    res = await send(b, 'not bundled', '0.3')
    expect(res.status).toBe(400)
    expect(await body(res)).toContain("v0.3 isn't in this deploy.")
    expect(JSON.parse(w.get("SELECT value FROM setting WHERE key = 'terms_version'").value)).toBe('0.1')
    expect(w.all("SELECT id FROM email_outbox WHERE template = 'terms_notice'")).toEqual([])
    expect(w.all("SELECT id FROM moderation_action WHERE action = 'setting'")).toEqual([])
  })

  it('is a plain 404 for anyone but an admin', async () => {
    const w = await world()
    const b = await w.signedIn('tester_one')
    const token = formTokenIn(await (await b.get('/signin')).text())
    expect((await b.req('/admin/switches', { form: { form_token: token, key: 'terms_version', value: '0.2', reason: 'x' } })).status).toBe(404)
    expect(JSON.parse(w.get("SELECT value FROM setting WHERE key = 'terms_version'").value)).toBe('0.1')
    expect(w.all("SELECT id FROM email_outbox WHERE template = 'terms_notice'")).toEqual([])
  })

  it('closing an account drops its pending notice; its acceptances stay and are in the export', async () => {
    const w = await world()
    const { on } = await people(w)
    w.db.raw.prepare("INSERT INTO terms_acceptance (person_id, version, accepted_at, how) VALUES (?, '0.1', ?, 'signup')").run(on, iso(T0))
    const b = await w.signedIn('myra')
    expect((await send(b, 'new terms')).status).toBe(303)
    expect(w.all("SELECT id FROM email_outbox WHERE template = 'terms_notice' AND person_id = ?", on)).toHaveLength(1)
    expect((await readExport(w.env.DB, on))!.terms_acceptances).toEqual([{ version: '0.1', accepted_at: iso(T0), how: 'signup' }])
    await closeAccount(w.env.DB, on, T0 + MIN)
    expect(w.all("SELECT id FROM email_outbox WHERE template = 'terms_notice' AND person_id = ? AND sent_at IS NULL", on)).toEqual([])
    expect(w.acceptances(on)).toEqual([{ version: '0.1', accepted_at: iso(T0), how: 'signup' }])
  })
})

describe('the terms_acceptance table (0025)', () => {
  it('fills from person, and goes with an unverified account that is deleted', async () => {
    const mod = 'node:sqlite'
    const { DatabaseSync } = (await import(/* @vite-ignore */ mod)) as any
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    const dir = new URL('../migrations/', import.meta.url)
    const { readdirSync } = await import('node:fs')
    const files = readdirSync(dir).filter((f: string) => f.endsWith('.sql')).sort()
    for (const f of files.filter((f: string) => f < '0025')) db.exec(readFileSync(new URL(f, dir), 'utf8'))
    const ins = db.prepare(
      `INSERT INTO person (handle, email, email_norm, password_hash, terms_version, terms_accepted_at, age_confirmed_at, created_at) VALUES (?, ?, ?, 'x', '0.1', ?, ?, ?)`,
    )
    const a = Number(ins.run('one', 'one@example.org', 'one@example.org', iso(T0), iso(T0), iso(T0)).lastInsertRowid)
    const z = Number(ins.run('two', 'two@example.org', 'two@example.org', iso(T0 + DAY), iso(T0), iso(T0)).lastInsertRowid)
    for (const f of files.filter((f: string) => f >= '0025')) db.exec(readFileSync(new URL(f, dir), 'utf8'))
    expect(db.prepare('SELECT person_id, version, accepted_at, how FROM terms_acceptance ORDER BY person_id').all().map((r: any) => ({ ...r }))).toEqual([
      { person_id: a, version: '0.1', accepted_at: iso(T0), how: 'signup' },
      { person_id: z, version: '0.1', accepted_at: iso(T0 + DAY), how: 'signup' },
    ])
    db.prepare('DELETE FROM person WHERE id = ?').run(z)
    expect(db.prepare('SELECT person_id FROM terms_acceptance').all().map((r: any) => r.person_id)).toEqual([a])
    expect(() => db.prepare("INSERT INTO terms_acceptance VALUES (?, '0.2', ?, 'email')").run(a, iso(T0))).toThrow()
  })
})

describe('the changelog on /terms', () => {
  // The real bundle and pages, not the mock: a stale export would leave them out of step.
  const real: { version: string; effective: string; changes: string[] }[] = JSON.parse(readFileSync(new URL('../src/content/terms.json', import.meta.url), 'utf8'))
  const pages: { slug: string; lede: string; sections: { id: string; body: string }[] }[] = JSON.parse(readFileSync(new URL('../src/content/pages.json', import.meta.url), 'utf8'))
  const terms = pages.find(p => p.slug === 'terms')!

  it('has a changelog section listing every version, newest first', () => {
    const log = terms.sections.find(s => s.id === 'changelog')!
    expect(log).toBeTruthy()
    const shown = [...log.body.matchAll(/<b>v([0-9.]+)<\/b> · in effect from ([a-z]{3} \d{1,2}, \d{4})/g)].map(m => [m[1], m[2]])
    expect(shown).toEqual([...real].reverse().map(v => [v.version, termsDate(v.effective)]))
    for (const v of real) for (const c of v.changes) expect(log.body).toContain(`<li>${c}</li>`)
  })

  it('names the newest version and its date in the lede', () => {
    const last = real[real.length - 1]
    expect(terms.lede).toContain(`v${last.version}</b> · in effect from ${termsDate(last.effective)}`)
  })
})
