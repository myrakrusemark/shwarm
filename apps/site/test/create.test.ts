// Go-live 4.2: the create form at /new, shwarm mode, with builds-on. No checks box (decided Oct 14: the done test is the
// "done when" sentence; its people say it passed with a claim they back).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { NEW_NODES_PER_DAY } from '../src/core/limits'
import { buildsOnFromForm, parseTagField } from '../src/web/create'
import { resetReadLimit } from '../src/web/read-limit'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { PLAIN, stagingWorld } from './node-fixture'

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

const HELLO = { title: 'hello world', what: 'two test accounts say hello.', done_when: 'both accounts have posted hello world.', tags: '#test #hello', license: 'MIT+CC-BY-4.0' }

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

  it('a new shwarm is live at once, with the author working on it: no lobby field, no seats (decided Oct 9)', async () => {
    const { env, q, myraId: _ } = await world()
    const { b, pid } = await member(env, 'ana')
    const page = await body(await b.get('/new'))
    expect(page).toContain('>start shwarm</button>')
    expect(page).toContain('a goal worth a crowd. your shwarm goes live after a quick safety check.')
    // fixed once posted (decided Oct 12: no editing a shwarm's words), and the form says so by its button
    // no license picker (decided Oct 15): everything posted here is MIT, and the rules say so
    expect(page).not.toContain('id="license"')
    expect(page).not.toContain('id="f-license"')
    expect(page).not.toContain('builds_on_license')
    expect(page).toContain("<b>open.</b> everything posted here is MIT. if your work has its own license, say so in your shwarm's words or its repo's license file.")
    expect(page).toContain(`after that it's live, and anyone can work on it. <b id="fixed-note">once posted, nothing on this form can be changed.</b>`)
    expect(page).toContain("the done test can't change once it's posted. people join for this finish line, so a different one means <b>starting a new shwarm</b>.")
    expect(page).not.toMatch(/lobby|seat|variant/)
    // the done test is the sentence: no checks box, and check fields sent from an old tab are ignored
    expect(page).not.toContain("how it's checked")
    for (const field of ['c-author', 'c-machine', 'c-people', 'cmd', 'look']) expect(page).not.toContain(`id="${field}"`)
    // a lobby field sent anyway (an old tab) changes nothing either
    const res = await create(b, { ...HELLO, lobby: '7', c_runs: 'on', command: './t.sh', runs: '2', c_author: 'on' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/w/hello-world')
    const n = q("SELECT id, state, live_at, license, checks, triage FROM node WHERE path = 'hello-world'") as any
    expect(n).toMatchObject({ state: 'live', live_at: new Date(T0).toISOString(), license: 'MIT' }) // everything here is MIT (Oct 15)
    expect(JSON.parse(n.checks)).toEqual({ author: false })
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
    expect(html).toContain("you've started 3 shwarms and branches in the last 24 hours")
    expect(html).toContain('value="hello 4"')
    expect((q("SELECT COUNT(*) AS n FROM node WHERE title LIKE 'hello %'") as { n: number }).n).toBe(3)
  })

  it('refusals come back with the form filled in', async () => {
    const { env } = await world()
    const { b } = await member(env, 'ana')
    const noDone = await create(b, { ...HELLO, done_when: '' })
    expect(noDone.status).toBe(400)
    const html = await body(noDone)
    expect(html).toContain('a node needs a done test: one sentence of what is true when it is finished.')
    expect(html).toContain('>two test accounts say hello.</textarea>')
    expect((await body(await create(b, { ...HELLO, tags: '' })))).toContain('a shwarm needs at least one tag.')
  })

  it('unverified accounts see why they can\'t start one', async () => {
    const { env } = await world()
    const { b } = await member(env, 'newbie', { verified: false })
    const html = await body(await b.get('/new'))
    expect(html).toContain('verify your email to start a shwarm')
    expect(html).not.toContain('name="title"')
  })

  it("builds on a github repo: its name and license come from the api, and the license stays the repo's (Oct 15: the shwarm is MIT)", async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    expect((await create(b, { ...HELLO, builds_on: 'https://github.com/ZDoom/gzdoom', license: 'MIT' })).status).toBe(303)
    const n = q("SELECT license, builds_on FROM node WHERE path = 'hello-world'") as any
    expect(n.license).toBe('MIT')
    expect(JSON.parse(n.builds_on)).toEqual({ name: 'ZDoom/gzdoom', url: 'https://github.com/ZDoom/gzdoom', license: 'GPL-3.0' })
  })
})

