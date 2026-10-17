// Rule tests for the domain core (go-live 2.3): every refusal, every state transition, the audit log.
import { beforeEach, describe, expect, it } from 'vitest'
import type { Actor } from '../src/core/actor'
import { readChain } from '../src/read/node'
import { readNodeStatus } from '../src/read/status'
import { agent, DAY, HOUR, MIN, person, refused, site, SHA, stepped, World, WORK, type P } from './core-fixtures'

let w: World
let myra: P, kestrel: P, lumpy: P, finn: P
const MID = 'minecraft-in-doom'
const BP = 'minecraft-in-doom/block-placement'

/** minecraft in doom, live from the start, with @kestrel joined (working on it). */
async function live() {
  await w.shwarm(site(myra))
  await w.join(site(kestrel), MID)
  return MID
}

beforeEach(async () => {
  w = new World()
  myra = await person(w.db, 'myra')
  kestrel = await person(w.db, 'kestrel')
  lumpy = await person(w.db, 'lumpy')
  finn = await person(w.db, 'finn_irl')
})

describe('actor and permissions', () => {
  it('refuses a bare name from an agent key: bare_handle_needs_human', async () => {
    await live()
    const k = { ...agent(kestrel), as: '@kestrel' }
    await refused(w.post(k, MID), 'bare_handle_needs_human')
  })

  it('refuses a name under someone else: not_your_name', async () => {
    await live()
    await refused(w.post({ ...agent(kestrel), as: '@myra/m-04' }, MID), 'not_your_name')
    await refused(w.post({ ...site(kestrel), as: '@myra' }, MID), 'not_your_name')
  })

  it('refuses a malformed name: bad_name', async () => {
    await live()
    await refused(w.post({ ...agent(kestrel), as: '@kestrel/../x' }, MID), 'bad_name')
    await refused(w.post({ ...agent(kestrel), as: '@Kestrel/x' }, MID), 'bad_name')
  })

  it('keeps keys inside their can-post-as pattern and grants: not_permitted with need and node', async () => {
    await live()
    const narrow = { ...agent(kestrel, 'swarm/r-03'), canPostAs: '@kestrel/swarm/*' }
    expect((await w.post(narrow, MID)).as).toBe('@kestrel/swarm/r-03')
    await refused(w.post({ ...narrow, as: '@kestrel/other' }, MID), 'not_permitted', { need: 'can_post_as' })
    await refused(w.post(agent(kestrel, 'r', ['read']), MID), 'not_permitted', { need: 'post', node: MID })
    // the most specific grant wins over '*'
    const k = agent(kestrel, 'r', ['read', 'post'])
    k.grants!.push({ node: MID, perms: ['read'] })
    await refused(w.post(k, MID), 'not_permitted', { need: 'post', node: MID })
    // a shwarm's grant covers its branches
    await w.branch(site(myra), MID)
    const scoped = agent(kestrel, 'r', ['read', 'post'], MID)
    expect((await w.post(scoped, BP)).node).toBe(BP)
    await refused(w.branch(scoped, BP, { title: 'monster collision' }), 'not_permitted', { need: 'branch', node: BP })
  })

  it("keeps bare-handle acts on the site: backing, the author's mark; an agent joins for its human only with join", async () => {
    await w.shwarm(site(myra))
    await refused(w.join(agent(kestrel), MID), 'not_permitted', { need: 'join', node: MID })
    await refused(w.join({ ...agent(kestrel, 'm-04', ['join']), as: '@kestrel' }, MID), 'bare_handle_needs_human')
    await w.join(site(kestrel), MID)
    await w.join(site(lumpy), MID)
    // an agent claims for its human, but backing someone's claim and the author's mark are the human's own acts
    const c = await w.post(agent(kestrel), MID, 'all nine maps play through from a pistol start.', { claim: 'passed' })
    await refused(w.run({ type: 'back', actor: agent(lumpy), input: { node: MID, post: c.id, on: true } }), 'bare_handle_needs_human')
    await refused(w.run({ type: 'markPassed', actor: agent(myra), input: { node: MID, post: c.id } }), 'bare_handle_needs_human')
    const e = await refused(w.run({ type: 'markPassed', actor: site(myra), input: { node: MID, post: c.id } }), 'not_permitted', { need: 'step_up' })
    expect(e.message).toBe('marking your shwarm passed confirms with your password')
    expect(w.all('SELECT 1 FROM pass_record')).toEqual([])
    expect((await w.run<any>({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: c.id } })).changed).toBe(true)
  })

  it('refuses unverified and suspended accounts', async () => {
    await live()
    const ghost = await person(w.db, 'ghost', { verified: false })
    await refused(w.post(site(ghost), MID), 'not_permitted', { reason: 'unverified' })
    await w.db.prepare("UPDATE person SET status = 'suspended' WHERE id = ?").bind(lumpy.id).run()
    await refused(w.post(site(lumpy), MID), 'not_permitted', { reason: 'suspended' })
  })

  it('obeys read_only and pause_new_nodes', async () => {
    await live()
    await w.db.prepare("UPDATE setting SET value = 'true' WHERE key = 'pause_new_nodes'").run()
    await refused(w.branch(site(myra), MID), 'not_permitted', { reason: 'pause_new_nodes' })
    expect((await w.post(site(kestrel), MID)).id).toMatch(/^p_/)
    await w.db.prepare("UPDATE setting SET value = 'true' WHERE key = 'read_only'").run()
    await refused(w.post(site(kestrel), MID), 'not_permitted', { reason: 'read_only' })
  })
})

