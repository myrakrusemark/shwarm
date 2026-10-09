// The outbox sweep (go-live 2.6), run by cron every minute. It claims due rows, checks whether each may go,
// renders it and sends it through Resend, with retries and backoff. A 429 from Resend holds the row (and the rest of
// that sweep's rows) until the limit ends, without using up an attempt.
//
// Row states (no status column, so these are the rules):
//   due        sent_at IS NULL and send_after <= now
//   sent       sent_at and provider_id set
//   not sent   sent_at set, provider_id NULL, last_error says why: 'skipped: …' (on purpose) or 'failed: …' (gave up)
// sent_at marks the row finished, so it leaves the due index either way. A row claimed for its last attempt and never
// finished (the sweep died) is closed by a later sweep as 'failed: the last attempt never finished'.
import { emailKeys, emailNorm } from '../email/norm'
import type { MailEnv } from '../email/env'
import type { MailStream } from '../email/outbox'
import { REPLY_TO } from '../email/env'
import { ResendError, sendViaResend } from '../email/resend'
import { MailRenderError, renderMail } from '../email/templates'
import { noticeOn, parsePrefs } from '../email/notices'
import { NOTICE_TYPE, noticeLabel, unsubToken, unsubUrl } from '../email/unsubscribe'
import { FORMER } from '../read/names'
import { SEEN_NODE, UNBLOCKED_NODE } from '../read/visibility'

export const RETRY_MINUTES = [1, 5, 30, 120] // waits after attempts 1–4; attempt 5 failing gives up
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1
export const CLAIM_LEASE_MS = 5 * 60_000 // a row claimed by a sweep that dies goes again after this
export const BATCH = 20 // rows per sweep; each send is one subrequest
// A notice about a node still waiting on triage waits too, looked at again this often, for this long after it was written.
// OPEN (#85): how long a notice waits for its node.
export const TRIAGE_RECHECK_MS = 10 * 60_000
export const TRIAGE_WAIT_MS = 3 * 86_400_000

// Account mail caps (table B): at most 3 an hour and 10 a day to one address, across these templates. The link to a
// new address in an email change counts too (go-live 6.2, OPEN #84), so the account modal can't be used to fill a
// stranger's inbox; the warning to the old address is security mail and always goes.
// Rolling windows: each capped send leaves a row in auth_throttle ('outbox:sent:<address>#<outbox id>', window_start =
// when it went), and the check counts that address's rows from the last hour and the last day.
export const CAPPED = new Set(['verify', 'reset', 'signup_existing', 'email_change_new'])
export const CAPS = [
  { limit: 3, windowMs: 3_600_000, why: 'over the hourly account mail cap' },
  { limit: 10, windowMs: 86_400_000, why: 'over the daily account mail cap' },
]
const DAY_MS = 86_400_000
// The address is followed by '#', which can't appear in a domain, so one address's range never holds another's.
const capRange = (norm: string): [string, string] => [`outbox:sent:${norm}#`, `outbox:sent:${norm}$`]

// Resend answers that mean this row can never go: a bad request or address, or a key already used for another
// body. 401 and 403 are a key or domain problem on our side, so those wait and retry like a 500.
const PERMANENT = (e: ResendError) => e.status === 400 || e.status === 422 || (e.status === 409 && e.code === 'invalid_idempotent_request')

type Row = {
  id: number
  to_email: string
  person_id: number | null
  template: string
  stream: string
  payload: string
  attempts: number
  created_at: string
}
export type SweepResult = { sent: number; skipped: number; retrying: number; failed: number }

const iso = (ms: number) => new Date(ms).toISOString()

// Set with sent_at. The closing mail (auth/close.ts) is the one row written to an address the site has just deleted:
// once it's finished, sent or not, the address and the account go from it too.
const FORGET_CLOSED = `to_email = CASE WHEN template = 'account_closed' THEN '' ELSE to_email END,
  person_id = CASE WHEN template = 'account_closed' THEN NULL ELSE person_id END`

