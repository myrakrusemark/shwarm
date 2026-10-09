// What every command shares: the clock, loading the actor's person and the node, and the statements
// most acts add to their batch (mentions, inbox notices, the node's review flag and ETag).
import { ShwarmError } from '@shwarm/protocol'
import { mailToAdminsStatement, mailToPersonStatement } from '../email/outbox'
import type { Actor } from './actor'
import { submissionHref } from './audit'
import type { CheckSpec } from './checks'
import { newId } from './ids'
import { extractMentions } from './text'

export type Ctx = { db: D1Database; now: number; at: string }

export const ctxAt = (db: D1Database, now: number): Ctx => ({ db, now, at: new Date(now).toISOString() })

export type PersonRow = {
  id: number
  handle: string
  status: 'active' | 'suspended' | 'closed'
  email_verified_at: string | null
  founding: number
  established_at: string | null
  is_admin: number // the operator (table B "author gone")
}

export type NodeKind = 'shwarm' | 'branch' | 'variant'
export type NodeState = 'lobby' | 'live' | 'closed' | 'dead_end'

export type NodeRow = {
  id: number
  path: string
  slug: string
  kind: NodeKind
  parent_id: number | null
  root_id: number | null
  variant_of_id: number | null
  title: string
  what: string
  checks: string
  lobby_size: number | null
  license: string
  builds_on: string | null
  author_id: number
  author_handle: string
  author_status: PersonRow['status'] // a suspended or closed author is gone: the operator takes their sign-off (table B)
  posted_by: string
  state: NodeState
  in_review: number
  triage: 'pending' | 'held' | 'clear' | 'blocked'
  hidden: number
  paused: number
  next_submission: number
  live_at: string | null
  closed_at: string | null
}

/** The acting person: must exist, match the actor's handle, be active and have a verified email (go-live 2.5). */
export async function loadPerson(ctx: Ctx, a: Actor): Promise<PersonRow> {
  const p = await ctx.db
    .prepare('SELECT id, handle, status, email_verified_at, founding, established_at, is_admin FROM person WHERE id = ?')
    .bind(a.personId)
    .first<PersonRow>()
  if (!p || p.handle !== a.handle) throw new ShwarmError('not_your_name', `@${a.handle} is not this account`)
  if (p.status !== 'active') throw new ShwarmError('not_permitted', `@${p.handle} can't act right now`, { reason: p.status })
  if (!p.email_verified_at) throw new ShwarmError('not_permitted', 'verify your email first', { reason: 'unverified' })
  return p
}

/** A6: founding accounts count as established at once; others from their established date. */
export const isEstablished = (p: PersonRow, now: number) =>
  p.founding === 1 || (p.established_at !== null && Date.parse(p.established_at) <= now)

// OPEN: no path length or branch depth cap is decided. createNode refuses paths findNode wouldn't read back.
export const MAX_PATH = 600

export async function findNode(ctx: Ctx, path: unknown): Promise<NodeRow | null> {
  if (typeof path !== 'string' || !path || path.length > MAX_PATH) return null
  const n = await ctx.db
    .prepare('SELECT n.*, p.handle AS author_handle, p.status AS author_status FROM node n JOIN person p ON p.id = n.author_id WHERE n.path = ?')
    .bind(path)
    .first<NodeRow>()
  return n && !n.hidden ? n : null
}

export async function loadNode(ctx: Ctx, path: unknown): Promise<NodeRow> {
  const n = await findNode(ctx, path)
  if (!n) throw new ShwarmError('no_such_node', `no node at ${String(path)}`, { node: String(path) })
  // OPEN: what a paused node accepts is phase 8 (moderation); for now it takes no writes.
  if (n.paused) throw new ShwarmError('not_permitted', `${n.path} is paused`, { reason: 'paused', node: n.path })
  return n
}

export const specOf = (n: NodeRow) => JSON.parse(n.checks) as CheckSpec

export const rootOf = (path: string) => path.split('/')[0]

const WEEK_MS = 7 * 86_400_000

/**
 * System inbox items (table B): one per person, in one statement evaluated inside the batch, so it sees the
 * seat or post committed just before it. 'seats' = seat holders; 'involved' = seat holders, the author and
 * everyone who posted in the last 7 days (table B #44).
 */
