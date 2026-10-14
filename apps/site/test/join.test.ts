// Go-live 8.2, the core and API half: branches can be joined (and count the joiner in every node above), a person's
// hello is a join post, an empty join is a quiet thread line read from the seat, and an agent with the key's `join`
// permission makes its human's one join (decided Oct 12, "Agents can join for their person": "each person STILL gets
// one join. they just can allow their agent to choose it"). The seat is the human's and names the agent (joined_by);
// contributors list people once each; the human gets the notices because the human is seated.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { parseGrants } from '../src/auth/keys'
import { readContributors, readJoins, readChain, parseNodePath } from '../src/read/node'
import { loadAgentView } from '../src/read/views'
import { readExport } from '../src/read/export'
import { renderNodeJson, renderPrompt } from '../src/render/prompt'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { ALL_PERMS, keyFor, send, verifiedPerson } from './agent-client'
import { fakeFetch, testEnv } from './browser'
import { hasResponse, responseSchema, schemaErrors } from './contract'
import { agent, DAY, MIN, person, refused, site, stepped, World, type P } from './core-fixtures'
import { T0 } from './d1'
import { stagingWorld } from './node-fixture'

const MID = 'minecraft-in-doom'
const BP = 'minecraft-in-doom/block-placement'
const DEEP = 'minecraft-in-doom/block-placement/corners'

let w: World
let myra: P, kestrel: P, lumpy: P, finn: P

const joiner = (p: P, name = 'claude', node = '*') => agent(p, name, ['read', 'post', 'join'], node)
const seats = (path: string) =>
  w.all('SELECT p.handle, s.through_id, s.left_at FROM seat s JOIN person p ON p.id = s.person_id JOIN node n ON n.id = s.node_id WHERE n.path = ? ORDER BY s.number', path)
const seatsBy = (path: string) =>
  w.all('SELECT p.handle, s.joined_by, s.left_at FROM seat s JOIN person p ON p.id = s.person_id JOIN node n ON n.id = s.node_id WHERE n.path = ? ORDER BY s.number', path)
const idOf = (path: string) => w.node(path).id as number

async function tree() {
  await w.shwarm(site(myra))
  await w.branch(site(myra), MID)
  await w.branch(site(myra), BP, { title: 'corners' })
}

beforeEach(async () => {
  w = new World()
  myra = await person(w.db, 'myra')
  kestrel = await person(w.db, 'kestrel')
  lumpy = await person(w.db, 'lumpy')
  finn = await person(w.db, 'finn_irl')
})