function parseObject(s: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(s ?? '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

export async function sweepOutbox(env: MailEnv, opts: { now?: number; fetch?: typeof fetch } = {}): Promise<SweepResult> {
  const now = opts.now ?? Date.now()
  const out: SweepResult = { sent: 0, skipped: 0, retrying: 0, failed: 0 }
  if (!env.RESEND_API_KEY) {
    console.warn('outbox: RESEND_API_KEY is not set, nothing sent')
    return out
  }
  // A row claimed for its last attempt by a sweep that died can't be claimed again, so close it here.
  await env.DB.prepare(
    `UPDATE email_outbox SET sent_at = ?1, last_error = 'failed: the last attempt never finished', ${FORGET_CLOSED}
     WHERE sent_at IS NULL AND send_after <= ?1 AND attempts >= ?2`,
  )
    .bind(iso(now), MAX_ATTEMPTS)
    .run()
  // One statement claims the rows: it bumps attempts and pushes send_after past now, so an overlapping
  // sweep can't pick the same rows (D1 runs each statement alone).
  const { results: rows } = await env.DB.prepare(
    `UPDATE email_outbox SET attempts = attempts + 1, send_after = ?
     WHERE id IN (SELECT id FROM email_outbox WHERE sent_at IS NULL AND send_after <= ? AND attempts < ? ORDER BY send_after, id LIMIT ?)
       AND sent_at IS NULL AND send_after <= ?
     RETURNING id, to_email, person_id, template, stream, payload, attempts, created_at`,
  )
    .bind(iso(now + CLAIM_LEASE_MS), iso(now), MAX_ATTEMPTS, BATCH, iso(now))
    .all<Row>()
  let heldUntil: number | null = null // set once Resend says we're over a rate or quota limit
  for (const row of rows) {
    try {
      if (heldUntil != null) await hold(env.DB, row, heldUntil, null, out)
      else heldUntil = await sendOne(env, row, now, opts.fetch ?? fetch, out)
    } catch (e) {
      // Even recording the error failed (D1 down?). The row goes again when its lease ends.
      console.error(`outbox: row ${row.id} left for its lease: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}

async function finish(db: D1Database, id: number, now: number, lastError: string) {
  await db.prepare(`UPDATE email_outbox SET sent_at = ?, last_error = ?, ${FORGET_CLOSED} WHERE id = ?`).bind(iso(now), lastError.slice(0, 500), id).run()
}

/** Puts a row back until `until` without using up its attempt (a rate or quota limit isn't the row's fault). */
async function hold(db: D1Database, row: Row, until: number, msg: string | null, out: SweepResult) {
  await db
    .prepare('UPDATE email_outbox SET attempts = attempts - 1, send_after = ?, last_error = coalesce(?, last_error) WHERE id = ?')
    .bind(iso(until), msg?.slice(0, 500) ?? null, row.id)
    .run()
  out.retrying++
}

/** When to try again after a 429: Retry-After if Resend sent one, else a minute, or next UTC midnight for a quota. */
function limitEnds(e: ResendError, now: number): number {
  // OPEN: on the free plan (A12, 100 a day) a used-up quota holds mail to the next UTC midnight, and a monthly quota
  // holds it a day at a time with no end. Account links in held mail may expire before it goes.
  const midnight = (Math.floor(now / DAY_MS) + 1) * DAY_MS
  const wait = e.retryAfterMs ?? (/quota/.test(e.code) ? midnight - now : 60_000)
  return now + Math.min(Math.max(wait, 60_000), DAY_MS)
}

/** Handles one claimed row. Returns a time when Resend says to stop sending until then, else null. */
async function sendOne(env: MailEnv, row: Row, now: number, f: typeof fetch, out: SweepResult): Promise<number | null> {
  const db = env.DB
  try {
    const payload = parseObject(row.payload)
    const why = await skipReason(env, row, payload, now)
    if (typeof why === 'object' && why) {
      await hold(db, row, now + TRIAGE_RECHECK_MS, `waiting: ${why.wait}`, out)
      return null
    }
    if (why) {
      await finish(db, row.id, now, `skipped: ${why}`)
      out.skipped++
      return null
    }
    // Everything sent must be the same on every attempt, since Resend refuses a reused Idempotency-Key with a
    // different body. So the unsubscribe link is issued at the row's created_at, not now.
    const created = Date.parse(row.created_at)
    let headers: Record<string, string> | undefined
    let unsubscribe: { url: string; label: string } | undefined
    if (row.stream === 'notices') {
      // RFC 8058 one-click: mail apps POST "List-Unsubscribe=One-Click" to the https URL.
      if (!env.MAIL_SECRET) throw new Error('MAIL_SECRET is not set')
      const type = payload.notice as string
      const url = unsubUrl(env.SITE_URL, await unsubToken(env.MAIL_SECRET, row.person_id!, type, Number.isFinite(created) ? created : now))
      unsubscribe = { url, label: noticeLabel(type) }
      headers = { 'List-Unsubscribe': `<${url}>, <mailto:${REPLY_TO}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    }
    const shown = row.stream === 'notices' ? await namesNow(db, payload) : payload
    const mail = renderMail(row.template, shown, { siteUrl: env.SITE_URL, stream: row.stream as MailStream, unsubscribe })
    // Row ids start again at 1 when a database is made again, so the key carries created_at too.
    const key = `outbox-${env.ENV || 'dev'}-${row.id}-${row.created_at.replace(/\D/g, '')}`
    const providerId = await sendViaResend(env.RESEND_API_KEY!, { to: row.to_email, ...mail, headers }, key, f)
    const done = [
      db.prepare(`UPDATE email_outbox SET sent_at = ?, provider_id = ?, last_error = NULL, ${FORGET_CLOSED} WHERE id = ?`).bind(iso(now), providerId, row.id),
      db
        .prepare('INSERT INTO site_stats_daily (day, emails_sent) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET emails_sent = emails_sent + 1')
        .bind(iso(now).slice(0, 10)),
    ]
    if (CAPPED.has(row.template)) {
      const [lo, hi] = capRange(emailNorm(row.to_email))
      done.push(
        db.prepare('DELETE FROM auth_throttle WHERE scope >= ? AND scope < ? AND window_start <= ?').bind(lo, hi, iso(now - DAY_MS)),
        db.prepare('INSERT OR REPLACE INTO auth_throttle (scope, count, window_start) VALUES (?, 1, ?)').bind(lo + row.id, iso(now)),
      )
    }
    await db.batch(done)
    out.sent++
    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof ResendError && e.status === 429) {
      const until = limitEnds(e, now)
      await hold(db, row, until, msg, out)
      return until
    }
    if (e instanceof MailRenderError || (e instanceof ResendError && PERMANENT(e)) || row.attempts >= MAX_ATTEMPTS) {
      await finish(db, row.id, now, `failed: ${msg}`)
      out.failed++
      console.error(`outbox: gave up on row ${row.id}: ${msg}`)
    } else {
      const wait = RETRY_MINUTES[row.attempts - 1] * 60_000
      await db.prepare('UPDATE email_outbox SET send_after = ?, last_error = ? WHERE id = ?').bind(iso(now + wait), msg.slice(0, 500), row.id).run()
      out.retrying++
    }
    return null
  }
}

/**
 * The names in a notice as the pages show them when it goes (read/names.ts): one under a handle whose account closed
 * after the row was written reads "former member". payload.by and the digest's items[].by are stored names ('@ana',
 * '@ana/m-04'); payload.author is the bare handle of an author-gone sign-off, which the template words as "its author"
 * once it isn't a handle. A closing between two attempts changes the body, so Resend refuses the retry and the row fails.
 */
async function namesNow(db: D1Database, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handleOf = (name: unknown) => (typeof name === 'string' && name.startsWith('@') ? name.slice(1).split('/')[0] : null)
  const items = Array.isArray(payload.items) ? (payload.items as unknown[]).map(parseItem) : null
  const handles = [...new Set([handleOf(payload.by), typeof payload.author === 'string' ? payload.author : null, ...(items ?? []).map(i => handleOf(i.by))])].filter(
    (h): h is string => !!h,
  )
  if (!handles.length) return payload
  const { results } = await db
    .prepare(`SELECT handle FROM person WHERE status = 'closed' AND handle IN (${handles.map(() => '?').join(', ')})`)
    .bind(...handles)
    .all<{ handle: string }>()
  if (!results.length) return payload
  const closed = new Set(results.map(r => r.handle))
  const shown = (name: unknown) => (closed.has(handleOf(name) ?? '') ? FORMER : name)
  return {
    ...payload,
    ...('by' in payload ? { by: shown(payload.by) } : {}),
    ...(typeof payload.author === 'string' && closed.has(payload.author) ? { author: FORMER } : {}),
    ...(items ? { items: items.map(i => ({ ...i, by: shown(i.by) })) } : {}),
  }
}

const parseItem = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Not yet: put the row back for a while, without using up an attempt. */
type Wait = { wait: string }

/**
 * A notice about a node or a post (go-live 6.3) goes only while it still shows to its reader, as their inbox decides
 * (read/inbox.ts): the node (payload.path) open to them, and the post (payload.post) not hidden or deleted. A mail
 * written as the act happened can wait a minute for the sweep, and a takedown or a delete may land meanwhile.
 * A node still waiting on triage (a mention in a new shwarm, say) isn't gone: its inbox item shows once triage clears
 * it, so the mail waits for that too, up to TRIAGE_WAIT_MS after it was written.
 */
async function goneFrom(db: D1Database, personId: number, createdAt: string, payload: Record<string, unknown>, now: number): Promise<string | Wait | null> {
  if (typeof payload.path === 'string') {
    const seen = await db
      .prepare(`SELECT ${SEEN_NODE('n', '?2')} AS seen, ${UNBLOCKED_NODE('n')} AS unblocked FROM node n WHERE n.path = ?1`)
      .bind(payload.path, personId)
      .first<{ seen: number; unblocked: number }>()
    if (seen && !seen.seen && seen.unblocked && now - Date.parse(createdAt) < TRIAGE_WAIT_MS) return { wait: 'its node is still being checked' }
    if (!seen?.seen) return "its node doesn't show to them"
  }
  if (typeof payload.post === 'string') {
    const post = await db.prepare('SELECT 1 AS ok FROM post WHERE id = ? AND hidden = 0 AND deleted_at IS NULL').bind(payload.post).first()
    if (!post) return 'its post is gone'
  }
  return null
}

/** Why this row must not go, or that it must wait, or null if it may go now. */
async function skipReason(env: MailEnv, row: Row, payload: Record<string, unknown>, now: number): Promise<string | Wait | null> {
  const db = env.DB
  const [plain, norm] = emailKeys(row.to_email)
  // Staging and local dev only mail invited addresses.
  if (env.ENV !== 'production') {
    const ok = await db.prepare('SELECT 1 AS ok FROM signup_allow WHERE email_norm IN (?, ?)').bind(plain, norm).first()
    if (!ok) return `${env.ENV || 'dev'}: not on the allow-list`
  }
  // Bounced or complained addresses get security mail only.
  if (row.stream !== 'security') {
    const sup = await db.prepare('SELECT reason FROM email_suppression WHERE email_norm IN (?, ?)').bind(plain, norm).first<{ reason: string }>()
    if (sup) return `suppressed (${sup.reason})`
  }
  if (row.stream === 'notices') {
    const type = payload.notice
    if (typeof type !== 'string' || !NOTICE_TYPE.test(type)) return 'notice has no type'
    if (row.person_id == null) return 'notice has no person'
    const p = await db.prepare('SELECT status, notice_prefs FROM person WHERE id = ?').bind(row.person_id).first<{ status: string; notice_prefs: string }>()
    if (!p || p.status !== 'active') return 'account is not active'
    if (!noticeOn(parsePrefs(p.notice_prefs), type)) return `turned off ${type} notices`
    const gone = await goneFrom(db, row.person_id, row.created_at, payload, now)
    if (gone) return gone
  }
  // Checked here and counted on send. Sweeps run one a minute and finish in seconds, so overlap (which could let
  // one extra through) is rare; the page can always say "check your email" since the cap lives here.
  if (CAPPED.has(row.template)) {
    const [lo, hi] = capRange(norm)
    const sums = CAPS.map((_, i) => `coalesce(sum(window_start > ?), 0) AS c${i}`).join(', ')
    const counts = await db
      .prepare(`SELECT ${sums} FROM auth_throttle WHERE scope >= ? AND scope < ?`)
      .bind(...CAPS.map(c => iso(now - c.windowMs)), lo, hi)
      .raw<number[]>()
    for (const [i, cap] of CAPS.entries()) if ((counts[0]?.[i] ?? 0) >= cap.limit) return cap.why
  }
  return null
}
