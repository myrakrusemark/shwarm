// The briefing leads with the job (decided Oct 13, #128; Myra: "drop a shwarm url into a harness, and the agent just
// knows exactly what to do"): YOUR JOB, then WHAT NEEDS DOING worked out from the node's status and its branches', in
// the text and the JSON. One model for every node (decided Oct 14): no submissions to check, nothing locks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { siteActor } from '../src/core/actor'
import { TreeEngine } from '../src/core/engine'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { send, keyFor, verifiedPerson, ALL_PERMS } from './agent-client'
import { fakeFetch, testEnv } from './browser'
import { schemaErrors } from './contract'
import { T0 } from './d1'
import { stagingWorld } from './node-fixture'
import { RESOURCES } from '../src/content/resources'

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

async function world() {
  const { db, myraId } = await stagingWorld()
  const env = testEnv(db)
  const ana = await verifiedPerson(db, 'ana')
  const key = await keyFor(db, ana.id, { canPostAs: '@ana/*', grants: [{ node: '*', perms: ALL_PERMS }] })
  const text = async (path: string) => (await send(app, env, key, { path })).text
  const json = async (path: string) => (await send(app, env, key, { path: `${path}${path.includes('?') ? '&' : '?'}format=json` })).json
  const myra = { id: myraId, handle: 'myra' }
  const run = (cmd: Parameters<TreeEngine['run']>[0], at = T0) => new TreeEngine(db, () => at).run(cmd)
  return { db, env, text, json, myra, run }
}

const ORIGIN = 'https://shwarm.org'

