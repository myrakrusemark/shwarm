// A shwarm's or a branch's status (decided Oct 14, "A branch's status: on track by vote, the rest by claims people back,
// with a rubber band", and "One model for every node": a shwarm's status works the same way). Only people who joined
// the node count ("Only people on a branch vote on its status"): an active seat on it, made there or through one of the
// branches under it.
//   * on track is a plain vote, anonymous, cast and taken back in one click; it posts nothing.
//   * blocked, passed and dead end are claims: a thread post with the claimant's evidence, named as them
//     (core/posts.ts post with `claim`). The claimant backs their own claim; backing someone else's is the "back" on it,
//     an upvote, which stays a human act on the site (core/posts.ts back).
//   * each person backs one thing at a time, their on-track vote or one claim (status_vote's primary key keeps it one);
//     a new backing moves it, and taking it off takes it back.
//   * the rubber band: the status stays what it is until a challenger, the other status with the most backers, leads it
//     by MARGIN or more. While it does, it gathers lead-hours (its lead, each hour); at LEAD_HOURS it becomes the status,
//     but never in less than MIN_HOURS of leading. Below MARGIN, the gathered lead-hours drain at DRAIN_PER_HOUR, and
//     the hours led drain hour for hour, so a dip costs what it lasted, not the whole wait (Myra, Oct 14: "ok fix that").
//   * nothing locks: a node that passed takes posts, claims and branches as before, and a claim that it doesn't hold
//     moves the status on again. Each change is a dated line in its history (status_change), and a change to passed is
//     also a pass record (pass_record; the author's own mark is core/records.ts).
// The band's state is stored (branch_status, which holds shwarms too) as of the last write that changed the node's
// backing, which first advanced it to that moment with the backing it had, and read by advancing it to now (no write on
// read). A change that falls due with no new backing is written by the next act on the node or by the stats job
// (jobs/stats.ts), whichever comes first; both write the same change, keyed on its moment.
// Builder's defaults (Claude, Oct 14; Myra hasn't confirmed): dead end takes the same 48 lead-hours as the others; an
// agent votes on track or makes a claim for its human, but never backs someone else's claim; `status: null` takes back
// only an on-track vote; a suspended account's backing keeps counting.
import { ShwarmError } from '@shwarm/protocol'
import { authorize, needHuman, type Actor } from './actor'
import { loadNode, loadPerson, touchNode, type Ctx, type NodeRow, type PersonRow } from './context'
import { newId } from './ids'
import { checkWritable, readSettings } from './settings'
import { upvoteStatements, type Upvoted } from './upvotes'

/** The statuses, in the order the bars show them; ties for challenger go to the first. */
export const STATUSES = ['on_track', 'blocked', 'passed', 'dead_end'] as const
export type Status = (typeof STATUSES)[number]
export const isStatus = (v: unknown): v is Status => typeof v === 'string' && (STATUSES as readonly string[]).includes(v)

/** The statuses a claim says: every one but on track, which is a plain vote. */
export const CLAIMS = ['blocked', 'passed', 'dead_end'] as const
export type Claim = (typeof CLAIMS)[number]
export const isClaim = (v: unknown): v is Claim => typeof v === 'string' && (CLAIMS as readonly string[]).includes(v)

/** Backers per status, and how many people back anything (each backs one thing, so `people` is their sum). */
export type StatusTally = Record<Status, number> & { people: number }
export const emptyTally = (): StatusTally => ({ on_track: 0, blocked: 0, passed: 0, dead_end: 0, people: 0 })

export function tallyOf(rows: { status: string; n: number }[]): StatusTally {
  const t = emptyTally()
  for (const r of rows) if (isStatus(r.status)) (t[r.status] += r.n), (t.people += r.n)
  return t
}

// ---------- the rubber band ----------

/** A challenger counts only while it leads by this many backers. */
export const MARGIN = 2
/** Lead-hours (lead × hours) that change the status. */
export const LEAD_HOURS = 48
/** The status never changes in less than this many hours of leading by MARGIN (Myra: "no less that 6h tho"). */
export const MIN_HOURS = 6
/** Lead-hours lost each hour the lead is under MARGIN. */
export const DRAIN_PER_HOUR = 2

const HOUR_MS = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()

