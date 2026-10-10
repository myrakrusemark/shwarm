// Rule tests for the domain core (go-live 2.3): every refusal, every state transition, the audit log.
import { beforeEach, describe, expect, it } from 'vitest'
import type { Actor } from '../src/core/actor'
import { agent, DAY, HOUR, MIN, person, refused, site, SHA, stepped, World, WORK, type P } from './core-fixtures'

let w: World
let myra: P, kestrel: P, lumpy: P, finn: P
const MID = 'minecraft-in-doom'
const BP = 'minecraft-in-doom/block-placement'

/** minecraft in doom, live from the start, with @kestrel joined (working on it), with the given checks. */
async function live(check: unknown = { author: true }) {
  await w.shwarm(site(myra), { check })
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
    await refused(w.run({ type: 'submit', actor: scoped, input: { node: BP, text: 'x', links: WORK, howToCheck: 'y' } }), 'not_permitted', { need: 'submit', node: BP })
  })

  it('keeps bare-handle acts on the site: joins, sign-off, dead ends', async () => {
    await w.shwarm(site(myra))
    await refused(w.join(agent(kestrel), MID), 'bare_handle_needs_human')
    await w.join(site(kestrel), MID)
    await refused(w.run({ type: 'deadEnd', actor: agent(myra), input: { node: MID, note: 'x' } }), 'bare_handle_needs_human')
    const s = await w.submit(agent(kestrel), MID)
    await refused(w.signOff(agent(myra), MID, s.id), 'bare_handle_needs_human') // the author's agent can't sign off
    await refused(w.pass(agent(lumpy), MID, s.id, { slot: 'author' }), 'bare_handle_needs_human')
    // and the author's check is never an implicit sign-off, from an agent or the site
    await refused(w.pass(agent(myra), MID, s.id), 'not_permitted', { reason: 'sign_off', node: MID })
    const e = await refused(w.pass(stepped(myra), MID, s.id, { text: 'played it' }), 'not_permitted', { reason: 'sign_off' })
    expect(e.message).toBe('your check here is the sign-off, on the submission page')
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
    expect(r).toEqual({ path: MID, kind: 'shwarm', state: 'live', license: 'MIT+CC-BY-4.0', limits: { new_nodes_today: { left: 2 } } })
    expect(w.node(MID)).toMatchObject({ state: 'live', live_at: new Date(w.now).toISOString(), variant_of_id: null })
    expect(w.events(MID)).toEqual([])
    expect(w.all('SELECT person_id, number FROM seat')).toEqual([{ person_id: myra.id, number: 1 }])
    expect(w.all('SELECT tag FROM node_tag ORDER BY tag').map(t => t.tag)).toEqual(['games', 'gzdoom'])
    expect(w.node(MID)).toMatchObject({ posted_by: '@myra', author_id: myra.id, triage: 'pending', in_review: 0 })
  })

  it("opens an agent's shwarm with no one joined; the author is the human at the top", async () => {
    await refused(w.shwarm(agent(myra, 'scribe')), 'not_permitted', { need: 'new_shwarms', node: '*' })
    const r = await w.shwarm(agent(myra, 'scribe', ['new_shwarms']))
    expect(r).toMatchObject({ state: 'live' })
    expect(w.all('SELECT 1 FROM seat')).toEqual([])
    expect(w.node(MID)).toMatchObject({ posted_by: '@myra/scribe', author_id: myra.id })
  })

  it('needs a done test that names at least one check: no_done_test', async () => {
    await refused(w.run({ type: 'createNode', actor: site(myra), input: { kind: 'shwarm', title: 't', what: 'w', doneWhen: '', check: { author: true }, tags: ['x'] } }), 'no_done_test')
    await refused(w.shwarm(site(myra), { check: {} }), 'no_done_test')
    await refused(w.run({ type: 'createNode', actor: site(myra), input: { kind: 'shwarm', title: 't', what: 'w', doneWhen: 'd', check: null, tags: ['x'] } }), 'no_done_test')
    await refused(w.shwarm(site(myra), { check: { author: false, people: 0 } }), 'no_done_test')
  })

  it('takes a license from the short list only: bad_license', async () => {
    await refused(w.shwarm(site(myra), { license: 'CC-BY-NC-4.0' }), 'bad_license')
    expect((await w.shwarm(site(myra), { license: 'GPL-3.0' })).license).toBe('GPL-3.0')
  })

  it('takes the upstream license with builds on', async () => {
    const r = await w.shwarm(site(myra), { license: 'MIT', buildsOn: { name: 'gzdoom', url: 'https://zdoom.org', license: 'GPL-3.0' } })
    expect(r.license).toBe('GPL-3.0')
    await refused(w.shwarm(site(myra), { title: 'other', buildsOn: { name: 'gzdoom' } }), 'bad_license')
  })

  it('takes no lobby and makes no variants (decided Oct 9)', async () => {
    await live()
    await refused(
      w.run({ type: 'createNode', actor: site(lumpy), input: { kind: 'variant', variantOf: MID, title: 'v', what: 'w', doneWhen: 'd', check: { author: true }, tags: ['x'] } as any }),
      'bad_request',
    )
    // a lobby size sent anyway changes nothing: it's live at once
    const r = await w.run({ type: 'createNode', actor: site(lumpy), input: { kind: 'shwarm', title: 'quiet', what: 'w', doneWhen: 'd', check: { author: true }, tags: ['x'], lobby: 12 } as any })
    expect(r).toMatchObject({ state: 'live' })
    expect(w.all("SELECT 1 FROM node WHERE kind = 'variant' OR state = 'lobby'")).toEqual([])
  })

  it('makes slugs from titles, with a suffix when taken', async () => {
    expect((await w.shwarm(site(myra), { title: 'Every US lead pipe, mapped' })).path).toBe('every-us-lead-pipe-mapped')
    expect((await w.shwarm(site(kestrel), { title: 'every us lead pipe mapped!' })).path).toBe('every-us-lead-pipe-mapped-2')
    expect((await w.shwarm(site(lumpy), { title: 'log' })).path).toBe('log-2')
  })

  it('opens branches live at once, inheriting the license, on a shwarm the minute it is posted', async () => {
    await w.shwarm(site(myra), { license: 'GPL-3.0' })
    expect(await w.branch(site(myra), MID, { title: 'first' })).toMatchObject({ path: `${MID}/first`, state: 'live' })
    await refused(w.branch(site(kestrel), 'no-such-thing'), 'no_such_node')
    // An agent key acts only on nodes its human can see (7.4): @myra's shwarm is still being checked.
    await refused(w.branch(agent(kestrel, 'swarm/r-03'), MID), 'no_such_node')
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(MID)
    const b = await w.branch(agent(kestrel, 'swarm/r-03'), MID)
    expect(b).toMatchObject({ path: BP, kind: 'branch', state: 'live', license: 'GPL-3.0' })
    expect(w.node(BP)).toMatchObject({ root_id: w.node(MID).id, parent_id: w.node(MID).id, author_id: kestrel.id, lobby_size: null })
    const sub = await w.branch(site(kestrel), BP, { title: 'monster collision' })
    expect(sub.path).toBe('minecraft-in-doom/block-placement/monster-collision')
    expect(w.node(sub.path).root_id).toBe(w.node(MID).id)
    expect(w.events(BP)).toMatchObject([{ event: 'branch_opened', by_name: '@kestrel/swarm/r-03', milestone: 1 }])
    await refused(w.run({ type: 'createNode', actor: site(kestrel), input: { kind: 'branch', parent: MID, title: 'x', what: 'w', doneWhen: 'd', check: { author: true }, license: 'MIT' } }), 'bad_license')
  })

  it("refuses an agent key every node its human can't see, as not there: parent, builds on (7.4)", async () => {
    await live()
    const keyed = (p: P) => agent(p, 'm-04', ['read', 'branch', 'new_shwarms'])
    // still being checked: only its author, and the author's own agents, can see it
    await refused(w.branch(keyed(kestrel), MID), 'no_such_node')
    expect(await w.branch(keyed(myra), MID)).toMatchObject({ kind: 'branch', state: 'live' })
    w.db.raw.prepare("UPDATE node SET triage = 'held' WHERE path = ?").run(MID)
    await refused(w.branch(keyed(kestrel), MID), 'no_such_node')
    // a closed shwarm held for Myra can't be built on by anyone else's key, and says so as for a path that isn't there
    w.db.raw.prepare("UPDATE node SET state = 'closed' WHERE path = ?").run(MID)
    const buildOn = (by: Actor) => w.shwarm(by, { title: 'speedruns', buildsOn: MID })
    const e = await buildOn(keyed(kestrel)).catch(x => x)
    expect(e).toMatchObject({ code: 'bad_request', message: 'builds_on names a shwarm on shwarm, or an outside project as {name, url, license}' })
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(MID)
    expect(await buildOn(keyed(kestrel))).toMatchObject({ kind: 'shwarm', state: 'live' })
    // builds on is a typed path the site passes on unread, so core asks for site actors too
    w.db.raw.prepare("UPDATE node SET triage = 'held' WHERE path = ?").run(MID)
    expect(await w.shwarm(site(lumpy), { title: 'site build', buildsOn: MID }).catch(x => x)).toMatchObject({ code: 'bad_request', message: e.message })
    // its author still sees it, and may build on it
    expect(await w.shwarm(site(myra), { title: 'site build', buildsOn: MID })).toMatchObject({ kind: 'shwarm', license: 'MIT+CC-BY-4.0' })
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
    expect(await w.join(site(kestrel), MID)).toEqual({ node: MID, joined: true })
    expect(await w.join(site(finn), MID)).toEqual({ node: MID, joined: true })
    expect(await w.join(site(lumpy), MID)).toEqual({ node: MID, joined: true })
    expect(w.all('SELECT person_id FROM seat WHERE left_at IS NULL ORDER BY number').map(r => r.person_id)).toEqual([myra.id, kestrel.id, finn.id, lumpy.id])
    expect(w.node(MID)).toMatchObject({ state: 'live' })
    expect(w.events(MID)).toEqual([])
    expect(w.all('SELECT 1 FROM inbox_item')).toEqual([])
    expect(w.all('SELECT 1 FROM email_outbox')).toEqual([])
  })

  it('lets people leave and join again any time while it is live, not the author; joins are idempotent', async () => {
    await w.shwarm(site(myra))
    await w.join(site(kestrel), MID)
    expect(await w.join(site(kestrel), MID)).toEqual({ node: MID, joined: false })
    expect(await w.run({ type: 'leave', actor: site(kestrel), input: { node: MID } })).toEqual({ node: MID })
    expect(w.get('SELECT left_at FROM seat WHERE person_id = ?', kestrel.id).left_at).toBeTruthy()
    await refused(w.run({ type: 'leave', actor: site(myra), input: { node: MID } }), 'bad_request')
    expect(await w.join(site(kestrel), MID)).toEqual({ node: MID, joined: true })
    expect(w.get('SELECT number, left_at FROM seat WHERE person_id = ?', kestrel.id)).toEqual({ number: 2, left_at: null })
  })

  it('takes submissions at once; refuses joins and leaves where they make no sense', async () => {
    await w.shwarm(site(myra))
    expect((await w.submit(agent(kestrel), MID)).number).toBe(1)
    await w.branch(site(myra), MID)
    await refused(w.join(site(lumpy), BP), 'bad_request')
    await refused(w.run({ type: 'leave', actor: site(lumpy), input: { node: BP } }), 'bad_request')
    await refused(w.join(agent(lumpy), MID), 'bare_handle_needs_human')
    await w.deadEnd(myra, MID)
    await refused(w.join(site(lumpy), MID), 'shwarm_closed')
    await refused(w.run({ type: 'leave', actor: site(kestrel), input: { node: MID } }), 'shwarm_closed')
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

  it("doesn't count checks against the thread limit", async () => {
    await live({ people: 1, author: true })
    const s = await w.submit(agent(kestrel), MID)
    for (let i = 0; i < 5; i++) await w.post(site(lumpy), MID)
    expect((await w.pass(site(lumpy), MID, s.id)).verdict).toBe('pass')
  })
})

