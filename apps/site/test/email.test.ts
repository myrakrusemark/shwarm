import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { emailNorm } from '../src/email/norm'
import { accountLink, MailRenderError, renderMail } from '../src/email/templates'
import { readUnsubToken, unsubToken, UNSUB_TTL_MS } from '../src/email/unsubscribe'
import { selfAuthenticated } from '../src/auth/csrf'
import type { MailTemplate } from '../src/email/outbox'
import { addPerson, T0, testDb } from './d1'

const SITE = 'https://shwarm.org'
const ctx = { siteUrl: SITE, stream: 'account' as const }

describe('templates', () => {
  const cases: [MailTemplate, string, string][] = [
    ['verify', 'verify your email for shwarm', `${SITE}/verify?t=tok123`],
    ['welcome', 'welcome to shwarm', `${SITE}/how-it-works`],
    ['reset', 'reset your shwarm password', `${SITE}/reset?t=tok123`],
    ['password_changed', 'your shwarm password was changed', `${SITE}/forgot`],
    ['email_change_new', 'confirm your new email for shwarm', `${SITE}/email-change?t=tok123`],
    ['email_change_old', 'your shwarm email is being changed', `${SITE}/forgot`],
    ['signup_existing', 'someone tried to sign up with your email', `${SITE}/signin`],
  ]
  const links: Record<string, string> = { verify: accountLink('verify', 'tok123'), reset: accountLink('reset', 'tok123'), email_change_new: accountLink('email-change', 'tok123') }

  for (const [template, subject, link] of cases) {
    it(`renders ${template}`, () => {
      const m = renderMail(template, { handle: 'myra', link: links[template] }, ctx)
      expect(m.subject).toBe(subject)
      expect(m.text).toContain('hi @myra,')
      expect(m.text).toContain(link)
      expect(m.html).toContain(`<a href="${link}">`)
      expect(m.text).toContain('replies go to support@shwarm.org.')
      // lowercase copy, no em-dashes, no images or tracking
      expect(m.text.replace(/https:\S+/g, '')).toBe(m.text.replace(/https:\S+/g, '').toLowerCase())
      expect(m.text + m.html).not.toMatch(/[—–]/)
      expect(m.html).not.toMatch(/<img|<script/i)
    })
  }

  it('takes a full link on the site, and refuses links elsewhere', () => {
    expect(renderMail('verify', { link: `${SITE}/verify?t=a` }, ctx).text).toContain(`${SITE}/verify?t=a`)
    for (const link of ['https://evil.example/verify?t=a', '//evil.example/x', `${SITE}.evil.example/x`, 'javascript:alert(1)', undefined, `/verify?t="><script>`]) {
      expect(() => renderMail('verify', { link }, ctx)).toThrow(MailRenderError)
    }
    expect(() => renderMail('nope', {}, ctx)).toThrow(MailRenderError)
  })

  it('builds links from SITE_URL (staging)', () => {
    const st = 'https://shwarm-staging.myrakrusemark.workers.dev'
    expect(renderMail('reset', { link: '/reset?t=x' }, { ...ctx, siteUrl: st }).text).toContain(`${st}/reset?t=x`)
  })

  it("can't be injected through a handle", () => {
    const m = renderMail('welcome', { handle: '<img src=x onerror=alert(1)>' }, ctx)
    expect(m.html).not.toContain('<img')
    expect(m.text).not.toContain('<img')
    expect(m.text).toContain('hi,')
    const n = renderMail('welcome', { handle: 'myra\r\nBcc: x@evil.example' }, ctx)
    expect(n.text).not.toContain('Bcc')
  })

  it('escapes everything in the html part', () => {
    const m = renderMail('verify', { link: "/verify?t=a&b=c" }, ctx)
    expect(m.html).toContain('href="https://shwarm.org/verify?t=a&amp;b=c"')
  })

  it('adds the unsubscribe footer to notices, and refuses a notice without one', () => {
    const m = renderMail('welcome', {}, { ...ctx, stream: 'notices', unsubscribe: { url: `${SITE}/unsubscribe?t=x`, label: 'mention' } })
    expect(m.text).toContain('mention mails are on')
    expect(m.text).toContain(`${SITE}/unsubscribe?t=x`)
    expect(() => renderMail('welcome', {}, { ...ctx, stream: 'notices' })).toThrow(MailRenderError)
  })
})

