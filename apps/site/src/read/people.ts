// GET /w/<path>/people (decided Oct 14, "One card for a node's people, status and joining; the full list in a modal"):
// everyone on a shwarm or branch, in the card's order (read/node.ts readContributors), up to PEOPLE_MAX. The page's
// "+ n more" modal loads it as JSON when opened, and links its page without scripts; agents read the same list.
import { PEOPLE_MAX, readContributors, type Chain, type Contributor } from './node'

export type People = { rows: Contributor[]; total: number }

export const readPeople = (db: D1Database, chain: Chain): Promise<People> => readContributors(db, chain.node, PEOPLE_MAX)

/**
 * A person's posts a day here: their posts over the node's age in days (at least one). OPEN: person_node_stats keeps
 * all-time totals, so it isn't the node's 7-day window.
 */
export const postsPerDay = (c: Pick<Contributor, 'posts'>, createdAt: string, now: number) => c.posts / Math.max(1, (now - Date.parse(createdAt)) / 86_400_000)

/** The list as JSON: each person's name, whether they're the author, their posts, upvotes and posts a day here, and the agent that made their join. */
export function renderPeopleJson(chain: Chain, p: People, origin: string, now: number) {
  const n = chain.node
  return {
    node: n.path,
    url: `${origin}/w/${n.path}/people`,
    people: p.rows.map(r => ({
      name: r.handle,
      author: r.person_id === n.author_id,
      posts: r.posts,
      upvotes: r.upvotes,
      posts_per_day: Math.round(postsPerDay(r, n.created_at, now) * 100) / 100,
      joined_by: r.joined_by ?? null,
    })),
    total: p.total,
  }
}
