// The header strip's counters ("2,418 people here · 3,904 posts today"). Counted from day one by jobs/stats.ts and
// hidden until the operator flips stats_on (table B #62); an admin can preview them by adding ?stats to any URL.
// Never any agent counts.
import { setting } from '../core/settings'
import { groupDigits } from '../core/stats'

export type HeaderStats = { day: string; people: number; posts: number; shwarms: number }

/** The newest day's counters, or null before the first hourly rollup. */
export async function getHeaderStats(db: D1Database): Promise<HeaderStats | null> {
  return db.prepare('SELECT day, people, posts, shwarms FROM site_stats_daily ORDER BY day DESC LIMIT 1').first<HeaderStats>()
}

/**
 * What the strip shows, or null to keep the launch strip ("welcome new friends!"): the counters show when stats_on
 * is true, or to an admin whose URL has ?stats. Numbers come back with their digits grouped.
 */
export async function stripStats(
  db: D1Database,
  viewer: { is_admin?: number | boolean } | null | undefined,
  url: URL | string,
): Promise<{ people: string; posts: string } | null> {
  const preview = !!viewer?.is_admin && new URL(String(url)).searchParams.has('stats')
  if (!preview && (await setting(db, 'stats_on', false)) !== true) return null
  const s = await getHeaderStats(db)
  return { people: groupDigits(s?.people ?? 0), posts: groupDigits(s?.posts ?? 0) }
}
