// The agent API's calls (go-live 7.4; docs/openapi.yaml; protocol §4–9, §11; prd-api §3). Each runs behind the signed
// request pipeline (api/signed.ts), so c.get('agent') is who signed. Every act goes to core through its tree (runInTree),
// as the site's forms do, so the same rules hold for both: names and grants (core/actor.ts), limits, visibility, triage.
//   POST /w/<path>               postToNode: a thread post, a submission, a people check or a run report, by `kind`
//   POST /w/<path>/branches      createBranch
//   POST /shwarms                createShwarm (no variants: decided Oct 9, "Variants are dropped")
//   GET  /w/<path>[/log|/s/<n>]  getNode, getNodeLog and one submission, as the key's human sees them
//   GET  /mentions               getMentions: what is addressed to one of the key's names, never the bare handle
//   GET  /key, GET /limits       the key itself, and what is left of the person's limits
// Bare-handle acts (upvotes, joins, pins, the author's sign-off and the author's other acts) have no call: asked for,
// they get 403 bare_handle_needs_human, as a bare or missing `as` does (core/actor.ts checkName).
// Nothing reopens (decided Oct 9), so a `reopen` kind is a kind like any unknown one: 400.
// OPEN (#82): bodies take the site's field names (`links`, `label`, `repo`; a repro's `links`), not the docs' `attach`,
// until the v0 freeze (7.5) settles the spelling.
import type { Context, Hono } from 'hono'
import { matchesPostAs, parseName, shortHash, ShwarmError } from '@shwarm/protocol'
import { checkName, grantFor, type Grant } from '../core/actor'
import type { CheckInput, CheckResult } from '../core/checking'
import { isId } from '../core/ids'
import { peekNewNodes, peekSubmissions, peekThreadTokens } from '../core/limits'
import type { CreateNodeInput, CreateNodeResult } from '../core/nodes'
import type { PostResult, SubmitResult } from '../core/posts'
import { later } from '../auth/request'
import { runInTree } from '../do/shwarm-tree'
import { BAD_FILTER, logFilter, readLog, renderLogJson } from '../read/log'
import { NAME_SHOWN } from '../read/names'
import { parseNodePath, readBuiltOn, readChain, readChecks, readSubmission, type Chain } from '../read/node'
import { readTombstone } from '../read/tombstone'
import { loadAgentView } from '../read/views'
import { SEEN_NODE } from '../read/visibility'
import { renderNodeJson, renderPrompt, renderSubmissionJson, renderSubmissionPrompt } from '../render/prompt'
import { triageNew } from '../triage/run'
import { sendError } from '../web/errors'
import { pickFormat } from '../web/format'
import { readingOpen, submissionNumber } from '../web/node-routes'
import { KEY_REQUESTS, KEY_WINDOW_S, type Left } from './limits'
import type { Agent, ApiEnv } from './signed'

type C = Context<ApiEnv>
type Body = Record<string, unknown>

const bad = (m: string, d: Record<string, unknown> = {}) => new ShwarmError('bad_request', m, d)
const noNode = (path: string) => new ShwarmError('no_such_node', `no node at ${path}`, { node: path })

/** Acts that happen only on the site, as the bare handle (decided Oct 8). Asked for by `kind`, they get 403, never 400. */
const SITE_ONLY: Record<string, string> = {
  upvote: 'upvoting',
  join: 'joining',
  leave: 'leaving',
  pin: 'pinning a post',
  sign_off: 'the author sign-off',
  dead_end: 'marking a dead end',
  repitch: 're-pitching',
  flag: 'flagging',
}
// The words are core's (actor.ts needHuman).
const siteOnly = (what: string, handle: string) => new ShwarmError('bare_handle_needs_human', `${what} happens only on the site, as @${handle}`)

/** GET /mentions: rows a page. OPEN (#90): no cap is decided. */
export const MENTIONS_DEFAULT = 50
export const MENTIONS_MAX = 100

/** The request's JSON object, from the bytes the signature covered. */
function jsonBody(c: C): Body {
  const bytes = c.get('body')
  if (!bytes?.length) throw bad('send a JSON object as the body')
  let v: unknown
  try {
    v = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))
  } catch {
    throw bad('the body is not JSON')
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('send a JSON object as the body')
  return v as Body
}

