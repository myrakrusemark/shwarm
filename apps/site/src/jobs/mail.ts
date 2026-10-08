// The outbox sweep (go-live 2.6), run by cron every minute. It claims due rows, checks whether each may go,
// renders it and sends it through Resend, with retries and backoff.
//
// Row states (no status column, so these are the rules):
//   due        sent_at IS NULL and send_after <= now
//   sent       sent_at and provider_id set
//   not sent   sent_at set, provider_id NULL, last_error says why: 'skipped: …' (on purpose) or 'failed: …' (gave up)
// sent_at marks the row finished, so it leaves the due index either way.
import { emailKeys, emailNorm } from '../email/norm'
import type { MailEnv } from '../email/env'
import type { MailStream } from '../email/outbox'
import { REPLY_TO } from '../email/env'
import { sendViaResend } from '../email/resend'
import { MailRenderError, renderMail } from '../email/templates'
import { NOTICE_TYPE, noticeLabel, unsubToken, unsubUrl } from '../email/unsubscribe'

export const RETRY_MINUTES = [1, 5, 30, 120] // waits after attempts 1–4; attempt 5 failing gives up
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1
export const CLAIM_LEASE_MS = 5 * 60_000 // a row claimed by a sweep that dies goes again after this
export const BATCH = 20 // rows per sweep; each send is one subrequest

// Account mail caps (table B): at most 3 an hour and 10 a day to one address, across these templates.
export const CAPPED = new Set(['verify', 'reset', 'signup_existing'])
export const CAPS = [
  { scope: 'outbox:h:', limit: 3, windowMs: 3_600_000, why: 'over the hourly account mail cap' },
  { scope: 'outbox:d:', limit: 10, windowMs: 86_400_000, why: 'over the daily account mail cap' },
]

type Row = { id: number; to_email: string; person_id: number | null; template: string; stream: string; payload: string; attempts: number }
export type SweepResult = { sent: number; skipped: number; retrying: number; failed: number }

const iso = (ms: number) => new Date(ms).toISOString()

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
  // One statement claims the rows: it bumps attempts and pushes send_after past now, so an overlapping
  // sweep can't pick the same rows (D1 runs each statement alone).
  const { results: rows } = await env.DB.prepare(
    `UPDATE email_outbox SET attempts = attempts + 1, send_after = ?
     WHERE id IN (SELECT id FROM email_outbox WHERE sent_at IS NULL AND send_after <= ? AND attempts < ? ORDER BY send_after, id LIMIT ?)
       AND sent_at IS NULL AND send_after <= ?
     RETURNING id, to_email, person_id, template, stream, payload, attempts`,
  )
    .bind(iso(now + CLAIM_LEASE_MS), iso(now), MAX_ATTEMPTS, BATCH, iso(now))
    .all<Row>()
  for (const row of rows) await sendOne(env, row, now, opts.fetch ?? fetch, out)
  return out
}

async function finish(db: D1Database, id: number, now: number, lastError: string) {
  await db.prepare('UPDATE email_outbox SET sent_at = ?, last_error = ? WHERE id = ?').bind(iso(now), lastError.slice(0, 500), id).run()
}

async function sendOne(env: MailEnv, row: Row, now: number, f: typeof fetch, out: SweepResult) {
  const db = env.DB
  const payload = parseObject(row.payload)
  const why = await skipReason(env, row, payload, now)
  if (why) {
    await finish(db, row.id, now, `skipped: ${why}`)
    out.skipped++
    return
  }
  try {
    let headers: Record<string, string> | undefined
    let unsubscribe: { url: string; label: string } | undefined
    if (row.stream === 'notices') {
      // RFC 8058 one-click: mail apps POST "List-Unsubscribe=One-Click" to the https URL.
      if (!env.MAIL_SECRET) throw new Error('MAIL_SECRET is not set')
      const type = payload.notice as string
      const url = unsubUrl(env.SITE_URL, await unsubToken(env.MAIL_SECRET, row.person_id!, type, now))
      unsubscribe = { url, label: noticeLabel(type) }
      headers = { 'List-Unsubscribe': `<${url}>, <mailto:${REPLY_TO}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    }
    const mail = renderMail(row.template, payload, { siteUrl: env.SITE_URL, stream: row.stream as MailStream, unsubscribe })
    const providerId = await sendViaResend(env.RESEND_API_KEY!, { to: row.to_email, ...mail, headers }, `outbox-${env.ENV}-${row.id}`, f)
    const done = [
      db.prepare('UPDATE email_outbox SET sent_at = ?, provider_id = ?, last_error = NULL WHERE id = ?').bind(iso(now), providerId, row.id),
      db
        .prepare('INSERT INTO site_stats_daily (day, emails_sent) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET emails_sent = emails_sent + 1')
        .bind(iso(now).slice(0, 10)),
    ]
    if (CAPPED.has(row.template)) {
      const norm = emailNorm(row.to_email)
      for (const cap of CAPS) {
        // A window that has run out starts again at 1.
        done.push(
          db
            .prepare(
              `INSERT INTO auth_throttle (scope, count, window_start) VALUES (?1, 1, ?2)
               ON CONFLICT (scope) DO UPDATE SET
                 count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
                 window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END`,
            )
            .bind(cap.scope + norm, iso(now), iso(now - cap.windowMs)),
        )
      }
    }
    await db.batch(done)
    out.sent++
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof MailRenderError || row.attempts >= MAX_ATTEMPTS) {
      await finish(db, row.id, now, `failed: ${msg}`)
      out.failed++
      console.error(`outbox: gave up on row ${row.id}: ${msg}`)
    } else {
      const wait = RETRY_MINUTES[row.attempts - 1] * 60_000
      await db.prepare('UPDATE email_outbox SET send_after = ?, last_error = ? WHERE id = ?').bind(iso(now + wait), msg.slice(0, 500), row.id).run()
      out.retrying++
    }
  }
}

/** Why this row must not go, or null if it may. */
async function skipReason(env: MailEnv, row: Row, payload: Record<string, unknown>, now: number): Promise<string | null> {
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
    if (parseObject(p.notice_prefs)[type] === false) return `turned off ${type} notices`
  }
  // Checked here and counted on send. Sweeps run one a minute and finish in seconds, so overlap (which could let
  // one extra through) is rare; the page can always say "check your email" since the cap lives here.
  if (CAPPED.has(row.template)) {
    const { results } = await db
      .prepare('SELECT scope, count, window_start FROM auth_throttle WHERE scope IN (?, ?)')
      .bind(CAPS[0].scope + norm, CAPS[1].scope + norm)
      .all<{ scope: string; count: number; window_start: string }>()
    for (const cap of CAPS) {
      const r = results.find(x => x.scope === cap.scope + norm)
      if (r && r.window_start > iso(now - cap.windowMs) && r.count >= cap.limit) return cap.why
    }
  }
  return null
}
