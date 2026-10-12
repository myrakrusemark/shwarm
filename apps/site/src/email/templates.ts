// Mail templates (go-live 2.6). Plain text first; the HTML part is the same words with real links.
// No tracking: no pixels, no redirect links. Every link points at SITE_URL and opens a page with one button
// (the token is used only by that button's POST, so mail scanners that fetch links can't use it up).
import { isValidName } from '@shwarm/protocol'
import { printable, printableLines } from '../core/printable'
import { FLAG_LABEL, isFlagReason, unpauseCommand } from '../core/flags'
import { isReason, REASON_LABEL } from '../core/reports'
import { FORMER } from '../read/names'
import { plural } from '../render/format'
import { termsDate } from '../core/terms'
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

/** "1 run report", "2 run reports"; '?' when the payload's count isn't a number. */
const count = (v: unknown, one: string, many: string) => (typeof v === 'number' && Number.isFinite(v) ? plural(v, one, many) : `? ${many}`)
type ChecksShown = { runs?: { command?: unknown; count?: unknown; description?: unknown } | null; people?: { count?: unknown; human?: unknown; instructions?: unknown } | null; author?: unknown }

/** Everything the model was given besides title, what and done-when (triage/model.ts stateOf). */
function moreOfIt(p: Record<string, unknown>): Block[] {
  const out: Block[] = []
  if (typeof p.branch_of === 'string') out.push(quoted('branch of', p.branch_of))
  const c = (p.checked_by ?? {}) as ChecksShown
  if (c.runs) {
    out.push(`checked by ${count(c.runs.count, 'run report', 'run reports')}.`)
    out.push(quoted('run command', c.runs.command))
    if (c.runs.description) out.push(quoted('run description', c.runs.description))
  }
  // The people line in the node page's words (node-page.tsx CheckedBy); no instructions, no quoted block (an empty one is a
  // bare "> "). OPEN (#93): these count lines wait on Myra's yes.
  if (c.people) {
    const human = c.people.human === true ? (c.people.count === 1 ? ', a human' : ', at least one of them human') : ''
    out.push(`checked by ${count(c.people.count, 'person', 'people')}${human}.`)
    if (typeof c.people.instructions === 'string' && c.people.instructions.trim()) out.push(quoted('checker instructions', c.people.instructions))
  }
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
  const kind = p.kind === 'branch' ? 'branch' : p.kind === 'shwarm' || p.kind === 'variant' ? 'shwarm' : 'node' // a variant made before Oct 9 reads as a shwarm
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

/**
 * A node you're in passed or failed the author check (go-live 6.3): the same words as the inbox item core writes
 * (core/checking.ts). Nothing reopens (decided Oct 9), so there is no reopened mail. OPEN (#85): the subjects and link
 * lines wait on Myra's yes.
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
  throw new MailRenderError('bad event')
}

/**
 * An agent key signed a request from a network it hadn't used before (go-live 7.3, api/signed.ts): to the key's human,
 * always (security stream, no setting). The key's name is the owner's own; the network is its /24 or /48.
 * OPEN (#89): these words wait on Myra's yes.
 */
function keyNewNetwork(p: Record<string, unknown>, site: string): Draft {
  const name = printable(oneLine(text(p, 'key'), 60))
  // One network, or several held back by the hourly pace (api/signed.ts), each a /24 or /48.
  const nets = Array.isArray(p.networks) ? (p.networks as unknown[]) : [text(p, 'network')]
  if (!nets.length || nets.length > 20 || !nets.every(n => typeof n === 'string' && /^[0-9a-f.:]+\/(24|48)$/.test(n)))
    throw new MailRenderError('bad network')
  const at = Date.parse(text(p, 'at'))
  if (!Number.isFinite(at)) throw new MailRenderError('bad time')
  const when = new Date(at).toISOString().slice(0, 16).replace('T', ' ')
  return {
    subject: 'your agent key was used somewhere new',
    blocks: [
      hi(p),
      // OPEN (#89): the words for several networks wait on Myra's yes.
      nets.length === 1
        ? `your agent key "${name}" signed a request from a network it hasn't used before: ${nets[0]}, at ${when} utc.`
        : `your agent key "${name}" signed requests from ${nets.length} networks it hasn't used before: ${nets.join(', ')}, the first at ${when} utc.`,
      "if that was your agent, there's nothing to do. if it wasn't, revoke the key now. it stops working at once:",
      { href: siteLink(site, p.link) },
    ],
  }
}

/**
 * To the admins: an agent reported a direct message (go-live 7.17, core/dm.ts reportDm). The DM's words are quoted, as
 * an author's are, so none of them pass for the mail's own; the same words are in the report table.
 */
function dmReport(p: Record<string, unknown>): Draft {
  const id = text(p, 'id')
  if (!/^d_[a-z0-9]{8,32}$/.test(id)) throw new MailRenderError('bad id')
  const env = p.env === 'staging' || p.env === 'production' ? p.env : '<staging|production>'
  // OPEN (#104): these words wait on Myra's yes.
  return {
    subject: `a direct message was reported: ${printable(oneLine(p.from, 80))}`,
    blocks: [
      hi(p),
      `${printable(oneLine(p.to, 80))} reported a direct message from ${printable(oneLine(p.from, 80))}, sent ${printable(oneLine(p.at, 40))} (${id}, ${env}).`,
      quoted('the message', p.text),
      'it is kept in the report queue (the report table, url dm:' + id + ') after the message itself is deleted at 30 days.',
    ],
  }
}

/**
 * To the admins: someone reported a thread post, or sent the /report form (go-live 9.3, core/reports.ts). Everything
 * people wrote (the post, the report's words, the address and contact they gave) is quoted, so none of it passes for
 * the mail's own words. A post's link is to the site; an address from the form is quoted, not linked.
 * OPEN (#105): new wording.
 */
function postReport(p: Record<string, unknown>, site: string): Draft {
  const reason = isReason(p.reason) ? p.reason : null
  if (!reason) throw new MailRenderError('bad reason')
  const env = p.env === 'staging' || p.env === 'production' ? p.env : '<staging|production>'
  const by = typeof p.by === 'string' ? printable(oneLine(p.by, 40)) : 'someone signed out'
  const fromForm = typeof p.url === 'string'
  const postBy = typeof p.post_by === 'string' ? ` by ${printable(oneLine(p.post_by, 80))}` : ''
  const where = typeof p.path === 'string' && /^[a-z0-9][a-z0-9/-]*$/.test(p.path) ? ` in ${p.path}` : ''
  const blocks: Block[] = [
    hi(p),
    fromForm
      ? `${by} sent the report form (${env}).`
      : `${by} reported a post${postBy}${where} (${env}).`,
    `what's wrong: ${REASON_LABEL[reason]}.`,
  ]
  if (fromForm) blocks.push(quoted('the address they gave', p.url))
  else blocks.push({ href: siteLink(site, p.link) })
  if (typeof p.post_text === 'string') blocks.push(quoted(fromForm ? `the post it points at${postBy}` : 'the post', p.post_text))
  if (typeof p.text === 'string' && p.text.trim()) blocks.push(quoted('what they wrote', p.text))
  else blocks.push('they added no words.')
  if (fromForm) blocks.push(typeof p.contact === 'string' && p.contact ? quoted('their contact address', p.contact) : "they gave no contact address, so there's no one to reply to.")
  blocks.push('it is in the report queue (the report table).')
  return { subject: `a report came in: ${REASON_LABEL[reason]}`, blocks }
}

/**
 * To the admins: someone flagged a shwarm or a branch (go-live 9.3, core/flags.ts). Says whether this flag paused it
 * (the third from established accounts), whether it was paused already, or how many count so far, and how to unpause
 * it. The title is the author's, so it is quoted.
 * OPEN (#106): new wording.
 */
function nodeFlag(p: Record<string, unknown>, site: string): Draft {
  const reason = isFlagReason(p.reason) ? p.reason : null
  if (!reason) throw new MailRenderError('bad reason')
  const path = text(p, 'path')
  if (!/^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/.test(path)) throw new MailRenderError('bad path')
  const env = p.env === 'staging' || p.env === 'production' ? p.env : '<staging|production>'
  const kind = p.kind === 'branch' ? 'branch' : 'shwarm'
  const by = typeof p.by === 'string' ? printable(oneLine(p.by, 40)) : 'someone'
  const at = typeof p.pause_at === 'number' ? p.pause_at : 3
  const counted = typeof p.established === 'number' ? p.established : '?'
  const paused = p.paused === 1 || p.paused === true
  const was = p.was_paused === 1 || p.was_paused === true
  const blocks: Block[] = [
    hi(p),
    `${by} flagged the ${kind} ${path} (${env}).`,
    `what's wrong: ${FLAG_LABEL[reason]}.`,
    { href: siteLink(site, p.link) },
    quoted('its title', p.title),
  ]
  if (paused)
    blocks.push(
      `that makes ${counted} flags from established accounts, so it is paused now. it takes no posts, joins or checks, and its page says "paused for review" to everyone until you unpause it.`,
    )
  else if (was) blocks.push('it was paused already.')
  else blocks.push(`${counted} of ${at} flags from established accounts so far. at ${at}, it pauses until you look.`)
  if (paused || was) blocks.push('to unpause it, run this from apps/site. it clears the flags on it too:', { pre: unpauseCommand(path, env) })
  blocks.push(`every open flag: node scripts/triage.mjs flags --env ${env}`)
  const title = printable(oneLine(p.title, 60))
  return { subject: paused ? `paused for review: ${title}` : `a ${kind} was flagged: ${FLAG_LABEL[reason]}`, blocks }
}

/**
 * The admins' daily summary (go-live 11.4, jobs/summary.ts): yesterday in one line, from read/beta.ts daySummary, and
 * the link to the beta funnel page. Requests are counted on the server, not people.
 */
function dailySummary(p: Record<string, unknown>, site: string): Draft {
  const day = text(p, 'day')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new MailRenderError('bad day')
  const count = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0)
  const r = (p.requests ?? {}) as Record<string, unknown>
  const total = ['page', 'prompt', 'json', 'api', 'other'].reduce((a, k) => a + count(r[k]), 0)
  const n = (v: unknown, one: string, many = one + 's') => `${count(v)} ${count(v) === 1 ? one : many}`
  // The parts add up to the total: 'other' (robots.txt, xml and the like, web/traffic.ts) shows when there was any.
  const other = count(r.other) ? `, other ${count(r.other)}` : ''
  const line =
    `yesterday (${day}): ${n(total, 'request')} (pages ${count(r.page)}, prompts ${count(r.prompt)}, json ${count(r.json)}, api ${count(r.api)}${other}), ` +
    `${n(p.signups, 'sign-up')}, ${n(p.first_posts, 'first post')}, ${n(p.first_submissions, 'first submission')}, ${n(p.checks, 'check')}, ${n(p.passes, 'pass', 'passes')}.`
  const where = typeof p.env === 'string' && p.env !== 'production' && /^[a-z]{1,20}$/.test(p.env) ? ` ${p.env}` : ''
  // Usage (go-live 11.3, jobs/summary.ts), when the payload has it: a mail queued before it was added has none.
  const u = p.usage && typeof p.usage === 'object' ? (p.usage as Record<string, unknown>) : null
  const g = (v: unknown) => count(v).toLocaleString('en-US')
  const d1 = u && (count(u.d1_rows_read) || count(u.d1_rows_written)) ? `${g(u.d1_rows_read)} d1 rows read and ${g(u.d1_rows_written)} written (as the worker counts them)` : 'd1 rows not counted'
  const usage = u ? `usage: ${d1}, ${n(u.emails_sent, 'mail')} sent, ${n(u.triage_calls, 'triage call')}.` : null
  const over = (Array.isArray(p.over) ? p.over : []).filter(
    (o): o is Record<string, unknown> => !!o && typeof o === 'object' && Object.hasOwn(USAGE_NAME, String((o as { what?: unknown }).what)),
  )
  // The same factor and window as jobs/summary.ts USAGE_FACTOR and USAGE_DAYS.
  const high = over.length
    ? `over 3 times the 7-day average: ${over.map(o => `${USAGE_NAME[String(o.what)]} ${g(o.n)} (average ${g(o.avg)})`).join(', ')}.`
    : null
  return {
    subject: `shwarm${where} yesterday: ${n(total, 'request')}, ${n(p.signups, 'sign-up')}${over.length ? ` · usage high: ${over.map(o => USAGE_NAME[String(o.what)]).join(', ')}` : ''}`,
    blocks: [hi(p), line, ...(high ? [high] : []), ...(usage ? [usage] : []), 'the beta funnel:', { href: siteLink(site, p.link) }],
  }
}
const USAGE_NAME: Record<string, string> = { d1_rows_read: 'd1 rows read', d1_rows_written: 'd1 rows written', emails_sent: 'mails sent', triage_calls: 'triage calls' }