describe('branch mode (4.3); no variants (decided Oct 9)', () => {
  const BRANCH = { title: 'monster collision', what: 'imps walk through placed blocks.', done_when: "monsters can't walk through placed blocks." }
  const html = (b: Browser, path: string) => b.req(path, { headers: { accept: 'text/html' } })

  /** GET the form at `at`, then post `fields` with every field the page carries (its hidden parent too). */
  async function send(b: Browser, at: string, fields: Record<string, string>) {
    const page = await (await b.get(at)).text()
    const hidden = Object.fromEntries([...page.matchAll(/<input type="hidden" name="(parent)" value="([^"]+)"/g)].map(m => [m[1], m[2]]))
    return b.req('/new', { form: { form_token: formTokenIn(page), ...hidden, ...fields } })
  }

  it('signed out, ?parent= comes back to the same form after sign-in', async () => {
    const { env } = await world()
    const res = await new Browser(env).get('/new?parent=minecraft-in-doom')
    expect(res.headers.get('location')).toBe('/signin?next=%2Fnew%3Fparent%3Dminecraft-in-doom')
  })

  it('?parent= shows what the branch helps reach, with no tags or builds-on', async () => {
    const { env } = await world()
    const { b } = await member(env, 'ana')
    const page = await body(await b.get('/new?parent=minecraft-in-doom/block-placement'))
    expect(page).toContain('<h1 class="title" id="heading">new branch</h1>')
    expect(page).toContain('your branch goes live after a quick safety check. people are already working here.')
    expect(page).toMatch(/<nav class="crumbs"[^>]*><a href="\/w\/minecraft-in-doom">minecraft in doom<\/a><span>\/<\/span><a href="\/w\/minecraft-in-doom\/block-placement">block placement<\/a><span>\/<\/span>new branch<\/nav>/)
    expect(page).toContain('helping reach')
    expect(page).toContain('block placement is done when')
    expect(page).toContain('what is true when the branch is finished. people on the branch say so with a passed claim and their evidence')
    expect(page).toContain('name="parent" value="minecraft-in-doom/block-placement"')
    expect(page).not.toContain('name="tags"')
    expect(page).not.toMatch(/lobby/)
    expect(page).not.toContain('name="builds_on"')
    expect(page).not.toContain('id="license"')
    expect(page).not.toContain('inherits')
    expect(page).toContain('everything posted here is MIT.')
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
    const res = await send(b, '/new?parent=minecraft-in-doom', { ...BRANCH, done_when: '' })
    expect(res.status).toBe(400)
    const page = await body(res)
    expect(page).toContain('a node needs a done test: one sentence of what is true when it is finished.')
    expect(page).toContain('>start branch</button>')
    expect(page).toContain('name="parent" value="minecraft-in-doom"')
    expect(page).toContain('value="monster collision"')
  })

  it('a branch asks for no checks: its people say it passed with a claim they back (decided Oct 14)', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    const form = await body(await b.get('/new?parent=minecraft-in-doom'))
    expect(form).not.toContain("how it's checked")
    for (const field of ['c-author', 'c-machine', 'c-people', 'cmd', 'look']) expect(form).not.toContain(`id="${field}"`)
    // check boxes ticked by a stale form are ignored
    const res = await send(b, '/new?parent=minecraft-in-doom', { ...BRANCH, c_runs: 'on', command: './t.sh', runs: '2', c_people: 'on', people: '2' })
    expect(res.status).toBe(303)
    expect(q("SELECT checks FROM node WHERE path = 'minecraft-in-doom/monster-collision'")).toEqual({ checks: '{"author":false}' })
  })

  it('a shwarm takes branches the minute it is posted, and still does once it passed or is a dead end (nothing locks)', async () => {
    const { env, q, db } = await world()
    const { b } = await member(env, 'ana')
    const page = await body(await b.get(`/new?parent=${PLAIN}`))
    expect(page).toContain('name="title"')
    expect(page).not.toContain('is still a lobby')
    const id = (q('SELECT id FROM node WHERE path = ?', PLAIN) as { id: number }).id
    db.raw.prepare("INSERT INTO branch_status (node_id, current, changed_at, at) VALUES (?, 'dead_end', ?, ?)").run(id, new Date(T0).toISOString(), new Date(T0).toISOString())
    expect(await body(await b.get(`/new?parent=${PLAIN}`))).toContain('name="title"')
    const res = await send(b, `/new?parent=${PLAIN}`, BRANCH)
    expect(res.status).toBe(303)
    expect((q("SELECT COUNT(*) AS n FROM node WHERE kind = 'branch' AND path LIKE ?", `${PLAIN}/%`) as { n: number }).n).toBe(1)
  })

  it("a parent the viewer can't see is a 404", async () => {
    const { env, db } = await world()
    const { b } = await member(env, 'ana')
    expect((await b.get('/new?parent=no-such-thing')).status).toBe(404)
    expect((await b.get('/new?parent=../etc')).status).toBe(404)
    // Still being checked: only its author sees it, so only its author can branch it.
    db.raw.prepare("UPDATE node SET triage = 'pending' WHERE path = 'minecraft-in-doom/block-placement'").run()
    expect((await b.get('/new?parent=minecraft-in-doom/block-placement')).status).toBe(404)
    const res = await b.req('/new', { form: { form_token: formTokenIn(await (await b.get('/new')).text()), parent: 'minecraft-in-doom/block-placement', ...BRANCH } })
    expect(res.status).toBe(404)
  })

  it('?variant= is gone: the plain new shwarm form, and a variant field sent anyway makes a plain shwarm', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    const page = await body(await b.get('/new?variant=minecraft-in-doom'))
    expect(page).toContain('<h1 class="title" id="heading">new shwarm</h1>')
    expect(page).not.toMatch(/variant|the original is done when/)
    expect(page).toContain('value=""') // nothing prefilled
    const res = await b.req('/new', { form: { form_token: formTokenIn(page), variant: 'minecraft-in-doom', ...HELLO, title: 'minecraft in doom: survival' } })
    expect(res.status).toBe(303)
    expect(q("SELECT kind, state, variant_of_id FROM node WHERE path = 'minecraft-in-doom-survival'")).toEqual({ kind: 'shwarm', state: 'live', variant_of_id: null })
    // no page links to a variant form
    expect(await body(await html(b, '/w/minecraft-in-doom'))).not.toMatch(/variant/)
  })

  it('?builds_on= fills the builds-on field and names any shwarm, as of its latest pass', async () => {
    const { env, q, db } = await world()
    const { b } = await member(env, 'ana')
    // every shwarm offers it (decided Oct 14: build on any shwarm, at any time)
    expect(await body(await html(b, '/w/minecraft-in-doom'))).toContain('<a href="/new?builds_on=minecraft-in-doom">build on this shwarm</a>')
    // no pass yet: the chip names it, with nothing to be "as of"
    const open = await body(await b.get('/new?builds_on=minecraft-in-doom'))
    expect(open).toContain('name="builds_on" aria-describedby="up-hint" placeholder="https://github.com/… or a shwarm\'s link" autocomplete="off" value="minecraft-in-doom"')
    expect(open).toContain('<div class="picked" id="picked"><div><b>minecraft in doom</b> <span>/w/minecraft-in-doom</span></div></div>')
    // Unknown: as typed (core refuses it on send); nothing about it is looked up or shown (5.7).
    const unknown = await b.get('/new?builds_on=no-such-shwarm')
    expect(unknown.status).toBe(200)
    const unknownPage = await body(unknown)
    expect(unknownPage).toContain('autocomplete="off" value="no-such-shwarm"')
    expect(unknownPage).not.toContain('id="picked"')
    // once it has a pass record, the chip says which pass the new shwarm builds on
    const up = q("SELECT id FROM node WHERE path = 'minecraft-in-doom'") as { id: number }
    db.raw
      .prepare("INSERT INTO pass_record (id, node_id, kind, status, at, backers, pins, by_name, person_id) VALUES ('r_test0001', ?, 'author', 'passed', ?, 0, '[]', '@myra', NULL)")
      .run(up.id, new Date(T0 - 86_400_000).toISOString())
    const page = await body(await b.get('/new?builds_on=minecraft-in-doom'))
    expect(page).toContain('value="minecraft-in-doom"')
    expect(page).toContain('<div class="picked" id="picked"><div><b>minecraft in doom</b> <span>/w/minecraft-in-doom</span><span> · as passed oct 7</span></div></div>')
    // no license carries over, so the form says nothing of the upstream's (Oct 15)
    expect(page).not.toContain('GPL-3.0')
    expect(page).not.toContain('published under')
    // a different finish line: the done test starts empty, never the upstream's
    expect(/<textarea id="done" name="done_when"[^>]*>([^<]*)<\/textarea>/.exec(page)?.[1]).toBe('')
    // A full link works the same.
    expect(await body(await b.get(`/new?builds_on=${encodeURIComponent('https://shwarm.org/w/minecraft-in-doom')}`))).toContain('id="picked"')
    // A refused send comes back the same way: the chip shown.
    const refused = await create(b, { ...HELLO, title: 'minecraft in doom 2', tags: '', builds_on: 'minecraft-in-doom', license: 'MIT' })
    expect(refused.status).toBe(400)
    const again = await body(refused)
    expect(again).toContain('id="picked"')
    expect(again).not.toContain('id="license"')
    const res = await create(b, { ...HELLO, title: 'minecraft in doom 2', builds_on: 'minecraft-in-doom', license: 'MIT' })
    expect(res.status).toBe(303)
    const n = q("SELECT license, builds_on FROM node WHERE path = 'minecraft-in-doom-2'") as any
    expect(n).toEqual({ license: 'MIT', builds_on: JSON.stringify({ node: 'minecraft-in-doom', as_of: 'r_test0001' }) }) // no license carries over (Oct 15)
  })

  it("refuses to build on a shwarm the viewer can't see, as for one that isn't there (7.4 review)", async () => {
    const { env, q, db } = await world()
    const { b } = await member(env, 'ana')
    db.raw.prepare("UPDATE node SET triage = 'held' WHERE path = 'minecraft-in-doom'").run()
    const unknown = await body(await create(b, { ...HELLO, builds_on: 'no-such-shwarm' }))
    const res = await create(b, { ...HELLO, builds_on: 'minecraft-in-doom' })
    expect(res.status).toBe(400)
    const page = await body(res)
    expect(page).toContain('builds_on names a shwarm on shwarm, or an outside project as {name, url}.')
    expect(page).not.toContain('id="picked"')
    expect(page.replace(/minecraft-in-doom|no-such-shwarm|name="token" value="[^"]*"/g, '')).toBe(unknown.replace(/minecraft-in-doom|no-such-shwarm|name="token" value="[^"]*"/g, ''))
    expect(q("SELECT COUNT(*) AS n FROM node WHERE path = 'hello-world'")).toEqual({ n: 0 })
  })

  it('branches count toward the 3 new nodes a day', async () => {
    const { env } = await world()
    const { b } = await member(env, 'ana')
    for (let i = 1; i <= NEW_NODES_PER_DAY; i++) expect((await send(b, '/new?parent=minecraft-in-doom', { ...BRANCH, title: `fix ${i}` })).status).toBe(303)
    const res = await send(b, '/new?parent=minecraft-in-doom', { ...BRANCH, title: 'fix 4' })
    expect(res.status).toBe(429)
    const page = await body(res)
    expect(page).toContain("you've started 3 shwarms and branches in the last 24 hours")
    expect(page).toContain('>start branch</button>')
  })
})

