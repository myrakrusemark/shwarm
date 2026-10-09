// Nodes and their states (A11, spec "Node states", "Creating a node", protocol §8).
//   lobby → live      when the seats fill (lobby_filled; everyone seated gets an inbox item)
//   live → closed     on a pass (checks.ts / checking.ts)
//   live → dead_end   by the author, with a required note
//   closed → live     when a repro is posted on the passing submission (reopened; the pass stays on record)
//   dead_end → live   when the author reopens it
// While a lobby, the author may re-pitch it: a new title and pitch, the old ones kept in node_edit (repitch).
// "In review" is a flag on live, not a state. Branches are live at once; shwarms and variants open as lobbies.
import { ShwarmError } from '@shwarm/protocol'
import { authorize, humanName, needHuman, needStepUp, type Actor } from './actor'
import { auditStatement, nodeHref } from './audit'
import { parseCheckSpec } from './checks'
import { findNode, loadNode, loadPerson, MAX_PATH, moderatedStatement, noticeMailStatement, notifyStatement, postStatement, signOffDoneStatement, signOffReopenStatement, touchNode, type Ctx, type NodeKind, type NodeRow } from './context'
import { newId } from './ids'
import { checkNewNodes, newNodeGuard, takeThreadToken } from './limits'
import { checkWritable, readSettings } from './settings'
import { OPEN_NODE } from '../read/visibility'
import { MAX_SLUG, MAX_TITLE, needText, RESERVED_SLUGS, slugify } from './text'

// A2 (decided Oct 8): a default and a short open list. OPEN: the identifiers are proposed in protocol §8.
export const DEFAULT_LICENSE = 'MIT+CC-BY-4.0'
export const LICENSES: readonly string[] = ['MIT+CC-BY-4.0', 'MIT', 'Apache-2.0', 'GPL-3.0', 'AGPL-3.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0']

export const DEFAULT_LOBBY = 10 // decided
const MAX_LOBBY = 10_000 // OPEN: no upper bound is decided (#22 covers changing it later)
const MAX_TAGS = 8 // OPEN: no tag count or tag pattern is decided
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

const bad = (m: string, d: Record<string, unknown> = {}) => new ShwarmError('bad_request', m, d)

export type CreateNodeInput = {
  kind: NodeKind
  parent?: string // branch: the parent's path
  variantOf?: string // variant: the original shwarm's path
  title: string
  what: string
  doneWhen: string
  check: unknown // CheckSpec, flat or grouped
  tags?: string[]
  lobby?: number
  license?: string
  buildsOn?: string | { name: string; url?: string; license: string } | null
  slug?: string // the launch import only (A18): keeps the slug the launch list chose instead of one from the title
}

export type CreateNodeResult = {
  path: string
  kind: NodeKind
  state: 'lobby' | 'live'
  seats?: { filled: number; of: number }
  license: string
  limits: { new_nodes_today: { left: number } }
}

