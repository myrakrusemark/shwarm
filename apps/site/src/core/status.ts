// A branch's status vote (decided Oct 13, "A branch's status is a live vote; activity sorts"; Myra: "One vote per person
// on each branch ... Status is fluid. Always changing. Any agent can drop in and vote on the status"). How people see a
// branch right now: one vote per person per branch, cast, changed or taken back any time. On the site a person votes as
// their bare handle; through a key, any of their agents casts or changes that same one vote (as a join is made: the
// vote is the person's, and records the name that cast it). Shown as small bars beside the branch; it sorts nothing
// (activity does, read/node.ts readChildren). It is the branch's pass (decided Oct 13): passed while most voters say so
// (passedByVote), and that changes when they do. Active and quiet aren't voted: they're measured.
// Builder's defaults (OPEN #127): the four statuses; a key needs `post` on the branch to vote (no permission of its
// own, so any agent that takes part can drop in); only branches have one (a shwarm's finish line is its done test,
// decided Oct 13: the human owns it); an ended branch, or one under an ended node, is locked and takes no votes; no
// limit beyond the API's signed requests; votes don't fade.
import { ShwarmError } from '@shwarm/protocol'
import { authorize, needHuman, type Actor } from './actor'
import { loadNode, loadPerson, needLive, touchNode, type Ctx } from './context'
import { checkWritable, readSettings } from './settings'

/** The statuses, in the order the bars show them (OPEN #127: proposed Oct 13, not confirmed). */
export const STATUSES = ['on_track', 'blocked', 'passed', 'dead_end'] as const
export type Status = (typeof STATUSES)[number]
export const isStatus = (v: unknown): v is Status => typeof v === 'string' && (STATUSES as readonly string[]).includes(v)

/** How many people voted each status, and in all. */
export type StatusTally = Record<Status, number> & { people: number }
export const emptyTally = (): StatusTally => ({ on_track: 0, blocked: 0, passed: 0, dead_end: 0, people: 0 })

/**
 * A branch's status now, for its badge (Myra, Oct 13: "Just show a badge for the branch and a hover/tap shows the
 * values"): the status more than half of the people who voted chose, 'mixed' when none has more than half, null with no
 * votes. OPEN (#127): more than half is a builder's default.
 */
export function statusNow(t: StatusTally): Status | 'mixed' | null {
  if (!t.people) return null
  return STATUSES.find(s => t[s] * 2 > t.people) ?? 'mixed'
}

/**
 * A branch's pass is its vote (decided Oct 13, Myra: "the vote replaces a branch's pass. But agents must vote for a pass
 * status. And that can change too"): it shows as passed while more than half of the people who voted say passed, and
 * stops when they change their votes.
 */
export const passedByVote = (t: StatusTally) => statusNow(t) === 'passed'

export type StatusInput = { node: string; status: unknown }
export type StatusResult = {
  node: string
  as: string
  person: string
  /** The person's vote now; null when they have none (taken back, or never cast). */
  status: Status | null
  /** Whether this call changed anything: false for the same vote again, or taking back a vote that wasn't there. */
  changed: boolean
  votes: StatusTally
}

const bad = (m: string, d: Record<string, unknown> = {}) => new ShwarmError('bad_request', m, d)

/** The tally for one node, read in the same way the branch list reads its children's. */
export async function readTally(db: D1Database, nodeId: number): Promise<StatusTally> {
  const { results } = await db.prepare('SELECT status, COUNT(*) AS n FROM status_vote WHERE node_id = ? GROUP BY status').bind(nodeId).all<{ status: string; n: number }>()
  return tallyOf(results)
}

export function tallyOf(rows: { status: string; n: number }[]): StatusTally {
  const t = emptyTally()
  for (const r of rows) if (isStatus(r.status)) (t[r.status] += r.n), (t.people += r.n)
  return t
}

/** A person's own vote on a node, or null. */
export async function readMyStatus(db: D1Database, nodeId: number, personId: number): Promise<Status | null> {
  const r = await db.prepare('SELECT status FROM status_vote WHERE node_id = ? AND person_id = ?').bind(nodeId, personId).first<{ status: string }>()
  return r && isStatus(r.status) ? r.status : null
}

/**
 * Cast, change or take back the person's vote on a branch's status. `status` null takes it back. The same vote again
 * changes nothing (changed: false) and keeps its time.
 */
export async function voteStatus(ctx: Ctx, a: Actor, inp: StatusInput): Promise<StatusResult> {
  const viaKey = a.via === 'key'
  if (viaKey) authorize(a, 'post', String(inp?.node))
  else needHuman(a, 'voting on a status')
  const raw = inp?.status
  // OPEN (#127): new words.
  if (raw !== null && !isStatus(raw)) throw bad(`status is one of ${STATUSES.join(', ')}, or null to take your vote back`, { field: 'status' })
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp.node)
  // OPEN (#127): new words.
  if (n.kind !== 'branch') throw bad("only a branch has a status vote. a shwarm's finish line is its done test", { field: 'node' })
  await needLive(ctx, n)
  const had = await readMyStatus(ctx.db, n.id, person.id)
  const human = '@' + person.handle
  if (had === raw) return { node: n.path, as: a.as, person: human, status: had, changed: false, votes: await readTally(ctx.db, n.id) }
  await ctx.db.batch([
    raw === null
      ? ctx.db.prepare('DELETE FROM status_vote WHERE node_id = ? AND person_id = ?').bind(n.id, person.id)
      : ctx.db
          .prepare(
            `INSERT INTO status_vote (node_id, person_id, status, as_name, at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (node_id, person_id) DO UPDATE SET status = excluded.status, as_name = excluded.as_name, at = excluded.at`,
          )
          .bind(n.id, person.id, raw, a.as, ctx.at),
    touchNode(ctx, n.id, null), // the branch's own bars show signed out
    ...(n.parent_id !== null ? [touchNode(ctx, n.parent_id, null)] : []), // and its line in the parent's branch list
  ])
  return { node: n.path, as: a.as, person: human, status: raw, changed: true, votes: await readTally(ctx.db, n.id) }
}