/**
 * Whole hours left until `at`, rounded down: the page and the briefing say "in 9 hours" or "in under an hour" from it,
 * so a copy cached within the hour (the signed-out ETag carries the hour) never says more time is left than is.
 */
export const hoursUntil = (at: string, now: number) => Math.floor((Date.parse(at) - now) / HOUR_MS)

/** The band's state as of `at` (a branch_status row). */
export type Band = {
  current: Status
  /** The status gathering lead-hours, or null when no other status has a backer. */
  challenger: Status | null
  lead_hours: number
  /**
   * `at` less the hours the challenger has led by MARGIN (hours led add up while it leads and drain hour for hour while
   * it doesn't); null when it has none.
   */
  leading_since: string | null
  /** When `current` became the status; null: on track since the node was opened. */
  changed_at: string | null
  at: string
}

/** Every node starts on track with nothing gathered. */
export const startBand = (at: string): Band => ({ current: 'on_track', challenger: null, lead_hours: 0, leading_since: null, changed_at: null, at })

/**
 * A change of status the band went through: from one status to another at an exact moment, with the backers of the new
 * status and of the old one then (the backing held still since the band's `at`).
 */
export type Flip = { from: Status; to: Status; at: string; backers: number; against: number }

/** The band advanced to a moment, with what it would do next if the backing stayed as it is. */
export type BandNow = Band & {
  /** The challenger's backers minus the current status's; 0 with no challenger. */
  lead: number
  /** When the challenger becomes the status if the backing stays as it is; null while its lead is under MARGIN. */
  changes_at: string | null
  /** How many more backers the challenger needs for a lead of MARGIN; null with no challenger or at MARGIN already. */
  needs: number | null
  /** Every change of status between the band's `at` and the moment it was advanced to, oldest first. */
  flips: Flip[]
}

/**
 * The challenger for `current`: the other status with the most backers. A tie keeps the stored challenger when it's among
 * the tied, else goes to the first in STATUSES order. Null when no other status has a backer.
 */
function challengerOf(current: Status, stored: Status | null, t: Record<Status, number>): Status | null {
  const others = STATUSES.filter(s => s !== current)
  const most = Math.max(...others.map(s => t[s]))
  if (most <= 0) return null
  const tied = others.filter(s => t[s] === most)
  return stored && tied.includes(stored) ? stored : tied[0]
}

/** The first moment both hold: `hours` have reached LEAD_HOURS (growing by `lead` an hour from `from`), and MIN_HOURS have passed since `since`. */
function flipAt(hours: number, lead: number, from: number, since: number): number {
  const enough = hours >= LEAD_HOURS ? from : from + Math.ceil(((LEAD_HOURS - hours) / lead) * HOUR_MS)
  return Math.max(enough, since + MIN_HOURS * HOUR_MS)
}

/**
 * The band at `now` (ms), from `state` with the backers `t`, which held unchanged since `state.at`. The status changes at
 * the exact moment the challenger's lead-hours and its time leading are both enough; the band then carries on to `now`
 * with the same backers under the new status. Every such change is in `flips`, so a write can record it. A pure
 * function: reads advance in memory, and writes save what it gives.
 */
export function advance(state: Band, t: Record<Status, number>, now: number): BandNow {
  const s: Band = { ...state }
  const flips: Flip[] = []
  let from = Date.parse(s.at)
  const to = Math.max(from, now)
  for (;;) {
    const ch = challengerOf(s.current, s.challenger, t)
    if (ch !== s.challenger) Object.assign(s, { challenger: ch, lead_hours: 0, leading_since: null })
    const lead = ch === null ? 0 : t[ch] - t[s.current]
    if (ch === null || lead < MARGIN) {
      s.lead_hours = Math.max(0, s.lead_hours - (DRAIN_PER_HOUR * (to - from)) / HOUR_MS)
      const led = s.leading_since === null ? 0 : Math.max(0, from - Date.parse(s.leading_since) - (to - from))
      s.leading_since = led > 0 ? iso(to - led) : null
      break
    }
    const since = s.leading_since === null ? from : Date.parse(s.leading_since)
    s.leading_since = iso(since)
    const flip = flipAt(s.lead_hours, lead, from, since)
    if (flip > to) {
      s.lead_hours += (lead * (to - from)) / HOUR_MS
      break
    }
    // The challenger becomes the status; the band starts over under it, with the same backers.
    flips.push({ from: s.current, to: ch, at: iso(flip), backers: t[ch], against: t[s.current] })
    Object.assign(s, { current: ch, challenger: null, lead_hours: 0, leading_since: null, changed_at: iso(flip) })
    from = flip
  }
  s.at = iso(to)
  const lead = s.challenger === null ? 0 : t[s.challenger] - t[s.current]
  return {
    ...s,
    lead,
    changes_at: s.challenger !== null && lead >= MARGIN ? iso(flipAt(s.lead_hours, lead, to, Date.parse(s.leading_since ?? s.at))) : null,
    needs: s.challenger !== null && lead < MARGIN ? MARGIN - lead : null,
    flips,
  }
}

