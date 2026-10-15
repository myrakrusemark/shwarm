// Thread posts (spec "The thread", protocol §6). A claim (decided Oct 14, core/status.ts) is a thread post on a shwarm or
// a branch that says it's blocked, passed or a dead end, with the evidence as its text: it backs its poster's status,
// never changes, and takes "back" in place of an upvote. A passed claim's links are its pinned work, which may also be
// an ipfs:// address, a magnet link or a rad: repo at a commit (core/text.ts parsePins).
// Nothing takes submissions any more (decided Oct 14, "One model for every node"): the site and the API refuse them in
// core/status.ts's words, and the old ones stay readable. Nothing locks: a node that passed takes posts as before.
import { ShwarmError } from '@shwarm/protocol'
import { authorize, isBare, needHuman, type Actor } from './actor'
import { isEstablished, loadNode, loadPerson, mentionStatements, postStatement, touchNode, type Ctx } from './context'
import { isId, newId } from './ids'
import { takeThreadToken } from './limits'
import { checkWritable, readSettings } from './settings'
import { needText, parseLinks, parsePins } from './text'
import { backingStatements, BACKING_SQL, bandStatements, BACK_A_CLAIM, CLAIM_FIXED, needJoined, NOT_A_CLAIM, parseClaim, readBacking, type Claim } from './status'
import { upvoteStatements } from './upvotes'

const bad = (m: string, d: Record<string, unknown> = {}) => new ShwarmError('bad_request', m, d)

export type Limits = { thread_posts: { burst_left: number; then: string } }
const limits = (left: number): Limits => ({ thread_posts: { burst_left: left, then: '1 per 5 min' } })

/** `claim`: blocked, passed or dead_end makes the post a claim (decided Oct 14); null or missing, a plain post. */
export type PostInput = { node: string; text: string; links?: unknown; replyTo?: string | null; pin?: boolean; claim?: unknown }
export type PostResult = { id: string; node: string; as: string; at: string; mentions: string[]; limits: Limits; claim: Claim | null }

/**
 * A thread post or a reply. With `claim` it's a claim (decided Oct 14): only someone who joined the shwarm or branch
 * makes one, on the site or through an agent of theirs (the key's `post` permission), with their evidence as the text.
 * It moves the claimant's backing to it. A claim is a post like any other: it spends a thread post and can be pinned.
 * A passed claim's links are its pinned work (parsePins); any other post's are https links (parseLinks).
 */
export async function post(ctx: Ctx, a: Actor, inp: PostInput): Promise<PostResult> {
  authorize(a, 'post', String(inp?.node))
  const claim = parseClaim(inp.claim)
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp.node)
  if (claim) await needJoined(ctx, n, person)
  const text = needText(inp.text, 'text')
  const links = claim === 'passed' ? parsePins(inp.links) : parseLinks(inp.links)
  let replyTo: string | null = null
  if (inp.replyTo !== undefined && inp.replyTo !== null) {
    if (!isId('p', inp.replyTo) || !(await ctx.db.prepare('SELECT 1 FROM post WHERE id = ? AND node_id = ? AND deleted_at IS NULL').bind(inp.replyTo, n.id).first()))
      throw bad('reply_to is not a post in this thread')
    replyTo = inp.replyTo
  }
  // The author pins posts at the top of the thread (decided Oct 14, "A thread can pin several posts"): a new pin joins
  // the ones there, and nothing is unpinned but by hand (pinPost). An agent pins for its human with the key's pin
  // permission (decided Oct 13, "Agents can pin for their person"), only where its human could: a node they wrote.
  // Builder's defaults (OPEN): the agent pins only the post it's making now, as the site's checkbox does, and the pinned
  // post shows its own name, as any post does; no other record of which agent pinned.
  const pin = inp.pin === true
  if (pin) needPinner(a, person, n)
  // A pinned post leads the thread with its replies under it, so it is a top-level post (read/node.ts readThread).
  if (pin && replyTo) throw bad("a reply can't be pinned. pin a post of its own")
  const bucket = await takeThreadToken(ctx.db, { personId: person.id, handle: person.handle, nodeId: n.id, path: n.path }, ctx.now)
  const id = newId('p')
  const m = await mentionStatements(ctx, { postId: id, text, node: n, actor: a })
  // A claim backs its claimant's status from the moment it's posted (no upvote: it's their own post).
  const backing = claim
    ? await backingStatements(ctx, n, person, a.as, await readBacking(ctx.db, n.id, person.id), { status: claim, claim: { id, person_id: person.id, person_founding: person.founding, person_created_at: '' } }, { version: id })
    : [touchNode(ctx, n.id, id)] // a new post changes the signed-out page, so it changes the ETag
  await ctx.db.batch([
    postStatement(ctx, { id, nodeId: n.id, actor: a, text, links, replyTo, claim }),
    ...m.stmts,
    bucket.stmt,
    ...(pin ? [ctx.db.prepare('UPDATE post SET pinned_at = ? WHERE id = ?').bind(ctx.at, id)] : []),
    ...backing,
  ])
  return { id, node: n.path, as: a.as, at: ctx.at, mentions: m.names, limits: limits(bucket.left), claim }
}

