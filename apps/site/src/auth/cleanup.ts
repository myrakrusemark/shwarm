// Unverified accounts and their handles are deleted after 7 days (table B). Run hourly from the cron handler (jobs/index.ts).

export const UNVERIFIED_DAYS = 7

/** Deletes unverified accounts older than 7 days, with their unsent mail. Returns how many accounts went. */
export async function deleteUnverified(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - UNVERIFIED_DAYS * 86_400_000).toISOString()
  const stale = `SELECT id FROM person WHERE email_verified_at IS NULL AND created_at < ?`
  // Sessions and email tokens go with the person (ON DELETE CASCADE). An unverified account can't post,
  // join or make keys, so nothing else points at it.
  // An admin act on the account (web/admin-accounts.tsx: resend verify, suspend, …) keeps its moderation_action row,
  // which points at person: the row stays, with no account.
  const [, , gone] = await db.batch([
    db.prepare(`UPDATE moderation_action SET person_id = NULL WHERE person_id IN (${stale})`).bind(cutoff),
    db.prepare(`DELETE FROM email_outbox WHERE sent_at IS NULL AND person_id IN (${stale})`).bind(cutoff),
    db.prepare(`DELETE FROM person WHERE id IN (${stale})`).bind(cutoff),
  ])
  return gone.meta.changes ?? 0
}

/**
 * Drops throttle rows that no longer matter: windows and blocks long over (every limit is an hour or less), and
 * familiar-network stamps older than 30 days (IP-derived data is kept 30 days, #61). Returns how many went.
 */
export async function pruneThrottle(db: D1Database, now = Date.now()): Promise<number> {
  const day = new Date(now - 86_400_000).toISOString()
  const month = new Date(now - 30 * 86_400_000).toISOString()
  const r = await db
    .prepare(
      `DELETE FROM auth_throttle WHERE
         (scope LIKE '%:known:%' AND window_start < ?)
         OR (scope NOT LIKE '%:known:%' AND window_start < ? AND (blocked_until IS NULL OR blocked_until < ?))`,
    )
    .bind(month, day, day)
    .run()
  return r.meta.changes ?? 0
}
