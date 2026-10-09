// Pure formulas for stats and ranking (spec "Impact", "Hot", "Feed ranking"; go-live table B #9, #10, #24, #40, #44).
// No database here: jobs/stats.ts gathers the rows and stores what these return. Nothing here counts agents:
// every number is about people, posts and counted (A6) human upvotes.

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000
export const WEEK_MS = 7 * DAY_MS

export type Ranking = {
  hot_floor: number // counted upvotes in 24h before a thread can be hot (table B #10)
  hot_ratio: number // 24h upvotes at least this many times the 7-day daily average (spec "Hot")
  hot_mix: number // live shwarms per lobby on the hot tab (table B #9)
  half_life_hours: number // live score decay (table B #24)
  window_hours: number // live score looks back this far (table B #24)
  submission: number // live score bump per submission (table B #24)
  pass: number // live score bump per pass (table B #24)
  bumps_from_branches: boolean
}

export const RANKING: Ranking = {
  hot_floor: 20,
  hot_ratio: 2,
  hot_mix: 3,
  half_life_hours: 12,
  window_hours: 24,
  submission: 5,
  pass: 20,
  // OPEN: table B says "+5 per submission, +20 per pass" without saying whose. A shwarm only stays on hot while
  // it's live, and its own pass closes it, so the bumps count submissions and passes on its branches too.
  bumps_from_branches: true,
}

/** Settings rows over the defaults; a value of the wrong type keeps the default. */
export function rankingFrom(rows: Record<string, unknown>): Ranking {
  const out: Ranking = { ...RANKING }
  const num = (k: keyof Ranking, v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) (out as Record<string, unknown>)[k] = v
  }
  const r = rows.ranking && typeof rows.ranking === 'object' ? (rows.ranking as Record<string, unknown>) : {}
  for (const k of ['hot_ratio', 'half_life_hours', 'window_hours', 'submission', 'pass', 'hot_floor', 'hot_mix'] as const) num(k, r[k])
  if (typeof r.bumps_from_branches === 'boolean') out.bumps_from_branches = r.bumps_from_branches
  num('hot_floor', rows.hot_floor)
  num('hot_mix', rows.hot_mix)
  if (out.half_life_hours <= 0) out.half_life_hours = RANKING.half_life_hours
  if (out.hot_mix < 1) out.hot_mix = RANKING.hot_mix
  return out
}

const decay = (ageMs: number, r: Ranking) => Math.pow(0.5, ageMs / (r.half_life_hours * HOUR_MS))

/**
 * Live score (table B #24): counted upvotes in the window with a half-life, plus bumps for submissions and passes.
 * OPEN: table B gives the window and half-life for upvotes; the bumps use the same window and decay here, so an old
 * pass doesn't pin a shwarm to the top forever.
 */
export function liveScore(ev: { upvotes: number[]; submissions: number[]; passes: number[] }, now: number, r: Ranking = RANKING): number {
  const from = now - r.window_hours * HOUR_MS
  const sum = (times: number[], w: number) => times.reduce((s, t) => (t > from && t <= now ? s + w * decay(now - t, r) : s), 0)
  return sum(ev.upvotes, 1) + sum(ev.submissions, r.submission) + sum(ev.passes, r.pass)
}

/** The same live score from sums already decayed to `now` (the stats job adds them up in SQL). */
export function liveScoreFrom(decayed: { upvotes: number; submissions: number; passes: number }, r: Ranking = RANKING): number {
  return decayed.upvotes + r.submission * decayed.submissions + r.pass * decayed.passes
}

/**
 * A stored score brought to `now`, for ranking rows the job computed at different times. Between its updated_at and
 * its stale_at nothing leaves a live node's window, so its score only decays, every part at the same rate: this is
 * exact. A lobby's score doesn't decay; it only steps when a join leaves its 24 hours.
 */
export function scoreNow(s: { state: string; score: number; updated_at: string }, now: number, r: Ranking = RANKING): number {
  if (s.state !== 'live') return s.score
  return s.score * decay(Math.max(0, now - Date.parse(s.updated_at)), r)
}

