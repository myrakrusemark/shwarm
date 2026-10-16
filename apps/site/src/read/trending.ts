// The trending row on the home feed (decided Oct 15: Myra picked mockup a, "a is fantastic. i like the trending"): the
// tags on the most live shwarms, each with how many, over the sort line, labelled "trending/skills/topics". Tags are
// free hashtags for anything a person might look for (skills, topics, places, languages), so the row is also the
// site's list of who and what the live shwarms need.
//
// Counted over the shwarms the live tab lists (read/feed.ts): shwarms anyone can see (visibleSql: not hidden, cleared or
// seeded), whose status isn't passed; dead ends count, as the live tab lists them, so a tag's number is the number of
// cards its filter shows. Branches take no tags. #needs-humans (core/tags.ts) is pinned first whatever its count.
//
// One grouped query over node_tag, remembered for TRENDING_MEMO_MS per database in this isolate, the same minute the
// front door lets a shared cache keep its answer (s-maxage=60), so a busy home page doesn't count every tag on every
// view.
import { NEEDS_HUMANS } from '../core/tags'
import { TAB_SQL, TOP, visibleSql } from './feed'

export type TrendingTag = { tag: string; shwarms: number }
export type Trending = {
  /** Every tag on a live shwarm, #needs-humans first, then most shwarms first, then a to z. */
  ranked: TrendingTag[]
  /** What the row shows: tags on SHOW_MIN or more live shwarms (#needs-humans on any), up to SHOW_TOP. */
  top: TrendingTag[]
  /** The rest, most used first, up to REST_MAX: behind "+ n more tags". */
  rest: TrendingTag[]
  /** How many tags the rest has in all (ranked minus top), REST_MAX or not: the number "+ n more tags" says. */
  restTotal: number
}

export const SHOW_TOP = 16 // Myra's mockup a: tags on 2 or more live shwarms, up to 16
export const SHOW_MIN = 2
export const REST_MAX = 300 // builder's default: the hidden list stops here, so the page stays small as tags grow (the launch cards have about 200)
export const TRENDING_MEMO_MS = 60_000

const memo = new WeakMap<D1Database, { at: number; value: Trending }>()

/** For tests, and after a write that should show at once. */
export function forgetTrending(db?: D1Database): void {
  if (db) memo.delete(db)
}

/** Orders counted tags: #needs-humans first, then most shwarms, then a to z. */
export function rankTags(counts: TrendingTag[]): Trending {
  const ranked = [...counts].sort(
    (a, b) => Number(b.tag === NEEDS_HUMANS) - Number(a.tag === NEEDS_HUMANS) || b.shwarms - a.shwarms || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0),
  )
  const top = ranked.filter(t => t.shwarms >= SHOW_MIN || t.tag === NEEDS_HUMANS).slice(0, SHOW_TOP)
  const shown = new Set(top.map(t => t.tag))
  const all = ranked.filter(t => !shown.has(t.tag))
  return { ranked, top, rest: all.slice(0, REST_MAX), restTotal: all.length }
}

/** The trending tags across live shwarms. */
export async function loadTrending(db: D1Database, now = Date.now()): Promise<Trending> {
  const m = memo.get(db)
  if (m && now - m.at >= 0 && now - m.at < TRENDING_MEMO_MS) return m.value
  const { results } = await db
    .prepare(
      `SELECT t.tag AS tag, COUNT(*) AS shwarms
       FROM node_tag t
       JOIN node n ON n.id = t.node_id
       LEFT JOIN branch_status bs ON bs.node_id = n.id
       WHERE ${TOP} AND ${visibleSql('n')} AND ${TAB_SQL.live}
       GROUP BY t.tag`,
    )
    .all<TrendingTag>()
  const value = rankTags(results.map(r => ({ tag: r.tag, shwarms: Number(r.shwarms) })))
  memo.set(db, { at: now, value })
  return value
}

/** How many live shwarms carry this tag (0 when none do). */
export const shwarmsTagged = (t: Trending, tag: string): number => t.ranked.find(x => x.tag === tag)?.shwarms ?? 0
