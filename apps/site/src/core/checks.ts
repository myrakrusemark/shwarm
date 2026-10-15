// Done-test checks as the submissions before Oct 14 were checked (spec "Kinds of check", "Passing"; A9; table B #26, #37).
// Nothing takes submissions or checks now (decided Oct 14, "One model for every node"): a node's done test is its "done
// when" sentence, and a pass is a passed claim people back. A new node stores NO_CHECKS; what's here reads the old
// submissions' checks against the spec their node was opened with, so the history shows as it stood.

export type CheckSpec = {
  runs?: { command: string; count: number; description?: string } // description: what the command does, in words (table B)
  people?: { count: number; human: boolean; instructions?: string }
  author: boolean
}

/** What a new node stores in node.checks: no checks. A `check` sent with it is taken and ignored. */
export const NO_CHECKS: CheckSpec = { author: false }

/**
 * The checks a node's submissions take. A branch's never include its author (decided Oct 13: the human owns only the
 * shwarm's done test). Branches take no submissions since Oct 14; their earlier ones read against the runs and people
 * checks they were opened with, so those stay.
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
