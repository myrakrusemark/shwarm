// Nodes and their states (A11, spec "Node states", "Creating a node", protocol §8; decided Oct 9, "No lobby").
//   live              from the moment it's posted, shwarm or branch alike: no lobby, size or kickoff
//   live → closed     on a pass (checks.ts / checking.ts)
//   live → dead_end   by the author, with a required note
// Nothing reopens (decided Oct 9, "Continuing an ended shwarm is always build on"): an ended node is locked
// (context.ts needLive), and anyone carries a passed or dead-end shwarm on by starting a shwarm that builds on it.
// Nodes reopened before that keep their 'reopened' audit rows and their passes on record.
// Until someone else joins or anything is submitted, the author may edit a shwarm: everything the /new form holds, the
// old version kept in node_edit (editNode; it replaced re-pitch, decided Oct 10). "In review" is a flag on live, not a
// state. "join" says you're working on a shwarm or a branch; it gates nothing (except that it locks a shwarm's words).
// Variants are dropped (decided Oct 9): none are made. Rows made before that keep kind 'variant' and their
// variant_of_id, and read as plain shwarms; nothing reads variant_of_id. Old 'lobby' rows went live in migration 0016.
import { ShwarmError } from '@shwarm/protocol'
import { authorize, needHuman, needStepUp, type Actor } from './actor'
import { auditStatement, nodeHref } from './audit'
import { parseCheckSpec } from './checks'
import { findNode, loadNode, loadPerson, MAX_PATH, mentionStatements, moderatedStatement, needLive, postStatement, seenByPerson, signOffDoneStatement, touchNode, type Ctx, type NodeKind, type NodeRow } from './context'
import { newId } from './ids'
import { checkNewNodes, newNodeGuard, takeThreadToken } from './limits'
import { checkWritable, readSettings } from './settings'
import { OPEN_NODE } from '../read/visibility'
import { lf, MAX_SLUG, MAX_TITLE, needText, RESERVED_SLUGS, slugify } from './text'

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

  const title = needText(lf(inp.title), 'title', MAX_TITLE)
  const what = needText(lf(inp.what), 'what')
  if (typeof inp.doneWhen !== 'string' || !inp.doneWhen.trim()) throw new ShwarmError('no_done_test', 'a node needs a done test: one sentence of what is true when it is finished')
  const doneWhen = needText(lf(inp.doneWhen), 'done_when', 2000)
  const spec = parseCheckSpec(inp.check)

  let parent = null
  let license: string
  let buildsOn: string | null = null
  let upstream: NodeRow | null = null // builds_on another node, in another tree
  let tags: string[] = []
  if (kind === 'branch') {
    parent = await loadNode(ctx, inp.parent, a)
    needBranchable(parent)
    await needLive(ctx, parent) // and nothing above it ended: an ended shwarm's tree takes no new branches (OPEN #92)
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

/** join's input. hello: what a person wrote in the "say hi!" modal (empty or missing: no post). Site only. */
export type JoinInput = { node: string; hello?: string | null }

export type JoinResult = {
  node: string
  as: string // the name that joined: the bare handle on the site, an agent name through a key
  joined: boolean // false: that name had already joined this node, so nothing changed
  at: string // when it joined: now, or the standing join's time
  nodes: string[] // the nodes this join counted the name in: the node itself first, then each node above it it wasn't in
  post?: string // the hello's post id, marked as a join (post.is_join)
}

/** A seat or agent seat as join reads it. */
type SeatState = { node_id: number; joined_at: string; left_at: string | null; through_id: number | null }

/** 'a/b/c' → ['a', 'a/b'] */
const above = (path: string) => path.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))

/**
 * "join": say you're working on a shwarm or a branch (decided Oct 9, "No lobby"; Oct 12, "Branches can be joined").
 * It gates nothing and has no size: the joiner shows among its contributors and on their profile as working on it,
 * and gets its notices. Joining again changes nothing. An ended node is locked: it takes no joins (needLive).
 *   - On the site, a person joins as their bare handle: a seat row (the table the lobby used, one per person per node).
 *     What they wrote in the "say hi!" modal (`hello`) becomes their first post in the thread, marked as a join, and
 *     takes a thread post as any post does; with no hello there is no post, and the thread's quiet "@you joined" line
 *     is read from the seat (read/node.ts readJoins).
 *   - Through a key, an agent joins under its own name (decided Oct 12, "Agents can join, with their own key
 *     permission"): the key needs `join` on the node; never the bare handle. An agent_seat row, one per agent name, so
 *     a person may hold their own seat and several agents'. No hello: an agent posts its hello as an ordinary post.
 * A join on a branch also counts the name in every node above it, up to the shwarm (decided: "joining a branch also
 * counts you in its parent shwarm"; nested branches the same, a builder's call), each such seat naming the branch
 * (through_id). A seat above that already stands is left as it is; one left earlier is taken again; a paused node above
 * is skipped (it takes no writes). A join made on a
 * node where the name was only counted through a branch makes it a join of its own.
 */