/** The challenger as the page, the briefing and the JSON show it. */
export type Challenger = { status: Status; lead: number; lead_hours: number; changes_at: string | null; needs: number | null }

/** A node's status as everyone sees it now (read/status.ts readNodeStatus). */
export type NodeStatus = {
  current: Status
  /** When it became the status; null: on track since the node was opened. */
  changed_at: string | null
  /** Backers per status, and how many people back anything. */
  backing: StatusTally
  challenger: Challenger | null
}

/** The status from the stored band (null: none stored, so on track with nothing gathered) and the backing as it stands, advanced to `now`. */
export function nodeStatus(stored: Band | null, backing: StatusTally, now: number): NodeStatus {
  const b = advance(stored ?? startBand(iso(now)), backing, now)
  return {
    current: b.current,
    changed_at: b.changed_at,
    backing,
    challenger: b.challenger === null ? null : { status: b.challenger, lead: b.lead, lead_hours: b.lead_hours, changes_at: b.changes_at, needs: b.needs },
  }
}

// ---------- reads the acts share ----------

export async function readBand(db: D1Database, nodeId: number): Promise<Band | null> {
  return db.prepare('SELECT current, challenger, lead_hours, leading_since, changed_at, at FROM branch_status WHERE node_id = ?').bind(nodeId).first<Band>()
}

/**
 * The status_vote rows on `v` that count as backing: an on-track vote with no claim, or a claim's status with that claim,
 * from someone with an active seat on the node. Leaving, closing an account and hiding a claim delete rows, and
 * migration 0031 dropped the rest; but a worker from before 0031 (between its migrate and its deploy, or rolled back
 * to) still writes votes with no claim and no join, so every read of the backing skips those.
 */
export const BACKING_SQL = (v: string) =>
  `((${v}.status = 'on_track') = (${v}.claim_id IS NULL)
    AND EXISTS (SELECT 1 FROM seat bs WHERE bs.node_id = ${v}.node_id AND bs.person_id = ${v}.person_id AND bs.left_at IS NULL))`

/** A claim post's backers (status_vote rows backing it, BACKING_SQL), as SQL on post `p`: 0 for any other post. */
export const BACKERS_SQL = (p: string) =>
  `CASE WHEN ${p}.claim IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM status_vote v WHERE v.claim_id = ${p}.id AND ${BACKING_SQL('v')}) END`

/** The backing on one node: backers per status. */
export async function readTally(db: D1Database, nodeId: number): Promise<StatusTally> {
  const { results } = await db
    .prepare(`SELECT v.status, COUNT(*) AS n FROM status_vote v WHERE v.node_id = ? AND ${BACKING_SQL('v')} GROUP BY v.status`)
    .bind(nodeId)
    .all<{ status: string; n: number }>()
  return tallyOf(results)
}

/**
 * First in every batch that changes a node's backing: the band advanced to now with the backing it has before the batch,
 * saved, and any change of status it went through since it was last saved, recorded (flipStatements).
 * The batch's change then holds from that moment on.
 */
export async function bandStatements(ctx: Ctx, nodeId: number): Promise<D1PreparedStatement[]> {
  const [stored, t] = await Promise.all([readBand(ctx.db, nodeId), readTally(ctx.db, nodeId)])
  const b = advance(stored ?? startBand(ctx.at), t, ctx.now)
  return [
    ctx.db
      .prepare(
        `INSERT INTO branch_status (node_id, current, challenger, lead_hours, leading_since, changed_at, at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (node_id) DO UPDATE SET current = excluded.current, challenger = excluded.challenger, lead_hours = excluded.lead_hours,
           leading_since = excluded.leading_since, changed_at = excluded.changed_at, at = excluded.at`,
      )
      .bind(nodeId, b.current, b.challenger, b.lead_hours, b.leading_since, b.changed_at, b.at),
    ...b.flips.flatMap(f => flipStatements(ctx.db, nodeId, f, { by: 'act', at: ctx.at })),
  ]
}

