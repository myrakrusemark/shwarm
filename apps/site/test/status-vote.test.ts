// Oct 13: a branch's status is a live vote, activity sorts the branch list, and agents can pin for their person
// (decided Oct 13: "One vote per person on each branch ... Status is fluid. Always changing. Any agent can drop in and
// vote on the status"; "I think activity should determine sorting"; "Maybe quiet for more than 48h?"; "Sure we can give
// pin permission to agents as an option"). Core, the read side, the API, the briefing and the page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { closeAccount } from '../src/auth/close'
import { hashPassword } from '../src/auth/password'
import { readChildren } from '../src/read/node'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { ALL_PERMS, keyFor, send, verifiedPerson } from './agent-client'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { hasResponse, responseSchema, schemaErrors } from './contract'
import { agent, DAY, HOUR, person, refused, site, World, type P } from './core-fixtures'
import { addPerson, T0 } from './d1'
import { stagingWorld } from './node-fixture'

const MID = 'minecraft-in-doom'
const BP = 'minecraft-in-doom/block-placement'
const CORNERS = 'minecraft-in-doom/corners'
const DEEP = 'minecraft-in-doom/block-placement/edges'

let w: World
let myra: P, kestrel: P, lumpy: P

const vote = (by: Parameters<World['post']>[0], node: string, status: unknown) => w.run({ type: 'status', actor: by, input: { node, status } })
const rows = (path: string) =>
  w.all('SELECT p.handle, v.status, v.as_name FROM status_vote v JOIN person p ON p.id = v.person_id JOIN node n ON n.id = v.node_id WHERE n.path = ? ORDER BY p.handle', path)
const tally = (o: Partial<Record<'on_track' | 'blocked' | 'passed' | 'dead_end', number>>) => {
  const t = { on_track: 0, blocked: 0, passed: 0, dead_end: 0, ...o }
  return { ...t, people: t.on_track + t.blocked + t.passed + t.dead_end }
}

beforeEach(async () => {
  w = new World()
  myra = await person(w.db, 'myra')
  kestrel = await person(w.db, 'kestrel')
  lumpy = await person(w.db, 'lumpy')
  await w.shwarm(site(myra))
  await w.branch(site(myra), MID)
})