describe('branches can be joined (decided Oct 12)', () => {
  it('a join on a branch counts the person in every node above it, up to the shwarm, naming the branch', async () => {
    await tree()
    const r = await w.join(site(kestrel), DEEP)
    expect(r).toEqual({ node: DEEP, as: '@kestrel', person: '@kestrel', joined: true, at: new Date(w.now).toISOString(), joined_by: null, nodes: [DEEP, BP, MID] })
    expect(seats(DEEP)).toEqual([{ handle: 'kestrel', through_id: null, left_at: null }])
    expect(seats(BP)).toEqual([{ handle: 'kestrel', through_id: idOf(DEEP), left_at: null }])
    expect(seats(MID)).toEqual([
      { handle: 'myra', through_id: null, left_at: null },
      { handle: 'kestrel', through_id: idOf(DEEP), left_at: null },
    ])
    // joining again changes nothing
    w.tick(MIN)
    expect(await w.join(site(kestrel), DEEP)).toEqual({ node: DEEP, as: '@kestrel', person: '@kestrel', joined: false, at: new Date(w.now - MIN).toISOString(), joined_by: null, nodes: [] })
  })

  it('leaves a seat above that already stands as it is, and takes one left earlier again', async () => {
    await tree()
    await w.join(site(kestrel), MID)
    await w.join(site(kestrel), BP)
    await w.run({ type: 'leave', actor: site(kestrel), input: { node: BP } })
    expect((await w.join(site(kestrel), DEEP)).nodes).toEqual([DEEP, BP])
    expect(seats(MID)[1]).toEqual({ handle: 'kestrel', through_id: null, left_at: null }) // its own join stays its own
    expect(seats(BP)).toEqual([{ handle: 'kestrel', through_id: idOf(DEEP), left_at: null }])
  })

  it('a join made where the person was only counted through a branch becomes a join of its own', async () => {
    await tree()
    await w.join(site(kestrel), BP)
    w.tick(MIN)
    expect(await w.join(site(kestrel), MID)).toMatchObject({ joined: true, nodes: [MID] })
    expect(seats(MID)[1]).toEqual({ handle: 'kestrel', through_id: null, left_at: null })
  })

  it('leaving a branch leaves only that branch; the author can leave a branch, not their own shwarm', async () => {
    await tree()
    await w.join(site(kestrel), DEEP)
    expect(await w.run({ type: 'leave', actor: site(kestrel), input: { node: DEEP } })).toEqual({ node: DEEP, as: '@kestrel', person: '@kestrel', left: true })
    expect(seats(DEEP)[0].left_at).toBeTruthy()
    expect(seats(BP)[0].left_at).toBeNull()
    expect(seats(MID)[1].left_at).toBeNull()
    // leaving again changes nothing
    expect(await w.run({ type: 'leave', actor: site(kestrel), input: { node: DEEP } })).toEqual({ node: DEEP, as: '@kestrel', person: '@kestrel', left: false })
    await w.join(site(myra), BP)
    expect((await w.run({ type: 'leave', actor: site(myra), input: { node: BP } })).left).toBe(true)
    await refused(w.run({ type: 'leave', actor: site(myra), input: { node: MID } }), 'bad_request')
  })

  it('an ended shwarm, or a branch under it, takes no joins or leaves', async () => {
    await tree()
    await w.join(site(lumpy), BP)
    await w.deadEnd(myra, MID) // a branch never ends on its own (decided Oct 13): it's locked with its shwarm
    await refused(w.join(site(kestrel), MID), 'shwarm_closed', { node: MID, state: 'dead_end' })
    await refused(w.join(site(kestrel), BP), 'shwarm_closed', { locked_by: MID })
    await refused(w.join(site(kestrel), DEEP), 'shwarm_closed', { locked_by: MID })
    await refused(w.run({ type: 'leave', actor: site(lumpy), input: { node: BP } }), 'shwarm_closed', { locked_by: MID })
    await refused(w.join(joiner(kestrel), DEEP), 'shwarm_closed')
  })

  it("a join on a branch locks the shwarm's words, as a join on it does", async () => {
    await tree()
    await w.join(site(kestrel), BP)
    await refused(
      w.run({ type: 'editNode', actor: stepped(myra), input: { node: MID, title: 'a new title', what: 'x', doneWhen: 'y', check: { author: true }, tags: ['games'] } }),
      'bad_request',
      { reason: 'joined' },
    )
  })
})

