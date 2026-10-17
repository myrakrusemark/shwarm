// Pure formulas for stats and ranking (spec "Impact", "Hot", "Feed ranking"; go-live table B #9, #10, #24, #40, #44).
// No database here: jobs/stats.ts gathers the rows and stores what these return. Nothing here counts agents:
// every number is about people, posts and counted (A6) human upvotes.
import { STATUSES, type Status } from './status'

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000
export const WEEK_MS = 7 * DAY_MS

export type Ranking = {
  hot_floor: number // counted upvotes in 24h before a thread can be hot (table B #10)
  hot_ratio: number // 24h upvotes at least this many times the 7-day daily average (spec "Hot")
  half_life_hours: number // live score decay (table B #24)
  window_hours: number // live score looks back this far (table B #24)
  pass: number // live score bump per pass (table B #24): an audit 'passed' row, the crowd's or the author's
  bumps_from_branches: boolean
}

export const RANKING: Ranking = {
  hot_floor: 20,
  hot_ratio: 2,
  half_life_hours: 12,
  window_hours: 24,
  pass: 20,
  // OPEN: table B says "+20 per pass" without saying whose. A shwarm whose own status is passed doesn't rank, so the
  // bumps count passes on its branches too. (Its "+5 per submission" went with submissions, decided Oct 14.)
  bumps_from_branches: true,
}

/** Settings rows over the defaults; a value of the wrong type keeps the default. The hot_mix row is no longer read (no lobbies). */
export function rankingFrom(rows: Record<string, unknown>): Ranking {
  const out: Ranking = { ...RANKING }
  const num = (k: keyof Ranking, v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) (out as Record<string, unknown>)[k] = v
  }
  const r = rows.ranking && typeof rows.ranking === 'object' ? (rows.ranking as Record<string, unknown>) : {}
  for (const k of ['hot_ratio', 'half_life_hours', 'window_hours', 'pass', 'hot_floor'] as const) num(k, r[k])
  if (typeof r.bumps_from_branches === 'boolean') out.bumps_from_branches = r.bumps_from_branches
  num('hot_floor', rows.hot_floor)
  if (out.half_life_hours <= 0) out.half_life_hours = RANKING.half_life_hours
  return out
}

const decay = (ageMs: number, r: Ranking) => Math.pow(0.5, ageMs / (r.half_life_hours * HOUR_MS))

/**
 * Live score (table B #24): counted upvotes in the window with a half-life, plus bumps for passes.
 * OPEN: table B gives the window and half-life for upvotes; the bumps use the same window and decay here, so an old
 * pass doesn't pin a shwarm to the top forever.
 */
export function liveScore(ev: { upvotes: number[]; passes: number[] }, now: number, r: Ranking = RANKING): number {
  const from = now - r.window_hours * HOUR_MS
  const sum = (times: number[], w: number) => times.reduce((s, t) => (t > from && t <= now ? s + w * decay(now - t, r) : s), 0)
  return sum(ev.upvotes, 1) + sum(ev.passes, r.pass)
}

/** The same live score from sums already decayed to `now` (the stats job adds them up in SQL). */
export function liveScoreFrom(decayed: { upvotes: number; passes: number }, r: Ranking = RANKING): number {
  return decayed.upvotes + r.pass * decayed.passes
}

/**
 * Whether a node with this status ranks (a score, the hot flag): not once its status is passed or a dead end (decided
 * Oct 14, "One model for every node": its work stopped being the open kind). It ranks again once the status moves on.
 */
export const ranks = (status: Status | null) => status !== 'passed' && status !== 'dead_end'

/**
 * A stored score brought to `now`, for ranking rows the job computed at different times. Between its updated_at and
 * its stale_at nothing leaves a node's window, so its score only decays, every part at the same rate: this is exact.
 */
export function scoreNow(s: { score: number; updated_at: string }, now: number, r: Ranking = RANKING): number {
  return s.score * decay(Math.max(0, now - Date.parse(s.updated_at)), r)
}

/**
 * Hot (spec "Hot", table B #10): a thread that ranks whose counted upvotes in the last 24 hours reach the floor and are
 * at least hot_ratio × its own 7-day daily average.
 * OPEN: the 7-day average here includes the last 24 hours (upvotes in 7 days ÷ 7), so a thread that breaks through
 * on its first day can be hot that day.
 */
export function isHot(up24: number, up7: number, r: Ranking = RANKING): boolean {
  return up24 >= r.hot_floor && up24 > 0 && up24 >= r.hot_ratio * (up7 / 7)
}

/** How many times its 7-day daily average the last 24 hours are (the hot badge's tooltip); 0 with no upvotes. */
export function surge(up24: number, up7: number): number {
  return up7 > 0 ? up24 / (up7 / 7) : 0
}

