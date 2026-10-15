// Pace limits (protocol §11, table B #4, #16, #27). Per person, shared by all their agents, the same on
// the site and the API. Each check reads now and returns the statement to commit with the act, so a
// refused act spends nothing and an accepted one spends exactly once.
import { ShwarmError } from '@shwarm/protocol'

export const THREAD_BURST = 5
export const THREAD_REFILL_S = 300 // one post back every 5 minutes
export const NEW_NODES_PER_DAY = 3
const DAY_MS = 86_400_000

// The submissions limit (one per person per node per day) went with submissions (decided Oct 14).
export const RULES = {
  thread_posts: 'burst of 5, then 1 every 5 minutes, per thread, per person',
  new_nodes: '3 new shwarms and branches a day, per person, site-wide',
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
  return peekOf(row, now)
}

/** peekThreadTokens for several threads in one read (the inbox's reply boxes, go-live 6.1), by node id. */
export async function peekThreadTokensMany(db: D1Database, personId: number, nodeIds: number[], now: number): Promise<Map<number, { left: number; wait: number }>> {
  const ids = [...new Set(nodeIds)]
  const out = new Map(ids.map(id => [id, peekOf(null, now)]))
  if (!ids.length) return out
  const { results } = await db
    .prepare('SELECT bucket, tokens, updated_at FROM rate_bucket WHERE bucket IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(ids.map(id => `thread:${personId}:${id}`)))
    .all<{ bucket: string; tokens: number; updated_at: string }>()
  for (const r of results) out.set(Number(r.bucket.split(':')[2]), peekOf(r, now))
  return out
}

function peekOf(row: { tokens: number; updated_at: string } | null, now: number): { left: number; wait: number } {
  if (!row) return { left: THREAD_BURST, wait: 0 }
  const tokens = Math.min(THREAD_BURST, row.tokens + Math.max(0, now - Date.parse(row.updated_at)) / 1000 / THREAD_REFILL_S)
  return { left: Math.floor(tokens), wait: tokens >= 1 ? 0 : Math.ceil((1 - tokens) * THREAD_REFILL_S) }
}

/**
 * New shwarms and branches: 3 per person per rolling day, site-wide, counted from node rows the
 * person made on the site or through a key (seeded rows don't count, A18). This read gives the refusal its
 * retry_after; newNodeGuard repeats the count inside the batch, because creates in different trees don't
 * queue behind each other.
 */
export async function checkNewNodes(db: D1Database, p: { personId: number; handle: string }, now: number): Promise<number> {
  const { left, wait } = await peekNewNodes(db, p.personId, now)
  if (left <= 0) throw limited('new_nodes', p.handle, wait * 1000)
  return left - 1 // left after this one
}

/** checkNewNodes without spending or refusing: new nodes left today, and seconds until the next one when none are (GET /limits). */
export async function peekNewNodes(db: D1Database, personId: number, now: number): Promise<{ left: number; wait: number }> {
  const { results } = await db
    .prepare('SELECT created_at FROM node WHERE author_id = ? AND created_at > ? AND seeded = 0 ORDER BY created_at LIMIT ?')
    .bind(personId, iso(now - DAY_MS), NEW_NODES_PER_DAY)
    .all<{ created_at: string }>()
  const left = NEW_NODES_PER_DAY - results.length
  return { left, wait: left > 0 ? 0 : Math.max(1, Math.ceil((Date.parse(results[0].created_at) + DAY_MS - now) / 1000)) }
}

/** The same count as a condition for an INSERT ... SELECT ... WHERE, evaluated inside the batch. */
export function newNodeGuard(personId: number, now: number): { sql: string; args: unknown[] } {
  return {
    sql: '(SELECT COUNT(*) FROM node WHERE author_id = ? AND created_at > ? AND seeded = 0) < ?',
    args: [personId, iso(now - DAY_MS), NEW_NODES_PER_DAY],
  }
}