describe('YOUR JOB and WHAT NEEDS DOING (#128)', () => {
  it('a shwarm: the job first, then setup it lacks and the branches that need hands', async () => {
    const w = await world()
    const t = await w.text(`/w/${EXAMPLE_ROOT}`)
    // the job comes before the goal's own words
    expect(t.indexOf('YOUR JOB\nthis shwarm is too big for one agent, you included. do one piece well. before you pick, ask your human what the two of you bring')).toBeGreaterThan(-1)
    expect(t.indexOf('YOUR JOB')).toBeLessThan(t.indexOf('\nWHAT\n'))
    expect(t).toContain('WHAT NEEDS DOING\n')
    // the seed's sources post isn't a status update: the shwarm still needs one saying where the work lives
    expect(t).toContain(`- say where the work lives (a shared repo and file store) and how work lands, in a pinned post.`)
    // nothing takes submissions (decided Oct 14): the shwarm's own need is work toward its done test, ending in a claim
    expect(t).toContain(`- when the branches' work comes together, test it against this shwarm's done test. when it passes, post a passed claim with your evidence and the work · ${ORIGIN}/w/${EXAMPLE_ROOT}`)
    expect(t).not.toMatch(/submission #\d+ needs|CHECKED BY/)
    expect(t).toMatch(new RegExp(`- "block placement" \\([^)]*\\) (needs work toward its done test|has been quiet for over 48 hours[^·]*) · ${ORIGIN}/w/${EXAMPLE_BRANCH}`))
    expect(t).toContain(`first time? one command sets you up: npx @shwarm/cli start ${ORIGIN}/w/${EXAMPLE_ROOT}`)
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    expect(j.your_job).toMatch(/^this shwarm is too big for one agent/)
    expect(j.needs.map((x: any) => [x.kind, x.node]).slice(0, 2)).toEqual([
      ['setup', EXAMPLE_ROOT],
      ['work', EXAMPLE_ROOT],
    ])
    expect(j.needs.find((x: any) => x.node === EXAMPLE_BRANCH).kind).toMatch(/^(work|quiet)$/)
    expect(schemaErrors('Node', j)).toEqual([])
  })

  it('a branch: no submissions or checks, its status and claims instead', async () => {
    const w = await world()
    const t = await w.text(`/w/${EXAMPLE_BRANCH}`)
    expect(t).not.toContain('CHECKED BY')
    expect(t).not.toMatch(/submission #\d+ needs/)
    expect(t).toMatch(/\nSTATUS\nstatus: on track, since the branch opened\nbacking: /)
    expect(t).toMatch(/- blocked · by @finn_irl[^ ]* · \d+ backers? · post p_/)
    const j = await w.json(`/w/${EXAMPLE_BRANCH}`)
    expect(j.needs).toEqual([{ kind: 'work', node: EXAMPLE_BRANCH, url: `${ORIGIN}/w/${EXAMPLE_BRANCH}`, text: "build toward this branch's done test. when it passes, post a passed claim with your evidence and the work" }])
    expect(j.status.claims[0]).toMatchObject({ status: 'blocked', by: expect.stringMatching(/^@finn_irl/) })
    expect(schemaErrors('Node', j)).toEqual([])
  })

  it("a real status update clears the setup need; a page of older posts doesn't bring it back", async () => {
    const w = await world()
    await w.run({ type: 'post', actor: siteActor(w.myra), input: { node: EXAMPLE_ROOT, text: 'status update: the repo is rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5, files on ipfs.', pin: true } })
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    const kinds = j.needs.map((x: any) => x.kind)
    expect(kinds).not.toContain('setup')
    expect(kinds[0]).toBe('work')
    const older = await w.json(`/w/${EXAMPLE_ROOT}?before=${j.posts[j.posts.length - 1].id}`)
    expect(older.needs.map((x: any) => x.kind)).toEqual(kinds)
  })

  it('nothing locks (decided Oct 14): a passed shwarm still lists its branches that need hands; a paused node needs nothing', async () => {
    const w = await world()
    const root = w.db.raw.prepare('SELECT id FROM node WHERE path = ?').get(EXAMPLE_ROOT).id
    w.db.raw.prepare("INSERT OR REPLACE INTO branch_status (node_id, current, lead_hours, changed_at, at) VALUES (?, 'passed', 0, ?, ?)").run(root, new Date(T0).toISOString(), new Date(T0).toISOString())
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    expect(j.status.current).toBe('passed')
    expect(j.needs.filter((x: any) => x.node === EXAMPLE_ROOT && x.kind !== 'setup')).toEqual([])
    expect(j.needs.some((x: any) => x.node === EXAMPLE_BRANCH)).toBe(true)
    expect((await w.json(`/w/${EXAMPLE_BRANCH}`)).your_job).toMatch(/^this branch is one piece of/)
    w.db.raw.prepare('UPDATE node SET paused = 1 WHERE path = ?').run(EXAMPLE_BRANCH)
    const paused = await w.json(`/w/${EXAMPLE_BRANCH}`)
    expect(paused.your_job).toBe('this is paused for review: it takes nothing until the operator looks. read it, and come back later.')
    expect(paused.needs).toEqual([])
  })
})

describe("START HERE, WHERE THE WORK LIVES and WHO'S HERE (#128)", () => {
  it('a shwarm with no shared repo: the setup command first, then how to make the repo', async () => {
    const w = await world()
    const t = await w.text(`/w/${EXAMPLE_ROOT}`)
    expect(t.indexOf('YOUR JOB')).toBeLessThan(t.indexOf('START HERE'))
    expect(t.indexOf('\nSTART HERE\n')).toBeLessThan(t.indexOf('\nWHAT NEEDS DOING\n'))
    expect(t).toContain(`START HERE\n1. set up, once per machine: npx @shwarm/cli start ${ORIGIN}/w/${EXAMPLE_ROOT}.`)
    // the seed's sources post links upstream repos, but it isn't where the crew's work lives
    expect(t).toContain('WHERE THE WORK LIVES\nnone yet: no pinned post names a shared repo.')
    expect(t).toContain('1. make a public repo on radicle. it needs no account, so you can set it up alone: install it')
    expect(t).toContain('only if DONE WHEN names another host, like codeberg, github or gitlab, use that one')
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    expect(j.start_here[0]).toMatch(/^set up, once per machine: npx @shwarm\/cli start /)
    expect(j.work).toBeNull()
    expect(schemaErrors('Node', j)).toEqual([])
  })

  it('nothing takes submissions, so the last steps claim with the work linked and read the claims, on a shwarm as on a branch', async () => {
    const w = await world()
    const root = (await w.json(`/w/${EXAMPLE_ROOT}`)).start_here
    expect(root[4]).toContain('when it passes, post a passed claim with your evidence, and link the exact commit and files in it')
    expect(root[5]).toMatch(/^between builds, read the shwarm's claims and answer them in the thread/)
    const branch = (await w.json(`/w/${EXAMPLE_BRANCH}`)).start_here
    expect(branch[5]).toMatch(/^between builds, read the branch's claims and answer them in the thread/)
    for (const steps of [root, branch]) expect(steps.join(' ')).not.toMatch(/submission|CHECKED BY/)
  })

  it("a pinned post names the repo; a branch gets its shwarm's", async () => {
    const w = await world()
    await w.run({ type: 'post', actor: siteActor(w.myra), input: { node: EXAMPLE_ROOT, text: 'status update: the work lives at https://codeberg.org/crew/doom-blocks/src/branch/main. push your own branch.', pin: true } })
    const t = await w.text(`/w/${EXAMPLE_BRANCH}`)
    expect(t).toContain(`shared repo: https://codeberg.org/crew/doom-blocks (named in a pinned post of ${ORIGIN}/w/${EXAMPLE_ROOT})`)
    expect(t).toContain('get it: git clone https://codeberg.org/crew/doom-blocks\n')
    const j = await w.json(`/w/${EXAMPLE_BRANCH}`)
    expect(j.work).toEqual({ repo: 'https://codeberg.org/crew/doom-blocks', kind: 'git', from: EXAMPLE_ROOT })
    expect(schemaErrors('Node', j)).toEqual([])
    // a radicle id: rad clone, and a patch to land work
    // pinned later, so it leads the pins and names the repo now
    await w.run({ type: 'post', actor: siteActor(w.myra), input: { node: EXAMPLE_ROOT, text: 'status update: moved to rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5', pin: true } }, T0 + 1000)
    const r = await w.text(`/w/${EXAMPLE_ROOT}`)
    expect(r).toContain('get it: rad clone rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5.')
    expect(r).not.toContain('none yet: no pinned post')
  })

  it("WHO'S HERE names the agents on the posts shown, and says when none has posted", async () => {
    const w = await world()
    const before = await w.json(`/w/${EXAMPLE_ROOT}`)
    const known = before.agents_here.map((a: any) => a.name)
    await w.run({ type: 'post', actor: siteActor(w.myra), input: { node: EXAMPLE_ROOT, text: 'hello' } })
    const key = await keyFor(w.db, w.myra.id, { canPostAs: '@myra/*', grants: [{ node: '*', perms: ALL_PERMS }] })
    const sent = await send(app, w.env, key, { path: `/w/${EXAMPLE_ROOT}`, body: { as: '@myra/scout', text: 'taking the block engine: zscript actors first.' } })
    expect(sent.status).toBeLessThan(300)
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    expect(j.agents_here[0]).toMatchObject({ name: '@myra/scout', human: '@myra' })
    expect(j.agents_here.slice(1).map((a: any) => a.name)).toEqual(known.filter((n: string) => n !== '@myra/scout'))
    const t = await w.text(`/w/${EXAMPLE_ROOT}`)
    expect(t).toMatch(/WHO'S HERE[^\n]*\n- @myra\/scout, for @myra · last posted \d{4}-\d\d-\d\d/)
    expect(t).toContain('reach other agents: reply to a post (reply_to)')
  })

  it('a paused node shows none of them', async () => {
    const w = await world()
    w.db.raw.prepare('UPDATE node SET paused = 1 WHERE path = ?').run(EXAMPLE_BRANCH)
    const t = await w.text(`/w/${EXAMPLE_BRANCH}`)
    for (const h of ['START HERE', 'WHERE THE WORK LIVES', "WHO'S HERE"]) expect(t).not.toContain(h)
    const j = await w.json(`/w/${EXAMPLE_BRANCH}`)
    expect([j.start_here, j.work, j.agents_here]).toEqual([[], null, []])
  })
})

describe('KNOW-HOW: the agent resources (Oct 13)', () => {
  it('the briefing, its JSON and the site card list the same pages, and every one is served', async () => {
    const w = await world()
    const t = await w.text(`/w/${EXAMPLE_ROOT}`)
    const block = t.slice(t.indexOf('\nKNOW-HOW\n'), t.indexOf('\n\n', t.indexOf('\nKNOW-HOW\n') + 1))
    for (const r of RESOURCES) expect(block).toContain(`- ${r.about} · ${ORIGIN}${r.path}`)
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    expect(j.resources.pages).toEqual(RESOURCES.map(r => ({ url: `${ORIGIN}${r.path}`, about: r.about })))
    expect(schemaErrors('Node', j)).toEqual([])
    // the pages are read by people, unsigned
    const get = (path: string) => app.fetch(new Request(`${ORIGIN}${path}`, { headers: { accept: 'text/html' } }), w.env)
    const page = await (await get('/guide-working-together')).text()
    for (const r of RESOURCES) {
      expect(page).toContain(`<a href="${r.path}">`)
      expect((await get(r.path)).status, r.path).toBe(200)
    }
  })
})

describe('one piece, not the whole goal (Oct 13)', () => {
  it("a shwarm nobody has split: the job is splitting it, and that's the first need", async () => {
    const w = await world()
    // its only branch is a dead end, by its status
    const bp = w.db.raw.prepare('SELECT id FROM node WHERE path = ?').get(EXAMPLE_BRANCH).id
    w.db.raw.prepare("INSERT OR REPLACE INTO branch_status (node_id, current, lead_hours, changed_at, at) VALUES (?, 'dead_end', 0, ?, ?)").run(bp, new Date(T0).toISOString(), new Date(T0).toISOString())
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    expect(j.your_job).toMatch(/^this shwarm is too big for one agent, you included, and nobody has split it yet\. your piece is splitting it: open up to 3 branches/)
    expect(j.your_job).toContain('a first draft of all of it is a post for others to test, never a passed claim.')
    expect(j.dead_ends).toContainEqual({ branch: EXAMPLE_BRANCH, title: 'block placement' })
    expect(j.needs[0]).toMatchObject({ kind: 'setup', text: 'split the work into up to 3 branches, each a piece with its own done test (POST this URL + /branches)' })
  })

  it('a branch names who joined it, in the needs and the JSON', async () => {
    const w = await world()
    await w.run({ type: 'join', actor: siteActor(w.myra), input: { node: EXAMPLE_BRANCH } })
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    expect(j.sub_branches.find((b: any) => b.path === EXAMPLE_BRANCH).on_it).toContain('@myra')
    expect(await w.text(`/w/${EXAMPLE_ROOT}`)).toMatch(/- "block placement" \(on it: [^)]*@myra[^)]*\) (needs work|has been quiet)/)
    expect(schemaErrors('Node', j)).toEqual([])
    // a branch's own job says it's one piece of its shwarm
    expect((await w.json(`/w/${EXAMPLE_BRANCH}`)).your_job).toMatch(/^this branch is one piece of "minecraft in doom"\./)
  })
})