function parseTags(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length) throw bad('a shwarm needs at least one tag')
  const tags = [...new Set(v.map(t => (typeof t === 'string' ? t.trim().replace(/^#/, '').toLowerCase() : '')))]
  if (tags.length > MAX_TAGS) throw bad(`at most ${MAX_TAGS} tags`)
  for (const t of tags) if (!TAG_RE.test(t)) throw bad(`"${t}" is not a tag: lowercase letters, digits and dashes`)
  return tags
}

// OPEN: building on a node that is still open isn't described; the protocol only builds on closed shwarms.
function needClosed(n: NodeRow): void {
  if (n.state !== 'closed') throw bad(`${n.path} isn't closed. to change an open shwarm's done test, start a variant`)
}

type NodeAt = Pick<NodeRow, 'path' | 'kind' | 'state'>

/** Variants are only for open shwarms (lobby or live); a closed one is built on instead. */
function needOpen(n: Pick<NodeRow, 'path' | 'state'>): void {
  if (n.state === 'closed' || n.state === 'dead_end')
    throw new ShwarmError('shwarm_closed', `${n.path} is ${n.state.replace('_', ' ')}. variants are only for open shwarms; build on it instead`, { node: n.path })
}

/** A variant's original: an open shwarm or variant, never a branch. The create form (web/create.tsx) asks before it shows. */
export function needVariantable(n: NodeAt): void {
  if (n.kind === 'branch') throw bad('variants are of shwarms only. disagree with a branch? open a sibling branch')
  needOpen(n)
}

/** A branch's parent: live only. Branches open at kickoff, and a closed or dead-end node takes none. */
export function needBranchable(n: NodeAt): void {
  if (n.state === 'lobby') throw new ShwarmError('lobby_not_open', `${n.path} is still a lobby. branches open at kickoff`, { node: n.path })
  // OPEN: branching a closed or dead-end node isn't described; refused until decided.
  if (n.state !== 'live') throw new ShwarmError('shwarm_closed', `${n.path} is ${n.state.replace('_', ' ')}`, { node: n.path })
}

/** builds_on: a closed shwarm's path, or an outside project {name, url?, license}. Either way its license carries over. */
async function parseBuildsOn(ctx: Ctx, v: CreateNodeInput['buildsOn']): Promise<{ json: string; license: string; node?: NodeRow } | null> {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'string') {
    const n = await findNode(ctx, v)
    if (!n) throw bad('builds_on names a shwarm on shwarm, or an outside project as {name, url, license}')
    needClosed(n)
    return { json: JSON.stringify({ node: n.path }), license: n.license, node: n }
  }
  if (typeof v !== 'object') throw bad('builds_on is a path or {name, url, license}')
  const name = needText(v.name, 'builds_on.name', 200)
  if (typeof v.license !== 'string' || !v.license.trim() || v.license.length > 100)
    throw new ShwarmError('bad_license', 'builds_on needs the upstream license, which this node takes')
  let url: string | undefined
  if (v.url !== undefined) {
    try {
      const u = new URL(String(v.url))
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw 0
      url = u.toString()
    } catch {
      throw bad('builds_on.url is not a web address')
    }
  }
  return { json: JSON.stringify({ name, ...(url ? { url } : {}), license: v.license.trim() }), license: v.license.trim() }
}

async function freePath(ctx: Ctx, prefix: string, base: string): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const slug = i === 1 ? base : `${base}-${i}`
    if (i === 1 && RESERVED_SLUGS.has(slug)) continue
    const path = prefix + slug
    if (!(await ctx.db.prepare('SELECT 1 FROM node WHERE path = ?').bind(path).first())) return path
  }
  throw bad('that title is taken too many times. try another')
}

export async function createNode(ctx: Ctx, a: Actor, inp: CreateNodeInput): Promise<CreateNodeResult> {
  const kind = inp?.kind
  if (kind !== 'shwarm' && kind !== 'branch' && kind !== 'variant') throw bad('kind is shwarm, branch or variant')
  if (kind === 'branch') authorize(a, 'branch', String(inp.parent))
  else if (kind === 'variant') authorize(a, 'branch', String(inp.variantOf))
  else authorize(a, 'new_shwarms', '*')
  const person = await loadPerson(ctx, a)
  // The launch import skips pause_new_nodes: in beta, new nodes stay paused while approved shwarms go in (go-live 3.10).
  checkWritable(await readSettings(ctx.db, ['read_only', 'pause_new_nodes']), a.via !== 'seed')

  const title = needText(inp.title, 'title', MAX_TITLE)
  const what = needText(inp.what, 'what')
  if (typeof inp.doneWhen !== 'string' || !inp.doneWhen.trim()) throw new ShwarmError('no_done_test', 'a node needs a done test: one sentence of what is true when it is finished')
  const doneWhen = needText(inp.doneWhen, 'done_when', 2000)
  const spec = parseCheckSpec(inp.check)

  let parent = null
  let original = null
  let license: string
  let buildsOn: string | null = null
  let upstream: NodeRow | null = null // builds_on another node, in another tree
  let tags: string[] = []
  let lobby: number | null = null
  if (kind === 'branch') {
    parent = await loadNode(ctx, inp.parent)
    needBranchable(parent)
    if (inp.license !== undefined && inp.license !== null && inp.license !== parent.license)
      throw new ShwarmError('bad_license', `branches take the parent's license (${parent.license})`)
    if (inp.buildsOn !== undefined && inp.buildsOn !== null) throw bad("branches take the parent's builds on. send none")
    if (inp.lobby !== undefined && inp.lobby !== null) throw bad('branches have no lobby')
    if (Array.isArray(inp.tags) && inp.tags.length) throw bad('branches have no tags')
    license = parent.license
    buildsOn = parent.builds_on
  } else {
    if (kind === 'variant') {
      original = await loadNode(ctx, inp.variantOf)
      needVariantable(original)
    }
    tags = parseTags(inp.tags)
    lobby = inp.lobby === undefined || inp.lobby === null ? DEFAULT_LOBBY : (inp.lobby as number)
    if (!Number.isInteger(lobby) || lobby < 1 || lobby > MAX_LOBBY) throw bad(`lobby is a number of people from 1 to ${MAX_LOBBY}`)
    const b = await parseBuildsOn(ctx, inp.buildsOn)
    if (b) {
      buildsOn = b.json
      upstream = b.node ?? null
      license = b.license // the upstream license wins; any license sent is ignored (protocol §8)
    } else {
      license = inp.license ?? DEFAULT_LICENSE
      if (!LICENSES.includes(license)) throw new ShwarmError('bad_license', `pick one of ${LICENSES.join(', ')}`, { allowed: LICENSES })
    }
  }

  const left = a.via === 'seed' ? Infinity : await checkNewNodes(ctx.db, { personId: person.id, handle: person.handle }, ctx.now)
  let path: string
  if (inp.slug !== undefined && inp.slug !== null) {
    // OPEN: only the seed sets a slug (the launch list's own); everyone else's comes from the title (protocol §3).
    if (a.via !== 'seed') throw bad('the slug comes from the title')
    const s = inp.slug
    if (typeof s !== 'string' || !SLUG_RE.test(s) || s.length > MAX_SLUG || RESERVED_SLUGS.has(s))
      throw bad(`"${String(s)}" is not a slug: lowercase letters, digits and single dashes`)
    path = (parent ? parent.path + '/' : '') + s
    if (await ctx.db.prepare('SELECT 1 FROM node WHERE path = ?').bind(path).first()) throw bad(`${path} is taken`)
  } else {
    const base = slugify(title)
    if (!base) throw bad('the title needs at least one letter or digit')
    path = await freePath(ctx, parent ? parent.path + '/' : '', base)
  }
  if (path.length > MAX_PATH) throw bad(`that path would be over ${MAX_PATH} characters. use a shorter title, or branch higher up`)

  // The author takes seat 1 when they start it themselves; an agent's shwarm opens with no seat (decisions, "agents may start").
  const seated = kind !== 'branch' && a.via !== 'key'
  const filled = kind !== 'branch' && seated && (lobby as number) <= 1
  const state = kind === 'branch' || filled ? 'live' : 'lobby'
  const ref = { path }
  // What was read from outside this tree is checked again inside the batch: the daily limit (creates in
  // other trees don't queue behind this one), and the state of the original or upstream node, whose own
  // tree may close or reopen it meanwhile. If any fails, the INSERT writes nothing, and nor does the rest.
  const guards: string[] = []
  const guardArgs: unknown[] = []
  if (a.via !== 'seed') {
    const g = newNodeGuard(person.id, ctx.now)
    guards.push(g.sql)
    guardArgs.push(...g.args)
  }
  if (original) {
    guards.push("EXISTS (SELECT 1 FROM node WHERE id = ? AND state IN ('lobby', 'live'))")
    guardArgs.push(original.id)
  }
  if (upstream) {
    guards.push("EXISTS (SELECT 1 FROM node WHERE id = ? AND state = 'closed')")
    guardArgs.push(upstream.id)
  }
  const stmts: D1PreparedStatement[] = [
    ctx.db
      .prepare(
        `INSERT INTO node (path, slug, kind, parent_id, root_id, variant_of_id, title, what, done_when, checks, lobby_size, license,
           builds_on, author_id, posted_by, state, created_at, live_at, seeded)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guards.length ? guards.join(' AND ') : '1'}`,
      )
      .bind(
        path,
        path.split('/').pop(),
        kind,
        parent?.id ?? null,
        parent ? (parent.root_id ?? parent.id) : null,
        original?.id ?? null,
        title,
        what,
        doneWhen,
        JSON.stringify(spec),
        lobby,
        license,
        buildsOn,
        person.id,
        a.as,
        state,
        ctx.at,
        state === 'live' ? ctx.at : null,
        a.via === 'seed' ? 1 : 0,
        ...guardArgs,
      ),
  ]
  // node.triage starts at its 'pending' default ("being checked", A8). Triage runs after this batch, outside the tree:
  // each caller hands the new path to triage/run.ts triageNew (web/create.tsx does), and the minute sweep catches
  // any it misses.
  for (const t of tags) stmts.push(ctx.db.prepare('INSERT INTO node_tag (node_id, tag) SELECT id, ? FROM node WHERE path = ?').bind(t, path))
  if (seated)
    stmts.push(ctx.db.prepare("INSERT INTO seat (node_id, person_id, number, joined_at) SELECT id, ?, 1, ? FROM node WHERE path = ?").bind(person.id, ctx.at, path))
  let last: string | null = null
  if (kind === 'branch') {
    const e = auditStatement(ctx.db, { event: 'branch_opened', node: ref, by: a.as, detail: title, evidence: nodeHref(path) }, ctx.at)
    stmts.push(e.stmt)
    last = e.id
  }
  if (filled) {
    const e = auditStatement(ctx.db, { event: 'lobby_filled', node: ref, by: a.as, detail: `1 of ${lobby} seats`, evidence: nodeHref(path) }, ctx.at)
    stmts.push(e.stmt)
    last = e.id
  }
  stmts.push(touchNode(ctx, ref, last))
  const res = await ctx.db.batch(stmts)
  if (!res[0]?.meta?.changes) {
    // A guard failed: say which, from a fresh read.
    if (a.via !== 'seed') await checkNewNodes(ctx.db, { personId: person.id, handle: person.handle }, ctx.now)
    if (original) needOpen(await loadNode(ctx, original.path))
    if (upstream) {
      const u = await findNode(ctx, upstream.path)
      if (!u) throw bad('builds_on names a shwarm on shwarm, or an outside project as {name, url, license}')
      needClosed(u)
    }
    throw bad('something changed while this was sent. try again')
  }
  return {
    path,
    kind,
    state,
    ...(kind !== 'branch' ? { seats: { filled: seated ? 1 : 0, of: lobby as number } } : {}),
    license,
    limits: { new_nodes_today: { left: Number.isFinite(left) ? left : 0 } },
  }
}

export type JoinResult = { node: string; seat: number; state: 'lobby' | 'live'; seats: { filled: number; of: number }; kickoff: boolean }

/** Take a seat. Each person is one seat, however many agents they bring. When the last seat fills, the shwarm kicks off. */
export async function join(ctx: Ctx, a: Actor, inp: { node: string }): Promise<JoinResult> {
  needHuman(a, 'joining')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp?.node)
  if (n.kind === 'branch') throw bad('branches have no seats. just start working')
  // OPEN: joining a closed or dead-end shwarm isn't described; late joiners are welcome only while it's open.
  if (n.state !== 'lobby' && n.state !== 'live') throw new ShwarmError('shwarm_closed', `${n.path} is ${n.state.replace('_', ' ')}`, { node: n.path })
  const of = n.lobby_size as number
  const seats = await ctx.db
    .prepare('SELECT COALESCE(SUM(left_at IS NULL), 0) AS filled, COALESCE(MAX(number), 0) AS top FROM seat WHERE node_id = ?')
    .bind(n.id)
    .first<{ filled: number; top: number }>()
  const mine = await ctx.db.prepare('SELECT number, left_at FROM seat WHERE node_id = ? AND person_id = ?').bind(n.id, person.id).first<{ number: number; left_at: string | null }>()
  if (mine && mine.left_at === null) return { node: n.path, seat: mine.number, state: n.state, seats: { filled: seats!.filled, of }, kickoff: false }

  const stmts: D1PreparedStatement[] = []
  let seat: number
  if (mine) {
    seat = mine.number
    stmts.push(ctx.db.prepare('UPDATE seat SET left_at = NULL, joined_at = ? WHERE node_id = ? AND person_id = ?').bind(ctx.at, n.id, person.id))
  } else {
    seat = seats!.top + 1
    stmts.push(
      ctx.db
        .prepare('INSERT INTO seat (node_id, person_id, number, joined_at) VALUES (?, ?, (SELECT COALESCE(MAX(number), 0) + 1 FROM seat WHERE node_id = ?), ?)')
        .bind(n.id, person.id, n.id, ctx.at),
    )
  }
  const filled = seats!.filled + 1
  const kickoff = n.state === 'lobby' && filled >= of
  let last: string | null = null
  if (kickoff) {
    stmts.push(ctx.db.prepare("UPDATE node SET state = 'live', live_at = ? WHERE id = ?").bind(ctx.at, n.id))
    const e = auditStatement(ctx.db, { event: 'lobby_filled', node: n.id, by: a.as, detail: `${filled} of ${of} seats`, evidence: nodeHref(n.path) }, ctx.at)
    stmts.push(
      e.stmt,
      notifyStatement(ctx, n.id, `${n.title}: the lobby filled. it's live now.`, 'seats'),
      // The kickoff mail (go-live 4.4) to everyone seated, the joiner too.
      noticeMailStatement(ctx, n.id, 'seats', { template: 'kickoff', payload: { notice: 'kickoff', title: n.title, path: n.path, link: nodeHref(n.path), seats: filled } }),
    )
    last = e.id
  }
  stmts.push(touchNode(ctx, n.id, last))
  await ctx.db.batch(stmts)
  return { node: n.path, seat, state: kickoff ? 'live' : n.state, seats: { filled, of }, kickoff }
}

