// Done-test checks: the spec a node is created with, and the tally that says whether a submission is
// ready for its author or has passed (spec "Kinds of check", "Passing"; A9; table B #26, #37).
import { ShwarmError } from '@shwarm/protocol'
import { hiddenProblem } from '../render/hidden'
import { lf } from './text'

export type CheckSpec = {
  runs?: { command: string; count: number; description?: string } // description: what the command does, in words (table B)
  people?: { count: number; human: boolean; instructions?: string }
  author: boolean
}

export const DEFAULT_RUNS = 2
const MAX_COUNT = 50 // decided (A25): up to 50 for any check count, so a typo can't lock a done test nobody can meet

const noTest = (m: string) => new ShwarmError('no_done_test', m)
const bad = (m: string) => new ShwarmError('bad_request', m)

const count = (v: unknown, what: string, fallback?: number): number => {
  if (v === undefined && fallback !== undefined) return fallback
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > MAX_COUNT) throw bad(`${what} must be a whole number from 1 to ${MAX_COUNT}`)
  return v as number
}

/**
 * Accepts the flat form of protocol §8 (`people: 3, human: true, instructions`) and the grouped form of
 * openapi.yaml (`people: {count, human, instructions}`). A done test names at least one check (#26). A branch's may
 * name none (`branch`; decided Oct 13: a branch's pass is its status vote, and its checks are evidence for it), and
 * a branch never keeps an author check.
 */
export function parseCheckSpec(v: unknown, opts: { branch?: boolean } = {}): CheckSpec {
  if (opts.branch && (v === undefined || v === null)) return { author: false }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw noTest('a done test says how it is checked')
  const o = v as Record<string, unknown>
  const spec: CheckSpec = { author: false }
  if (o.runs !== undefined && o.runs !== null && o.runs !== false) {
    const r = o.runs as Record<string, unknown>
    const command = lf(r?.command)
    if (typeof r !== 'object' || typeof command !== 'string' || !command.trim()) throw bad('runs need a command')
    if (command.length > 2000) throw bad('the run command is too long')
    const hidden = hiddenProblem(command, 'the run command') // Trojan Source: refused, never stored (go-live 3.3)
    if (hidden) throw bad(hidden)
    // Optional words beside the command (table B "launch-shwarms.json fields"), so the command itself stays runnable.
    let description: string | undefined
    if (r.description !== undefined && r.description !== null && r.description !== '') {
      if (typeof r.description !== 'string' || r.description.length > 2000) throw bad('runs.description is text up to 2000 characters')
      description = lf(r.description).trim() || undefined
    }
    spec.runs = { command: command.trim(), count: count(r.count, 'runs.count', DEFAULT_RUNS), ...(description ? { description } : {}) }
  }
  let human = o.human === true
  let instructions = typeof o.instructions === 'string' && o.instructions.trim() ? lf(o.instructions).trim() : undefined
  if (o.people !== undefined && o.people !== null && o.people !== 0 && o.people !== false) {
    let n: number
    if (typeof o.people === 'object') {
      const p = o.people as Record<string, unknown>
      n = count(p.count, 'people.count')
      human ||= p.human === true
      if (typeof p.instructions === 'string' && p.instructions.trim()) instructions = lf(p.instructions).trim()
    } else n = count(o.people, 'people')
    spec.people = { count: n, human, ...(instructions ? { instructions } : {}) }
  } else if (human) throw bad('"at least one human" needs a people check')
  if (instructions && instructions.length > 4000) throw bad('check instructions are too long')
  spec.author = !opts.branch && o.author === true
  if (!spec.runs && !spec.people && !spec.author && !opts.branch) throw noTest('a done test names at least one check')
  return spec
}

/**
 * The checks a node's submissions take. A branch's never include its author (decided Oct 13: the human owns only the
 * shwarm's done test, and a branch's pass is its status vote, "the shwarm itself gets locked"): its runs and people
 * checks stay, as evidence for the vote, and an author check it was opened with is left out.
 */
export const effectiveSpec = (kind: string, spec: CheckSpec): CheckSpec => (kind === 'branch' ? { ...spec, author: false } : spec)

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
