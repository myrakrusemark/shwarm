// A shwarm's or a branch's status (decided Oct 14, "A branch's status: on track by vote, the rest by claims people back,
// with a rubber band", "Only people on a branch vote on its status" and "One model for every node"; Myra: "on track is
// individual votes / blocked requires evidence and shows in the thread / upvotes on that post count as a blocked vote
// with the same evidence", "only joined people should be able to vote", "Yes, one model"): the on-track vote, claims,
// backing, the join gate, what takes backing away, no node taking submissions, checks or a dead end, the reads the page
// and the briefing build on, the API and the site's forms. The band itself is test/status-band.test.ts; pass records
// and the history are test/records.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { closeAccount } from '../src/auth/close'
import { hashPassword } from '../src/auth/password'
import { actOnPost } from '../src/core/admin-content'
import { BACK_A_CLAIM, CLAIM_FIXED, CLAIMS_ARE_POSTS, NO_CHECKS, NO_DEAD_END, NO_SUBMISSIONS, NOT_A_CLAIM, NOT_JOINED } from '../src/core/status'
import { readChain, readChildren, readPosts } from '../src/read/node'
import { loadStatus, readNodeStatus } from '../src/read/status'
import { loadAgentView, loadPageData } from '../src/read/views'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { ALL_PERMS, keyFor, send } from './agent-client'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { agent, DAY, HOUR, person, refused, site, World, type P } from './core-fixtures'
import { addPerson, T0 } from './d1'

const MID = 'minecraft-in-doom'
const BP = 'minecraft-in-doom/block-placement'
const DEEP = 'minecraft-in-doom/block-placement/corners'

let w: World
let myra: P, kestrel: P, lumpy: P, ana: P

const vote = (by: Parameters<World['post']>[0], node: string, status: unknown) => w.run({ type: 'status', actor: by, input: { node, status } })
const claim = (by: Parameters<World['post']>[0], node: string, status: string, text = 'P_CheckSight still answers for the old block after a break.') =>
  w.run({ type: 'post', actor: by, input: { node, text, claim: status } })
const back = (by: Parameters<World['post']>[0], node: string, post: string, on = true) => w.run({ type: 'back', actor: by, input: { node, post, on } })
/** Who backs what on a node: handle, status and the claim backed. */
const backing = (path: string) =>
  w.all(
    'SELECT p.handle, v.status, v.claim_id AS claim, v.as_name FROM status_vote v JOIN person p ON p.id = v.person_id JOIN node n ON n.id = v.node_id WHERE n.path = ? ORDER BY p.handle',
    path,
  )
const ups = (post: string) => w.all('SELECT p.handle FROM upvote u JOIN person p ON p.id = u.person_id WHERE u.post_id = ? ORDER BY p.handle', post).map(r => r.handle)
const band = (path: string) => w.get('SELECT b.* FROM branch_status b JOIN node n ON n.id = b.node_id WHERE n.path = ?', path)
const tally = (o: Partial<Record<'on_track' | 'blocked' | 'passed' | 'dead_end', number>>) => {
  const t = { on_track: 0, blocked: 0, passed: 0, dead_end: 0, ...o }
  return { ...t, people: t.on_track + t.blocked + t.passed + t.dead_end }
}
const at = (h: number) => new Date(T0 + h * HOUR).toISOString()

beforeEach(async () => {
  w = new World()
  myra = await person(w.db, 'myra')
  kestrel = await person(w.db, 'kestrel')
  lumpy = await person(w.db, 'lumpy')
  ana = await person(w.db, 'ana')
  await w.shwarm(site(myra))
  await w.branch(site(myra), MID)
  await w.join(site(kestrel), BP)
  await w.join(site(lumpy), BP)
  w.db.raw.prepare("UPDATE node SET triage = 'clear'").run() // triage cleared them, so everyone reads them
})

