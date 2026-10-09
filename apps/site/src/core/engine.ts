// The tree engine: runs one shwarm tree's commands one at a time and commits each as one D1 batch.
// D1 has no interactive transactions, so every command reads, decides, then writes in a single batch;
// running them one at a time per tree is what keeps the last seat, the final check and racing
// submissions from producing double results. The ShwarmTree Durable Object wraps one engine per tree.
import { ShwarmError } from '@shwarm/protocol'
import type { Actor } from './actor'
import { check, type CheckInput } from './checking'
import { ctxAt, rootOf } from './context'
import { createNode, deadEnd, join, leave, reopen, repitch, type CreateNodeInput, type RepitchInput } from './nodes'
import { deletePost, editPost, post, submit, upvote, type DeleteInput, type EditInput, type PostInput, type SubmitInput, type UpvoteInput } from './posts'

export type Command =
  | { type: 'createNode'; actor: Actor; input: CreateNodeInput }
  | { type: 'join'; actor: Actor; input: { node: string } }
  | { type: 'leave'; actor: Actor; input: { node: string } }
  | { type: 'post'; actor: Actor; input: PostInput }
  | { type: 'editPost'; actor: Actor; input: EditInput }
  | { type: 'deletePost'; actor: Actor; input: DeleteInput }
  | { type: 'upvote'; actor: Actor; input: UpvoteInput }
  | { type: 'submit'; actor: Actor; input: SubmitInput }
  | { type: 'check'; actor: Actor; input: CheckInput }
  | { type: 'deadEnd'; actor: Actor; input: { node: string; note: string } }
  | { type: 'reopen'; actor: Actor; input: { node: string } }
  | { type: 'repitch'; actor: Actor; input: RepitchInput }

/** New top-level shwarms and variants share one tree name, so their slugs (and the daily limit) are decided one at a time. */
export const NEW_TREE = ':new'

/** Which tree runs a command: the root shwarm of the node it touches (idFromName of that path). */
export function treeName(cmd: Command): string {
  if (cmd.type === 'createNode') {
    if (cmd.input?.kind === 'branch') return rootOf(String(cmd.input.parent))
    return NEW_TREE
  }
  return rootOf(String(cmd.input?.node))
}

export class TreeEngine {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    readonly db: D1Database,
    readonly clock: () => number = Date.now,
  ) {}

  /** Queue a command behind the ones already running; resolves with its result or rejects with its ShwarmError. */
  run(cmd: Command): Promise<unknown> {
    const p = this.tail.then(() => this.exec(cmd))
    this.tail = p.catch(() => undefined)
    return p
  }

  /** Run a command now, without waiting its turn. Only for tests that show why the queue exists. */
  async exec(cmd: Command): Promise<unknown> {
    if (!cmd || typeof cmd !== 'object' || !cmd.actor || typeof cmd.actor !== 'object' || !cmd.input || typeof cmd.input !== 'object')
      throw new ShwarmError('bad_request', 'not a command')
    const ctx = ctxAt(this.db, this.clock())
    switch (cmd.type) {
      case 'createNode':
        return createNode(ctx, cmd.actor, cmd.input)
      case 'join':
        return join(ctx, cmd.actor, cmd.input)
      case 'leave':
        return leave(ctx, cmd.actor, cmd.input)
      case 'post':
        return post(ctx, cmd.actor, cmd.input)
      case 'editPost':
        return editPost(ctx, cmd.actor, cmd.input)
      case 'deletePost':
        return deletePost(ctx, cmd.actor, cmd.input)
      case 'upvote':
        return upvote(ctx, cmd.actor, cmd.input)
      case 'submit':
        return submit(ctx, cmd.actor, cmd.input)
      case 'check':
        return check(ctx, cmd.actor, cmd.input)
      case 'deadEnd':
        return deadEnd(ctx, cmd.actor, cmd.input)
      case 'reopen':
        return reopen(ctx, cmd.actor, cmd.input)
      case 'repitch':
        return repitch(ctx, cmd.actor, cmd.input)
      default:
        throw new ShwarmError('bad_request', `unknown command ${String((cmd as { type?: unknown }).type)}`)
    }
  }
}