describe('creating nodes', () => {
  it('starts a shwarm live at once, with the author down as working on it: no lobby, no kickoff (decided Oct 9)', async () => {
    const r = await w.shwarm(site(myra))
    expect(r).toEqual({ path: MID, kind: 'shwarm', limits: { new_nodes_today: { left: 2 } } })
    expect(w.node(MID)).toMatchObject({ state: 'live', license: 'MIT', live_at: new Date(w.now).toISOString(), variant_of_id: null })
    expect(w.events(MID)).toEqual([])
    expect(w.all('SELECT person_id, number FROM seat')).toEqual([{ person_id: myra.id, number: 1 }])
    expect(w.all('SELECT tag FROM node_tag ORDER BY tag').map(t => t.tag)).toEqual(['games', 'gzdoom'])
    expect(w.node(MID)).toMatchObject({ posted_by: '@myra', author_id: myra.id, triage: 'pending', in_review: 0 })
  })

  it("opens an agent's shwarm with no one joined; the author is the human at the top", async () => {
    await refused(w.shwarm(agent(myra, 'scribe')), 'not_permitted', { need: 'new_shwarms', node: '*' })
    const r = await w.shwarm(agent(myra, 'scribe', ['new_shwarms']))
    expect(w.node(r.path).state).toBe('live')
    expect(w.all('SELECT 1 FROM seat')).toEqual([])
    expect(w.node(MID)).toMatchObject({ posted_by: '@myra/scribe', author_id: myra.id })
  })

  it('needs a done test, the sentence: no_done_test; a check sent is ignored (decided Oct 14)', async () => {
    await refused(w.run({ type: 'createNode', actor: site(myra), input: { kind: 'shwarm', title: 't', what: 'w', doneWhen: '', tags: ['x'] } }), 'no_done_test')
    await refused(w.run({ type: 'createNode', actor: site(myra), input: { kind: 'shwarm', title: 't', what: 'w', doneWhen: '  ', check: { author: true }, tags: ['x'] } }), 'no_done_test')
    const checks = [undefined, {}, null, { author: false, people: 0 }, { runs: { command: './soak.sh', count: 2 }, people: 1, author: true }]
    for (const [i, check] of checks.entries()) {
      const r = await w.run<any>({ type: 'createNode', actor: seed(myra), input: { kind: 'shwarm', title: `shwarm ${i}`, what: 'w', doneWhen: 'd', tags: ['x'], ...(check === undefined ? {} : { check }) } })
      expect(w.node(r.path).checks).toBe(JSON.stringify({ author: false }))
    }
    w.db.raw.prepare("UPDATE node SET triage = 'clear'").run()
    await w.branch(site(myra), 'shwarm-0', { check: { runs: { command: './soak.sh', count: 1 }, people: 1, author: true } })
    expect((await readChain(w.db, 'shwarm-0/block-placement', myra.id))!.node.spec).toEqual({ author: false })
  })

  it('makes every new shwarm MIT, whatever license it sends; the launch import alone keeps its card\'s as the note (Oct 15)', async () => {
    const r = await w.shwarm(site(myra), { license: 'CC-BY-NC-4.0' })
    expect(w.node(r.path).license).toBe('MIT')
    const s = await w.run<any>({ type: 'createNode', actor: seed(kestrel), input: { kind: 'shwarm', title: 'seeded', what: 'w', doneWhen: 'd', tags: ['x'], license: 'GPL-3.0' } })
    expect(w.node(s.path).license).toBe('GPL-3.0')
    await refused(w.run({ type: 'createNode', actor: seed(kestrel), input: { kind: 'shwarm', title: 'long', what: 'w', doneWhen: 'd', tags: ['x'], license: 'x'.repeat(101) } }), 'bad_license')
  })

  it("keeps an upstream's license as part of what it builds on, never as the node's; an upstream needs none (Oct 15)", async () => {
    const r = await w.shwarm(site(myra), { license: 'MIT', buildsOn: { name: 'gzdoom', url: 'https://zdoom.org', license: 'GPL-3.0' } })
    expect(w.node(r.path)).toMatchObject({ license: 'MIT', builds_on: JSON.stringify({ name: 'gzdoom', url: 'https://zdoom.org/', license: 'GPL-3.0' }) })
    const bare = await w.shwarm(site(myra), { title: 'other', buildsOn: { name: 'gzdoom' } })
    expect(w.node(bare.path)).toMatchObject({ license: 'MIT', builds_on: JSON.stringify({ name: 'gzdoom' }) })
    await refused(w.shwarm(site(myra), { title: 'third', buildsOn: { name: 'gzdoom', license: 'x'.repeat(101) } }), 'bad_license')
  })

  it('takes no lobby and makes no variants (decided Oct 9)', async () => {
    await live()
    await refused(
      w.run({ type: 'createNode', actor: site(lumpy), input: { kind: 'variant', variantOf: MID, title: 'v', what: 'w', doneWhen: 'd', tags: ['x'] } as any }),
      'bad_request',
    )
    // a lobby size sent anyway changes nothing: it's live at once
    const r = await w.run<any>({ type: 'createNode', actor: site(lumpy), input: { kind: 'shwarm', title: 'quiet', what: 'w', doneWhen: 'd', tags: ['x'], lobby: 12 } as any })
    expect(w.node(r.path).state).toBe('live')
    expect(w.all("SELECT 1 FROM node WHERE kind = 'variant' OR state = 'lobby'")).toEqual([])
  })

  it('makes slugs from titles, with a suffix when taken', async () => {
    expect((await w.shwarm(site(myra), { title: 'Every US lead pipe, mapped' })).path).toBe('every-us-lead-pipe-mapped')
    expect((await w.shwarm(site(kestrel), { title: 'every us lead pipe mapped!' })).path).toBe('every-us-lead-pipe-mapped-2')
    expect((await w.shwarm(site(lumpy), { title: 'log' })).path).toBe('log-2')
  })

  it("opens branches live at once, carrying their shwarm's note about the work, on a shwarm the minute it is posted", async () => {
    await w.shwarm(site(myra))
    w.db.raw.prepare("UPDATE node SET license = 'GPL-3.0' WHERE path = ?").run(MID) // a pick from before Oct 15
    expect(await w.branch(site(myra), MID, { title: 'first' })).toMatchObject({ path: `${MID}/first` })
    expect(w.node(`${MID}/first`).state).toBe('live')
    await refused(w.branch(site(kestrel), 'no-such-thing'), 'no_such_node')
    // An agent key acts only on nodes its human can see (7.4): @myra's shwarm is still being checked.
    await refused(w.branch(agent(kestrel, 'swarm/r-03'), MID), 'no_such_node')
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(MID)
    const b = await w.branch(agent(kestrel, 'swarm/r-03'), MID)
    expect(b).toMatchObject({ path: BP, kind: 'branch' })
    expect(w.node(BP)).toMatchObject({ state: 'live', license: 'GPL-3.0' })
    expect(w.node(BP)).toMatchObject({ root_id: w.node(MID).id, parent_id: w.node(MID).id, author_id: kestrel.id, lobby_size: null })
    const sub = await w.branch(site(kestrel), BP, { title: 'monster collision' })
    expect(sub.path).toBe('minecraft-in-doom/block-placement/monster-collision')
    expect(w.node(sub.path).root_id).toBe(w.node(MID).id)
    expect(w.events(BP)).toMatchObject([{ event: 'branch_opened', by_name: '@kestrel/swarm/r-03', milestone: 1 }])
    // a license sent is ignored (Oct 15): the branch still carries its shwarm's
    const x = await w.run<any>({ type: 'createNode', actor: site(kestrel), input: { kind: 'branch', parent: MID, title: 'x', what: 'w', doneWhen: 'd', license: 'MIT' } })
    expect(w.node(x.path).license).toBe('GPL-3.0')
  })

  it("refuses an agent key every node its human can't see, as not there: parent, builds on (7.4)", async () => {
    await live()
    const keyed = (p: P) => agent(p, 'm-04', ['read', 'branch', 'new_shwarms'])
    // still being checked: only its author, and the author's own agents, can see it
    await refused(w.branch(keyed(kestrel), MID), 'no_such_node')
    expect(await w.branch(keyed(myra), MID)).toMatchObject({ kind: 'branch' })
    w.db.raw.prepare("UPDATE node SET triage = 'held' WHERE path = ?").run(MID)
    await refused(w.branch(keyed(kestrel), MID), 'no_such_node')
    // a closed shwarm held for Myra can't be built on by anyone else's key, and says so as for a path that isn't there
    w.db.raw.prepare("UPDATE node SET state = 'closed' WHERE path = ?").run(MID)
    const buildOn = (by: Actor) => w.shwarm(by, { title: 'speedruns', buildsOn: MID })
    const e = await buildOn(keyed(kestrel)).catch(x => x)
    expect(e).toMatchObject({ code: 'bad_request', message: 'builds_on names a shwarm on shwarm, or an outside project as {name, url}' })
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(MID)
    expect(await buildOn(keyed(kestrel))).toMatchObject({ kind: 'shwarm' })
    // builds on is a typed path the site passes on unread, so core asks for site actors too
    w.db.raw.prepare("UPDATE node SET triage = 'held' WHERE path = ?").run(MID)
    expect(await w.shwarm(site(lumpy), { title: 'site build', buildsOn: MID }).catch(x => x)).toMatchObject({ code: 'bad_request', message: e.message })
    // its author still sees it, and may build on it
    const own = await w.shwarm(site(myra), { title: 'site build', buildsOn: MID })
    expect(w.node(own.path).license).toBe('MIT')
  })

  it('limits new shwarms and branches to 3 per person per rolling day', async () => {
    await live()
    await w.branch(site(myra), MID, { title: 'a' })
    await w.branch(site(myra), MID, { title: 'b' })
    w.tick(HOUR)
    const e = await refused(w.branch(site(myra), MID, { title: 'c' }), 'rate_limited', { limit: 'new_nodes', person: '@myra' })
    expect(e.details.retry_after).toBe((DAY - HOUR) / 1000)
    expect(e.details.node).toBeUndefined()
    expect(e.details.rule).toMatch(/3 new shwarms and branches a day/)
    // agents share their human's limit
    await refused(w.branch(agent(myra), MID, { title: 'd' }), 'rate_limited')
    w.tick(DAY - HOUR + 1)
    expect((await w.branch(site(myra), MID, { title: 'c' })).path).toBe('minecraft-in-doom/c')
  })
})