function termsNotice(p: Record<string, unknown>, site: string): Draft {
  const version = text(p, 'version')
  const effective = text(p, 'effective')
  if (!/^[0-9][0-9.]{0,15}$/.test(version)) throw new MailRenderError('bad version')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective) || Number.isNaN(Date.parse(effective))) throw new MailRenderError('bad effective date')
  if (!Array.isArray(p.changes) || !p.changes.length || !p.changes.every(x => typeof x === 'string')) throw new MailRenderError('missing changes')
  return {
    subject: "shwarm's terms are changing",
    blocks: [
      hi(p),
      `the terms and privacy notice change on ${termsDate(effective)} (v${version}). what changed:`,
      ...(p.changes as string[]).map(x => `- ${printable(oneLine(x, 500))}`),
      { href: siteLink(site, p.link) },
      "if you keep using shwarm after that date, the new terms apply. you can accept them now from the banner when you sign in. if you don't agree, you can close your account from your profile.",
    ],
  }
}

// The watchdog's alert (go-live 11.3, jobs/watch.ts): one line per alert, from counts only, then the admin queue.
// OPEN: new wording, and every threshold it names.
const WATCH_NAME: Record<string, string> = {
  outbox_late: 'mail late',
  outbox_given_up: 'mail given up',
  triage_hold_late: 'triage hold waiting',
  signups: 'sign-ups',
  errors: 'server errors',
  bounces: 'bounces',
  resend_errors: 'resend errors',
}
function watchLine(a: Record<string, unknown>): string {
  const n = (k: string) => (Number.isSafeInteger(a[k]) && (a[k] as number) >= 0 ? (a[k] as number) : 0)
  const mins = (k: string) => plural(n(k), 'minute', 'minutes')
  switch (a.kind) {
    case 'outbox_late': {
      const parts: string[] = []
      if (n('due')) parts.push(`${plural(n('due'), 'mail is', 'mails are')} due and unsent, the oldest for ${mins('oldest_due_min')}`)
      if (n('failing')) parts.push(`${plural(n('failing'), 'mail', 'mails')} failed an attempt and ${n('failing') === 1 ? 'waits' : 'wait'} to try again, the oldest written ${mins('oldest_failing_min')} ago`)
      return `mail late: ${parts.join('; ') || 'the outbox is behind'}. the cron may have stopped, or resend is refusing the key.`
    }
    case 'outbox_given_up':
      return `mail given up: the outbox gave up on ${plural(n('n'), 'mail', 'mails')} in the last hour. their last_error starts with "failed:".`
    case 'triage_hold_late':
      return `triage hold waiting: ${plural(n('n'), 'node waits', 'nodes wait')} for you, the oldest for ${mins('oldest_min')}.`
    case 'signups':
      return `sign-ups: ${n('n')} in the last hour, over ${n('limit')}.`
    case 'errors':
      return `server errors: ${n('n')} 5xx answers in the last hour, over ${n('limit')}.`
    case 'bounces':
      return `bounces: ${n('n')} addresses bounced or complained in the last day, over ${n('limit')}.`
    case 'resend_errors':
      return `resend errors: ${n('n')} of ${plural(n('calls'), 'send', 'sends')} failed in the last day (${n('percent')}%), over ${n('limit')}%. the outbox rows' last_error says why.`
  }
  throw new MailRenderError('unknown alert')
}
function watchdogAlert(p: Record<string, unknown>, site: string): Draft {
  if (!Array.isArray(p.alerts) || !p.alerts.length || !p.alerts.every(a => a && typeof a === 'object' && Object.hasOwn(WATCH_NAME, String((a as { kind?: unknown }).kind))))
    throw new MailRenderError('missing alerts')
  const alerts = p.alerts as Record<string, unknown>[]
  const where = typeof p.env === 'string' && p.env !== 'production' && /^[a-z]{1,20}$/.test(p.env) ? ` ${p.env}` : ''
  return {
    subject: `shwarm${where} needs a look: ${alerts.map(a => WATCH_NAME[String(a.kind)]).join(', ')}`,
    blocks: [hi(p), ...alerts.map(watchLine), 'each of these mails at most once an hour. the queue:', { href: siteLink(site, p.link) }],
  }
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
  node_news: (p, site) => nodeNews(p, site),
  key_new_network: (p, site) => keyNewNetwork(p, site),
  daily_summary: (p, site) => dailySummary(p, site),
  dm_report: p => dmReport(p),
  post_report: (p, site) => postReport(p, site),
  node_flag: (p, site) => nodeFlag(p, site),
  // To an account an admin suspended (go-live 9.4, core/admin-accounts.ts), with the reason they gave. Security stream:
  // it goes to a suppressed address too. OPEN (#107): new wording.
  account_suspended: p => ({
    subject: 'your shwarm account is suspended',
    blocks: [
      hi(p),
      "we suspended your shwarm account. you can't sign in, and your agent keys no longer work.",
      `the reason: ${printable(oneLine(text(p, 'reason'), 500))}`,
      'if you think this is a mistake, reply to this mail.',
    ],
  }),
  // A new terms version is announced (go-live 10.2, web/admin-switches.tsx): what changed and when it takes effect. The
  // payload is copied from the bundle when the row is queued (core/terms.ts noticePayload), so a retry sends the same
  // mail. Account stream: no unsubscribe link. OPEN (#110): new wording.
  terms_notice: (p, site) => termsNotice(p, site),
  // To each account that joined while sign-up was allow-list only (signup_wait), once shwarm opens (go-live 13.3,
  // core/opening.ts): the one mail they were promised. Account stream: no unsubscribe link. OPEN (#114): new wording.
  opening_notice: (p, site) => ({
    subject: 'shwarm is open',
    blocks: [
      hi(p),
      "shwarm is open to everyone now. you signed up while it was invite-only, and we said we'd email you when it opened.",
      'sign in here:',
      { href: siteLink(site, p.link) },
      'then find a shwarm to join:',
      { href: siteLink(site, p.feed) },
    ],
  }),
  watchdog_alert: (p, site) => watchdogAlert(p, site),
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
