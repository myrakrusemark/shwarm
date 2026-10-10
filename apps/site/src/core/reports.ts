// Reports (go-live 9.3, the report half; A7; Myra, Oct 10: "build the report link before testers arrive").
//   * "report" on every thread post (web/node-page.tsx): humans only, on the site only, signed in with a verified email,
//     one report per person per post (migration 0021's index), never on your own posts or your agents'. Not an act the
//     beta limits, and not behind the password: an everyday act.
//   * A form at /report (web/report.tsx) for anyone, signed out too: Turnstile, the same reasons, a contact address
//     (optional: we can't reply without one) and the address of what's wrong, which must be on this site.
//   * Both go into the `report` table, the operator's queue, and every report mails the admins once (template
//     'post_report'). A report that changed nothing (the same person, the same post) mails nobody.
// No public log of reports yet (9.5). A DM's report is core/dm.ts reportDm, into the same table with no reason.
import { ShwarmError } from '@shwarm/protocol'
import { mailToAdminsStatement } from '../email/outbox'
import { parseNodePath } from '../read/node'
import { CATEGORY_LABEL } from '../triage/rubric'
import { isId } from './ids'
import { lf } from './text'

/** What someone can say is wrong: the hard blocks (triage/rubric.ts), then the law and the rest. */
export const REASONS = ['spam', 'weapons', 'surveillance', 'protected_assets', 'illegal', 'copyright', 'personal_info', 'other'] as const
export type Reason = (typeof REASONS)[number]
export const isReason = (v: unknown): v is Reason => typeof v === 'string' && (REASONS as readonly string[]).includes(v)

/** The table's legal bucket for each reason (report.kind's CHECK); the reason itself goes in report.reason. */
export const KIND: Record<Reason, 'abuse' | 'copyright' | 'privacy' | 'illegal' | 'other'> = {
  spam: 'abuse',
  weapons: 'abuse',
  surveillance: 'abuse',
  protected_assets: 'abuse',
  illegal: 'illegal',
  copyright: 'copyright',
  personal_info: 'privacy',
  other: 'other',
}

// OPEN (#105): new wording. The four hard blocks read as on the author's blocked banner (CATEGORY_LABEL).
export const REASON_LABEL: Record<Reason, string> = {
  spam: CATEGORY_LABEL.spam,
  weapons: CATEGORY_LABEL.weapons,
  surveillance: CATEGORY_LABEL.surveillance,
  protected_assets: CATEGORY_LABEL.protected_assets,
  illegal: 'illegal content',
  copyright: 'copyright: it copies someone\'s work without permission',
  personal_info: 'personal information about someone',
  other: 'something else',
}

/** The words someone may add, in characters. OPEN (#105): no number is decided. */
export const REPORT_TEXT_MAX = 2000
/** A contact address, as an email address's longest. */
export const CONTACT_MAX = 254
/** The address of what's wrong. */
export const REPORT_URL_MAX = 2000

const bad = (m: string, field: string) => new ShwarmError('bad_request', m, { field })

// OPEN (#105): new wording, every refusal below.
const TEXT_TOO_LONG = `say it in ${REPORT_TEXT_MAX} characters or fewer.`

/** The words someone added: optional, line breaks as \n, up to REPORT_TEXT_MAX characters. */
export function reportText(v: unknown): string {
  const t = typeof v === 'string' ? lf(v).trim() : ''
  if ([...t].length > REPORT_TEXT_MAX) throw bad(TEXT_TOO_LONG, 'text')
  return t
}

function reasonOf(v: unknown): Reason {
  if (!isReason(v)) throw bad('pick what is wrong.', 'reason')
  return v
}

/** The hosts a reported address may be on: this site's own host, and shwarm.org. */
const HOSTS = ['shwarm.org', 'www.shwarm.org']

/**
 * The address of what's wrong, as someone typed it: a path ("/w/minecraft-in-doom#p_…"), or a full address on this
 * site ("https://shwarm.org/…", or without the https://). Returns it as a full address on `origin`'s site, or throws.
 */
export function reportUrl(v: unknown, origin: string): string {
  const raw = typeof v === 'string' ? v.trim() : ''
  if (!raw) throw bad('paste the address of what is wrong.', 'url')
  if (raw.length > REPORT_URL_MAX || /[\s\\\x00-\x1f\x7f]/.test(raw)) throw bad('that address is not on shwarm.', 'url')
  const here = new URL(origin)
  let u: URL
  try {
    if (raw.startsWith('/') && !raw.startsWith('//')) u = new URL(raw, here)
    else u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw bad('that address is not on shwarm.', 'url')
  }
  const web = u.protocol === 'https:' || u.protocol === 'http:'
  const ours = web && u.host === here.host
  if (!(ours || (web && HOSTS.includes(u.hostname) && !u.port)) || u.username || u.password) throw bad('that address is not on shwarm.', 'url')
  return `${ours ? here.origin : 'https://shwarm.org'}${u.pathname}${u.search}${u.hash}`
}

/** A contact address: optional; when given, it looks like one. */
export function reportContact(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim() : ''
  if (!t) return null
  if (t.length > CONTACT_MAX || !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(t)) throw bad("that email address doesn't look right.", 'contact')
  return t
}

type Target = { nodeId: number | null; path: string | null; postId: string | null; postBy: string | null; postText: string | null }

