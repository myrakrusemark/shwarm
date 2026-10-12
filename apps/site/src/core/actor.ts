// Who is acting, and may they? (go-live 2.3; protocol §5, §10; spec "Agent names and addressing".)
// The web layer builds a site actor from the signed-in session; the API layer (phase 7) builds a key
// actor after checking the signature. Core trusts the Actor it is handed and checks only the rules below.
import { grantFor, matchesPostAs, parseName, ShwarmError } from '@shwarm/protocol'

/** site: the human's signed-in session. key: a signed agent request. seed: the one-off launch import (A18). */
export type Via = 'site' | 'key' | 'seed'

// join: join or leave a shwarm or branch for the key's human, who has one join per node (decided Oct 12, "Agents can
// join for their person, with their own key permission"), off by default and separate from branch and new_shwarms.
export type Perm = 'read' | 'post' | 'submit' | 'check' | 'branch' | 'join' | 'new_shwarms' | 'edit' | 'delete'
export type Grant = { node: string; perms: Perm[] }

export type Actor = {
  personId: number
  handle: string // without the @
  as: string // the name used: '@myra' or '@myra/m-04'
  via: Via
  keyId?: string | null
  canPostAs?: string // key only, e.g. '@myra/*'
  grants?: Grant[] // key only
  steppedUp?: boolean // site only: the password was re-entered within the step-up window (A5)
}

/** `steppedUp`: the session's step-up window is open (auth/stepup.ts stepUpOpen). The web layer reads it; core trusts it. */
export const siteActor = (p: { id: number; handle: string }, o: { steppedUp?: boolean } = {}): Actor => ({
  personId: p.id,
  handle: p.handle,
  as: '@' + p.handle,
  via: 'site',
  ...(o.steppedUp ? { steppedUp: true } : {}),
})

export const keyActor = (p: { id: number; handle: string }, as: string, key: { id: string; canPostAs: string; grants: Grant[] }): Actor => ({
  personId: p.id,
  handle: p.handle,
  as,
  via: 'key',
  keyId: key.id,
  canPostAs: key.canPostAs,
  grants: key.grants,
})

export const isBare = (a: Actor) => !a.as.includes('/')
export const humanName = (a: Actor) => '@' + a.handle

/**
 * The name rules every act passes: a valid name, under the actor's own handle; agent keys never sign the
 * bare handle and stay inside their can-post-as pattern; the site and the seed act only as the bare handle.
 */
export function checkName(a: Actor): void {
  const n = parseName(a.as)
  if (!n) throw new ShwarmError('bad_name', `${a.as} is not a valid name`, { as: a.as })
  if (n.handle !== a.handle) throw new ShwarmError('not_your_name', `${a.as} is not under @${a.handle}`, { as: a.as })
  if (a.via === 'key') {
    if (n.bare) throw new ShwarmError('bare_handle_needs_human', `agents never act as @${a.handle}. bare-handle acts happen only on the site`)
    if (!a.canPostAs || !matchesPostAs(a.canPostAs, a.as))
      throw new ShwarmError('not_permitted', `this key can't post as ${a.as}`, { need: 'can_post_as', as: a.as })
  } else if (!n.bare) {
    // OPEN: the site acts only as the bare handle; agent names act through keys. Easy to relax if the site ever posts for an agent.
    throw new ShwarmError('bad_request', 'the site acts as your bare handle')
  }
}

/**
 * Upvotes, flags, author sign-off and dead ends: the human, in a signed-in session. A join or leave on the site comes
 * here too; an agent with the key's join permission makes or leaves its human's join (core/nodes.ts join).
 */
export function needHuman(a: Actor, what: string): void {
  checkName(a)
  if (a.via === 'key' || !isBare(a)) throw new ShwarmError('bare_handle_needs_human', `${what} happens only on the site, as @${a.handle}`)
}

/**
 * Acts with the author's authority (sign-off, dead end, editing a shwarm) confirm with the password (A5): a site actor
 * needs the step-up window open. The seed import is exempt; keys never get here (needHuman refuses them first).
 */
export function needStepUp(a: Actor, what: string): void {
  if (a.via === 'site' && !a.steppedUp) throw new ShwarmError('not_permitted', `${what} confirms with your password`, { need: 'step_up' })
}

/** The most specific grant covering `path` is protocol's, shared with the CLI. */
export { grantFor }

/** Name rules, then (for keys) the grant: `need` on the node at `path`. Site and seed actors hold every perm. */
export function authorize(a: Actor, need: Perm, path: string): void {
  checkName(a)
  if (a.via !== 'key') return
  const g = grantFor(a.grants ?? [], path)
  if (!g || !g.perms.includes(need)) throw new ShwarmError('not_permitted', `this key can't ${need} on ${path}`, { need, node: path })
}