/** The most-backed claim of status `s` (SQL text) on node `n` now, the newest among equals: what a change to `s` cites. */
const TOP_CLAIM = (n: string, s: string) =>
  `(SELECT p.id FROM post p WHERE p.node_id = ${n} AND p.claim = ${s} AND p.hidden = 0 AND p.deleted_at IS NULL
    ORDER BY ${BACKERS_SQL('p')} DESC, p.created_at DESC, p.id DESC LIMIT 1)`

/**
 * What one change of status writes (decided Oct 14, "One model for every node"; builder's defaults: every change is a
 * dated line, written when its moment comes). Whoever advances the band past the change first writes it: an act in the
 * node's tree (bandStatements, `by: 'act'`) or the stats job (`by: 'job'`), which runs outside the tree. The line in
 * status_change is keyed on (node, moment), so the second writer's insert is ignored, and everything else here is
 * written only beside the line this call inserted (its fresh id), so nothing is written twice:
 *   * the line: from, to, the moment, the most-backed claim of the new status then (none for on track), its backers and
 *     the old status's; read inside the batch, before the batch's own change to the backing.
 *   * to passed: the crowd's pass record, with a copy of that claim's links as its pinned work (never its text, so the
 *     record outlives the claim; a builder's default); an audit 'passed' row, which the log shows and the live score's
 *     pass bump reads (jobs/stats.ts); and on a shwarm, a notice in its author's inbox inviting their own mark. No mail.
 * `bandAt` (the job): write only while the stored band is the one the job just saved, at that moment, so a newer band
 * from the tree is never answered with a change the tree didn't make. `touch` (the job): the node's version and its
 * parent's move, as an act's would.
 */
export function flipStatements(db: D1Database, nodeId: number, f: Flip, o: { by: 'act' | 'job'; at: string; bandAt?: string; touch?: boolean }): D1PreparedStatement[] {
  const h = newId('h')
  const guard = o.bandAt ? 'EXISTS (SELECT 1 FROM branch_status WHERE node_id = ?2 AND at = ?10 AND current = ?5)' : '1'
  const line = db
    .prepare(
      `INSERT OR IGNORE INTO status_change (id, node_id, at, from_status, to_status, claim_id, backers, against, written_at, written_by)
       SELECT ?1, ?2, ?3, ?4, ?5, CASE WHEN ?5 = 'on_track' THEN NULL ELSE ${TOP_CLAIM('?2', '?5')} END, ?6, ?7, ?8, ?9 WHERE ${guard}`,
    )
    .bind(h, nodeId, f.at, f.from, f.to, f.backers, f.against, o.at, o.by, ...(o.bandAt ? [o.bandAt] : []))
  const out = [line]
  if (f.to === 'passed')
    out.push(
      db
        .prepare(
          `INSERT INTO pass_record (id, node_id, kind, status, at, change_id, claim_id, backers, pins)
           SELECT ?1, sc.node_id, 'crowd', 'passed', sc.at, sc.id, sc.claim_id, sc.backers, COALESCE((SELECT c.links FROM post c WHERE c.id = sc.claim_id), '[]')
           FROM status_change sc WHERE sc.id = ?2`,
        )
        .bind(newId('r'), h),
      // OPEN: new words. The log's detail names no one: a name in it would outlive a closed account (read/names.ts).
      db
        .prepare(
          `INSERT INTO audit_event (id, at, event, node_id, by_name, submission_id, number, detail, evidence, milestone)
           SELECT ?1, sc.at, 'passed', sc.node_id, NULL, NULL, NULL, 'backed by ' || sc.backers || ' to ' || sc.against,
                  '/w/' || n.path || COALESCE('#' || sc.claim_id, ''), 1
           FROM status_change sc JOIN node n ON n.id = sc.node_id WHERE sc.id = ?2`,
        )
        .bind(newId('e'), h),
      // A system item that names a post is this notice (read/inbox-links.ts). The inbox writes its words when it shows
      // it, with the claimant's name as it reads then (web/profile.tsx); the stored text names no one, since a name
      // in it would outlive a closed account. OPEN: new words (Claude's draft, Oct 14).
      db
        .prepare(
          `INSERT INTO inbox_item (person_id, kind, node_id, post_id, text, created_at)
           SELECT n.author_id, 'system', n.id, sc.claim_id, n.title || ' passed: its people back a passed claim. mark it passed too?', ?2
           FROM status_change sc JOIN node n ON n.id = sc.node_id JOIN person pr ON pr.id = n.author_id AND pr.status = 'active'
           WHERE sc.id = ?1 AND n.kind <> 'branch'`,
        )
        .bind(h, o.at),
    )
  if (o.touch)
    out.push(
      db
        .prepare(
          `UPDATE node SET last_event_id = ?1, changed_at = ?2
           WHERE (id = ?3 OR id = (SELECT parent_id FROM node WHERE id = ?3)) AND EXISTS (SELECT 1 FROM status_change WHERE id = ?4)`,
        )
        .bind(newId('v'), o.at, nodeId, h),
    )
  return out
}