describe('submissions', () => {
  it('numbers submissions, hashes them, and supersedes older ones in review', async () => {
    await live({ people: 1, author: true })
    const s1 = await w.submit(agent(kestrel), MID, 'first try')
    const s2 = await w.submit(agent(lumpy), MID, 'second try', { builtOn: [s1.id, { post: s1.id, note: 'root cause' }] })
    expect([s1.number, s2.number]).toEqual([1, 2])
    expect(s1.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(s1.hash).not.toBe(s2.hash)
    expect(w.sub(s1.id)).toMatchObject({ status: 'superseded', superseded_by: s2.id })
    expect(w.sub(s2.id)).toMatchObject({ status: 'in_review', author_swap: 0 })
    expect(w.all('SELECT post_id FROM built_on')).toEqual([{ post_id: s1.id }])
    expect(w.node(MID)).toMatchObject({ next_submission: 3, in_review: 1 })
    expect(s2.checks).toEqual([
      { id: null, slot: 'people', verdict: 'waiting' },
      { id: null, slot: 'author', as: '@myra', verdict: 'waiting' },
    ])
    expect(w.events(MID, 'submission').map(e => [e.by_name, e.number, e.detail])).toEqual([
      ['@kestrel/m-04', 1, `#1 (${s1.hash.slice(0, 7)})`],
      ['@lumpy/m-04', 2, `#2 (${s2.hash.slice(0, 7)})`],
    ])
  })

  it('needs linked work and how to check it', async () => {
    await live()
    await refused(w.submit(agent(kestrel), MID, 'x', { links: [] }), 'bad_request')
    await refused(w.submit(agent(kestrel), MID, 'x', { howToCheck: '' }), 'bad_request')
    await refused(w.submit(agent(kestrel), MID, 'x', { builtOn: ['p_nothere12'] }), 'bad_request')
  })

  it('allows one submission per person per node per rolling day, across all their agents', async () => {
    await live()
    await w.branch(site(myra), MID)
    await w.submit(agent(kestrel, 'a'), MID)
    w.tick(HOUR)
    const e = await refused(w.submit(agent(kestrel, 'b'), MID), 'rate_limited', { limit: 'submissions', person: '@kestrel', node: MID })
    expect(e.details.retry_after).toBe((DAY - HOUR) / 1000)
    expect((await w.submit(agent(kestrel), BP)).number).toBe(1) // another node
    w.tick(DAY)
    expect((await w.submit(agent(kestrel), MID)).number).toBe(2)
  })

  it('tells the author at once when the author is the only check', async () => {
    await live({ author: true })
    const s = await w.submit(agent(kestrel), MID)
    expect(w.all("SELECT person_id, post_id FROM inbox_item WHERE kind = 'sign_off'")).toEqual([{ person_id: myra.id, post_id: s.id }])
  })

  it("swaps the author check for one more people check on the author's own work (A9)", async () => {
    await live({ author: true })
    const s = await w.submit(agent(myra, 'm-07'), MID)
    expect(s.authorSwap).toBe(true)
    expect(s.checks).toEqual([{ id: null, slot: 'people', verdict: 'waiting' }])
    expect(w.all("SELECT 1 FROM inbox_item WHERE kind = 'sign_off'")).toHaveLength(0)
    await refused(w.pass(site(myra), MID, s.id, { text: 'checked it' }), 'own_work') // never on their own agents' work
    const r = await w.pass(site(kestrel), MID, s.id)
    expect(r).toMatchObject({ slot: 'people', submission_state: 'passed', node_state: 'closed' })
  })
})

describe('checks', () => {
  let s: any
  beforeEach(async () => {
    await live({ runs: { command: './soak.sh', count: 1 }, people: 1, author: true })
    s = await w.submit(agent(kestrel), MID)
  })

  it('refuses checks on your own work: own_work', async () => {
    await refused(w.pass(agent(kestrel, 'checker'), MID, s.id), 'own_work')
    await refused(w.pass(site(kestrel), MID, s.id), 'own_work')
  })

  it('allows one slot per person per submission, across slots and agents: slot_taken', async () => {
    await w.runReport(agent(lumpy, 'runner'), MID, s.id, s.hash)
    await refused(w.pass(agent(lumpy, 'other'), MID, s.id), 'slot_taken')
    await refused(w.runReport(site(lumpy), MID, s.id, s.hash), 'slot_taken')
  })

  it('needs an established account for a people check: not_established (founding counts)', async () => {
    const newbie = await person(w.db, 'newbie', { founding: false })
    await refused(w.pass(site(newbie), MID, s.id), 'not_established')
    await refused(w.pass(agent(newbie), MID, s.id), 'not_established')
    // a run report doesn't need it
    expect((await w.runReport(agent(newbie), MID, s.id, s.hash)).slot).toBe('run')
    const later = await person(w.db, 'later', { founding: false, establishedAt: new Date(w.now + DAY).toISOString() })
    await refused(w.pass(site(later), MID, s.id), 'not_established')
    w.tick(DAY)
    expect((await w.pass(site(later), MID, s.id)).slot).toBe('people')
  })

  it('needs evidence for a pass and a repro for a fail', async () => {
    await refused(w.pass(site(lumpy), MID, s.id, { evidence: [], text: 'looks good' }), 'missing_evidence')
    await refused(w.fail(site(lumpy), MID, s.id, { repro: undefined }), 'missing_repro')
    await refused(w.fail(site(lumpy), MID, s.id, { repro: { steps: ' ' } }), 'missing_repro')
    expect((await w.pass(site(lumpy), MID, s.id, { evidence: undefined, log: 'corner 0: 0/200 failed' })).verdict).toBe('pass')
  })

  it('pins run reports to the submission hash: hash_mismatch', async () => {
    await refused(w.runReport(agent(lumpy), MID, s.id, 'deadbeef'), 'hash_mismatch', { expected: s.hash.slice(0, 7) })
    await refused(w.runReport(agent(lumpy), MID, s.id, s.hash.slice(0, 6)), 'hash_mismatch') // 7 characters at least
    const r = await w.runReport(agent(lumpy), MID, s.id, s.hash.toUpperCase())
    expect(r).toMatchObject({ slot: 'run', verdict: 'pass' })
    expect(w.get('SELECT exit_code, machine, script_hash FROM check_report WHERE id = ?', r.id)).toEqual({ exit_code: 0, machine: 'linux, rtx 3060', script_hash: '5d02b7e' })
  })

  it('caps inline logs at 64 KB: log_too_large', async () => {
    await refused(w.runReport(agent(lumpy), MID, s.id, s.hash, 0, { log: 'x'.repeat(65_537) }), 'log_too_large')
    await refused(w.pass(site(lumpy), MID, s.id, { log: 'é'.repeat(40_000) }), 'log_too_large') // bytes, not characters
    const linked = await w.runReport(agent(lumpy), MID, s.id, s.hash, 0, { log: { url: 'https://x.org/log.txt', sha256: SHA('ab') } })
    expect(linked.verdict).toBe('pass')
  })

  it('counts a nonzero exit as a fail with the log as its repro', async () => {
    const r = await w.runReport(agent(lumpy), MID, s.id, s.hash, 3)
    expect(r.verdict).toBe('fail')
    expect(JSON.parse(w.get('SELECT repro FROM check_report WHERE id = ?', r.id).repro).steps).toMatch(/exit 3/)
  })

  it('refuses checks on things that are not submissions: not_a_submission', async () => {
    const p = await w.post(site(lumpy), MID)
    await refused(w.pass(site(finn), MID, p.id), 'not_a_submission')
    await refused(w.pass(site(finn), MID, 'p_nothere12'), 'not_a_submission')
  })

  it('refuses a run report when the done test has no runs', async () => {
    await w.branch(site(myra), MID, { check: { people: 1 } })
    const b = await w.submit(agent(kestrel), BP)
    await refused(w.runReport(agent(lumpy), BP, b.id, b.hash), 'bad_request')
  })

  it('lets only the author sign off', async () => {
    await refused(w.pass(site(lumpy), MID, s.id, { slot: 'author', text: 'i checked' }), 'not_permitted', { need: 'author' })
  })
})

describe('author sign-off and passing', () => {
  let s: any
  beforeEach(async () => {
    await live({ runs: { command: './soak.sh', count: 2 }, people: { count: 1, human: true }, author: true })
    s = await w.submit(agent(kestrel), MID)
  })

  it('makes the author go last, then passes and closes the node in one batch', async () => {
    await refused(w.signOff(myra, MID, s.id, 'pass', { text: 'played it for 10 minutes' }), 'not_permitted', { need: 'other_checks' })
    await w.runReport(agent(lumpy, 'runner'), MID, s.id, s.hash)
    await w.runReport(agent(finn, 'runner'), MID, s.id, s.hash)
    const tallgrass = await person(w.db, 'tallgrass')
    // an agent's people check doesn't satisfy "at least one human"
    await w.pass(agent(tallgrass), MID, s.id)
    expect(w.all("SELECT 1 FROM inbox_item WHERE kind = 'sign_off'")).toHaveLength(0)
    await refused(w.signOff(myra, MID, s.id, 'pass', { text: 'ok' }), 'not_permitted')
    const bmo = await person(w.db, 'bmo_fan')
    expect((await w.pass(site(bmo), MID, s.id)).submission_state).toBe('in_review')
    // ready for the author: one inbox item
    expect(w.all("SELECT person_id, post_id FROM inbox_item WHERE kind = 'sign_off'")).toEqual([{ person_id: myra.id, post_id: s.id }])
    await refused(w.signOff(myra, MID, s.id, 'pass', { evidence: [], text: '' }), 'missing_evidence') // say what you checked
    const r = await w.signOff(myra, MID, s.id, 'pass', { evidence: [], text: 'played it for 10 minutes, no stutter' })
    expect(r).toMatchObject({ slot: 'author', verdict: 'pass', submission_state: 'passed', node_state: 'closed' })
    expect(w.node(MID)).toMatchObject({ state: 'closed', in_review: 0 })
    expect(w.node(MID).closed_at).toBeTruthy()
    expect(w.sub(s.id)).toMatchObject({ status: 'passed', release_title: null })
    const ev = w.events(MID)
    expect(ev.slice(-2)).toMatchObject([
      { event: 'signed_off', by_name: '@myra', number: 1 },
      { event: 'passed', by_name: null, number: 1, submission_id: s.id, milestone: 1 },
    ])
    expect(w.node(MID).last_event_id).toBe(ev.at(-1).id)
    // everyone involved hears about it
    expect(w.all("SELECT COUNT(*) AS n FROM inbox_item WHERE kind = 'system' AND text LIKE '%passed%'")[0].n).toBeGreaterThanOrEqual(4)
    // closed: no new submissions
    await refused(w.submit(agent(lumpy), MID), 'shwarm_closed')
  })

  it("resets every check on the done test when the author fails it", async () => {
    await w.runReport(agent(lumpy), MID, s.id, s.hash)
    await w.runReport(agent(finn), MID, s.id, s.hash)
    const bmo = await person(w.db, 'bmo_fan')
    await w.pass(site(bmo), MID, s.id)
    const r = await w.signOff(myra, MID, s.id, 'fail')
    expect(r).toMatchObject({ slot: 'author', verdict: 'fail', submission_state: 'failed', node_state: 'live', node_checks: 'reset' })
    expect(w.sub(s.id).status).toBe('failed')
    expect(w.all('SELECT slot FROM check_report WHERE reset_at IS NOT NULL ORDER BY slot').map(c => c.slot)).toEqual(['people', 'run', 'run'])
    expect(w.all('SELECT slot FROM check_report WHERE reset_at IS NULL').map(c => c.slot)).toEqual(['author'])
    expect(w.events(MID).slice(-2).map(e => e.event)).toEqual(['signed_off', 'failed'])
    expect(w.node(MID).in_review).toBe(0)
    // checks on the failed submission are refused; the next submission starts from zero
    const tall = await person(w.db, 'tallgrass')
    await refused(w.pass(site(tall), MID, s.id), 'bad_request')
    w.tick(DAY)
    const s2 = await w.submit(agent(kestrel), MID)
    expect((await w.runReport(agent(lumpy), MID, s2.id, s2.hash)).verdict).toBe('pass') // lumpy's slot is free again
  })

  it('lets a standing repro block the pass until a new submission answers it', async () => {
    await w.runReport(agent(lumpy), MID, s.id, s.hash)
    await w.runReport(agent(finn), MID, s.id, s.hash)
    const bmo = await person(w.db, 'bmo_fan')
    const tall = await person(w.db, 'tallgrass')
    await w.fail(site(tall), MID, s.id)
    await w.pass(site(bmo), MID, s.id)
    expect(w.all("SELECT 1 FROM inbox_item WHERE kind = 'sign_off'")).toHaveLength(0)
    await refused(w.signOff(myra, MID, s.id, 'pass', { text: 'fine by me' }), 'not_permitted', { need: 'other_checks' })
    expect(w.sub(s.id).status).toBe('in_review')
  })
})

describe('dead ends, and an ended node is locked (decided Oct 9)', () => {
  /** Every act an ended node refuses, by someone who could do it on a live one; each answers shwarm_closed and writes nothing. */
  async function expectLocked(path: string, o: { own: string; sub: string; state: 'closed' | 'dead_end' }) {
    const before = { posts: w.all('SELECT COUNT(*) AS n FROM post')[0].n, checks: w.all('SELECT COUNT(*) AS n FROM check_report')[0].n, events: w.events(path).length }
    const closed = { node: path, state: o.state }
    await refused(w.post(site(finn), path, 'is this really done?'), 'shwarm_closed', closed)
    await refused(w.post(site(finn), path, 'agreed', { replyTo: o.own }), 'shwarm_closed', closed)
    await refused(w.post(site(myra), path, 'where we are: done', { pin: true }), 'shwarm_closed', closed)
    await refused(w.post(agent(finn), path), 'shwarm_closed', closed)
    await refused(w.run({ type: 'editPost', actor: site(myra), input: { node: path, post: o.own, text: 'changed my mind' } }), 'shwarm_closed', closed)
    await refused(w.run({ type: 'deletePost', actor: site(myra), input: { node: path, post: o.own } }), 'shwarm_closed', closed)
    await refused(w.join(site(finn), path), 'shwarm_closed', closed)
    await refused(w.run({ type: 'leave', actor: site(lumpy), input: { node: path } }), 'shwarm_closed', closed)
    await refused(w.submit(agent(finn), path), 'shwarm_closed', closed)
    await refused(w.pass(site(finn), path, o.sub), 'shwarm_closed', closed)
    await refused(w.fail(site(finn), path, o.sub), 'shwarm_closed', closed) // no repro reopens it
    await refused(w.fail(agent(finn), path, o.sub), 'shwarm_closed', closed)
    expect(w.node(path).state).toBe(o.state)
    expect({ posts: w.all('SELECT COUNT(*) AS n FROM post')[0].n, checks: w.all('SELECT COUNT(*) AS n FROM check_report')[0].n, events: w.events(path).length }).toEqual(before)
  }

  it('keeps a passed node passed: it takes nothing new, and no repro reopens it', async () => {
    await live({ people: 1 })
    await w.join(site(lumpy), MID)
    const own = await w.post(site(myra), MID, 'where we are: one submission in')
    const s = await w.submit(agent(kestrel), MID)
    await w.pass(site(lumpy), MID, s.id)
    expect(w.node(MID).state).toBe('closed')
    const e = await refused(w.post(site(finn), MID), 'shwarm_closed')
    expect(e.message).toBe(`${MID} passed. it's locked: it takes nothing new`)
    await expectLocked(MID, { own: own.id, sub: s.id, state: 'closed' })
    expect(w.sub(s.id).status).toBe('passed')
    expect(w.events(MID, 'reopened')).toEqual([])
    // OPEN (#92): upvotes on its posts still count
    expect((await w.run({ type: 'upvote', actor: site(finn), input: { node: MID, post: own.id } })).up).toBe(true)
  })

  it('lets only the author mark a dead end, with a note; a dead end is locked the same way, for good', async () => {
    await live({ people: 1 })
    await w.join(site(lumpy), MID)
    const own = await w.post(site(myra), MID, 'where we are: stuck on geometry')
    const s = await w.submit(agent(kestrel), MID)
    await refused(w.run({ type: 'deadEnd', actor: site(kestrel), input: { node: MID, note: 'x' } }), 'not_permitted', { need: 'author' })
    await refused(w.run({ type: 'deadEnd', actor: stepped(myra), input: { node: MID, note: '  ' } }), 'bad_request')
    const r = await w.run({ type: 'deadEnd', actor: stepped(myra), input: { node: MID, note: 'gzdoom caps dynamic geometry; 60 fps is out of reach.' } })
    expect(r.state).toBe('dead_end')
    expect(w.node(MID)).toMatchObject({ state: 'dead_end', dead_end_note: 'gzdoom caps dynamic geometry; 60 fps is out of reach.' })
    expect(w.get('SELECT kind, text FROM post WHERE id = ?', r.post)).toMatchObject({ kind: 'dead_end' })
    const e = await refused(w.submit(agent(kestrel), MID), 'shwarm_closed')
    expect(e.message).toBe(`${MID} is a dead end. it's locked: it takes nothing new`)
    await expectLocked(MID, { own: own.id, sub: s.id, state: 'dead_end' })
    // nothing reopens it: there is no such command, and marking it again is refused
    await refused(w.run({ type: 'reopen', actor: stepped(myra), input: { node: MID } } as any), 'bad_request')
    await refused(w.deadEnd(myra, MID), 'shwarm_closed')
    expect(w.events(MID).map(e => e.event)).toEqual(['submission', 'dead_end'])
  })

  it('lets a shwarm be a dead end the minute it is posted', async () => {
    await w.shwarm(site(myra))
    expect((await w.run({ type: 'deadEnd', actor: stepped(myra), input: { node: MID, note: 'x' } })).state).toBe('dead_end')
  })

  it('never lets a branch passing touch its parent', async () => {
    await live()
    await w.branch(site(myra), MID, { check: { people: 1 } })
    const s = await w.submit(agent(kestrel), BP)
    await w.pass(site(lumpy), BP, s.id)
    expect(w.node(BP).state).toBe('closed')
    expect(w.node(MID).state).toBe('live')
    expect(w.events(MID).map(e => e.event)).toEqual([])
  })

  // OPEN (#92): a branch still live under an ended shwarm is locked with it, so the result page's tree stops growing.
  for (const end of ['passed', 'dead_end'] as const)
    it(`locks a live branch with its shwarm once the shwarm ${end === 'passed' ? 'passed' : 'is a dead end'}`, async () => {
      await live({ people: 1 })
      await w.branch(site(myra), MID, { check: { people: 1 } })
      const own = await w.post(site(finn), BP, 'corner case on slabs')
      const s = await w.submit(agent(kestrel), BP)
      if (end === 'passed') await w.pass(site(lumpy), MID, (await w.submit(agent(kestrel), MID)).id)
      else await w.run({ type: 'deadEnd', actor: stepped(myra), input: { node: MID, note: 'out of reach' } })
      const state = end === 'passed' ? 'closed' : 'dead_end'
      expect(w.node(MID).state).toBe(state)
      const before = { posts: w.all('SELECT COUNT(*) AS n FROM post')[0].n, nodes: w.all('SELECT COUNT(*) AS n FROM node')[0].n, events: w.events(BP).length }
      const locked = { node: BP, state, locked_by: MID }
      const e = await refused(w.post(site(finn), BP, 'still going?'), 'shwarm_closed', locked)
      expect(e.message).toBe(`${MID} ${end === 'passed' ? 'passed' : 'is a dead end'}. it's locked: it takes nothing new`)
      await refused(w.post(agent(finn), BP), 'shwarm_closed', locked)
      await refused(w.run({ type: 'editPost', actor: site(finn), input: { node: BP, post: own.id, text: 'changed' } }), 'shwarm_closed', locked)
      await refused(w.run({ type: 'deletePost', actor: site(finn), input: { node: BP, post: own.id } }), 'shwarm_closed', locked)
      await refused(w.submit(agent(lumpy), BP), 'shwarm_closed', locked)
      await refused(w.pass(site(lumpy), BP, s.id), 'shwarm_closed', locked)
      await refused(w.branch(site(kestrel), BP, { title: 'monster collision' }), 'shwarm_closed', locked)
      await refused(w.run({ type: 'deadEnd', actor: stepped(myra), input: { node: BP, note: 'x' } }), 'shwarm_closed', locked)
      expect(w.node(BP).state).toBe('live')
      expect({ posts: w.all('SELECT COUNT(*) AS n FROM post')[0].n, nodes: w.all('SELECT COUNT(*) AS n FROM node')[0].n, events: w.events(BP).length }).toEqual(before)
    })
})

describe('the audit log', () => {
  it('uses only the nine event types (eight written now), with prefixed random ids', async () => {
    await live({ people: 1, author: true })
    await w.branch(site(myra), MID)
    const s = await w.submit(agent(kestrel), MID)
    await w.pass(site(lumpy), MID, s.id)
    await w.signOff(myra, MID, s.id, 'pass', { text: 'checked' })
    const rows = w.all('SELECT id, event FROM audit_event')
    for (const r of rows) expect(r.id).toMatch(/^e_[a-z0-9]{10}$/)
    expect(new Set(rows.map(r => r.event))).toEqual(new Set(['branch_opened', 'submission', 'check', 'signed_off', 'passed']))
    for (const c of w.all('SELECT id FROM check_report')) expect(c.id).toMatch(/^c_[a-z0-9]{10}$/)
  })

  it('commits nothing when a command is refused', async () => {
    await live({ people: 1 })
    const before = w.all('SELECT COUNT(*) AS n FROM post')[0].n
    await refused(w.submit(agent(kestrel), MID, 'x', { links: [{ url: 'ftp://x', sha256: SHA('a') }] }), 'bad_request')
    expect(w.all('SELECT COUNT(*) AS n FROM post')[0].n).toBe(before)
    expect(w.all('SELECT COUNT(*) AS n FROM rate_bucket')[0].n).toBe(0)
  })
})

/** Run `fn` just before the next batch commits: another tree's write landing between this command's read and its write. */
function beforeNextBatch(fn: () => void) {
  const db = w.db as any
  const batch = db.batch
  db.batch = async (stmts: unknown[]) => {
    db.batch = batch
    fn()
    return batch(stmts)
  }
}

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

  it('builds on a shwarm that passed or is a dead end, never on a live one (decided Oct 9)', async () => {
    await live({ people: 1 })
    const clear = () => w.db.raw.prepare("UPDATE node SET triage = 'clear'").run() // others see them
    clear()
    const e = await refused(w.shwarm(site(finn), { title: 'speedruns', buildsOn: MID }), 'bad_request')
    expect(e.message).toBe(`${MID} is still live. a shwarm is built on once it passed or is a dead end`)
    await w.deadEnd(myra, MID)
    expect(await w.shwarm(site(finn), { title: 'speedruns', buildsOn: MID })).toMatchObject({ kind: 'shwarm', state: 'live', license: 'MIT+CC-BY-4.0' })
    expect(w.node('speedruns').builds_on).toBe(JSON.stringify({ node: MID }))
    // the guard inside the batch takes a dead end too
    await w.shwarm(site(myra), { title: 'other', check: { people: 1 } })
    const s = await w.submit(agent(kestrel), 'other')
    await w.pass(site(lumpy), 'other', s.id)
    clear()
    beforeNextBatch(() => w.db.raw.prepare("UPDATE node SET state = 'dead_end', dead_end_note = 'x' WHERE path = 'other'").run())
    expect(await w.shwarm(site(lumpy), { title: 'other 2', buildsOn: 'other' })).toMatchObject({ kind: 'shwarm' })
  })

  it('refuses builds_on when the upstream goes back to live before the create commits (a reopen before Oct 9)', async () => {
    await live({ people: 1 })
    const s = await w.submit(agent(kestrel), MID)
    await w.pass(site(lumpy), MID, s.id)
    expect(w.node(MID).state).toBe('closed')
    beforeNextBatch(() => w.db.raw.prepare("UPDATE node SET state = 'live', closed_at = NULL WHERE path = ?").run(MID))
    await refused(w.shwarm(site(finn), { title: 'minecraft in doom 2', buildsOn: MID }), 'bad_request')
    expect(w.node('minecraft-in-doom-2')).toBeUndefined()
  })

  it('refuses a path longer than a node can be loaded by', async () => {
    const long = (c: string) => c.repeat(80)
    await w.run({ type: 'createNode', actor: seed(myra), input: { kind: 'shwarm', title: long('r'), what: 'w', doneWhen: 'd', check: { author: true }, tags: ['x'] } })
    let path = long('r')
    for (let i = 0; i < 6; i++) path = (await w.run<any>({ type: 'createNode', actor: seed(myra), input: { kind: 'branch', parent: path, title: long('b'), what: 'w', doneWhen: 'd', check: { author: true } } })).path
    expect(path.length).toBe(566)
    expect((await w.post(site(kestrel), path)).node).toBe(path) // the deepest node still works
    await refused(w.run({ type: 'createNode', actor: seed(myra), input: { kind: 'branch', parent: path, title: long('b'), what: 'w', doneWhen: 'd', check: { author: true } } }), 'bad_request')
    expect(w.all('SELECT COUNT(*) AS n FROM node')[0].n).toBe(7)
  })
})

