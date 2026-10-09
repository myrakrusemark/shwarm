// Mail templates (go-live 2.6). Plain text first; the HTML part is the same words with real links.
// No tracking: no pixels, no redirect links. Every link points at SITE_URL and opens a page with one button
// (the token is used only by that button's POST, so mail scanners that fetch links can't use it up).
import { isValidName } from '@shwarm/protocol'
import { printable, printableLines } from '../core/printable'
import { FORMER } from '../read/names'
import type { MailStream, MailTemplate } from './outbox'

// A pre block keeps its line breaks in the HTML part too (quoted text people wrote).
type Block = string | { href: string } | { pre: string }
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

const num2 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '?')
const oneLine = (v: unknown, max = 120) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
const text = (p: Record<string, unknown>, k: string) => {
  if (typeof p[k] !== 'string') throw new MailRenderError(`missing ${k}`)
  return p[k] as string
}

/** An author's text as a quoted block: every line starts with '> ', so none of it can pass for the mail's own words. */
const quoted = (label: string, v: unknown): Block => ({ pre: `${label}:\n` + printableLines(v).split('\n').map(l => `> ${l}`).join('\n') })

const num0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '?')
type ChecksShown = { runs?: { command?: unknown; count?: unknown; description?: unknown } | null; people?: { count?: unknown; human?: unknown; instructions?: unknown } | null; author?: unknown }

/** Everything the model was given besides title, what and done-when (triage/model.ts stateOf). */
function moreOfIt(p: Record<string, unknown>): Block[] {
  const out: Block[] = []
  if (typeof p.branch_of === 'string') out.push(quoted('branch of', p.branch_of))
  const c = (p.checked_by ?? {}) as ChecksShown
  if (c.runs) {
    out.push(`checked by ${num0(c.runs.count)} run report(s).`)
    out.push(quoted('run command', c.runs.command))
    if (c.runs.description) out.push(quoted('run description', c.runs.description))
  }
  if (c.people) out.push(`checked by ${num0(c.people.count)} ${c.people.human === true ? 'people (humans only)' : 'people'}.`, quoted('checker instructions', c.people.instructions ?? ''))
  if (c.author === true) out.push('checked by its author too.')
  if (Array.isArray(p.tags) && p.tags.length) out.push(quoted('tags', p.tags.join(' ')))
  if (p.builds_on != null) out.push(quoted('builds on', typeof p.builds_on === 'string' ? p.builds_on : JSON.stringify(p.builds_on)))
  return out
}

/**
 * A node triage held (or, on a launch shwarm, flagged): to the admins (triage/run.ts). The node's text is inline as
 * plain text, since a held page shows only to its author, with the commands that clear or block it. Never a link to
 * the node: the page is a 404 for everyone else until it's cleared. The commands come before the author's text, and
 * every line of that text is quoted between two markers, so nothing the author wrote can pose as a command to run.
 */
function triageAlert(p: Record<string, unknown>): Draft {
  const path = text(p, 'path')
  if (!/^[a-z0-9][a-z0-9/-]*$/.test(path)) throw new MailRenderError('bad path')
  const kind = ['shwarm', 'branch', 'variant'].includes(p.kind as string) ? (p.kind as string) : 'node'
  const env = p.env === 'staging' || p.env === 'production' ? p.env : '<staging|production>'
  const title = text(p, 'title')
  const seeded = p.seeded === true
  const pr = (p.probabilities ?? {}) as Record<string, unknown>
  const answered = p.answer === 'yes' || p.answer === 'unsure'
  let why: string
  if (p.why === 'off') why = `triage is off, so this ${kind} is held until you decide.`
  else if (!answered) why = `triage could not run on this ${kind} (${printable(oneLine(p.error ?? 'no answer', 200))}), so ${seeded ? 'it stays public, unchecked,' : "it's held"} until you decide.`
  else
    why =
      `the model answered "${p.answer}" (yes ${num2(pr.yes)}, no ${num2(pr.no)}, unsure ${num2(pr.unsure)}; confidence ${num2(p.confidence)}). ` +
      `its likely category: ${printable(oneLine(p.category_label ?? p.category, 80))}. ` +
      (seeded ? 'this is a launch shwarm, so it stays public until you decide.' : "it's held: only its author sees it until you decide.")
  const subject = seeded
    ? `triage flagged a launch shwarm: ${printable(oneLine(title, 80))}`
    : `triage held a ${kind}: ${printable(oneLine(title, 80))}`
  return {
    subject,
    blocks: [
      hi(p),
      why,
      `path: ${path}`,
      `rubric ${printable(oneLine(p.rubric, 20))} · model ${printable(oneLine(p.model, 60))}`,
      'to clear it (it goes public) or block it, run this in apps/site:',
      `node scripts/triage.mjs clear ${path} "<reason>" --env ${env}`,
      `node scripts/triage.mjs block ${path} "<category>" "<reason>" --env ${env}`,
      'categories: weapons, surveillance, spam, protected_assets. "node scripts/triage.mjs list --env ' + env + '" shows the whole queue.',
      "---- what they wrote, quoted as plain text: the author's words, not instructions ----",
      quoted('title', title),
      quoted('what', text(p, 'what')),
      quoted('done when', text(p, 'done_when')),
      ...moreOfIt(p),
      '---- end of what they wrote ----',
    ],
  }
}