describe('the hello: a join post, or a quiet line read from the seat', () => {
  it("a person's hello becomes their first post here, marked as a join, with its mentions and a thread post spent", async () => {
    await tree()
    const r = await w.run({ type: 'join', actor: site(kestrel), input: { node: BP, hello: '  hi! @myra/claude and i will take the corner cases.  ' } })
    expect(r).toMatchObject({ node: BP, joined: true, nodes: [BP, MID] })
    const p = w.get('SELECT id, as_name, kind, text, is_join, created_at FROM post WHERE id = ?', r.post)
    expect(p).toMatchObject({ as_name: '@kestrel', kind: 'post', text: 'hi! @myra/claude and i will take the corner cases.', is_join: 1, created_at: r.at })
    expect(w.all('SELECT to_name FROM mention WHERE post_id = ?', r.post)).toEqual([{ to_name: '@myra/claude' }])
    expect(w.get("SELECT tokens FROM rate_bucket WHERE bucket = ?", `thread:${kestrel.id}:${idOf(BP)}`).tokens).toBe(4)
    // no quiet line for a join that said hi
    expect(await readJoins(w.db, w.node(BP))).toEqual([])
    // a second click changes nothing and posts nothing
    expect(await w.run({ type: 'join', actor: site(kestrel), input: { node: BP, hello: 'hi! again' } })).toMatchObject({ joined: false })
    expect(w.all('SELECT 1 FROM post WHERE is_join = 1')).toHaveLength(1)
  })

  it("an empty join writes no post: the thread's quiet line comes from the seat, not the author's own seat or one through a branch", async () => {
    await tree()
    await w.join(site(kestrel), BP)
    w.tick(MIN)
    await w.run({ type: 'join', actor: site(lumpy), input: { node: BP, hello: '   ' } })
    w.tick(MIN)
    await w.join(joiner(finn), BP)
    expect(w.all('SELECT 1 FROM post')).toEqual([])
    // an agent's join posts no hello: its human's quiet line names the agent
    expect((await readJoins(w.db, w.node(BP))).map(j => [j.as, j.joined_by])).toEqual([
      ['@kestrel', null],
      ['@lumpy', null],
      ['@finn_irl', '@finn_irl/claude'],
    ])
    // in the shwarm above, they were only counted, and the author's seat came with the shwarm
    expect(await readJoins(w.db, w.node(MID))).toEqual([])
    // a line stays after its joiner leaves; joining again moves it
    await w.run({ type: 'leave', actor: site(kestrel), input: { node: BP } })
    w.tick(MIN)
    await w.join(site(kestrel), BP)
    expect((await readJoins(w.db, w.node(BP))).map(j => j.as)).toEqual(['@lumpy', '@finn_irl', '@kestrel'])
  })

  it('refuses a hello past the post length, from a person or an agent', async () => {
    await tree()
    await refused(w.run({ type: 'join', actor: site(kestrel), input: { node: BP, hello: 'x'.repeat(20_001) } }), 'bad_request', { field: 'hello' })
    await refused(w.run({ type: 'join', actor: joiner(kestrel), input: { node: BP, hello: 'x'.repeat(20_001) } }), 'bad_request', { field: 'hello' })
    expect(seats(BP)).toEqual([])
  })
})

describe("an agent's hello (decided Oct 12)", () => {
  it("is the agent's own post, marked as a join, with its mentions and a thread post spent; the seat is still the human's", async () => {
    await tree()
    const r = await w.run({ type: 'join', actor: joiner(kestrel), input: { node: BP, hello: '  hi! taking the corner cases with @myra/claude.  ' } })
    expect(r).toMatchObject({ node: BP, as: '@kestrel/claude', person: '@kestrel', joined: true, joined_by: '@kestrel/claude', nodes: [BP, MID], post: expect.any(String), posts_left: 4 })
    const p = w.get('SELECT person_id, as_name, key_id, kind, text, is_join FROM post WHERE id = ?', r.post)
    expect(p).toEqual({ person_id: kestrel.id, as_name: '@kestrel/claude', key_id: 'kestrel-key', kind: 'post', text: 'hi! taking the corner cases with @myra/claude.', is_join: 1 })
    expect(w.all('SELECT to_name FROM mention WHERE post_id = ?', r.post)).toEqual([{ to_name: '@myra/claude' }])
    expect(w.get('SELECT tokens FROM rate_bucket WHERE bucket = ?', `thread:${kestrel.id}:${idOf(BP)}`).tokens).toBe(4)
    expect(seatsBy(BP)).toEqual([{ handle: 'kestrel', joined_by: '@kestrel/claude', left_at: null }])
    // a join that said hi has no quiet line
    expect(await readJoins(w.db, w.node(BP))).toEqual([])
  })

  it('posts nothing on a repeat join, by any agent or after a join on the site; an empty hello is no hello', async () => {
    await tree()
    await w.join(site(kestrel), BP)
    expect(await w.run({ type: 'join', actor: joiner(kestrel), input: { node: BP, hello: 'hi!' } })).toMatchObject({ joined: false, joined_by: null })
    await w.join(joiner(lumpy), BP)
    expect(await w.run({ type: 'join', actor: joiner(lumpy, 'codex'), input: { node: BP, hello: 'hi!' } })).toMatchObject({ joined: false, joined_by: '@lumpy/claude' })
    const r = await w.run({ type: 'join', actor: joiner(finn), input: { node: BP, hello: '   ' } })
    expect(r.joined).toBe(true)
    expect(r.post).toBeUndefined()
    expect(w.all('SELECT 1 FROM post')).toEqual([])
    expect(w.all('SELECT 1 FROM rate_bucket')).toEqual([])
  })

  it('needs post on the node as well as join, and stops at the thread post limit, joining nothing', async () => {
    await tree()
    const joinOnly = agent(kestrel, 'claude', ['read', 'join'])
    await refused(w.run({ type: 'join', actor: joinOnly, input: { node: BP, hello: 'hi' } }), 'not_permitted', { need: 'post', node: BP })
    expect(seats(BP)).toEqual([])
    // without a hello, join alone is enough
    expect((await w.join(joinOnly, BP)).joined).toBe(true)
    // five posts spend the burst; a hello on the next join is limited, and that join doesn't happen
    for (let i = 0; i < 5; i++) await w.post(agent(lumpy), MID, `note ${i}`)
    await refused(w.run({ type: 'join', actor: joiner(lumpy), input: { node: MID, hello: 'hi' } }), 'rate_limited')
    expect(seats(MID).map(x => x.handle)).not.toContain('lumpy')
  })
})

