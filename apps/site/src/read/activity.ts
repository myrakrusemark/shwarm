// The activity strip above a node's thread (Myra, Oct 10, review round 2: "keep it very simple. just a visualization
// of activity above the thread"; it replaces the live campfire view). How many posts there were on each of the last
// 14 UTC days, today last: on a shwarm its own thread and every branch's, on a branch its own and its sub-branches'.
// Only posts the public can see count (not hidden, not deleted, on a node that shows to everyone with every node
// above it), so a signed-in author's held branch adds nothing. A count per day and nothing else: no names, no agents.
import { PUBLIC_NODE } from './visibility'

/** OPEN (proposed, Oct 10): 14 days, as Myra's request was built; not confirmed. */
export const ACTIVITY_DAYS = 14
const DAY_MS = 86_400_000

/** One UTC day ('2026-10-08') and its post count. */
export type ActivityDay = { day: string; posts: number }

/** The UTC date of a time, '2026-10-08'. */
export const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10)

/** The window's days, oldest first, ending with today (UTC). */
export function activityDays(now: number): string[] {
  const today = Math.floor(now / DAY_MS) * DAY_MS
  return Array.from({ length: ACTIVITY_DAYS }, (_, i) => utcDay(today - (ACTIVITY_DAYS - 1 - i) * DAY_MS))
}

/**
 * Posts per day in the window for the node and every node under it, one query: the node's tree through node_root
 * (or the node by id), each node's posts in the window through post_node (node_id, created_at). A node under this
 * one is a node of the same tree whose path starts with this one's path and a slash (exact substr, as visibility.ts).
 */
export async function readActivity(db: D1Database, n: { id: number; path: string }, rootId: number, now: number): Promise<ActivityDay[]> {
  const days = activityDays(now)
  const { results } = await db
    .prepare(
      `SELECT substr(p.created_at, 1, 10) AS day, COUNT(*) AS posts
       FROM node d JOIN post p ON p.node_id = d.id
       WHERE (d.id = ?1 OR (d.root_id = ?2 AND substr(d.path, 1, length(?3) + 1) = ?3 || '/'))
         AND ${PUBLIC_NODE('d')}
         AND p.created_at >= ?4 AND p.hidden = 0 AND p.deleted_at IS NULL
       GROUP BY day`,
    )
    .bind(n.id, rootId, n.path, days[0])
    .all<ActivityDay>()
  const by = new Map(results.map(r => [r.day, r.posts]))
  return days.map(day => ({ day, posts: by.get(day) ?? 0 }))
}