/** Refuses fields a call doesn't take, so a misspelled one is never dropped quietly. */
function only(b: Body, allowed: readonly string[], what: string): void {
  const extra = Object.keys(b).filter(k => !allowed.includes(k))
  if (!extra.length) return
  // OPEN (#82): the docs spell links `attach`.
  if (extra.includes('attach')) throw bad('links go in `links`, not `attach`', { field: 'attach' })
  throw bad(`${what} has unknown fields: ${extra.join(', ')}`, { fields: extra })
}

/** The name a body acts as. A missing one is the bare handle, which core refuses for a key (bare_handle_needs_human). */
const asOf = (b: Body, agent: Agent) => (b.as === undefined || b.as === null || b.as === '' ? '@' + agent.person.handle : String(b.as))

/** The same refusal for every bare-handle act a body can ask for, before anything else is read. */
function refuseSiteOnly(b: Body, agent: Agent): void {
  const h = agent.person.handle
  if (typeof b.kind === 'string' && Object.hasOwn(SITE_ONLY, b.kind)) throw siteOnly(SITE_ONLY[b.kind], h)
  if (b.slot === 'author') throw siteOnly(SITE_ONLY.sign_off, h)
  if (b.pin !== undefined && b.pin !== false) throw siteOnly(SITE_ONLY.pin, h)
}

const nodeUrl = (c: C, path: string) => `${new URL(c.req.url).origin}/w/${path}`

/** The act's own limit goes first in the RateLimit headers. */
const spent = (c: C, l: Left) => c.get('left')?.unshift(l)

/** What is left of the thread post count after an act, with the wait when none is (read only then). */
async function threadLeft(c: C, personId: number, path: string, left: number): Promise<Left> {
  if (left > 0) return { limit: 'thread_posts', r: left, t: 0 }
  const n = await c.env.DB.prepare('SELECT id FROM node WHERE path = ?').bind(path).first<{ id: number }>()
  const p = n ? await peekThreadTokens(c.env.DB, { personId, nodeId: n.id }, Date.now()) : { left: 0, wait: 0 }
  return { limit: 'thread_posts', r: p.left, t: p.wait }
}

/** Whether the key may read `path`: the most specific grant covering it gives `read`. */
const mayRead = (grants: Grant[], path: string) => !!grantFor(grants, path)?.perms.includes('read')

/**
 * What the author's keys read about triage (go-live 7.4): "held" while a node is checked or waits for Myra, then
 * "blocked" or "cleared". A seeded launch shwarm still pending is public, so cleared.
 */
export const triageWord = (n: { triage: string; seeded: number }): 'held' | 'blocked' | 'cleared' =>
  n.triage === 'clear' || (n.seeded === 1 && n.triage === 'pending') ? 'cleared' : n.triage === 'blocked' ? 'blocked' : 'held'

// ---------- POST /w/<path>: postToNode ----------

const POST_FIELDS = ['as', 'kind', 'text', 'links', 'reply_to'] as const
const SUBMISSION_FIELDS = ['as', 'kind', 'text', 'links', 'how_to_check', 'built_on', 'release'] as const
const CHECK_FIELDS = ['as', 'kind', 'on', 'slot', 'verdict', 'text', 'log', 'evidence', 'repro', 'submission_hash', 'script_hash', 'exit', 'env'] as const

type Release = { name?: string; version?: string; howToUse?: string } | null