/** Leave a seat: any time before kickoff; the author can't leave (table B #29). */
export async function leave(ctx: Ctx, a: Actor, inp: { node: string }): Promise<{ node: string; seats: { filled: number; of: number } }> {
  needHuman(a, 'leaving a seat')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp?.node)
  if (n.kind === 'branch') throw bad('branches have no seats')
  if (n.state !== 'lobby') throw bad('seats are kept after kickoff')
  if (n.author_id === person.id) throw bad("the author can't leave their own lobby")
  await ctx.db.batch([
    ctx.db.prepare('UPDATE seat SET left_at = ? WHERE node_id = ? AND person_id = ? AND left_at IS NULL').bind(ctx.at, n.id, person.id),
    touchNode(ctx, n.id, null), // the seat count shows signed out
  ])
  const r = await ctx.db.prepare('SELECT COUNT(*) AS filled FROM seat WHERE node_id = ? AND left_at IS NULL').bind(n.id).first<{ filled: number }>()
  return { node: n.path, seats: { filled: r!.filled, of: n.lobby_size as number } }
}

export type RepitchInput = { node: string; title: string; what: string }
export type RepitchResult = { node: string; repitched: boolean; at: string; triage: NodeRow['triage'] }

/**
 * Re-pitch a lobby (spec "Starting a shwarm", LOBBY-6; table B #30): the author changes the title and the pitch ("what")
 * while it's a lobby; the done test, checks, license and address never change. The version it replaces goes to node_edit,
 * so the page can show the history: to everyone only if everyone could read it then, otherwise to the author alone
 * (OPEN #79). Acts with the author's authority, so it confirms with the password (A5), and happens only on the site, as
 * the bare handle (no edit API at launch, table B #30). The same title and pitch again change nothing.
 * The new words are checked like a new node's (A8): a cleared node goes back to 'pending' ("being checked", seen only by
 * its author; a seeded one stays public while pending) and a new triage round starts (triage_since), which the caller
 * runs after this batch (triage/run.ts triageNew). A held node stays held, for Myra to read again; a blocked one can't be
 * re-pitched.
 * OPEN (#79): a re-pitch spends a thread post token, so it can't flood the history or triage.
 */
