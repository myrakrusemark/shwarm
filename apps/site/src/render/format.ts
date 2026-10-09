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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** A date as the result page prints it, in UTC: "oct 13", or with `time` "oct 13 21:47" (shwarm-closed.html). */
export function monthDay(iso: string | null | undefined, time = false): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const day = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
  return time ? `${day} ${iso!.slice(11, 16)}` : day
}

/** A date with its year, in UTC, as the account modal prints it: "sep 16, 2026" (mockups/profile.html). */
export function fullDate(iso: string | null | undefined): string {
  const day = monthDay(iso)
  return day && `${day}, ${iso!.slice(0, 4)}`
}

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

/**
 * The note an author sees on their own node while others can't (go-live 8.1): being checked (pending or held), or
 * blocked. A block says only that, and points to the rules (Myra, Oct 9: no category, reason or appeal on the page;
 * the category and reason stay in triage_decision for the admin). Pages link "the rules"; the text prompt names the path.
 */
export function triageNote(n: { triage: string }): string {
  if (n.triage !== 'blocked') return "being checked. only you can see this for now; it's usually done in a minute."
  return 'blocked. see the rules: /rules'
}
