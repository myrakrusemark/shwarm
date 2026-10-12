// Go-live 8.2, the core and API half: branches can be joined (and count the joiner in every node above), a person's
// hello is a join post, an empty join is a quiet thread line read from the seat, agents join under their own names with
// the key's `join` permission, contributors group a person's agents under them, and an agent's join makes its human
// involved for notices (OPEN #115, a builder's default).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { parseGrants } from '../src/auth/keys'
import { readContributors, readJoins, readChain, parseNodePath } from '../src/read/node'
import { loadAgentView } from '../src/read/views'
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
const agentSeats = (path: string) =>
  w.all('SELECT a.as_name, a.through_id, a.left_at FROM agent_seat a JOIN node n ON n.id = a.node_id WHERE n.path = ? ORDER BY a.joined_at, a.as_name', path)
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
    expect(r).toEqual({ node: DEEP, as: '@kestrel', joined: true, at: new Date(w.now).toISOString(), nodes: [DEEP, BP, MID] })
    expect(seats(DEEP)).toEqual([{ handle: 'kestrel', through_id: null, left_at: null }])
    expect(seats(BP)).toEqual([{ handle: 'kestrel', through_id: idOf(DEEP), left_at: null }])
    expect(seats(MID)).toEqual([
      { handle: 'myra', through_id: null, left_at: null },
      { handle: 'kestrel', through_id: idOf(DEEP), left_at: null },
    ])
    // joining again changes nothing
    w.tick(MIN)
    expect(await w.join(site(kestrel), DEEP)).toEqual({ node: DEEP, as: '@kestrel', joined: false, at: new Date(w.now - MIN).toISOString(), nodes: [] })
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
    expect(await w.run({ type: 'leave', actor: site(kestrel), input: { node: DEEP } })).toEqual({ node: DEEP, as: '@kestrel', left: true })
    expect(seats(DEEP)[0].left_at).toBeTruthy()
    expect(seats(BP)[0].left_at).toBeNull()
    expect(seats(MID)[1].left_at).toBeNull()
    // leaving again changes nothing
    expect(await w.run({ type: 'leave', actor: site(kestrel), input: { node: DEEP } })).toEqual({ node: DEEP, as: '@kestrel', left: false })
    await w.join(site(myra), BP)
    expect((await w.run({ type: 'leave', actor: site(myra), input: { node: BP } })).left).toBe(true)
    await refused(w.run({ type: 'leave', actor: site(myra), input: { node: MID } }), 'bad_request')
  })

  it('an ended node, or a branch under one, takes no joins or leaves', async () => {
    await tree()
    await w.join(site(lumpy), BP)
    await w.deadEnd(myra, BP)
    await refused(w.join(site(kestrel), BP), 'shwarm_closed')
    await refused(w.join(site(kestrel), DEEP), 'shwarm_closed', { locked_by: BP })
    await refused(w.run({ type: 'leave', actor: site(lumpy), input: { node: BP } }), 'shwarm_closed')
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
    expect((await readJoins(w.db, w.node(BP))).map(j => j.as)).toEqual(['@kestrel', '@lumpy', '@finn_irl/claude'])
    // in the shwarm above, they were only counted, and the author's seat came with the shwarm
    expect(await readJoins(w.db, w.node(MID))).toEqual([])
    // a line stays after its joiner leaves; joining again moves it
    await w.run({ type: 'leave', actor: site(kestrel), input: { node: BP } })
    w.tick(MIN)
    await w.join(site(kestrel), BP)
    expect((await readJoins(w.db, w.node(BP))).map(j => j.as)).toEqual(['@lumpy', '@finn_irl/claude', '@kestrel'])
  })

  it('refuses a hello from an agent, and one past the post length', async () => {
    await tree()
    await refused(w.run({ type: 'join', actor: joiner(kestrel), input: { node: BP, hello: 'hi' } }), 'bad_request', { field: 'hello' })
    await refused(w.run({ type: 'join', actor: site(kestrel), input: { node: BP, hello: 'x'.repeat(20_001) } }), 'bad_request', { field: 'hello' })
    expect(seats(BP)).toEqual([])
  })
})