describe('join and leave: working on it (decided Oct 9, "No lobby")', () => {
  it('joins a live shwarm with no gate and no size: no kickoff, no event, no notice', async () => {
    await w.shwarm(site(myra))
    expect(await w.join(site(kestrel), MID)).toMatchObject({ node: MID, joined: true })
    expect(await w.join(site(finn), MID)).toMatchObject({ node: MID, joined: true })
    expect(await w.join(site(lumpy), MID)).toMatchObject({ node: MID, joined: true })
    expect(w.all('SELECT person_id FROM seat WHERE left_at IS NULL ORDER BY number').map(r => r.person_id)).toEqual([myra.id, kestrel.id, finn.id, lumpy.id])
    expect(w.node(MID)).toMatchObject({ state: 'live' })
    expect(w.events(MID)).toEqual([])
    expect(w.all('SELECT 1 FROM inbox_item')).toEqual([])
    expect(w.all('SELECT 1 FROM email_outbox')).toEqual([])
  })

  it('lets people leave and join again any time while it is live, not the author; joins are idempotent', async () => {
    await w.shwarm(site(myra))
    await w.join(site(kestrel), MID)
    expect(await w.join(site(kestrel), MID)).toMatchObject({ node: MID, joined: false })
    expect(await w.run({ type: 'leave', actor: site(kestrel), input: { node: MID } })).toEqual({ node: MID, as: '@kestrel', person: '@kestrel', left: true })
    expect(w.get('SELECT left_at FROM seat WHERE person_id = ?', kestrel.id).left_at).toBeTruthy()
    await refused(w.run({ type: 'leave', actor: site(myra), input: { node: MID } }), 'bad_request')
    expect(await w.join(site(kestrel), MID)).toMatchObject({ node: MID, joined: true })
    expect(w.get('SELECT number, left_at FROM seat WHERE person_id = ?', kestrel.id)).toEqual({ number: 2, left_at: null })
  })

  it('joins branches too; an agent joins only with the join permission, as @you/agent', async () => {
    await w.shwarm(site(myra))
    await w.branch(site(myra), MID)
    // branches are joined too (decided Oct 12; test/join.test.ts)
    expect(await w.join(site(lumpy), BP)).toMatchObject({ node: BP, joined: true, nodes: [BP, MID] })
    // an agent joins for its human only with the key's join permission, and only as @you/agent (decided Oct 12)
    await refused(w.join(agent(lumpy), MID), 'not_permitted', { need: 'join', node: MID })
    await refused(w.join({ ...agent(lumpy, 'm', ['join']), as: '@lumpy' }, MID), 'bare_handle_needs_human')
  })
})

