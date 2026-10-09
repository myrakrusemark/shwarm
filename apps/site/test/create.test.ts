// Go-live 4.2: the create form at /new, shwarm mode, with builds-on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { NEW_NODES_PER_DAY } from '../src/core/limits'
import { buildsOnFromForm, checkFromForm, parseTagField } from '../src/web/create'
import { resetReadLimit } from '../src/web/read-limit'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { LOBBY, stagingWorld } from './node-fixture'

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

describe('branch and variant modes (4.3)', () => {
  const BRANCH = { title: 'monster collision', what: 'imps walk through placed blocks.', done_when: "monsters can't walk through placed blocks.", c_author: 'on' }
  const VARIANT = { done_when: 'the same mod, with hunger and a day/night cycle.', c_author: 'on', lobby: '3', license: 'MIT' }
  const html = (b: Browser, path: string) => b.req(path, { headers: { accept: 'text/html' } })

  /** GET the form at `at`, then post `fields` with every field the page carries (its hidden parent or variant too). */
  async function send(b: Browser, at: string, fields: Record<string, string>) {
    const page = await (await b.get(at)).text()
    const hidden = Object.fromEntries([...page.matchAll(/<input type="hidden" name="(parent|variant)" value="([^"]+)"/g)].map(m => [m[1], m[2]]))
    return b.req('/new', { form: { form_token: formTokenIn(page), ...hidden, ...fields } })
  }

  it('signed out, ?parent= and ?variant= come back to the same form after sign-in', async () => {
    const { env } = await world()
    const res = await new Browser(env).get('/new?parent=minecraft-in-doom')
    expect(res.headers.get('location')).toBe('/signin?next=%2Fnew%3Fparent%3Dminecraft-in-doom')
  })

  it('?parent= shows what the branch helps reach, with no tags, lobby or builds-on', async () => {
    const { env } = await world()
    const { b } = await member(env, 'ana')
    const page = await body(await b.get('/new?parent=minecraft-in-doom/block-placement'))
    expect(page).toContain('<h1 class="title" id="heading">new branch</h1>')
    expect(page).toContain('goes live as soon as you start it. no lobby: the crew is already here.')
    expect(page).toMatch(/<nav class="crumbs"[^>]*><a href="\/w\/minecraft-in-doom">minecraft in doom<\/a><span>\/<\/span><a href="\/w\/minecraft-in-doom\/block-placement">block placement<\/a><span>\/<\/span>new branch<\/nav>/)
    expect(page).toContain('helping reach')
    expect(page).toContain('block placement is done when')
    expect(page).toContain('one done test per branch')
    expect(page).toContain('name="parent" value="minecraft-in-doom/block-placement"')
    expect(page).not.toContain('name="tags"')
    expect(page).not.toContain('name="lobby"')
    expect(page).not.toContain('name="builds_on"')
    expect(page).not.toContain('name="license"')
    expect(page).toContain("a branch inherits its shwarm's license.")
    expect(page).toContain('inherits from minecraft in doom: GPL-3.0.')
    expect(page).toContain('>start branch</button>')
  })

  it('a branch and a sub-branch go live at once, with the parent\'s license and no seats', async () => {
    const { env, q } = await world()
    const { b, pid } = await member(env, 'ana')
    const res = await send(b, '/new?parent=minecraft-in-doom', { ...BRANCH, tags: '#ignored', lobby: '5', license: 'MIT', builds_on: 'https://github.com/x/y' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/w/minecraft-in-doom/monster-collision')
    const n = q("SELECT id, kind, state, license, lobby_size, builds_on, parent_id, live_at, triage FROM node WHERE path = 'minecraft-in-doom/monster-collision'") as any
    const parent = q("SELECT id, builds_on FROM node WHERE path = 'minecraft-in-doom'") as any
    expect(n).toMatchObject({ kind: 'branch', state: 'live', license: 'GPL-3.0', lobby_size: null, builds_on: parent.builds_on, parent_id: parent.id })
    expect(n.live_at).not.toBeNull()
    expect(q('SELECT COUNT(*) AS n FROM seat WHERE node_id = ?', n.id)).toEqual({ n: 0 })
    expect(q('SELECT COUNT(*) AS n FROM node_tag WHERE node_id = ?', n.id)).toEqual({ n: 0 })
    expect(q("SELECT by_name FROM audit_event WHERE event = 'branch_opened' ORDER BY rowid DESC LIMIT 1")).toEqual({ by_name: '@ana' })
    // Its author sees it while triage checks it.
    expect(await body(await html(b, '/w/minecraft-in-doom/monster-collision'))).toContain('being checked')
    // A sub-branch, under a branch.
    const sub = await send(b, '/new?parent=minecraft-in-doom/block-placement', { ...BRANCH, title: 'corner fix' })
    expect(sub.headers.get('location')).toBe('/w/minecraft-in-doom/block-placement/corner-fix')
    expect(q("SELECT kind, state FROM node WHERE path = 'minecraft-in-doom/block-placement/corner-fix'")).toEqual({ kind: 'branch', state: 'live' })
    expect(pid).toBeGreaterThan(0)
  })

  it('a refused branch comes back as a branch form, filled in', async () => {
    const { env } = await world()
    const { b } = await member(env, 'ana')
    const res = await send(b, '/new?parent=minecraft-in-doom', { ...BRANCH, c_author: '' })
    expect(res.status).toBe(400)
    const page = await body(res)
    expect(page).toContain('a done test names at least one check.')
    expect(page).toContain('>start branch</button>')
    expect(page).toContain('name="parent" value="minecraft-in-doom"')
    expect(page).toContain('value="monster collision"')
  })

  it('a lobby takes no branches yet: the page says so instead of the form', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    const page = await body(await b.get(`/new?parent=${LOBBY}`))
    expect(page).toContain(`${LOBBY} is still a lobby. branches open at kickoff.`)
    expect(page).not.toContain('name="title"')
    // A form sent anyway (an old tab) is refused the same way.
    const res = await b.req('/new', { form: { form_token: formTokenIn(await (await b.get('/new')).text()), parent: LOBBY, ...BRANCH } })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('is still a lobby')
    expect((q("SELECT COUNT(*) AS n FROM node WHERE kind = 'branch' AND path LIKE ?", `${LOBBY}/%`) as { n: number }).n).toBe(0)
  })

  it("a parent or original the viewer can't see is a 404", async () => {
    const { env, db } = await world()
    const { b } = await member(env, 'ana')
    expect((await b.get('/new?parent=no-such-thing')).status).toBe(404)
    expect((await b.get('/new?variant=no-such-thing')).status).toBe(404)
    expect((await b.get('/new?parent=../etc')).status).toBe(404)
    // Still being checked: only its author sees it, so only its author can branch it.
    db.raw.prepare("UPDATE node SET triage = 'pending' WHERE path = 'minecraft-in-doom/block-placement'").run()
    expect((await b.get('/new?parent=minecraft-in-doom/block-placement')).status).toBe(404)
    const res = await b.req('/new', { form: { form_token: formTokenIn(await (await b.get('/new')).text()), parent: 'minecraft-in-doom/block-placement', ...BRANCH } })
    expect(res.status).toBe(404)
  })

  it('?variant= is prefilled from the original and opens its own lobby, linked both ways', async () => {
    const { env, q, db } = await world()
    const { b, pid } = await member(env, 'ana')
    const page = await body(await b.get('/new?variant=minecraft-in-doom'))
    expect(page).toContain('<h1 class="title" id="heading">new variant</h1>')
    expect(page).toContain('same goal, your own finish line. a variant is a shwarm of its own, with its own lobby.')
    expect(page).toContain('the original is done when')
    expect(page).toContain('minecraft in doom (@myra)')
    expect(page).toContain('value="minecraft in doom: "')
    expect(page).toMatch(/name="tags"[^>]*value="#[a-z]/)
    expect(page).toContain('a variant picks its own license.')
    expect(page).toContain('name="variant" value="minecraft-in-doom"')
    expect(page).toContain('name="lobby"')
    // Sent with the prefilled title, what and tags as they are, plus a new finish line.
    const form = (name: string) => new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(page)![1]
    const res = await send(b, '/new?variant=minecraft-in-doom', { ...VARIANT, title: 'minecraft in doom: survival', what: 'the same goal, harder.', tags: form('tags') })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/w/minecraft-in-doom-survival')
    const v = q("SELECT id, kind, state, lobby_size, license, variant_of_id FROM node WHERE path = 'minecraft-in-doom-survival'") as any
    const orig = q("SELECT id FROM node WHERE path = 'minecraft-in-doom'") as any
    expect(v).toMatchObject({ kind: 'variant', state: 'lobby', lobby_size: 3, license: 'MIT', variant_of_id: orig.id })
    expect(q('SELECT person_id, number FROM seat WHERE node_id = ?', v.id)).toEqual({ person_id: pid, number: 1 })
    // Linked both ways, once triage clears it.
    db.raw.prepare("UPDATE node SET triage = 'clear' WHERE id = ?").run(v.id)
    expect(await body(await html(b, '/w/minecraft-in-doom-survival'))).toContain('variant of <a href="/w/minecraft-in-doom">minecraft in doom</a>')
    expect(await body(await html(b, '/w/minecraft-in-doom'))).toContain('<a href="/w/minecraft-in-doom-survival">minecraft in doom: survival</a>')
  })

  it('a variant of a closed shwarm is refused, and offers building on it', async () => {
    const { env, q, db } = await world()
    const { b } = await member(env, 'ana')
    const token = formTokenIn(await (await b.get('/new?variant=minecraft-in-doom')).text())
    db.raw.prepare("UPDATE node SET state = 'closed', closed_at = ? WHERE path = 'minecraft-in-doom'").run(new Date(T0).toISOString())
    const page = await body(await b.get('/new?variant=minecraft-in-doom'))
    expect(page).toContain('minecraft-in-doom is closed. variants are only for open shwarms; build on it instead.')
    expect(page).not.toContain('name="title"')
    expect(page).toContain('<a class="btn" href="/new?builds_on=minecraft-in-doom">build on this</a>')
    // The form from before it closed is refused too.
    const res = await b.req('/new', { form: { form_token: token, variant: 'minecraft-in-doom', ...VARIANT, title: 'minecraft in doom: late', what: 'too late.', tags: '#games' } })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('variants are only for open shwarms')
    expect(q("SELECT COUNT(*) AS n FROM node WHERE kind = 'variant'")).toEqual({ n: 0 })
    // A branch isn't varied: it gets a sibling branch.
    expect(await body(await b.get('/new?variant=minecraft-in-doom/block-placement'))).toContain('variants are of shwarms only. disagree with a branch? open a sibling branch.')
  })

  it('?builds_on= fills the builds-on field and names a closed shwarm, whose license the new one takes', async () => {
    const { env, q, db } = await world()
    const { b } = await member(env, 'ana')
    // Open: the path is filled in, with no chip (core refuses it on send).
    const open = await body(await b.get('/new?builds_on=minecraft-in-doom'))
    expect(open).toContain('name="builds_on" aria-describedby="up-hint" placeholder="https://github.com/… or a passed shwarm\'s link" autocomplete="off" value="minecraft-in-doom"')
    expect(open).not.toContain('id="picked"')
    // Unknown: the same, as typed (core refuses it on send); nothing about it is looked up or shown (5.7).
    const unknown = await b.get('/new?builds_on=no-such-shwarm')
    expect(unknown.status).toBe(200)
    const unknownPage = await body(unknown)
    expect(unknownPage).toContain('autocomplete="off" value="no-such-shwarm"')
    expect(unknownPage).not.toContain('id="picked"')
    db.raw.prepare("UPDATE node SET state = 'closed', closed_at = ? WHERE path = 'minecraft-in-doom'").run(new Date(T0).toISOString())
    // The closed page links here.
    expect(await body(await html(b, '/w/minecraft-in-doom'))).toContain('<a href="/new?builds_on=minecraft-in-doom">build on this</a>')
    const page = await body(await b.get('/new?builds_on=minecraft-in-doom'))
    expect(page).toContain('value="minecraft-in-doom"')
    expect(page).toContain('<div class="picked" id="picked"><div><b>minecraft in doom</b> <span>/w/minecraft-in-doom · license GPL-3.0</span></div></div>')
    expect(page).toContain('takes the upstream license: whatever minecraft in doom is published under.')
    expect(page).toMatch(/<select id="license" name="license"[^>]* hidden/)
    // A full link works the same.
    expect(await body(await b.get(`/new?builds_on=${encodeURIComponent('https://shwarm.org/w/minecraft-in-doom')}`))).toContain('id="picked"')
    // A refused send comes back the same way: the chip shown, the picker hidden.
    const refused = await create(b, { ...HELLO, title: 'minecraft in doom 2', tags: '', builds_on: 'minecraft-in-doom', license: 'MIT' })
    expect(refused.status).toBe(400)
    const again = await body(refused)
    expect(again).toContain('id="picked"')
    expect(again).toContain('takes the upstream license: whatever minecraft in doom is published under.')
    expect(again).toMatch(/<select id="license" name="license"[^>]* hidden/)
    const res = await create(b, { ...HELLO, title: 'minecraft in doom 2', builds_on: 'minecraft-in-doom', license: 'MIT' })
    expect(res.status).toBe(303)
    const n = q("SELECT license, builds_on FROM node WHERE path = 'minecraft-in-doom-2'") as any
    expect(n).toEqual({ license: 'GPL-3.0', builds_on: JSON.stringify({ node: 'minecraft-in-doom' }) })
  })

  it('branches count toward the 3 new nodes a day', async () => {
    const { env } = await world()
    const { b } = await member(env, 'ana')
    for (let i = 1; i <= NEW_NODES_PER_DAY; i++) expect((await send(b, '/new?parent=minecraft-in-doom', { ...BRANCH, title: `fix ${i}` })).status).toBe(303)
    const res = await send(b, '/new?parent=minecraft-in-doom', { ...BRANCH, title: 'fix 4' })
    expect(res.status).toBe(429)
    const page = await body(res)
    expect(page).toContain("that's 3 new shwarms and branches today")
    expect(page).toContain('>start branch</button>')
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