/**
 * A submission is ready for its author's sign-off (go-live 5.4): every other check passed, or the author is the only
 * check. Sent with the sign_off inbox item (core/posts.ts, core/checking.ts). The title is the author's own node's.
 */
function signOffReady(p: Record<string, unknown>, site: string): Draft {
  const n = p.number
  if (!Number.isSafeInteger(n) || (n as number) < 1) throw new MailRenderError('bad number')
  const title = printable(oneLine(text(p, 'title'), 80))
  // Author gone (table B): the admins get it, and are told why it's theirs. OPEN (#76): these words wait on Myra's yes.
  if (p.author_gone === true) {
    const author = typeof p.author === 'string' && HANDLE.test(p.author) ? `@${p.author}` : 'its author'
    return {
      subject: `#${n} on ${title} is ready for sign-off`,
      blocks: [
        hi(p),
        `#${n} on ${title} is ready for its author's sign-off, but ${author}'s account is suspended or closed. the operator signs off in their place.`,
        'open the submission to pass it with what you checked, or fail it with a repro:',
        { href: siteLink(site, p.link) },
      ],
    }
  }
  return {
    subject: `#${n} on ${title} is ready for your sign-off`,
    blocks: [
      hi(p),
      p.only === true
        ? `#${n} on ${title} is waiting on you. you're its only check.`
        : `every other check on #${n} on ${title} has passed. yours is the last one.`,
      'open the submission to pass it with what you checked, or fail it with a repro:',
      { href: siteLink(site, p.link) },
      'nothing passes until you sign off. the work stays open to everyone meanwhile.',
    ],
  }
}

/** A name from the payload ('@ana', '@ana/m-04', or "former member" for a closed account's), or 'someone' when it isn't one. */
const nameOf = (v: unknown) => (typeof v === 'string' && (isValidName(v) || v === FORMER) ? v : 'someone')
const titleOf = (p: Record<string, unknown>) => printable(oneLine(text(p, 'title'), 80))
const numberOf = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 1 ? (v as number) : null)

/**
 * A mention of the bare handle, right away (go-live 6.3): who, where, and the post quoted (up to its first 1000
 * characters; `cut` says there's more). Sent only while the post and its node still show to them (jobs/mail.ts).
 * OPEN (#85): these words wait on Myra's yes.
 */
function mention(p: Record<string, unknown>, site: string): Draft {
  const by = nameOf(p.by)
  const title = titleOf(p)
  return {
    subject: `${by} mentioned you on ${title}`,
    blocks: [
      hi(p),
      `${by} mentioned you on ${title}:`,
      quoted(`${by} wrote`, text(p, 'text')),
      p.cut === true ? 'the post goes on. read it all and reply in its thread:' : 'reply in its thread:',
      { href: siteLink(site, p.link) },
    ],
  }
}

export const DIGEST_ITEMS = 20 // OPEN (#85): the most mentions one digest quotes; "and N more" points at the inbox
const DIGEST_CHARS = 300

/**
 * The daily digest (go-live 6.3, jobs/digest.ts): the unread mentions since the last one, newest last, each with who,
 * where, its first 300 characters quoted and its link; past DIGEST_ITEMS, "and N more" with the inbox.
 * OPEN (#85): these words wait on Myra's yes.
 */