describe('thread posts', () => {
  it('extracts mentions; a bare-handle mention lands in the inbox', async () => {
    await live()
    const r = await w.post(agent(kestrel, 'swarm/r-17'), MID, '@myra go for it. @myra/m-07, thanks. cc @nobody_here and a@b_c')
    expect(r.mentions).toEqual(['@myra', '@myra/m-07'])
    expect(w.all('SELECT to_name, to_person FROM mention ORDER BY to_name')).toEqual([
      { to_name: '@myra', to_person: myra.id },
      { to_name: '@myra/m-07', to_person: myra.id },
    ])
    expect(w.all("SELECT person_id, post_id FROM inbox_item WHERE kind = 'mention'")).toEqual([{ person_id: myra.id, post_id: r.id }])
  })

  it('refuses a reply to a post in another thread, and unpinned links', async () => {
    await live()
    await w.branch(site(myra), MID)
    const p = await w.post(site(kestrel), BP)
    await refused(w.post(site(kestrel), MID, 'hi', { replyTo: p.id }), 'bad_request')
    expect((await w.post(site(kestrel), BP, 'hi', { replyTo: p.id })).id).toMatch(/^p_[a-z0-9]{10}$/)
    await refused(w.post(site(kestrel), MID, 'see', { links: [{ url: 'https://x.org/f.zip' }] }), 'bad_request')
    await refused(w.post(site(kestrel), MID, 'see', { links: [{ url: 'https://x.org/f.zip', sha256: 'abc' }] }), 'bad_request')
    expect((await w.post(site(kestrel), MID, 'see', { links: [{ repo: 'https://codeberg.org/k/r', commit: 'b'.repeat(40) }] })).id).toBeTruthy()
  })

  it('limits thread posts to a burst of 5, then one per 5 minutes, per person per thread', async () => {
    await live()
    await w.branch(site(myra), MID)
    for (let i = 0; i < 5; i++) expect((await w.post(i % 2 ? agent(kestrel) : site(kestrel), MID)).limits.thread_posts.burst_left).toBe(4 - i)
    const e = await refused(w.post(agent(kestrel, 'other'), MID), 'rate_limited', { limit: 'thread_posts', person: '@kestrel', node: MID, retry_after: 300 })
    expect(e.details.rule).toMatch(/burst of 5/)
    expect((await w.post(site(kestrel), BP)).id).toBeTruthy() // another thread has its own bucket
    expect((await w.post(site(lumpy), MID)).id).toBeTruthy() // another person too
    w.tick(2 * MIN)
    await refused(w.post(site(kestrel), MID), 'rate_limited', { retry_after: 180 })
    w.tick(3 * MIN)
    expect((await w.post(site(kestrel), MID)).limits.thread_posts.burst_left).toBe(0)
    w.tick(60 * MIN)
    expect((await w.post(site(kestrel), MID)).limits.thread_posts.burst_left).toBe(4)
  })

})