describe('agents join under their own names (decided Oct 12)', () => {
  it('needs the join permission on the node, never the bare handle, and stays inside can-post-as', async () => {
    await tree()
    await refused(w.join(agent(kestrel), MID), 'not_permitted', { need: 'join', node: MID })
    await refused(w.join({ ...joiner(kestrel), as: '@kestrel' }, MID), 'bare_handle_needs_human')
    await refused(w.join({ ...joiner(kestrel), canPostAs: '@kestrel/swarm/*' }, MID), 'not_permitted', { need: 'can_post_as' })
    // granted on the branch only: it may join the branch, which counts it in the shwarm too
    const scoped = joiner(kestrel, 'claude', BP)
    await refused(w.join(scoped, MID), 'not_permitted', { need: 'join', node: MID })
    expect((await w.join(scoped, BP)).nodes).toEqual([BP, MID])
    await refused(w.run({ type: 'leave', actor: agent(kestrel, 'claude'), input: { node: BP } }), 'not_permitted', { need: 'join' })
  })

  it('a person may hold their own seat and several agent seats; each leaves on its own, idempotently', async () => {
    await tree()
    await w.join(site(kestrel), MID)
    expect(await w.join(joiner(kestrel, 'claude'), MID)).toMatchObject({ as: '@kestrel/claude', joined: true, nodes: [MID] })
    expect(await w.join(joiner(kestrel, 'codex'), MID)).toMatchObject({ as: '@kestrel/codex', joined: true })
    expect(await w.join(joiner(kestrel, 'claude'), MID)).toMatchObject({ joined: false })
    expect(agentSeats(MID).map(a => a.as_name)).toEqual(['@kestrel/claude', '@kestrel/codex'])
    expect(w.get('SELECT key_id FROM agent_seat WHERE as_name = ?', '@kestrel/claude').key_id).toBe('kestrel-key')
    expect(await w.run({ type: 'leave', actor: joiner(kestrel, 'codex'), input: { node: MID } })).toEqual({ node: MID, as: '@kestrel/codex', left: true })
    expect(await w.run({ type: 'leave', actor: joiner(kestrel, 'codex'), input: { node: MID } })).toEqual({ node: MID, as: '@kestrel/codex', left: false })
    expect(seats(MID).map(s => s.handle)).toEqual(['myra', 'kestrel']) // the person's own seat is untouched
    expect(agentSeats(MID).filter(a => !a.left_at).map(a => a.as_name)).toEqual(['@kestrel/claude'])
  })

  it("the contributors list groups a person's agents under them, and brings in a person only their agent joined for", async () => {
    await tree()
    await w.join(joiner(myra, 'claude'), MID)
    await w.join(joiner(kestrel, 'claude'), MID)
    w.tick(MIN)
    await w.join(joiner(kestrel, 'codex'), MID)
    await w.join(joiner(lumpy, 'r-1'), MID)
    await w.run({ type: 'leave', actor: joiner(lumpy, 'r-1'), input: { node: MID } })
    const c = await readContributors(w.db, (await readChain(w.db, MID, myra.id))!.node)
    expect(c.rows.map(r => [r.handle, r.agents ?? []])).toEqual([
      ['@myra', ['@myra/claude']],
      ['@kestrel', ['@kestrel/claude', '@kestrel/codex']],
    ])
    expect(c.total).toBe(2)
  })

  it("someone else's agent joining locks the shwarm's words; the author's own agents don't", async () => {
    await w.shwarm(site(myra))
    const edit = () => w.run({ type: 'editNode', actor: stepped(myra), input: { node: MID, title: 'minecraft in doom', what: 'x', doneWhen: 'y', check: { author: true }, tags: ['games'] } })
    await w.join(joiner(myra, 'claude'), MID)
    expect(await edit()).toMatchObject({ edited: true })
    await w.join(joiner(kestrel, 'claude'), MID)
    await refused(edit(), 'bad_request', { reason: 'joined' })
  })

  it("an agent's join counts its human as involved: they get the node's notices (OPEN #115)", async () => {
    await w.shwarm(site(myra))
    await w.join(joiner(lumpy, 'watcher'), MID)
    const s = await w.submit(agent(kestrel), MID)
    w.tick(DAY)
    await w.signOff(myra, MID, s.id)
    expect(w.all("SELECT person_id FROM inbox_item WHERE kind = 'system' ORDER BY person_id").map(r => r.person_id)).toEqual([myra.id, kestrel.id, lumpy.id].sort((a, b) => a - b))
  })
})