describe('email keys', () => {
  it('normalizes plus-addresses and gmail dots', () => {
    expect(emailNorm('My.Name+shwarm@GoogleMail.com')).toBe('myname@gmail.com')
    expect(emailNorm('a.b+x@example.org')).toBe('a.b@example.org')
  })
})

describe('unsubscribe tokens', () => {
  it('round-trips and refuses forged, altered, expired and future tokens', async () => {
    const t = await unsubToken('s3cret', 7, 'mention', T0)
    expect(await readUnsubToken('s3cret', t, T0 + 1000)).toEqual({ personId: 7, type: 'mention' })
    expect(await readUnsubToken('other', t, T0)).toBeNull()
    expect(await readUnsubToken('s3cret', t.replace('u1.7.', 'u1.8.'), T0)).toBeNull()
    expect(await readUnsubToken('s3cret', t.replace('.mention.', '.digest.'), T0)).toBeNull()
    expect(await readUnsubToken('s3cret', t.slice(0, -1), T0)).toBeNull()
    expect(await readUnsubToken('s3cret', t, T0 + UNSUB_TTL_MS + 1000)).toBeNull()
    expect(await readUnsubToken('s3cret', await unsubToken('s3cret', 7, 'mention', T0 + 3_600_000), T0)).toBeNull()
    expect(await readUnsubToken('s3cret', undefined, T0)).toBeNull()
    await expect(unsubToken('s3cret', 7, 'Bad-Type', T0)).rejects.toThrow()
  })
})

// The whole app, so originGuard, the staging lock and the security headers all run.
function env(extra: Record<string, unknown> = {}) {
  return { DB: testDb(), ENV: 'production', SITE_MODE: 'holding', SITE_URL: SITE, MAIL_SECRET: 'mail-secret', RESEND_WEBHOOK_SECRET: 'hook-secret', ...extra } as any
}
const basic = (u: string, p: string) => 'Basic ' + btoa(`${u}:${p}`)
const bounce = (to: string, type = 'email.bounced', bounceType = 'Permanent') =>
  JSON.stringify({ type, created_at: '2026-10-08T12:00:00Z', data: { email_id: 're_1', to: [to], bounce: { type: bounceType } } })

describe('resend webhook', () => {
  it('refuses calls without the right basic auth', async () => {
    const e = env()
    const post = (headers: Record<string, string>) => app.request('/hooks/resend', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: bounce('a@example.org') }, e)
    expect((await post({})).status).toBe(401)
    expect((await post({ authorization: basic('resend', 'wrong') })).status).toBe(401)
    expect((await post({ authorization: basic('other', 'hook-secret') })).status).toBe(401)
    expect((await post({ authorization: 'Bearer hook-secret' })).status).toBe(401)
    expect(e.DB.raw.prepare('SELECT count(*) AS n FROM email_suppression').get().n).toBe(0)
    const noSecret = env({ RESEND_WEBHOOK_SECRET: undefined })
    const r = await app.request('/hooks/resend', { method: 'POST', headers: { authorization: basic('resend', '') }, body: bounce('a@example.org') }, noSecret)
    expect(r.status).toBe(401)
  })

  it('puts a bounced address on the suppression list, through originGuard (no Origin header)', async () => {
    const e = env()
    const res = await app.request('/hooks/resend', { method: 'POST', headers: { authorization: basic('resend', 'hook-secret'), 'content-type': 'application/json' }, body: bounce('Bob+x@Example.org') }, e)
    expect(res.status).toBe(200)
    expect(e.DB.raw.prepare('SELECT email_norm, reason FROM email_suppression').all()).toEqual([{ email_norm: 'bob@example.org', reason: 'bounce' }])
  })

  it('suppresses complaints, ignores soft bounces and other events', async () => {
    const e = env()
    const send = (body: string) => app.request('/hooks/resend', { method: 'POST', headers: { authorization: basic('resend', 'hook-secret') }, body }, e)
    expect((await send(bounce('c@example.org', 'email.complained'))).status).toBe(200)
    expect((await send(bounce('d@example.org', 'email.bounced', 'Transient'))).status).toBe(200)
    expect((await send(bounce('e@example.org', 'email.delivered'))).status).toBe(200)
    expect((await send('not json')).status).toBe(400)
    expect(e.DB.raw.prepare('SELECT email_norm, reason FROM email_suppression').all()).toEqual([{ email_norm: 'c@example.org', reason: 'complaint' }])
  })

  it('stays reachable on staging without the staging password', async () => {
    const e = env({ ENV: 'staging', STAGING_PASSWORD: 'pw' })
    const res = await app.request('/hooks/resend', { method: 'POST', headers: { authorization: basic('resend', 'hook-secret') }, body: bounce('a@example.org') }, e)
    expect(res.status).toBe(200)
    expect((await app.request('/unsubscribe', {}, e)).status).toBe(401) // the rest of staging stays locked
  })
})