describe("a branch's status vote (decided Oct 13)", () => {
  it('one vote per person: cast, changed any time, taken back; the same vote again changes nothing', async () => {
    expect(await vote(site(kestrel), BP, 'on_track')).toEqual({ node: BP, as: '@kestrel', person: '@kestrel', status: 'on_track', changed: true, votes: tally({ on_track: 1 }) })
    await vote(site(lumpy), BP, 'on_track')
    w.tick(HOUR)
    expect(await vote(site(kestrel), BP, 'blocked')).toMatchObject({ status: 'blocked', changed: true, votes: tally({ on_track: 1, blocked: 1 }) })
    expect(rows(BP)).toEqual([
      { handle: 'kestrel', status: 'blocked', as_name: '@kestrel' },
      { handle: 'lumpy', status: 'on_track', as_name: '@lumpy' },
    ])
    const at = w.get('SELECT at FROM status_vote WHERE person_id = ?', kestrel.id).at
    w.tick(HOUR)
    expect(await vote(site(kestrel), BP, 'blocked')).toMatchObject({ status: 'blocked', changed: false })
    expect(w.get('SELECT at FROM status_vote WHERE person_id = ?', kestrel.id).at).toBe(at)
    expect(await vote(site(kestrel), BP, null)).toMatchObject({ status: null, changed: true, votes: tally({ on_track: 1 }) })
    expect(await vote(site(kestrel), BP, null)).toMatchObject({ status: null, changed: false })
    expect(rows(BP)).toEqual([{ handle: 'lumpy', status: 'on_track', as_name: '@lumpy' }])
  })

  it("an agent casts or changes its human's one vote with post on the branch; never the bare handle", async () => {
    const claude = agent(kestrel, 'claude', ['read', 'post'])
    const codex = agent(kestrel, 'codex', ['read', 'post'])
    expect(await vote(claude, BP, 'passed')).toMatchObject({ as: '@kestrel/claude', person: '@kestrel', status: 'passed', votes: tally({ passed: 1 }) })
    expect(await vote(codex, BP, 'blocked')).toMatchObject({ as: '@kestrel/codex', person: '@kestrel', status: 'blocked', votes: tally({ blocked: 1 }) })
    expect(rows(BP)).toEqual([{ handle: 'kestrel', status: 'blocked', as_name: '@kestrel/codex' }])
    await vote(site(kestrel), BP, 'on_track') // the person, on the site: still the same one vote
    expect(rows(BP)).toEqual([{ handle: 'kestrel', status: 'on_track', as_name: '@kestrel' }])
    await refused(vote(agent(kestrel, 'reader', ['read']), BP, 'passed'), 'not_permitted', { need: 'post' })
    await refused(vote({ ...claude, as: '@kestrel' }, BP, 'passed'), 'bare_handle_needs_human')
  })

  it('only a branch has one; the four statuses or null; a locked branch takes none', async () => {
    await refused(vote(site(kestrel), MID, 'on_track'), 'bad_request', { field: 'node' })
    for (const s of ['stale', 'working', 'done', 'On_Track', '', 3, undefined]) await refused(vote(site(kestrel), BP, s), 'bad_request', { field: 'status' })
    await vote(site(kestrel), BP, 'dead_end')
    await w.deadEnd(myra, BP)
    await refused(vote(site(kestrel), BP, 'passed'), 'shwarm_closed')
    expect(rows(BP)).toEqual([{ handle: 'kestrel', status: 'dead_end', as_name: '@kestrel' }]) // kept, as the votes stood
  })

  it("the badge: the status more than half chose, else mixed; none with no votes (Oct 13)", async () => {
    const { statusNow } = await import('../src/core/status')
    expect(statusNow(tally({}))).toBeNull()
    expect(statusNow(tally({ on_track: 3, blocked: 1, passed: 1 }))).toBe('on_track')
    expect(statusNow(tally({ on_track: 1, passed: 1 }))).toBe('mixed')
    expect(statusNow(tally({ on_track: 2, blocked: 1, passed: 1, dead_end: 1 }))).toBe('mixed')
    expect(statusNow(tally({ dead_end: 2, on_track: 1 }))).toBe('dead_end')
  })

  it("is the branch's pass: passed while more than half of the voters say so, and that changes (decided Oct 13)", async () => {
    const { passedByVote } = await import('../src/core/status')
    const t = async () => (await vote(site(myra), BP, null), (await vote(site(myra), BP, 'on_track')).votes)
    expect(passedByVote((await vote(site(kestrel), BP, 'passed')).votes)).toBe(true) // 1 of 1
    expect(passedByVote(await t())).toBe(false) // 1 of 2: not more than half
    expect(passedByVote((await vote(site(lumpy), BP, 'passed')).votes)).toBe(true) // 2 of 3
    expect(passedByVote((await vote(site(lumpy), BP, 'blocked')).votes)).toBe(false) // changed back: 1 of 3
    expect(w.node(BP).state).toBe('live') // it locks nothing
  })

  it('moves the branch and its parent, so both signed-out pages change', async () => {
    const before = [w.node(BP).last_event_id, w.node(MID).last_event_id]
    await vote(site(kestrel), BP, 'on_track')
    expect(w.node(BP).last_event_id).not.toBe(before[0])
    expect(w.node(MID).last_event_id).not.toBe(before[1])
  })

  it('closing an account takes its votes away', async () => {
    await vote(site(kestrel), BP, 'on_track')
    await vote(site(lumpy), BP, 'blocked')
    expect(await closeAccount(w.db, kestrel.id, w.now)).toMatchObject({ handle: 'kestrel' })
    expect(rows(BP)).toEqual([{ handle: 'lumpy', status: 'blocked', as_name: '@lumpy' }])
  })
})