describe('an author fail on a node reopened before Oct 9', () => {
  it('resets checks only on submissions that never passed, and leaves the old pass on record', async () => {
    await live() // author only
    const s1 = await w.submit(agent(kestrel), MID)
    await w.signOff(myra, MID, s1.id, 'pass', { text: 'played it, works' })
    expect(w.node(MID).state).toBe('closed')
    // A node a repro reopened before nothing reopened (decided Oct 9): live again, its pass on record.
    w.db.raw.prepare("UPDATE node SET state = 'live', closed_at = NULL WHERE path = ?").run(MID)
    await refused(w.fail(site(lumpy), MID, s1.id), 'bad_request') // the old pass takes no checks
    const s2 = await w.submit(agent(finn), MID)
    expect((await w.signOff(myra, MID, s2.id, 'fail')).node_checks).toBe('reset')
    // #1's sign-off stands
    expect(w.all('SELECT reset_at FROM check_report WHERE submission_id = ?', s1.id).map(c => c.reset_at)).toEqual([null])
    expect(w.sub(s1.id).status).toBe('passed')
    // and the author can't fail the passed submission now
    await refused(w.signOff(myra, MID, s1.id, 'fail'), 'bad_request')
    await refused(w.signOff(myra, MID, s1.id, 'pass', { text: 'again' }), 'bad_request')
    expect(w.sub(s1.id).status).toBe('passed')
    expect(w.events(MID, 'failed').map(e => e.number)).toEqual([2])
  })
})

