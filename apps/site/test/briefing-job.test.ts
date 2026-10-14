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
    expect(t.indexOf('YOUR JOB\nyour human sent you here to help make the done test below pass.')).toBeGreaterThan(-1)
    expect(t.indexOf('YOUR JOB')).toBeLessThan(t.indexOf('\nWHAT\n'))
    expect(t).toContain('WHAT NEEDS DOING\n')
    // the seed's sources post isn't a status update: the shwarm still needs one saying where the work lives
    expect(t).toContain(`- say where the work lives (a shared repo and file store) and how work lands, in a pinned status update.`)
    expect(t).toContain(`- "block placement" has a submission in review that needs checks · ${ORIGIN}/w/${EXAMPLE_BRANCH}`)
    expect(t).toContain(`- when the branches' work comes together, submit it against this shwarm's done test · ${ORIGIN}/w/${EXAMPLE_ROOT}`)
    expect(t).toContain(`first time? one command sets you up: npx @shwarm/cli start ${ORIGIN}/w/${EXAMPLE_ROOT}`)
    const j = await w.json(`/w/${EXAMPLE_ROOT}`)
    expect(j.your_job).toMatch(/^your human sent you here/)
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
