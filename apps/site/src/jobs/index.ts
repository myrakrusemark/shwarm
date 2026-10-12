// Cron entry point. wrangler.jsonc has one trigger, every minute, in staging and production: Workers Free allows 5 cron
// triggers per account, and production's deploy hit that limit with two (Oct 10). Each minute sweeps mail, triage and
// cleanup; every fifth minute also runs stats, and the watchdog three minutes later (11.3); once a night the backup,
// once a week the disposable-domain refresh. Each job is its own waitUntil and catches its own errors, so a slow or
// failing stats run can't stop the mail sweep, though they share the invocation's CPU budget and its 50 subrequests.
import type { MailEnv } from '../email/env'
import { refreshDisposable } from '../auth/disposable'
import { countsD1, flushUsage, tallied } from '../core/d1-usage'
import { backup, BACKUP_HOUR_UTC, BACKUP_MINUTE, type BackupEnv } from './backup'
import { sweepTriage, type TriageEnv } from '../triage/run'
import { deleteUnverified, prunePlumbing, pruneReports, pruneThrottle, pruneTokens, purgeNetworks } from '../auth/cleanup'
import { pruneDms } from '../core/dm'
import { sweepDigests } from './digest'
import { sweepOutbox } from './mail'
import { rollupSite, rollupStats, siteStale } from './stats'
import { sendSummary } from './summary'
import { watchdog, WATCH_MINUTE } from './watch'
import { reportError, type SentryEnv } from '../core/sentry'

export const MAIL_CRON = '* * * * *'

export async function scheduled(event: ScheduledController, env: MailEnv & TriageEnv & BackupEnv & SentryEnv, ctx: ExecutionContext): Promise<void> {
  const at = new Date(event.scheduledTime)
  // A job that fails is logged and, where SENTRY_DSN is set, reported to Sentry by its name (core/sentry.ts).
  const failed = (job: string) => (e: unknown) => {
    console.error(`${job} failed`, e)
    ctx.waitUntil(reportError(e, { source: `cron:${job}`, route: job }, env))
  }
  // On staging and production every job's D1 rows count toward the day's usage line (go-live 11.3, core/d1-usage.ts);
  // the isolate's counts so far are written first, once a minute at most.
  if (countsD1(env)) {
    const flush = flushUsage(env.DB)
    if (flush) ctx.waitUntil(flush)
    env = { ...env, DB: tallied(env.DB) }
  }
  if (at.getUTCMinutes() % 5 === 0) {
    ctx.waitUntil(stats(env.DB, event.scheduledTime).catch(failed('stats')))
    // The admins' daily summary (go-live 11.4): once a day, queued for the next minute's mail sweep.
    ctx.waitUntil(
      sendSummary(env.DB, env.ENV).then(
        day => {
          if (day) console.log('summary', JSON.stringify({ day }))
        },
        failed('summary'),
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
        failed('watchdog'),
      ),
    )
  }
  ctx.waitUntil(
    sweepOutbox(env).then(r => {
      if (r.sent || r.skipped || r.retrying || r.failed) console.log('outbox', JSON.stringify(r))
    }, failed('outbox')),
  )
  // Triage retries and the A8 hold (go-live 8.1), apart from the mail so neither waits on the other. Its alerts go
  // out on the next minute's mail sweep.
  ctx.waitUntil(
    sweepTriage(env).then(
      r => {
        if (r.escalated || r.decided || r.errors) console.log('triage', JSON.stringify(r))
      },
      failed('triage-sweep'),
    ),
  )
  // The daily digest of mentions (go-live 6.3): from the day's digest time, a few people a minute. Its mail goes out on
  // the next minute's sweep.
  ctx.waitUntil(
    sweepDigests(env.DB, event.scheduledTime).then(
      r => {
        if (r.sent || r.passed) console.log('digest', JSON.stringify(r))
      },
      failed('digest-sweep'),
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
        failed('network-purge'),
      ),
    )
    ctx.waitUntil(
      pruneReports(env.DB).then(
        r => {
          if (r.reports || r.flags) console.log('reports', JSON.stringify(r))
        },
        failed('report-prune'),
      ),
    )
    ctx.waitUntil(
      prunePlumbing(env.DB).then(
        r => {
          if (r.idempotency || r.nonces || r.buckets) console.log('plumbing', JSON.stringify(r))
        },
        failed('plumbing-prune'),
      ),
    )
    ctx.waitUntil(
      pruneTokens(env.DB).then(
        n => {
          if (n) console.log('tokens', JSON.stringify({ email_tokens: n }))
        },
        failed('token-prune'),
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
        failed('backup'),
      ),
    )
  }
  // Mondays at 04:23 UTC: the domains the public disposable-email list gained this week (go-live 11.5).
  if (at.getUTCDay() === 1 && at.getUTCHours() === 4 && at.getUTCMinutes() === 23) {
    ctx.waitUntil(
      refreshDisposable(env.DB).then(
        r => console.log('disposable', JSON.stringify(r)),
        failed('disposable-refresh'),
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