/** A person's one backing on a node: their on-track vote (claim null), or the claim they back with its poster. */
export type BackingRow = { status: Status; claim: (Upvoted & { claim: Claim }) | null }

export async function readBacking(db: D1Database, nodeId: number, personId: number): Promise<BackingRow | null> {
  const r = await db
    .prepare(
      `SELECT v.status, v.claim_id, p.person_id, pr.founding AS person_founding, pr.created_at AS person_created_at
       FROM status_vote v LEFT JOIN post p ON p.id = v.claim_id LEFT JOIN person pr ON pr.id = p.person_id
       WHERE v.node_id = ? AND v.person_id = ? AND ${BACKING_SQL('v')}`,
    )
    .bind(nodeId, personId)
    .first<{ status: Status; claim_id: string | null; person_id: number | null; person_founding: number | null; person_created_at: string | null }>()
  if (!r) return null
  return {
    status: r.status,
    claim:
      r.claim_id === null || !isClaim(r.status)
        ? null
        : { id: r.claim_id, claim: r.status, person_id: r.person_id ?? 0, person_founding: r.person_founding ?? 0, person_created_at: r.person_created_at ?? '' },
  }
}

/** Where a backing moves to: the person's on-track vote, or a claim post (with its poster, for the upvote). */
export type BackingTo = { status: 'on_track' } | { status: Claim; claim: Upvoted }

/**
 * The statements that move `person`'s backing on node `n` from `had` to `to` (null takes it off): the band saved first,
 * then their status_vote row, and the upvotes that go with backing someone else's claim (an upvote on the claim
 * backed; none on their own posts). Then the node (with `version` when the act has one) and its parent move, since
 * both pages show the status.
 */
export async function backingStatements(
  ctx: Ctx,
  n: Pick<NodeRow, 'id' | 'parent_id'>,
  person: PersonRow,
  as: string,
  had: BackingRow | null,
  to: BackingTo | null,
  o: { version?: string | null } = {},
): Promise<D1PreparedStatement[]> {
  const toClaim = to && 'claim' in to ? to.claim : null
  const hadClaim = had?.claim ?? null
  return [
    ...(await bandStatements(ctx, n.id)),
    to === null
      ? ctx.db.prepare('DELETE FROM status_vote WHERE node_id = ? AND person_id = ?').bind(n.id, person.id)
      : ctx.db
          .prepare(
            `INSERT INTO status_vote (node_id, person_id, status, claim_id, as_name, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (node_id, person_id) DO UPDATE SET status = excluded.status, claim_id = excluded.claim_id, as_name = excluded.as_name, at = excluded.at`,
          )
          .bind(n.id, person.id, to.status, toClaim?.id ?? null, as, ctx.at),
    ...(hadClaim && hadClaim.id !== toClaim?.id && hadClaim.person_id !== person.id ? upvoteStatements(ctx, person, hadClaim, false) : []),
    ...(toClaim && toClaim.id !== hadClaim?.id && toClaim.person_id !== person.id ? upvoteStatements(ctx, person, toClaim, true) : []),
    ...touchWithParent(ctx, n, o.version ?? null),
  ]
}

