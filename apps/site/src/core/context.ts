// What every command shares: the clock, loading the actor's person and the node, and the statements
// most acts add to their batch (mentions, inbox notices, the node's ETag).
import { ShwarmError } from '@shwarm/protocol'
import { inboxEverySql, noticeOnSql } from '../email/notices'
import { mailToPersonStatement } from '../email/outbox'
import type { Actor } from './actor'
import { nodeHref } from './audit'
import { newId } from './ids'
import { extractMentions } from './text'
import { SEEN_NODE } from '../read/visibility'
import { actsInBeta, BETA_REFUSAL } from './site-mode'

/** `beta`: the site is in beta (core/site-mode.ts), so only invited accounts act. */
export type Ctx = { db: D1Database; now: number; at: string; beta?: boolean }

export const ctxAt = (db: D1Database, now: number, o: { beta?: boolean } = {}): Ctx => ({ db, now, at: new Date(now).toISOString(), ...(o.beta ? { beta: true } : {}) })

export type PersonRow = {
  id: number
  handle: string
  status: 'active' | 'suspended' | 'closed'
  email_verified_at: string | null
  founding: number
  established_at: string | null
  is_admin: number // the operator
}

// 'variant': rows made before variants were dropped (decided Oct 9); they read as plain shwarms. No row is a lobby now (0016).
export type NodeKind = 'shwarm' | 'branch' | 'variant'
/**
 * node.state: every node is live (decided Oct 14, "One model for every node": nothing locks; migration 0032 made the
 * passed and dead-end ones live again, their pass or dead end kept as a record). Whether a node passed is its status
 * (core/status.ts), never its state.
 */
export type NodeState = 'live'

export type NodeRow = {
  id: number
  path: string
  slug: string
  kind: NodeKind
  parent_id: number | null
  root_id: number | null
  title: string
  what: string
  done_when: string
  checks: string
  license: string
  builds_on: string | null
  author_id: number
  author_handle: string
  author_status: PersonRow['status']
  posted_by: string
  triage: 'pending' | 'held' | 'clear' | 'blocked'
  hidden: number
  paused: number
  live_at: string | null
}

/**
 * The acting person: must exist, match the actor's handle, be active and have a verified email (go-live 2.5). During the
 * beta (go-live 3.10) they must also be invited (a founding account) or the operator; the launch import passes.
 */