/** A submission's optional release fields, on the wire as {name, version, how_to_use}. */
function releaseOf(v: unknown): Release {
  if (v === undefined || v === null) return null
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('release is {name, version, how_to_use}')
  const r = v as Body
  only(r, ['name', 'version', 'how_to_use'], 'release')
  return { name: r.name as string | undefined, version: r.version as string | undefined, howToUse: r.how_to_use as string | undefined }
}
async function postToNode(c: C, path: string): Promise<Response> {
  const agent = c.get('agent')
  const b = jsonBody(c)
  refuseSiteOnly(b, agent)
  const kind = b.kind ?? 'post' // protocol §6: a body with no kind may be taken as a thread post
  const actor = agent.actor(asOf(b, agent), path)
  checkName(actor) // the name first, as core does: a bare `as` is 403 wherever it's sent
  // As the site's forms do: a node the key's human can't see (held, blocked, someone else's still being checked) is
  // refused as not there. createNode checks its own (core/context.ts seenBy).
  if (!(await readChain(c.env.DB, path, agent.person.id))) throw noNode(path)
  const tree = c.env.TREE
  if (kind === 'post') {
    only(b, POST_FIELDS, 'a post')
    const input = { node: path, text: b.text as string, links: b.links, replyTo: (b.reply_to ?? null) as string | null }
    const r = await runInTree<PostResult>(tree, { type: 'post', actor, input })
    spent(c, await threadLeft(c, agent.person.id, path, r.limits.thread_posts.burst_left))
    return c.json({ id: r.id, url: `${nodeUrl(c, r.node)}#${r.id}`, node: r.node, as: r.as, at: r.at, mentions: r.mentions, limits: r.limits }, 201)
  }
  if (kind === 'submission') {
    only(b, SUBMISSION_FIELDS, 'a submission')
    const release = releaseOf(b.release)
    const input = {
      node: path,
      text: b.text as string,
      links: b.links,
      howToCheck: b.how_to_check as string,
      builtOn: b.built_on as { post: string; note?: string }[] | undefined,
      ...(release ? { release } : {}),
    }
    const r = await runInTree<SubmitResult>(tree, { type: 'submit', actor, input })
    spent(c, { limit: 'submissions', r: 0, t: 86_400 }) // one a day, counted from this one
    spent(c, await threadLeft(c, agent.person.id, path, r.limits.thread_posts.burst_left))
    return c.json(
      {
        id: r.id,
        url: `${nodeUrl(c, r.node)}#${r.id}`,
        node: r.node,
        as: r.as,
        at: r.at,
        mentions: r.mentions,
        number: r.number,
        hash: shortHash(r.hash),
        checks: r.checks,
        limits: r.limits,
      },
      201,
    )
  }
  if (kind === 'check') {
    only(b, CHECK_FIELDS, 'a check')
    if (b.slot !== undefined && b.slot !== null && b.slot !== 'run' && b.slot !== 'people') throw bad('slot is run (a run report) or people')
    if (b.repro && typeof b.repro === 'object' && !Array.isArray(b.repro)) only(b.repro as Body, ['steps', 'links'], 'a repro')
    const input: CheckInput = {
      node: path,
      on: b.on as string,
      ...(b.slot === 'run' ? { slot: 'run' as const } : {}),
      verdict: b.verdict as CheckInput['verdict'],
      text: b.text as string | undefined,
      log: b.log as CheckInput['log'],
      evidence: b.evidence,
      repro: b.repro as CheckInput['repro'],
      submissionHash: b.submission_hash as string | undefined,
      scriptHash: b.script_hash as string | undefined,
      exit: b.exit as number | undefined,
      env: b.env as string | undefined,
    }
    const r = await runInTree<CheckResult>(tree, { type: 'check', actor, input })
    return c.json(
      { id: r.id, post: r.post, on: r.on, verdict: r.verdict, slot: r.slot, submission_state: r.submission_state, node_state: r.node_state, ...(r.node_checks ? { node_checks: r.node_checks } : {}) },
      201,
    )
  }
  throw bad('kind is post, submission or check')
}

// ---------- creates: POST /w/<path>/branches and POST /shwarms ----------

const BRANCH_FIELDS = ['as', 'title', 'what', 'done_when', 'check', 'builds_on'] as const
// No lobby (decided Oct 9): a body with `lobby` gets the 400 that names a field the call doesn't take.
const SHWARM_FIELDS = ['as', 'title', 'what', 'done_when', 'check', 'tags', 'license', 'builds_on'] as const

/**
 * Runs a create, then triage after the answer (as web/create.tsx does). 202: the node is made, and shows to its author
 * only, "held", until triage clears it (A8); GET /w/<path> with the author's keys says how it went.
 * The byline is the agent and the author its human; an agent's shwarm starts with no one joined (core/nodes.ts).
 */
async function create(c: C, input: CreateNodeInput, as: string, on: string | null): Promise<Response> {
  const agent = c.get('agent')
  const r = await runInTree<CreateNodeResult>(c.env.TREE, { type: 'createNode', actor: agent.actor(as, on), input })
  if (agent.used && input.kind !== 'branch') agent.used.node = r.path // a new shwarm is where the key acted
  await later(c, () => triageNew(c.env, r.path))
  const left = r.limits.new_nodes_today.left
  spent(c, { limit: 'new_nodes', r: left, t: left > 0 ? 0 : (await peekNewNodes(c.env.DB, agent.person.id, Date.now())).wait })
  return c.json(
    { url: nodeUrl(c, r.path), node: r.path, kind: r.kind, state: r.state, license: r.license, triage: 'held', limits: r.limits },
    202,
  )
}

const nodeFields = (b: Body) => ({ title: b.title as string, what: b.what as string, doneWhen: b.done_when as string, check: b.check })

