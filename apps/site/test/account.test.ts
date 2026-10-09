// Go-live 6.2: the account modal, end to end through the site as a browser would use it (no script: every form posts).
// Only the owner sees it; saving and the password change confirm with the password (inline, as the sign-off does);
// an email change keeps the old address until the new one is confirmed and warns the old one; a password change ends
// every other session and sends the "password changed" mail; "sign out everywhere" ends every session.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanLink } from '../src/auth/account'
import { hashPassword } from '../src/auth/password'
import { readSession } from '../src/auth/session'
import { groupOn, inboxEvery, nextPrefs, NOTICE_GROUPS, noticeOn } from '../src/email/notices'
import { sweepOutbox } from '../src/jobs/mail'
import { resetReadLimit } from '../src/web/read-limit'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, linkIn, mails, pepper, testEnv, type TestEnv } from './browser'

const MIN = 60_000
const NEW_PASSWORD = 'quiet brown owls by the river'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch(['password1234']))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** A verified member with GOOD_PASSWORD at handle@example.org. */
async function member(env: TestEnv, handle: string) {
  const id = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
  env.DB.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(new Date(T0).toISOString(), id)
  return id
}

async function signIn(env: TestEnv, email: string, password = GOOD_PASSWORD, ip = '203.0.113.9') {
  const b = new Browser(env, ip)
  const res = await b.post('/signin', { email, password })
  expect(res.status).toBe(303)
  expect(res.headers.get('location')).not.toContain('/signin')
  return b
}

/** Whether this email and password sign in (from a fresh browser on another network, so throttles don't mix). */
async function canSignIn(env: TestEnv, email: string, password: string) {
  const b = new Browser(env, '198.51.100.40')
  const res = await b.post('/signin', { email, password })
  return res.status === 303 && !!b.jar.get('__Host-shwarm')
}

const get = (env: TestEnv, sql: string, ...args: unknown[]): any => env.DB.raw.prepare(sql).get(...args)
const sessionsOf = (env: TestEnv, id: number) => get(env, 'SELECT COUNT(*) AS n FROM session WHERE person_id = ?', id).n as number

/** The modal's save form as the page sends it: every field, with these changes. */
const saveForm = (handle: string, changes: Record<string, string | undefined> = {}) => {
  const f: Record<string, string | undefined> = { do: 'account', display_name: '', about: '', website: '', code: '', email: `${handle}@example.org`, n_inbox: '1', inbox_every: 'digest', ...changes }
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Record<string, string>
}

/** Sends one of the modal's forms from the owner's profile, with the form token from the page. */
async function acct(b: Browser, handle: string, form: Record<string, string>) {
  const token = formTokenIn(await (await b.get(`/@${handle}?account=1`)).text())
  return b.req(`/@${handle}`, { form: { form_token: token, ...form } })
}

/** The modal's markup on a page, or null. */
const modalIn = (html: string) => {
  const i = html.indexOf('<div class="scrim" id="ascrim"')
  return i < 0 ? null : html.slice(i, html.indexOf('<div class="dn-scrim"', i))
}