describe('the in review flag and the ETag', () => {
  it('shows in review only on a live node', async () => {
    await live()
    await w.submit(agent(kestrel), MID)
    expect(w.node(MID).in_review).toBe(1)
    await w.run({ type: 'deadEnd', actor: stepped(myra), input: { node: MID, note: 'the engine cannot do it' } })
    expect(w.node(MID)).toMatchObject({ state: 'dead_end', in_review: 0 })
  })

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

describe('release fields and built_on notes (go-live 5.1)', () => {
  it('stores the optional release fields with the submission, and refuses them over their caps', async () => {
    await live({ people: 1 })
    const release = { name: 'minecraft in doom v1.0', version: 'e9b41d0', howToUse: 'gzdoom -iwad freedoom2.wad -file mid-v1.pk3' }
    for (const [bad, field] of [
      [{ name: 'x'.repeat(121) }, 'release.name'],
      [{ version: 'v'.repeat(51) }, 'release.version'],
      [{ howToUse: 'y'.repeat(2001) }, 'release.how_to_use'],
      [{ name: 'v1.0\nand more' }, 'release.name'],
      [{ howToUse: 'gzdoom‮ -file evil.pk3' }, 'release.how_to_use'],
    ] as const)
      await refused(w.submit(agent(kestrel), MID, 'x', { release: bad }), 'bad_request', { field })
    await refused(w.submit(agent(kestrel), MID, 'x', { release: { title: 'v1' } }), 'bad_request')
    expect(w.all('SELECT 1 FROM submission')).toHaveLength(0)
    const s = await w.submit(agent(kestrel), MID, 'v1, the whole mod.', { release })
    expect(w.sub(s.id)).toMatchObject({ release_title: release.name, release_version: release.version, release_how_to_use: release.howToUse, release_summary: null })
    // all three are optional, and none is part of the submission hash
    w.tick(DAY)
    const bare = await w.submit(agent(kestrel), MID, 'v1, the whole mod.')
    expect(w.sub(bare.id)).toMatchObject({ release_title: null, release_version: null, release_how_to_use: null })
    expect(bare.hash).toBe(s.hash)
  })

  it('keeps the note on each built_on post; the first note given wins', async () => {
    await live({ people: 1 })
    const finn1 = await w.post(site(finn), MID, 'P_CheckSight treats the voxel faces as 2-sided lines.')
    const repro = await w.post(site(lumpy), MID, 'repro for the corner case.')
    await refused(w.submit(agent(kestrel), MID, 'x', { builtOn: [{ post: finn1.id, note: 'n'.repeat(281) }] }), 'bad_request')
    const s = await w.submit(agent(kestrel), MID, 'two-line fix.', { builtOn: [{ post: finn1.id, note: 'root cause' }, repro.id, { post: finn1.id, note: 'again' }, { post: repro.id, note: 'the repro' }] })
    expect(w.all('SELECT post_id, note FROM built_on WHERE submission_id = ? ORDER BY note', s.id)).toEqual([
      { post_id: finn1.id, note: 'root cause' },
      { post_id: repro.id, note: 'the repro' },
    ])
  })
})

describe('the sign-off is asked for by name, behind the password (A5)', () => {
  it('refuses an author slot without the step-up, and writes nothing', async () => {
    await live({ people: 1, author: true })
    const s = await w.submit(agent(kestrel), MID)
    await w.pass(site(lumpy), MID, s.id)
    const e = await refused(w.signOff(site(myra), MID, s.id), 'not_permitted', { need: 'step_up' })
    expect(e.message).toBe('the author sign-off confirms with your password')
    expect(w.all("SELECT 1 FROM check_report WHERE slot = 'author'")).toHaveLength(0)
    expect((await w.signOff(myra, MID, s.id)).submission_state).toBe('passed')
  })

  it('gates dead ends on the step-up too; the seed import is exempt', async () => {
    await live()
    await refused(w.deadEnd(site(myra), MID), 'not_permitted', { need: 'step_up' })
    await refused(w.deadEnd(site(kestrel), MID), 'not_permitted', { need: 'author' }) // not the author: said first
    expect((await w.deadEnd(seed(myra), MID)).state).toBe('dead_end')
  })
})

describe('author gone: the operator signs off (table B)', () => {
  let s: any, ops: P
  beforeEach(async () => {
    await live({ people: 1, author: true })
    ops = await person(w.db, 'ops')
    await w.db.prepare('UPDATE person SET is_admin = 1 WHERE id = ?').bind(ops.id).run()
    s = await w.submit(agent(kestrel), MID)
    await w.pass(site(lumpy), MID, s.id)
  })
  const gone = (status: 'suspended' | 'closed' | 'active') => w.db.prepare('UPDATE person SET status = ? WHERE id = ?').bind(status, myra.id).run()

  it('lets an admin take the author slot while the author is suspended, behind the password, logged as such', async () => {
    await refused(w.signOff(ops, MID, s.id), 'not_permitted', { need: 'author' }) // the author is active: not the operator's call
    await gone('suspended')
    await refused(w.signOff(site(ops), MID, s.id), 'not_permitted', { need: 'step_up' })
    const r = await w.signOff(ops, MID, s.id)
    expect(r).toMatchObject({ slot: 'author', verdict: 'pass', submission_state: 'passed', node_state: 'closed' })
    expect(w.events(MID, 'signed_off')[0]).toMatchObject({ by_name: '@ops', number: 1, detail: 'pass · author on #1 · author gone, signed off by the operator' })
  })

  it('covers a closed account too; a non-admin is still refused; the slot goes back when the author is active again', async () => {
    await gone('closed')
    await refused(w.signOff(finn, MID, s.id), 'not_permitted', { need: 'author' })
    await gone('active')
    await refused(w.signOff(ops, MID, s.id), 'not_permitted', { need: 'author' })
    expect((await w.signOff(myra, MID, s.id)).submission_state).toBe('passed')
    expect(w.events(MID, 'signed_off')[0].detail).toBe('pass · author on #1')
  })

  it('keeps the usual refusals for the operator: one slot per person', async () => {
    await gone('suspended')
    await w.pass(site(ops), MID, s.id) // an ordinary people check, one past the count
    await refused(w.signOff(ops, MID, s.id), 'slot_taken')
  })
})

describe('a closed node takes no checks, not even a repro (decided Oct 9)', () => {
  it('refuses a pass, a fail and a failing run on any submission, with shwarm_closed', async () => {
    await live({ runs: { command: './soak.sh', count: 1 }, people: 1 })
    const s1 = await w.submit(agent(kestrel), MID)
    const s2 = await w.submit(agent(lumpy), MID) // supersedes #1
    await w.runReport(agent(finn), MID, s2.id, s2.hash)
    expect((await w.pass(site(myra), MID, s2.id)).node_state).toBe('closed')
    const tall = await person(w.db, 'tallgrass')
    const closed = { node: MID, state: 'closed' }
    await refused(w.pass(site(tall), MID, s2.id), 'shwarm_closed', closed)
    await refused(w.runReport(agent(tall), MID, s2.id, s2.hash), 'shwarm_closed', closed) // exit 0 is a pass
    await refused(w.runReport(agent(tall), MID, s2.id, s2.hash, 1), 'shwarm_closed', closed) // a failing run reopens nothing
    await refused(w.fail(site(tall), MID, s2.id), 'shwarm_closed', closed)
    await refused(w.fail(site(tall), MID, s1.id), 'shwarm_closed', closed)
    expect(w.all('SELECT COUNT(*) AS n FROM check_report')[0].n).toBe(2)
    expect(w.node(MID).state).toBe('closed')
  })
})

describe('ready for the author: the inbox item and the mail (go-live 5.4)', () => {
  const signOffs = () => w.all("SELECT person_id, post_id, done_at FROM inbox_item WHERE kind = 'sign_off' ORDER BY id")
  const mails = () => w.all("SELECT to_email, person_id, template, stream, payload FROM email_outbox WHERE template = 'sign_off_ready' ORDER BY id")

  it('writes both once, on the final check, to the author', async () => {
    await live({ people: 2, author: true })
    const s = await w.submit(agent(kestrel), MID)
    await w.pass(site(lumpy), MID, s.id)
    expect(signOffs()).toEqual([])
    expect(mails()).toEqual([])
    await w.pass(site(finn), MID, s.id)
    const tall = await person(w.db, 'tallgrass')
    await w.pass(site(tall), MID, s.id) // one more than needed: no second notice
    expect(signOffs()).toEqual([{ person_id: myra.id, post_id: s.id, done_at: null }])
    const m = mails()
    expect(m).toHaveLength(1)
    expect({ ...m[0], payload: JSON.parse(m[0].payload) }).toEqual({
      to_email: 'myra@example.org',
      person_id: myra.id,
      template: 'sign_off_ready',
      stream: 'notices',
      payload: { notice: 'sign_off', handle: 'myra', number: 1, title: 'minecraft in doom', link: '/w/minecraft-in-doom/s/1' },
    })
  })

  it('writes both at submit when the author is the only check', async () => {
    await live({ author: true })
    const s = await w.submit(agent(kestrel), MID)
    expect(signOffs()).toEqual([{ person_id: myra.id, post_id: s.id, done_at: null }])
    expect(mails().map(r => JSON.parse(r.payload))).toEqual([{ notice: 'sign_off', handle: 'myra', number: 1, title: 'minecraft in doom', link: '/w/minecraft-in-doom/s/1', only: true }])
  })

  it('author gone: the item and the mail go to the admins, never to the suspended author', async () => {
    await live({ author: true })
    const ops = await person(w.db, 'ops')
    await w.db.prepare('UPDATE person SET is_admin = 1 WHERE id = ?').bind(ops.id).run()
    await w.db.prepare("UPDATE person SET status = 'suspended' WHERE id = ?").bind(myra.id).run()
    const s = await w.submit(agent(kestrel), MID)
    expect(signOffs()).toEqual([{ person_id: ops.id, post_id: s.id, done_at: null }])
    expect(w.get("SELECT text FROM inbox_item WHERE kind = 'sign_off'").text).toBe('#1 on minecraft in doom is ready for sign-off. its author is gone, so the operator signs off.')
    const m = mails()
    expect(m.map(r => [r.to_email, r.person_id])).toEqual([['ops@example.org', ops.id]])
    expect(JSON.parse(m[0].payload)).toEqual({ notice: 'sign_off', handle: 'ops', number: 1, title: 'minecraft in doom', link: '/w/minecraft-in-doom/s/1', only: true, author: 'myra', author_gone: true })
  })

  it('marks the item done when the submission passes, fails or is replaced', async () => {
    await live({ author: true })
    const s1 = await w.submit(agent(kestrel), MID)
    const s2 = await w.submit(agent(lumpy), MID) // replaces #1
    expect(signOffs().map(i => [i.post_id, i.done_at])).toEqual([[s1.id, w.get('SELECT created_at FROM post WHERE id = ?', s2.id).created_at], [s2.id, null]])
    w.tick(HOUR)
    await w.signOff(myra, MID, s2.id, 'fail')
    expect(signOffs()[1].done_at).toBe(new Date(w.now).toISOString())
    w.tick(DAY)
    const s3 = await w.submit(agent(kestrel), MID)
    await w.signOff(myra, MID, s3.id, 'pass')
    expect(signOffs().map(i => i.done_at === null)).toEqual([false, false, false])
  })

  it('marks the item done when a fail lands after the author was asked, since the sign-off is blocked', async () => {
    await live({ people: 1, author: true })
    const s = await w.submit(agent(kestrel), MID)
    await w.pass(site(lumpy), MID, s.id)
    expect(signOffs()).toEqual([{ person_id: myra.id, post_id: s.id, done_at: null }])
    w.tick(HOUR)
    await w.fail(site(finn), MID, s.id) // one past the count, and a fail
    expect(signOffs()[0].done_at).toBe(new Date(w.now).toISOString())
    await refused(w.signOff(myra, MID, s.id, 'pass'), 'not_permitted', { need: 'other_checks' })
    expect(mails()).toHaveLength(1)
  })

  it('takes the item off for good when the node becomes a dead end, with no second mail', async () => {
    await live({ people: 1, author: true })
    const s = await w.submit(agent(kestrel), MID)
    await w.pass(site(lumpy), MID, s.id)
    w.tick(HOUR)
    await w.deadEnd(myra, MID)
    expect(signOffs()[0].done_at).toBe(new Date(w.now).toISOString())
    w.tick(DAY)
    await refused(w.signOff(myra, MID, s.id, 'pass'), 'shwarm_closed', { node: MID, state: 'dead_end' })
    expect(signOffs()[0].done_at).not.toBeNull()
    expect(mails()).toHaveLength(1)
  })
})

describe('every audit row links its evidence', () => {
  it('as a site path: the node, the post, the submission or one check on it', async () => {
    await live({ people: 1, author: true })
    await w.branch(site(myra), MID, { check: { people: 1 } })
    const d = await w.deadEnd(myra, BP) // before the pass: a branch under a passed shwarm is locked with it
    const s1 = await w.submit(agent(kestrel), MID)
    const c1 = await w.pass(site(lumpy), MID, s1.id)
    const f1 = await w.signOff(myra, MID, s1.id, 'fail')
    w.tick(DAY)
    const s2 = await w.submit(agent(kestrel), MID)
    await w.pass(site(lumpy), MID, s2.id)
    const p2 = await w.signOff(myra, MID, s2.id, 'pass')

    const rows = w.all('SELECT event, evidence FROM audit_event ORDER BY rowid')
    // every event type written now ('lobby_filled' went with the lobby, 'reopened' when nothing reopened, Oct 9)
    expect(new Set(rows.map(r => r.event)).size).toBe(7)
    for (const r of rows) expect(r.evidence, r.event).toMatch(/^\/w\/[a-z0-9/-]+(\/s\/\d+)?(#[cp]_[a-z0-9]{10})?$/)
    const ev = (path: string, event: string) => w.events(path, event).map(e => e.evidence)
    expect(ev(BP, 'branch_opened')).toEqual([`/w/${BP}`])
    expect(ev(MID, 'submission')).toEqual([`/w/${MID}/s/1`, `/w/${MID}/s/2`])
    expect(ev(MID, 'check')[0]).toBe(`/w/${MID}/s/1#${c1.id}`)
    expect(ev(MID, 'signed_off')).toEqual([`/w/${MID}/s/1#${f1.id}`, `/w/${MID}/s/2#${p2.id}`])
    expect(ev(MID, 'failed')).toEqual([`/w/${MID}/s/1`])
    expect(ev(MID, 'passed')).toEqual([`/w/${MID}/s/2`])
    expect(ev(BP, 'dead_end')).toEqual([`/w/${BP}#${d.post}`])
  })
})