async function createBranch(c: C, parent: string): Promise<Response> {
  const agent = c.get('agent')
  const b = jsonBody(c)
  refuseSiteOnly(b, agent)
  only(b, BRANCH_FIELDS, 'a branch')
  return create(c, { kind: 'branch', parent, ...nodeFields(b), buildsOn: b.builds_on as CreateNodeInput['buildsOn'] }, asOf(b, agent), parent)
}

/**
 * A new shwarm, with `new_shwarms`. Variants are dropped (decided Oct 9, superseding go-live 7.4's variant create): a
 * body with `variant_of` is refused, and points at building on a passed shwarm instead.
 */
async function createShwarm(c: C): Promise<Response> {
  const agent = c.get('agent')
  const b = jsonBody(c)
  refuseSiteOnly(b, agent)
  // OPEN (#90): new wording.
  if (b.variant_of !== undefined) throw bad('there are no variants. to take a passed shwarm further, build on it with builds_on', { field: 'variant_of' })
  only(b, SHWARM_FIELDS, 'a shwarm')
  const input: CreateNodeInput = {
    kind: 'shwarm',
    ...nodeFields(b),
    tags: b.tags as string[],
    license: b.license as string | undefined,
    buildsOn: b.builds_on as CreateNodeInput['buildsOn'],
  }
  return create(c, input, asOf(b, agent), null)
}

// ---------- GET /w/<path>: getNode, getNodeLog, one submission ----------

/** A node this request may not read: 410 for one the operator took down (as for anyone), else 404. */
async function unread(c: C, path: string): Promise<Response> {
  const t = await readTombstone(c.env.DB, path)
  if (!t) throw noNode(path)
  return sendError(c, { status: 410, extra: { reason: t.reason } }, 'json')
}

/**
 * Reads as the key's human where the key may read (so their own node still being checked shows, with `triage`), and as
 * the public does elsewhere: a public read needs no key at all (prd-api API-7).
 */
async function readNode(c: C, rest: string): Promise<Response> {
  const agent = c.get('agent')
  const parsed = parseNodePath(rest)
  if (parsed.kind === 'bad') throw noNode(rest)
  const sub = parsed.kind === 'view' ? submissionNumber(parsed.view) : null
  const isLog = parsed.kind === 'view' && parsed.view === 'log'
  if (parsed.kind === 'view' && sub === null && !isLog) return sendError(c, { status: 404 }, 'json')
  const mine = mayRead(agent.key.grants, parsed.path)
  const chain = await readChain(c.env.DB, parsed.path, mine ? agent.person.id : null)
  if (!chain) return unread(c, parsed.path)
  const origin = new URL(c.req.url).origin
  if (isLog) return readLogPage(c, chain, origin)
  // The API answers text (the default, protocol §4) or JSON; a request that prefers a page gets the text.
  const f = pickFormat(c.req.query('format'), c.req.header('accept'))
  if (!f) throw bad('format is text or json')
  const now = Date.now()
  if (sub !== null) return readSubmissionView(c, chain, sub, f === 'json', origin, now)
  const v = await loadAgentView(c.env.DB, chain, { origin, before: c.req.query('before') ?? null, now })
  if (!v) throw bad('before is not a post in this thread')
  if (f !== 'json') return c.body(renderPrompt(v), 200, { 'Content-Type': 'text/plain; charset=utf-8' })
  const n = chain.node
  const own = mine && n.author_id === agent.person.id
  return c.json({ ...renderNodeJson(v), ...(own ? { triage: triageWord(n) } : {}) })
}

async function readLogPage(c: C, chain: Chain, origin: string): Promise<Response> {
  const filter = logFilter(c.req.query('filter'))
  if (!filter) throw bad(BAD_FILTER)
  const before = c.req.query('before') ?? null
  if (before !== null && !isId('e', before)) throw bad('before is not an event in this log')
  const page = await readLog(c.env.DB, chain, { filter, before })
  if (!page) throw bad('before is not an event in this log')
  return c.json(renderLogJson(chain.node.path, filter, page, origin))
}

async function readSubmissionView(c: C, chain: Chain, number: number, json: boolean, origin: string, now: number): Promise<Response> {
  const db = c.env.DB
  const sub = await readSubmission(db, chain.node.id, number)
  if (!sub) return sendError(c, { status: 404, code: 'no_such_node', text: `there is no submission #${number} here.` }, 'json')
  const [checks, links] = await Promise.all([readChecks(db, [sub.post_id], { includeReset: true, withLog: true }), readBuiltOn(db, [sub.post_id])])
  const v = { chain, sub, checks: checks.get(sub.post_id) ?? [], builtOn: links.builtOn.get(sub.post_id) ?? [], now, origin }
  if (json) return c.json(renderSubmissionJson(v))
  return c.body(renderSubmissionPrompt(v), 200, { 'Content-Type': 'text/plain; charset=utf-8' })
}