describe('the account modal (6.2)', () => {
  it('shows only to the owner: the button, and the modal open at ?account=1 without script', async () => {
    const env = testEnv()
    await member(env, 'myra')
    await member(env, 'ana')
    const myra = await signIn(env, 'myra@example.org')
    const closed = await body(await myra.get('/@myra'))
    expect(closed).toContain('<a class="acct" id="acct" href="/@myra?account=1" aria-haspopup="dialog">account</a>')
    expect(modalIn(closed)).toContain('<div class="scrim" id="ascrim" hidden="">')
    expect(closed).toContain('<script src="/js/account.js" defer=""></script>')

    const open = modalIn(await body(await myra.get('/@myra?account=1')))!
    expect(open).toContain('<div class="scrim" id="ascrim">')
    expect(open).toContain('<div class="modal" role="dialog" aria-modal="true" aria-labelledby="atitle">')
    expect(open).toContain('<a href="/@myra" id="aclose" aria-label="close">×</a>')
    expect(open).toContain('<dt>handle</dt><dd>@myra</dd>')
    expect(open).toContain('<dt>joined</dt><dd>oct 8, 2026</dd>')
    expect(open).toContain('value="myra@example.org"')
    expect(open).toContain('<b class="ev">✓ verified</b>')
    expect(open).toContain('password · last changed oct 8, 2026')
    expect(open).toContain('saving confirms with your password.')
    // signed in just now: the password was entered, so the forms don't ask for it again
    expect(open).not.toContain('name="password"')
    expect(open).toContain('<option value="digest" selected="">daily digest</option>')
    expect(open).toMatch(/id="n-inbox" name="n_inbox" value="1" form="acct-save" checked=""/)
    expect(open).not.toMatch(/id="n-pass_fail"[^>]*checked/)
    expect(open).toContain('<input type="checkbox" id="n-key" checked="" disabled=""/>')

    // Nobody else: not @ana, not signed out, not even with ?account=1. The address never shows to them.
    const ana = await signIn(env, 'ana@example.org', GOOD_PASSWORD, '198.51.100.2')
    for (const b of [ana, new Browser(env)]) {
      const html = await body(await b.get('/@myra?account=1'))
      expect(html).toContain('<h1 class="path">@myra</h1>')
      for (const s of ['id="ascrim"', 'class="acct"', 'myra@example.org', 'account.js']) expect(html).not.toContain(s)
    }
    // @ana's own profile has her own modal, not @myra's
    expect(await body(await ana.get('/@ana'))).toContain('href="/@ana?account=1"')
  })

  it('saves the about line, display name, links and notices behind the password, and keeps the draft when refused', async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    const b = await signIn(env, 'myra@example.org')
    // inside the step-up window: saved with no password asked
    let res = await acct(b, 'myra', saveForm('myra', { display_name: 'Myra K', about: 'product designer who also ships the things i make.', website: 'myrakrusemark.com', code: 'https://codeberg.org/myra' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/@myra?account=saved')
    let p = get(env, 'SELECT display_name, about, links FROM person WHERE id = ?', id)
    expect(p).toMatchObject({ display_name: 'Myra K', about: 'product designer who also ships the things i make.' })
    expect(JSON.parse(p.links)).toEqual([{ label: 'website', url: 'https://myrakrusemark.com' }, { label: 'code', url: 'https://codeberg.org/myra' }])
    expect(modalIn(await body(await b.get('/@myra?account=saved')))).toContain('<p class="astatus" role="status">saved.</p>')
    // shown to everyone on the profile
    const pub = await body(await new Browser(env).get('/@myra'))
    expect(pub).toContain('Myra K')
    expect(pub).toContain('<p class="about">product designer who also ships the things i make.</p>')
    expect(pub).toContain('href="https://myrakrusemark.com/"')

    // eleven minutes on, the window is closed: the save asks for the password inline
    vi.setSystemTime(T0 + 11 * MIN)
    const page = modalIn(await body(await b.get('/@myra?account=1')))!
    expect(page).toContain('<input id="pw-save" type="password" name="password" autocomplete="current-password" required="" maxlength="1024" form="acct-save"/>')
    expect(page).toContain('<input id="pw-change" type="password" name="password"')
    const draft = { about: 'a new about line', website: 'example.org/me' }
    res = await acct(b, 'myra', saveForm('myra', draft))
    expect(res.status).toBe(400)
    let html = modalIn(await body(res))!
    expect(html).toContain('<div class="scrim" id="ascrim">') // open, with the reason and the draft
    expect(html).toContain('<p class="err" role="alert">enter your password to confirm.</p>')
    expect(html).toContain('>a new about line</textarea>')
    expect(html).toContain('value="example.org/me"')
    res = await acct(b, 'myra', saveForm('myra', { ...draft, password: 'not my password' }))
    expect(res.status).toBe(400)
    html = modalIn(await body(res))!
    expect(html).toContain("that password doesn't match.")
    expect(html).not.toContain('not my password')
    expect(get(env, 'SELECT about FROM person WHERE id = ?', id).about).toBe('product designer who also ships the things i make.')

    // a mistake in the form is shown at its field before the password is checked, so the password isn't spent
    res = await acct(b, 'myra', saveForm('myra', { about: 'x'.repeat(161), website: 'not a link', display_name: 'y'.repeat(51), password: GOOD_PASSWORD }))
    expect(res.status).toBe(400)
    html = modalIn(await body(res))!
    expect(html).toContain('keep it to 160 characters.')
    expect(html).toContain('keep it to 50 characters.')
    expect(html).toContain("that doesn't look like a link.")
    expect(html).toContain('<input id="pw-save"') // still asked: the window didn't open
    expect(get(env, 'SELECT step_up_until FROM session WHERE person_id = ?', id).step_up_until).toBe(new Date(T0 + 10 * MIN).toISOString())

    res = await acct(b, 'myra', saveForm('myra', { ...draft, password: GOOD_PASSWORD }))
    expect(res.status).toBe(303)
    p = get(env, 'SELECT about, links FROM person WHERE id = ?', id)
    expect(p.about).toBe('a new about line')
    expect(JSON.parse(p.links)).toEqual([{ label: 'website', url: 'https://example.org/me' }])
    // the window is open again for 10 minutes
    expect(modalIn(await body(await b.get('/@myra?account=1')))).not.toContain('name="password" autocomplete="current-password"')
  })

  it('notice settings: groups of types, defaults, and a save that leaves a mail-unsubscribed type alone', async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    const b = await signIn(env, 'myra@example.org')
    const prefs = () => JSON.parse(get(env, 'SELECT notice_prefs FROM person WHERE id = ?', id).notice_prefs)

    // untick "new in your inbox", tick passes or fails, right away
    expect((await acct(b, 'myra', saveForm('myra', { n_inbox: undefined, n_pass_fail: '1', inbox_every: 'now' }))).status).toBe(303)
    expect(prefs()).toEqual({ mention: false, sign_off: false, kickoff: false, pass_fail: true, inbox_every: 'now' })
    let html = modalIn(await body(await b.get('/@myra?account=1')))!
    expect(html).not.toMatch(/id="n-inbox"[^>]*checked/)
    expect(html).toMatch(/id="n-pass_fail"[^>]*checked/)
    expect(html).toContain('<option value="now" selected="">right away</option>')

    // a one-click unsubscribe from a sign-off mail turned sign_off off only; the box shows unticked, and saving the
    // modal without touching it leaves mentions as they were
    env.DB.raw.prepare('UPDATE person SET notice_prefs = ? WHERE id = ?').run(JSON.stringify({ sign_off: false }), id)
    html = modalIn(await body(await b.get('/@myra?account=1')))!
    expect(html).not.toMatch(/id="n-inbox"[^>]*checked/)
    expect((await acct(b, 'myra', saveForm('myra', { n_inbox: undefined, inbox_every: 'bogus' }))).status).toBe(303)
    expect(prefs()).toEqual({ sign_off: false })
    // ticking it turns the whole group on
    expect((await acct(b, 'myra', saveForm('myra'))).status).toBe(303)
    expect(prefs()).toEqual({ sign_off: true, mention: true, kickoff: true, inbox_every: 'digest' })
  })

  it('the notices module: defaults, groups and the sweep honouring them', async () => {
    expect(noticeOn({}, 'sign_off')).toBe(true)
    expect(noticeOn({}, 'mention')).toBe(true)
    expect(noticeOn({}, 'pass_fail')).toBe(false)
    expect(noticeOn({}, 'lobby_filled')).toBe(true) // a type with no group is on until turned off
    expect(noticeOn({ pass_fail: true }, 'pass_fail')).toBe(true)
    expect(groupOn({ mention: false }, NOTICE_GROUPS[0])).toBe(false)
    expect(inboxEvery({})).toBe('digest')
    expect(inboxEvery({ inbox_every: 'now' })).toBe('now')
    expect(nextPrefs({ mention: false }, { inbox: false, pass_fail: false }, undefined)).toEqual({ mention: false })

    // the sweep skips a notice whose type is off by default and was never turned on
    const env = testEnv()
    const id = await member(env, 'myra')
    env.DB.raw.prepare("INSERT INTO signup_allow (email_norm, note, added_at) VALUES ('myra@example.org', 'test', ?)").run(new Date(T0).toISOString())
    env.DB.raw
      .prepare("INSERT INTO email_outbox (to_email, person_id, template, stream, payload, created_at, send_after) VALUES ('myra@example.org', ?, 'sign_off_ready', 'notices', ?, ?, ?)")
      .run(id, JSON.stringify({ notice: 'pass_fail', number: 1, title: 'x', link: '/w/x/s/1' }), new Date(T0).toISOString(), new Date(T0).toISOString())
    const out = await sweepOutbox({ DB: env.DB, ENV: 'test', SITE_URL: 'https://shwarm.org', RESEND_API_KEY: 're_test', MAIL_SECRET: 'm' } as any, { now: T0, fetch: (async () => Response.json({ id: 'x' })) as any })
    expect(out.skipped).toBe(1)
    expect(get(env, 'SELECT last_error FROM email_outbox').last_error).toBe('skipped: turned off pass_fail notices')
  })

  it('links: only http(s) addresses the pages would link', () => {
    expect(cleanLink('myrakrusemark.com')).toEqual({ url: 'https://myrakrusemark.com' })
    expect(cleanLink(' http://example.org/x ')).toEqual({ url: 'http://example.org/x' })
    expect(cleanLink('')).toEqual({ url: null })
    for (const bad of ['javascript:alert(1)', 'ftp://example.org', 'https://google.com@evil.example/', 'localhost', 'two words.com', 'x'.repeat(200) + '.com'])
      expect(cleanLink(bad), bad).toHaveProperty('error')
  })
})

describe('email change (6.2)', () => {
  it('keeps the old address until the new one is confirmed, warns the old one, and survives a link scanner', async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    const b = await signIn(env, 'myra@example.org')
    const res = await acct(b, 'myra', saveForm('myra', { email: 'Myra@New.example' }))
    expect(res.status).toBe(303)

    // two mails: the link to the new address, a warning (security mail) to the old one
    const sent = mails(env.DB).filter(m => m.template.startsWith('email_change'))
    expect(sent.map(m => [m.template, m.to_email, m.stream])).toEqual([
      ['email_change_old', 'myra@example.org', 'security'],
      ['email_change_new', 'myra@new.example', 'account'],
    ])
    // nothing changed on the account yet: the old address signs in, the new one doesn't
    expect(get(env, 'SELECT email, email_norm FROM person WHERE id = ?', id)).toEqual({ email: 'myra@example.org', email_norm: 'myra@example.org' })
    expect(await canSignIn(env, 'myra@new.example', GOOD_PASSWORD)).toBe(false)
    expect(await canSignIn(env, 'myra@example.org', GOOD_PASSWORD)).toBe(true)
    const modal = modalIn(await body(await b.get('/@myra?account=1')))!
    expect(modal).toContain('a link went to <b>myra@new.example</b>. until it\'s clicked, myra@example.org stays on your account.')
    expect(modal).toContain('value="myra@example.org"')

    // a mail scanner fetches the link: the page shows, the token stays usable
    const link = linkIn(env.DB, 'email_change_new')
    expect(link).toMatch(/^\/email-change\?t=/)
    const scanner = new Browser(env, '192.0.2.50')
    for (let i = 0; i < 2; i++) {
      const page = await body(await scanner.get(link))
      expect(page).toContain('this link moves <strong>@myra</strong> to <strong>myra@new.example</strong>.')
      expect(page).toContain('use this address')
    }
    expect(get(env, 'SELECT email FROM person WHERE id = ?', id).email).toBe('myra@example.org')

    // the button, from any browser, signed out
    const clicker = new Browser(env, '192.0.2.51')
    const t = new URL(link, 'https://shwarm.org').searchParams.get('t')!
    let r = await clicker.post('/email-change', { t })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/email-change?done=1')
    expect(await body(await clicker.get('/email-change?done=1'))).toContain('your new email is set')
    const after = get(env, 'SELECT email, email_norm, email_verified_at FROM person WHERE id = ?', id)
    expect(after).toEqual({ email: 'myra@new.example', email_norm: 'myra@new.example', email_verified_at: new Date(T0).toISOString() })
    expect(await canSignIn(env, 'myra@new.example', GOOD_PASSWORD)).toBe(true)
    expect(await canSignIn(env, 'myra@example.org', GOOD_PASSWORD)).toBe(false)
    // the owner's browser stays signed in, the modal shows the new address and no pending note
    const now = modalIn(await body(await b.get('/@myra?account=1')))!
    expect(now).toContain('value="myra@new.example"')
    expect(now).not.toContain('a link went to')
    // the link works once
    r = await clicker.post('/email-change', { t })
    expect(r.status).toBe(410)
    expect(await body(r)).toContain('email change links last 24 hours.')
    expect((await scanner.get(link)).status).toBe(410)
  })

  it('a newer change kills the older link; links expire after 24 hours; reset links to the old address die on the change', async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    const b = await signIn(env, 'myra@example.org')
    await acct(b, 'myra', saveForm('myra', { email: 'first@new.example' }))
    const first = linkIn(env.DB, 'email_change_new')
    await acct(b, 'myra', saveForm('myra', { email: 'second@new.example' }))
    const second = linkIn(env.DB, 'email_change_new')
    expect((await new Browser(env).get(first)).status).toBe(410)
    expect((await new Browser(env).get(second)).status).toBe(200)
    expect(modalIn(await body(await b.get('/@myra?account=1')))).toContain('a link went to <b>second@new.example</b>')

    // a reset link sent to the old address before the change stops working once the change goes through
    await new Browser(env, '192.0.2.60').post('/forgot', { email: 'myra@example.org' })
    const reset = linkIn(env.DB, 'reset')
    vi.setSystemTime(T0 + 23 * 60 * MIN)
    const c = new Browser(env, '192.0.2.61')
    expect((await c.post('/email-change', { t: new URL(second, 'https://shwarm.org').searchParams.get('t')! })).status).toBe(303)
    expect(get(env, 'SELECT email FROM person WHERE id = ?', id).email).toBe('second@new.example')
    expect((await new Browser(env).get(reset)).status).toBe(410)

    // saving the address it already has sends nothing; a third change, left for 24 hours, no longer works
    const b2 = await signIn(env, 'second@new.example') // a fresh sign-in, so the step-up window is open
    expect((await acct(b2, 'myra', saveForm('myra', { email: 'second@new.example' }))).status).toBe(303)
    expect(mails(env.DB).filter(m => m.template === 'email_change_new')).toHaveLength(2)
    await acct(b2, 'myra', saveForm('myra', { email: 'third@new.example' }))
    const third = linkIn(env.DB, 'email_change_new')
    vi.setSystemTime(T0 + 47 * 60 * MIN + 1 * MIN)
    expect((await new Browser(env).get(third)).status).toBe(410)
  })

  it("never shows whether an address has an account: no link goes to one that does, the page and the old address's warning are the same", async () => {
    const env = testEnv()
    await member(env, 'myra')
    await member(env, 'ana')
    const b = await signIn(env, 'myra@example.org')
    const res = await acct(b, 'myra', saveForm('myra', { email: 'ana@example.org' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/@myra?account=saved')
    expect(mails(env.DB).map(m => m.template)).toEqual(['email_change_old'])
    expect(modalIn(await body(await b.get('/@myra?account=1')))).toContain('a link went to <b>ana@example.org</b>')
  })

  it('refuses an address that is not an address, or from a throwaway mail service', async () => {
    const env = testEnv()
    await member(env, 'myra')
    env.DB.raw.prepare("INSERT OR IGNORE INTO disposable_domain (domain) VALUES ('mailinator.com')").run()
    const b = await signIn(env, 'myra@example.org')
    for (const [email, why] of [['not an address', "that doesn't look like an email address."], ['me@mailinator.com', "we can't take addresses from throwaway mail services."]]) {
      const res = await acct(b, 'myra', saveForm('myra', { email }))
      expect(res.status).toBe(400)
      expect(modalIn(await body(res))).toContain(why)
    }
    expect(mails(env.DB)).toHaveLength(0)
  })
})

describe('a pending email change can be stopped (6.2 review)', () => {
  /** Saves a change to evil@attacker.example from a signed-in browser; returns the link the new address got. */
  async function hijack(env: TestEnv) {
    const b = await signIn(env, 'myra@example.org', GOOD_PASSWORD, '198.51.100.66')
    expect((await acct(b, 'myra', saveForm('myra', { email: 'evil@attacker.example' }))).status).toBe(303)
    const link = linkIn(env.DB, 'email_change_new')
    return { b, link, t: new URL(link, 'https://shwarm.org').searchParams.get('t')! }
  }
  const stillMyra = (env: TestEnv, id: number) => expect(get(env, 'SELECT email FROM person WHERE id = ?', id).email).toBe('myra@example.org')

  it("a password reset, as the old address's warning says, kills the change link", async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    const { t, link } = await hijack(env)
    await new Browser(env, '192.0.2.70').post('/forgot', { email: 'myra@example.org' })
    const r = new URL(linkIn(env.DB, 'reset'), 'https://shwarm.org').searchParams.get('t')!
    expect((await new Browser(env, '192.0.2.71').post('/reset', { t: r, password: NEW_PASSWORD, password2: NEW_PASSWORD })).status).toBe(303)
    const res = await new Browser(env, '192.0.2.72').post('/email-change', { t })
    expect(res.status).toBe(410)
    expect((await new Browser(env).get(link)).status).toBe(410)
    stillMyra(env, id)
  })

  it('a password change from the modal kills the change link, and the pending note goes', async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    const { t } = await hijack(env)
    const here = await signIn(env, 'myra@example.org')
    expect((await acct(here, 'myra', { do: 'password', new_password: NEW_PASSWORD, new_password2: NEW_PASSWORD })).status).toBe(303)
    expect((await new Browser(env, '192.0.2.72').post('/email-change', { t })).status).toBe(410)
    expect(modalIn(await body(await here.get('/@myra?account=1')))).not.toContain('a link went to')
    stillMyra(env, id)
  })

  it('sign out everywhere kills the change link', async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    const { t } = await hijack(env)
    const here = await signIn(env, 'myra@example.org')
    expect((await acct(here, 'myra', { do: 'signout_all' })).status).toBe(303)
    expect((await new Browser(env, '192.0.2.72').post('/email-change', { t })).status).toBe(410)
    stillMyra(env, id)
  })

  it('typing the current address back withdraws the change: the link dies and the note goes, and no mail is sent', async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    const { b, t } = await hijack(env)
    const before = mails(env.DB).length
    expect((await acct(b, 'myra', saveForm('myra', { email: 'Myra@Example.org' }))).status).toBe(303)
    expect(mails(env.DB)).toHaveLength(before)
    expect(get(env, "SELECT COUNT(*) AS n FROM email_token WHERE person_id = ? AND purpose = 'email_change' AND used_at IS NULL", id).n).toBe(0)
    expect(modalIn(await body(await b.get('/@myra?account=1')))).not.toContain('a link went to')
    expect((await new Browser(env, '192.0.2.72').post('/email-change', { t })).status).toBe(410)
    stillMyra(env, id)
  })

  it('email changes are paced per account: 3 an hour, then refused at the field with the draft kept and no mail', async () => {
    const env = testEnv()
    await member(env, 'myra')
    const b = await signIn(env, 'myra@example.org')
    for (const n of [1, 2, 3]) expect((await acct(b, 'myra', saveForm('myra', { email: `stranger${n}@elsewhere.example` }))).status).toBe(303)
    const res = await acct(b, 'myra', saveForm('myra', { email: 'stranger4@elsewhere.example', about: 'kept draft' }))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('3600')
    const html = modalIn(await body(res))!
    expect(html).toContain("that's a lot of email changes. wait about 60 minutes, then try again.")
    expect(html).toContain('kept draft')
    expect(mails(env.DB).filter(m => m.template === 'email_change_new').map(m => m.to_email)).toEqual(['stranger1@elsewhere.example', 'stranger2@elsewhere.example', 'stranger3@elsewhere.example'])
    // a save that leaves the address alone isn't counted or refused
    expect((await acct(b, 'myra', saveForm('myra', { about: 'just the about' }))).status).toBe(303)
    // after the hour, changes go again
    vi.setSystemTime(T0 + 61 * MIN)
    const late = await signIn(env, 'myra@example.org') // a fresh sign-in, so the step-up window is open
    expect((await acct(late, 'myra', saveForm('myra', { email: 'stranger5@elsewhere.example' }))).status).toBe(303)
  })
})

