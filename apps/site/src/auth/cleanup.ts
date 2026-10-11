// Unverified accounts and their handles are deleted after 7 days (table B); IP and browser data goes after 30 days (#61);
// the signed-request plumbing is pruned once it can no longer matter (go-live 11.5). Run hourly from the cron handler
// (jobs/index.ts).
import { IDEMPOTENCY_TTL } from '../api/signed'

export const UNVERIFIED_DAYS = 7
/** IP-derived and browser data is kept this long (#61). */
export const NETWORK_DAYS = 30
/** Reports and flags are kept this long after they're resolved (Myra, Oct 11). Open ones stay until resolved. */
export const REPORT_DAYS = 365

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
    // Handle holds (auth/signup.ts) age out with unverified accounts, so none outlives the 7 days.
    db.prepare('DELETE FROM handle_hold WHERE created_at < ?').bind(cutoff),
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

/**
 * IP and browser data older than 30 days (#61, go-live 11.5). Sessions past their expiry go (readSession already refuses
 * them). A live session keeps sliding, but its sign-in network and browser are cleared 30 days after it began: they are
 * seen only at sign-in. A key's network goes 30 days after the key was last seen on it. Returns how many of each.
 *
 * What pruning key_network changes in api/signed.ts recordUse, by design: a key not used from a network for 30 days gets
 * "a key is used somewhere new" mail again the next time it comes from there; a key whose every network is pruned
 * treats its next network as its first, which is mailed unless its human signed in from there (signed_in_here reads
 * session.ip_prefix, cleared here 30 days after sign-in); and a network held back by the hourly pace (held_at) whose
 * key isn't used again for 30 days goes without its mail. recordUse reads key_network fresh on every request and
 * writes it with ON CONFLICT DO NOTHING and guarded UPDATEs, so a row pruned between its read and its write is
 * simply recorded again on the key's next request.
 */
export async function purgeNetworks(db: D1Database, now = Date.now()): Promise<{ sessions: number; cleared: number; networks: number }> {
  const month = new Date(now - NETWORK_DAYS * 86_400_000).toISOString()
  const [sessions, cleared, networks] = await db.batch([
    db.prepare('DELETE FROM session WHERE expires_at <= ?').bind(new Date(now).toISOString()),
    db.prepare('UPDATE session SET ip_prefix = NULL, browser = NULL WHERE created_at < ? AND (ip_prefix IS NOT NULL OR browser IS NOT NULL)').bind(month),
    db.prepare('DELETE FROM key_network WHERE last_seen < ?').bind(month),
  ])
  return { sessions: sessions.meta.changes ?? 0, cleared: cleared.meta.changes ?? 0, networks: networks.meta.changes ?? 0 }
}

/**
 * The signed-request plumbing (api/signed.ts, api/limits.ts, core/limits.ts), once a row can no longer matter
 * (go-live 11.5). Each table already lets a dead row be taken over; this deletes them. Returns how many of each went.
 *   * idempotency: a write's answer is kept 24 hours (IDEMPOTENCY_TTL), then the key may be used afresh.
 *   * sig_nonce: a nonce expires the second after its `created` leaves the 300 s window; an hour past that, so two
 *     Workers' clocks can't disagree about it.
 *   * rate_bucket: every bucket refills completely within half an hour (a thread's 5 posts at one every 5 minutes; a
 *     key's 120 requests a minute), and a missing bucket reads as full, so one untouched for a day is the same as none.
 */
export async function prunePlumbing(db: D1Database, now = Date.now()): Promise<{ idempotency: number; nonces: number; buckets: number }> {
  const iso = (ms: number) => new Date(ms).toISOString()
  const [idempotency, nonces, buckets] = await db.batch([
    db.prepare('DELETE FROM idempotency WHERE created_at <= ?').bind(iso(now - IDEMPOTENCY_TTL)),
    db.prepare('DELETE FROM sig_nonce WHERE expires_at < ?').bind(iso(now - 3600_000)),
    db.prepare('DELETE FROM rate_bucket WHERE updated_at < ?').bind(iso(now - 86_400_000)),
  ])
  return { idempotency: idempotency.meta.changes ?? 0, nonces: nonces.meta.changes ?? 0, buckets: buckets.meta.changes ?? 0 }
}

/**
 * Reports and flags a year after they were resolved (Myra, Oct 11): long enough to spot repeat abuse and answer an
 * appeal. Open ones stay. The public moderation log keeps its own rows. Once a flag is gone, its person may flag that
 * node again. Returns how many of each went.
 */
export async function pruneReports(db: D1Database, now = Date.now()): Promise<{ reports: number; flags: number }> {
  const year = new Date(now - REPORT_DAYS * 86_400_000).toISOString()
  const [reports, flags] = await db.batch([
    db.prepare('DELETE FROM report WHERE resolved_at IS NOT NULL AND resolved_at < ?').bind(year),
    db.prepare('DELETE FROM flag WHERE resolved_at IS NOT NULL AND resolved_at < ?').bind(year),
  ])
  return { reports: reports.meta.changes ?? 0, flags: flags.meta.changes ?? 0 }
}
