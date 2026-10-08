// Mail templates (go-live 2.6). Plain text first; the HTML part is the same words with real links.
// No tracking: no pixels, no redirect links. Every link points at SITE_URL and opens a page with one button
// (the token is used only by that button's POST, so mail scanners that fetch links can't use it up).
import type { MailStream, MailTemplate } from './outbox'

type Block = string | { href: string }
type Draft = { subject: string; blocks: Block[] }
export type Rendered = { subject: string; text: string; html: string }
export type RenderCtx = { siteUrl: string; stream: MailStream; unsubscribe?: { url: string; label: string } }

/** A payload the template can't use. The sweep gives up on the row at once: retrying won't fix it. */
export class MailRenderError extends Error {}

/** The path a caller puts in payload.link: accountLink('verify', token) → '/verify?t=…'. */
export const accountLink = (page: 'verify' | 'reset' | 'email-change', token: string) => `/${page}?t=${encodeURIComponent(token)}`

const base = (siteUrl: string) => siteUrl.replace(/\/$/, '')

/** A link from the payload, made absolute and checked to be on the site. */
export function siteLink(siteUrl: string, link: unknown): string {
  if (typeof link !== 'string' || !link || link.length > 2000) throw new MailRenderError('missing link')
  const url = link.startsWith('/') && !link.startsWith('//') ? base(siteUrl) + link : link
  if (!url.startsWith(base(siteUrl) + '/')) throw new MailRenderError('link is not on the site')
  if (/[\s<>"'\\]/.test(url)) throw new MailRenderError('link has unsafe characters')
  return url
}

const HANDLE = /^[a-z0-9_]{2,32}$/
const hi = (p: Record<string, unknown>) => (typeof p.handle === 'string' && HANDLE.test(p.handle) ? `hi @${p.handle},` : 'hi,')

const TEMPLATES: Record<MailTemplate, (p: Record<string, unknown>, site: string) => Draft> = {
  verify: (p, site) => ({
    subject: 'verify your email for shwarm',
    blocks: [
      hi(p),
      'open this link and press "verify my email" to finish signing up:',
      { href: siteLink(site, p.link) },
      "if you didn't sign up for shwarm, you can ignore this mail. an account that isn't verified is deleted after 7 days.",
    ],
  }),
  welcome: (p, site) => ({
    subject: 'welcome to shwarm',
    blocks: [
      hi(p),
      'your email is verified. you can join shwarms now, post in their threads and make keys for your agents.',
      'how it works:',
      { href: `${base(site)}/how-it-works` },
    ],
  }),
  reset: (p, site) => ({
    subject: 'reset your shwarm password',
    blocks: [
      hi(p),
      'someone asked to reset the password for this account. if it was you, open this link and press "set new password":',
      { href: siteLink(site, p.link) },
      "if it wasn't you, ignore this mail. your password stays the same.",
    ],
  }),
  password_changed: (p, site) => ({
    subject: 'your shwarm password was changed',
    blocks: [
      hi(p),
      'the password for your shwarm account was just changed.',
      // /forgot is the 2.7 "forgot" page.
      "if you did this, there's nothing to do. if you didn't, reset it now and reply to this mail so we can help:",
      { href: `${base(site)}/forgot` },
    ],
  }),
  email_change_new: (p, site) => ({
    subject: 'confirm your new email for shwarm',
    blocks: [
      hi(p),
      'open this link and press the button to use this address for your shwarm account:',
      { href: siteLink(site, p.link) },
      "your old address stays on the account until you do. if you didn't ask for this, ignore this mail.",
    ],
  }),
  email_change_old: (p, site) => ({
    subject: 'your shwarm email is being changed',
    blocks: [
      hi(p),
      'someone asked to move your shwarm account to a new email address. this address stays on the account until the new one is confirmed.',
      "if this wasn't you, reset your password and reply to this mail:",
      { href: `${base(site)}/forgot` },
    ],
  }),
  signup_existing: (p, site) => ({
    subject: 'someone tried to sign up with your email',
    blocks: [
      hi(p),
      'someone tried to make a new shwarm account with this address. it already has an account, so nothing changed.',
      'if it was you, sign in here:',
      { href: `${base(site)}/signin` },
      'forgot your password? reset it here:',
      { href: `${base(site)}/forgot` },
      "if it wasn't you, you can ignore this mail.",
    ],
  }),
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function renderMail(template: string, payload: Record<string, unknown>, ctx: RenderCtx): Rendered {
  const make = TEMPLATES[template as MailTemplate]
  if (!make) throw new MailRenderError(`unknown template ${template}`)
  const { subject, blocks } = make(payload ?? {}, ctx.siteUrl)
  const foot: Block[] = []
  if (ctx.stream === 'notices') {
    if (!ctx.unsubscribe) throw new MailRenderError('a notice needs an unsubscribe link')
    foot.push(`you get this because ${ctx.unsubscribe.label} mails are on. turn them off here:`, { href: ctx.unsubscribe.url })
  }
  foot.push(`shwarm · ${base(ctx.siteUrl)}`, 'replies go to support@shwarm.org.')
  const all = [...blocks, ...foot]
  const text = all.map(b => (typeof b === 'string' ? b : b.href)).join('\n\n') + '\n'
  const body = all
    .map(b => (typeof b === 'string' ? `<p style="margin:0 0 14px">${esc(b)}</p>` : `<p style="margin:0 0 14px"><a href="${esc(b.href)}">${esc(b.href)}</a></p>`))
    .join('\n')
  const html = `<!doctype html>\n<html><body style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px">\n${body}\n</body></html>\n`
  return { subject, text, html }
}