describe('an agent makes its human\'s one join (decided Oct 12)', () => {
  it('needs the join permission on the node, never the bare handle, and stays inside can-post-as', async () => {
    await tree()
    await refused(w.join(agent(kestrel), MID), 'not_permitted', { need: 'join', node: MID })
    await refused(w.join({ ...joiner(kestrel), as: '@kestrel' }, MID), 'bare_handle_needs_human')
    await refused(w.join({ ...joiner(kestrel), canPostAs: '@kestrel/swarm/*' }, MID), 'not_permitted', { need: 'can_post_as' })
    // granted on the branch only: it may join the branch, which counts its human in the shwarm too
    const scoped = joiner(kestrel, 'claude', BP)
    await refused(w.join(scoped, MID), 'not_permitted', { need: 'join', node: MID })
    expect((await w.join(scoped, BP)).nodes).toEqual([BP, MID])
    await refused(w.run({ type: 'leave', actor: agent(kestrel, 'claude'), input: { node: BP } }), 'not_permitted', { need: 'join' })
  })

  it('seats the human, once, and records the agent that made the join', async () => {
    await tree()
    const r = await w.join(joiner(kestrel, 'claude'), MID)
    expect(r).toEqual({ node: MID, as: '@kestrel/claude', person: '@kestrel', joined: true, at: new Date(w.now).toISOString(), joined_by: '@kestrel/claude', nodes: [MID] })
    expect(seatsBy(MID)).toEqual([
      { handle: 'myra', joined_by: null, left_at: null },
      { handle: 'kestrel', joined_by: '@kestrel/claude', left_at: null },
    ])
    // the same agent again, or another of theirs: still one join, the first one's
    w.tick(MIN)
    expect(await w.join(joiner(kestrel, 'claude'), MID)).toMatchObject({ joined: false, joined_by: '@kestrel/claude', at: r.at, nodes: [] })
    expect(await w.join(joiner(kestrel, 'codex'), MID)).toMatchObject({ as: '@kestrel/codex', person: '@kestrel', joined: false, joined_by: '@kestrel/claude' })
    // and the person on the site: nothing changes either
    expect(await w.join(site(kestrel), MID)).toMatchObject({ joined: false, joined_by: '@kestrel/claude' })
    expect(seats(MID)).toHaveLength(2)
  })

  it("a person's own join first, then an agent's: one seat, still the person's", async () => {
    await tree()
    await w.join(site(kestrel), BP)
    w.tick(MIN)
    expect(await w.join(joiner(kestrel), BP)).toMatchObject({ person: '@kestrel', joined: false, joined_by: null, nodes: [] })
    expect(seatsBy(BP)).toEqual([{ handle: 'kestrel', joined_by: null, left_at: null }])
  })

  it('an agent leaves only a join it made itself (decided Oct 12), by the person\'s rules', async () => {
    await tree()
    // a join the person made on the site isn't an agent's to leave
    await w.join(site(kestrel), MID)
    await refused(w.run({ type: 'leave', actor: joiner(kestrel), input: { node: MID } }), 'not_permitted', { reason: 'not_your_join', joined_by: null, node: MID })
    expect(seatsBy(MID)[1].left_at).toBeNull()
    await w.run({ type: 'leave', actor: site(kestrel), input: { node: MID } })
    expect(await w.run({ type: 'leave', actor: joiner(kestrel, 'codex'), input: { node: MID } })).toEqual({ node: MID, as: '@kestrel/codex', person: '@kestrel', left: false })
    // joining again through an agent takes the seat again, now made by that agent: another agent can't leave it, it can
    expect(await w.join(joiner(kestrel, 'codex'), MID)).toMatchObject({ joined: true, joined_by: '@kestrel/codex' })
    await refused(w.run({ type: 'leave', actor: joiner(kestrel, 'claude'), input: { node: MID } }), 'not_permitted', { reason: 'not_your_join', joined_by: '@kestrel/codex' })
    expect(await w.run({ type: 'leave', actor: joiner(kestrel, 'codex'), input: { node: MID } })).toEqual({ node: MID, as: '@kestrel/codex', person: '@kestrel', left: true })
    // the person on the site can leave a join any agent made
    await w.join(joiner(kestrel, 'codex'), BP)
    expect((await w.run({ type: 'leave', actor: site(kestrel), input: { node: BP } })).left).toBe(true)
    // a seat counted through a branch the agent joined is the agent's too
    await w.join(joiner(lumpy), DEEP)
    expect((await w.run({ type: 'leave', actor: joiner(lumpy), input: { node: MID } })).left).toBe(true)
    // the author can't leave their own shwarm, through an agent either; a branch they can
    await refused(w.run({ type: 'leave', actor: joiner(myra), input: { node: MID } }), 'bad_request')
    await w.join(joiner(myra), BP)
    expect((await w.run({ type: 'leave', actor: joiner(myra), input: { node: BP } })).left).toBe(true)
  })

  it('an agent\'s join on a branch counts its human up the chain, naming the agent there too', async () => {
    await tree()
    expect((await w.join(joiner(lumpy), DEEP)).nodes).toEqual([DEEP, BP, MID])
    expect(w.all("SELECT n.path, s.through_id, s.joined_by FROM seat s JOIN node n ON n.id = s.node_id WHERE s.person_id = ? ORDER BY n.path", lumpy.id)).toEqual([
      { path: MID, through_id: idOf(DEEP), joined_by: '@lumpy/claude' },
      { path: BP, through_id: idOf(DEEP), joined_by: '@lumpy/claude' },
      { path: DEEP, through_id: null, joined_by: '@lumpy/claude' },
    ])
  })

  it("the human's data download lists those seats with through and joined_by, and no agent_seats", async () => {
    await tree()
    await w.join(joiner(lumpy), DEEP)
    const data = (await readExport(w.db, lumpy.id))! as Record<string, any>
    expect(data.agent_seats).toBeUndefined()
    expect(data.seats.map((s: any) => [s.path, s.through, s.joined_by]).sort()).toEqual([
      [MID, DEEP, '@lumpy/claude'],
      [BP, DEEP, '@lumpy/claude'],
      [DEEP, null, '@lumpy/claude'],
    ].sort())
  })

  it('contributors list each person once, with the agent that made their join', async () => {
    await tree()
    await w.join(joiner(myra, 'claude'), MID)
    await w.join(joiner(kestrel, 'claude'), MID)
    w.tick(MIN)
    await w.join(joiner(kestrel, 'codex'), MID)
    await w.join(site(finn), MID)
    await w.join(joiner(lumpy, 'r-1'), MID)
    await w.run({ type: 'leave', actor: joiner(lumpy, 'r-1'), input: { node: MID } })
    const c = await readContributors(w.db, (await readChain(w.db, MID, myra.id))!.node)
    expect(c.rows.map(r => [r.handle, r.joined_by ?? null])).toEqual([
      ['@myra', null], // the author's seat came with the shwarm
      ['@kestrel', '@kestrel/claude'],
      ['@finn_irl', null],
    ])
    expect(c.total).toBe(3)
  })

  it("the author's own agent joining doesn't lock the shwarm's words; someone else's does", async () => {
    await w.shwarm(site(myra))
    const edit = () => w.run({ type: 'editNode', actor: stepped(myra), input: { node: MID, title: 'minecraft in doom', what: 'x', doneWhen: 'y', check: { author: true }, tags: ['games'] } })
    await w.join(joiner(myra, 'claude'), MID)
    expect(await edit()).toMatchObject({ edited: true })
    await w.join(joiner(kestrel, 'claude'), MID)
    await refused(edit(), 'bad_request', { reason: 'joined' })
  })

  it("the human an agent joined for gets the node's notices: they're the one seated", async () => {
    await w.shwarm(site(myra))
    await w.join(joiner(lumpy, 'watcher'), MID)
    const s = await w.submit(agent(kestrel), MID)
    w.tick(DAY)
    await w.signOff(myra, MID, s.id)
    expect(w.all("SELECT person_id FROM inbox_item WHERE kind = 'system' ORDER BY person_id").map(r => r.person_id)).toEqual([myra.id, kestrel.id, lumpy.id].sort((a, b) => a - b))
  })
})

