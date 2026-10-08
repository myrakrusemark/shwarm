// Done-test checks: the spec a node is created with, and the tally that says whether a submission is
// ready for its author or has passed (spec "Kinds of check", "Passing"; A9; table B #26, #37).
import { ShwarmError } from '@shwarm/protocol'

export type CheckSpec = {
  runs?: { command: string; count: number }
  people?: { count: number; human: boolean; instructions?: string }
  author: boolean
}

export const DEFAULT_RUNS = 2
const MAX_COUNT = 50 // OPEN: no cap is decided; 50 keeps a typo from locking a done test nobody can meet

const noTest = (m: string) => new ShwarmError('no_done_test', m)
const bad = (m: string) => new ShwarmError('bad_request', m)

const count = (v: unknown, what: string, fallback?: number): number => {
  if (v === undefined && fallback !== undefined) return fallback
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > MAX_COUNT) throw bad(`${what} must be a whole number from 1 to ${MAX_COUNT}`)
  return v as number
}

/**
 * Accepts the flat form of protocol §8 (`people: 3, human: true, instructions`) and the grouped form of
 * openapi.yaml (`people: {count, human, instructions}`). A done test names at least one check (#26).
 */
export function parseCheckSpec(v: unknown): CheckSpec {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw noTest('a done test says how it is checked')
  const o = v as Record<string, unknown>
  const spec: CheckSpec = { author: false }
  if (o.runs !== undefined && o.runs !== null && o.runs !== false) {
    const r = o.runs as Record<string, unknown>
    if (typeof r !== 'object' || typeof r.command !== 'string' || !r.command.trim()) throw bad('runs need a command')
    if (r.command.length > 2000) throw bad('the run command is too long')
    spec.runs = { command: r.command.trim(), count: count(r.count, 'runs.count', DEFAULT_RUNS) }
  }
  let human = o.human === true
  let instructions = typeof o.instructions === 'string' && o.instructions.trim() ? o.instructions.trim() : undefined
  if (o.people !== undefined && o.people !== null && o.people !== 0 && o.people !== false) {
    let n: number
    if (typeof o.people === 'object') {
      const p = o.people as Record<string, unknown>
      n = count(p.count, 'people.count')
      human ||= p.human === true
      if (typeof p.instructions === 'string' && p.instructions.trim()) instructions = p.instructions.trim()
    } else n = count(o.people, 'people')
    spec.people = { count: n, human, ...(instructions ? { instructions } : {}) }
  } else if (human) throw bad('"at least one human" needs a people check')
  if (instructions && instructions.length > 4000) throw bad('check instructions are too long')
  spec.author = o.author === true
  if (!spec.runs && !spec.people && !spec.author) throw noTest('a done test names at least one check')
  return spec
}

/** A check already on a submission, as the tally sees it (reset checks are left out by the caller). */
export type CheckRow = { slot: 'run' | 'people' | 'author'; verdict: 'pass' | 'fail'; human: boolean }

export type Need = { runs: number; people: number; human: boolean; author: boolean }

/** What a submission needs. On the author's own submissions the author check becomes one more people check (A9). */
export function needs(spec: CheckSpec, authorSwap: boolean): Need {
  const swap = spec.author && authorSwap
  return {
    runs: spec.runs?.count ?? 0,
    people: (spec.people?.count ?? 0) + (swap ? 1 : 0),
    human: spec.people?.human ?? false,
    author: spec.author && !swap,
  }
}

export type Tally = {
  runs: number
  people: number
  human: boolean
  author: boolean
  repro: boolean // a standing fail blocks the pass (#37: only on the submission it was posted on)
  othersDone: boolean // every check but the author's has passed: the author may sign off now
  passed: boolean
}

export function tally(need: Need, rows: CheckRow[]): Tally {
  const pass = rows.filter(r => r.verdict === 'pass')
  const t = {
    runs: pass.filter(r => r.slot === 'run').length,
    people: pass.filter(r => r.slot === 'people').length,
    human: pass.some(r => r.slot === 'people' && r.human),
    author: pass.some(r => r.slot === 'author'),
    repro: rows.some(r => r.verdict === 'fail'),
  }
  const othersDone = !t.repro && t.runs >= need.runs && t.people >= need.people && (!need.human || t.human)
  return { ...t, othersDone, passed: othersDone && (!need.author || t.author) }
}
