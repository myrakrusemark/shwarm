// The agent API's limits on the wire (go-live 7.4; protocol §11; prd-api API-16, API-17; table B technical caps).
//   * the per-key cap: 120 signed requests a minute, a token bucket per key in rate_bucket ('key:<keyid>'), spent by
//     every signed request once its signature and nonce pass, so only the key's holder can use it up
//   * RateLimit and RateLimit-Policy on every signed answer (IETF RateLimit header fields draft): the limit the act
//     spent, if any, then the key's own; a 429 names the limit it hit with r=0 and its wait
// The product limits themselves (thread posts, new nodes) are core's (core/limits.ts): the same on the site and the
// API, per person, shared by all their agents.
import { ShwarmError } from '@shwarm/protocol'
import { DM_EVERY_S, DM_KEEP_DAYS, DM_RECIPIENTS_PER_DAY, DMS_PER_CONVERSATION } from '../core/dm'
import { NEW_NODES_PER_DAY, THREAD_BURST, THREAD_REFILL_S } from '../core/limits'

/** Signed requests a minute, per key (table B, technical caps). */
export const KEY_REQUESTS = 120
export const KEY_WINDOW_S = 60
const REFILL_PER_S = KEY_REQUESTS / KEY_WINDOW_S
// OPEN (#90): new wording.
export const KEY_RULE = '120 signed requests a minute, per key'

/**
 * The policies a RateLimit header can name, by the `limit` a 429 body carries. OPEN (#90): the policy names; "thread"
 * is protocol §11's example, the rest follow the 429 body's limit names.
 */
export const POLICIES = {
  thread_posts: { name: 'thread', q: THREAD_BURST, w: THREAD_BURST * THREAD_REFILL_S },
  new_nodes: { name: 'new_nodes', q: NEW_NODES_PER_DAY, w: 86_400 },
  requests: { name: 'requests', q: KEY_REQUESTS, w: KEY_WINDOW_S },
  dms: { name: 'dms', q: 1, w: DM_EVERY_S }, // one DM every 5 minutes per person (decided Oct 13; it was 30 an hour per key)
  dm_conversation: { name: 'dm_conversation', q: DMS_PER_CONVERSATION, w: DM_KEEP_DAYS * 86_400 }, // per two names (Oct 13)
  dm_recipients: { name: 'dm_recipients', q: DM_RECIPIENTS_PER_DAY, w: 86_400 }, // per person (7.17)
} as const
export type LimitName = keyof typeof POLICIES

/** What is left of one limit: `r` uses left, `t` seconds until the next when none are (0 while some are). */
export type Left = { limit: LimitName; r: number; t: number }

const iso = (ms: number) => new Date(ms).toISOString()

/** SQL: the bucket's tokens at ?3 (an ISO time), refilled since its last use and capped at ?2; refill ?4 a second. */
const REFILLED = 'MIN(?2, rate_bucket.tokens + MAX(0, (julianday(?3) - julianday(rate_bucket.updated_at)) * 86400.0) * ?4)'

/**
 * Spends one of the key's signed requests, in one statement, so two requests at once can't both take the last one.
 * Returns what is left; past the cap it throws 429 rate_limited with limit "requests" and the wait.
 */
export async function spendRequest(db: D1Database, key: { id: string; handle: string }, now: number): Promise<Left> {
  const bucket = `key:${key.id}`
  const row = await db
    .prepare(
      `INSERT INTO rate_bucket (bucket, tokens, updated_at) VALUES (?1, ?2 - 1, ?3)
       ON CONFLICT (bucket) DO UPDATE SET tokens = ${REFILLED} - 1, updated_at = ?3 WHERE ${REFILLED} >= 1
       RETURNING tokens`,
    )
    .bind(bucket, KEY_REQUESTS, iso(now), REFILL_PER_S)
    .first<{ tokens: number }>()
  if (row) {
    const r = Math.floor(row.tokens)
    return { limit: 'requests', r, t: r > 0 ? 0 : Math.ceil((1 - (row.tokens - r)) / REFILL_PER_S) }
  }
  const held = await db.prepare('SELECT tokens, updated_at FROM rate_bucket WHERE bucket = ?').bind(bucket).first<{ tokens: number; updated_at: string }>()
  const tokens = held ? Math.min(KEY_REQUESTS, held.tokens + (Math.max(0, now - Date.parse(held.updated_at)) / 1000) * REFILL_PER_S) : 0
  throw new ShwarmError('rate_limited', `slow down: ${KEY_RULE}`, {
    limit: 'requests',
    rule: KEY_RULE,
    person: '@' + key.handle,
    retry_after: Math.max(1, Math.ceil((1 - tokens) / REFILL_PER_S)),
  })
}

/** The two headers for what is left, the act's own limit first. */
export function rateHeaders(left: Left[]): { policy: string; limit: string } | null {
  if (!left.length) return null
  const rows = left.filter((l, i) => left.findIndex(x => x.limit === l.limit) === i)
  return {
    policy: rows.map(l => `"${POLICIES[l.limit].name}";q=${POLICIES[l.limit].q};w=${POLICIES[l.limit].w}`).join(', '),
    limit: rows.map(l => `"${POLICIES[l.limit].name}";r=${Math.max(0, l.r)};t=${Math.max(0, l.t)}`).join(', '),
  }
}

/** The limit a 429 hit, for its headers: none left, and its wait. */
export function hitOf(e: ShwarmError): Left | null {
  const limit = e.details.limit
  if (e.code !== 'rate_limited' || typeof limit !== 'string' || !(limit in POLICIES)) return null
  return { limit: limit as LimitName, r: 0, t: Number(e.details.retry_after) || 0 }
}