describe('no node takes submissions, checks or a dead-end mark (decided Oct 14)', () => {
  it('has no command for them: core refuses each as unknown and writes nothing', async () => {
    await live()
    await w.branch(site(myra), MID)
    for (const node of [MID, BP])
      for (const [type, input] of [
        ['submit', { node, text: 'two-line fix.', links: WORK, howToCheck: 'place 200 times per corner.' }],
        ['check', { node, on: 'p_aaaaaaaaaa', verdict: 'pass', text: 'played it' }],
        ['deadEnd', { node, note: 'the engine cannot do it' }],
      ] as const)
        await refused(w.run({ type, actor: stepped(myra), input } as any), 'bad_request')
    expect(w.all('SELECT 1 FROM submission')).toEqual([])
    expect(w.all('SELECT 1 FROM check_report')).toEqual([])
    expect(w.all('SELECT kind FROM inbox_item')).toEqual([])
    expect([w.node(MID), w.node(BP)].map(n => [n.state, n.in_review, n.dead_end_note])).toEqual([['live', 0, null], ['live', 0, null]])
  })
})

describe("a branch's pass is its own (decided Oct 14)", () => {
  it('never touches its parent: a branch that passes writes its own records, and its shwarm stays as it was', async () => {
    await live()
    await w.branch(site(myra), MID)
    await w.join(site(kestrel), BP)
    await w.join(site(lumpy), BP)
    // a passed claim backed by two over nobody on track: the branch's status is passed a day later, and it stays live
    const c = await w.post(site(kestrel), BP, 'soak.sh: 10000 placements, 0 failures.', { claim: 'passed' })
    await w.run({ type: 'back', actor: site(lumpy), input: { node: BP, post: c.id, on: true } })
    w.tick(DAY)
    expect((await readNodeStatus(w.db, w.node(BP).id, w.now)).current).toBe('passed')
    // the next change to the branch's backing saves the change, with its record
    await w.join(site(finn), BP)
    await w.run({ type: 'status', actor: site(finn), input: { node: BP, status: 'on_track' } })
    expect(w.all('SELECT kind, status, claim_id FROM pass_record')).toEqual([{ kind: 'crowd', status: 'passed', claim_id: c.id }])
    expect(w.events(BP).map(e => e.event)).toEqual(['branch_opened', 'passed'])
    expect(w.events(MID).map(e => e.event)).toEqual([])
    expect((await readNodeStatus(w.db, w.node(MID).id, w.now)).current).toBe(null) // still no status of its own
    expect([w.node(BP).state, w.node(MID).state]).toEqual(['live', 'live'])
    // a branch has no author mark, so no approve notice: only its people's status-change notices (#138), on the branch
    expect(w.all("SELECT i.status_to, n.path FROM inbox_item i JOIN node n ON n.id = i.node_id WHERE i.kind = 'system'")).toEqual(
      [kestrel, lumpy, finn].map(() => ({ status_to: 'passed', path: BP })),
    )
  })
})

