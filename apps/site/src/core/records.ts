// Pass records (decided Oct 14, "One model for every node"): a pass is a dated record, and none of them locks anything.
//   * the crowd's: written when a shwarm's or a branch's status becomes passed (core/status.ts flipStatements), with
//     the most-backed passed claim then, its backers and a copy of its pinned work.
//   * the author's: a shwarm's author marks their own shwarm passed, citing a passed claim on it ("@myra says passed"),
//     on the site, with the password (markPassed). It changes no status. They may mark it again later, citing another.
//   * the migrated ones (migration 0032): a shwarm that passed or was marked a dead end before Oct 14, as a record of its
//     author's, with the passed submission's links as its pins or the dead-end note.
// Builder's defaults (Claude, Oct 14; Myra hasn't confirmed): a record keeps a copy of its claim's pins and its backer
// count, never the claim's text, so it outlives the claim; the author's mark is passed only (dead end comes from claims);
// nobody stands in for an author who's gone.
import { ShwarmError } from '@shwarm/protocol'
import { needHuman, needStepUp, type Actor } from './actor'
import { auditStatement, nodeHref } from './audit'
import { loadNode, loadPerson, touchNode, type Ctx } from './context'
import { isId, newId } from './ids'
import { checkWritable, readSettings } from './settings'
import { BACKERS_SQL } from './status'

const bad = (m: string, d: Record<string, unknown> = {}) => new ShwarmError('bad_request', m, d)

// OPEN: new words (Claude's drafts, Oct 14).
export const ONLY_SHWARM_MARK = "a branch has no author's mark. it passes when its people back a passed claim"
export const NO_PASSED_CLAIM = 'cite a passed claim on this shwarm. nobody has posted one yet'
export const NOT_A_PASSED_CLAIM = 'cite a passed claim on this shwarm'

export type MarkInput = { node: string; post: string }
/** `changed`: false when an earlier mark of the author's already cites this claim. */
export type MarkResult = { id: string; node: string; post: string; at: string; changed: boolean }

/**
 * The author marks their own shwarm passed, citing a passed claim on it (`post`). Site only, as the bare handle, behind
 * the password (A5: it acts with the author's authority, "confirms with your password"); the API refuses it as it does
 * every bare-handle act. Writes an author's pass record (the claim, its backers now, a copy of its pinned work) and an
 * audit 'passed' row (which, named, doesn't bump the live score: jobs/stats.ts), and moves the node; it changes no
 * status and locks nothing. One record per claim cited.
 */
export async function markPassed(ctx: Ctx, a: Actor, inp: MarkInput): Promise<MarkResult> {
  needHuman(a, 'marking your shwarm passed')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp?.node)
  if (n.kind === 'branch') throw bad(ONLY_SHWARM_MARK, { node: n.path })
  if (n.author_id !== person.id) throw new ShwarmError('not_permitted', 'only its author marks a shwarm passed', { need: 'author', node: n.path })
  needStepUp(a, 'marking your shwarm passed')
  const claim = isId('p', inp.post)
    ? await ctx.db
        .prepare(`SELECT p.id, p.links, ${BACKERS_SQL('p')} AS backers FROM post p WHERE p.id = ? AND p.node_id = ? AND p.claim = 'passed' AND p.hidden = 0 AND p.deleted_at IS NULL`)
        .bind(inp.post, n.id)
        .first<{ id: string; links: string; backers: number }>()
    : null
  if (!claim) {
    const any = await ctx.db.prepare("SELECT 1 FROM post WHERE node_id = ? AND claim = 'passed' AND hidden = 0 AND deleted_at IS NULL").bind(n.id).first()
    throw bad(any ? NOT_A_PASSED_CLAIM : NO_PASSED_CLAIM, { field: 'post' })
  }
  // One record of theirs per claim: citing one they cited before (a double click, or going back and forth) adds nothing.
  const cited = await ctx.db
    .prepare("SELECT id, at FROM pass_record WHERE node_id = ? AND kind = 'author' AND claim_id = ? ORDER BY at DESC, rowid DESC LIMIT 1")
    .bind(n.id, claim.id)
    .first<{ id: string; at: string }>()
  if (cited) return { id: cited.id, node: n.path, post: claim.id, at: cited.at, changed: false }
  const id = newId('r')
  // OPEN: new words in the log's detail.
  const e = auditStatement(ctx.db, { event: 'passed', node: n.id, by: a.as, detail: 'the author marks it passed', evidence: `${nodeHref(n.path)}#${claim.id}` }, ctx.at)
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO pass_record (id, node_id, kind, status, at, claim_id, backers, pins, by_name, person_id)
         VALUES (?, ?, 'author', 'passed', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, n.id, ctx.at, claim.id, claim.backers, claim.links, a.as, person.id),
    e.stmt,
    // Their pass notices on it are answered: read, and done (the inbox drops the question).
    ctx.db
      .prepare("UPDATE inbox_item SET read_at = COALESCE(read_at, ?1), done_at = ?1 WHERE person_id = ?2 AND node_id = ?3 AND kind = 'system' AND post_id IS NOT NULL AND done_at IS NULL")
      .bind(ctx.at, person.id, n.id),
    touchNode(ctx, n.id, e.id),
  ])
  return { id, node: n.path, post: claim.id, at: ctx.at, changed: true }
}
