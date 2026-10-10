// Everything one node view needs, read in three rounds of side-by-side queries after the chain:
// the page (go-live 3.3, 3.4), a closed shwarm's result page (5.7) and the agent prompt and JSON (3.6).
import type { NodePageData, Me } from '../web/node-page'
import type { ResultPageData } from '../web/result-page'
import type { AgentView } from '../render/prompt'
import {
  readBuiltOn,
  readChecks,
  readChildren,
  readContributors,
  readMySeat,
  readMyUpvotes,
  readNodeEdits,
  readPromptPosts,
  readSubmissions,
  readThread,
  type Chain,
  type Show,
  type Sort,
} from './node'
import { editLock } from '../core/nodes'
import { readActivity } from './activity'
import { readLog } from './log'
import { readBuiltOnThis, readCredits, readResult } from './result'
import { readMyReports } from '../core/reports'

export async function loadPageData(
  db: D1Database,
  chain: Chain,
  o: { sort: Sort; show: Show; page: number; url: string; here: string; me: Me; now: number },
): Promise<NodePageData> {
  const n = chain.node
  const mine = o.me?.personId === n.author_id
  const [children, contributors, subs, thread, nodeEdits, activity, editable] = await Promise.all([
    readChildren(db, n.id),
    readContributors(db, n),
    readSubmissions(db, n.id),
    readThread(db, n, o),
    n.kind === 'branch' ? Promise.resolve([]) : readNodeEdits(db, n.id, mine), // only a shwarm is edited
    readActivity(db, n.id, o.now),
    // Whether its author may still edit it (the "edit" link): nobody else joined and nothing was submitted (core/nodes.ts editLock).
    mine && o.me?.verified && n.kind !== 'branch' ? editLock(db, n).then(e => !e) : Promise.resolve(false),
  ])
  // Checks for the submissions on this page of the thread, and for the one in review (the head's status line).
  const shown = new Set<string>()
  for (const p of [thread.pinned, ...thread.items, ...thread.items.flatMap(i => i.replies)]) if (p?.kind === 'submission') shown.add(p.id)
  for (const s of subs) if (s.status === 'in_review') shown.add(s.post_id)
  // A passed branch's "proof it's done" (web/node-page.tsx Proof): the checks on what passed it.
  const passed = n.state === 'closed' ? subs.find(s => s.status === 'passed') : undefined
  if (passed) shown.add(passed.post_id)
  // The viewer's own upvotes on the posts shown, so each ▲ says whether it's theirs.
  const onPage = [thread.pinned, ...thread.pinned?.replies ?? [], ...thread.items, ...thread.items.flatMap(i => i.replies)].flatMap(p => (p ? [p.id] : []))
  // And whether the viewer joined (said they're working on it): the contributors box lists only the first few.
  const [checks, myUps, mySeat, myReports] = await Promise.all([
    readChecks(db, [...shown]),
    o.me ? readMyUpvotes(db, o.me.personId, onPage) : Promise.resolve(new Map<string, boolean>()),
    o.me && n.kind !== 'branch' ? readMySeat(db, n.id, o.me.personId) : Promise.resolve(null),
    o.me ? readMyReports(db, o.me.personId, onPage) : Promise.resolve(new Set<string>()),
  ])
  return { chain, branches: children.branches, contributors, subs, checks, thread, myUps, mySeat, myReports, nodeEdits, editable, activity, sort: o.sort, show: o.show, url: o.url, here: o.here, me: o.me, now: o.now }
}

/** The prompt's and the JSON's data; null when ?before= doesn't name a post in this thread. */
export async function loadAgentView(db: D1Database, chain: Chain, o: { origin: string; before: string | null; now: number }): Promise<AgentView | null> {
  const n = chain.node
  const [children, subs, posts, contributors] = await Promise.all([
    readChildren(db, n.id),
    readSubmissions(db, n.id),
    readPromptPosts(db, n, o.before),
    readContributors(db, n),
  ])
  if (!posts) return null
  // Checks on the submission in review (STATUS) and on the failed or superseded ones (DEAD ENDS); what the listed submissions built on.
  const subIds = subs.filter(s => s.status !== 'passed').map(s => s.post_id)
  const listedSubs = [posts.pinned, ...posts.posts].filter(p => p?.kind === 'submission').map(p => p!.id)
  const [checks, links] = await Promise.all([readChecks(db, subIds), readBuiltOn(db, listedSubs)])
  const dmsOn = contributors.rows.filter(r => r.dms).map(r => r.handle)
  return { origin: o.origin, chain, branches: children.branches, subs, checks, posts, builtOn: links.builtOn, dmsOn, now: o.now }
}

/** How many key events the result page's log box lists, newest ones, oldest first. OPEN: not decided; 20. */
export const RESULT_LOG_ROWS = 20

/**
 * A closed shwarm's result page (go-live 5.7): the pass, who made it, what's built on it, the newest key events. Null
 * when it has no result to show (see readResult), so the page falls back to the live template.
 */
export async function loadResultData(db: D1Database, chain: Chain, o: { me: Me; now: number }): Promise<ResultPageData | null> {
  const n = chain.node
  const [result, builtOnThis, log] = await Promise.all([
    readResult(db, n),
    readBuiltOnThis(db, n.path, n.done_when),
    readLog(db, chain, { filter: 'key', before: null, limit: RESULT_LOG_ROWS }),
  ])
  if (!result) return null
  const credits = await readCredits(db, chain, result)
  return { chain, result, credits, builtOnThis, log: log ?? { rows: [], total: 0, all: 0, next: null }, me: o.me, now: o.now }
}