describe('only people on a node vote on its status (decided Oct 14)', () => {
  it('the on-track vote, a claim and a back each need a join on the branch, made there or through a sub-branch', async () => {
    const e = await refused(vote(site(ana), BP, 'on_track'), 'not_joined', { node: BP })
    expect(e.message).toBe(NOT_JOINED)
    expect(e.status).toBe(403)
    await refused(claim(site(ana), BP, 'blocked'), 'not_joined')
    const c = await claim(site(kestrel), BP, 'blocked')
    await refused(back(site(ana), BP, c.id), 'not_joined')
    expect(w.get('SELECT COUNT(*) AS n FROM post WHERE person_id = ?', ana.id).n).toBe(0) // the refused claim posted nothing
    // joined through a sub-branch: counted on the branch above, so it counts here
    await w.branch(site(kestrel), BP, { title: 'corners' })
    await w.join(site(ana), DEEP)
    expect(await vote(site(ana), BP, 'on_track')).toMatchObject({ status: 'on_track', changed: true })
    // and an agent only for a human who joined
    await refused(vote(agent(myra, 'claude', ['read', 'post']), BP, 'on_track'), 'not_joined')
  })

  it("on a shwarm: its author, who's down as working on it, and anyone on one of its branches", async () => {
    // myra started the shwarm (her seat came with it); kestrel and lumpy joined its branch, which counts them here too
    expect(await vote(site(myra), MID, 'on_track')).toMatchObject({ node: MID, status: 'on_track', changed: true })
    expect(await vote(site(kestrel), MID, 'on_track')).toMatchObject({ votes: tally({ on_track: 2 }) })
    const c = await claim(site(lumpy), MID, 'blocked', 'nothing builds on gzdoom 4.11 yet.')
    expect(backing(MID)).toEqual([
      { handle: 'kestrel', status: 'on_track', claim: null, as_name: '@kestrel' },
      { handle: 'lumpy', status: 'blocked', claim: c.id, as_name: '@lumpy' },
      { handle: 'myra', status: 'on_track', claim: null, as_name: '@myra' },
    ])
    // ana is on neither
    expect((await refused(vote(site(ana), MID, 'on_track'), 'not_joined', { node: MID })).message).toBe(NOT_JOINED)
    // leaving the branch leaves only the branch: the seat above stays, and so does the backing on the shwarm
    await w.run({ type: 'leave', actor: site(lumpy), input: { node: BP } })
    expect(backing(MID).map(r => r.handle)).toEqual(['kestrel', 'lumpy', 'myra'])
  })

  it('leaving takes the backing back, its upvote with it, and moves the parent', async () => {
    const c = await claim(site(kestrel), BP, 'passed')
    await back(site(lumpy), BP, c.id)
    expect(ups(c.id)).toEqual(['lumpy'])
    const parent = w.node(MID).last_event_id
    w.tick(HOUR)
    expect(await w.run({ type: 'leave', actor: site(lumpy), input: { node: BP } })).toMatchObject({ left: true })
    expect(backing(BP).map(r => r.handle)).toEqual(['kestrel'])
    expect(ups(c.id)).toEqual([])
    expect(w.node(MID).last_event_id).not.toBe(parent)
    expect(band(BP)).toMatchObject({ at: at(1) }) // saved as it stood when lumpy left
    // leaving or joining with nothing backed moves the parent too: its list names who's on each branch
    await w.join(site(ana), BP)
    const joined = w.node(MID).last_event_id
    await w.run({ type: 'leave', actor: site(ana), input: { node: BP } })
    expect(w.node(MID).last_event_id).not.toBe(joined)
    const left = w.node(MID).last_event_id
    await w.join(site(ana), BP)
    expect(w.node(MID).last_event_id).not.toBe(left)
  })
})

