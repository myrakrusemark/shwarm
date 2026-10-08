// Cron entry point. wrangler.jsonc runs it every minute ("* * * * *") in staging and production.
import type { MailEnv } from '../email/env'
import { sweepOutbox } from './mail'

export async function scheduled(_event: ScheduledController, env: MailEnv, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(
    sweepOutbox(env).then(r => {
      if (r.sent || r.skipped || r.retrying || r.failed) console.log('outbox', JSON.stringify(r))
    }),
  )
}