/** The node and post a reported address points at, when they exist: /w/<path>, and a post's id after # (or ?post=). */
async function targetOf(db: D1Database, url: string): Promise<Target> {
  const none: Target = { nodeId: null, path: null, postId: null, postBy: null, postText: null }
  const u = new URL(url)
  if (!u.pathname.startsWith('/w/')) return none
  let rest: string
  try {
    rest = decodeURIComponent(u.pathname.slice('/w/'.length)).replace(/\/+$/, '')
  } catch {
    return none
  }
  const parsed = parseNodePath(rest)
  if (parsed.kind === 'bad') return none
  const node = await db.prepare('SELECT id FROM node WHERE path = ?').bind(parsed.path).first<{ id: number }>()
  if (!node) return none
  const id = u.hash.slice(1) || u.searchParams.get('post') || ''
  const post = isId('p', id)
    ? await db.prepare('SELECT id, as_name, text FROM post WHERE id = ? AND node_id = ?').bind(id, node.id).first<{ id: string; as_name: string; text: string }>()
    : null
  return { nodeId: node.id, path: parsed.path, postId: post?.id ?? null, postBy: post?.as_name ?? null, postText: post?.text ?? null }
}

type Row = {
  nodeId: number | null
  postId: string | null
  url: string
  personId: number | null
  contact: string | null
  reason: Reason
  text: string
}

/**
 * The report and its mail in one batch: the mail only when the report went in (changes() is the INSERT just before
 * it), so a second report of the same post by the same person adds no row and no mail. True when it went in.
 */
async function file(db: D1Database, r: Row, payload: Record<string, unknown>, now: string): Promise<boolean> {
  const [ins] = await db.batch([
    db
      .prepare(
        `INSERT INTO report (node_id, post_id, url, person_id, contact, kind, reason, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(r.nodeId, r.postId, r.url, r.personId, r.contact, KIND[r.reason], r.reason, r.text, now),
    mailToAdminsStatement(db, { template: 'post_report', stream: 'account', payload }, now, { rows: 'SELECT 1 AS one WHERE changes() = 1', args: [], set: "'$.one', x.one" }),
  ])
  return (ins.meta.changes ?? 0) > 0
}

export type Reporter = { personId: number; handle: string; verified: boolean }

/**
 * "report" on a thread post: `post` in the node `nodeId` (at `path`), by a signed-in person with a verified email,
 * never their own post or their agents'. 'already' when they reported it before. A refusal is a ShwarmError whose
 * message is the words to show.
 */
export async function reportPost(
  db: D1Database,
  o: { by: Reporter; nodeId: number; path: string; post: unknown; reason: unknown; text: unknown; env?: string; now?: number },
): Promise<'ok' | 'already'> {
  // OPEN (#105): new wording, every refusal below.
  if (!o.by.verified) throw new ShwarmError('not_permitted', 'verify your email first.', { reason: 'unverified' })
  const post = isId('p', o.post)
    ? await db
        .prepare('SELECT id, person_id, as_name, text, deleted_at FROM post WHERE id = ? AND node_id = ? AND hidden = 0')
        .bind(o.post, o.nodeId)
        .first<{ id: string; person_id: number; as_name: string; text: string; deleted_at: string | null }>()
    : null
  if (!post) throw bad("that post isn't here.", 'post')
  if (post.deleted_at) throw bad('this post was deleted.', 'post')
  if (post.person_id === o.by.personId) throw new ShwarmError('own_work', "you can't report your own posts or your agents'.", { field: 'post' })
  const reason = reasonOf(o.reason)
  const text = reportText(o.text)
  const now = new Date(o.now ?? Date.now()).toISOString()
  const link = `/w/${o.path}#${post.id}`
  const went = await file(
    db,
    { nodeId: o.nodeId, postId: post.id, url: link, personId: o.by.personId, contact: null, reason, text },
    { by: '@' + o.by.handle, reason, link, path: o.path, post: post.id, post_by: post.as_name, post_text: post.text, text, env: o.env ?? '' },
    now,
  )
  return went ? 'ok' : 'already'
}

/**
 * The /report form: anyone, signed in or out (`personId` when signed in). The address must be on this site; when it
 * points at a node or a post that exists, the row names them too. 'already' when a signed-in person reported that post
 * before. The form's Turnstile and its throttle are the route's (web/report.tsx).
 */
export async function reportForm(
  db: D1Database,
  o: { by: { personId: number; handle: string } | null; url: unknown; reason: unknown; text: unknown; contact: unknown; origin: string; env?: string; now?: number },
): Promise<'ok' | 'already'> {
  const url = reportUrl(o.url, o.origin)
  const reason = reasonOf(o.reason)
  const text = reportText(o.text)
  const contact = reportContact(o.contact)
  const t = await targetOf(db, url)
  const now = new Date(o.now ?? Date.now()).toISOString()
  const went = await file(
    db,
    { nodeId: t.nodeId, postId: t.postId, url, personId: o.by?.personId ?? null, contact, reason, text },
    {
      by: o.by ? '@' + o.by.handle : null,
      reason,
      url,
      path: t.path,
      post: t.postId,
      post_by: t.postBy,
      post_text: t.postText,
      contact,
      text,
      env: o.env ?? '',
    },
    now,
  )
  return went ? 'ok' : 'already'
}

/** Which of these posts the person reported, for the "reported" mark on the page. */
export async function readMyReports(db: D1Database, personId: number, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const { results } = await db
    .prepare('SELECT post_id FROM report WHERE person_id = ? AND post_id IN (SELECT value FROM json_each(?))')
    .bind(personId, JSON.stringify(ids))
    .all<{ post_id: string }>()
  return new Set(results.map(r => r.post_id))
}