describe('the on-track vote', () => {
  it('cast, taken back, the same twice changes nothing; plain and anonymous, with no post', async () => {
    expect(await vote(site(kestrel), BP, 'on_track')).toEqual({ node: BP, as: '@kestrel', person: '@kestrel', status: 'on_track', claim: null, changed: true, votes: tally({ on_track: 1 }) })
    expect(await vote(site(kestrel), BP, 'on_track')).toMatchObject({ changed: false })
    expect(await vote(site(kestrel), BP, null)).toMatchObject({ status: null, changed: true, votes: tally({}) })
    expect(await vote(site(kestrel), BP, null)).toMatchObject({ status: null, changed: false })
    expect(w.get("SELECT COUNT(*) AS n FROM post WHERE node_id = ? AND is_join = 0", w.node(BP).id).n).toBe(0)
  })

  it('blocked, passed and dead end are claims; anything else is refused', async () => {
    for (const s of ['blocked', 'passed', 'dead_end']) expect((await refused(vote(site(kestrel), BP, s), 'bad_request', { field: 'status' })).message).toBe(CLAIMS_ARE_POSTS)
    for (const s of ['stale', 'On_Track', '', 3, undefined]) await refused(vote(site(kestrel), BP, s), 'bad_request', { field: 'status' })
    for (const s of ['blocked', 'stale']) await refused(vote(site(myra), MID, s), 'bad_request', { field: 'status' })
  })

  it("an agent casts or takes back its human's vote with post on the branch; never the bare handle", async () => {
    const claude = agent(kestrel, 'claude', ['read', 'post'])
    expect(await vote(claude, BP, 'on_track')).toMatchObject({ as: '@kestrel/claude', person: '@kestrel', status: 'on_track' })
    expect(backing(BP)).toEqual([{ handle: 'kestrel', status: 'on_track', claim: null, as_name: '@kestrel/claude' }])
    await refused(vote(agent(kestrel, 'reader', ['read']), BP, 'on_track'), 'not_permitted', { need: 'post' })
    await refused(vote({ ...claude, as: '@kestrel' }, BP, 'on_track'), 'bare_handle_needs_human')
    expect(await vote(agent(kestrel, 'codex', ['read', 'post']), BP, null)).toMatchObject({ status: null, changed: true })
  })

  it('casting it moves the backing off a claim; taking it back leaves a claim as it is', async () => {
    const c = await claim(site(kestrel), BP, 'blocked')
    await back(site(lumpy), BP, c.id)
    expect(await vote(site(lumpy), BP, null)).toMatchObject({ status: 'blocked', claim: c.id, changed: false })
    expect(await vote(site(lumpy), BP, 'on_track')).toMatchObject({ status: 'on_track', claim: null, changed: true, votes: tally({ on_track: 1, blocked: 1 }) })
    expect(ups(c.id)).toEqual([]) // the upvote that went with backing it went too
  })

})

describe('claims (decided Oct 14)', () => {
  it('a thread post with the evidence, named as its poster; it moves the claimant\'s backing to it', async () => {
    await vote(site(kestrel), BP, 'on_track')
    const c = await claim(site(kestrel), BP, 'blocked')
    expect(c).toMatchObject({ node: BP, as: '@kestrel', claim: 'blocked' })
    expect(w.get('SELECT kind, claim, text FROM post WHERE id = ?', c.id)).toEqual({ kind: 'post', claim: 'blocked', text: 'P_CheckSight still answers for the old block after a break.' })
    expect(backing(BP)).toEqual([{ handle: 'kestrel', status: 'blocked', claim: c.id, as_name: '@kestrel' }])
    expect(ups(c.id)).toEqual([]) // their own post: no upvote
    // a second claim moves it again
    const d = await claim(site(kestrel), BP, 'passed', 'soak.sh: 10000 placements, 0 failures. log: https://example.org/soak.log')
    expect(backing(BP)).toEqual([{ handle: 'kestrel', status: 'passed', claim: d.id, as_name: '@kestrel' }])
    // a plain post is no claim
    expect((await w.post(site(kestrel), BP, 'just a note')).claim).toBeNull()
  })

  it('an agent makes one for its human, on a shwarm as on a branch; refused with an unknown claim, or with no evidence', async () => {
    const c = await claim(agent(kestrel, 'claude', ['read', 'post']), BP, 'dead_end', 'the engine has no per-face hook.')
    expect(backing(BP)).toEqual([{ handle: 'kestrel', status: 'dead_end', claim: c.id, as_name: '@kestrel/claude' }])
    const d = await claim(agent(kestrel, 'claude', ['read', 'post']), MID, 'passed', 'all nine maps from a pistol start.')
    expect(backing(MID)).toEqual([{ handle: 'kestrel', status: 'passed', claim: d.id, as_name: '@kestrel/claude' }])
    for (const s of ['on_track', 'done', 3]) await refused(claim(site(kestrel), BP, s as string), 'bad_request', { field: 'claim' })
    await refused(claim(site(kestrel), BP, 'passed', '  '), 'bad_request')
  })

  it("can't be edited, isn't upvoted, can be pinned; deleting it takes every backing of it off", async () => {
    const c = await claim(site(kestrel), BP, 'passed')
    expect((await refused(w.run({ type: 'editPost', actor: site(kestrel), input: { node: BP, post: c.id, text: 'changed my mind' } }), 'not_permitted')).message).toBe(CLAIM_FIXED)
    expect((await refused(w.run({ type: 'upvote', actor: site(lumpy), input: { node: BP, post: c.id } }), 'bad_request')).message).toBe(BACK_A_CLAIM)
    expect(await w.run({ type: 'pinPost', actor: site(myra), input: { node: BP, post: c.id, pin: true } })).toMatchObject({ pinned: true })
    await back(site(lumpy), BP, c.id)
    const parent = w.node(MID).last_event_id
    await w.run({ type: 'deletePost', actor: site(kestrel), input: { node: BP, post: c.id } })
    expect(backing(BP)).toEqual([])
    expect(w.node(MID).last_event_id).not.toBe(parent)
  })

  it('hiding one takes every backing of it off', async () => {
    const c = await claim(site(kestrel), BP, 'blocked')
    await back(site(lumpy), BP, c.id)
    await actOnPost(w.db, { personId: myra.id, handle: 'myra' }, c.id, 'hide', { reason: 'spam' }, w.now)
    expect(backing(BP)).toEqual([])
    expect(band(BP)).toMatchObject({ challenger: 'blocked', at: at(0) })
  })
})

