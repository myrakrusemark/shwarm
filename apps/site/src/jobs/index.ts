// Cron entry point. wrangler.jsonc has one trigger, every minute, in staging and production: Workers Free allows 5 cron
// triggers per account, and production's deploy hit that limit with two (Oct 10). Each minute sweeps mail, triage and
// cleanup; every fifth minute also runs stats, and the watchdog three minutes later (11.3); once a night the backup,
// once a week the disposable-domain refresh. Each job is its own waitUntil and catches its own errors, so a slow or
// failing stats run can't stop the mail sweep, though they share the invocation's CPU budget and its 50 subrequests.
import type { MailEnv } from '../email/env'
import { refreshDisposable } from '../auth/disposable'
import { backup, BACKUP_HOUR_UTC, BACKUP_MINUTE, type BackupEnv } from './backup'
import { sweepTriage, type TriageEnv } from '../triage/run'
import { deleteUnverified, prunePlumbing, pruneReports, pruneThrottle, pruneTokens, purgeNetworks } from '../auth/cleanup'
import { pruneDms } from '../core/dm'
import { sweepDigests } from './digest'
import { sweepOutbox } from './mail'
import { rollupSite, rollupStats, siteStale } from './stats'
import { sendSummary } from './summary'
import { watchdog, WATCH_MINUTE } from './watch'

export const MAIL_CRON = '* * * * *'

export async function scheduled(event: ScheduledController, env: MailEnv & TriageEnv & BackupEnv, ctx: ExecutionContext): Promise<void> {
  const at = new Date(event.scheduledTime)
  if (at.getUTCMinutes() % 5 === 0) {
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
  // The watchdog (go-live 11.3, jobs/watch.ts): every 5 minutes, apart from the stats run, on staging and production
  // only. It mails the admins about late or given-up mail, a triage hold waiting, or a burst of sign-ups, 5xx answers or
  // bounces; each kind at most once an hour, and a few mails a day at most. Its mail goes on the next minute's sweep.
  if (at.getUTCMinutes() % 5 === WATCH_MINUTE && (env.ENV === 'staging' || env.ENV === 'production')) {
    ctx.waitUntil(
      watchdog(env, event.scheduledTime).then(
        r => {
          if (r.firing.length) console.log('watchdog', JSON.stringify(r))
        },
        e => console.error('watchdog failed', e),
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
  // Once an hour: unverified accounts older than 7 days and their handles go (table B); old throttle rows are pruned;
  // direct messages older than 30 days are deleted (7.17). Then, on their own so neither holds the other back (go-live
  // 11.5): IP and browser data older than 30 days (#61), the signed-request plumbing that can no longer matter, and
  // reports and flags a year after they were resolved, and emailed links an hour after they were used or expired.
  if (at.getUTCMinutes() === 7) {
    ctx.waitUntil(
      Promise.all([deleteUnverified(env.DB), pruneThrottle(env.DB), pruneDms(env.DB)]).then(([gone, pruned, dms]) => {
        if (gone || pruned || dms) console.log('cleanup', JSON.stringify({ unverified_deleted: gone, throttle_pruned: pruned, dms_deleted: dms }))
      }),
    )
    ctx.waitUntil(
      purgeNetworks(env.DB).then(
        r => {
          if (r.sessions || r.cleared || r.networks) console.log('networks', JSON.stringify(r))
        },
        e => console.error('network purge failed', e),
      ),
    )
    ctx.waitUntil(
      pruneReports(env.DB).then(
        r => {
          if (r.reports || r.flags) console.log('reports', JSON.stringify(r))
        },
        e => console.error('report prune failed', e),
      ),
    )
    ctx.waitUntil(
      prunePlumbing(env.DB).then(
        r => {
          if (r.idempotency || r.nonces || r.buckets) console.log('plumbing', JSON.stringify(r))
        },
        e => console.error('plumbing prune failed', e),
      ),
    )
    ctx.waitUntil(
      pruneTokens(env.DB).then(
        n => {
          if (n) console.log('tokens', JSON.stringify({ email_tokens: n }))
        },
        e => console.error('token prune failed', e),
      ),
    )
  }
  // Nightly at 03:17 UTC: the backup to R2 (go-live 11.1). Skipped, with a log line, without the BACKUPS binding.
  if (at.getUTCHours() === BACKUP_HOUR_UTC && at.getUTCMinutes() === BACKUP_MINUTE) {
    ctx.waitUntil(
      backup(env, event.scheduledTime).then(
        r => {
          if (r) console.log('backup', JSON.stringify(r))
        },
        e => console.error('backup failed', e),
      ),
    )
  }
  // Mondays at 04:23 UTC: the domains the public disposable-email list gained this week (go-live 11.5).
  if (at.getUTCDay() === 1 && at.getUTCHours() === 4 && at.getUTCMinutes() === 23) {
    ctx.waitUntil(
      refreshDisposable(env.DB).then(
        r => console.log('disposable', JSON.stringify(r)),
        e => console.error('disposable refresh failed', e),
      ),
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
