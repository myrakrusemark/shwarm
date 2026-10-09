// Everything one node view needs, read in three rounds of side-by-side queries after the chain:
// the page (go-live 3.3, 3.4) and the agent prompt and JSON (3.6).
import type { NodePageData, Me } from '../web/node-page'
import type { AgentView } from '../render/prompt'
import {
  readBuiltOn,
  readChecks,
  readChildren,
  readContributors,
  readMyUpvotes,
  readPromptPosts,
  readSeats,
  readSubmissions,
  readThread,
  type Chain,
  type Show,
  type Sort,
} from './node'

export async function loadPageData(
  db: D1Database,
  chain: Chain,
  o: { sort: Sort; show: Show; page: number; url: string; here: string; me: Me; now: number },
): Promise<NodePageData> {
  const n = chain.node
  const [children, seats, contributors, subs, thread] = await Promise.all([
    readChildren(db, n.id),
    n.kind === 'branch' ? Promise.resolve(null) : readSeats(db, n.id),
    readContributors(db, n),
    readSubmissions(db, n.id),
    readThread(db, n, o),
  ])
  // Checks for the submissions on this page of the thread, and for the one in review (the head's status line).
  const shown = new Set<string>()
  for (const p of [thread.pinned, ...thread.items, ...thread.items.flatMap(i => i.replies)]) if (p?.kind === 'submission') shown.add(p.id)
  for (const s of subs) if (s.status === 'in_review') shown.add(s.post_id)
  // The viewer's own upvotes on the posts shown, so each ▲ says whether it's theirs.
  const onPage = [thread.pinned, ...thread.pinned?.replies ?? [], ...thread.items, ...thread.items.flatMap(i => i.replies)].flatMap(p => (p ? [p.id] : []))
  const [checks, myUps] = await Promise.all([readChecks(db, [...shown]), o.me ? readMyUpvotes(db, o.me.personId, onPage) : Promise.resolve(new Map<string, boolean>())])
  return { chain, branches: children.branches, variants: children.variants, seats, contributors, subs, checks, thread, myUps, sort: o.sort, show: o.show, url: o.url, here: o.here, me: o.me, now: o.now }
}

/** The prompt's and the JSON's data; null when ?before= doesn't name a post in this thread. */
export async function loadAgentView(db: D1Database, chain: Chain, o: { origin: string; before: string | null; now: number }): Promise<AgentView | null> {
  const n = chain.node
  const [children, seats, subs, posts] = await Promise.all([
    readChildren(db, n.id),
    n.kind === 'branch' ? Promise.resolve(null) : readSeats(db, n.id),
    readSubmissions(db, n.id),
    readPromptPosts(db, n, o.before),
  ])
  if (!posts) return null
  // Checks on the submission in review (STATUS) and on the failed or superseded ones (DEAD ENDS); what the listed submissions built on.
  const subIds = subs.filter(s => s.status !== 'passed').map(s => s.post_id)
  const listedSubs = [posts.pinned, ...posts.posts].filter(p => p?.kind === 'submission').map(p => p!.id)
  const [checks, links] = await Promise.all([readChecks(db, subIds), readBuiltOn(db, listedSubs)])
  return { origin: o.origin, chain, branches: children.branches, seats, subs, checks, posts, builtOn: links.builtOn, now: o.now }
}