/** The node (with `version` when the act has one) and its parent, whose branch list shows its status. */
export const touchWithParent = (ctx: Ctx, n: Pick<NodeRow, 'id' | 'parent_id'>, version: string | null = null): D1PreparedStatement[] => [
  touchNode(ctx, n.id, version),
  ...(n.parent_id !== null ? [touchNode(ctx, n.parent_id, null)] : []),
]

// ---------- refusals (OPEN: new words, Claude's drafts of Myra's lines, Oct 14) ----------

export const NOT_JOINED = 'join this shwarm or branch first. voting on its status comes with joining'
export const CLAIMS_ARE_POSTS = 'blocked, passed and dead end are claims: post with claim and your evidence'
export const CLAIM_FIXED = "a claim can't be changed. post a new one"
export const NOT_A_CLAIM = 'only a claim is backed. upvote a plain post instead'
export const BACK_A_CLAIM = "a claim isn't upvoted. back it instead"
// Submissions, checks, runs, the author's sign-off and the author's dead end are retired (decided Oct 14, "One model
// for every node"): every node refuses them with these words. Old ones stay readable.
export const NO_SUBMISSIONS = 'a shwarm or branch takes no submissions. to say it passes, post a passed claim with your evidence'
export const NO_CHECKS = 'a shwarm or branch takes no checks. back a passed claim if you checked it'
export const NO_DEAD_END = "a shwarm or branch can't be marked a dead end. post a dead-end claim with your evidence"

const bad = (m: string, d: Record<string, unknown> = {}) => new ShwarmError('bad_request', m, d)

/** A post's `claim` as sent: null or missing for a plain post. OPEN: new words. */
export function parseClaim(v: unknown): Claim | null {
  if (v === undefined || v === null) return null
  if (!isClaim(v)) throw bad(`claim is ${CLAIMS.join(', ')}`, { field: 'claim' })
  return v
}

/** A status act's node: one the person joined (an active seat, made there or through a branch under it). */
export async function needJoined(ctx: Ctx, n: Pick<NodeRow, 'id' | 'path'>, person: Pick<PersonRow, 'id'>): Promise<void> {
  if (!(await ctx.db.prepare('SELECT 1 FROM seat WHERE node_id = ? AND person_id = ? AND left_at IS NULL').bind(n.id, person.id).first()))
    throw new ShwarmError('not_joined', NOT_JOINED, { node: n.path })
}

// ---------- the on-track vote ----------

export type StatusInput = { node: string; status: unknown }
export type StatusResult = {
  node: string
  as: string
  person: string
  /** The person's backing now: on_track, the status of the claim they back, or null when they back nothing. */
  status: Status | null
  /** The claim post they back, or null. */
  claim: string | null
  /** Whether this call changed anything: false for an on-track vote that was there, or taking back one that wasn't. */
  changed: boolean
  votes: StatusTally
}

/**
 * Cast the person's on-track vote on a shwarm or a branch (`status: 'on_track'`), or take it back (`status: null`).
 * Casting it moves their backing off any claim. Taking it back leaves a claim they back as it is: only "back" on the
 * site takes that off. On the site as the bare handle; through a key, any of their agents with `post` on the node, for
 * their human.
 */
export async function voteStatus(ctx: Ctx, a: Actor, inp: StatusInput): Promise<StatusResult> {
  if (a.via === 'key') authorize(a, 'post', String(inp?.node))
  else needHuman(a, 'voting on a status')
  const raw = inp?.status
  if (isClaim(raw)) throw bad(CLAIMS_ARE_POSTS, { field: 'status' })
  // OPEN: new words.
  if (raw !== null && raw !== 'on_track') throw bad('status is on_track, or null to take your on-track vote back', { field: 'status' })
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp.node)
  await needJoined(ctx, n, person)
  const had = await readBacking(ctx.db, n.id, person.id)
  const human = '@' + person.handle
  const same = raw === null ? had?.status !== 'on_track' : had?.status === 'on_track'
  if (!same) await ctx.db.batch(await backingStatements(ctx, n, person, a.as, had, raw === null ? null : { status: 'on_track' }))
  const now = same ? had : raw === null ? null : { status: 'on_track' as const, claim: null }
  return { node: n.path, as: a.as, person: human, status: now?.status ?? null, claim: now?.claim?.id ?? null, changed: !same, votes: await readTally(ctx.db, n.id) }
}
