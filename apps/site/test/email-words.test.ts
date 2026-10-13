// The word list (go-live 11.8): every mail people get, in each of its forms, and the smaller pages' words that other
// tests don't reach (every error heading, every relative time, the notice settings' labels), with every {slot} filled.
// The capture run (test/capture) records what these render, so a word move can be checked byte for byte.
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderMail, type RenderCtx } from '../src/email/templates'
import { INBOX_EVERY, NOTICE_GROUPS } from '../src/email/notices'
import { noticeLabel } from '../src/email/unsubscribe'
import { ago, exactTime } from '../src/render/numbers'
import { sendError, type ErrorStatus } from '../src/web/errors'
import { OPENS_SOON } from '../src/web/opens-soon'
import { ReportPage } from '../src/web/report'

const SITE = 'https://shwarm.org'
const account: RenderCtx = { siteUrl: SITE, stream: 'account' }
const security: RenderCtx = { siteUrl: SITE, stream: 'security' }
const notice = (type: string): RenderCtx => ({ siteUrl: SITE, stream: 'notices', unsubscribe: { url: `${SITE}/unsubscribe?t=x`, label: noticeLabel(type) } })
const T0 = Date.parse('2026-10-08T14:03:00Z')
const SLOT = /\{\w+\}/

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())

describe('every mail people get', () => {
  const link = '/w/minecraft-in-doom/block-placement/s/3'
  const cases: [string, string, Record<string, unknown>, RenderCtx][] = [
    ['verify', 'verify', { handle: 'myra', link: '/verify?t=tok' }, account],
    ['verify, no handle', 'verify', { link: '/verify?t=tok' }, account],
    ['welcome', 'welcome', { handle: 'myra' }, account],
    ['reset', 'reset', { handle: 'myra', link: '/reset?t=tok' }, account],
    ['password_changed', 'password_changed', { handle: 'myra' }, account],
    ['email_change_new', 'email_change_new', { handle: 'myra', link: '/email-change?t=tok' }, account],
    ['email_change_old', 'email_change_old', { handle: 'myra' }, account],
    ['signup_existing', 'signup_existing', { handle: 'myra' }, account],
    ['account_suspended', 'account_suspended', { handle: 'myra', reason: 'spam' }, security],
    ['terms_notice', 'terms_notice', { handle: 'myra', version: '1.1', effective: '2026-11-01', changes: ['one thing', 'another'], link: '/terms#changelog' }, account],
    ['opening_notice', 'opening_notice', { handle: 'myra', link: '/signin', feed: '/' }, account],
    ['account_closed', 'account_closed', { handle: 'myra' }, account],
    ['sign_off_ready', 'sign_off_ready', { handle: 'myra', number: 3, title: 'minecraft in doom', link }, notice('sign_off')],
    ['sign_off_ready, only check', 'sign_off_ready', { handle: 'myra', number: 3, title: 'minecraft in doom', link, only: true }, notice('sign_off')],
    ['sign_off_ready, author gone', 'sign_off_ready', { handle: 'myra', number: 3, title: 'minecraft in doom', link, author_gone: true, author: 'ana' }, notice('sign_off')],
    ['mention', 'mention', { handle: 'myra', by: '@ana', title: 'block placement', text: 'hi @myra\nlook', link }, notice('mention')],
    ['mention, cut', 'mention', { handle: 'myra', by: '@ana/m-04', title: 'block placement', text: 'hi', cut: true, link }, notice('mention')],
    ['digest, one', 'digest', { handle: 'myra', items: [{ by: '@ana', title: 'block placement', text: 'hi', link }] }, notice('mention')],
    ['digest, many and more', 'digest', { handle: 'myra', more: 2, items: [{ by: '@ana', title: 'a', text: 'x'.repeat(400), link }, { by: 'nobody!', title: 'b', text: 'y', link }] }, notice('mention')],
    ['node_news, passed', 'node_news', { handle: 'myra', event: 'passed', number: 3, title: 'block placement', link }, notice('pass_fail')],
    ['node_news, failed', 'node_news', { handle: 'myra', event: 'failed', number: 3, title: 'block placement', link }, notice('pass_fail')],
    ['key_new_network, one', 'key_new_network', { handle: 'myra', key: 'laptop', network: '203.0.113.0/24', at: '2026-10-08T14:03:00Z', link: '/keys' }, security],
    ['key_new_network, several', 'key_new_network', { handle: 'myra', key: 'laptop', networks: ['203.0.113.0/24', '2001:db8::/48'], at: '2026-10-08T14:03:00Z', link: '/keys' }, security],
    ['dm_report', 'dm_report', { handle: 'myra', id: 'd_abcdefgh12', to: '@ana/m-04', from: '@bo/x', at: '2026-10-08', text: 'hello', env: 'staging' }, account],
    ['a notice with an unknown type', 'mention', { handle: 'myra', by: '@ana', title: 't', text: 'x', link }, notice('lobby_filled')],
  ]
  for (const [name, template, payload, ctx] of cases)
    it(name, () => {
      const m = renderMail(template, payload, ctx)
      for (const part of [m.subject, m.text, m.html]) expect(part).not.toMatch(SLOT)
      expect(m.text).toContain('hi')
      expect(m.text.endsWith('replies go to support@shwarm.org.\n')).toBe(true)
    })

  it('names each notice in the unsubscribe line', () => {
    expect(renderMail('node_news', { event: 'passed', number: 3, title: 't', link }, notice('pass_fail')).text).toContain('you get this because pass and fail mails are on.')
    expect(renderMail('mention', { by: '@ana', title: 't', text: 'x', link }, notice('lobby_filled')).text).toContain('you get this because lobby filled mails are on.')
  })
})

describe('the smaller pages', () => {
  it('error pages: a heading for every status, in every form', async () => {
    const app = new Hono()
    app.get('/e/:s', c => sendError(c, { status: Number(c.req.param('s')) as ErrorStatus, wait: c.req.query('wait') ? 75 : undefined }))
    for (const s of [400, 401, 403, 404, 405, 410, 413, 429, 500])
      for (const accept of ['text/html', 'text/plain', 'application/json']) {
        const r = await app.request(`/e/${s}${s === 429 ? '?wait=1' : ''}`, { headers: { accept } })
        expect(r.status).toBe(s)
        const body = await r.text()
        expect(body).not.toMatch(SLOT)
        if (accept === 'text/html') expect(body).toMatch(/class="auth err-page"><div class="box"><h2>[^<]+<\/h2>/)
      }
  })

  it('relative and exact times', () => {
    const at = (s: number) => new Date(T0 - s * 1000).toISOString()
    expect([5, 120, 7200, 3 * 86400, 800 * 86400].map(s => ago(at(s), T0))).toEqual(['just now', '2m ago', '2h ago', '3d ago', '2y ago'])
    expect(exactTime(at(0))).toBe('2026-10-08 14:03 utc')
  })

  it('opens soon, the notice settings and the report form signed in', () => {
    for (const v of Object.values({ ...OPENS_SOON })) expect(v).toMatch(/^[a-z]/)
    for (const label of [...NOTICE_GROUPS.map(g => g.label), ...INBOX_EVERY.map(e => e.label)]) expect(label).toMatch(/^[a-z]/)
    const html = String(ReportPage({ token: 'tok', handle: 'myra' }))
    expect(html).toContain('@myra')
    expect(html).not.toMatch(SLOT)
  })
})