export async function repitch(ctx: Ctx, a: Actor, inp: RepitchInput): Promise<RepitchResult> {
  needHuman(a, 're-pitching')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp?.node)
  if (n.author_id !== person.id) throw new ShwarmError('not_permitted', 'only the author re-pitches', { need: 'author', node: n.path })
  needStepUp(a, 're-pitching')
  if (n.state !== 'lobby') throw bad(n.kind === 'branch' ? 'branches have no lobby to re-pitch' : `${n.path} kicked off. the pitch is kept as it was`, { node: n.path })
  if (n.triage === 'blocked') throw new ShwarmError('not_permitted', `${n.path} was blocked. it can't be re-pitched`, { reason: 'blocked', node: n.path })
  const title = needText(inp.title, 'title', MAX_TITLE)
  const what = needText(inp.what, 'what')
  if (title === n.title && what === n.what) return { node: n.path, repitched: false, at: ctx.at, triage: n.triage }
  const bucket = await takeThreadToken(ctx.db, { personId: person.id, handle: person.handle, nodeId: n.id, path: n.path }, ctx.now)
  const recheck = n.triage === 'clear' || n.triage === 'pending'
  // Triage runs outside the tree, so the round restarts on the node's triage as it is when the batch runs: a hold or a
  // block that lands meanwhile stands.
  const res = await ctx.db.batch([
    // The version it replaces, read as the batch runs, noting whether everyone could read it then: words still being
    // checked or held were never cleared, so they show in the history to the author alone (read/node.ts readPitchEdits).
    // Same guard as the update below, so the two land or skip together.
    ctx.db
      .prepare(
        `INSERT INTO node_edit (node_id, by_name, title, what, edited_at, was_public)
         SELECT id, ?1, title, what, ?2, ${OPEN_NODE('node')} FROM node WHERE id = ?3 AND state = 'lobby' AND triage <> 'blocked'`,
      )
      .bind(a.as, ctx.at, n.id),
    ctx.db
      .prepare(
        `UPDATE node SET title = ?1, what = ?2,
           triage_since = CASE WHEN triage IN ('clear', 'pending') THEN ?3 ELSE triage_since END,
           triage = CASE WHEN triage = 'clear' THEN 'pending' ELSE triage END
         WHERE id = ?4 AND state = 'lobby' AND triage <> 'blocked'`,
      )
      .bind(title, what, ctx.at, n.id),
    bucket.stmt,
    touchNode(ctx, n.id, null),
    // A cleared node leaves the public until it's checked again, so every signed-out page that lists it changes.
    ...(recheck ? [moderatedStatement(ctx)] : []),
  ])
  if (!res[1]?.meta?.changes) throw new ShwarmError('not_permitted', `${n.path} was blocked. it can't be re-pitched`, { reason: 'blocked', node: n.path })
  return { node: n.path, repitched: true, at: ctx.at, triage: recheck ? 'pending' : n.triage }
}

