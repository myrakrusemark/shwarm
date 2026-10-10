// A submission's check list as the node page and the agent prompt show it: the standing checks, then a
// "waiting" row for every slot still open (spec "Kinds of check"; A9 swaps the author check for one more people check).
import { needs, tally, type CheckSpec, type Need, type Tally } from '../core/checks'
import { statusLine, type StatusInput } from '../core/stats'
import type { Child, CheckReport, NodeHead, SubmissionRow } from './node'

export type ReviewRow =
  | { verdict: 'pass' | 'fail'; slot: CheckReport['slot']; as: string; check: CheckReport }
  | { verdict: 'waiting'; slot: CheckReport['slot']; as: string | null; human?: boolean }

export type Review = {
  rows: ReviewRow[]
  done: number
  total: number
  waitingOn: 'checks' | 'author' | null
  failed: boolean
  need: Need
  tally: Tally
  counts: { runs: number; people: number; author: number } // passes that count toward each slot's "n of m"
}

/**
 * The tally is core's (core/checks.ts tally), the one that decides a pass, so what the pages say can't drift from
 * what core does. `checks` are the standing ones: reset checks never count.
 */
export function review(spec: CheckSpec, author: string, sub: SubmissionRow, checks: CheckReport[]): Review {
  const need = needs(spec, sub.author_swap === 1)
  const t = tally(need, checks.map(c => ({ slot: c.slot, verdict: c.verdict, human: c.human === 1 })))
  // "at least one human": until a human's pass is in, one people slot stays open for them, whatever the agents passed.
  const counts = {
    runs: Math.min(t.runs, need.runs),
    people: Math.min(t.people, need.people - (need.human && !t.human ? 1 : 0)),
    author: need.author && t.author ? 1 : 0,
  }
  const rows: ReviewRow[] = checks.map(c => ({ verdict: c.verdict, slot: c.slot, as: c.as_name, check: c }))
  for (let i = counts.runs; i < need.runs; i++) rows.push({ verdict: 'waiting', slot: 'run', as: null })
  for (let i = counts.people; i < need.people; i++) rows.push({ verdict: 'waiting', slot: 'people', as: null, human: need.human && !t.human && i === counts.people })
  if (need.author && !t.author) rows.push({ verdict: 'waiting', slot: 'author', as: author })
  const total = need.runs + need.people + (need.author ? 1 : 0)
  const done = counts.runs + counts.people + counts.author
  const waitingOn = sub.status !== 'in_review' || t.repro ? null : t.othersDone ? (need.author && !t.author ? 'author' : null) : 'checks'
  return { rows, done, total, waitingOn, failed: t.repro, need, tally: t, counts }
}

export type SlotGroup = { slot: CheckReport['slot']; label: 'runs' | 'people' | 'author'; rows: ReviewRow[]; done: number; of: number }

/**
 * The submission page's three groups (runs, people, author), each with its own "n of m". A group shows when the done
 * test asks for it or a check landed in it. The author group's count is 0 or 1. `extra` rows (the checks an author's
 * fail reset) go last in their group and never count.
 */
export function groupBySlot(r: Review, extra: ReviewRow[] = []): SlotGroup[] {
  const groups: SlotGroup[] = [
    { slot: 'run', label: 'runs', rows: [], done: r.counts.runs, of: r.need.runs },
    { slot: 'people', label: 'people', rows: [], done: r.counts.people, of: r.need.people },
    { slot: 'author', label: 'author', rows: [], done: r.counts.author, of: r.need.author ? 1 : 0 },
  ]
  for (const row of [...r.rows, ...extra]) groups.find(g => g.slot === row.slot)!.rows.push(row)
  return groups.filter(g => g.of > 0 || g.rows.length > 0)
}

/** Whole days since `at` (the author was asked to sign off), from 1 up; null under a day (table B #57: "waiting N days"). */
export function waitingDays(at: string | null, now: number): number | null {
  if (!at) return null
  const d = Math.floor((now - Date.parse(at)) / 86_400_000)
  return d >= 1 ? d : null
}

/** The submission whose status is in_review, if any (it may sit on a dead end, where it collects nothing). */
export const inReview = (subs: SubmissionRow[]) => subs.find(s => s.status === 'in_review') ?? null

/**
 * The submission collecting checks now: in review on a live node. A dead end keeps its submission's in_review
 * status (reopening picks the review back up), but takes no checks meanwhile, so it has no open review.
 */
export const openReview = (n: { state: NodeHead['state'] }, subs: SubmissionRow[]) => (n.state === 'live' ? inReview(subs) : null)

/** Whether this submission is the one collecting checks (see openReview). */
export const isOpen = (n: { state: NodeHead['state'] }, sub: SubmissionRow) => n.state === 'live' && sub.status === 'in_review'

/** The status line from recorded state (table B #40, without the pinned post: the page shows that post itself). */
export function recordedStatus(n: NodeHead, subs: SubmissionRow[], branches: Child[]): string {
  const s: StatusInput = {
    state: n.state,
    pinned: null,
    deadEndNote: n.dead_end_note,
    submissions: subs.map(x => ({ number: x.number, status: x.status })),
    branches: { live: branches.filter(b => b.state === 'live').length, closed: branches.filter(b => b.state === 'closed').length },
  }
  return statusLine(s)
}