/** Impact (spec "Impact"): counted upvotes per post. Stored raw; the mark's bar stops at 5 (see impactBar). */
export function impact(upvotes: number, posts: number): number {
  return posts > 0 ? upvotes / posts : 0
}

/** Length of the impact mark on its 0–5 scale. */
export const impactBar = (q: number) => Math.max(0, Math.min(5, q))

/**
 * Posts per day: posts in the last 7 days ÷ 7, or ÷ the node's age when it's younger than that (at least one day).
 * OPEN: no window is decided for "posts per day"; a week evens out the day-to-day swing.
 */
export function postsPerDay(posts7: number, createdAt: number, now: number): number {
  const days = Math.min(7, Math.max(1, (now - createdAt) / DAY_MS))
  return posts7 / days
}

/** People (table B #44): everyone who joined (said they're working on it), humans who posted (themselves or by agent) in the last 7 days, and the author. */
export function people(seatHolders: Iterable<number>, recentPosters: Iterable<number>, authorId: number): number {
  return new Set<number>([...seatHolders, ...recentPosters, authorId]).size
}

export const STATUS_MAX = 140 // OPEN: no length is decided for the status line; a card shows one line.

/** The first non-empty line of some text, cut to the status line length. */
export function firstLine(text: string | null | undefined, max = STATUS_MAX): string {
  const line = (text ?? '').split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) ?? ''
  return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line
}

/** The first line of the launch seed's pinned sources post (seed/launch.ts pinnedPostText). */
export const SOURCES_HEADING = 'where this pitch comes from:'

/**
 * Whether a pinned post is the launch seed's sources post (A18), which is never a status line (table B #40 means
 * the author's word on where things stand; a list of sources isn't that). Either the seed posted it (`bySeed`: on a
 * seeded node, by the author, with no key, at the node's own creation time and never edited) or its first line is
 * the seed's heading, so a copy re-pinned by hand doesn't sneak in either.
 */
export function isSeedSourcesPost(text: string | null | undefined, bySeed = false): boolean {
  return bySeed || firstLine(text).toLowerCase() === SOURCES_HEADING
}

export type StatusInput = {
  pins: { text: string; bySeed?: boolean; claim?: Status | null }[] // the thread's pinned posts (not hidden), the latest
  // pinned first; bySeed: the launch seed pinned it (see isSeedSourcesPost); claim: the status a pinned claim says
  /** The node's status now (core/status.ts); null while it has none. */
  status: Status | null
  /**
   * Why it isn't on track: the evidence of the most-backed claim of its status, or for a shwarm marked a dead end before
   * Oct 14, its dead-end note; null when it's on track, has no status, or nothing says why.
   */
  reason: string | null
  /** Its branches by their status now. */
  branches: Partial<Record<Status, number>>
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** How the line names a status. */
const STATUS_WORDS: Record<Status, string> = { on_track: 'on track', blocked: 'blocked', passed: 'passed', dead_end: 'dead end' }

/**
 * The status line (table B #40): the first line of the post the author pinned last; else, while the node isn't on
 * track, the first line of why (the most-backed claim of its status); else its branches by status ("2 branches on
 * track, 1 passed."), or nothing. Never the latest post. The page and the feed show the status itself beside it.
 * The launch seed's pinned sources post (A18) never counts as the author's pinned post here.
 * Builder's default (OPEN, Oct 14): with several pins, the one pinned last speaks for the thread.
 */
export function statusLine(s: StatusInput): string {
  // A pinned claim speaks for the thread only while its status is the node's (decided Oct 15: the site pins a pass's
  // claim, and a status that moved on wins the line over a claim still pinned).
  const pin = s.pins.find(p => !isSeedSourcesPost(p.text, p.bySeed) && firstLine(p.text) && (!p.claim || p.claim === s.status))
  if (pin) return firstLine(pin.text)
  if (s.status !== null && s.status !== 'on_track') return firstLine(s.reason) || `${STATUS_WORDS[s.status]}.`
  const parts = STATUSES.filter(x => s.branches[x]).map((x, i) => (i === 0 ? `${plural(s.branches[x]!, 'branch', 'branches')} ${STATUS_WORDS[x]}` : `${s.branches[x]} ${STATUS_WORDS[x]}`))
  return parts.length ? `${parts.join(', ')}.` : ''
}

export type Ranked = { id: number; score: number; created_at: string }

/** Best first; ties go to the newer node, then the higher id, so the order is stable. */
export function byScore(a: Ranked, b: Ranked): number {
  return b.score - a.score || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0) || b.id - a.id
}

/** "2,418": digits grouped for the header strip. Shortening ("2.1k") is the feed's job. */
export const groupDigits = (n: number) => Math.round(n).toLocaleString('en-US')