/** live → dead end, by the author, with a note so nobody repeats it. Acts with the author's authority, so it confirms with the password. */
export async function deadEnd(ctx: Ctx, a: Actor, inp: { node: string; note: string }): Promise<{ node: string; state: 'dead_end'; post: string }> {
  needHuman(a, 'marking a dead end')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp?.node)
  if (n.author_id !== person.id) throw new ShwarmError('not_permitted', 'only the author marks a dead end', { need: 'author', node: n.path })
  needStepUp(a, 'marking a dead end')
  if (n.state === 'lobby') throw new ShwarmError('lobby_not_open', `${n.path} is still a lobby`, { node: n.path })
  if (n.state !== 'live') throw new ShwarmError('shwarm_closed', `${n.path} is ${n.state.replace('_', ' ')}`, { node: n.path })
  const note = needText(inp.note, 'note')
  const postId = newId('p')
  const e = auditStatement(ctx.db, { event: 'dead_end', node: n.id, by: a.as, detail: note.slice(0, 280), evidence: `${nodeHref(n.path)}#${postId}` }, ctx.at)
  await ctx.db.batch([
    postStatement(ctx, { id: postId, nodeId: n.id, actor: a, kind: 'dead_end', text: note }),
    // closed_at is when it ended (the closed tab's order and time); later posts move changed_at, never this.
    ctx.db.prepare("UPDATE node SET state = 'dead_end', dead_end_note = ?, closed_at = ? WHERE id = ?").bind(note, ctx.at, n.id),
    // A dead end takes no checks, so no sign-off waits on the author while it lasts; reopen puts them back.
    signOffDoneStatement(ctx, n.id, 'deadEnd'),
    e.stmt,
    touchNode(ctx, n.id, e.id),
  ])
  return { node: n.path, state: 'dead_end', post: postId }
}