describe('back (decided Oct 14)', () => {
  it("backs someone else's claim with an upvote; off takes both; a second claim moves it; twice changes nothing", async () => {
    const c = await claim(site(kestrel), BP, 'blocked')
    expect(await back(site(lumpy), BP, c.id)).toEqual({ post: c.id, on: true, changed: true, backers: 2 })
    expect(await back(site(lumpy), BP, c.id)).toMatchObject({ changed: false, backers: 2 })
    expect(backing(BP)).toEqual([
      { handle: 'kestrel', status: 'blocked', claim: c.id, as_name: '@kestrel' },
      { handle: 'lumpy', status: 'blocked', claim: c.id, as_name: '@lumpy' },
    ])
    expect(ups(c.id)).toEqual(['lumpy'])
    const d = await claim(site(kestrel), BP, 'passed')
    await back(site(lumpy), BP, d.id)
    expect(ups(c.id)).toEqual([])
    expect(ups(d.id)).toEqual(['lumpy'])
    expect(await back(site(lumpy), BP, d.id, false)).toEqual({ post: d.id, on: false, changed: true, backers: 1 })
    expect(ups(d.id)).toEqual([])
    expect(await back(site(lumpy), BP, d.id, false)).toMatchObject({ changed: false })
  })

  it('a claimant who moved away backs their own claim again, with no upvote', async () => {
    const c = await claim(site(kestrel), BP, 'blocked')
    await vote(site(kestrel), BP, 'on_track')
    expect(await back(site(kestrel), BP, c.id)).toMatchObject({ changed: true, backers: 1 })
    expect(ups(c.id)).toEqual([])
  })

  it('only a claim, only a human on the site', async () => {
    const plain = await w.post(site(kestrel), BP, 'a plain post')
    expect((await refused(back(site(lumpy), BP, plain.id), 'bad_request')).message).toBe(NOT_A_CLAIM)
    const c = await claim(site(kestrel), BP, 'blocked')
    await refused(back(agent(lumpy, 'claude', ['read', 'post']), BP, c.id), 'bare_handle_needs_human')
    expect(await back(site(lumpy), BP, c.id)).toMatchObject({ changed: true, backers: 2 })
  })

  it('every change saves the band first and moves the branch and its parent', async () => {
    const before = [w.node(BP).last_event_id, w.node(MID).last_event_id]
    const c = await claim(site(kestrel), BP, 'passed')
    expect(w.node(BP).last_event_id).toBe(c.id)
    expect(w.node(MID).last_event_id).not.toBe(before[1])
    expect(band(BP)).toMatchObject({ current: 'on_track', challenger: null, lead_hours: 0, at: at(0) })
    w.tick(HOUR)
    await back(site(lumpy), BP, c.id)
    // saved with the backing it had until then: passed led by 1, which gathers nothing
    expect(band(BP)).toMatchObject({ current: 'on_track', challenger: 'passed', lead_hours: 0, leading_since: null, at: at(1) })
  })
})