export async function join(ctx: Ctx, a: Actor, inp: JoinInput): Promise<JoinResult> {
  const viaKey = a.via === 'key'
  if (viaKey) authorize(a, 'join', String(inp?.node))
  else needHuman(a, 'joining')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  // As the thread acts: the API reads the node as the key's human sees it (readChain) before it calls this (OPEN #90).
  const n = await loadNode(ctx, inp?.node)
  await needLive(ctx, n)
  const raw = inp.hello
  const said = raw !== undefined && raw !== null && !(typeof raw === 'string' && !raw.trim())
  // OPEN (#115): new words.
  if (said && viaKey) throw bad('an agent joins with no hello. post one to the thread if you like', { field: 'hello' })
  const hello = said ? needText(raw, 'hello') : null

  const upPaths = above(n.path)
  const ups = upPaths.length
    ? (
        await ctx.db
          // A paused node takes no writes (context.ts loadNode), so a join below it doesn't seat anyone there.
          .prepare('SELECT id, path FROM node WHERE path IN (SELECT value FROM json_each(?)) AND paused = 0 ORDER BY length(path) DESC')
          .bind(JSON.stringify(upPaths))
          .all<{ id: number; path: string }>()
      ).results
    : []
  const all = [{ id: n.id, path: n.path }, ...ups]
  const table = viaKey ? 'agent_seat' : 'seat'
  const who = viaKey ? 'as_name' : 'person_id'
  const whoArg = viaKey ? a.as : person.id
  const { results: had } = await ctx.db
    .prepare(`SELECT node_id, joined_at, left_at, through_id FROM ${table} WHERE ${who} = ?1 AND node_id IN (SELECT value FROM json_each(?2))`)
    .bind(whoArg, JSON.stringify(all.map(x => x.id)))
    .all<SeatState>()
  const seatOf = new Map(had.map(r => [r.node_id, r]))
  const mine = seatOf.get(n.id)
  if (mine && mine.left_at === null && mine.through_id === null) return { node: n.path, as: a.as, joined: false, at: mine.joined_at, nodes: [] }

  const take = (x: { id: number }, through: number | null): D1PreparedStatement => {
    if (seatOf.has(x.id) && viaKey) // the key that signed this join, as a first join records it
      return ctx.db
        .prepare('UPDATE agent_seat SET left_at = NULL, through_id = ?, joined_at = ?, key_id = ? WHERE node_id = ? AND as_name = ?')
        .bind(through, ctx.at, a.keyId ?? null, x.id, a.as)
    if (seatOf.has(x.id))
      return ctx.db.prepare('UPDATE seat SET left_at = NULL, through_id = ?, joined_at = ? WHERE node_id = ? AND person_id = ?').bind(through, ctx.at, x.id, person.id)
    if (viaKey)
      return ctx.db
        .prepare('INSERT INTO agent_seat (node_id, as_name, person_id, key_id, through_id, joined_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(x.id, a.as, person.id, a.keyId ?? null, through, ctx.at)
    return ctx.db
      .prepare('INSERT INTO seat (node_id, person_id, number, joined_at, through_id) VALUES (?, ?, (SELECT COALESCE(MAX(number), 0) + 1 FROM seat WHERE node_id = ?), ?, ?)')
      .bind(x.id, person.id, x.id, ctx.at, through)
  }
  const seated = [n.path]
  const stmts: D1PreparedStatement[] = [take(n, null)]
  for (const u of ups) {
    const s = seatOf.get(u.id)
    if (s && s.left_at === null) continue
    stmts.push(take(u, n.id), touchNode(ctx, u.id, null)) // its contributors box shows signed out
    seated.push(u.path)
  }
  let postId: string | undefined
  if (hello !== null) {
    const bucket = await takeThreadToken(ctx.db, { personId: person.id, handle: person.handle, nodeId: n.id, path: n.path }, ctx.now)
    postId = newId('p')
    const m = await mentionStatements(ctx, { postId, text: hello, node: n, actor: a })
    stmts.push(postStatement(ctx, { id: postId, nodeId: n.id, actor: a, kind: 'post', text: hello, join: true }), ...m.stmts, bucket.stmt)
  }
  stmts.push(touchNode(ctx, n.id, postId ?? null)) // the contributors box (and a hello) show signed out
  await ctx.db.batch(stmts)
  return { node: n.path, as: a.as, joined: true, at: ctx.at, nodes: seated, ...(postId ? { post: postId } : {}) }
}

export type LeaveResult = { node: string; as: string; left: boolean }

/**
 * Stop working on a shwarm or a branch: undoes "join", any time while it's live, for that node only (decided Oct 12:
 * leaving a branch leaves only that branch; the seats above it stay). The author can't leave their own shwarm (table B
 * #29). An agent leaves under its own name, with the key's join permission. Leaving when not joined changes nothing
 * (left: false).
 */
export async function leave(ctx: Ctx, a: Actor, inp: { node: string }): Promise<LeaveResult> {
  const viaKey = a.via === 'key'
  if (viaKey) authorize(a, 'join', String(inp?.node))
  else needHuman(a, 'leaving')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp?.node)
  await needLive(ctx, n)
  // OPEN: the words wait on Myra's yes.
  if (!viaKey && n.kind !== 'branch' && n.author_id === person.id) throw bad("the author can't leave their own shwarm")
  const res = await ctx.db.batch([
    viaKey
      ? ctx.db.prepare('UPDATE agent_seat SET left_at = ? WHERE node_id = ? AND as_name = ? AND left_at IS NULL').bind(ctx.at, n.id, a.as)
      : ctx.db.prepare('UPDATE seat SET left_at = ? WHERE node_id = ? AND person_id = ? AND left_at IS NULL').bind(ctx.at, n.id, person.id),
    touchNode(ctx, n.id, null), // the contributors box shows signed out
  ])
  return { node: n.path, as: a.as, left: !!res[0]?.meta?.changes }
}

