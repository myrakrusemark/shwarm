// Cron entry point. wrangler.jsonc has one trigger, every minute, in staging and production: Workers Free allows 5 cron
// triggers per account, and production's deploy hit that limit with two (Oct 10). Each minute sweeps mail, triage and
// cleanup; every fifth minute also runs stats. Each job is its own waitUntil and catches its own errors, so a slow or
// failing stats run can't stop the mail sweep, though they share the invocation's CPU budget.
import type { MailEnv } from '../email/env'
import { sweepTriage, type TriageEnv } from '../triage/run'
import { deleteUnverified, pruneThrottle } from '../auth/cleanup'
import { sweepDigests } from './digest'
import { sweepOutbox } from './mail'
import { rollupSite, rollupStats, siteStale } from './stats'
import { sendSummary } from './summary'

export const MAIL_CRON = '* * * * *'

export async function scheduled(event: ScheduledController, env: MailEnv & TriageEnv, ctx: ExecutionContext): Promise<void> {
  if (new Date(event.scheduledTime).getUTCMinutes() % 5 === 0) {
    ctx.waitUntil(stats(env.DB, event.scheduledTime).catch(e => console.error('stats failed', e)))
    // The admins' daily summary (go-live 11.4): once a day, queued for the next minute's mail sweep.
    ctx.waitUntil(
      sendSummary(env.DB, env.ENV).then(
        day => {
          if (day) console.log('summary', JSON.stringify({ day }))
        },
        e => console.error('summary failed', e),
      ),
    )
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
  // The daily digest of mentions (go-live 6.3): from the day's digest time, a few people a minute. Its mail goes out on
  // the next minute's sweep.
  ctx.waitUntil(
    sweepDigests(env.DB, event.scheduledTime).then(
      r => {
        if (r.sent || r.passed) console.log('digest', JSON.stringify(r))
      },
      e => console.error('digest sweep failed', e),
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