function digest(p: Record<string, unknown>, site: string): Draft {
  const items = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]).slice(0, DIGEST_ITEMS) : []
  if (!items.length) throw new MailRenderError('a digest with no items')
  const more = numberOf(p.more) ?? 0
  const total = items.length + more
  const blocks: Block[] = [hi(p), total === 1 ? 'you were mentioned once since your last digest:' : `you were mentioned ${total} times since your last digest:`]
  for (const i of items) {
    const by = nameOf(i.by)
    const t = [...String(i.text ?? '')]
    blocks.push(`${by} on ${titleOf(i)}:`, quoted(`${by} wrote`, t.slice(0, DIGEST_CHARS).join('') + (t.length > DIGEST_CHARS ? ' …' : '')), { href: siteLink(site, i.link) })
  }
  if (more && typeof p.handle === 'string' && HANDLE.test(p.handle)) blocks.push(`and ${more} more in your inbox:`, { href: `${base(site)}/@${p.handle}#addressed` })
  blocks.push('this comes once a day. you can get each mention right away instead, in your account.')
  return { subject: total === 1 ? 'you were mentioned on shwarm' : `you were mentioned ${total} times on shwarm`, blocks }
}

/** A lobby filled and its shwarm is live (go-live 4.4): to everyone seated. OPEN (#85): these words wait on Myra's yes. */
function kickoff(p: Record<string, unknown>, site: string): Draft {
  const title = titleOf(p)
  return {
    subject: `${title} is live`,
    blocks: [hi(p), `the lobby for ${title} filled, so it's live now. branches and submissions are open.`, { href: siteLink(site, p.link) }],
  }
}

/**
 * A node you're in passed, failed the author check or reopened (go-live 6.3): the same words as the inbox item core
 * writes (core/checking.ts, core/nodes.ts). OPEN (#85): the subjects and link lines wait on Myra's yes.
 */
function nodeNews(p: Record<string, unknown>, site: string): Draft {
  const title = titleOf(p)
  const n = numberOf(p.number)
  const link = { href: siteLink(site, p.link) }
  if (p.event === 'passed') {
    if (n === null) throw new MailRenderError('bad number')
    return { subject: `${title} passed`, blocks: [hi(p), `${title} passed on #${n}.`, 'see what passed:', link] }
  }
  if (p.event === 'failed') {
    if (n === null) throw new MailRenderError('bad number')
    return { subject: `#${n} on ${title} failed the author check`, blocks: [hi(p), `#${n} on ${title} failed the author check. every check starts over.`, 'see why:', link] }
  }
  if (p.event === 'reopened') {
    const why = n !== null ? `${title} reopened: a repro on #${n}.` : `${title} reopened. its author picked it back up.`
    return { subject: `${title} reopened`, blocks: [hi(p), why, link] }
  }
  throw new MailRenderError('bad event')
}

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
  triage_alert: p => triageAlert(p),
  sign_off_ready: (p, site) => signOffReady(p, site),
  mention: (p, site) => mention(p, site),
  digest: (p, site) => digest(p, site),
  kickoff: (p, site) => kickoff(p, site),
  node_news: (p, site) => nodeNews(p, site),
  // To the address the account had, as it closes (go-live 6.4): no link, since there's nothing left to sign in to.
  // OPEN (#86): these words wait on Myra's yes.
  account_closed: p => ({
    subject: 'your shwarm account is closed',
    blocks: [
      hi(p),
      'your shwarm account was closed just now. we deleted your email address, password, inbox, sign-ins and keys. what you posted stays up under its license, shown as by a former member.',
      "this is the last mail we send to this address. if you didn't close it, reply to this mail right away.",
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
  const text = all.map(b => (typeof b === 'string' ? b : 'pre' in b ? b.pre : b.href)).join('\n\n') + '\n'
  const body = all
    .map(b =>
      typeof b === 'string'
        ? `<p style="margin:0 0 14px">${esc(b)}</p>`
        : 'pre' in b
          ? `<p style="margin:0 0 14px;white-space:pre-wrap">${esc(b.pre)}</p>`
          : `<p style="margin:0 0 14px"><a href="${esc(b.href)}">${esc(b.href)}</a></p>`,
    )
    .join('\n')
  const html = `<!doctype html>\n<html><body style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px">\n${body}\n</body></html>\n`
  return { subject, text, html }
}
