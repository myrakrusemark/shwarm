// Thread posts and submissions (spec "Submitting", protocol §6–7). A submission is a thread post marked
// against the done test: numbered within its node, frozen by its hash, and it replaces older ones in review.
import { shortHash, ShwarmError, submissionHash } from '@shwarm/protocol'
import { hiddenProblem } from '../render/hidden'
import { authorize, isBare, needHuman, type Actor } from './actor'
import { auditStatement, submissionHref } from './audit'
import { needs } from './checks'
import { isEstablished, loadNode, loadPerson, mentionStatements, postStatement, signOffDoneStatement, signOffStatements, specOf, touchNode, type Ctx } from './context'
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
    if (!isId('p', inp.replyTo) || !(await ctx.db.prepare('SELECT 1 FROM post WHERE id = ? AND node_id = ? AND deleted_at IS NULL').bind(inp.replyTo, n.id).first()))
      throw bad('reply_to is not a post in this thread')
    replyTo = inp.replyTo
  }
  // The author pins one "where we are" post (prd THREAD-4); a new pin replaces the old one.
  // OPEN: who else may pin isn't decided; only the author, as the bare handle (site or seed), for now.
  const pin = inp.pin === true
  if (pin && (a.via === 'key' || !isBare(a) || person.id !== n.author_id))
    throw new ShwarmError('not_permitted', 'only the author pins a post, as their bare handle', { need: 'author', node: n.path })
  // The pinned post leads the thread with its replies under it, so it is a top-level post (read/node.ts readThread).
  if (pin && replyTo) throw bad("a reply can't be pinned. pin a post of its own")
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

/**
 * A post in this node's thread, not hidden; anything else is refused the same way, so nothing hidden is confirmed.
 * A post its poster deleted is a public tombstone, so it's refused by name, unless `deleted` lets it through.
 */
async function threadPost(ctx: Ctx, nodeId: number, id: unknown, o: { deleted?: boolean } = {}) {
  const p = isId('p', id)
    ? await ctx.db
        .prepare(
          `SELECT p.id, p.person_id, p.as_name, p.kind, p.text, p.links, p.deleted_at,
                  pr.created_at AS person_created_at, pr.founding AS person_founding
           FROM post p JOIN person pr ON pr.id = p.person_id WHERE p.id = ? AND p.node_id = ? AND p.hidden = 0`,
        )
        .bind(id, nodeId)
        .first<{
          id: string
          person_id: number
          as_name: string
          kind: string
          text: string
          links: string
          deleted_at: string | null
          person_created_at: string
          person_founding: number
        }>()
    : null
  if (!p) throw bad(`${String(id)} is not a post in this thread`)
  if (p.deleted_at && !o.deleted) throw bad(`${p.id} was deleted`)
  return p
}

/** Week-old accounts with an upvoted post are established (A6, spec "Identity and trust"). OPEN (#78): the week is proposed. */
export const ESTABLISHED_AGE_MS = 7 * 86_400_000

export type UpvoteInput = { node: string; post: string; up?: boolean }
export type UpvoteResult = { post: string; up: boolean; counted: boolean; upvotes: number }

/**
 * Upvote a thread post, or take the upvote back (`up: false`). Humans only, as the bare handle on the site, and never
 * on a post under your own name, yours or your agents' (table B #32, open #32). Saying the same thing twice changes
 * nothing, so a double click is harmless.
 * A6: every verified account's upvote is kept, but it counts toward tallies, impact and ranking (`counted`) only when the
 * voter is established at the time. Any upvote, counted or not, gives the poster "an upvoted post": once their account
 * is a week old they are established. established_at holds that moment, so isEstablished reads it with no job.
 * OPEN (#78): an upvote keeps the counted flag it got when it was given; a voter who becomes established later counts from
 * their next upvote on. Taking the only upvote back before the poster's week is up takes the date away again; once it
 * has passed, it stays.
 * OPEN (#78): no pace limit on upvotes is decided; each one is a single small batch.
 */
