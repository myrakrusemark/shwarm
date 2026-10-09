// Small formatters for the node pages and prompt: shortened numbers, relative times, license names.
// Platform text only; participant text goes through render/text.tsx.

/** 2100 → "2.1k", 12 → "12", 1_250_000 → "1.3m". */
export function shortNum(n: number): string {
  const a = Math.abs(n)
  if (a < 1000) return String(Math.round(n))
  if (a < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (a < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
}

/** Posts per day as the mockups print it: "14", "5.9", "0.3". */
export const perDay = (x: number) => (x >= 10 ? String(Math.round(x)) : String(Math.round(x * 10) / 10))

/** The impact mark's number, one decimal. */
export const q1 = (x: number) => (Math.round(Math.max(0, x) * 10) / 10).toFixed(1)

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/**
 * "just now", "2m ago", "3h ago", "yesterday", "6 days ago", or a date for older times. Times are UTC.
 * `short` writes days the way the mockups' threads do ("2d ago").
 */
export function ago(iso: string | null | undefined, now: number, short = false): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = now - t
  if (d < MIN) return 'just now'
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`
  if (d < 2 * DAY) return 'yesterday'
  if (d < 30 * DAY) return short ? `${Math.floor(d / DAY)}d ago` : `${Math.floor(d / DAY)} days ago`
  return iso.slice(0, 10)
}

/** The exact time for a title attribute (go-live 3.8): "2026-10-08 14:55 utc". */
export const exact = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} utc` : '')

/** Day N of being live, counting the first day as day 1. */
export const dayOf = (liveAt: string | null, now: number) => (liveAt ? Math.max(1, Math.floor((now - Date.parse(liveAt)) / DAY) + 1) : 1)

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const LICENSE_NAMES: Record<string, string> = {
  'MIT+CC-BY-4.0': 'MIT + CC BY 4.0',
  'CC-BY-4.0': 'CC BY 4.0',
  'CC-BY-SA-4.0': 'CC BY-SA 4.0',
  'CC0-1.0': 'CC0',
}
/** A license id as people read it ('MIT+CC-BY-4.0' → 'MIT + CC BY 4.0'); unknown ids as stored. */
export const licenseName = (id: string) => LICENSE_NAMES[id] ?? id

/** Cuts text to `max` characters at a word edge, with "…". */
export function cut(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  if ([...flat].length <= max) return flat
  const head = [...flat].slice(0, max - 1).join('')
  const edge = head.lastIndexOf(' ')
  return (edge > max * 0.6 ? head.slice(0, edge) : head).trimEnd() + '…'
}
