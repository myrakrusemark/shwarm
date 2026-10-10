// Nodes and their states (A11, spec "Node states", "Creating a node", protocol §8; decided Oct 9, "No lobby").
//   live              from the moment it's posted, shwarm or branch alike: no lobby, size or kickoff
//   live → closed     on a pass (checks.ts / checking.ts)
//   live → dead_end   by the author, with a required note
// Nothing reopens (decided Oct 9, "Continuing an ended shwarm is always build on"): an ended node is locked
// (context.ts needLive), and anyone carries a passed or dead-end shwarm on by starting a shwarm that builds on it.
// Nodes reopened before that keep their 'reopened' audit rows and their passes on record.
// Until its first submission, the author may re-pitch a shwarm: a new title and pitch, the old ones kept in node_edit
// (repitch). "In review" is a flag on live, not a state. "join" says you're working on a shwarm; it gates nothing.
// Variants are dropped (decided Oct 9): none are made. Rows made before that keep kind 'variant' and their
// variant_of_id, and read as plain shwarms; nothing reads variant_of_id. Old 'lobby' rows went live in migration 0016.
import { ShwarmError } from '@shwarm/protocol'
import { authorize, needHuman, needStepUp, type Actor } from './actor'
import { auditStatement, nodeHref } from './audit'
import { parseCheckSpec } from './checks'
import { findNode, loadNode, loadPerson, MAX_PATH, moderatedStatement, needLive, postStatement, seenByPerson, signOffDoneStatement, touchNode, type Ctx, type NodeKind, type NodeRow } from './context'
import { newId } from './ids'
import { checkNewNodes, newNodeGuard, takeThreadToken } from './limits'
import { checkWritable, readSettings } from './settings'
import { OPEN_NODE } from '../read/visibility'
import { MAX_SLUG, MAX_TITLE, needText, RESERVED_SLUGS, slugify } from './text'

// A2 (decided Oct 8): a default and a short open list. OPEN: the identifiers are proposed in protocol §8.
export const DEFAULT_LICENSE = 'MIT+CC-BY-4.0'
export const LICENSES: readonly string[] = ['MIT+CC-BY-4.0', 'MIT', 'Apache-2.0', 'GPL-3.0', 'AGPL-3.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0']

const MAX_TAGS = 8 // OPEN: no tag count or tag pattern is decided
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

const bad = (m: string, d: Record<string, unknown> = {}) => new ShwarmError('bad_request', m, d)

export type CreateNodeInput = {
  kind: NodeKind
  parent?: string // branch: the parent's path
  title: string
  what: string
  doneWhen: string
  check: unknown // CheckSpec, flat or grouped
  tags?: string[]
  license?: string
  buildsOn?: string | { name: string; url?: string; license: string } | null
  slug?: string // the launch import only (A18): keeps the slug the launch list chose instead of one from the title
}

