// "related shwarms" in a shwarm page's sidebar (decided Oct 19: Myra, after rstation's "more in r/…" card: "we don't
// have subreddits, we have tags. so thats how we relate them"). The shwarms that share the most tags with this one,
// a tag counting for more the fewer shwarms carry it: shared #needs-humans, on many, counts little; a shared #heesch,
// on two, counts a lot. Then the one more people are on, then the newer. Only shwarms anyone can see (visibleSql), passed
// ones too. Branches take no tags (read/feed.ts TOP), so a branch page has no card.
//
// A signed-out page keeps its ETag for the hour (web/node-routes.tsx etagOf), so a cached copy's list is at most an hour
// behind the other shwarms' titles and people counts.
import { TOP, visibleSql } from './feed'

export const RELATED_SHOWN = 5
export const RELATED_TAGS_SHOWN = 3

export type Related = { path: string; title: string; people: number; shared: string[] }

type Row = { path: string; title: string; people: number; shared: string }

export async function readRelated(db: D1Database, n: { id: number; kind: string; tags: string[] }, limit = RELATED_SHOWN): Promise<Related[]> {
  if (n.kind === 'branch' || !n.tags.length) return []
  const { results } = await db
    .prepare(
      `WITH weight AS (
         SELECT t.tag, 1.0 / COUNT(*) AS w
         FROM node_tag t JOIN node n ON n.id = t.node_id
         WHERE t.tag IN (SELECT value FROM json_each(?1)) AND ${TOP} AND ${visibleSql('n')}
         GROUP BY t.tag
       )
       SELECT n.path, n.title, COALESCE(ns.people, 1) AS people, json_group_array(t.tag) AS shared
       FROM node_tag t
       JOIN weight w ON w.tag = t.tag
       JOIN node n ON n.id = t.node_id
       LEFT JOIN node_stats ns ON ns.node_id = n.id
       WHERE n.id <> ?2 AND ${TOP} AND ${visibleSql('n')}
       GROUP BY n.id
       ORDER BY SUM(w.w) DESC, COUNT(*) DESC, people DESC, n.created_at DESC
       LIMIT ?3`,
    )
    .bind(JSON.stringify(n.tags), n.id, limit)
    .all<Row>()
  return results.map(r => {
    let shared: string[] = []
    try {
      shared = (JSON.parse(r.shared) as unknown[]).filter((t): t is string => typeof t === 'string')
    } catch {
      // none
    }
    // in this shwarm's own order, as its head shows them
    return { path: r.path, title: r.title, people: Number(r.people), shared: n.tags.filter(t => shared.includes(t)).slice(0, RELATED_TAGS_SHOWN) }
  })
}