export async function loadPerson(ctx: Ctx, a: Actor): Promise<PersonRow> {
  const p = await ctx.db
    .prepare('SELECT id, handle, status, email_verified_at, founding, established_at, is_admin FROM person WHERE id = ?')
    .bind(a.personId)
    .first<PersonRow>()
  if (!p || p.handle !== a.handle) throw new ShwarmError('not_your_name', `@${a.handle} is not this account`)
  if (p.status !== 'active') throw new ShwarmError('not_permitted', `@${p.handle} can't act right now`, { reason: p.status })
  if (!p.email_verified_at) throw new ShwarmError('not_permitted', 'verify your email first', { reason: 'unverified' })
  // OPEN: no error code names the beta; not_permitted with a reason, as the read_only switch does.
  if (ctx.beta && a.via !== 'seed' && !actsInBeta(p)) throw new ShwarmError('not_permitted', BETA_REFUSAL, { reason: 'opens_soon' })
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

/**
 * Whether node `n` shows to the person behind an agent key (read/visibility.ts SEEN_NODE): open to everyone, or their
 * own node still being checked, under nodes that show. Site actors pass: the site reads the node as its viewer sees it
 * (readChain) before it calls core. createNode checks it for keys on the parent and the original, since it resolves
 * them itself (go-live 7.4); the API reads the node of a thread act with readChain first, as the site does. OPEN (#90):
 * the thread acts aren't checked here because the staging example's agents (seed/example.ts) act on a branch still
 * waiting for triage.
 */
export async function seenBy(ctx: Ctx, a: Actor, n: Pick<NodeRow, 'id'>): Promise<boolean> {
  return a.via !== 'key' || seenByPerson(ctx, a, n)
}

/**
 * seenBy for site actors too: for a node named by a typed path that the site doesn't read first (builds on, from the
 * /new form's field). Only the launch import passes unasked.
 */
export async function seenByPerson(ctx: Ctx, a: Actor, n: Pick<NodeRow, 'id'>): Promise<boolean> {
  if (a.via === 'seed') return true
  return !!(await ctx.db.prepare(`SELECT 1 FROM node n WHERE n.id = ?1 AND ${SEEN_NODE('n', '?2')}`).bind(n.id, a.personId).first())
}

/**
 * The node at `path`, for an act. With `a`, an agent key's act: a node its human can't see (held, blocked, or someone
 * else's still being checked) is refused as not there, so the refusal confirms nothing.
 */
export async function loadNode(ctx: Ctx, path: unknown, a?: Actor): Promise<NodeRow> {
  const n = await findNode(ctx, path)
  if (!n || (a && !(await seenBy(ctx, a, n)))) throw new ShwarmError('no_such_node', `no node at ${String(path)}`, { node: String(path) })
  // OPEN: what a paused node accepts is phase 8 (moderation); for now it takes no writes.
  if (n.paused) throw new ShwarmError('not_permitted', `${n.path} is paused`, { reason: 'paused', node: n.path })
  return n
}

export const rootOf = (path: string) => path.split('/')[0]

/**
 * One inbox item, written only while the person is active: a suspended or closed account collects nothing. Sign-off
 * items (kind 'sign_off') are history: nothing asks for a sign-off since Oct 14.
 */
export function inboxStatement(ctx: Ctx, i: { personId: number; kind: 'mention' | 'system'; nodeId: number; postId?: string | null; text: string }) {
  return ctx.db
    .prepare("INSERT INTO inbox_item (person_id, kind, node_id, post_id, text, created_at) SELECT id, ?, ?, ?, ?, ? FROM person WHERE id = ? AND status = 'active'")
    .bind(i.kind, i.nodeId, i.postId ?? null, i.text, ctx.at, i.personId)
}

/** How much of a post a mention mail quotes. OPEN (#85): the link has the rest. */
export const MENTION_MAIL_CHARS = 1000

/**
 * Mentions in a post: one row per name that resolves to an active person. A mention of the bare handle
 * also lands in that person's inbox, unless they wrote it themselves as the bare handle, and is mailed to them at once
 * when they asked for inbox mail right away (go-live 6.3); everyone else hears of it in the daily digest (jobs/digest.ts).
 */
export async function mentionStatements(
  ctx: Ctx,
  m: { postId: string; text: string; node: { id: number; path: string; title: string }; actor: Actor },
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
    if (!bare || self) continue
    stmts.push(inboxStatement(ctx, { personId: pid, kind: 'mention', nodeId: m.node.id, postId: m.postId, text: '' }))
    // The sweep sends it only while the post and its node still show to them (jobs/mail.ts).
    const chars = [...m.text]
    const payload = {
      notice: 'mention',
      by: m.actor.as,
      title: m.node.title,
      path: m.node.path,
      post: m.postId,
      link: `${nodeHref(m.node.path)}#${m.postId}`,
      text: chars.slice(0, MENTION_MAIL_CHARS).join(''),
      cut: chars.length > MENTION_MAIL_CHARS,
    }
    stmts.push(
      mailToPersonStatement(ctx.db, { template: 'mention', stream: 'notices', personId: pid, payload }, ctx.at, `${noticeOnSql('person', 'mention')} AND ${inboxEverySql('person', 'now')}`),
    )
  }
  return { names: out, stmts }
}

/**
 * Last in every batch that changes what a signed-out view shows: the node's version, its ETag for signed-out views.
 * The version is the act's audit event id, or else its post id, or else a fresh v_ token (seat changes).
 * changed_at tells the stats job (jobs/stats.ts) which nodes to roll up again. (node.in_review, the "in review" flag of
 * a submission being checked, stays 0 since nothing takes submissions: migration 0032.)
 */
export function touchNode(ctx: Ctx, nodeId: number | { path: string }, version: string | null): D1PreparedStatement {
  const where = typeof nodeId === 'number' ? 'id = ?' : 'path = ?'
  const key = typeof nodeId === 'number' ? nodeId : nodeId.path
  return ctx.db.prepare(`UPDATE node SET last_event_id = ?, changed_at = ? WHERE ${where}`).bind(version ?? newId('v'), ctx.at, key)
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

/**
 * A thread post. Every post written now is kind 'post': submissions, checks, repros and dead-end notes are history
 * (decided Oct 14, "One model for every node").
 */
export function postStatement(
  ctx: Ctx,
  p: {
    id: string
    nodeId: number
    actor: Actor
    text: string
    links?: unknown[]
    replyTo?: string | null
    join?: boolean
    claim?: 'blocked' | 'passed' | 'dead_end' | null
  },
) {
  // join: the hello a person wrote when they joined (core/nodes.ts join), marked so the thread shows it as their join.
  // claim: a thread post that says its shwarm or branch is blocked, passed or a dead end (core/status.ts).
  return ctx.db
    .prepare(
      `INSERT INTO post (id, node_id, person_id, as_name, key_id, kind, text, links, reply_to, created_at, is_join, claim)
       VALUES (?, ?, ?, ?, ?, 'post', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(p.id, p.nodeId, p.actor.personId, p.actor.as, p.actor.keyId ?? null, p.text, JSON.stringify(p.links ?? []), p.replyTo ?? null, ctx.at, p.join ? 1 : 0, p.claim ?? null)
}