describe('form parsing', () => {
  it('tags and other links', async () => {
    expect(parseTagField('#weird #games, gzdoom')).toEqual(['weird', 'games', 'gzdoom'])
    const o = 'https://shwarm.org'
    expect(await buildsOnFromForm({}, o)).toBeNull()
    expect(await buildsOnFromForm({ builds_on: 'https://shwarm.org/w/minecraft-in-doom/' }, o)).toBe('minecraft-in-doom')
    expect(await buildsOnFromForm({ builds_on: 'minecraft-in-doom' }, o)).toBe('minecraft-in-doom')
    // no license asked for (decided Oct 15: building on something no longer copies its license)
    expect(await buildsOnFromForm({ builds_on: 'https://codeberg.org/x/y', builds_on_name: 'y' }, o)).toEqual({ name: 'y', url: 'https://codeberg.org/x/y' })
    expect(await buildsOnFromForm({ builds_on: 'https://codeberg.org/x/y' }, o)).toEqual({ name: 'codeberg.org/x/y', url: 'https://codeberg.org/x/y' })
    const noLicense = (async () => new Response(JSON.stringify({ full_name: 'someone/no-license', html_url: 'https://github.com/someone/no-license', license: null }))) as unknown as typeof fetch
    expect(await buildsOnFromForm({ builds_on: 'https://github.com/someone/no-license' }, o, noLicense)).toEqual({ name: 'someone/no-license', url: 'https://github.com/someone/no-license' })
    await expect(buildsOnFromForm({ builds_on: 'javascript:alert(1)' }, o)).rejects.toThrow('web link')
  })
})