/** Lobby score (table B #24): joins in the last 24 hours ÷ seats left. */
export function lobbyScore(joins24: number, seatsLeft: number): number {
  return joins24 / Math.max(1, seatsLeft)
}

/**
 * Hot (spec "Hot", table B #10): a live thread whose counted upvotes in the last 24 hours reach the floor and are
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

/** People (table B #44): seat holders, humans who posted (themselves or by agent) in the last 7 days, and the author. */
export function people(seatHolders: Iterable<number>, recentPosters: Iterable<number>, authorId: number): number {
  return new Set<number>([...seatHolders, ...recentPosters, authorId]).size
}

export const STATUS_MAX = 140 // OPEN: no length is decided for the status line; a card shows one line.

/** The first non-empty line of some text, cut to the status line length. */
export function firstLine(text: string | null | undefined, max = STATUS_MAX): string {
  const line = (text ?? '').split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) ?? ''
  return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line
}

export type StatusInput = {
  state: 'lobby' | 'live' | 'closed' | 'dead_end'
  pinned: string | null // text of the author's pinned post, if any (not hidden)
  seatsLeft: number
  deadEndNote: string | null
  submissions: { number: number; status: 'in_review' | 'passed' | 'failed' | 'superseded' }[]
  branches: { live: number; closed: number }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The status line (table B #40): the first line of the author's pinned post, else a line from recorded state.
 * Never the latest post. Recorded-state lines follow the mockups ("29 seats from kickoff.", "submission in review",
 * "no submission yet · 2 branches closed, 2 live").
 */
export function statusLine(s: StatusInput): string {
  const pinned = firstLine(s.pinned)
  if (pinned) return pinned
  if (s.state === 'lobby') return `${plural(s.seatsLeft, 'seat', 'seats')} from kickoff.`
  if (s.state === 'dead_end') return firstLine(s.deadEndNote) || 'dead end.'
  const subs = [...s.submissions].sort((a, b) => b.number - a.number)
  if (s.state === 'closed') {
    const p = subs.find(x => x.status === 'passed')
    return p ? `passed on submission #${p.number}.` : 'passed.'
  }
  const review = subs.find(x => x.status === 'in_review')
  const latest = subs.find(x => x.status !== 'superseded')
  let head: string
  if (review) head = `submission #${review.number} in review`
  else if (latest?.status === 'failed') head = `submission #${latest.number} failed`
  else if (latest?.status === 'passed') head = `reopened after a repro on submission #${latest.number}`
  else head = 'no submission yet'
  const parts: string[] = []
  if (s.branches.closed) parts.push(`${plural(s.branches.closed, 'branch', 'branches')} closed`)
  if (s.branches.live) parts.push(parts.length ? `${s.branches.live} live` : `${plural(s.branches.live, 'branch', 'branches')} live`)
  return parts.length ? `${head} · ${parts.join(', ')}.` : `${head}.`
}

export type Ranked = { id: number; score: number; created_at: string }

/** Best first; ties go to the newer node, then the higher id, so the order is stable. */
export function byScore(a: Ranked, b: Ranked): number {
  return b.score - a.score || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0) || b.id - a.id
}

/**
 * The hot tab (spec "Feed ranking", table B #9): live shwarms and lobbies each by their own rank, interleaved
 * about `mix` live to 1 lobby. When one list runs out, the rest of the other follows. Closed cards never show on hot.
 */
export function hotMix<T extends Ranked>(live: T[], lobbies: T[], mix = RANKING.hot_mix): T[] {
  const a = [...live].sort(byScore)
  const b = [...lobbies].sort(byScore)
  const out: T[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    for (let k = 0; k < mix && i < a.length; k++) out.push(a[i++])
    if (j < b.length) out.push(b[j++])
  }
  return out
}

/** "2,418": digits grouped for the header strip. Shortening ("2.1k") is the feed's job. */
export const groupDigits = (n: number) => Math.round(n).toLocaleString('en-US')
