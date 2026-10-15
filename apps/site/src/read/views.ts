// Everything one node view needs, read in a few rounds of side-by-side queries after the chain: the page (go-live 3.3,
// 3.4; with its pass box, decided Oct 14) and the agent prompt and JSON (3.6).
import type { NodePageData, Me } from '../web/node-page'
import type { AgentView } from '../render/prompt'
import {
  postsOnPage,
  readBuiltOn,
  readChecks,
  readChildren,
  readContributors,
  PEOPLE_SHOWN,
  readJoins,
  readMySeat,
  readMyUpvotes,
  readNodeEdits,
  readPromptPosts,
  readSubmissions,
  readThread,
  readWorkRepo,
  type Chain,
  type Show,
  type Sort,
} from './node'
import { readActivity } from './activity'
import { readMyReports } from '../core/reports'
import { flaggedBy } from '../core/flags'
import { loadStatus } from './status'

export async function loadPageData(
  db: D1Database,
  chain: Chain,
  o: { sort: Sort; show: Show; page: number; url: string; here: string; me: Me; now: number },
): Promise<NodePageData> {
  const n = chain.node
  const mine = o.me?.personId === n.author_id
  const [children, contributors, subs, thread, nodeEdits, activity, joins, status] = await Promise.all([
    readChildren(db, n.id, o.now),
    readContributors(db, n, PEOPLE_SHOWN),
    readSubmissions(db, n.id),
    readThread(db, n, o),
    // Only a shwarm was ever edited: its author's edits until Oct 12, re-pitches before Oct 10. Nobody edits one now
    // (decided Oct 12: once posted, a shwarm's words are fixed); the versions already kept still show.
    n.kind === 'branch' ? Promise.resolve([]) : readNodeEdits(db, n.id, mine),
    readActivity(db, n.id, o.now),
    readJoins(db, n), // the thread's quiet join lines (go-live 8.2)
    // Its status, claims, pass records and history, and the viewer's own backing (decided Oct 14).
    loadStatus(db, n, o.me?.personId ?? null, o.now),
  ])
  // Checks for the old submissions on this page of the thread (history: nothing takes checks since Oct 14).
  const shown = new Set<string>()
  for (const p of postsOnPage(thread)) if (p.kind === 'submission') shown.add(p.id)
  // The viewer's own upvotes on the posts shown, so each ▲ says whether it's theirs.
  const onPage = postsOnPage(thread).map(p => p.id)
  // And whether the viewer joined (said they're working on it): the contributors box lists only the first few.
  // And whether the viewer flagged this node (core/flags.ts), so "flag this shwarm" says so instead.
  const [checks, myUps, mySeat, myReports, myFlag] = await Promise.all([
    readChecks(db, [...shown]),
    o.me ? readMyUpvotes(db, o.me.personId, onPage) : Promise.resolve(new Map<string, boolean>()),
    o.me ? readMySeat(db, n.id, o.me.personId) : Promise.resolve(null), // branches are joined too (decided Oct 12)
    o.me ? readMyReports(db, o.me.personId, onPage) : Promise.resolve(new Set<string>()),
    o.me && o.me.personId !== n.author_id ? flaggedBy(db, o.me.personId, n.id) : Promise.resolve(false),
  ])
  return { chain, branches: children.branches, contributors, subs, checks, thread, myUps, mySeat, joins, myReports, myFlag, nodeEdits, activity, status, sort: o.sort, show: o.show, url: o.url, here: o.here, me: o.me, now: o.now }
}

/** The prompt's and the JSON's data; null when ?before= doesn't name a post in this thread. */
export async function loadAgentView(db: D1Database, chain: Chain, o: { origin: string; before: string | null; now: number }): Promise<AgentView | null> {
  const n = chain.node
  const [children, subs, posts, contributors, status, work] = await Promise.all([
    readChildren(db, n.id, o.now),
    readSubmissions(db, n.id),
    readPromptPosts(db, n, o.before),
    readContributors(db, n),
    loadStatus(db, n, null, o.now), // its status (decided Oct 14)
    readWorkRepo(db, chain), // WHERE THE WORK LIVES (#128)
  ])
  if (!posts) return null
  // Checks on the old failed or superseded submissions (DEAD ENDS, history); what the listed submissions built on.
  const subIds = subs.filter(s => s.status !== 'passed').map(s => s.post_id)
  const listedSubs = [...posts.pinned, ...posts.posts].filter(p => p.kind === 'submission').map(p => p.id)
  const [checks, links] = await Promise.all([readChecks(db, subIds), readBuiltOn(db, listedSubs)])
  const dmsOn = contributors.rows.filter(r => r.dms).map(r => r.handle)
  const v: AgentView = {
    origin: o.origin,
    chain,
    branches: children.branches,
    subs,
    checks,
    posts,
    builtOn: links.builtOn,
    dmsOn,
    contributors,
    status,
    work,
    now: o.now,
  }
  return v
}