export type EditNodeInput = {
  node: string
  title: string
  what: string
  doneWhen: string
  check: unknown // CheckSpec, flat or grouped, as createNode takes it
  tags?: string[]
  license?: string
  buildsOn?: CreateNodeInput['buildsOn']
}
export type EditNodeResult = { node: string; edited: boolean; at: string; triage: NodeRow['triage'] }

/**
 * Whether a shwarm's words may still change (decided Oct 10, '"edit" replaces re-pitch'), as SQL on node `e`: live, not
 * blocked, nothing ever submitted to it or to any of its branches, and nobody but its author ever joined. A join stays in seat with left_at set
 * when the joiner leaves, so leaving doesn't unlock it; the author's own seat (made with the shwarm) doesn't count. Someone
 * else's agent joining counts (agent_seat), the author's own agents don't, and so does a join on one of its branches,
 * which counts the joiner here too (join). OPEN (#115): the last two are builder's calls.
 * Used inside the edit's batch too: a block from triage (which runs outside the tree) can land meanwhile.
 */
export const EDITABLE = (e: string) =>
  `${e}.kind <> 'branch' AND ${e}.state = 'live' AND ${e}.triage <> 'blocked'
   AND NOT EXISTS (SELECT 1 FROM submission s JOIN node sb ON sb.id = s.node_id WHERE sb.id = ${e}.id OR sb.root_id = ${e}.id)
   AND NOT EXISTS (SELECT 1 FROM seat j WHERE j.node_id = ${e}.id AND j.person_id <> ${e}.author_id)
   AND NOT EXISTS (SELECT 1 FROM agent_seat j WHERE j.node_id = ${e}.id AND j.person_id <> ${e}.author_id)`

/**
 * Why a node's words can't be edited any more, or null while they can: the refusal core gives, which the page and the
 * /new form show too (web/create.tsx, read/views.ts). OPEN: the words wait on Myra's yes.
 */