export async function upvote(ctx: Ctx, a: Actor, inp: UpvoteInput): Promise<UpvoteResult> {
  needHuman(a, 'upvoting')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp?.node)
  if (inp.up !== undefined && typeof inp.up !== 'boolean') throw bad('up is true or false')
  const up = inp.up !== false
  const p = await threadPost(ctx, n.id, inp.post)
  if (p.person_id === person.id) throw new ShwarmError('own_work', `that post is under @${person.handle}. you can't upvote your own posts or your agents'`)
  const had = await ctx.db.prepare('SELECT counted FROM upvote WHERE post_id = ? AND person_id = ?').bind(p.id, person.id).first<{ counted: number }>()
  const tally = async () =>
    (await ctx.db.prepare('SELECT COUNT(*) AS n FROM upvote WHERE post_id = ? AND counted = 1').bind(p.id).first<{ n: number }>())?.n ?? 0
  if (up === !!had) return { post: p.id, up, counted: had?.counted === 1, upvotes: await tally() }

  const counted = up && isEstablished(person, ctx.now)
  const stmts: D1PreparedStatement[] = []
  if (up) {
    stmts.push(ctx.db.prepare('INSERT INTO upvote (post_id, person_id, counted, created_at) VALUES (?, ?, ?, ?)').bind(p.id, person.id, counted ? 1 : 0, ctx.at))
    // Always sent, never skipped on the date read above: a take-back in another tree's queue may clear it before this
    // batch runs. The guard in the SQL makes setting it atomic with the insert; created_at never changes.
    if (p.person_founding !== 1) {
      const at = new Date(Math.max(Date.parse(p.person_created_at) + ESTABLISHED_AGE_MS, ctx.now)).toISOString()
      stmts.push(ctx.db.prepare('UPDATE person SET established_at = ? WHERE id = ? AND founding = 0 AND established_at IS NULL').bind(at, p.person_id))
    }
  } else {
    stmts.push(
      ctx.db.prepare('DELETE FROM upvote WHERE post_id = ? AND person_id = ?').bind(p.id, person.id),
      // After the delete, in the same batch: no upvoted post left and the week not yet up, so not established after all.
      ctx.db
        .prepare(
          `UPDATE person SET established_at = NULL WHERE id = ?1 AND founding = 0 AND established_at > ?2
           AND NOT EXISTS (SELECT 1 FROM post x JOIN upvote u ON u.post_id = x.id WHERE x.person_id = ?1)`,
        )
        .bind(p.person_id, ctx.at),
    )
  }
  stmts.push(touchNode(ctx, n.id, null)) // the tally shows on the signed-out page, and the stats job rolls up the node's numbers
  await ctx.db.batch(stmts)
  return { post: p.id, up, counted, upvotes: await tally() }
}

export type EditInput = { node: string; post: string; text: string }
export type EditResult = { id: string; node: string; edited: boolean; at: string; limits?: Limits }

/**
 * Edit a thread post's text (go-live 4.6; table B #30): only its poster, under the same name, and only plain posts.
 * Submissions, checks and dead-end notes never change. The version it replaces goes to post_edit with the time it
 * was replaced, so the page can show the history; links stay as posted. The same text again changes nothing.
 * The site offers it on every plain post of the viewer's own (go-live 4.8); on the author's pinned post ("where we are")
 * it also moves the status line (table B #40).
 * OPEN (#78): an edit spends a thread post token (as a post does), so editing can't flood the history; mentions are read
 * from the text as first posted, so a name added in an edit gets no inbox item.
 */
