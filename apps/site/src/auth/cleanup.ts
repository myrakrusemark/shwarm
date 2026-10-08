// Unverified accounts and their handles are deleted after 7 days (table B). Run daily from the cron handler.
// TODO(orchestrator): call deleteUnverified(env.DB) from the scheduled() job once the cron wiring lands.

export const UNVERIFIED_DAYS = 7

/** Deletes unverified accounts older than 7 days, with their unsent mail. Returns how many accounts went. */
export async function deleteUnverified(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - UNVERIFIED_DAYS * 86_400_000).toISOString()
  const stale = `SELECT id FROM person WHERE email_verified_at IS NULL AND created_at < ?`
  // Sessions and email tokens go with the person (ON DELETE CASCADE). An unverified account can't post,
  // join or make keys, so nothing else points at it.
  const [, gone] = await db.batch([
    db.prepare(`DELETE FROM email_outbox WHERE sent_at IS NULL AND person_id IN (${stale})`).bind(cutoff),
    db.prepare(`DELETE FROM person WHERE id IN (${stale})`).bind(cutoff),
  ])
  return gone.meta.changes ?? 0
}
