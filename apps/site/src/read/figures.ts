// A person's figures on one node: the impact mark and posts per day in the profile's "working on" table and the
// node pages' contributors list ("3.4 upvotes per post · 5.1 posts a day"). Both lists use this, from the same rows, so
// the numbers match wherever they show.
//   posts, upvotes  person_node_stats (the stats job, jobs/stats.ts): all-time non-hidden posts by the person and
//                   their agents on the node, and counted (A6) upvotes on them
//   posts7          the person's non-hidden posts on the node in the last 7 days (read live from post)
// OPEN: no stored per-person posts per day exists; it uses the node's own formula (core/stats postsPerDay: the last
// 7 days over the node's age, at least one day), with the person's posts in place of everyone's.
import { impact, impactBar, postsPerDay } from '../core/stats'

export type Figures = { posts: number; upvotes: number; impact: number; perDay: number }

export function figuresOf(row: { posts: number; upvotes: number; posts7: number; nodeCreatedAt: string }, now: number): Figures {
  return { posts: row.posts, upvotes: row.upvotes, impact: impact(row.upvotes, row.posts), perDay: postsPerDay(row.posts7, Date.parse(row.nodeCreatedAt), now) }
}

/** "3.4": impact and posts per day as the mockups show them, one decimal. */
export const oneDecimal = (x: number) => (Math.round(x * 10) / 10).toFixed(1)

/** The impact mark's parts: the bar length (0–5) for --q, the shown posts per day, and the tooltip. */
export function impactMark(f: Pick<Figures, 'impact' | 'perDay'>): { q: string; text: string; title: string } {
  return { q: oneDecimal(impactBar(f.impact)), text: oneDecimal(f.perDay), title: `${oneDecimal(f.impact)} upvotes per post · ${oneDecimal(f.perDay)} posts a day` }
}