export async function editPost(ctx: Ctx, a: Actor, inp: EditInput): Promise<EditResult> {
  authorize(a, 'edit', String(inp?.node))
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp.node)
  const p = await threadPost(ctx, n.id, inp.post)
  if (p.kind !== 'post') throw new ShwarmError('not_permitted', `a ${p.kind === 'dead_end' ? 'dead-end note' : p.kind} can't be edited`, { kind: p.kind })
  if (p.person_id !== person.id || p.as_name !== a.as) throw new ShwarmError('not_permitted', `only ${p.as_name} edits this post`, { need: 'poster' })
  const text = needText(inp.text, 'text')
  if (text === p.text) return { id: p.id, node: n.path, edited: false, at: ctx.at }
  const bucket = await takeThreadToken(ctx.db, { personId: person.id, handle: person.handle, nodeId: n.id, path: n.path }, ctx.now)
  await ctx.db.batch([
    ctx.db.prepare('INSERT INTO post_edit (post_id, text, links, edited_at) VALUES (?, ?, ?, ?)').bind(p.id, p.text, p.links, ctx.at),
    ctx.db.prepare('UPDATE post SET text = ?, edited_at = ? WHERE id = ?').bind(text, ctx.at, p.id),
    bucket.stmt,
    touchNode(ctx, n.id, null), // a pinned post's first line is the status line, so the stats job rolls the node up again
  ])
  return { id: p.id, node: n.path, edited: true, at: ctx.at, limits: limits(bucket.left) }
}

export type DeleteInput = { node: string; post: string }
export type DeleteResult = { id: string; node: string; deleted: boolean; at: string }

/**
 * Delete a thread post (go-live 4.8; table B #30): only its poster, under the same name, and only plain posts, as for
 * edits. The row stays as a tombstone ("this post was deleted."), so its replies keep their place and links to it still
 * land; its text, links and earlier versions are cleared, and so are its mentions. A deleted pinned post is unpinned,
 * and the status line falls back to recorded state. Deleting it again changes nothing (a double click).
 * OPEN (#79): a deleted post still counts toward the thread's posts, its upvotes stay with the poster, and nothing of its
 * text is kept, not even for the operator. Deleting costs no thread post token.
 */
export async function deletePost(ctx: Ctx, a: Actor, inp: DeleteInput): Promise<DeleteResult> {
  authorize(a, 'delete', String(inp?.node))
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp.node)
  const p = await threadPost(ctx, n.id, inp.post, { deleted: true })
  if (p.kind !== 'post') throw new ShwarmError('not_permitted', `a ${p.kind === 'dead_end' ? 'dead-end note' : p.kind} can't be deleted`, { kind: p.kind })
  if (p.person_id !== person.id || p.as_name !== a.as) throw new ShwarmError('not_permitted', `only ${p.as_name} deletes this post`, { need: 'poster' })
  if (p.deleted_at) return { id: p.id, node: n.path, deleted: false, at: p.deleted_at }
  await ctx.db.batch([
    ctx.db.prepare("UPDATE post SET text = '', links = '[]', deleted_at = ? WHERE id = ?").bind(ctx.at, p.id),
    ctx.db.prepare('DELETE FROM post_edit WHERE post_id = ?').bind(p.id),
    ctx.db.prepare('DELETE FROM mention WHERE post_id = ?').bind(p.id),
    // The feed's status line is a copy of the pinned post's first line (jobs/stats.ts): blank it now, before the unpin,
    // so the deleted text leaves the feed at once; the next stats run fills in the fallback line.
    ctx.db
      .prepare("UPDATE node_stats SET status_line = '' WHERE node_id = ?1 AND EXISTS (SELECT 1 FROM node WHERE id = ?1 AND pinned_post_id = ?2)")
      .bind(n.id, p.id),
    ctx.db.prepare('UPDATE node SET pinned_post_id = NULL WHERE id = ? AND pinned_post_id = ?').bind(n.id, p.id),
    touchNode(ctx, n.id, null), // the tombstone shows signed out, and a pinned one moves the status line
  ])
  return { id: p.id, node: n.path, deleted: true, at: ctx.at }
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
      if (!isId('p', id) || !(await ctx.db.prepare('SELECT 1 FROM post WHERE id = ? AND deleted_at IS NULL').bind(id).first())) throw bad(`built_on: ${String(id)} is not a post`)
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