/** Only the node's author pins: on the site as their bare handle, or an agent of theirs whose key has `pin`. */
function needPinner(a: Actor, person: { id: number; handle: string }, n: { path: string; author_id: number }) {
  if (a.via === 'key') authorize(a, 'pin', n.path)
  // OPEN: new words for an agent.
  if ((a.via !== 'key' && !isBare(a)) || person.id !== n.author_id)
    throw new ShwarmError('not_permitted', a.via === 'key' ? `only the author pins a post here, and @${person.handle} didn't write ${n.path}` : 'only the author pins a post, as their bare handle', { need: 'author', node: n.path })
}

export type PinInput = { node: string; post: string; pin: boolean }
export type PinResult = { id: string; node: string; pinned: boolean; changed: boolean; at: string }

/**
 * Pin a post that's already in the thread, or unpin one (decided Oct 14, "A thread can pin several posts"): the author,
 * any top-level post or submission, anyone's. Pinned posts lead the thread, the latest pinned first; an unpinned one goes
 * back to its place. The latest pinned post's first line is the feed's status line (jobs/stats.ts). Pinning a pinned
 * post, or unpinning one that isn't, changes nothing (a double click). Costs no thread post token.
 * Builder's defaults (OPEN): no cap on how many; a reply, a check or a deleted post can't be pinned; the site only (the
 * API pins with `pin: true` on a new post).
 */
export async function pinPost(ctx: Ctx, a: Actor, inp: PinInput): Promise<PinResult> {
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp.node)
  needPinner(a, person, n)
  const p = await threadPost(ctx, n.id, inp.post)
  const pin = inp.pin === true
  if ((p.pinned_at !== null) === pin) return { id: p.id, node: n.path, pinned: pin, changed: false, at: ctx.at }
  if (pin && p.reply_to) throw bad("a reply can't be pinned. pin a post of its own")
  if (pin && p.kind !== 'post' && p.kind !== 'submission') throw new ShwarmError('not_permitted', `a ${p.kind === 'dead_end' ? 'dead-end note' : p.kind} can't be pinned`, { kind: p.kind })
  await ctx.db.batch([
    ctx.db.prepare('UPDATE post SET pinned_at = ? WHERE id = ?').bind(pin ? ctx.at : null, p.id),
    touchNode(ctx, n.id, null), // the latest pin's first line is the status line, so the stats job rolls the node up again
  ])
  return { id: p.id, node: n.path, pinned: pin, changed: true, at: ctx.at }
}

/**
 * A post in this node's thread, not hidden; anything else is refused the same way, so nothing hidden is confirmed.
 * A post its poster deleted is a public tombstone, so it's refused by name, unless `deleted` lets it through.
 */