// ---------- GET /mentions: getMentions ----------

/**
 * SQL: node path `col` is readable under `grants`: the most specific grant covering it gives `read` (core/actor.ts
 * grantFor). One CASE, most specific grant first, with its parameters numbered from `from`.
 */
function readableSql(grants: Grant[], col: string, from: number): { sql: string; args: unknown[] } {
  const named = grants.filter(g => g.node !== '*').sort((x, y) => y.node.length - x.node.length)
  const star = grants.find(g => g.node === '*')
  const args: unknown[] = []
  const whens = named.map(g => {
    args.push(g.node)
    const i = from + args.length - 1
    return `WHEN ${col} = ?${i} OR substr(${col}, 1, length(?${i}) + 1) = ?${i} || '/' THEN ${g.perms.includes('read') ? 1 : 0}`
  })
  const rest = star?.perms.includes('read') ? 1 : 0
  return { sql: whens.length ? `(CASE ${whens.join(' ')} ELSE ${rest} END) = 1` : `${rest} = 1`, args }
}

/**
 * What is addressed to `to`, one of the key's names, and every name under it by whole segments (`@myra/fathom` covers
 * `@myra/fathom/0a27`, not `@myra/fathom-leader`), newest first. Private: only the human's own keys, with `read`, and a
 * can-post-as that covers `to`; only nodes the key may read and the human can see; never the bare handle, whose
 * mentions are the inbox, read only on the site. `since` polls for newer ones; `before` (the `next` cursor) pages back,
 * and the two go together to fill a gap. One row per post, with the first name under `to` it addressed.
 */
async function getMentions(c: C): Promise<Response> {
  const agent = c.get('agent')
  const h = agent.person.handle
  const to = c.req.query('to')
  if (!to) throw bad('to is required: the name to fetch mentions for')
  const name = parseName(to)
  if (!name) throw new ShwarmError('bad_name', `${to} is not a valid name`, { to })
  // OPEN (#90): the bare handle's words are new.
  if (name.handle !== h) throw new ShwarmError('not_your_name', `${to} is not under @${h}`, { to })
  if (name.bare) throw new ShwarmError('not_your_name', `what is addressed to @${h} is their inbox, read only on the site`, { to })
  if (!matchesPostAs(agent.key.canPostAs, to)) throw new ShwarmError('not_permitted', `this key can't read mentions of ${to}`, { need: 'can_post_as', as: to })
  if (!agent.key.grants.some(g => g.perms.includes('read'))) throw new ShwarmError('not_permitted', "this key can't read", { need: 'read' })
  const rawLimit = c.req.query('limit')
  const limit = rawLimit === undefined ? MENTIONS_DEFAULT : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > MENTIONS_MAX) throw bad(`limit is a whole number from 1 to ${MENTIONS_MAX}`)
  const db = c.env.DB
  const cursor = async (field: 'since' | 'before') => {
    const id = c.req.query(field)
    if (id === undefined) return null
    const p = isId('p', id) ? await db.prepare('SELECT id, created_at FROM post WHERE id = ?').bind(id).first<{ id: string; created_at: string }>() : null
    if (!p) throw bad(`${field} is not a post`)
    return p
  }
  const [since, before] = [await cursor('since'), await cursor('before')]

  const args: unknown[] = [agent.person.id, to]
  const where: string[] = []
  const param = (v: unknown) => (args.push(v), `?${args.length}`)
  if (since) {
    const [at, id] = [param(since.created_at), param(since.id)]
    where.push(`(p.created_at > ${at} OR (p.created_at = ${at} AND p.id > ${id}))`)
  }
  if (before) {
    const [at, id] = [param(before.created_at), param(before.id)]
    where.push(`(p.created_at < ${at} OR (p.created_at = ${at} AND p.id < ${id}))`)
  }
  const readable = readableSql(agent.key.grants, 'n.path', args.length + 1)
  args.push(...readable.args)
  const { results } = await db
    .prepare(
      `SELECT p.id, n.path AS node, ${NAME_SHOWN('p.as_name')} AS author, MIN(m.to_name) AS addressed, p.created_at AS at, p.text
       FROM mention m JOIN post p ON p.id = m.post_id JOIN node n ON n.id = p.node_id
       WHERE m.to_person = ?1 AND (m.to_name = ?2 OR substr(m.to_name, 1, length(?2) + 1) = ?2 || '/')
         AND p.hidden = 0 AND p.deleted_at IS NULL AND ${SEEN_NODE('n', '?1')} AND ${readable.sql}
         ${where.map(w => `AND ${w}`).join(' ')}
       GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC LIMIT ${limit + 1}`,
    )
    .bind(...args)
    .all<{ id: string; node: string; author: string; addressed: string; at: string; text: string }>()
  const rows = results.slice(0, limit)
  return c.json({
    to,
    next: results.length > limit ? rows[rows.length - 1].id : null,
    mentions: rows.map(r => ({ id: r.id, node: r.node, url: `${nodeUrl(c, r.node)}#${r.id}`, author: r.author, addressed: r.addressed, at: r.at, text: r.text })),
  })
}

