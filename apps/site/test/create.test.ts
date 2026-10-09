// Go-live 4.2: the create form at /new, shwarm mode, with builds-on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { NEW_NODES_PER_DAY } from '../src/core/limits'
import { buildsOnFromForm, checkFromForm, parseTagField } from '../src/web/create'
import { resetReadLimit } from '../src/web/read-limit'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { stagingWorld } from './node-fixture'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const q = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).get(...args)
  return { ...w, env, q }
}

async function member(env: ReturnType<typeof testEnv>, handle: string, o: { verified?: boolean } = {}) {
  const pid = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
  if (o.verified !== false) env.DB.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(new Date(T0).toISOString(), pid)
  const b = new Browser(env)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return { b, pid }
}

const HELLO = { title: 'hello world', what: 'two test accounts say hello.', done_when: 'both accounts have posted hello world.', c_author: 'on', tags: '#test #hello', lobby: '2', license: 'MIT+CC-BY-4.0' }

async function create(b: Browser, fields: Record<string, string>) {
  const token = formTokenIn(await (await b.get('/new')).text())
  return b.req('/new', { form: { form_token: token, ...fields } })
}

describe('create form (4.2)', () => {
  it('signed out goes to sign-in and back', async () => {
    const { env } = await world()
    const res = await new Browser(env).get('/new')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/signin?next=%2Fnew')
  })

  it('a new shwarm opens as a lobby with the author in seat 1', async () => {
    const { env, q, myraId: _ } = await world()
    const { b, pid } = await member(env, 'ana')
    const page = await body(await b.get('/new'))
    expect(page).toContain('start shwarm + open lobby')
    const res = await create(b, HELLO)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/w/hello-world')
    const n = q("SELECT id, state, lobby_size, license, checks, triage FROM node WHERE path = 'hello-world'") as any
    expect(n).toMatchObject({ state: 'lobby', lobby_size: 2, license: 'MIT+CC-BY-4.0' })
    expect(JSON.parse(n.checks)).toEqual({ author: true })
    expect(q('SELECT number FROM seat WHERE node_id = ? AND person_id = ?', n.id, pid)).toEqual({ number: 1 })
    expect(await body(await b.req('/w/hello-world', { headers: { accept: 'text/html' } }))).toContain('hello world')
  })

  it('the fourth create in a day gets a clear limit error', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    for (let i = 1; i <= NEW_NODES_PER_DAY; i++) expect((await create(b, { ...HELLO, title: `hello ${i}` })).status).toBe(303)
    const res = await create(b, { ...HELLO, title: 'hello 4' })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    const html = await body(res)
    expect(html).toContain("that's 3 new shwarms and branches today")
    expect(html).toContain('value="hello 4"')
    expect((q("SELECT COUNT(*) AS n FROM node WHERE title LIKE 'hello %'") as { n: number }).n).toBe(3)
  })

  it('refusals come back with the form filled in', async () => {
    const { env } = await world()
    const { b } = await member(env, 'ana')
    const noCheck = await create(b, { ...HELLO, c_author: '' })
    expect(noCheck.status).toBe(400)
    const html = await body(noCheck)
    expect(html).toContain('a done test names at least one check.')
    expect(html).toContain('>two test accounts say hello.</textarea>')
    expect((await body(await create(b, { ...HELLO, lobby: '1' })))).toContain('a lobby is at least 2 people.')
    expect((await body(await create(b, { ...HELLO, tags: '' })))).toContain('a shwarm needs at least one tag.')
  })

  it('unverified accounts see why they can\'t start one', async () => {
    const { env } = await world()
    const { b } = await member(env, 'newbie', { verified: false })
    const html = await body(await b.get('/new'))
    expect(html).toContain('verify your email to start a shwarm')
    expect(html).not.toContain('name="title"')
  })

  it('builds on a github repo: its name and license come from the api', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    expect((await create(b, { ...HELLO, builds_on: 'https://github.com/ZDoom/gzdoom', license: 'MIT' })).status).toBe(303)
    const n = q("SELECT license, builds_on FROM node WHERE path = 'hello-world'") as any
    expect(n.license).toBe('GPL-3.0')
    expect(JSON.parse(n.builds_on)).toEqual({ name: 'ZDoom/gzdoom', url: 'https://github.com/ZDoom/gzdoom', license: 'GPL-3.0' })
  })
})

describe('form parsing', () => {
  it('tags, checks and other links', async () => {
    expect(parseTagField('#weird #games, gzdoom')).toEqual(['weird', 'games', 'gzdoom'])
    expect(checkFromForm({ c_runs: 'on', command: './t.sh', runs: '3', c_people: 'on', people: '2', human: 'on', instructions: 'look' })).toEqual({
      author: false, runs: { command: './t.sh', count: 3 }, people: { count: 2, human: true, instructions: 'look' },
    })
    const o = 'https://shwarm.org'
    expect(await buildsOnFromForm({}, o)).toBeNull()
    expect(await buildsOnFromForm({ builds_on: 'https://shwarm.org/w/minecraft-in-doom/' }, o)).toBe('minecraft-in-doom')
    expect(await buildsOnFromForm({ builds_on: 'minecraft-in-doom' }, o)).toBe('minecraft-in-doom')
    expect(await buildsOnFromForm({ builds_on: 'https://codeberg.org/x/y', builds_on_name: 'y', builds_on_license: 'MPL-2.0' }, o)).toEqual({ name: 'y', url: 'https://codeberg.org/x/y', license: 'MPL-2.0' })
    await expect(buildsOnFromForm({ builds_on: 'https://codeberg.org/x/y' }, o)).rejects.toThrow('type the license')
    await expect(buildsOnFromForm({ builds_on: 'https://github.com/someone/no-license' }, o)).rejects.toThrow("doesn't name a license")
    await expect(buildsOnFromForm({ builds_on: 'javascript:alert(1)' }, o)).rejects.toThrow('web link')
  })
})