describe('the rubber band through the acts', () => {
  it('two backers of passed over nobody on track: passed after 24 hours, and on track pushes back', async () => {
    const c = await claim(site(kestrel), BP, 'passed')
    await back(site(lumpy), BP, c.id)
    const status = async () => readNodeStatus(w.db, w.node(BP).id, w.now)
    expect(await status()).toMatchObject({ current: 'on_track', backing: tally({ passed: 2 }), challenger: { status: 'passed', lead: 2, changes_at: at(24) } })
    w.tick(23 * HOUR)
    expect((await status()).current).toBe('on_track')
    w.tick(HOUR)
    expect(await status()).toMatchObject({ current: 'passed', changed_at: at(24), challenger: null })
    // on-track votes push back: a challenger leading by 2 starts gathering again
    await w.join(site(ana), BP)
    await w.join(site(myra), BP)
    await vote(site(ana), BP, 'on_track')
    await vote(site(myra), BP, 'on_track')
    await vote(site(lumpy), BP, 'on_track') // lumpy moves: on track 3, passed 1
    expect(await status()).toMatchObject({ current: 'passed', challenger: { status: 'on_track', lead: 2, changes_at: at(48) } })
    w.tick(30 * HOUR)
    expect(await status()).toMatchObject({ current: 'on_track', changed_at: at(48), challenger: { status: 'passed', lead: -2 } })
  })
})

describe('no node takes checks (decided Oct 14: the done test is the sentence alone)', () => {
  it('a new shwarm or branch keeps none: what it is sent is ignored', async () => {
    await w.branch(site(kestrel), MID, { title: 'textures', check: { runs: { command: './soak.sh', count: 2 }, people: 2, author: true } })
    expect(w.node('minecraft-in-doom/textures').checks).toBe('{"author":false}')
    await w.branch(site(lumpy), MID, { title: 'sounds', check: undefined })
    expect(w.node('minecraft-in-doom/sounds').checks).toBe('{"author":false}')
    await w.run({ type: 'createNode', actor: site(kestrel), input: { kind: 'shwarm', title: 'warp travel', what: 'w', doneWhen: 'd', tags: ['x'], check: { people: { count: 2, human: true }, author: true } } })
    expect(w.node('warp-travel').checks).toBe('{"author":false}')
  })
})