export function notifyStatement(ctx: Ctx, nodeId: number, text: string, who: 'seats' | 'involved'): D1PreparedStatement {
  const seats = 'SELECT person_id AS pid FROM seat WHERE node_id = ?1 AND left_at IS NULL'
  const involved = `${seats} UNION SELECT author_id FROM node WHERE id = ?1 UNION SELECT person_id FROM post WHERE node_id = ?1 AND created_at > ?4`
  const args: unknown[] = [nodeId, text, ctx.at]
  if (who === 'involved') args.push(new Date(ctx.now - WEEK_MS).toISOString())
  return ctx.db
    .prepare(
      `INSERT INTO inbox_item (person_id, kind, node_id, text, created_at)
       SELECT x.pid, 'system', ?1, ?2, ?3 FROM (${who === 'seats' ? seats : involved}) x
       JOIN person pr ON pr.id = x.pid WHERE pr.status = 'active'`,
    )
    .bind(...args)
}

/** One inbox item, written only while the person is active: a suspended or closed account collects nothing (as notifyStatement). */
export function inboxStatement(ctx: Ctx, i: { personId: number; kind: 'mention' | 'sign_off' | 'system'; nodeId: number; postId?: string | null; text: string }) {
  return ctx.db
    .prepare("INSERT INTO inbox_item (person_id, kind, node_id, post_id, text, created_at) SELECT id, ?, ?, ?, ?, ? FROM person WHERE id = ? AND status = 'active'")
    .bind(i.kind, i.nodeId, i.postId ?? null, i.text, ctx.at, i.personId)
}

/**
 * Ready for the author (go-live 5.4): the sign_off inbox item and its mail, both in the act's batch. The mail goes
 * only to an active author (mailToPersonStatement); the notices stream honours their 'sign_off' opt-out when it sends.
 * `only`: the author is the submission's only check, so it is ready at once.
 * Author gone (table B): while the author's account is suspended or closed, the operator signs off in their place, so
 * the item and the mail go to every active admin instead. OPEN (#75): if the author comes back before signing, the item
 * stays with the admins; the author sees "waiting on you" on the page, but nothing new lands in their inbox.
 */
export function signOffStatements(ctx: Ctx, n: NodeRow, s: { postId: string; number: number }, only: boolean): D1PreparedStatement[] {
  const payload = { notice: 'sign_off', handle: n.author_handle, number: s.number, title: n.title, link: submissionHref(n.path, s.number), ...(only ? { only: true } : {}) }
  if (n.author_status !== 'active')
    return [
      ctx.db
        .prepare("INSERT INTO inbox_item (person_id, kind, node_id, post_id, text, created_at) SELECT id, 'sign_off', ?, ?, ?, ? FROM person WHERE is_admin = 1 AND status = 'active'")
        .bind(n.id, s.postId, `#${s.number} on ${n.title} is ready for sign-off. its author is gone, so the operator signs off.`, ctx.at),
      mailToAdminsStatement(ctx.db, { template: 'sign_off_ready', stream: 'notices', payload: { ...payload, author: n.author_handle, author_gone: true } }, ctx.at),
    ]
  return [
    inboxStatement(ctx, { personId: n.author_id, kind: 'sign_off', nodeId: n.id, postId: s.postId, text: `#${s.number} on ${n.title} is ready for your sign-off.` }),
    mailToPersonStatement(ctx.db, { template: 'sign_off_ready', stream: 'notices', personId: n.author_id, payload }, ctx.at),
  ]
}

/**
 * Sign-off items are done once nothing is left to sign: the submission `on` passed or failed or took a fail, the ones
 * `replacedBy` superseded, or every one on a node that became a dead end (`deadEnd`). Kept in the inbox, read or not;
 * done_at only takes them off "waiting on you".
 */
export function signOffDoneStatement(ctx: Ctx, nodeId: number, s: { on: string } | { replacedBy: string } | 'deadEnd'): D1PreparedStatement {
  if (s === 'deadEnd')
    return ctx.db
      .prepare(`UPDATE inbox_item SET done_at = ?1 WHERE kind = 'sign_off' AND done_at IS NULL AND post_id IN (SELECT post_id FROM submission WHERE node_id = ?2)`)
      .bind(ctx.at, nodeId)
  const subs = 'on' in s ? 'SELECT ?3' : 'SELECT post_id FROM submission WHERE node_id = ?2 AND superseded_by = ?3'
  return ctx.db
    .prepare(`UPDATE inbox_item SET done_at = ?1 WHERE kind = 'sign_off' AND done_at IS NULL AND post_id IN (${subs})`)
    .bind(ctx.at, nodeId, 'on' in s ? s.on : s.replacedBy)
}

/**
 * Reopening a dead end puts back the sign-off items the dead end took off "waiting on you" (done at `endedAt`, the
 * node's closed_at), for submissions still in review with no standing fail. OPEN (#73): the docs don't say what a dead end
 * does to a waiting sign-off; it waits again on reopen, with no second mail.
 */