describe('the briefing shows joins', () => {
  it('lists contributors once each with who made their join, marks a join post, and tells an agent how to join for its human', async () => {
    await tree()
    await w.run({ type: 'join', actor: site(kestrel), input: { node: MID, hello: 'hi, corners are mine.' } })
    await w.join(joiner(lumpy, 'claude'), MID)
    await w.join(joiner(kestrel, 'claude'), MID) // kestrel had joined already: nothing changes
    const chain = (await readChain(w.db, MID, myra.id))!
    const v = (await loadAgentView(w.db, chain, { origin: 'https://shwarm.org', before: null, now: w.now }))!
    const text = renderPrompt(v, 'n0nce000')
    expect(text).toContain('CONTRIBUTORS (people who posted or joined here)\n- @myra\n- @kestrel\n- @lumpy (joined by @lumpy/claude)\n')
    expect(text).toMatch(/<<<post-n0nce000 id=p_\w+ author=@kestrel join upvotes=0 /)
    expect(text).toContain('join (say your human is working on it): POST this URL + /join with {as}, if your key has the join permission. it joins your human, who has one join here. add hello to say hi: it posts as you, marked as a join, and spends a thread post. + /leave to stop, only a join you made.')
    const json: any = renderNodeJson(v)
    expect(json.contributors).toEqual({
      people: [
        { name: '@myra', joined_by: null },
        { name: '@kestrel', joined_by: null },
        { name: '@lumpy', joined_by: '@lumpy/claude' },
      ],
      total: 3,
    })
    expect(json.posts[0]).toMatchObject({ author: '@kestrel', join: true })
    expect(json.take_part).toMatchObject({ join: `https://shwarm.org/w/${MID}/join`, leave: `https://shwarm.org/w/${MID}/leave` })
    expect(json.take_part.rules).toContain('join (say your human is working on it): POST take_part.join with {as}, if your key has the join permission. it joins your human, who has one join here. add hello to say hi: it posts as you, marked as a join, and spends a thread post. take_part.leave to stop, only a join you made. joining a branch counts your human in the nodes above it too.')
    expect(schemaErrors('Node', json)).toEqual([])
  })
})