describe('change password (6.2)', () => {
  it('ends every other session, keeps this one, sends the "password changed" mail', async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    const here = await signIn(env, 'myra@example.org')
    const phone = await signIn(env, 'myra@example.org', GOOD_PASSWORD, '198.51.100.7')
    const laptop = await signIn(env, 'myra@example.org', GOOD_PASSWORD, '198.51.100.8')
    expect(sessionsOf(env, id)).toBe(3)

    // outside the window: the current password is asked inline
    vi.setSystemTime(T0 + 15 * MIN)
    const form = { do: 'password', new_password: NEW_PASSWORD, new_password2: NEW_PASSWORD }
    let res = await acct(here, 'myra', form)
    expect(res.status).toBe(400)
    let html = modalIn(await body(res))!
    expect(html).toContain('<details class="chpw" open="">')
    expect(html).toContain('enter your password to confirm.')
    expect(html).not.toContain(NEW_PASSWORD)
    res = await acct(here, 'myra', { ...form, password: GOOD_PASSWORD })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/@myra?account=password')

    // the other two browsers are signed out; this one isn't
    expect(sessionsOf(env, id)).toBe(1)
    for (const b of [phone, laptop]) {
      expect(await readSession(env.DB, b.jar.get('__Host-shwarm'))).toBeNull()
      expect(await body(await b.get('/'))).toContain('sign in')
    }
    const mine = modalIn(await body(await here.get('/@myra?account=password')))!
    expect(mine).toContain('your password is changed. every other browser is signed out.')
    expect(mine).toContain('password · last changed oct 8, 2026')
    expect(get(env, 'SELECT password_changed_at FROM person WHERE id = ?', id).password_changed_at).toBe(new Date(T0 + 15 * MIN).toISOString())

    const mail = mails(env.DB).filter(m => m.template === 'password_changed')
    expect(mail.map(m => [m.to_email, m.stream])).toEqual([['myra@example.org', 'security']])
    expect(await canSignIn(env, 'myra@example.org', GOOD_PASSWORD)).toBe(false)
    expect(await canSignIn(env, 'myra@example.org', NEW_PASSWORD)).toBe(true)
  })

  it('checks the new password before the old one is spent: length, the two match, not breached', async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    const b = await signIn(env, 'myra@example.org')
    const other = await signIn(env, 'myra@example.org', GOOD_PASSWORD, '198.51.100.9')
    vi.setSystemTime(T0 + 15 * MIN)
    for (const [a, again, why] of [
      ['short', 'short', 'use at least 10 characters.'],
      [NEW_PASSWORD, 'something else entirely', "the two passwords don't match."],
      ['password1234', 'password1234', 'that password has turned up in a data breach. pick another one.'],
    ]) {
      const res = await acct(b, 'myra', { do: 'password', new_password: a, new_password2: again, password: GOOD_PASSWORD })
      expect(res.status).toBe(400)
      const html = modalIn(await body(res))!
      expect(html).toContain(why)
      expect(html).toContain('<input id="pw-change"') // still asked: not spent
    }
    // a wrong current password changes nothing
    const res = await acct(b, 'myra', { do: 'password', new_password: NEW_PASSWORD, new_password2: NEW_PASSWORD, password: 'wrong password here' })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain("that password doesn't match.")
    expect(sessionsOf(env, id)).toBe(2)
    expect(await readSession(env.DB, other.jar.get('__Host-shwarm'))).not.toBeNull()
    expect(mails(env.DB).filter(m => m.template === 'password_changed')).toHaveLength(0)
  })
})

