// A shwarm's or a branch's status as the page, the briefing and the JSON read it (decided Oct 14, core/status.ts): the
// band advanced to now with the backing as it stands (no write on read); its claims, each passed one with its pinned
// work; the viewer's own backing; its pass records and its dated status history (core/records.ts). Every reader of a
// signed-out page carries the UTC hour in its ETag (web/node-routes.tsx), so a status that changes with time alone
// shows within the hour; the stats job writes the change itself within minutes of its moment (jobs/stats.ts).
import type { Link } from '@shwarm/protocol'
import { BACKERS_SQL, BACKING_SQL, nodeStatus, readBand, readTally, type Claim, type NodeStatus, type Status } from '../core/status'
import { NAME_SHOWN } from './names'

const links = (s: string | null): Link[] => {
  try {
    const v = JSON.parse(s ?? '[]')
    return Array.isArray(v) ? (v as Link[]) : []
  } catch {
    return [] // a row the site wrote is JSON; nothing to read if not
  }
}

/** A node's status now (core/status.ts nodeStatus). */
export async function readNodeStatus(db: D1Database, nodeId: number, now: number): Promise<NodeStatus> {
  const [band, backing] = await Promise.all([readBand(db, nodeId), readTally(db, nodeId)])
  return nodeStatus(band, backing, now)
}

/**
 * A claim post: its status, who posted it (as the thread names them), how many people back it (the claimant among
 * them, while they do), when, its evidence, and on a passed claim its pinned work (its links; [] for any other claim).
 */
export type ClaimRow = { post: string; status: Claim; by: string; person_id: number; backers: number; at: string; text: string; pins: Link[] }

/** How many claims the briefing and the JSON list, newest first. OPEN: a builder's default. */
export const CLAIMS_SHOWN = 5

const CLAIM_COLS = `p.id AS post, p.claim AS status, ${NAME_SHOWN('p.as_name')} AS "by", p.person_id, p.created_at AS at, p.text, p.links,
  ${BACKERS_SQL('p')} AS backers`
const CLAIM_SHOWS = 'p.claim IS NOT NULL AND p.hidden = 0 AND p.deleted_at IS NULL'
const claimRow = ({ links: l, ...r }: Omit<ClaimRow, 'pins'> & { links: string }): ClaimRow => ({ ...r, pins: r.status === 'passed' ? links(l) : [] })