describe('the audit log', () => {
  it("writes only these event types now: a branch opening, a pass (the crowd's or the author's); with prefixed random ids", async () => {
    await live()
    await w.branch(site(myra), MID)
    await w.join(site(lumpy), MID)
    const c = await w.post(site(kestrel), MID, 'all nine maps play through.', { claim: 'passed' })
    await w.run({ type: 'back', actor: site(lumpy), input: { node: MID, post: c.id, on: true } })
    w.tick(DAY)
    await w.join(site(finn), MID)
    await w.run({ type: 'status', actor: site(finn), input: { node: MID, status: 'on_track' } }) // saves the change to passed
    await w.run({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: c.id } })
    const rows = w.all('SELECT id, event, by_name FROM audit_event ORDER BY rowid')
    for (const r of rows) expect(r.id).toMatch(/^e_[a-z0-9]{10}$/)
    expect(rows.map(r => [r.event, r.by_name])).toEqual([['branch_opened', '@myra'], ['passed', null], ['passed', '@myra']])
    for (const r of w.all('SELECT id FROM pass_record')) expect(r.id).toMatch(/^r_[a-z0-9]{10}$/)
    for (const r of w.all('SELECT id FROM status_change')) expect(r.id).toMatch(/^h_[a-z0-9]{10}$/)
  })

  it('commits nothing when a command is refused', async () => {
    await live()
    const before = w.all('SELECT COUNT(*) AS n FROM post')[0].n
    await refused(w.post(site(kestrel), MID, 'x', { claim: 'passed', links: [{ url: 'ftp://x', sha256: SHA('a') }] }), 'bad_request')
    expect(w.all('SELECT COUNT(*) AS n FROM post')[0].n).toBe(before)
    expect(w.all('SELECT COUNT(*) AS n FROM rate_bucket')[0].n).toBe(0)
    expect(w.all('SELECT COUNT(*) AS n FROM status_vote')[0].n).toBe(0)
  })
})