describe('sign out everywhere (6.2)', () => {
  it('ends every session of the account, this one too, and no one else\'s', async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    const anaId = await member(env, 'ana')
    const here = await signIn(env, 'myra@example.org')
    const phone = await signIn(env, 'myra@example.org', GOOD_PASSWORD, '198.51.100.7')
    const ana = await signIn(env, 'ana@example.org', GOOD_PASSWORD, '198.51.100.3')
    // no password needed, even outside the window
    vi.setSystemTime(T0 + 30 * MIN)
    const res = await acct(here, 'myra', { do: 'signout_all' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/signin?done=everywhere')
    expect(here.jar.get('__Host-shwarm')).toBeUndefined()
    expect(sessionsOf(env, id)).toBe(0)
    expect(await readSession(env.DB, phone.jar.get('__Host-shwarm'))).toBeNull()
    expect(sessionsOf(env, anaId)).toBe(1)
    expect(await body(await ana.get('/'))).toContain('@ana')
    expect(await body(await here.get('/signin?done=everywhere'))).toContain("you're signed out everywhere.")
    // the account itself still works
    expect(await canSignIn(env, 'myra@example.org', GOOD_PASSWORD)).toBe(true)
  })
})

describe("nobody acts on someone else's account (6.2)", () => {
  it('refuses another member, sends a signed-out browser to sign in, and refuses a form from another site', async () => {
    const env = testEnv()
    const id = await member(env, 'myra')
    await member(env, 'ana')
    const myra = await signIn(env, 'myra@example.org')
    const ana = await signIn(env, 'ana@example.org', GOOD_PASSWORD, '198.51.100.3')
    const anaToken = formTokenIn(await (await ana.get('/@ana')).text())
    for (const form of [saveForm('myra', { about: 'hijacked', email: 'ana@evil.example' }), { do: 'password', new_password: NEW_PASSWORD, new_password2: NEW_PASSWORD }, { do: 'signout_all' }]) {
      expect((await ana.req('/@myra', { form: { form_token: anaToken, ...form } })).status).toBe(403)
    }
    expect(get(env, 'SELECT about, email FROM person WHERE id = ?', id)).toEqual({ about: '', email: 'myra@example.org' })
    expect(sessionsOf(env, id)).toBe(1)

    const out = await new Browser(env).req('/@myra', { form: { do: 'signout_all' } })
    expect(out.status).toBe(303)
    expect(out.headers.get('location')).toBe('/signin?next=%2F%40myra')

    // from another site, with a good token: refused before the handler
    const token = formTokenIn(await (await myra.get('/@myra')).text())
    const cross = await myra.req('/@myra', { form: { form_token: token, do: 'signout_all' }, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } })
    expect(cross.status).toBe(403)
    expect(sessionsOf(env, id)).toBe(1)
    // and with no form token at all
    expect((await myra.req('/@myra', { form: { do: 'signout_all' } })).status).toBe(403)
    expect(sessionsOf(env, id)).toBe(1)
  })
})