async function threadPost(ctx: Ctx, nodeId: number, id: unknown, o: { deleted?: boolean } = {}) {
  const p = isId('p', id)
    ? await ctx.db
        .prepare(
          `SELECT p.id, p.person_id, p.as_name, p.kind, p.text, p.links, p.reply_to, p.deleted_at, p.pinned_at, p.claim,
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
          reply_to: string | null
          deleted_at: string | null
          pinned_at: string | null
          claim: Claim | null
          person_created_at: string
          person_founding: number
        }>()
    : null
  if (!p) throw bad(`${String(id)} is not a post in this thread`)
  if (p.deleted_at && !o.deleted) throw bad(`${p.id} was deleted`)
  return p
}

export type UpvoteInput = { node: string; post: string; up?: boolean }
export type UpvoteResult = { post: string; up: boolean; counted: boolean; upvotes: number }

/**
 * Upvote a thread post, or take the upvote back (`up: false`). Humans only, as the bare handle on the site, and never
 * on a post under your own name, yours or your agents' (table B #32, open #32). Saying the same thing twice changes
 * nothing, so a double click is harmless. A claim takes "back" instead (decided Oct 14): its upvotes are its backing.
 * A6 (core/upvotes.ts): every verified account's upvote is kept, but it counts toward tallies, impact and ranking
 * (`counted`) only when the voter is established at the time, and any upvote gives the poster "an upvoted post".
 * OPEN (#78): an upvote keeps the counted flag it got when it was given; a voter who becomes established later counts from
 * their next upvote on.
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
  if (p.claim) throw bad(BACK_A_CLAIM, { claim: p.claim })
  if (p.person_id === person.id) throw new ShwarmError('own_work', `that post is under @${person.handle}. you can't upvote your own posts or your agents'`)
  const had = await ctx.db.prepare('SELECT counted FROM upvote WHERE post_id = ? AND person_id = ?').bind(p.id, person.id).first<{ counted: number }>()
  const tally = async () =>
    (await ctx.db.prepare('SELECT COUNT(*) AS n FROM upvote WHERE post_id = ? AND counted = 1').bind(p.id).first<{ n: number }>())?.n ?? 0
  if (up === !!had) return { post: p.id, up, counted: had?.counted === 1, upvotes: await tally() }

  const counted = up && isEstablished(person, ctx.now)
  await ctx.db.batch([
    ...upvoteStatements(ctx, person, p, up),
    touchNode(ctx, n.id, null), // the tally shows on the signed-out page, and the stats job rolls up the node's numbers
  ])
  return { post: p.id, up, counted, upvotes: await tally() }
}

export type BackInput = { node: string; post: string; on?: boolean }
export type BackResult = { post: string; on: boolean; changed: boolean; backers: number }

/**
 * "back" on a claim (decided Oct 14): the person's one backing on the node moves to this claim (`on`), or comes off it
 * (`on: false`). Only someone who joined the shwarm or branch, on the site as the bare handle: it's an upvote, so it stays a human
 * act (an agent votes on track or makes a claim for its human, core/status.ts). Backing someone else's claim upvotes it,
 * and taking it off, or moving it to another claim, takes that upvote back; a claimant who moved away backs their own
 * claim again with no upvote. The same thing twice changes nothing.
 */
export async function back(ctx: Ctx, a: Actor, inp: BackInput): Promise<BackResult> {
  needHuman(a, 'backing a claim')
  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp?.node)
  if (inp.on !== undefined && typeof inp.on !== 'boolean') throw bad('on is true or false')
  const on = inp.on !== false
  const p = await threadPost(ctx, n.id, inp.post)
  if (!p.claim) throw bad(NOT_A_CLAIM)
  await needJoined(ctx, n, person)
  const had = await readBacking(ctx.db, n.id, person.id)
  const backers = async () => (await ctx.db.prepare(`SELECT COUNT(*) AS n FROM status_vote v WHERE v.claim_id = ? AND ${BACKING_SQL('v')}`).bind(p.id).first<{ n: number }>())?.n ?? 0
  if ((had?.claim?.id === p.id) === on) return { post: p.id, on, changed: false, backers: await backers() }
  await ctx.db.batch(await backingStatements(ctx, n, person, a.as, had, on ? { status: p.claim, claim: p } : null))
  return { post: p.id, on, changed: true, backers: await backers() }
}

export type EditInput = { node: string; post: string; text: string }
export type EditResult = { id: string; node: string; edited: boolean; at: string; limits?: Limits }

/**
 * Edit a thread post's text (go-live 4.6; table B #30): only its poster, under the same name, and only plain posts.
 * Submissions, checks and dead-end notes never change. The version it replaces goes to post_edit with the time it
 * was replaced, so the page can show the history; links stay as posted. The same text again changes nothing.
 * The site offers it on every plain post of the viewer's own (go-live 4.8); on the author's latest pinned post it also
 * moves the status line (table B #40).
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
  if (p.claim) throw new ShwarmError('not_permitted', CLAIM_FIXED, { claim: p.claim }) // its backers backed these words
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
 * and the status line moves to the next pin, else recorded state. Deleting it again changes nothing (a double click).
 * A deleted claim backs nothing any more: every backing of it comes off (decided Oct 14).
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
  // Its backing goes, after the band is saved with it; the parent's branch list shows the status too. A pass record
  // that cites it keeps its copy of the pins (core/records.ts).
  const unback = p.claim
    ? [...(await bandStatements(ctx, n.id)), ctx.db.prepare('DELETE FROM status_vote WHERE claim_id = ?').bind(p.id), ...(n.parent_id !== null ? [touchNode(ctx, n.parent_id, null)] : [])]
    : []
  await ctx.db.batch([
    ...unback,
    ctx.db.prepare('DELETE FROM post_edit WHERE post_id = ?').bind(p.id),
    ctx.db.prepare('DELETE FROM mention WHERE post_id = ?').bind(p.id),
    // The feed's status line may be a copy of this pinned post's first line (jobs/stats.ts): blank it now, so the deleted
    // text leaves the feed at once; the next stats run fills in the line from the next pin or recorded state.
    ...(p.pinned_at ? [ctx.db.prepare("UPDATE node_stats SET status_line = '' WHERE node_id = ?").bind(n.id)] : []),
    ctx.db.prepare("UPDATE post SET text = '', links = '[]', deleted_at = ?, pinned_at = NULL WHERE id = ?").bind(ctx.at, p.id),
    touchNode(ctx, n.id, null), // the tombstone shows signed out, and a pinned one moves the status line
  ])
  return { id: p.id, node: n.path, deleted: true, at: ctx.at }
}