describe('one-click unsubscribe', () => {
  const oneClick = (t: string, e: any, body = 'List-Unsubscribe=One-Click', type = 'application/x-www-form-urlencoded') =>
    app.request(`/unsubscribe?t=${t}`, { method: 'POST', headers: { 'content-type': type }, body }, e)

  it('shows a page with one unsubscribe button', async () => {
    const e = env()
    const me = await addPerson(e.DB, 'myra')
    const t = await unsubToken('mail-secret', me, 'mention')
    const res = await app.request(`/unsubscribe?t=${t}`, {}, e)
    expect(res.status).toBe(200)
    const page = await res.text()
    expect(page).toContain(`action="/unsubscribe?t=${t}"`)
    expect(page).toContain('name="List-Unsubscribe" value="One-Click"')
    expect(page.match(/<form method="post"/g)?.length).toBe(1)
    expect(page.match(/>unsubscribe<\/button>/g)?.length).toBe(1)
    expect(page).toContain('stop getting mention mails?')
    // the GET changes nothing (mail scanners fetch links)
    expect(e.DB.raw.prepare('SELECT notice_prefs FROM person').get().notice_prefs).toBe('{}')
  })

  it('turns off that one notice type, from a server-to-server POST', async () => {
    const e = env()
    const me = await addPerson(e.DB, 'myra')
    e.DB.raw.prepare(`UPDATE person SET notice_prefs = '{"digest":true,"passes":false}' WHERE id = ?`).run(me)
    const res = await oneClick(await unsubToken('mail-secret', me, 'mention'), e)
    expect(res.status).toBe(200)
    expect(JSON.parse(e.DB.raw.prepare('SELECT notice_prefs FROM person').get().notice_prefs)).toEqual({ digest: true, passes: false, mention: false })
  })

  it('accepts multipart bodies too', async () => {
    const e = env()
    const me = await addPerson(e.DB, 'myra')
    const fd = new FormData()
    fd.set('List-Unsubscribe', 'One-Click')
    const res = await app.request(`/unsubscribe?t=${await unsubToken('mail-secret', me, 'mention')}`, { method: 'POST', body: fd }, e)
    expect(res.status).toBe(200)
    expect(JSON.parse(e.DB.raw.prepare('SELECT notice_prefs FROM person').get().notice_prefs)).toEqual({ mention: false })
  })

  it('only accepts the List-Unsubscribe=One-Click body', async () => {
    const e = env()
    const me = await addPerson(e.DB, 'myra')
    const t = await unsubToken('mail-secret', me, 'mention')
    expect((await oneClick(t, e, '')).status).toBe(400)
    expect((await oneClick(t, e, 'List-Unsubscribe=Yes')).status).toBe(400)
    expect((await oneClick(t, e, '{"List-Unsubscribe":"One-Click"}', 'application/json')).status).toBe(400)
    expect(e.DB.raw.prepare('SELECT notice_prefs FROM person').get().notice_prefs).toBe('{}')
  })

  it('refuses forged and expired tokens', async () => {
    const e = env()
    const me = await addPerson(e.DB, 'myra')
    const forged = await unsubToken('not-the-secret', me, 'mention')
    const old = await unsubToken('mail-secret', me, 'mention', Date.now() - UNSUB_TTL_MS - 86_400_000)
    for (const t of [forged, old, 'u1.1.mention.abc.x', '']) {
      expect((await oneClick(t, e)).status).toBe(400)
      expect((await app.request(`/unsubscribe?t=${t}`, {}, e)).status).toBe(400)
    }
    expect(e.DB.raw.prepare('SELECT notice_prefs FROM person').get().notice_prefs).toBe('{}')
  })
})

describe('origin guard exemptions', () => {
  it('lets only self-authenticated paths skip it', async () => {
    expect(selfAuthenticated('/hooks/resend')).toBe(true)
    expect(selfAuthenticated('/unsubscribe')).toBe(true)
    expect(selfAuthenticated('/unsubscribe/x')).toBe(false)
    expect(selfAuthenticated('/signin')).toBe(false)
    const res = await app.request('/signin', { method: 'POST', body: 'x=1' }, env())
    expect(res.status).toBe(403)
  })
})