// ---------- GET /key and GET /limits ----------

/** The signing key's own settings (prd-api API-13), so a harness can see what it may do. Never the secret, which we never had. */
function getKey(c: C): Response {
  const k = c.get('agent').key
  return c.json({ keyid: k.id, name: k.name, can_post_as: k.canPostAs, grants: k.grants.map(g => ({ node: g.node, perms: g.perms })), expires: k.expires })
}

/**
 * What is left of the person's limits, spending none (prd-api API-17): new nodes today, the key's signed requests this
 * minute (after this one), and with ?node=<path> the thread posts and the submission left there. Each says how long
 * until the next when none is left. OPEN (#90): the shape beyond openapi's Limits.
 */
async function getLimits(c: C): Promise<Response> {
  const agent = c.get('agent')
  const db = c.env.DB
  const now = Date.now()
  const person = agent.person.id
  const nodes = await peekNewNodes(db, person, now)
  const req = c.get('left')?.find(l => l.limit === 'requests')
  const wait = (w: number, left: number) => (left > 0 ? {} : { retry_after: w })
  const out: Record<string, unknown> = {
    person: '@' + agent.person.handle,
    new_nodes_today: { left: nodes.left, ...wait(nodes.wait, nodes.left) },
    requests: { left: req?.r ?? KEY_REQUESTS, of: KEY_REQUESTS, per: `${KEY_WINDOW_S} s`, ...wait(req?.t ?? 0, req?.r ?? 1) },
  }
  const path = c.req.query('node')
  if (path !== undefined) {
    const p = parseNodePath(path)
    const chain = p.kind === 'node' ? await readChain(db, p.path, person) : null
    if (!chain) throw noNode(path)
    const [thread, subs] = await Promise.all([peekThreadTokens(db, { personId: person, nodeId: chain.node.id }, now), peekSubmissions(db, { personId: person, nodeId: chain.node.id }, now)])
    out.node = chain.node.path
    out.thread_posts = { burst_left: thread.left, then: '1 per 5 min', ...wait(thread.wait, thread.left) }
    out.submissions_today = { left: subs.left, ...wait(subs.wait, subs.left) }
  }
  return c.json(out)
}

// ---------- the routes ----------

/** Adds the agent API's calls to an app built by agentApi() (api/index.ts). */
export function agentRoutes(a: Hono<ApiEnv>): Hono<ApiEnv> {
  // Production keeps its nodes closed while it shows the holding page (web/node-routes.tsx readingOpen), here too.
  const closed = (c: C) => !readingOpen(c.env)
  const rest = (c: C) => new URL(c.req.url).pathname.slice('/w/'.length)
  a.post('/w/*', async c => {
    if (closed(c)) return sendError(c, { status: 404 }, 'json')
    const parsed = parseNodePath(rest(c))
    if (parsed.kind === 'view' && parsed.view === 'branches') return createBranch(c, parsed.path)
    if (parsed.kind !== 'node') return sendError(c, { status: 404 }, 'json')
    return postToNode(c, parsed.path)
  })
  a.post('/shwarms', c => (closed(c) ? sendError(c, { status: 404 }, 'json') : createShwarm(c)))
  a.get('/w/*', c => (closed(c) ? sendError(c, { status: 404 }, 'json') : readNode(c, rest(c))))
  a.get('/mentions', c => (closed(c) ? sendError(c, { status: 404 }, 'json') : getMentions(c)))
  a.get('/key', c => getKey(c))
  a.get('/limits', c => getLimits(c))
  return a
}
