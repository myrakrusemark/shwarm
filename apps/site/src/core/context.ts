// What every command shares: the clock, loading the actor's person and the node, and the statements
// most acts add to their batch (mentions, inbox notices, the node's review flag and ETag).
import { ShwarmError } from '@shwarm/protocol'
import type { Actor } from './actor'
import type { CheckSpec } from './checks'
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
  checks: string
  lobby_size: number | null
  license: string
  builds_on: string | null
  author_id: number
  author_handle: string
  posted_by: string
  state: NodeState
  in_review: number
  hidden: number
  paused: number
  next_submission: number
  live_at: string | null
  closed_at: string | null
}

/** The acting person: must exist, match the actor's handle, be active and have a verified email (go-live 2.5). */
export async function loadPerson(ctx: Ctx, a: Actor): Promise<PersonRow> {
  const p = await ctx.db
    .prepare('SELECT id, handle, status, email_verified_at, founding, established_at FROM person WHERE id = ?')
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

export async function findNode(ctx: Ctx, path: unknown): Promise<NodeRow | null> {
  if (typeof path !== 'string' || !path || path.length > 600) return null
  const n = await ctx.db
    .prepare('SELECT n.*, p.handle AS author_handle FROM node n JOIN person p ON p.id = n.author_id WHERE n.path = ?')
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

export function inboxStatement(ctx: Ctx, i: { personId: number; kind: 'mention' | 'sign_off' | 'system'; nodeId: number; postId?: string | null; text: string }) {
  return ctx.db
    .prepare('INSERT INTO inbox_item (person_id, kind, node_id, post_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(i.personId, i.kind, i.nodeId, i.postId ?? null, i.text, ctx.at)
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

/** Last in every batch: the "in review" flag (a label on live, not a state) and the ETag for signed-out views. */
export function touchNode(ctx: Ctx, nodeId: number | { path: string }, lastEventId: string | null): D1PreparedStatement {
  const where = typeof nodeId === 'number' ? 'id = ?' : 'path = ?'
  const key = typeof nodeId === 'number' ? nodeId : nodeId.path
  return ctx.db
    .prepare(
      `UPDATE node SET in_review = EXISTS (SELECT 1 FROM submission s WHERE s.node_id = node.id AND s.status = 'in_review'),
       last_event_id = COALESCE(?, last_event_id) WHERE ${where}`,
    )
    .bind(lastEventId, key)
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