export async function editLock(db: D1Database, n: { id: number; path: string; kind: string; state: string; triage: string }): Promise<ShwarmError | null> {
  if (n.kind === 'branch') return bad('a branch keeps the words it was opened with', { node: n.path })
  if (n.state !== 'live') return new ShwarmError('shwarm_closed', `${n.path} is ${n.state.replace('_', ' ')}`, { node: n.path })
  if (n.triage === 'blocked') return new ShwarmError('not_permitted', `${n.path} was blocked. it can't be edited`, { reason: 'blocked', node: n.path })
  const r = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM submission s JOIN node b ON b.id = s.node_id WHERE b.id = ?1 OR b.root_id = ?1) AS submitted,
              EXISTS (SELECT 1 FROM seat j JOIN node n ON n.id = j.node_id WHERE j.node_id = ?1 AND j.person_id <> n.author_id)
              OR EXISTS (SELECT 1 FROM agent_seat j JOIN node n ON n.id = j.node_id WHERE j.node_id = ?1 AND j.person_id <> n.author_id) AS joined`,
    )
    .bind(n.id)
    .first<{ submitted: number; joined: number }>()
  if (r?.submitted) return bad(`${n.path} has a submission. its words stay as they are`, { reason: 'submitted', node: n.path })
  if (r?.joined) return bad(`someone else joined ${n.path}. its words stay as they are`, { reason: 'joined', node: n.path })
  return null
}

/** A check spec as stored, in the shape parseCheckSpec gives, so the same done test compares equal. */
function sameSpec(stored: string, spec: unknown): boolean {
  try {
    return JSON.stringify(parseCheckSpec(JSON.parse(stored))) === JSON.stringify(spec)
  } catch {
    return stored === JSON.stringify(spec)
  }
}

/**
 * Edit a shwarm (decided Oct 10, '"edit" replaces re-pitch'; it supersedes re-pitch): its author changes everything the
 * /new form holds (title, what, done test and its checks, tags, license, builds on) until someone other than the author
 * joins or anything is submitted, whichever comes first; after that its words are locked for good (EDITABLE). The
 * address stays. Each field is checked as createNode checks it: builds on is an ended shwarm the author can see, or an
 * outside project with its license, and its license replaces any sent. Branches carry their shwarm's license and
 * builds on, so a change to either reaches them too. A branch itself keeps the words it was opened with (Claude's
 * default, Oct 10). The version it replaces goes to node_edit, so the page can show the history: to everyone only if
 * everyone could read it then, otherwise to the author alone. Acts with the author's authority, so it confirms with the
 * password (A5), and happens only on the site, as the bare handle. The same words again change nothing.
 * The new words are checked like a new node's (A8): a cleared node goes back to 'pending' ("being checked", seen only by
 * its author; a seeded one stays public while pending) and a new triage round starts (triage_since), which the caller
 * runs after this batch (triage/run.ts triageNew). A held node stays held, for Myra to read again; a blocked one can't
 * be edited. OPEN (#79): a cleared one being checked again goes dark to everyone else for that minute, its thread and
 * branches with it; a held one stays dark until Myra reads it. An edit spends a thread post token (the posting pace), so
 * it can't flood the history or triage.
 */
export async function editNode(ctx: Ctx, a: Actor, inp: EditNodeInput): Promise<EditNodeResult> {
  needHuman(a, 'editing a shwarm')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp?.node)
  if (n.author_id !== person.id) throw new ShwarmError('not_permitted', 'only the author edits a shwarm', { need: 'author', node: n.path })
  needStepUp(a, 'editing a shwarm')
  const locked = await editLock(ctx.db, n)
  if (locked) throw locked

  const title = needText(lf(inp.title), 'title', MAX_TITLE)
  const what = needText(lf(inp.what), 'what')
  if (typeof inp.doneWhen !== 'string' || !inp.doneWhen.trim()) throw new ShwarmError('no_done_test', 'a node needs a done test: one sentence of what is true when it is finished')
  const doneWhen = needText(lf(inp.doneWhen), 'done_when', 2000)
  const spec = parseCheckSpec(inp.check)
  const tags = parseTags(inp.tags)
  const b = await parseBuildsOn(ctx, a, inp.buildsOn)
  let license: string
  if (b) license = b.license // the upstream license wins; any license sent is ignored (protocol §8)
  else {
    license = inp.license ?? DEFAULT_LICENSE
    if (!LICENSES.includes(license)) throw new ShwarmError('bad_license', `pick one of ${LICENSES.join(', ')}`, { allowed: LICENSES })
  }
  // A new shwarm can't name its own branch (it has none yet); an edit could, and the branch would then build on itself.
  if (b?.node && (b.node.id === n.id || b.node.root_id === n.id)) throw bad(NO_UPSTREAM)
  const buildsOn = b?.json ?? null
  const upstream = b?.node ?? null

  const was = await ctx.db.prepare('SELECT tag FROM node_tag WHERE node_id = ? ORDER BY rowid').bind(n.id).all<{ tag: string }>()
  const oldTags = was.results.map(r => r.tag)
  const same =
    title === lf(n.title) &&
    what === lf(n.what) &&
    doneWhen === lf(n.done_when) &&
    sameSpec(n.checks, spec) &&
    license === n.license &&
    buildsOn === (n.builds_on ?? null) &&
    tags.join(' ') === oldTags.join(' ')
  if (same) return { node: n.path, edited: false, at: ctx.at, triage: n.triage }
  const bucket = await takeThreadToken(ctx.db, { personId: person.id, handle: person.handle, nodeId: n.id, path: n.path }, ctx.now)
  const recheck = n.triage === 'clear' || n.triage === 'pending'
  // Every statement carries the same guard, so they land or skip together. The batch is one transaction, so a block
  // from triage or the upstream ending meanwhile reads the same to all of them. Ids are integers from the database.
  const upstreamGuard = upstream ? ` AND EXISTS (SELECT 1 FROM node u WHERE u.id = ${Number(upstream.id)} AND u.state IN ('closed', 'dead_end'))` : ''
  const guard = `EXISTS (SELECT 1 FROM node e WHERE e.id = ${Number(n.id)} AND ${EDITABLE('e')})${upstreamGuard}`
  const inherited = license !== n.license || buildsOn !== (n.builds_on ?? null)
  const stmts: D1PreparedStatement[] = [
    // The version it replaces, read as the batch runs, noting whether everyone could read it then: words still being
    // checked or held were never cleared, so they show in the history to the author alone (read/node.ts readPitchEdits).
    ctx.db
      .prepare(
        `INSERT INTO node_edit (node_id, by_name, title, what, edited_at, was_public, done_when, checks, license, builds_on, tags)
         SELECT id, ?1, title, what, ?2, ${OPEN_NODE('node')}, done_when, checks, license, builds_on,
                (SELECT json_group_array(tag) FROM (SELECT t.tag FROM node_tag t WHERE t.node_id = node.id ORDER BY t.rowid))
         FROM node WHERE id = ?3 AND ${guard}`,
      )
      .bind(a.as, ctx.at, n.id),
    // Triage runs outside the tree, so the round restarts on the node's triage as it is when the batch runs: a hold that
    // lands meanwhile stands.
    ctx.db
      .prepare(
        `UPDATE node SET title = ?1, what = ?2, done_when = ?3, checks = ?4, license = ?5, builds_on = ?6,
           triage_since = CASE WHEN triage IN ('clear', 'pending') THEN ?7 ELSE triage_since END,
           triage = CASE WHEN triage = 'clear' THEN 'pending' ELSE triage END
         WHERE id = ?8 AND ${guard}`,
      )
      .bind(title, what, doneWhen, JSON.stringify(spec), license, buildsOn, ctx.at, n.id),
  ]
  if (tags.join(' ') !== oldTags.join(' ')) {
    stmts.push(ctx.db.prepare(`DELETE FROM node_tag WHERE node_id = ? AND ${guard}`).bind(n.id))
    for (const t of tags) stmts.push(ctx.db.prepare(`INSERT INTO node_tag (node_id, tag) SELECT ?, ? WHERE ${guard}`).bind(n.id, t))
  }
  // Branches take their shwarm's license and builds on (createNode), so live ones follow it, and their pages change.
  // An ended branch is locked for good and keeps what it ended under.
  if (inherited)
    stmts.push(
      ctx.db
        .prepare(`UPDATE node SET license = ?1, builds_on = ?2, last_event_id = ?3, changed_at = ?4 WHERE root_id = ?5 AND state = 'live' AND ${guard}`)
        .bind(license, buildsOn, newId('v'), ctx.at, n.id),
    )
  stmts.push(
    bucket.stmt,
    touchNode(ctx, n.id, null),
    // A cleared node leaves the public until it's checked again, so every signed-out page that lists it changes.
    ...(recheck ? [moderatedStatement(ctx)] : []),
  )
  const res = await ctx.db.batch(stmts)
  if (!res[1]?.meta?.changes) {
    // A guard failed: say which, from a fresh read.
    const now = await findNode(ctx, n.path)
    const why = now && (await editLock(ctx.db, now))
    if (why) throw why
    if (upstream) {
      const u = await findNode(ctx, upstream.path)
      if (!u || !(await seenByPerson(ctx, a, u))) throw bad(NO_UPSTREAM)
      needEnded(u)
    }
    throw bad('something changed while this was sent. try again')
  }
  return { node: n.path, edited: true, at: ctx.at, triage: recheck ? 'pending' : n.triage }
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
  await needLive(ctx, n) // a branch under an ended shwarm is locked with it (OPEN #92)
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