describe('agents can pin for their person (decided Oct 13)', () => {
  it('with the pin permission, only on a node their human wrote, only a post of its own', async () => {
    const pinner = agent(myra, 'claude', ['read', 'post', 'pin'])
    const p = await w.post(pinner, MID, 'status update: three branches open.', { pin: true })
    expect(w.node(MID).pinned_post_id).toBe(p.id)
    expect(w.get('SELECT as_name FROM post WHERE id = ?', p.id).as_name).toBe('@myra/claude')
    await refused(w.post(pinner, MID, 'a pinned reply?', { pin: true, replyTo: p.id }), 'bad_request')
    await refused(w.post(agent(myra, 'codex', ['read', 'post']), MID, 'no pin here', { pin: true }), 'not_permitted', { need: 'pin' })
    await w.join(site(kestrel), MID)
    await refused(w.post(agent(kestrel, 'claude', ['read', 'post', 'pin']), MID, 'mine now', { pin: true }), 'not_permitted', { need: 'author' })
    expect(w.node(MID).pinned_post_id).toBe(p.id)
  })
})

describe('the branch list: activity sorts, quiet is measured, votes are shown (decided Oct 13)', () => {
  const clear = () => w.db.raw.prepare("UPDATE node SET triage = 'clear'").run()
  const list = async () => (await readChildren(w.db, w.node(MID).id, w.now)).branches.map(b => ({ path: b.path, quiet: b.quiet, week: b.week_posts, votes: b.votes.people }))

  it('active branches first, busiest over 7 days first; quiet after 48 hours, longest quiet last; a sub-branch counts for its branch', async () => {
    // three new nodes a day per person: corners and textures come from others
    await w.branch(site(kestrel), MID, { title: 'corners' })
    await w.branch(site(lumpy), MID, { title: 'textures' })
    await w.branch(site(myra), BP, { title: 'edges' })
    clear()
    w.tick(60_000)
    await w.post(site(kestrel), CORNERS, 'one')
    await w.post(site(kestrel), CORNERS, 'two')
    w.tick(HOUR)
    await w.post(site(kestrel), BP, 'one')
    // all three active: corners is busiest
    expect((await list()).map(b => b.path)).toEqual([CORNERS, BP, 'minecraft-in-doom/textures'])
    // three days on, all quiet: most recently active first (block placement, then corners, then textures by its creation)
    w.tick(3 * DAY)
    expect(await list()).toEqual([
      { path: BP, quiet: true, week: 1, votes: 0 },
      { path: CORNERS, quiet: true, week: 2, votes: 0 },
      { path: 'minecraft-in-doom/textures', quiet: true, week: 0, votes: 0 },
    ])
    // a post in block placement's sub-branch wakes block placement; a vote doesn't
    await w.post(site(lumpy), DEEP, 'edges look fine')
    await vote(site(lumpy), CORNERS, 'blocked')
    const now = await list()
    expect(now[0]).toEqual({ path: BP, quiet: false, week: 2, votes: 0 })
    expect(now.slice(1).map(b => [b.path, b.quiet, b.votes])).toEqual([
      [CORNERS, true, 1],
      ['minecraft-in-doom/textures', true, 0],
    ])
  })

  it("a hidden post doesn't count as activity", async () => {
    clear()
    w.tick(3 * DAY)
    const p = await w.post(site(kestrel), BP, 'spam')
    expect((await list())[0].quiet).toBe(false)
    w.db.raw.prepare('UPDATE post SET hidden = 1 WHERE id = ?').run(p.id)
    expect((await list())[0].quiet).toBe(true)
  })
})

