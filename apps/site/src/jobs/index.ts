// Cron entry point. wrangler.jsonc runs it every minute ("* * * * *") in staging and production.
import type { MailEnv } from '../email/env'
import { deleteUnverified, pruneThrottle } from '../auth/cleanup'
import { sweepOutbox } from './mail'

export async function scheduled(event: ScheduledController, env: MailEnv, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(
    sweepOutbox(env).then(r => {
      if (r.sent || r.skipped || r.retrying || r.failed) console.log('outbox', JSON.stringify(r))
    }),
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