/** dead end → live, when the author reopens it. (A closed node reopens only through a repro; see checking.ts.) */
export async function reopen(ctx: Ctx, a: Actor, inp: { node: string }): Promise<{ node: string; state: 'live' }> {
  needHuman(a, 'reopening')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp?.node)
  if (n.author_id !== person.id) throw new ShwarmError('not_permitted', 'only the author reopens a dead end', { need: 'author', node: n.path })
  needStepUp(a, 'reopening')
  if (n.state === 'closed') throw bad('a closed node reopens when someone posts a repro on the passing submission')
  if (n.state !== 'dead_end') throw bad(`${n.path} is ${n.state}, not a dead end`)
  const e = auditStatement(ctx.db, { event: 'reopened', node: n.id, by: a.as, detail: 'reopened by the author', evidence: nodeHref(n.path) }, ctx.at)
  await ctx.db.batch([
    ctx.db.prepare("UPDATE node SET state = 'live', dead_end_note = NULL, closed_at = NULL WHERE id = ?").bind(n.id),
    ...(n.closed_at ? [signOffReopenStatement(ctx, n.id, n.closed_at)] : []),
    e.stmt,
    notifyStatement(ctx, n.id, `${n.title} reopened. ${humanName(a)} picked it back up.`, 'involved'),
    noticeMailStatement(ctx, n.id, 'involved', { template: 'node_news', payload: { notice: 'pass_fail', event: 'reopened', title: n.title, path: n.path, link: nodeHref(n.path), by: humanName(a) } }),
    touchNode(ctx, n.id, e.id),
  ])
  return { node: n.path, state: 'live' }
}
