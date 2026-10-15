// Closing an account (go-live 6.4, table B #60 and "author gone"). In one batch:
//   * the account is marked closed and its private details go: email address, password, display name, about, links,
//     notice settings and the admin flag. The row and the handle stay, so nobody can take the handle and pass for them,
//     and the address is free to sign up again.
//   * every session ends, every emailed link stops working, the inbox and the mentions of the handle are deleted, the
//     mail rows that hold the address go, and its keys are revoked (with the networks they were used from).
//   * direct messages turn off for all their names, and their blocks go (7.17). The DMs themselves age out after 30
//     days like everyone's: the other side's reader keeps its place by them (core/dm.ts readDms).
//   * they stop working on every shwarm and branch they joined but didn't start (their join is given up, as "leave"
//     does), so nobody shows as working on it under "former member". OPEN (#86): a builder's default since no lobby (Oct 9).
//   * their backing goes, their on-track votes and the claims they backed (decided Oct 14: only people on a node count,
//     and they're no longer on any), after each node's band is saved with it (core/status.ts). Their claims stay as
//     posts, with the backing of the people still on the node.
//   * one last mail goes to the address, so a closing they didn't make doesn't pass unseen. Its row lets go of the
//     address once it's sent (jobs/mail.ts).
// The work stays: shwarms, branches, posts, submissions, checks, upvotes and the audit log, with the handle detached:
// every page shows its names as "former member" (read/names.ts). Nobody marks their shwarms passed for them (a builder's
// default, Oct 14): the crowd's pass is enough.
// OPEN (#86): what goes and what stays is a builder's default; so is keeping the beta allow-list row (Myra's record of
// who she invited) and the address's suppression row (it keeps a complaint from being mailed again).
import { ctxAt, moderatedStatement, touchNode } from '../core/context'
import { bandStatements } from '../core/status'
import { emailNorm } from '../email/norm'
import { mailStatement } from '../email/outbox'

/** The confirm field: the handle, typed with or without its @, any case. */
export const confirmsHandle = (typed: string | undefined, handle: string) => (typed ?? '').trim().replace(/^@/, '').toLowerCase() === handle

export async function closeAccount(db: D1Database, personId: number, nowMs = Date.now()): Promise<{ handle: string } | null> {
  const ctx = ctxAt(db, nowMs)
  const p = await db.prepare("SELECT id, handle, email FROM person WHERE id = ? AND status = 'active'").bind(personId).first<{ id: number; handle: string; email: string }>()
  if (!p) return null
  const { results: joined } = await db
    .prepare(
      `SELECT s.node_id FROM seat s JOIN node n ON n.id = s.node_id
       WHERE s.person_id = ?1 AND s.left_at IS NULL AND n.author_id <> ?1`,
    )
    .bind(p.id)
    .all<{ node_id: number }>()
  // The bands of the nodes they back, each saved as of now before their backing goes.
  // OPEN (#86): read outside each shwarm's tree, like the rest of this batch.
  const { results: backed } = await db.prepare('SELECT node_id AS id FROM status_vote WHERE person_id = ?').bind(p.id).all<{ id: number }>()
  const bands = (await Promise.all(backed.map(b => bandStatements(ctx, b.id)))).flat()
  const norm = emailNorm(p.email)
  const stmts: D1PreparedStatement[] = [
    // First, while their seats still count their backing: a change of status the band went through since it was saved
    // is written with the backing it had then (bandStatements).
    ...bands,
    // Two closings at once (a double submit from two tabs): the second one's insert hits the first one's row, and its
    // whole batch rolls back, so nothing is mailed twice. The hourly prune drops the row a day later.
    db.prepare('INSERT INTO auth_throttle (scope, count, window_start) VALUES (?, 0, ?)').bind(`close:person:${p.id}`, ctx.at),
    db
      .prepare(
        `UPDATE person SET status = 'closed', closed_at = ?1, email = '', email_norm = 'closed:' || id, password_hash = 'closed',
           display_name = '', about = '', links = '[]', notice_prefs = '{}', is_admin = 0, digest_at = NULL
         WHERE id = ?2 AND status = 'active'`,
      )
      .bind(ctx.at, p.id),
    db.prepare('DELETE FROM session WHERE person_id = ?').bind(p.id),
    db.prepare('DELETE FROM email_token WHERE person_id = ?').bind(p.id),
    db.prepare('DELETE FROM inbox_item WHERE person_id = ?').bind(p.id),
    db.prepare('DELETE FROM mention WHERE to_person = ?').bind(p.id),
    db.prepare('DELETE FROM signup_wait WHERE person_id = ?').bind(p.id), // no "shwarm is open" mail for a closed account
    db.prepare('DELETE FROM dm_name WHERE person_id = ?').bind(p.id),
    db.prepare('DELETE FROM dm_block WHERE person_id = ?').bind(p.id),
    db.prepare('UPDATE agent_key SET revoked_at = coalesce(revoked_at, ?) WHERE person_id = ?').bind(ctx.at, p.id),
    db.prepare('DELETE FROM key_network WHERE key_id IN (SELECT id FROM agent_key WHERE person_id = ?)').bind(p.id),
    // The account mail caps' rows are named by the address (jobs/mail.ts capRange).
    db.prepare('DELETE FROM auth_throttle WHERE scope >= ? AND scope < ?').bind(`outbox:sent:${norm}#`, `outbox:sent:${norm}$`),
    db.prepare('DELETE FROM email_outbox WHERE person_id = ?').bind(p.id),
    mailStatement(db, { to: p.email, template: 'account_closed', stream: 'security', personId: p.id, payload: { handle: p.handle } }, ctx.at),
    // OPEN (#86): this doesn't wait its turn in each shwarm's tree; a join landing in the same moment stays, at worst.
    db
      .prepare(
        `UPDATE seat SET left_at = ?1 WHERE person_id = ?2 AND left_at IS NULL
         AND node_id IN (SELECT id FROM node WHERE author_id <> ?2)`,
      )
      .bind(ctx.at, p.id),
    ...joined.map(j => touchNode(ctx, j.node_id, null)),
    db.prepare('DELETE FROM status_vote WHERE person_id = ?').bind(p.id),
    // Every page that shows one of their names changes, so every signed-out version moves at once.
    moderatedStatement(ctx),
  ]
  try {
    await db.batch(stmts)
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return null // the other closing went first
    throw e
  }
  return { handle: p.handle }
}