const seed = (p: P) => ({ ...site(p), via: 'seed' as const })

describe('creating nodes: what other trees and the seed import can change', () => {
  it("doesn't count seeded nodes against the seeder's daily limit (A18)", async () => {
    for (let i = 1; i <= 5; i++) await w.shwarm(seed(myra), { title: `seed ${i}` })
    expect(w.all('SELECT seeded FROM node').map(n => n.seeded)).toEqual([1, 1, 1, 1, 1])
    w.tick(HOUR)
    const r = await w.shwarm(site(myra))
    expect(r.limits.new_nodes_today.left).toBe(2)
    expect(w.node(MID).seeded).toBe(0)
  })

  it('refuses a path longer than a node can be loaded by', async () => {
    const long = (c: string) => c.repeat(80)
    await w.run({ type: 'createNode', actor: seed(myra), input: { kind: 'shwarm', title: long('r'), what: 'w', doneWhen: 'd', tags: ['x'] } })
    let path = long('r')
    for (let i = 0; i < 6; i++) path = (await w.run<any>({ type: 'createNode', actor: seed(myra), input: { kind: 'branch', parent: path, title: long('b'), what: 'w', doneWhen: 'd' } })).path
    expect(path.length).toBe(566)
    expect((await w.post(site(kestrel), path)).node).toBe(path) // the deepest node still works
    await refused(w.run({ type: 'createNode', actor: seed(myra), input: { kind: 'branch', parent: path, title: long('b'), what: 'w', doneWhen: 'd' } }), 'bad_request')
    expect(w.all('SELECT COUNT(*) AS n FROM node')[0].n).toBe(7)
  })
})

describe('the in review flag and the ETag', () => {
  it('changes the version on every write a signed-out view shows: posts, joins, leaves', async () => {
    const seen: string[] = []
    const look = () => {
      const v = w.node(MID).last_event_id
      expect(v).toBeTruthy()
      expect(seen).not.toContain(v)
      seen.push(v)
    }
    await w.shwarm(site(myra))
    look()
    await w.join(site(kestrel), MID)
    look()
    await w.run({ type: 'leave', actor: site(kestrel), input: { node: MID } })
    look()
    await w.post(site(lumpy), MID, 'is anyone here?')
    look()
    await w.join(site(kestrel), MID)
    look()
    const p = await w.post(site(lumpy), MID, 'and another')
    expect(w.node(MID).last_event_id).toBe(p.id)
  })
})

describe('every audit row links its evidence', () => {
  it('as a site path: the node, or the passed claim a pass cites', async () => {
    await live()
    await w.branch(site(myra), MID)
    await w.join(site(lumpy), MID)
    const c = await w.post(site(kestrel), MID, 'all nine maps play through.', { claim: 'passed' })
    await w.run({ type: 'back', actor: site(lumpy), input: { node: MID, post: c.id, on: true } })
    w.tick(DAY)
    await w.join(site(finn), MID)
    await w.run({ type: 'status', actor: site(finn), input: { node: MID, status: 'on_track' } }) // saves the change to passed
    const mark = await w.post(site(lumpy), MID, 'and the mark cites mine.', { claim: 'passed' })
    await w.run({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: mark.id } })
    const rows = w.all('SELECT event, evidence FROM audit_event ORDER BY rowid')
    for (const r of rows) expect(r.evidence, r.event).toMatch(/^\/w\/[a-z0-9/-]+(#p_[a-z0-9]{10})?$/)
    const ev = (path: string, event: string) => w.events(path, event).map(e => e.evidence)
    expect(ev(BP, 'branch_opened')).toEqual([`/w/${BP}`])
    expect(ev(MID, 'passed')).toEqual([`/w/${MID}#${c.id}`, `/w/${MID}#${mark.id}`])
  })
})