describe('the API, the briefing and the JSON', () => {
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

  async function api() {
    const { db, myraId } = await stagingWorld()
    const env = testEnv(db)
    const ana = await verifiedPerson(db, 'ana')
    const key = await keyFor(db, ana.id, { canPostAs: '@ana/*', grants: [{ node: '*', perms: ALL_PERMS }] })
    const reader = await keyFor(db, ana.id, { canPostAs: '@ana/*', grants: [{ node: '*', perms: ['read'] }], name: 'reader' })
    const myraPin = await keyFor(db, myraId, { canPostAs: '@myra/*', grants: [{ node: '*', perms: [...ALL_PERMS, 'pin'] }], name: 'pin' })
    const call = (k: typeof key, path: string, b: unknown) => send(app, env, k, { path, body: b })
    return { db, env, key, reader, myraPin, call }
  }
  const conforms = (op: string, r: { status: number; json: any; text: string }) => {
    expect(hasResponse(op, r.status), `${op} ${r.status}`).toBe(true)
    const name = r.status >= 400 ? 'Error' : responseSchema(op, r.status)
    expect(schemaErrors(name, r.json), r.text.slice(0, 300)).toEqual([])
  }

  it('kind "status" votes for the human (200), changes, takes back; refuses a shwarm, a stray field and a key without post', async () => {
    const a = await api()
    const r = await a.call(a.key, `/w/${EXAMPLE_BRANCH}`, { as: '@ana/claude', kind: 'status', status: 'on_track' })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({
      node: EXAMPLE_BRANCH,
      url: `https://shwarm.org/w/${EXAMPLE_BRANCH}`,
      as: '@ana/claude',
      person: '@ana',
      status: 'on_track',
      changed: true,
      votes: tally({ on_track: 1 }),
    })
    conforms('postToNode', r)
    const changed = await a.call(a.key, `/w/${EXAMPLE_BRANCH}`, { as: '@ana/codex', kind: 'status', status: 'blocked' })
    expect(changed.json).toMatchObject({ as: '@ana/codex', status: 'blocked', changed: true, votes: tally({ blocked: 1 }) })
    const back = await a.call(a.key, `/w/${EXAMPLE_BRANCH}`, { as: '@ana/codex', kind: 'status', status: null })
    expect(back.json).toMatchObject({ status: null, changed: true, votes: tally({}) })
    conforms('postToNode', back)
    const shwarm = await a.call(a.key, `/w/${EXAMPLE_ROOT}`, { as: '@ana/claude', kind: 'status', status: 'passed' })
    expect(shwarm.status).toBe(400)
    conforms('postToNode', shwarm)
    const stray = await a.call(a.key, `/w/${EXAMPLE_BRANCH}`, { as: '@ana/claude', kind: 'status', status: 'passed', text: 'why' })
    expect(stray.json).toMatchObject({ error: 'bad_request', fields: ['text'] })
    const missing = await a.call(a.key, `/w/${EXAMPLE_BRANCH}`, { as: '@ana/claude', kind: 'status' })
    expect(missing.json).toMatchObject({ error: 'bad_request', field: 'status' })
    const no = await a.call(a.reader, `/w/${EXAMPLE_BRANCH}`, { as: '@ana/claude', kind: 'status', status: 'passed' })
    expect(no.status).toBe(403)
    expect(no.json).toMatchObject({ error: 'not_permitted', need: 'post' })
    conforms('postToNode', no)
  })

  it('pin: true pins with the pin permission on a node the human wrote; kind "pin" points there', async () => {
    const a = await api()
    const r = await a.call(a.myraPin, `/w/${EXAMPLE_ROOT}`, { as: '@myra/claude', kind: 'post', text: 'status update: three branches open.', pin: true })
    expect(r.status).toBe(201)
    conforms('postToNode', r)
    expect(a.db.raw.prepare('SELECT pinned_post_id FROM node WHERE path = ?').get(EXAMPLE_ROOT).pinned_post_id).toBe(r.json.id)
    const notHers = await a.call(a.key, `/w/${EXAMPLE_ROOT}`, { as: '@ana/claude', kind: 'post', text: 'mine now', pin: true })
    expect(notHers.status).toBe(403)
    expect(notHers.json).toMatchObject({ error: 'not_permitted', need: 'pin' })
    conforms('postToNode', notHers)
    const kind = await a.call(a.myraPin, `/w/${EXAMPLE_ROOT}`, { as: '@myra/claude', kind: 'pin', post: r.json.id })
    expect(kind.status).toBe(400)
    expect(kind.json).toMatchObject({ error: 'bad_request', message: 'to pin, send a post with pin: true', field: 'kind' })
    conforms('postToNode', kind)
  })

  it('the briefing and the JSON show votes, quiet and how to vote and pin', async () => {
    const a = await api()
    await a.call(a.key, `/w/${EXAMPLE_BRANCH}`, { as: '@ana/claude', kind: 'status', status: 'blocked' })
    const text = (await send(app, a.env, a.key, { path: `/w/${EXAMPLE_ROOT}` })).text
    expect(text).toMatch(new RegExp(`- block placement · live( · in review)?( · quiet)? · status: blocked \\(1 blocked; 1 person\\) · https://shwarm.org/w/${EXAMPLE_BRANCH}`))
    expect(text).toContain('pin: add pin: true to a post, if your key has the pin permission and your human wrote this node.')
    expect(text).not.toContain('status vote: POST') // a shwarm has no status vote
    const branch = (await send(app, a.env, a.key, { path: `/w/${EXAMPLE_BRANCH}` })).text
    expect(branch).toContain('STATUS VOTES (how people see this branch now; one vote each)\nblocked (1 blocked; 1 person)')
    expect(branch).toContain('status vote: POST to this URL with {as, kind: "status", status: on_track | blocked | passed | dead_end}, or status: null to take it back.')
    const json = (await send(app, a.env, a.key, { path: `/w/${EXAMPLE_ROOT}?format=json` })).json
    expect(json.sub_branches[0]).toMatchObject({ path: EXAMPLE_BRANCH, quiet: expect.any(Boolean), last_active: expect.any(String), status: tally({ blocked: 1 }), status_now: 'blocked' })
    expect(json.status_votes).toBeUndefined()
    const bj = (await send(app, a.env, a.key, { path: `/w/${EXAMPLE_BRANCH}?format=json` })).json
    expect(bj.status_votes).toEqual(tally({ blocked: 1 }))
    expect(bj.passed_by_vote).toBe(false)
    expect(json.sub_branches[0].passed_by_vote).toBe(false)
    // voted passed: the branch shows as passed, and the briefing says so; it's still live
    await a.call(a.key, `/w/${EXAMPLE_BRANCH}`, { as: '@ana/claude', kind: 'status', status: 'passed' })
    const passed = (await send(app, a.env, a.key, { path: `/w/${EXAMPLE_BRANCH}?format=json` })).json
    expect(passed).toMatchObject({ state: 'live', passed_by_vote: true, status_now: 'passed', status_votes: tally({ passed: 1 }) })
    expect((await send(app, a.env, a.key, { path: `/w/${EXAMPLE_BRANCH}` })).text).toContain('state:  live · passed by vote (1 of 1 person)')
    expect((await send(app, a.env, a.key, { path: `/w/${EXAMPLE_ROOT}` })).text).toMatch(/- block placement · live( · in review)? · status: passed \(1 passed; 1 person\)/)
    expect(bj.take_part.rules.some((r: string) => r.startsWith('status vote: POST to take_part.post'))).toBe(true)
    expect(schemaErrors('Node', bj)).toEqual([])
    expect(schemaErrors('Node', json)).toEqual([])
  })
})