describe('the reads the page and the briefing build on', () => {
  it("the parent's list: each branch's status now and the evidence behind it", async () => {
    const c = await claim(site(kestrel), BP, 'blocked', 'waiting on the engine: P_CheckSight caches the old block.')
    const weaker = await claim(site(lumpy), BP, 'blocked', 'stuck too')
    await back(site(lumpy), BP, c.id) // lumpy moves to kestrel's: 2 for it, 0 for lumpy's own
    const list = async () => (await readChildren(w.db, w.node(MID).id, w.now)).branches[0]
    expect(await list()).toMatchObject({ path: BP, votes: tally({ blocked: 2 }), status: { current: 'on_track', challenger: { status: 'blocked', lead: 2 } }, reason: null })
    w.tick(DAY)
    expect(await list()).toMatchObject({ status: { current: 'blocked', changed_at: at(24) }, reason: { post: c.id, text: 'waiting on the engine: P_CheckSight caches the old block.' } })
    expect(weaker.id).not.toBe(c.id)
  })

  it("the branch's claims newest first with their backers, the viewer's own backing, and the posts' claim and backers", async () => {
    const c = await claim(site(kestrel), BP, 'blocked')
    w.tick(60_000)
    const d = await claim(site(lumpy), BP, 'passed', 'all four corners hold.')
    await w.join(site(ana), BP)
    await back(site(ana), BP, d.id)
    const chain = (await readChain(w.db, BP, ana.id))!
    const s = await loadStatus(w.db, chain.node, ana.id, w.now)
    expect(s.claims.map(x => [x.post, x.status, x.by, x.backers, x.pins])).toEqual([
      [d.id, 'passed', '@lumpy', 2, []],
      [c.id, 'blocked', '@kestrel', 1, []],
    ])
    expect(s.myBacking).toEqual({ status: 'passed', claim: { post: d.id, by: '@lumpy' } })
    expect(s.now.backing).toEqual(tally({ blocked: 1, passed: 2 }))
    expect(s.reason).toBeNull() // on track: nothing to say why
    expect(s.passedClaims).toEqual([]) // ana isn't its author, and a branch has no author's mark
    expect((await loadStatus(w.db, chain.node, null, w.now)).myBacking).toBeNull()
    const plain = await w.post(site(kestrel), BP, 'a note')
    const rows = await readPosts(w.db, [c.id, d.id, plain.id])
    expect(Object.fromEntries(rows.map(r => [r.id, [r.claim, r.backers]]))).toEqual({ [c.id]: ['blocked', 1], [d.id]: ['passed', 2], [plain.id]: [null, 0] })
    // the page and the agent view carry it, on the shwarm as on the branch
    const page = await loadPageData(w.db, chain, { sort: 'active', show: 'all', page: 1, url: '', here: '', me: { personId: ana.id, handle: 'ana', verified: true }, now: w.now })
    expect(page.status).toMatchObject({ myBacking: { status: 'passed' }, now: { current: 'on_track' } })
    const view = (await loadAgentView(w.db, chain, { origin: 'https://shwarm.org', before: null, now: w.now })) as any
    expect(view.status.claims).toHaveLength(2)
    expect(view.status.now.backing).toEqual(tally({ blocked: 1, passed: 2 }))
    const shwarm = (await loadAgentView(w.db, (await readChain(w.db, MID, null))!, { origin: '', before: null, now: w.now }))!
    expect(shwarm.status).toMatchObject({ now: { current: 'on_track', backing: tally({}) }, claims: [], records: [], history: [] })
  })

  it('counts no vote a worker from before 0031 writes: one with no claim behind it, or from someone not on the branch', async () => {
    const c = await claim(site(kestrel), BP, 'passed', 'all four corners hold.')
    await back(site(lumpy), BP, c.id)
    // as the Oct 13 code wrote them, between 0031's migrate and its deploy: a blocked vote with no claim, an on-track
    // vote from someone who never joined, and an on-track vote laid over a backing, which kept its claim_id
    const old = w.db.raw.prepare(
      `INSERT INTO status_vote (node_id, person_id, status, as_name, at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (node_id, person_id) DO UPDATE SET status = excluded.status, as_name = excluded.as_name, at = excluded.at`,
    )
    await w.join(site(ana), BP)
    old.run(w.node(BP).id, ana.id, 'blocked', '@ana', at(0))
    old.run(w.node(BP).id, myra.id, 'on_track', '@myra', at(0))
    old.run(w.node(BP).id, lumpy.id, 'on_track', '@lumpy', at(0))
    const chain = (await readChain(w.db, BP, ana.id))!
    const s = await loadStatus(w.db, chain.node, ana.id, w.now)
    expect(s.now.backing).toEqual(tally({ passed: 1 }))
    expect(s.claims.map(x => [x.post, x.backers])).toEqual([[c.id, 1]])
    expect(s.myBacking).toBeNull()
    expect((await loadStatus(w.db, chain.node, lumpy.id, w.now)).myBacking).toBeNull()
    expect((await readPosts(w.db, [c.id]))[0].backers).toBe(1)
    const list = (await readChildren(w.db, w.node(MID).id, w.now)).branches[0]
    expect(list.votes).toEqual(tally({ passed: 1 }))
    // casting a vote of the new kind writes over the stray row, and then it counts
    await vote(site(ana), BP, 'on_track')
    expect((await loadStatus(w.db, chain.node, ana.id, w.now)).now.backing).toEqual(tally({ on_track: 1, passed: 1 }))
  })

  it('closing an account takes its backing away, after saving the band', async () => {
    const c = await claim(site(kestrel), BP, 'blocked')
    await back(site(lumpy), BP, c.id)
    w.tick(5 * HOUR)
    expect(await closeAccount(w.db, lumpy.id, w.now)).toMatchObject({ handle: 'lumpy' })
    expect(backing(BP).map(r => r.handle)).toEqual(['kestrel'])
    expect(band(BP)).toMatchObject({ challenger: 'blocked', lead_hours: 10, at: at(5) })
    expect(ups(c.id)).toEqual(['lumpy']) // the work stays: upvotes are kept (auth/close.ts)
  })
})

