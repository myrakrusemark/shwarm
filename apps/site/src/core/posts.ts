// Thread posts and submissions (spec "Submitting", protocol §6–7). A submission is a thread post marked
// against the done test: numbered within its node, frozen by its hash, and it replaces older ones in review.
import { shortHash, ShwarmError, submissionHash } from '@shwarm/protocol'
import { hiddenProblem } from '../render/hidden'
import { authorize, isBare, type Actor } from './actor'
import { auditStatement, submissionHref } from './audit'
import { needs } from './checks'
import { loadNode, loadPerson, mentionStatements, postStatement, signOffDoneStatement, signOffStatements, specOf, touchNode, type Ctx } from './context'
import { isId, newId } from './ids'
import { checkSubmissions, takeThreadToken } from './limits'
import { checkWritable, readSettings } from './settings'
import { MAX_LINKS, needText, optText, parseLinks } from './text'

const bad = (m: string, d: Record<string, unknown> = {}) => new ShwarmError('bad_request', m, d)

export type Limits = { thread_posts: { burst_left: number; then: string } }
const limits = (left: number): Limits => ({ thread_posts: { burst_left: left, then: '1 per 5 min' } })

export type PostInput = { node: string; text: string; links?: unknown; replyTo?: string | null; pin?: boolean }
export type PostResult = { id: string; node: string; as: string; at: string; mentions: string[]; limits: Limits }

export async function post(ctx: Ctx, a: Actor, inp: PostInput): Promise<PostResult> {
  authorize(a, 'post', String(inp?.node))
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp.node)
  const text = needText(inp.text, 'text')
  const links = parseLinks(inp.links)
  let replyTo: string | null = null
  if (inp.replyTo !== undefined && inp.replyTo !== null) {
    if (!isId('p', inp.replyTo) || !(await ctx.db.prepare('SELECT 1 FROM post WHERE id = ? AND node_id = ?').bind(inp.replyTo, n.id).first()))
      throw bad('reply_to is not a post in this thread')
    replyTo = inp.replyTo
  }
  // The author pins one "where we are" post (prd THREAD-4); a new pin replaces the old one.
  // OPEN: who else may pin isn't decided; only the author, as the bare handle (site or seed), for now.
  const pin = inp.pin === true
  if (pin && (a.via === 'key' || !isBare(a) || person.id !== n.author_id))
    throw new ShwarmError('not_permitted', 'only the author pins a post, as their bare handle', { need: 'author', node: n.path })
  const bucket = await takeThreadToken(ctx.db, { personId: person.id, handle: person.handle, nodeId: n.id, path: n.path }, ctx.now)
  const id = newId('p')
  const m = await mentionStatements(ctx, { postId: id, text, nodeId: n.id, actor: a })
  await ctx.db.batch([
    postStatement(ctx, { id, nodeId: n.id, actor: a, kind: 'post', text, links, replyTo }),
    ...m.stmts,
    bucket.stmt,
    ...(pin ? [ctx.db.prepare('UPDATE node SET pinned_post_id = ? WHERE id = ?').bind(id, n.id)] : []),
    touchNode(ctx, n.id, id), // a new post changes the signed-out page, so it changes the ETag
  ])
  return { id, node: n.path, as: a.as, at: ctx.at, mentions: m.names, limits: limits(bucket.left) }
}

export type SubmitInput = {
  node: string
  text: string
  links: unknown
  howToCheck: string
  builtOn?: (string | { post: string; note?: string })[]
  release?: { name?: string; version?: string; howToUse?: string } | null // optional (table B #64)
}

// OPEN: the caps are proposed (decisions, Oct 9). Name and version are one line; how to use is often a command to copy.
export const RELEASE_CAPS = { name: 120, version: 50, howToUse: 2000 } as const
export const MAX_BUILT_ON_NOTE = 280 // OPEN: proposed (decisions, Oct 9)

export type Release = { name: string | null; version: string | null; howToUse: string | null }

/** The optional release fields a submitter fills: what the result page shows if this submission passes. */
export function parseRelease(v: unknown): Release {
  if (v === undefined || v === null) return { name: null, version: null, howToUse: null }
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('release is {name, version, how_to_use}')
  const o = v as Record<string, unknown>
  const unknown = Object.keys(o).filter(k => k !== 'name' && k !== 'version' && k !== 'howToUse')
  if (unknown.length) throw bad(`release has unknown fields: ${unknown.join(', ')}`)
  const name = optText(o.name, 'release.name', RELEASE_CAPS.name)
  const version = optText(o.version, 'release.version', RELEASE_CAPS.version)
  for (const [k, x] of [['name', name], ['version', version]] as const) if (x && /[\r\n]/.test(x)) throw bad(`release.${k} is one line`, { field: `release.${k}` })
  const howToUse = optText(o.howToUse, 'release.how_to_use', RELEASE_CAPS.howToUse)
  const hidden = howToUse ? hiddenProblem(howToUse, 'how to use') : null // Trojan Source, as for run commands
  if (hidden) throw bad(hidden, { field: 'release.how_to_use' })
  return { name, version, howToUse }
}

