// A submission's check list as the node page and the agent prompt show it: the standing checks, then a
// "waiting" row for every slot still open (spec "Kinds of check"; A9 swaps the author check for one more people check).
import { needs, type CheckSpec } from '../core/checks'
import { statusLine, type StatusInput } from '../core/stats'
import type { Child, CheckReport, NodeHead, SubmissionRow } from './node'

export type ReviewRow =
  | { verdict: 'pass' | 'fail'; slot: CheckReport['slot']; as: string; check: CheckReport }
  | { verdict: 'waiting'; slot: CheckReport['slot']; as: string | null; human?: boolean }

export type Review = { rows: ReviewRow[]; done: number; total: number; waitingOn: 'checks' | 'author' | null; failed: boolean }

export function review(spec: CheckSpec, author: string, sub: SubmissionRow, checks: CheckReport[]): Review {
  const need = needs(spec, sub.author_swap === 1)
  const pass = (slot: CheckReport['slot']) => checks.filter(c => c.slot === slot && c.verdict === 'pass').length
  const runs = pass('run')
  const people = pass('people')
  const authorDone = pass('author') > 0
  const humanDone = checks.some(c => c.slot === 'people' && c.verdict === 'pass' && c.human === 1)
  const rows: ReviewRow[] = checks.map(c => ({ verdict: c.verdict, slot: c.slot, as: c.as_name, check: c }))
  for (let i = runs; i < need.runs; i++) rows.push({ verdict: 'waiting', slot: 'run', as: null })
  for (let i = people; i < need.people; i++) rows.push({ verdict: 'waiting', slot: 'people', as: null, human: need.human && !humanDone && i === people })
  if (need.author && !authorDone) rows.push({ verdict: 'waiting', slot: 'author', as: author })
  const total = need.runs + need.people + (need.author ? 1 : 0)
  const done = Math.min(runs, need.runs) + Math.min(people, need.people) + (need.author && authorDone ? 1 : 0)
  const failed = checks.some(c => c.verdict === 'fail')
  const othersDone = runs >= need.runs && people >= need.people && (!need.human || humanDone)
  const waitingOn = sub.status !== 'in_review' || failed ? null : othersDone ? (need.author && !authorDone ? 'author' : null) : 'checks'
  return { rows, done, total, waitingOn, failed }
}

/** The submission collecting checks now, if any. */
export const inReview = (subs: SubmissionRow[]) => subs.find(s => s.status === 'in_review') ?? null

/** The status line from recorded state (table B #40, without the pinned post: the page shows that post itself). */
export function recordedStatus(n: NodeHead, subs: SubmissionRow[], branches: Child[], seatsFilled: number): string {
  const s: StatusInput = {
    state: n.state,
    pinned: null,
    seatsLeft: Math.max(0, (n.lobby_size ?? 0) - seatsFilled),
    deadEndNote: n.dead_end_note,
    submissions: subs.map(x => ({ number: x.number, status: x.status })),
    branches: { live: branches.filter(b => b.state === 'live').length, closed: branches.filter(b => b.state === 'closed').length },
  }
  return statusLine(s)
}