/** A node's claims, newest first, at most `limit`: not hidden or deleted. */
export async function readClaims(db: D1Database, nodeId: number, limit = CLAIMS_SHOWN): Promise<ClaimRow[]> {
  const { results } = await db
    .prepare(`SELECT ${CLAIM_COLS} FROM post p WHERE p.node_id = ? AND ${CLAIM_SHOWS} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
    .bind(nodeId, limit)
    .all<Omit<ClaimRow, 'pins'> & { links: string }>()
  return results.map(claimRow)
}

/** How many passed claims the author's "mark it passed" picker lists. OPEN: a builder's default. */
export const PASSED_CLAIMS_SHOWN = 20

/** A node's passed claims, most-backed first (the newest among equals), at most `limit`: the author's mark cites one. */
export async function readPassedClaims(db: D1Database, nodeId: number, limit = PASSED_CLAIMS_SHOWN): Promise<ClaimRow[]> {
  const { results } = await db
    .prepare(`SELECT ${CLAIM_COLS} FROM post p WHERE p.node_id = ? AND p.claim = 'passed' AND ${CLAIM_SHOWS} ORDER BY backers DESC, p.created_at DESC, p.id DESC LIMIT ?`)
    .bind(nodeId, limit)
    .all<Omit<ClaimRow, 'pins'> & { links: string }>()
  return results.map(claimRow)
}

/**
 * Why a node isn't on track: the most-backed claim of `status` on it (the newest among equals), its post and whole
 * evidence; null for on track or no status, or when no such claim shows (a status a migrated record set, or a claim
 * hidden since).
 */
export async function readReason(db: D1Database, nodeId: number, status: Status | null): Promise<{ post: string; text: string } | null> {
  if (status === null || status === 'on_track') return null
  return db
    .prepare(`SELECT p.id AS post, p.text FROM post p WHERE p.node_id = ? AND p.claim = ? AND p.hidden = 0 AND p.deleted_at IS NULL ORDER BY ${BACKERS_SQL('p')} DESC, p.created_at DESC, p.id DESC LIMIT 1`)
    .bind(nodeId, status)
    .first<{ post: string; text: string }>()
}

/**
 * The viewer's own backing on a node: their on-track vote (claim null), or the claim they back ("you back @ana's
 * passed claim"), with its post and poster. Only they see it: backing is anonymous to everyone else.
 */
export type MyBacking = { status: Status; claim: { post: string; by: string } | null }

export async function readMyBacking(db: D1Database, nodeId: number, personId: number): Promise<MyBacking | null> {
  const r = await db
    .prepare(
      `SELECT v.status, v.claim_id, ${NAME_SHOWN('p.as_name')} AS "by" FROM status_vote v LEFT JOIN post p ON p.id = v.claim_id
       WHERE v.node_id = ? AND v.person_id = ? AND ${BACKING_SQL('v')}`,
    )
    .bind(nodeId, personId)
    .first<{ status: Status; claim_id: string | null; by: string | null }>()
  if (!r) return null
  return { status: r.status, claim: r.claim_id === null ? null : { post: r.claim_id, by: r.by ?? '' } }
}

// ---------- pass records and the status history ----------

/**
 * A pass record (core/records.ts), as the pass box, the briefing and the JSON show it:
 *   * kind 'crowd': "passed as of <at> · @ana's claim · backed by 6": the claim its people backed, their count then.
 *   * kind 'author': "@myra says passed · <at>": `by`, and the claim they cited.
 *   * migrated (an author's, from before Oct 14): `submission` (the number of the submission that passed it), or
 *     status 'dead_end' with `note` (the author's dead-end note).
 * `claim` is null once its claim is hidden or deleted. The record keeps its own copy of the pinned work (`pins`), so
 * it outlives a deleted claim; a claim or submission the operator hid takes its pins out of sight with it.
 */
export type PassRecord = {
  id: string
  kind: 'crowd' | 'author'
  status: 'passed' | 'dead_end'
  at: string
  claim: { post: string; by: string } | null
  submission: number | null
  note: { post: string; text: string } | null
  backers: number
  pins: Link[]
  by: string | null
}

/** How many pass records a node shows, newest first. OPEN: a builder's default; a node with more lists the newest. */
export const RECORDS_SHOWN = 20

export async function readPassRecords(db: D1Database, nodeId: number, limit = RECORDS_SHOWN): Promise<PassRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.kind, r.status, r.at, r.backers, CASE WHEN c.hidden = 1 OR sp.hidden = 1 THEN '[]' ELSE r.pins END AS pins,
              ${NAME_SHOWN('r.by_name')} AS by_name,
              CASE WHEN c.hidden = 0 AND c.deleted_at IS NULL THEN c.id END AS claim_post, ${NAME_SHOWN('c.as_name')} AS claim_by,
              CASE WHEN sp.hidden = 0 THEN s.number END AS sub_number,
              CASE WHEN np.hidden = 0 THEN np.id END AS note_post, np.text AS note_text
       FROM pass_record r
       LEFT JOIN post c ON c.id = r.claim_id
       LEFT JOIN submission s ON s.post_id = r.submission_id
       LEFT JOIN post sp ON sp.id = r.submission_id
       LEFT JOIN post np ON np.id = r.note_post_id
       WHERE r.node_id = ? ORDER BY r.at DESC, r.rowid DESC LIMIT ?`,
    )
    .bind(nodeId, limit)
    .all<{
      id: string
      kind: PassRecord['kind']
      status: PassRecord['status']
      at: string
      backers: number
      pins: string
      by_name: string | null
      claim_post: string | null
      claim_by: string | null
      sub_number: number | null
      note_post: string | null
      note_text: string | null
    }>()
  return results.map(r => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    at: r.at,
    claim: r.claim_post ? { post: r.claim_post, by: r.claim_by ?? '' } : null,
    submission: r.sub_number,
    note: r.note_post ? { post: r.note_post, text: r.note_text ?? '' } : null,
    backers: r.backers,
    pins: links(r.pins),
    by: r.by_name,
  }))
}

/**
 * One dated line of a node's status history: from, to, the exact moment, the claim it went with (the most-backed one
 * of the new status then; null for on track, or once that claim is hidden or deleted), its backers and the old
 * status's then ("on track → blocked · oct 12 · 3 to 1").
 */
export type StatusChange = { id: string; at: string; from: Status | null; to: Status; claim: string | null; backers: number; against: number }

/** How many lines of a node's status history show, newest first. OPEN: a builder's default. */
export const HISTORY_SHOWN = 20