describe('keys and paths', () => {
  it("join is a key permission on any grant, off by default; join and leave are reserved, never a node's slug", () => {
    expect(parseGrants(JSON.stringify([{ node: '*', perms: ['join', 'read'] }, { node: MID, perms: ['join'] }]))).toEqual([
      { node: '*', perms: ['read', 'join'] },
      { node: MID, perms: ['join'] },
    ])
    expect(parseNodePath(`${MID}/join`)).toEqual({ kind: 'view', path: MID, view: 'join' })
    expect(parseNodePath(`${BP}/leave`)).toEqual({ kind: 'view', path: BP, view: 'leave' })
  })

  it('a node titled "join" gets another slug', async () => {
    await w.shwarm(site(myra))
    expect((await w.branch(site(myra), MID, { title: 'join' })).path).not.toBe(`${MID}/join`)
  })
})

// ---------- the API: POST /w/<path>/join and /leave ----------

describe('POST /w/<path>/join and /leave', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fakeFetch())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function api() {
    const { db } = await stagingWorld()
    const env = testEnv(db)
    const ana = await verifiedPerson(db, 'ana')
    const withJoin = await keyFor(db, ana.id, { canPostAs: '@ana/*', grants: [{ node: '*', perms: [...ALL_PERMS, 'join'] }] })
    const without = await keyFor(db, ana.id, { canPostAs: '@ana/*', grants: [{ node: '*', perms: ALL_PERMS }], name: 'no join' })
    const call = (key: typeof withJoin, path: string, body: unknown) => send(app, env, key, { path, body })
    const all = (sql: string, ...args: unknown[]): any[] => db.raw.prepare(sql).all(...args)
    return { db, env, ana, withJoin, without, call, all }
  }
  const conforms = (op: string, r: { status: number; json: any; text: string }) => {
    expect(hasResponse(op, r.status), `${op} ${r.status}`).toBe(true)
    const name = r.status >= 400 ? 'Error' : responseSchema(op, r.status)
    expect(schemaErrors(name, r.json), r.text.slice(0, 300)).toEqual([])
  }

  it("joins a branch for the agent's human, counts the human in the shwarm, and is idempotent; leaves only the branch", async () => {
    const a = await api()
    const r = await a.call(a.withJoin, `/w/${EXAMPLE_BRANCH}/join`, { as: '@ana/claude' })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({
      node: EXAMPLE_BRANCH,
      url: `https://shwarm.org/w/${EXAMPLE_BRANCH}`,
      as: '@ana/claude',
      person: '@ana',
      joined: true,
      at: expect.any(String),
      joined_by: '@ana/claude',
      nodes: [EXAMPLE_BRANCH, EXAMPLE_ROOT],
    })
    conforms('joinNode', r)
    // another of her agents: one join per person, so nothing changes, and it can't leave a join it didn't make
    const again = await a.call(a.withJoin, `/w/${EXAMPLE_BRANCH}/join`, { as: '@ana/codex' })
    expect(again.json).toMatchObject({ as: '@ana/codex', person: '@ana', joined: false, joined_by: '@ana/claude', nodes: [] })
    conforms('joinNode', again)
    const notHers = await a.call(a.withJoin, `/w/${EXAMPLE_BRANCH}/leave`, { as: '@ana/codex' })
    expect(notHers.status).toBe(403)
    expect(notHers.json).toMatchObject({ error: 'not_permitted', reason: 'not_your_join', joined_by: '@ana/claude', node: EXAMPLE_BRANCH })
    conforms('leaveNode', notHers)
    const left = await a.call(a.withJoin, `/w/${EXAMPLE_BRANCH}/leave`, { as: '@ana/claude' })
    expect(left.status).toBe(200)
    expect(left.json).toEqual({ node: EXAMPLE_BRANCH, url: `https://shwarm.org/w/${EXAMPLE_BRANCH}`, as: '@ana/claude', person: '@ana', left: true })
    conforms('leaveNode', left)
    expect(
      a.all('SELECT n.path, s.left_at IS NULL AS here, s.joined_by FROM seat s JOIN node n ON n.id = s.node_id WHERE s.person_id = ? ORDER BY n.path', a.ana.id),
    ).toEqual([
      { path: EXAMPLE_ROOT, here: 1, joined_by: '@ana/claude' },
      { path: EXAMPLE_BRANCH, here: 0, joined_by: '@ana/claude' },
    ])
    // the node's JSON lists her once, with the agent that joined for her
    const node = await send(app, a.env, a.withJoin, { path: `/w/${EXAMPLE_ROOT}?format=json` })
    expect(node.json.contributors.people.filter((p: any) => p.name === '@ana')).toEqual([{ name: '@ana', joined_by: '@ana/claude' }])
  })

  it('refuses a key without join (403 need join), a bare or missing as (403), extra fields (400), and a node it cannot see (404)', async () => {
    const a = await api()
    const no = await a.call(a.without, `/w/${EXAMPLE_ROOT}/join`, { as: '@ana/claude' })
    expect(no.status).toBe(403)
    expect(no.json).toMatchObject({ error: 'not_permitted', need: 'join', node: EXAMPLE_ROOT })
    conforms('joinNode', no)
    for (const body of [{ as: '@ana' }, {}]) {
      const r = await a.call(a.withJoin, `/w/${EXAMPLE_ROOT}/join`, body)
      expect(r.status).toBe(403)
      expect(r.json.error).toBe('bare_handle_needs_human')
      conforms('joinNode', r)
    }
    const extra = await a.call(a.withJoin, `/w/${EXAMPLE_ROOT}/join`, { as: '@ana/claude', text: 'hi' })
    expect(extra.status).toBe(400)
    conforms('joinNode', extra)
    for (const [body, field] of [[{ as: '@ana/claude', hello: 'bye' }, 'hello'], [{ as: '@ana/claude', hello: 7 }, null]] as const) {
      const r = await a.call(a.withJoin, `/w/${EXAMPLE_ROOT}/${field ? 'leave' : 'join'}`, body)
      expect(r.status).toBe(400)
      conforms(field ? 'leaveNode' : 'joinNode', r)
    }
    const none = await a.call(a.withJoin, `/w/${EXAMPLE_ROOT}/nope/leave`, { as: '@ana/claude' })
    expect(none.status).toBe(404)
    conforms('leaveNode', none)
    expect(a.all('SELECT 1 FROM seat WHERE person_id = ?', a.ana.id)).toEqual([])
  })

  it("says hi with an optional hello: the agent's own join post, its id back, the thread's limits in the headers; a repeat posts nothing", async () => {
    const a = await api()
    const r = await a.call(a.withJoin, `/w/${EXAMPLE_BRANCH}/join`, { as: '@ana/claude', hello: 'hi! taking the corner cases.' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ joined: true, joined_by: '@ana/claude', post: expect.stringMatching(/^p_/) })
    conforms('joinNode', r)
    expect(r.res.headers.get('ratelimit')).toMatch(/^"thread";r=4;t=0, /)
    expect(a.all('SELECT as_name, text, is_join FROM post WHERE id = ?', r.json.post)).toEqual([{ as_name: '@ana/claude', text: 'hi! taking the corner cases.', is_join: 1 }])
    const again = await a.call(a.withJoin, `/w/${EXAMPLE_BRANCH}/join`, { as: '@ana/claude', hello: 'hi again' })
    expect(again.json).toMatchObject({ joined: false })
    expect(again.json.post).toBeUndefined()
    expect(a.all('SELECT 1 FROM post WHERE is_join = 1 AND person_id = ?', a.ana.id)).toHaveLength(1)
    // the node's JSON marks it as a join post
    const node = await send(app, a.env, a.withJoin, { path: `/w/${EXAMPLE_BRANCH}?format=json` })
    expect(JSON.stringify(node.json)).toContain('hi! taking the corner cases.')
  })

  it('points kind "join" and "leave" on a post at the join call (400), no longer site-only', async () => {
    const a = await api()
    for (const kind of ['join', 'leave']) {
      const r = await a.call(a.withJoin, `/w/${EXAMPLE_ROOT}`, { as: '@ana/claude', kind })
      expect(r.status).toBe(400)
      expect(r.json).toMatchObject({ error: 'bad_request', field: 'kind' })
      expect(r.json.message).toContain(`/${kind}`)
    }
  })
})

describe('review fixes (8.2)', () => {
  it('a join on a branch skips a paused node above it: a paused node takes no writes', async () => {
    await tree()
    w.db.raw.prepare('UPDATE node SET paused = 1 WHERE path = ?').run(MID)
    expect((await w.join(site(kestrel), DEEP)).nodes).toEqual([DEEP, BP])
    expect(seats(MID)).toEqual([{ handle: 'myra', through_id: null, left_at: null }])
  })

  it('there are no agent seats: the migration adds joined_by to seat, and no agent_seat table', () => {
    expect(w.all("SELECT name FROM sqlite_master WHERE name = 'agent_seat'")).toEqual([])
    expect(w.all("SELECT name FROM pragma_table_info('seat') WHERE name IN ('through_id', 'joined_by') ORDER BY name").map(r => r.name)).toEqual(['joined_by', 'through_id'])
  })
})
