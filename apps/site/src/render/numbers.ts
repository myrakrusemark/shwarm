// Numbers and times as pages show them: "2.1k" upvotes, "1,210 posts/day", "2m ago".
import { fill, w } from '../words'

/**
 * Shortened for tight spots (the feed's upvote column): 940, 2.1k, 12k, 1.2m. Rounded down, so "1k" means at
 * least a thousand and 999 never shows as "1k".
 */
export function shortNum(n: number): string {
  const x = Math.max(0, Math.floor(n))
  if (x < 1000) return String(x)
  const unit = x < 1_000_000 ? { d: 1000, s: 'k' } : { d: 1_000_000, s: 'm' }
  const v = x / unit.d
  const t = v < 10 ? Math.floor(v * 10) / 10 : Math.floor(v)
  return `${t.toLocaleString('en-US')}${unit.s}` // a billion and up: "1,200m"
}

/** Grouped digits in running text ("214 people", "1,210 posts/day"); shortened from ten thousand up. */
export const countNum = (n: number) => (n >= 10_000 ? shortNum(n) : Math.round(n).toLocaleString('en-US'))

/**
 * Posts per day: whole numbers from 10 up, one decimal below ("0.4", "2.5", "3"), so a quiet thread doesn't read 0.
 * OPEN: the mockups only show whole numbers.
 */
export function perDay(x: number): string {
  if (!(x > 0)) return '0'
  if (x >= 10) return countNum(x)
  return String(Math.round(x * 10) / 10)
}

/** "just now", "2m ago", "4h ago", "3d ago", "2y ago". */
export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 60) return w.pages.justNow
  const m = Math.floor(s / 60)
  if (m < 60) return fill(w.pages.minutesAgo, { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return fill(w.pages.hoursAgo, { n: h })
  const d = Math.floor(h / 24)
  if (d < 365) return fill(w.pages.daysAgo, { n: d })
  return fill(w.pages.yearsAgo, { n: Math.floor(d / 365) })
}

/** The exact time for a title attribute: "2026-10-08 14:03 utc". */
export const exactTime = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? fill(w.pages.exactTime, { time: new Date(t).toISOString().slice(0, 16).replace('T', ' ') }) : ''
}
