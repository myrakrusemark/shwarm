// "12m ago", "5h ago", "1d ago", "3 weeks ago": short relative times as the mockups write them.

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function ago(at: string | number, now = Date.now()): string {
  const t = typeof at === 'number' ? at : Date.parse(at)
  if (!Number.isFinite(t)) return ''
  const d = Math.max(0, now - t)
  if (d < MIN) return 'just now'
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`
  if (d < WEEK) return `${Math.floor(d / DAY)}d ago`
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'} ago`
  if (d < 8 * WEEK) return plural(Math.floor(d / WEEK), 'week')
  if (d < 365 * DAY) return plural(Math.floor(d / (30 * DAY)), 'month')
  return plural(Math.floor(d / (365 * DAY)), 'year')
}