export async function readStatusHistory(db: D1Database, nodeId: number, limit = HISTORY_SHOWN): Promise<StatusChange[]> {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.at, h.from_status AS "from", h.to_status AS "to", CASE WHEN c.hidden = 0 AND c.deleted_at IS NULL THEN c.id END AS claim,
              h.backers, h.against
       FROM status_change h LEFT JOIN post c ON c.id = h.claim_id WHERE h.node_id = ? ORDER BY h.at DESC LIMIT ?`,
    )
    .bind(nodeId, limit)
    .all<StatusChange>()
  return results
}

/** A shwarm's latest pass record of status passed, the crowd's or its author's: what building on it now builds "as of". */
export async function readLatestPass(db: D1Database, nodeId: number): Promise<{ id: string; at: string } | null> {
  return db
    .prepare("SELECT id, at FROM pass_record WHERE node_id = ? AND status = 'passed' ORDER BY at DESC, rowid DESC LIMIT 1")
    .bind(nodeId)
    .first<{ id: string; at: string }>()
}

/**
 * The shwarm author's own approval (decided Oct 15, "The author's own approval shows beside the status, as '✓ author
 * approved'"): their latest pass record of status passed, when it was made and the claim it cites (null once that claim
 * is hidden or deleted, or for a record migrated from a pass before Oct 14, which cites a submission). It stands apart
 * from the people's status, whatever that is now. Null on a branch, or when the author hasn't approved.
 * A record migrated from a pass before Oct 14 (migration 0032) counts only when the author passed that submission's
 * author check themselves: the check was opt-in, so an old pass alone was never their approval (AUTHOR_APPROVED_SQL).
 */
export type AuthorApproved = { at: string; claim: { post: string; by: string } | null }

/** SQL: pass record `r` is its author's own approval (readAuthorApproved; jobs/stats.ts reads the same). */
export const AUTHOR_APPROVED_SQL = (r: string) =>
  `${r}.kind = 'author' AND ${r}.status = 'passed' AND (${r}.submission_id IS NULL OR EXISTS (
     SELECT 1 FROM check_report k WHERE k.submission_id = ${r}.submission_id AND k.slot = 'author' AND k.verdict = 'pass'
       AND k.counted = 1 AND k.person_id = ${r}.person_id))`

export async function readAuthorApproved(db: D1Database, nodeId: number): Promise<AuthorApproved | null> {
  const r = await db
    .prepare(
      `SELECT r.at, CASE WHEN c.hidden = 0 AND c.deleted_at IS NULL THEN c.id END AS post, ${NAME_SHOWN('c.as_name')} AS "by"
       FROM pass_record r JOIN node n ON n.id = r.node_id AND n.kind <> 'branch' LEFT JOIN post c ON c.id = r.claim_id
       WHERE r.node_id = ? AND ${AUTHOR_APPROVED_SQL('r')} ORDER BY r.at DESC, r.rowid DESC LIMIT 1`,
    )
    .bind(nodeId)
    .first<{ at: string; post: string | null; by: string | null }>()
  return r ? { at: r.at, claim: r.post ? { post: r.post, by: r.by ?? '' } : null } : null
}

/** The pass box's id on a node's page: the author's inbox notice links there (read/inbox-links.ts). */
export const PASS_BOX = 'passed'

// ---------- everything at once ----------

/** Everything a node's page and briefing show of its status. */
export type StatusData = {
  now: NodeStatus
  /** Why it isn't on track (readReason); null while it is. */
  reason: { post: string; text: string } | null
  /** Newest first, at most CLAIMS_SHOWN. */
  claims: ClaimRow[]
  /** The viewer's own backing; null signed out, or backing nothing. */
  myBacking: MyBacking | null
  /** Newest first, at most RECORDS_SHOWN. */
  records: PassRecord[]
  /** Newest first, at most HISTORY_SHOWN. */
  history: StatusChange[]
  /** The shwarm author's own approval, beside the people's status (readAuthorApproved); null on a branch or until then. */
  authorApproved: AuthorApproved | null
  /**
   * For the shwarm's author, the passed claims "mark it passed" may cite, most-backed first (readPassedClaims); empty
   * for anyone else and on a branch.
   */
  passedClaims: ClaimRow[]
}

/**
 * A node's StatusData for its page (`viewer`: the person signed in) or its briefing (null). `node` is the node as the
 * chain read it.
 */
export async function loadStatus(db: D1Database, node: { id: number; kind: string; author_id: number }, viewer: number | null, now: number): Promise<StatusData> {
  const author = viewer !== null && viewer === node.author_id && node.kind !== 'branch'
  const [status, claims, myBacking, records, history, passedClaims, authorApproved] = await Promise.all([
    readNodeStatus(db, node.id, now),
    readClaims(db, node.id),
    viewer === null ? Promise.resolve(null) : readMyBacking(db, node.id, viewer),
    readPassRecords(db, node.id),
    readStatusHistory(db, node.id),
    author ? readPassedClaims(db, node.id) : Promise.resolve([]),
    node.kind === 'branch' ? Promise.resolve(null) : readAuthorApproved(db, node.id),
  ])
  return { now: status, reason: await readReason(db, node.id, status.current), claims, myBacking, records, history, passedClaims, authorApproved }
}