describe('the briefing shows joins', () => {
  it('lists contributors with their agents, marks a join post, and tells an agent how to join', async () => {
    await tree()
    await w.run({ type: 'join', actor: site(kestrel), input: { node: MID, hello: 'hi, corners are mine.' } })
    await w.join(joiner(kestrel, 'claude'), MID)
    const chain = (await readChain(w.db, MID, myra.id))!
    const v = (await loadAgentView(w.db, chain, { origin: 'https://shwarm.org', before: null, now: w.now }))!
    const text = renderPrompt(v, 'n0nce000')
    expect(text).toContain('CONTRIBUTORS (people who posted or joined here, each with the agents of theirs that joined)\n- @myra\n- @kestrel · @kestrel/claude\n')
    expect(text).toMatch(/<<<post-n0nce000 id=p_\w+ author=@kestrel join upvotes=0 /)
    expect(text).toContain("join (say you're working on it): POST this URL + /join with {as}, if your key has the join permission;")
    const json: any = renderNodeJson(v)
    expect(json.contributors).toEqual({ people: [{ name: '@myra', agents: [] }, { name: '@kestrel', agents: ['@kestrel/claude'] }], total: 2 })
    expect(json.posts[0]).toMatchObject({ author: '@kestrel', join: true })
    expect(json.take_part).toMatchObject({ join: `https://shwarm.org/w/${MID}/join`, leave: `https://shwarm.org/w/${MID}/leave` })
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

  it('joins a branch under the agent name, counts it in the shwarm, and is idempotent; leaves only the branch', async () => {
    const a = await api()
    const r = await a.call(a.withJoin, `/w/${EXAMPLE_BRANCH}/join`, { as: '@ana/claude' })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ node: EXAMPLE_BRANCH, url: `https://shwarm.org/w/${EXAMPLE_BRANCH}`, as: '@ana/claude', joined: true, at: expect.any(String), nodes: [EXAMPLE_BRANCH, EXAMPLE_ROOT] })
    conforms('joinNode', r)
    const again = await a.call(a.withJoin, `/w/${EXAMPLE_BRANCH}/join`, { as: '@ana/claude' })
    expect(again.json).toMatchObject({ joined: false, nodes: [] })
    const left = await a.call(a.withJoin, `/w/${EXAMPLE_BRANCH}/leave`, { as: '@ana/claude' })
    expect(left.status).toBe(200)
    expect(left.json).toEqual({ node: EXAMPLE_BRANCH, url: `https://shwarm.org/w/${EXAMPLE_BRANCH}`, as: '@ana/claude', left: true })
    conforms('leaveNode', left)
    expect(a.all('SELECT n.path, a.left_at IS NULL AS here FROM agent_seat a JOIN node n ON n.id = a.node_id ORDER BY n.path')).toEqual([
      { path: EXAMPLE_ROOT, here: 1 },
      { path: EXAMPLE_BRANCH, here: 0 },
    ])
    // the node's JSON shows the agent under its human
    const node = await send(app, a.env, a.withJoin, { path: `/w/${EXAMPLE_ROOT}?format=json` })
    expect(node.json.contributors.people).toContainEqual({ name: '@ana', agents: ['@ana/claude'] })
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
    const extra = await a.call(a.withJoin, `/w/${EXAMPLE_ROOT}/join`, { as: '@ana/claude', hello: 'hi' })
    expect(extra.status).toBe(400)
    conforms('joinNode', extra)
    const none = await a.call(a.withJoin, `/w/${EXAMPLE_ROOT}/nope/leave`, { as: '@ana/claude' })
    expect(none.status).toBe(404)
    conforms('leaveNode', none)
    expect(a.all('SELECT 1 FROM agent_seat')).toEqual([])
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

  it("an agent's join again records the key that signed it", async () => {
    await tree()
    const first = joiner(kestrel)
    await w.join(first, MID)
    await w.run({ type: 'leave', actor: first, input: { node: MID } })
    const other = { ...joiner(kestrel), keyId: 'kestrel-key-2' }
    await w.join(other, MID)
    expect(w.get('SELECT key_id, left_at FROM agent_seat WHERE as_name = ?', '@kestrel/claude')).toEqual({ key_id: 'kestrel-key-2', left_at: null })
  })
})
