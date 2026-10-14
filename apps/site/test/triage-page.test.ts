// Go-live 9.2, the public triage page: /triage shows the prompt and the versioned rubric as the model gets them (built
// from src/triage, never a copy) and the decision log, newest first, paged with ?before=, as a page, JSON or text.
// Never the words of any node, never the path of one the public was never shown (held, blocked, pending, or under one),
// never an error row. Linked from the create form, the rules page and the sitemap.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { decideStatements } from '../src/triage/decide'
import { clefRequest, DEFAULT_MODEL } from '../src/triage/model'
import { HARD_BLOCKS, RUBRIC, RUBRIC_VERSION, triageQuestions } from '../src/triage/rubric'
import { READ_BURST, resetReadLimit } from '../src/web/read-limit'
import { EXAMPLE_NODE, TRIAGE_PAGE } from '../src/web/triage-page'
import { forgetVersions } from '../src/web/version-memo'
import { body, Browser, fakeFetch, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { addPerson, T0 } from './d1'
import { PLAIN, stagingWorld } from './node-fixture'

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

const HTML = { accept: 'text/html' }
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString()
const MODEL = DEFAULT_MODEL
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

// The words of nodes the public can't read: none of them may appear anywhere on the page.
const SECRETS = ['SECRETHELD title', 'SECRETHELD what', 'SECRETBLOCKED title', 'SECRETBLOCKED what', 'SECRETUNDER title', 'secret-held', 'secret-blocked', 'secret-under', 'model error: boom']

/**
 * The staging-like world with decisions: the example shwarm (seeded, public) and its branch (cleared) got a model no
 * and a hand clear; the plain shwarm got a model no and was then taken down; a person's held shwarm got a model yes;
 * another got a model unsure and then @myra blocked it; a cleared branch sits under the held one. One error row too.
 */
async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const raw = w.db.raw
  const one = (sql: string, ...a: unknown[]) => raw.prepare(sql).get(...a)
  const author = await addPerson(env.DB, 'someone')
  const clone = (path: string, title: string, what: string, triage: string, parent: { id: number; root: number } | null = null) => {
    raw
      .prepare(
        `INSERT INTO node (path, slug, kind, parent_id, root_id, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, triage, seeded, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, done_when, checks, ?, license, ?, '@someone', 'live', ?, 0, ? FROM node WHERE path = ?`,
      )
      .run(path, path.split('/').pop(), parent ? 'branch' : 'shwarm', parent?.id ?? null, parent?.root ?? null, title, what, parent ? null : 10, author, triage, iso(0), PLAIN)
    return one('SELECT id FROM node WHERE path = ?', path).id as number
  }
  const held = clone('secret-held', 'SECRETHELD title', 'SECRETHELD what', 'held')
  const blocked = clone('secret-blocked', 'SECRETBLOCKED title', 'SECRETBLOCKED what', 'held')
  clone('secret-held/secret-under', 'SECRETUNDER title', 'SECRETUNDER what', 'clear', { id: held, root: held })
  const under = one('SELECT id FROM node WHERE path = ?', 'secret-held/secret-under').id as number
  const id = (path: string) => one('SELECT id FROM node WHERE path = ?', path).id as number
  const decide = raw.prepare('INSERT INTO triage_decision (node_id, model, rubric, answer, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  decide.run(id(EXAMPLE_ROOT), MODEL, RUBRIC_VERSION, 'no', 'weapons', iso(1))
  decide.run(id(EXAMPLE_ROOT), MODEL, RUBRIC_VERSION, 'error', 'model error: boom', iso(2))
  decide.run(id(PLAIN), MODEL, RUBRIC_VERSION, 'no', 'spam', iso(3))
  decide.run(held, MODEL, RUBRIC_VERSION, 'yes', 'weapons', iso(4))
  decide.run(blocked, MODEL, RUBRIC_VERSION, 'unsure', 'surveillance', iso(5))
  decide.run(under, MODEL, RUBRIC_VERSION, 'no', 'spam', iso(6))
  decide.run(id(EXAMPLE_BRANCH), MODEL, RUBRIC_VERSION, 'no', 'protected_assets', iso(7))
  const run = (stmts: { sql: string; args: unknown[] }[]) => {
    for (const s of stmts) raw.prepare(s.sql).run(...s.args)
  }
  run(decideStatements({ action: 'block', path: 'secret-blocked', category: 'surveillance', reason: 'tracks a named person', at: iso(8) }))
  run(decideStatements({ action: 'clear', path: EXAMPLE_BRANCH, reason: 'a game mod, fine', at: iso(9) }))
  raw.prepare('UPDATE node SET hidden = 1 WHERE path = ?').run(PLAIN)
  return { ...w, env }
}

const cellsOf = (h: string) => {
  const table = h.slice(h.indexOf('<tbody>'), h.indexOf('</tbody>'))
  return [...table.matchAll(/<tr id="t(\d+)">(.*?)<\/tr>/g)].map(m => m[2].replace(/<[^>]+>/g, '|').replace(/\|+/g, '|'))
}

describe('/triage', () => {
  it('lists decisions newest first for a signed-out reader, cacheable, without error rows', async () => {
    const w = await world()
    const res = await new Browser(w.env).req('/triage', { headers: HTML })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=60')
    const h = await body(res)
    expect(cellsOf(h)).toEqual([
      `|2026-10-08|${EXAMPLE_BRANCH}|no|cleared by hand|—|a game mod, fine|@myra| · r1|`,
      '|2026-10-08|a shwarm|yes|blocked|surveillance, doxxing or targeting people|tracks a named person|@myra| · r1|',
      `|2026-10-08|${EXAMPLE_BRANCH}|no|cleared|—|—|clef-flash| · r1|`,
      '|2026-10-08|a shwarm|no|cleared|—|—|clef-flash| · r1|', // the cleared branch under a held shwarm
      '|2026-10-08|a shwarm|unsure|sent for review|surveillance, doxxing or targeting people|—|clef-flash| · r1|',
      '|2026-10-08|a shwarm|yes|sent for review|weapons, malware or exploits|—|clef-flash| · r1|',
      `|2026-10-08|${PLAIN}| (taken down)|no|cleared|—|—|clef-flash| · r1|`,
      `|2026-10-08|${EXAMPLE_ROOT}|no|cleared|—|—|clef-flash| · r1|`,
    ])
    // a node the public sees is linked; a taken-down one isn't
    expect(h).toContain(`<a href="/w/${EXAMPLE_ROOT}">${EXAMPLE_ROOT}</a>`)
    expect(h).not.toContain(`href="/w/${PLAIN}"`)
  })

  it('never shows the words of a node, or the path of one the public was never shown', async () => {
    const w = await world()
    for (const r of [
      await new Browser(w.env).req('/triage', { headers: HTML }),
      await new Browser(w.env).get('/triage?format=json'),
      await new Browser(w.env).get('/triage?format=text'),
    ]) {
      const t = await body(r)
      for (const never of SECRETS) expect(t).not.toContain(never)
    }
  })

  it('shows the prompt and rubric exactly as the model gets them', async () => {
    const w = await world()
    const b = new Browser(w.env)
    const h = unescape(await body(await b.req('/triage', { headers: HTML })))
    expect(h).toContain(RUBRIC)
    expect(h).toContain(JSON.stringify(triageQuestions(), null, 2))
    expect(h).toContain(JSON.stringify(clefRequest(MODEL, EXAMPLE_NODE), null, 2))
    expect(h).toContain(`<code>${RUBRIC_VERSION}</code>`)
    expect(h).toContain(`<code>${MODEL}</code>`)
    // the example request carries placeholders only, and every question the model is asked
    const ex = clefRequest(MODEL, EXAMPLE_NODE)
    expect(ex.questions).toEqual(triageQuestions())
    expect(JSON.stringify(ex.state)).not.toMatch(/minecraft|doom/)

    const j = (await (await b.get('/triage?format=json')).json()) as any
    expect(j.rubric).toBe(RUBRIC_VERSION)
    expect(j.model).toBe(MODEL)
    expect(j.hard_blocks).toEqual(HARD_BLOCKS)
    expect(j.questions).toEqual(triageQuestions())
    expect(j.request_example).toEqual(ex)

    const text = await (await b.req('/triage', { headers: { accept: '*/*' } })).text()
    expect(text.split('\n')[0]).toBe(`triage: rubric ${RUBRIC_VERSION}, model ${MODEL}`)
    expect(text).toContain(RUBRIC)
    expect(text).toContain(JSON.stringify(triageQuestions(), null, 2))
  })

  it('answers agents in JSON and text', async () => {
    const w = await world()
    const b = new Browser(w.env)
    for (const res of [await b.get('/triage?format=json'), await b.req('/triage', { headers: { accept: 'application/json' } })]) {
      expect(res.headers.get('content-type')).toContain('application/json')
      const j = (await res.json()) as any
      expect(j.older).toBeNull()
      expect(j.decisions).toHaveLength(8)
      expect(j.decisions[1]).toEqual({ id: expect.any(Number), at: iso(8), node: null, shown: false, answer: 'yes', by: 'hand', model: 'myra', rubric: 'r1', outcome: 'blocked', category: 'surveillance', reason: 'tracks a named person' })
      expect(j.decisions.find((d: any) => d.node === PLAIN)).toMatchObject({ shown: false, answer: 'no', by: 'model', model: 'clef-flash', category: null, reason: '' })
      expect(j.decisions.find((d: any) => d.answer === 'yes' && d.by === 'model')).toMatchObject({ node: null, outcome: 'sent for review', category: 'weapons' })
    }
    const text = await (await b.get('/triage?format=text')).text()
    expect(text).toContain(`2026-10-08  ${PLAIN} (taken down)  no: cleared  by clef-flash, rubric r1\n`)
    expect(text).toContain('2026-10-08  a shwarm  yes: blocked (surveillance)  by myra, rubric r1. tracks a named person\n')
  })

  it('pages with ?before=, newest first', async () => {
    const w = await world()
    const root = w.db.raw.prepare('SELECT id FROM node WHERE path = ?').get(EXAMPLE_ROOT).id
    const ins = w.db.raw.prepare('INSERT INTO triage_decision (node_id, model, rubric, answer, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    for (let i = 0; i < TRIAGE_PAGE; i++) ins.run(root, MODEL, RUBRIC_VERSION, 'no', 'spam', iso(100 + i))
    const b = new Browser(w.env)
    const first = (await (await b.get('/triage?format=json')).json()) as any
    expect(first.decisions).toHaveLength(TRIAGE_PAGE)
    expect(first.decisions[0].at).toBe(iso(100 + TRIAGE_PAGE - 1))
    const ids = first.decisions.map((r: any) => r.id)
    expect(ids).toEqual([...ids].sort((a: number, z: number) => z - a))
    expect(first.older).toBe(`/triage?format=json&before=${ids.at(-1)}`)
    const second = (await (await b.get(first.older)).json()) as any
    expect(second.decisions).toHaveLength(8)
    expect(second.decisions[0].at).toBe(iso(9))
    expect(second.older).toBeNull()

    const page1 = await body(await b.req('/triage', { headers: HTML }))
    expect(page1).toContain(`<a href="/triage?before=${ids.at(-1)}">older decisions</a>`)
    const page2 = await body(await b.req(`/triage?before=${ids.at(-1)}`, { headers: HTML }))
    expect(page2).toContain('<h2>older decisions</h2>')
    expect(page2).toContain('<a href="/triage">newest</a>')
    expect(page2).not.toContain('?before=')
    expect(page2).not.toContain('id="questions"') // the prompt is on the first page only
    for (const never of SECRETS) expect(page2).not.toContain(never)
    // a junk before is ignored
    expect(((await (await b.get('/triage?format=json&before=abc')).json()) as any).decisions[0].id).toBe(ids[0])
  })

  it('takes from the per-network read limit', async () => {
    const w = await stagingWorld()
    const b = new Browser(testEnv(w.db))
    for (let i = 0; i < READ_BURST; i++) expect((await b.get('/triage?format=json')).status).toBe(200)
    expect((await b.get('/triage?format=json')).status).toBe(429)
  })

  it('says when there are no decisions, and is private when signed in', async () => {
    const w = await stagingWorld()
    const env = testEnv(w.db)
    expect(await body(await new Browser(env).req('/triage', { headers: HTML }))).toContain('no decisions yet.')
    w.db.raw.prepare('UPDATE person SET password_hash = ? WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), w.myraId)
    const b = new Browser(env)
    expect((await b.post('/signin', { email: 'myra@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    expect((await b.req('/triage', { headers: HTML })).headers.get('cache-control')).toBe('private, no-store')
  })

  it('is linked from the create form, the rules page and the sitemap', async () => {
    const w = await stagingWorld()
    const env = testEnv(w.db)
    expect(await body(await new Browser(env).req('/rules', { headers: HTML }))).toContain('href="/triage"')
    expect(await body(await new Browser(env).req('/sitemap.xml'))).toMatch(/<loc>https?:\/\/[^<]+\/triage<\/loc>/)
    w.db.raw.prepare('UPDATE person SET password_hash = ? WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), w.myraId)
    const b = new Browser(env)
    expect((await b.post('/signin', { email: 'myra@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    expect(await body(await b.req('/new', { headers: HTML }))).toContain('<a href="/triage">see what the check is asked.</a>')
  })
})
