// The daily summary (go-live 11.4, decided Oct 9: "Analytics: our own counts, a funnel first, on an admin page"):
// once a day, one plain line about yesterday (UTC) to every active admin, through the outbox on the account stream:
// requests by kind, sign-ups, first posts, first submissions, checks and passes (read/beta.ts daySummary), with a link
// to /admin/analytics. The stats cron runs it every 5 minutes; from SUMMARY_HOUR_UTC on, the first run sends it.
// meta.summary_day holds the last day sent. The mail rows and the mark go in one batch, and the rows are written only
// while the mark is still behind, so two runs that overlap send one summary.
//
// It also carries yesterday's usage (go-live 11.3): D1 rows read and written (as the Worker counts them,
// core/d1-usage.ts), mail sent and triage model calls, from site_stats_daily, and names any of them that went over
// USAGE_FACTOR times its average over the USAGE_DAYS before. OPEN (#113): the factor, the floors and the history needed
// are the builder's defaults for the beta.
import { mailToAdminsStatement } from '../email/outbox'
import { daySummary } from '../read/beta'

export const SUMMARY_HOUR_UTC = 13 // morning in the Americas, afternoon in Europe; the day it covers ended 13 hours before
const KEY = 'summary_day'
const DAY = 86_400_000

export const USAGE_FACTOR = 3 // over this many times its average
export const USAGE_DAYS = 7 // the average is over this many days before yesterday
export const USAGE_MIN_DAYS = 3 // days of history needed before it can be over
// Below these, yesterday is never "over", however quiet the week was: a few mails or a few thousand reads are noise.
// Against the free plans: D1 5 million rows read and 100,000 written a day, Resend 100 mails a day.
export const USAGE_FLOOR = { d1_rows_read: 100_000, d1_rows_written: 5_000, emails_sent: 20, triage_calls: 20 }
export type UsageKind = keyof typeof USAGE_FLOOR
export type Usage = Record<UsageKind, number>
export type UsageOver = { what: UsageKind; n: number; avg: number }
const KINDS = Object.keys(USAGE_FLOOR) as UsageKind[]
// The D1 counts began with go-live 11.3 (Oct 12); a day before that reads 0 and isn't history.
const COUNTED_ONLY = new Set<UsageKind>(['d1_rows_read', 'd1_rows_written'])

/** A day's usage, and what of it went over USAGE_FACTOR times its average over the USAGE_DAYS days before. */
export async function dayUsage(db: D1Database, day: string): Promise<{ usage: Usage; over: UsageOver[] }> {
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - USAGE_DAYS * DAY).toISOString().slice(0, 10)
  const { results } = await db
    .prepare('SELECT day, d1_rows_read, d1_rows_written, emails_sent, triage_calls FROM site_stats_daily WHERE day >= ? AND day <= ? ORDER BY day')
    .bind(from, day)
    .all<Usage & { day: string }>()
  const row = results.find(r => r.day === day)
  const usage = Object.fromEntries(KINDS.map(k => [k, Math.max(0, Number(row?.[k]) || 0)])) as Usage
  const over: UsageOver[] = []
  for (const k of KINDS) {
    const before = results.filter(r => r.day < day).map(r => Math.max(0, Number(r[k]) || 0)).filter(n => n > 0 || !COUNTED_ONLY.has(k))
    if (before.length < USAGE_MIN_DAYS) continue
    const avg = before.reduce((a, n) => a + n, 0) / before.length
    if (usage[k] >= USAGE_FLOOR[k] && usage[k] > USAGE_FACTOR * avg) over.push({ what: k, n: usage[k], avg: Math.round(avg) })
  }
  return { usage, over }
}

/** The day a run at `now` should have sent, once it's due: yesterday from SUMMARY_HOUR_UTC on, else the day before. */
export function summaryDay(now: number): string {
  const today = Math.floor(now / DAY) * DAY
  const due = now >= today + SUMMARY_HOUR_UTC * 3_600_000 ? today - DAY : today - 2 * DAY
  return new Date(due).toISOString().slice(0, 10)
}

/** Queues the day's summary to the admins unless it went already. Returns the day queued, or null. */
export async function sendSummary(db: D1Database, env: string, now = Date.now()): Promise<string | null> {
  const day = summaryDay(now)
  const last = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(KEY).first<{ value: string }>()
  if (last && last.value >= day) return null
  const [s, u] = await Promise.all([daySummary(db, day), dayUsage(db, day)])
  const at = new Date(now).toISOString()
  const payload = { ...s, ...u, env, link: '/admin/analytics' }
  await db.batch([
    // One mail per active admin, only while the mark is behind `day` as the batch reaches it.
    mailToAdminsStatement(db, { template: 'daily_summary', stream: 'account', payload }, at, {
      rows: `SELECT ? AS day WHERE NOT EXISTS (SELECT 1 FROM meta WHERE key = '${KEY}' AND value >= ?)`,
      args: [day, day],
      set: `'$.day', x.day`,
    }),
    db
      .prepare(`INSERT INTO meta (key, value) VALUES ('${KEY}', ?1) ON CONFLICT (key) DO UPDATE SET value = ?1 WHERE meta.value < ?1`)
      .bind(day),
  ])
  return day
}