export type CreateNodeResult = {
  path: string
  kind: NodeKind
  state: 'live'
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

/** The states a shwarm is built on in: it passed, or it's a dead end (decided Oct 9, "Continuing an ended shwarm is always build on"). */
export const ENDED: readonly NodeRow['state'][] = ['closed', 'dead_end']

// OPEN: building on a node that is still live isn't described; refused, as before.
// OPEN (#92): the words wait on Myra's yes.
function needEnded(n: NodeRow): void {
  if (!ENDED.includes(n.state)) throw bad(`${n.path} is still live. a shwarm is built on once it passed or is a dead end`)
}

type NodeAt = Pick<NodeRow, 'path' | 'kind' | 'state'>

/** A branch's parent: live only. A new shwarm is live at once, and a closed or dead-end node takes none. */
export function needBranchable(n: NodeAt): void {
  // OPEN: branching a closed or dead-end node isn't described; refused until decided.
  if (n.state !== 'live') throw new ShwarmError('shwarm_closed', `${n.path} is ${n.state.replace('_', ' ')}`, { node: n.path })
}

const NO_UPSTREAM = 'builds_on names a shwarm on shwarm, or an outside project as {name, url, license}'

/**
 * builds_on: the path of a shwarm that passed or is a dead end, or an outside project {name, url?, license}. Either way its license carries over.
 * A path its actor's person can't see is refused as not there, for site actors too: the site passes the typed path on.
 */
async function parseBuildsOn(ctx: Ctx, a: Actor, v: CreateNodeInput['buildsOn']): Promise<{ json: string; license: string; node?: NodeRow } | null> {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'string') {
    const n = await findNode(ctx, v)
    if (!n || !(await seenByPerson(ctx, a, n))) throw bad(NO_UPSTREAM)
    needEnded(n)
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
  // Variants are dropped (decided Oct 9): building on an ended shwarm takes their place.
  if (kind !== 'shwarm' && kind !== 'branch') throw bad('kind is shwarm or branch')
  if (kind === 'branch') authorize(a, 'branch', String(inp.parent))
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
  let license: string
  let buildsOn: string | null = null
  let upstream: NodeRow | null = null // builds_on another node, in another tree
  let tags: string[] = []
  if (kind === 'branch') {
    parent = await loadNode(ctx, inp.parent, a)
    needBranchable(parent)
    if (inp.license !== undefined && inp.license !== null && inp.license !== parent.license)
      throw new ShwarmError('bad_license', `branches take the parent's license (${parent.license})`)
    if (inp.buildsOn !== undefined && inp.buildsOn !== null) throw bad("branches take the parent's builds on. send none")
    if (Array.isArray(inp.tags) && inp.tags.length) throw bad('branches have no tags')
    license = parent.license
    buildsOn = parent.builds_on
  } else {
    tags = parseTags(inp.tags)
    const b = await parseBuildsOn(ctx, a, inp.buildsOn)
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

  // Every node is live the moment it's posted (decided Oct 9, "No lobby"). The author starting a shwarm themselves
  // is down as working on it (a seat: what "join" records); an agent's shwarm starts with no one (decisions, "agents may start").
  const seated = kind !== 'branch' && a.via !== 'key'
  const ref = { path }
  // What was read from outside this tree is checked again inside the batch: the daily limit (creates in
  // other trees don't queue behind this one), and the state of the upstream node, whose own tree may close
  // or end it meanwhile. If any fails, the INSERT writes nothing, and nor does the rest.
  const guards: string[] = []
  const guardArgs: unknown[] = []
  if (a.via !== 'seed') {
    const g = newNodeGuard(person.id, ctx.now)
    guards.push(g.sql)
    guardArgs.push(...g.args)
  }
  if (upstream) {
    guards.push("EXISTS (SELECT 1 FROM node WHERE id = ? AND state IN ('closed', 'dead_end'))")
    guardArgs.push(upstream.id)
  }
  const stmts: D1PreparedStatement[] = [
    ctx.db
      .prepare(
        // lobby_size is no longer read; the schema still wants one on a shwarm, so it's 1 (expand only, migration 0016).
        `INSERT INTO node (path, slug, kind, parent_id, root_id, title, what, done_when, checks, lobby_size, license,
           builds_on, author_id, posted_by, state, created_at, live_at, seeded)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ? WHERE ${guards.length ? guards.join(' AND ') : '1'}`,
      )
      .bind(
        path,
        path.split('/').pop(),
        kind,
        parent?.id ?? null,
        parent ? (parent.root_id ?? parent.id) : null,
        title,
        what,
        doneWhen,
        JSON.stringify(spec),
        kind === 'branch' ? null : 1,
        license,
        buildsOn,
        person.id,
        a.as,
        ctx.at,
        ctx.at,
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
  stmts.push(touchNode(ctx, ref, last))
  const res = await ctx.db.batch(stmts)
  if (!res[0]?.meta?.changes) {
    // A guard failed: say which, from a fresh read.
    if (a.via !== 'seed') await checkNewNodes(ctx.db, { personId: person.id, handle: person.handle }, ctx.now)
    if (upstream) {
      const u = await findNode(ctx, upstream.path)
      if (!u || !(await seenByPerson(ctx, a, u))) throw bad(NO_UPSTREAM)
      needEnded(u)
    }
    throw bad('something changed while this was sent. try again')
  }
  return {
    path,
    kind,
    state: 'live',
    license,
    limits: { new_nodes_today: { left: Number.isFinite(left) ? left : 0 } },
  }
}

export type JoinResult = { node: string; joined: boolean }

/**
 * "join": say you're working on a shwarm (decided Oct 9, "No lobby"). It gates nothing and has no size: the joiner shows
 * among its contributors and on their profile as working on it, and gets its notices. One join per person, however many
 * agents they bring; joining again changes nothing. It's kept as a seat row (the table the lobby used), so earlier
 * joins carry over. OPEN: branches have no join, as before. An ended shwarm is locked: it takes no joins.
 */
export async function join(ctx: Ctx, a: Actor, inp: { node: string }): Promise<JoinResult> {
  needHuman(a, 'joining')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp?.node)
  // OPEN: the words wait on Myra's yes.
  if (n.kind === 'branch') throw bad('a branch has nothing to join. just start working')
  needLive(n)
  const mine = await ctx.db.prepare('SELECT left_at FROM seat WHERE node_id = ? AND person_id = ?').bind(n.id, person.id).first<{ left_at: string | null }>()
  if (mine && mine.left_at === null) return { node: n.path, joined: false }
  await ctx.db.batch([
    mine
      ? ctx.db.prepare('UPDATE seat SET left_at = NULL, joined_at = ? WHERE node_id = ? AND person_id = ?').bind(ctx.at, n.id, person.id)
      : ctx.db
          .prepare('INSERT INTO seat (node_id, person_id, number, joined_at) VALUES (?, ?, (SELECT COALESCE(MAX(number), 0) + 1 FROM seat WHERE node_id = ?), ?)')
          .bind(n.id, person.id, n.id, ctx.at),
    touchNode(ctx, n.id, null), // the contributors box shows signed out
  ])
  return { node: n.path, joined: true }
}

/** Stop working on a shwarm: undoes "join", any time while it's live. The author can't leave their own (table B #29). */
export async function leave(ctx: Ctx, a: Actor, inp: { node: string }): Promise<{ node: string }> {
  needHuman(a, 'leaving')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp?.node)
  // OPEN: the words wait on Myra's yes.
  if (n.kind === 'branch') throw bad('a branch has nothing to leave')
  needLive(n)
  if (n.author_id === person.id) throw bad("the author can't leave their own shwarm")
  await ctx.db.batch([
    ctx.db.prepare('UPDATE seat SET left_at = ? WHERE node_id = ? AND person_id = ? AND left_at IS NULL').bind(ctx.at, n.id, person.id),
    touchNode(ctx, n.id, null), // the contributors box shows signed out
  ])
  return { node: n.path }
}

export type RepitchInput = { node: string; title: string; what: string }
export type RepitchResult = { node: string; repitched: boolean; at: string; triage: NodeRow['triage'] }

/** Whether anything was ever submitted to this node: from then on its title and what stay as they are. */
const submitted = async (ctx: Ctx, nodeId: number) => !!(await ctx.db.prepare('SELECT 1 FROM submission WHERE node_id = ? LIMIT 1').bind(nodeId).first())
// The same rule inside the batch, on the node row: a block from triage (which runs outside the tree) can land meanwhile.
const REPITCHABLE = "state = 'live' AND triage <> 'blocked' AND NOT EXISTS (SELECT 1 FROM submission s WHERE s.node_id = node.id)"

/**
 * Re-pitch a shwarm (spec "Starting a shwarm", LOBBY-6; table B #30; decided Oct 9, "No lobby": "title and what stay
 * editable until the first submission"): the author changes the title and the pitch ("what") while it's live and nothing
 * has been submitted to it; the done test, checks, license and address never change. OPEN: a branch keeps the words it
 * was opened with, as before; whether it may be re-pitched too waits on Myra. The version it replaces goes to node_edit,
 * so the page can show the history: to everyone only if everyone could read it then, otherwise to the author alone
 * (OPEN #79). Acts with the author's authority, so it confirms with the password (A5), and happens only on the site, as
 * the bare handle (no edit API at launch, table B #30). The same title and pitch again change nothing.
 * The new words are checked like a new node's (A8): a cleared node goes back to 'pending' ("being checked", seen only by
 * its author; a seeded one stays public while pending) and a new triage round starts (triage_since), which the caller
 * runs after this batch (triage/run.ts triageNew). A held node stays held, for Myra to read again; a blocked one can't be
 * re-pitched. OPEN (#79): now that a shwarm is live from the start, a cleared one being checked again goes dark to everyone
 * else for that minute, its thread and branches with it, as a lobby did; a held one stays dark until Myra reads it.
 * OPEN (#79): a re-pitch spends a thread post token, so it can't flood the history or triage.
 */
export async function repitch(ctx: Ctx, a: Actor, inp: RepitchInput): Promise<RepitchResult> {
  needHuman(a, 're-pitching')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp?.node)
  if (n.author_id !== person.id) throw new ShwarmError('not_permitted', 'only the author re-pitches', { need: 'author', node: n.path })
  needStepUp(a, 're-pitching')
  // OPEN: the words for a branch and for a shwarm with a submission wait on Myra's yes.
  if (n.kind === 'branch') throw bad("a branch keeps the title and what it was opened with", { node: n.path })
  if (n.state !== 'live') throw new ShwarmError('shwarm_closed', `${n.path} is ${n.state.replace('_', ' ')}`, { node: n.path })
  if (await submitted(ctx, n.id)) throw bad(`${n.path} has a submission. its title and what stay as they are`, { node: n.path })
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
         SELECT id, ?1, title, what, ?2, ${OPEN_NODE('node')} FROM node WHERE id = ?3 AND ${REPITCHABLE}`,
      )
      .bind(a.as, ctx.at, n.id),
    ctx.db
      .prepare(
        `UPDATE node SET title = ?1, what = ?2,
           triage_since = CASE WHEN triage IN ('clear', 'pending') THEN ?3 ELSE triage_since END,
           triage = CASE WHEN triage = 'clear' THEN 'pending' ELSE triage END
         WHERE id = ?4 AND ${REPITCHABLE}`,
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
  if (n.state !== 'live') throw new ShwarmError('shwarm_closed', `${n.path} is ${n.state.replace('_', ' ')}`, { node: n.path })
  const note = needText(inp.note, 'note')
  const postId = newId('p')
  const e = auditStatement(ctx.db, { event: 'dead_end', node: n.id, by: a.as, detail: note.slice(0, 280), evidence: `${nodeHref(n.path)}#${postId}` }, ctx.at)
  await ctx.db.batch([
    postStatement(ctx, { id: postId, nodeId: n.id, actor: a, kind: 'dead_end', text: note }),
    // closed_at is when it ended (the closed tab's order and time); later posts move changed_at, never this.
    ctx.db.prepare("UPDATE node SET state = 'dead_end', dead_end_note = ?, closed_at = ? WHERE id = ?").bind(note, ctx.at, n.id),
    // A dead end is locked: it takes no checks, so no sign-off waits on the author any more.
    signOffDoneStatement(ctx, n.id, 'deadEnd'),
    e.stmt,
    touchNode(ctx, n.id, e.id),
  ])
  return { node: n.path, state: 'dead_end', post: postId }
}
