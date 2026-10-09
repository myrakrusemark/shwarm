// Cron entry point. wrangler.jsonc has two triggers in staging and production, each its own invocation with its
// own CPU budget: every minute for mail, triage and cleanup, and every 5 minutes for stats, so a slow stats run can
// never take the mail sweep down with it.
import type { MailEnv } from '../email/env'
import { sweepTriage, type TriageEnv } from '../triage/run'
import { deleteUnverified, pruneThrottle } from '../auth/cleanup'
import { sweepOutbox } from './mail'
import { rollupSite, rollupStats, siteStale } from './stats'

export const MAIL_CRON = '* * * * *'
export const STATS_CRON = '*/5 * * * *'

export async function scheduled(event: ScheduledController, env: MailEnv & TriageEnv, ctx: ExecutionContext): Promise<void> {
  if (event.cron === STATS_CRON) {
    ctx.waitUntil(stats(env.DB, event.scheduledTime))
    return
  }
  ctx.waitUntil(
    sweepOutbox(env).then(r => {
      if (r.sent || r.skipped || r.retrying || r.failed) console.log('outbox', JSON.stringify(r))
    }),
  )
  // Triage retries and the A8 hold (go-live 8.1), apart from the mail so neither waits on the other. Its alerts go
  // out on the next minute's mail sweep.
  ctx.waitUntil(
    sweepTriage(env).then(
      r => {
        if (r.escalated || r.decided || r.errors) console.log('triage', JSON.stringify(r))
      },
      e => console.error('triage sweep failed', e),
    ),
  )
  // Once an hour: unverified accounts older than 7 days and their handles go (table B); old throttle rows are pruned.
  if (new Date(event.scheduledTime).getUTCMinutes() === 7) {
    ctx.waitUntil(
      Promise.all([deleteUnverified(env.DB), pruneThrottle(env.DB)]).then(([gone, pruned]) => {
        if (gone || pruned) console.log('cleanup', JSON.stringify({ unverified_deleted: gone, throttle_pruned: pruned }))
      }),
    )
  }
}

/**
 * Stats and ranking (go-live 3.7). The header counters go first and on their own: on the hour, or at the next run
 * when the last count failed or was missed. Then the node rollup, so its failing can't hold the counters back.
 */
export async function stats(db: D1Database, scheduledTime: number, now = Date.now()): Promise<void> {
  try {
    if (new Date(scheduledTime).getUTCMinutes() === 0 || (await siteStale(db, now))) await rollupSite(db, now)
  } catch (e) {
    console.error('site stats failed', e)
  }
  try {
    const r = await rollupStats(db, now)
    if (r.nodes) console.log('stats', JSON.stringify(r))
  } catch (e) {
    console.error('stats failed', e)
  }
}