export function signOffReopenStatement(ctx: Ctx, nodeId: number, endedAt: string): D1PreparedStatement {
  return ctx.db
    .prepare(
      `UPDATE inbox_item SET done_at = NULL WHERE kind = 'sign_off' AND done_at = ?1 AND post_id IN (
         SELECT s.post_id FROM submission s WHERE s.node_id = ?2 AND s.status = 'in_review'
         AND NOT EXISTS (SELECT 1 FROM check_report c WHERE c.submission_id = s.post_id AND c.verdict = 'fail' AND c.reset_at IS NULL))`,
    )
    .bind(endedAt, nodeId)
}

/**
 * Mentions in a post: one row per name that resolves to an active person. A mention of the bare handle
 * also lands in that person's inbox, unless they wrote it themselves as the bare handle.
 */
export async function mentionStatements(
  ctx: Ctx,
  m: { postId: string; text: string; nodeId: number; actor: Actor },
): Promise<{ names: string[]; stmts: D1PreparedStatement[] }> {
  const names = extractMentions(m.text).slice(0, 50) // OPEN: no cap on mentions per post is decided; 50 bounds the batch
  if (!names.length) return { names: [], stmts: [] }
  const handles = [...new Set(names.map(n => n.slice(1).split('/')[0]))]
  const { results } = await ctx.db
    .prepare(`SELECT id, handle FROM person WHERE status = 'active' AND handle IN (${handles.map(() => '?').join(', ')})`)
    .bind(...handles)
    .all<{ id: number; handle: string }>()
  const byHandle = new Map(results.map(r => [r.handle, r.id]))
  const out: string[] = []
  const stmts: D1PreparedStatement[] = []
  for (const name of names) {
    const handle = name.slice(1).split('/')[0]
    const pid = byHandle.get(handle)
    if (pid === undefined) continue
    out.push(name)
    stmts.push(
      ctx.db.prepare('INSERT INTO mention (post_id, to_name, to_person, created_at) VALUES (?, ?, ?, ?)').bind(m.postId, name, pid, ctx.at),
    )
    const bare = !name.includes('/')
    const self = pid === m.actor.personId && !m.actor.as.includes('/')
    if (bare && !self) stmts.push(inboxStatement(ctx, { personId: pid, kind: 'mention', nodeId: m.nodeId, postId: m.postId, text: '' }))
  }
  return { names: out, stmts }
}

/**
 * Last in every batch that changes what a signed-out view shows: the "in review" flag (a label on live only,
 * so a dead end or a closed node never shows it) and the node's version, its ETag for signed-out views.
 * The version is the act's audit event id, or else its post id, or else a fresh v_ token (seat changes).
 * changed_at tells the stats job (jobs/stats.ts) which nodes to roll up again.
 */
export function touchNode(ctx: Ctx, nodeId: number | { path: string }, version: string | null): D1PreparedStatement {
  const where = typeof nodeId === 'number' ? 'id = ?' : 'path = ?'
  const key = typeof nodeId === 'number' ? nodeId : nodeId.path
  return ctx.db
    .prepare(
      `UPDATE node SET in_review = (state = 'live' AND EXISTS (SELECT 1 FROM submission s WHERE s.node_id = node.id AND s.status = 'in_review')),
       last_event_id = ?, changed_at = ? WHERE ${where}`,
    )
    .bind(version ?? newId('v'), ctx.at, key)
}

/**
 * Last in every moderation batch (hiding or unhiding a post or a node, a triage change), next to touchNode on the
 * node acted on (and its parent, whose sidebar lists it, so the stats job rolls it up again). A takedown can change
 * pages other than the node's own: the parent's sidebar, a thread whose post was built on by a hidden submission,
 * a node that builds on a held one. So this moves one site-wide version that every signed-out ETag carries
 * (web/node-routes.ts etagOf, read through readChain). A direct UPDATE that skips this leaves cached pages stale.
 */
export function moderatedStatement(ctx: Ctx): D1PreparedStatement {
  return ctx.db
    .prepare(
      `INSERT INTO setting (key, value, updated_at) VALUES ('moderated_at', ?1, ?2)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(JSON.stringify(newId('v')), ctx.at)
}

export function postStatement(
  ctx: Ctx,
  p: { id: string; nodeId: number; actor: Actor; kind: 'post' | 'submission' | 'check' | 'repro' | 'dead_end'; text: string; links?: unknown[]; replyTo?: string | null },
) {
  return ctx.db
    .prepare(
      `INSERT INTO post (id, node_id, person_id, as_name, key_id, kind, text, links, reply_to, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(p.id, p.nodeId, p.actor.personId, p.actor.as, p.actor.keyId ?? null, p.kind, p.text, JSON.stringify(p.links ?? []), p.replyTo ?? null, ctx.at)
}
