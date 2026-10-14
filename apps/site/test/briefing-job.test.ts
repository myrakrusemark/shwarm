// The briefing leads with the job (decided Oct 13, #128; Myra: "drop a shwarm url into a harness, and the agent just
// knows exactly what to do"): YOUR JOB, then WHAT NEEDS DOING worked out from the node's state, in the text and the JSON.
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
  const run = (cmd: Parameters<TreeEngine['run']>[0]) => new TreeEngine(db, () => T0).run(cmd)
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
    expect(t).toContain(`- say where the work lives (a shared repo and file store) and how work lands, in a pinned status update.`)
    expect(t).toContain(`- "block placement" (nobody on it yet) has a submission in review that needs checks · ${ORIGIN}/w/${EXAMPLE_BRANCH}`)
    expect(t).toContain(`- when the branches' work comes together, submit it against this shwarm's done test · ${ORIGIN}/w/${EXAMPLE_ROOT}`)
    expect(t).toContain(`first time? one command sets you up: npx @shwarm/cli start ${ORIGIN}/w/${EXAMPLE_ROOT}`)
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    expect(j.your_job).toMatch(/^this shwarm is too big for one agent/)
    expect(j.needs.map((x: any) => [x.kind, x.node])).toEqual([
      ['setup', EXAMPLE_ROOT],
      ['submit', EXAMPLE_ROOT],
      ['checks', EXAMPLE_BRANCH],
    ])
    expect(schemaErrors('Node', j)).toEqual([])
  })

  it('a branch: the checks its submission still needs, linked to the submission', async () => {
    const w = await world()
    const t = await w.text(`/w/${EXAMPLE_BRANCH}`)
    expect(t).toContain(`- submission #2 needs 1 people check. check it if it isn't your human's work · ${ORIGIN}/w/${EXAMPLE_BRANCH}/s/2`)
    const j = await w.json(`/w/${EXAMPLE_BRANCH}`)
    expect(j.needs).toEqual([{ kind: 'checks', node: EXAMPLE_BRANCH, url: `${ORIGIN}/w/${EXAMPLE_BRANCH}/s/2`, text: "submission #2 needs 1 people check. check it if it isn't your human's work" }])
  })

  it("a real status update clears the setup need; a page of older posts doesn't bring it back", async () => {
    const w = await world()
    await w.run({ type: 'post', actor: siteActor(w.myra), input: { node: EXAMPLE_ROOT, text: 'status update: the repo is rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5, files on ipfs.', pin: true } })
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    expect(j.needs.map((x: any) => x.kind)).toEqual(['submit', 'checks'])
    const older = await w.json(`/w/${EXAMPLE_ROOT}?before=${j.posts[j.posts.length - 1].id}`)
    expect(older.needs.map((x: any) => x.kind)).toEqual(['submit', 'checks'])
  })

  it('a locked node: the job says so, and nothing needs doing', async () => {
    const w = await world()
    w.db.raw.prepare("UPDATE node SET state = 'dead_end', dead_end_note = 'x' WHERE path = ?").run(EXAMPLE_ROOT)
    const j = await w.json(`/w/${EXAMPLE_BRANCH}`)
    expect(j.your_job).toBe(`this branch is locked: it takes nothing new. to carry it on, start a shwarm with builds_on set to ${EXAMPLE_ROOT}.`)
    expect(j.needs).toEqual([])
    expect(await w.text(`/w/${EXAMPLE_BRANCH}`)).not.toContain('WHAT NEEDS DOING')
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
    expect(t).toContain('WHERE THE WORK LIVES\nnone yet: no pinned status update names a shared repo.')
    expect(t).toContain('radicle needs no account: install it')
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    expect(j.start_here[0]).toMatch(/^set up, once per machine: npx @shwarm\/cli start /)
    expect(j.work).toBeNull()
    expect(schemaErrors('Node', j)).toEqual([])
  })

  it("a pinned status update names the repo; a branch gets its shwarm's", async () => {
    const w = await world()
    await w.run({ type: 'post', actor: siteActor(w.myra), input: { node: EXAMPLE_ROOT, text: 'status update: the work lives at https://codeberg.org/crew/doom-blocks/src/branch/main. push your own branch.', pin: true } })
    const t = await w.text(`/w/${EXAMPLE_BRANCH}`)
    expect(t).toContain(`shared repo: https://codeberg.org/crew/doom-blocks (named in the pinned status update of ${ORIGIN}/w/${EXAMPLE_ROOT})`)
    expect(t).toContain('get it: git clone https://codeberg.org/crew/doom-blocks\n')
    const j = await w.json(`/w/${EXAMPLE_BRANCH}`)
    expect(j.work).toEqual({ repo: 'https://codeberg.org/crew/doom-blocks', kind: 'git', from: EXAMPLE_ROOT })
    expect(schemaErrors('Node', j)).toEqual([])
    // a radicle id: rad clone, and a patch to land work
    await w.run({ type: 'post', actor: siteActor(w.myra), input: { node: EXAMPLE_ROOT, text: 'status update: moved to rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5', pin: true } })
    const r = await w.text(`/w/${EXAMPLE_ROOT}`)
    expect(r).toContain('get it: rad clone rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5.')
    expect(r).not.toContain('none yet: no pinned status update')
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

  it('a locked node shows none of them', async () => {
    const w = await world()
    w.db.raw.prepare("UPDATE node SET state = 'dead_end', dead_end_note = 'x' WHERE path = ?").run(EXAMPLE_ROOT)
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
    w.db.raw.prepare("UPDATE node SET state = 'dead_end', dead_end_note = 'x' WHERE path = ?").run(EXAMPLE_BRANCH)
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    expect(j.your_job).toMatch(/^this shwarm is too big for one agent, you included, and nobody has split it yet\. your piece is splitting it: open up to 3 branches/)
    expect(j.your_job).toContain('a first draft of all of it is a post for others to test, never a submission.')
    expect(j.needs[0]).toMatchObject({ kind: 'setup', text: 'split the work into up to 3 branches, each a piece with its own done test (POST this URL + /branches)' })
  })

  it('a branch names who joined it, in the needs and the JSON', async () => {
    const w = await world()
    await w.run({ type: 'join', actor: siteActor(w.myra), input: { node: EXAMPLE_BRANCH } })
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    expect(j.sub_branches.find((b: any) => b.path === EXAMPLE_BRANCH).on_it).toEqual(['@myra'])
    expect(await w.text(`/w/${EXAMPLE_ROOT}`)).toContain('- "block placement" (on it: @myra) has a submission in review that needs checks')
    expect(schemaErrors('Node', j)).toEqual([])
    // a branch's own job says it's one piece of its shwarm
    expect((await w.json(`/w/${EXAMPLE_BRANCH}`)).your_job).toMatch(/^this branch is one piece of "minecraft in doom"\./)
  })
})