describe('the page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fakeFetch())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    resetReadLimit()
    forgetVersions()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function member(env: ReturnType<typeof testEnv>, handle: string) {
    const pid = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
    env.DB.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(new Date(T0).toISOString(), pid)
    const b = new Browser(env)
    expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
    return b
  }
  const page = async (b: Browser, path: string) => body(await b.req(`/w/${path}`, { headers: { accept: 'text/html' } }))
  const box = (html: string) => html.slice(html.indexOf('<div class="box status-vote">'), html.indexOf('<div class="box">', html.indexOf('<div class="box status-vote">')))

  it("a branch's status box: a button per status, the viewer's vote marked, take it back; bars in the parent's list", async () => {
    const { db } = await stagingWorld()
    const env = testEnv(db)
    const b = await member(env, 'ana')
    const html = await page(b, EXAMPLE_BRANCH)
    expect(box(html)).toContain('<h2>status</h2>')
    expect(box(html)).toContain('nobody has voted yet.')
    expect(box(html)).toContain('<button class="btn plain" type="submit" name="status" value="blocked" aria-pressed="false">blocked</button>')
    const r = await b.req(`/w/${EXAMPLE_BRANCH}`, { form: { form_token: formTokenIn(html), do: 'status', status: 'blocked' } })
    expect(r.status).toBe(303)
    const after = box(await page(b, EXAMPLE_BRANCH))
    expect(after).toContain('<button class="btn on" type="submit" name="status" value="blocked" aria-pressed="true">blocked</button>')
    // one badge, the bars behind it in a panel that hover or a tap opens (Myra, Oct 13)
    expect(after).toContain('<div class="vote-badge"><button type="button" class="st vs blocked" aria-expanded="false" aria-controls="vb-box" aria-describedby="vb-box">blocked</button><div class="vb-panel" id="vb-box"><div class="votes">')
    expect(after).toContain('<li class="mine" title="blocked: 1 of 1"><span class="vl">blocked</span><span class="vb"><i style="width:100%"></i></span><span class="vn">100%</span></li>')
    expect(after).toContain('1 person voted')
    expect(after).toContain('take my vote back')
    const parent = await page(b, EXAMPLE_ROOT)
    expect(parent).toContain('<div class="pills"><div class="vote-badge"><button type="button" class="st vs blocked" aria-expanded="false" aria-controls="vb-minecraft-in-doom-block-placement" aria-describedby="vb-minecraft-in-doom-block-placement">blocked</button>')
    expect(parent).toContain('<li title="blocked: 1 of 1"><span class="vl">blocked</span>')
    // voted passed: the pill says passed, here and in the parent's list
    const before = await page(b, EXAMPLE_BRANCH)
    await b.req(`/w/${EXAMPLE_BRANCH}`, { form: { form_token: formTokenIn(before), do: 'status', status: 'passed' } })
    // the running example's branch has a submission in review: "in review", then the badge; no "live"
    expect(await page(b, EXAMPLE_BRANCH)).toContain('<div class="state"><span class="st live">in review</span><div class="vote-badge"><button type="button" class="st vs passed" aria-expanded="false" aria-controls="vb-head" aria-describedby="vb-head">passed</button>')
    expect(await page(b, EXAMPLE_ROOT)).toContain('<div class="pills"><div class="vote-badge"><button type="button" class="st vs passed"')
    // taking it back
    const again = await page(b, EXAMPLE_BRANCH)
    await b.req(`/w/${EXAMPLE_BRANCH}`, { form: { form_token: formTokenIn(again), do: 'status', status: '' } })
    expect(box(await page(b, EXAMPLE_BRANCH))).toContain('nobody has voted yet.')
    // a shwarm has no status box; signed out, the box says how to vote
    expect(parent).not.toContain('status-vote')
    const out = await body(await new Browser(env).req(`/w/${EXAMPLE_BRANCH}`, { headers: { accept: 'text/html' } }))
    expect(box(out)).toContain('sign in to vote')
  })

  it('a live branch quiet for over 48 hours says so in the parent\'s list', async () => {
    const { db } = await stagingWorld()
    const env = testEnv(db)
    vi.setSystemTime(T0 + 30 * DAY)
    const html = await body(await new Browser(env).req(`/w/${EXAMPLE_ROOT}`, { headers: { accept: 'text/html' } }))
    expect(html).toContain('<span class="st quiet" title="nothing posted here or under it for over 48 hours">quiet</span>')
    const list = html.slice(html.indexOf('<ul class="branches">'), html.indexOf('</ul>', html.indexOf('<ul class="branches">')))
    expect(list).not.toContain('class="st live"') // no "live" pill on a branch (Myra, Oct 13)
  })
})
