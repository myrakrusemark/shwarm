// The daily summary (go-live 11.4, decided Oct 9: "Analytics: our own counts, a funnel first, on an admin page"):
// once a day, one plain line about yesterday (UTC) to every active admin, through the outbox on the account stream:
// requests by kind, sign-ups, first posts, first submissions, checks and passes (read/beta.ts daySummary), with a link
// to /admin/beta. The stats cron runs it every 5 minutes; from SUMMARY_HOUR_UTC on, the first run sends it.
// meta.summary_day holds the last day sent. The mail rows and the mark go in one batch, and the rows are written only
// while the mark is still behind, so two runs that overlap send one summary.
import { mailToAdminsStatement } from '../email/outbox'
import { daySummary } from '../read/beta'

export const SUMMARY_HOUR_UTC = 13 // morning in the Americas, afternoon in Europe; the day it covers ended 13 hours before
const KEY = 'summary_day'
const DAY = 86_400_000

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
  const s = await daySummary(db, day)
  const at = new Date(now).toISOString()
  const payload = { ...s, env, link: '/admin/beta' }
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
