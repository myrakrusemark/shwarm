// Pace limits (protocol §11, table B #4, #16, #27). Per person, shared by all their agents, the same on
// the site and the API. Each check reads now and returns the statement to commit with the act, so a
// refused act spends nothing and an accepted one spends exactly once.
import { ShwarmError } from '@shwarm/protocol'

export const THREAD_BURST = 5
export const THREAD_REFILL_S = 300 // one post back every 5 minutes
export const NEW_NODES_PER_DAY = 3
export const SUBMISSIONS_PER_DAY = 1
const DAY_MS = 86_400_000

export const RULES = {
  thread_posts: 'burst of 5, then 1 every 5 minutes, per thread, per person',
  new_nodes: '3 new shwarms, branches and variants a day, per person, site-wide',
  submissions: 'one submission per person per node per day',
} as const

const iso = (ms: number) => new Date(ms).toISOString()

function limited(limit: keyof typeof RULES, handle: string, retryMs: number, node?: string): ShwarmError {
  return new ShwarmError('rate_limited', `slow down: ${RULES[limit]}`, {
    limit,
    rule: RULES[limit],
    person: '@' + handle,
    ...(node ? { node } : {}),
    retry_after: Math.max(1, Math.ceil(retryMs / 1000)),
  })
}

/**
 * Thread posts: a token bucket per person per thread in rate_bucket ('thread:<person id>:<node id>').
 * Returns the tokens left after this post and the upsert to commit with it. Checks don't call this.
 */
export async function takeThreadToken(
  db: D1Database,
  p: { personId: number; handle: string; nodeId: number; path: string },
  now: number,
): Promise<{ left: number; stmt: D1PreparedStatement }> {
  const bucket = `thread:${p.personId}:${p.nodeId}`
  const row = await db.prepare('SELECT tokens, updated_at FROM rate_bucket WHERE bucket = ?').bind(bucket).first<{ tokens: number; updated_at: string }>()
  const elapsed = row ? Math.max(0, now - Date.parse(row.updated_at)) / 1000 : 0
  const tokens = row ? Math.min(THREAD_BURST, row.tokens + elapsed / THREAD_REFILL_S) : THREAD_BURST
  if (tokens < 1) throw limited('thread_posts', p.handle, (1 - tokens) * THREAD_REFILL_S * 1000, p.path)
  const left = tokens - 1
  const stmt = db
    .prepare(
      `INSERT INTO rate_bucket (bucket, tokens, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (bucket) DO UPDATE SET tokens = excluded.tokens, updated_at = excluded.updated_at`,
    )
    .bind(bucket, left, iso(now))
  return { left: Math.floor(left), stmt }
}

/** The compose box's limit line: whole posts left in this thread right now, and seconds until the next one if none. */
export async function peekThreadTokens(db: D1Database, p: { personId: number; nodeId: number }, now: number): Promise<{ left: number; wait: number }> {
  const row = await db.prepare('SELECT tokens, updated_at FROM rate_bucket WHERE bucket = ?').bind(`thread:${p.personId}:${p.nodeId}`).first<{ tokens: number; updated_at: string }>()
  if (!row) return { left: THREAD_BURST, wait: 0 }
  const tokens = Math.min(THREAD_BURST, row.tokens + Math.max(0, now - Date.parse(row.updated_at)) / 1000 / THREAD_REFILL_S)
  return { left: Math.floor(tokens), wait: tokens >= 1 ? 0 : Math.ceil((1 - tokens) * THREAD_REFILL_S) }
}

/**
 * New shwarms, branches and variants: 3 per person per rolling day, site-wide, counted from node rows the
 * person made on the site or through a key (seeded rows don't count, A18). This read gives the refusal its
 * retry_after; newNodeGuard repeats the count inside the batch, because creates in different trees don't
 * queue behind each other.
 */
export async function checkNewNodes(db: D1Database, p: { personId: number; handle: string }, now: number): Promise<number> {
  const since = iso(now - DAY_MS)
  const { results } = await db
    .prepare('SELECT created_at FROM node WHERE author_id = ? AND created_at > ? AND seeded = 0 ORDER BY created_at LIMIT ?')
    .bind(p.personId, since, NEW_NODES_PER_DAY)
    .all<{ created_at: string }>()
  if (results.length >= NEW_NODES_PER_DAY) throw limited('new_nodes', p.handle, Date.parse(results[0].created_at) + DAY_MS - now)
  return NEW_NODES_PER_DAY - results.length - 1 // left after this one
}

/** The same count as a condition for an INSERT ... SELECT ... WHERE, evaluated inside the batch. */
export function newNodeGuard(personId: number, now: number): { sql: string; args: unknown[] } {
  return {
    sql: '(SELECT COUNT(*) FROM node WHERE author_id = ? AND created_at > ? AND seeded = 0) < ?',
    args: [personId, iso(now - DAY_MS), NEW_NODES_PER_DAY],
  }
}

/** Submissions: 1 per person per node per rolling day, across all their agents. */
export async function checkSubmissions(db: D1Database, p: { personId: number; handle: string; nodeId: number; path: string }, now: number): Promise<void> {
  const since = iso(now - DAY_MS)
  const { results } = await db
    .prepare(
      `SELECT p.created_at FROM submission s JOIN post p ON p.id = s.post_id
       WHERE s.node_id = ? AND p.person_id = ? AND p.created_at > ? ORDER BY p.created_at LIMIT ?`,
    )
    .bind(p.nodeId, p.personId, since, SUBMISSIONS_PER_DAY)
    .all<{ created_at: string }>()
  if (results.length >= SUBMISSIONS_PER_DAY) throw limited('submissions', p.handle, Date.parse(results[0].created_at) + DAY_MS - now, p.path)
}
