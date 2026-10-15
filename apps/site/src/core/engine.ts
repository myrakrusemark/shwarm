// The tree engine: runs one shwarm tree's commands one at a time and commits each as one D1 batch.
// D1 has no interactive transactions, so every command reads, decides, then writes in a single batch;
// running them one at a time per tree is what keeps racing joins, backs and pass records from producing double
// results. The ShwarmTree Durable Object wraps one engine per tree.
import { ShwarmError } from '@shwarm/protocol'
import type { Actor } from './actor'
import { ctxAt, rootOf } from './context'
import { createNode, editNode, join, leave, type CreateNodeInput, type EditNodeInput, type JoinInput } from './nodes'
import { back, deletePost, editPost, pinPost, post, upvote, type BackInput, type DeleteInput, type EditInput, type PinInput, type PostInput, type UpvoteInput } from './posts'
import { markPassed, type MarkInput } from './records'
import { voteStatus, type StatusInput } from './status'

export type Command =
  | { type: 'createNode'; actor: Actor; input: CreateNodeInput }
  | { type: 'join'; actor: Actor; input: JoinInput } // a shwarm or a branch; `hello` on the site only (core/nodes.ts)
  | { type: 'leave'; actor: Actor; input: { node: string } }
  | { type: 'post'; actor: Actor; input: PostInput }
  | { type: 'editPost'; actor: Actor; input: EditInput }
  | { type: 'deletePost'; actor: Actor; input: DeleteInput }
  | { type: 'pinPost'; actor: Actor; input: PinInput }
  | { type: 'upvote'; actor: Actor; input: UpvoteInput }
  | { type: 'back'; actor: Actor; input: BackInput } // back a claim, or take it off (core/posts.ts back)
  | { type: 'status'; actor: Actor; input: StatusInput } // a person's on-track vote (core/status.ts)
  | { type: 'markPassed'; actor: Actor; input: MarkInput } // a shwarm's author marks it passed (core/records.ts)
  | { type: 'editNode'; actor: Actor; input: EditNodeInput } // the operator's seed card fixes only (seed/edit.ts); no user edits a shwarm's words (decided Oct 12)

/** New top-level shwarms share one tree name, so their slugs (and the daily limit) are decided one at a time. */
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
    readonly o: { beta?: boolean } = {}, // the site is in beta: only invited accounts act (core/site-mode.ts)
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
    const ctx = ctxAt(this.db, this.clock(), this.o)
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
      case 'pinPost':
        return pinPost(ctx, cmd.actor, cmd.input)
      case 'upvote':
        return upvote(ctx, cmd.actor, cmd.input)
      case 'back':
        return back(ctx, cmd.actor, cmd.input)
      case 'status':
        return voteStatus(ctx, cmd.actor, cmd.input)
      case 'markPassed':
        return markPassed(ctx, cmd.actor, cmd.input)
      case 'editNode':
        return editNode(ctx, cmd.actor, cmd.input)
      default:
        throw new ShwarmError('bad_request', `unknown command ${String((cmd as { type?: unknown }).type)}`)
    }
  }
}
