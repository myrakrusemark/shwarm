// Filling in a word-list entry (go-live 11.8). An entry is plain text with {name} where a value goes:
// 'made {date} · expires {expiry}'. An entry that changes with a number is { one, other }: { one: '1 post', other: '{n} posts' }.
import type { Child } from 'hono/jsx'

/** An entry that reads differently for one and for many. {n} is the number. */
export type Plural = { one: string; other: string }

const SLOT = /\{(\w+)\}/g
const english = new Intl.PluralRules('en-US')

/** The entry with each {name} replaced by its value; a {name} with no value is left as it is. */
export function fill(entry: string, vars: Record<string, string | number> = {}): string {
  return entry.replace(SLOT, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/** The same for page markup: a value may be an element (a link, a <b>), so this returns the pieces in order. */
export function fillx(entry: string, vars: Record<string, Child>): Child[] {
  const out: Child[] = []
  let at = 0
  for (const m of entry.matchAll(SLOT)) {
    if (!(m[1] in vars)) continue
    if (m.index! > at) out.push(entry.slice(at, m.index))
    out.push(vars[m[1]])
    at = m.index! + m[0].length
  }
  if (at < entry.length) out.push(entry.slice(at))
  return out
}

/** A plural entry for n: { one, other } picked by the language's rules, then filled. {n} is n as given, unless vars says otherwise. */
export function count(entry: Plural, n: number, vars: Record<string, string | number> = {}): string {
  return fill(english.select(n) === 'one' ? entry.one : entry.other, { n, ...vars })
}