export type CheckRowOut = { id: null; slot: 'run' | 'people' | 'author'; as?: string; verdict: 'waiting' }

export type SubmitResult = PostResult & { number: number; hash: string; authorSwap: boolean; checks: CheckRowOut[] }

export async function submit(ctx: Ctx, a: Actor, inp: SubmitInput): Promise<SubmitResult> {
  authorize(a, 'submit', String(inp?.node))
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp.node)
  if (n.state === 'lobby') throw new ShwarmError('lobby_not_open', `${n.path} is still a lobby. submissions open at kickoff`, { node: n.path })
  // OPEN: no code names "this node is closed or a dead end" for submissions; shwarm_closed is the nearest.
  if (n.state !== 'live') throw new ShwarmError('shwarm_closed', `${n.path} is ${n.state.replace('_', ' ')}. it takes no submissions`, { node: n.path })
  const text = needText(inp.text, 'text')
  const links = parseLinks(inp.links)
  if (!links.length) throw bad('a submission links the work: {url, sha256} or {repo, commit}')
  const howToCheck = needText(inp.howToCheck, 'how_to_check')
  const release = parseRelease(inp.release)
  const builtOn = new Map<string, string | null>() // post id → why it was used
  if (inp.builtOn !== undefined && inp.builtOn !== null) {
    if (!Array.isArray(inp.builtOn) || inp.builtOn.length > MAX_LINKS) throw bad(`built_on is a list of at most ${MAX_LINKS} posts`)
    for (const b of inp.builtOn) {
      const id = typeof b === 'string' ? b : b?.post
      const note = typeof b === 'string' || !b ? null : optText(b.note, 'built_on.note', MAX_BUILT_ON_NOTE)
      if (!isId('p', id) || !(await ctx.db.prepare('SELECT 1 FROM post WHERE id = ?').bind(id).first())) throw bad(`built_on: ${String(id)} is not a post`)
      if (!builtOn.get(id)) builtOn.set(id, note) // named twice: the first note given wins
    }
  }

  await checkSubmissions(ctx.db, { personId: person.id, handle: person.handle, nodeId: n.id, path: n.path }, ctx.now)
  const bucket = await takeThreadToken(ctx.db, { personId: person.id, handle: person.handle, nodeId: n.id, path: n.path }, ctx.now) // submissions count as thread posts
  const spec = specOf(n)
  const authorSwap = spec.author && person.id === n.author_id // A9: the author's own work gets one more people check instead
  const need = needs(spec, authorSwap)
  const number = n.next_submission
  const hash = await submissionHash({ text, links })
  const id = newId('p')
  const m = await mentionStatements(ctx, { postId: id, text, nodeId: n.id, actor: a })
  const e = auditStatement(
    ctx.db,
    { event: 'submission', node: n.id, by: a.as, submissionId: id, number, detail: `#${number} (${shortHash(hash)})`, evidence: submissionHref(n.path, number) },
    ctx.at,
  )
  const stmts: D1PreparedStatement[] = [
    postStatement(ctx, { id, nodeId: n.id, actor: a, kind: 'submission', text, links }),
    ctx.db
      .prepare(
        `INSERT INTO submission (post_id, node_id, number, hash, how_to_check, author_swap, release_title, release_version, release_how_to_use)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, n.id, number, hash, howToCheck, authorSwap ? 1 : 0, release.name, release.version, release.howToUse),
    // A newer submission replaces the ones still in review; their checks and repros stay visible, their sign-off items are done.
    ctx.db
      .prepare("UPDATE submission SET status = 'superseded', superseded_by = ? WHERE node_id = ? AND status = 'in_review' AND post_id <> ?")
      .bind(id, n.id, id),
    signOffDoneStatement(ctx, n.id, { replacedBy: id }),
    ...[...builtOn].map(([p, note]) => ctx.db.prepare('INSERT INTO built_on (submission_id, post_id, note) VALUES (?, ?, ?)').bind(id, p, note)),
    ctx.db.prepare('UPDATE node SET next_submission = ? WHERE id = ?').bind(number + 1, n.id),
    e.stmt,
    ...m.stmts,
    bucket.stmt,
  ]
  // Author only: the author is notified at once, in the inbox and by mail (spec "The author goes last").
  if (need.author && need.runs === 0 && need.people === 0) stmts.push(...signOffStatements(ctx, n, { postId: id, number }, true))
  stmts.push(touchNode(ctx, n.id, e.id))
  await ctx.db.batch(stmts)

  const checks: CheckRowOut[] = [
    ...Array.from({ length: need.runs }, (): CheckRowOut => ({ id: null, slot: 'run', verdict: 'waiting' })),
    ...Array.from({ length: need.people }, (): CheckRowOut => ({ id: null, slot: 'people', verdict: 'waiting' })),
    ...(need.author ? [{ id: null, slot: 'author', as: '@' + n.author_handle, verdict: 'waiting' } as CheckRowOut] : []),
  ]
  return { id, node: n.path, as: a.as, at: ctx.at, mentions: m.names, limits: limits(bucket.left), number, hash, authorSwap, checks }
}
