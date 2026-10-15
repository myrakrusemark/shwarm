// GET /w/<path>/people (decided Oct 14, "One card for a node's people, status and joining; the full list in a modal"):
// everyone on a shwarm or branch, in the card's order, as a page (where "+ n more" goes without scripts) or JSON (the
// card's modal, and agents, signed or not). `people` is a reserved segment, so no node is ever named it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { RESERVED_SLUGS } from '../src/core/text'
import { CONTRIBUTORS_SHOWN, parseNodePath, PEOPLE_SHOWN, readChain, readContributors } from '../src/read/node'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { keyFor, send } from './agent-client'
import { body, Browser, fakeFetch, testEnv } from './browser'
import { agent, DAY, person, site, World, type P } from './core-fixtures'
import { T0 } from './d1'

const MID = 'minecraft-in-doom'
const BP = 'minecraft-in-doom/block-placement'
const HANDLES = ['ana', 'finn_irl', 'kestrel', 'lumpy', 'otto', 'pia', 'quill', 'rho']

let w: World
let myra: P
let crew: P[]

beforeEach(async () => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
  forgetVersions()
  w = new World()
  myra = await person(w.db, 'myra')
  crew = []
  for (const h of HANDLES) crew.push(await person(w.db, h))
  await w.shwarm(site(myra))
  await w.branch(site(myra), MID)
  for (const p of crew) await w.join(site(p), MID)
  // two of them posted: they lead, most upvotes first
  await w.post(site(crew[3]), MID, 'the chunk lookup, not the sight check.')
  const top = await w.post(site(crew[5]), MID, 'reproduced it on corner 3.')
  await w.run({ type: 'upvote', actor: site(crew[0]), input: { node: MID, post: top.id } })
  // one joined through an agent
  await w.join(agent(myra, 'claude', ['read', 'post', 'join']), BP)
  w.db.raw.prepare("UPDATE node SET triage = 'clear'").run()
  const { rollupStats } = await import('../src/jobs/stats')
  await rollupStats(w.db, T0 + 6 * 60_000)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const get = (b: Browser, path: string, accept = 'application/json') => b.req(path, { headers: { accept } })

describe('/w/<path>/people (decided Oct 14)', () => {
  it('lists everyone as JSON, in the card\'s order, with what each did here', async () => {
    const r = await get(new Browser(testEnv(w.db)), `/w/${MID}/people`)
    expect(r.status).toBe(200)
    const j = (await r.json()) as any
    expect(j.node).toBe(MID)
    expect(j.url).toBe(`https://shwarm.org/w/${MID}/people`)
    expect(j.total).toBe(9)
    expect(j.people).toHaveLength(9)
    expect(j.people.slice(0, 2)).toEqual([
      { name: '@pia', author: false, posts: 1, upvotes: 1, posts_per_day: 1, joined_by: null },
      { name: '@lumpy', author: false, posts: 1, upvotes: 0, posts_per_day: 1, joined_by: null },
    ])
    expect(j.people.find((p: any) => p.name === '@myra')).toEqual({ name: '@myra', author: true, posts: 0, upvotes: 0, posts_per_day: 0, joined_by: null })
    // a person whose join an agent made says so on the branch
    const bp = (await (await get(new Browser(testEnv(w.db)), `/w/${BP}/people?format=json`)).json()) as any
    expect(bp.people.find((p: any) => p.name === '@myra')).toMatchObject({ joined_by: '@myra/claude' })
  })

  it('is a page for a browser, with every row; text asks get the JSON', async () => {
    const html = await body(await get(new Browser(testEnv(w.db)), `/w/${MID}/people`, 'text/html'))
    for (const h of [...HANDLES, 'myra']) expect(html).toContain(`@${h}`)
    expect(html).toContain('<ul class="crew">')
    expect(html).toContain(`<link rel="canonical" href="https://shwarm.org/w/${MID}/people"`)
    const text = await get(new Browser(testEnv(w.db)), `/w/${MID}/people?format=text`)
    expect(text.headers.get('content-type')).toContain('application/json')
  })

  it('caches signed out like the node: a weak ETag and a 304; a missing node is a 404', async () => {
    const b = new Browser(testEnv(w.db))
    const r = await get(b, `/w/${MID}/people`)
    const etag = r.headers.get('etag')!
    expect(etag).toMatch(/^W\/".*\.json\.people\./)
    expect((await b.req(`/w/${MID}/people`, { headers: { accept: 'application/json', 'if-none-match': etag } })).status).toBe(304)
    // a new join moves it (once this isolate's 15-second memo of the version has passed)
    await w.join(site(await person(w.db, 'sol')), MID)
    forgetVersions()
    expect((await b.req(`/w/${MID}/people`, { headers: { accept: 'application/json', 'if-none-match': etag } })).status).toBe(200)
    expect((await get(b, '/w/no-such-shwarm/people')).status).toBe(404)
  })

  it('agents read it signed too', async () => {
    const key = await keyFor(w.db, crew[0].id, { canPostAs: '@ana/*', grants: [{ node: '*', perms: ['read'] }] })
    const r = await send(app, testEnv(w.db), key, { path: `/w/${MID}/people` })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ node: MID, total: 9 })
  })

  it('the card shows five, a briefing seven, and the list everyone', async () => {
    expect([PEOPLE_SHOWN, CONTRIBUTORS_SHOWN]).toEqual([5, 7])
    const n = (await readChain(w.db, MID, null))!.node
    expect((await readContributors(w.db, n, PEOPLE_SHOWN)).rows).toHaveLength(5) // the author among them, joined first
    expect((await readContributors(w.db, n)).rows).toHaveLength(7)
  })

  it('an author ranked below the top five takes the fifth place, so the card still shows five', async () => {
    // three more people with posts here rank above the author, who has none
    const n = (await readChain(w.db, MID, null))!.node
    for (const p of [crew[0], crew[1], crew[2]])
      w.db.raw.prepare('INSERT INTO person_node_stats (person_id, node_id, posts, upvotes, updated_at) VALUES (?, ?, 1, 0, ?)').run(p.id, n.id, new Date(T0).toISOString())
    const five = await readContributors(w.db, n, PEOPLE_SHOWN)
    expect(five.rows.map(r => r.handle)).toEqual(['@pia', '@ana', '@finn_irl', '@kestrel', '@myra']) // @lumpy, fifth, makes way
    expect(five.total).toBe(9)
    const html = await body(await new Browser(testEnv(w.db)).req(`/w/${MID}`, { headers: { accept: 'text/html' } }))
    expect(html).toContain('+ 4 more')
  })

  it('"people" is reserved: a view, never a node', async () => {
    expect(RESERVED_SLUGS.has('people')).toBe(true)
    expect(parseNodePath(`${MID}/people`)).toEqual({ kind: 'view', path: MID, view: 'people' })
    w.tick(DAY)
    await w.branch(site(crew[1]), MID, { title: 'people' })
    expect(w.get("SELECT path FROM node WHERE path LIKE '%people%'").path).toBe(`${MID}/people-2`)
  })
})