describe('the API and the site', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fakeFetch())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    resetReadLimit()
    forgetVersions()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('kind "status" is the on-track vote; a post with claim is a claim; both for a human who joined', async () => {
    const env = testEnv(w.db)
    const key = await keyFor(w.db, kestrel.id, { canPostAs: '@kestrel/*', grants: [{ node: '*', perms: ALL_PERMS }] })
    const anaKey = await keyFor(w.db, ana.id, { canPostAs: '@ana/*', grants: [{ node: '*', perms: ALL_PERMS }] })
    const call = (k: typeof key, b: unknown, path = BP) => send(app, env, k, { path: `/w/${path}`, body: b })
    const r = await call(key, { as: '@kestrel/claude', kind: 'status', status: 'on_track' })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ node: BP, url: `https://shwarm.org/w/${BP}`, as: '@kestrel/claude', person: '@kestrel', status: 'on_track', claim: null, changed: true, votes: tally({ on_track: 1 }) })
    const blocked = await call(key, { as: '@kestrel/claude', kind: 'status', status: 'blocked' })
    expect(blocked.status).toBe(400)
    expect(blocked.json).toMatchObject({ error: 'bad_request', message: CLAIMS_ARE_POSTS, field: 'status' })
    const c = await call(key, { as: '@kestrel/claude', kind: 'post', text: 'soak.sh: 0 failures in 10000.', claim: 'passed' })
    expect(c.status).toBe(201)
    expect(c.json).toMatchObject({ node: BP, as: '@kestrel/claude', claim: 'passed' })
    expect((await call(key, { as: '@kestrel/claude', kind: 'post', text: 'a note' })).json.claim).toBeUndefined()
    const out = await call(anaKey, { as: '@ana/claude', kind: 'status', status: 'on_track' })
    expect(out.status).toBe(403)
    expect(out.json).toMatchObject({ error: 'not_joined', message: NOT_JOINED, node: BP })
    // backing is the human's, on the site
    const up = await call(key, { as: '@kestrel/claude', kind: 'upvote', post: c.json.id })
    expect(up.status).toBe(403)
    expect(up.json.error).toBe('bare_handle_needs_human')
    const back = await call(key, { as: '@kestrel/claude', kind: 'back', post: c.json.id })
    expect(back.status).toBe(403)
    expect(back.json).toMatchObject({ error: 'bare_handle_needs_human', message: 'backing a claim happens only on the site, as @kestrel' })
    // a claim on the shwarm, for a human on one of its branches
    const sc = await call(key, { as: '@kestrel/claude', kind: 'post', text: 'all nine maps from a pistol start.', claim: 'passed' }, MID)
    expect(sc.status).toBe(201)
    expect(sc.json).toMatchObject({ node: MID, claim: 'passed' })
    // no submissions or checks anywhere, in core's words; the stray `check` on a new branch is taken and ignored
    for (const path of [MID, BP]) {
      const sub = await call(key, { as: '@kestrel/claude', kind: 'submission', text: 'x', links: [{ repo: 'https://codeberg.org/k/x', commit: 'a'.repeat(40) }], how_to_check: 'run it' }, path)
      expect(sub.status).toBe(400)
      expect(sub.json).toMatchObject({ error: 'bad_request', message: NO_SUBMISSIONS, node: path })
      const chk = await call(key, { as: '@kestrel/claude', kind: 'check', on: 'p_aaaaaaaaaa', verdict: 'pass', evidence: [] }, path)
      expect(chk.status).toBe(400)
      expect(chk.json).toMatchObject({ error: 'bad_request', message: NO_CHECKS, node: path })
    }
    // the author's passed mark and a dead end are the site's: refused for a key as every bare-handle act is
    const mark = await call(key, { as: '@kestrel/claude', kind: 'mark_passed', post: sc.json.id }, MID)
    expect(mark.status).toBe(403)
    expect(mark.json).toMatchObject({ error: 'bare_handle_needs_human', message: 'marking your shwarm passed happens only on the site, as @kestrel' })
    expect((await call(key, { as: '@kestrel/claude', kind: 'dead_end', note: 'x' }, MID)).status).toBe(400)
    const made = await send(app, env, key, { path: `/w/${MID}/branches`, body: { as: '@kestrel/claude', title: 'textures', what: 'w', done_when: 'd', check: { people: 2 } } })
    expect(made.status).toBe(202)
    expect(w.node('minecraft-in-doom/textures').checks).toBe('{"author":false}')
  })

  async function member(handle: string) {
    const env = testEnv(w.db)
    const id = w.get('SELECT id FROM person WHERE handle = ?', handle)?.id ?? (await addPerson(w.db, handle))
    w.db.raw.prepare('UPDATE person SET password_hash = ?, email_verified_at = ?, founding = 1 WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), new Date(T0).toISOString(), id)
    const b = new Browser(env)
    expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
    return b
  }
  const page = async (b: Browser, path: string) => body(await b.req(`/w/${path}`, { headers: { accept: 'text/html' } }))

  it('do=status toggles the on-track vote, do=claim posts a claim, do=back backs one; refusals say why', async () => {
    const k = await member('kestrel')
    const l = await member('lumpy')
    const a = await member('ana')
    const form = async (b: Browser, f: Record<string, string>) => b.req(`/w/${BP}`, { form: { form_token: formTokenIn(await page(b, BP)), ...f } })
    expect((await form(k, { do: 'status', status: 'on_track' })).status).toBe(303)
    expect(backing(BP)).toMatchObject([{ handle: 'kestrel', status: 'on_track' }])
    await form(k, { do: 'status', status: '' })
    expect(backing(BP)).toEqual([])
    const r = await form(k, { do: 'claim', status: 'blocked', text: 'P_CheckSight caches the old block.' })
    expect(r.status).toBe(303)
    const id = w.get("SELECT id FROM post WHERE claim = 'blocked'").id
    expect(r.headers.get('location')).toBe(`/w/${BP}#${id}`)
    // a double click lands on the first
    expect((await form(k, { do: 'claim', status: 'blocked', text: 'P_CheckSight caches the old block.' })).headers.get('location')).toBe(`/w/${BP}#${id}`)
    expect(w.get("SELECT COUNT(*) AS n FROM post WHERE claim = 'blocked'").n).toBe(1)
    expect((await form(l, { do: 'back', post: id, on: '1' })).headers.get('location')).toBe(`/w/${BP}#${id}`)
    expect(backing(BP).map(x => [x.handle, x.claim])).toEqual([['kestrel', id], ['lumpy', id]])
    await form(l, { do: 'back', post: id, on: '0' })
    expect(backing(BP).map(x => x.handle)).toEqual(['kestrel'])
    // not joined: the words; an empty claim keeps its form
    const refusedPage = await form(a, { do: 'back', post: id, on: '1' })
    expect(refusedPage.status).toBe(400)
    expect(await body(refusedPage)).toContain(`${NOT_JOINED}.`)
    const empty = await form(k, { do: 'claim', status: 'passed', text: '  ' })
    expect(empty.status).toBe(400)
    // an upvote on a claim points at back
    expect(await body(await form(l, { do: 'upvote', post: id, up: '1' }))).toContain(`${BACK_A_CLAIM}.`)
  })

  it('old forms for a submission, a check, a sign-off or a dead end are refused with why', async () => {
    const m = await member('myra')
    const token = formTokenIn(await page(m, MID))
    const old = async (path: string, f: Record<string, string>) => m.req(`/w/${path}`, { form: { form_token: token, ...f } })
    const sub = await old(MID, { do: 'submit', text: 'my fix', links: 'https://codeberg.org/m/x ' + 'a'.repeat(40), how_to_check: 'run it' })
    expect(sub.status).toBe(400)
    expect(await body(sub)).toContain(`${NO_SUBMISSIONS}.`)
    const dead = await old(MID, { do: 'dead_end', note: 'the engine cannot do it', password: GOOD_PASSWORD })
    expect(dead.status).toBe(400)
    expect(await body(dead)).toContain(`${NO_DEAD_END}.`)
    // an old submission page's check or sign-off
    const n = w.node(MID)
    w.db.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_oldsub0001', ?, ?, '@kestrel', 'submission', 'old work', ?)").run(n.id, kestrel.id, at(0))
    w.db.raw.prepare("INSERT INTO submission (post_id, node_id, number, hash, how_to_check, status) VALUES ('p_oldsub0001', ?, 1, ?, 'run it', 'superseded')").run(n.id, 'a'.repeat(64))
    for (const act of ['check', 'signoff']) {
      const r = await old(`${MID}/s/1`, { do: act, verdict: 'pass', text: 'played it', password: GOOD_PASSWORD })
      expect(r.status).toBe(400)
      expect(await body(r)).toContain(`${NO_CHECKS}.`)
    }
    expect(w.get('SELECT COUNT(*) AS n FROM check_report').n).toBe(0)
    expect(w.node(MID)).toMatchObject({ state: 'live', in_review: 0 })
  })
})
