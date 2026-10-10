// Go-live 9.4, the queue and the content acts: /admin (triage holds, appeals, flags, reports), /admin/node, /admin/post,
// /admin/report. Only an active admin past the step-up gets in (a plain 404 for everyone else, POSTs too); every act
// needs a reason and the form token, changes its state in one batch with exactly one moderation_action row (public for
// acts on content, private for resolving), and moves the node's version and the site-wide moderation version.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, repeatedIds, testEnv } from './browser'
import { PLAIN, stagingWorld } from './node-fixture'

const iso = (ms: number) => new Date(ms).toISOString()
const HTML = { accept: 'text/html' }
const LINKED = 'p_adminlink01'

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

async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const raw = w.db.raw
  const q = <T = any>(sql: string, ...args: unknown[]) => raw.prepare(sql).get(...args) as T
  const all = <T = any>(sql: string, ...args: unknown[]) => raw.prepare(sql).all(...args).map((r: any) => ({ ...r })) as T[]
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  raw.prepare('UPDATE person SET is_admin = 0').run()
  raw.prepare('UPDATE person SET password_hash = ?, is_admin = 1 WHERE id = ?').run(hash, w.myraId)
  const person = async (handle: string) => {
    const id = await addPerson(env.DB, handle, { hash })
    raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(iso(T0), id)
    return id
  }
  const ana = await person('ana')
  const bo = await person('bo')
  const nodeId = (path: string) => q<{ id: number }>('SELECT id FROM node WHERE path = ?', path).id
  const root = nodeId(EXAMPLE_ROOT)
  const branch = nodeId(EXAMPLE_BRANCH)
  // A post of ana's on the branch with two links, a report of it with her words, a copyright notice from the form,
  // and a DM's report.
  raw
    .prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, links, created_at) VALUES (?, ?, ?, '@ana', 'post', 'look at this', ?, ?)")
    .run(LINKED, branch, ana, JSON.stringify([{ url: 'https://codeberg.org/ana/one', sha256: 'a'.repeat(64) }, { url: 'https://bad.example/two', sha256: 'b'.repeat(64) }]), iso(T0 - 60_000))
  raw
    .prepare("INSERT INTO report (node_id, post_id, url, person_id, kind, reason, text, created_at) VALUES (?, ?, ?, ?, 'abuse', 'spam', 'this is an ad for a casino', ?)")
    .run(branch, LINKED, `/w/${EXAMPLE_BRANCH}#${LINKED}`, bo, iso(T0 - 50_000))
  raw
    .prepare("INSERT INTO report (node_id, url, contact, kind, reason, text, created_at) VALUES (?, ?, 'owner@example.com', 'copyright', 'copyright', 'my textures, copied', ?)")
    .run(root, `https://shwarm.org/w/${EXAMPLE_ROOT}`, iso(T0 - 40_000))
  raw
    .prepare("INSERT INTO report (url, person_id, kind, text, created_at) VALUES ('dm:d_abcdefgh12', ?, 'abuse', 'direct message d_abcdefgh12 from @x to @bo', ?)")
    .run(bo, iso(T0 - 30_000))
  const mods = () => all('SELECT by_person, action, node_id, post_id, person_id, reason, public FROM moderation_action ORDER BY id')
  const version = (id: number) => q<{ v: string }>('SELECT last_event_id AS v FROM node WHERE id = ?', id).v
  const moderated = () => q<{ value: string } | undefined>("SELECT value FROM setting WHERE key = 'moderated_at'")?.value ?? null
  return { ...w, env, q, all, ana, bo, root, branch, mods, version, moderated }
}

async function signIn(env: ReturnType<typeof testEnv>, handle: string) {
  const b = new Browser(env)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}

/** POST an act with the token from the page it's on. */
async function act(b: Browser, path: string, fields: Record<string, string>) {
  const token = formTokenIn(await (await b.get(path)).text())
  return b.req(path, { form: { form_token: token, ...fields } })
}

const nodeUrl = (path: string) => `/admin/node?path=${encodeURIComponent(path)}`
const postUrl = (id: string) => `/admin/post?id=${id}`

describe('the gate', () => {
  it('is a plain 404 for everyone but an admin, on every page and form', async () => {
    const w = await world()
    const signedOut = new Browser(w.env)
    const ana = await signIn(w.env, 'ana')
    const pages = ['/admin', nodeUrl(EXAMPLE_ROOT), postUrl(LINKED), '/admin/report?id=1']
    for (const b of [signedOut, ana]) {
      for (const p of pages) expect((await b.get(p)).status, p).toBe(404)
      const token = await b.token()
      const posts: [string, Record<string, string>][] = [
        [nodeUrl(EXAMPLE_ROOT), { do: 'hide', reason: 'spam' }],
        [postUrl(LINKED), { do: 'hide', reason: 'spam' }],
        ['/admin/report?id=1', { do: 'resolve', reason: 'ok' }],
      ]
      for (const [p, f] of posts) expect((await b.req(p, { form: { form_token: token, ...f } })).status, p).toBe(404)
    }
    expect(w.mods()).toEqual([])
    expect(w.q('SELECT hidden FROM node WHERE id = ?', w.root).hidden).toBe(0)
    expect(w.q('SELECT hidden FROM post WHERE id = ?', LINKED).hidden).toBe(0)
  })

  it('sends an admin whose password window closed to step up, and changes nothing', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    const token = formTokenIn(await (await myra.get('/admin')).text())
    w.env.DB.raw.prepare('UPDATE session SET step_up_until = NULL').run()
    const get = await myra.get('/admin')
    expect(get.status).toBe(303)
    expect(get.headers.get('location')).toBe('/step-up?next=%2Fadmin')
    const post = await myra.req(nodeUrl(EXAMPLE_ROOT), { form: { form_token: token, do: 'hide', reason: 'spam' } })
    expect(post.status).toBe(303)
    expect(post.headers.get('location')).toBe(`/step-up?next=${encodeURIComponent(nodeUrl(EXAMPLE_ROOT))}`)
    expect(w.mods()).toEqual([])
    expect(w.q('SELECT hidden FROM node WHERE id = ?', w.root).hidden).toBe(0)
  })

  it('refuses a form without its token, with nothing changed', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    const res = await myra.req(nodeUrl(EXAMPLE_ROOT), { form: { form_token: 'forged', do: 'hide', reason: 'spam' } })
    expect(res.status).toBe(403)
    expect(await body(res)).toContain('this form expired')
    const ana = await signIn(w.env, 'ana')
    const anas = await ana.token() // another session's token
    expect((await myra.req(postUrl(LINKED), { form: { form_token: anas, do: 'hide', reason: 'spam' } })).status).toBe(403)
    expect((await myra.req('/admin/report?id=1', { form: { do: 'resolve', reason: 'ok' } })).status).toBe(403)
    expect(w.mods()).toEqual([])
    expect(w.q('SELECT hidden FROM node WHERE id = ?', w.root).hidden).toBe(0)
    expect(w.q('SELECT resolved_at FROM report WHERE id = 1').resolved_at).toBeNull()
  })
})

describe('the queue', () => {
  it('lists triage holds, appeals, flags with counts and open reports with what the reporter wrote', async () => {
    const w = await world()
    const raw = w.env.DB.raw
    raw.prepare("UPDATE node SET triage = 'held' WHERE path = ?").run(PLAIN)
    raw.prepare('UPDATE node SET paused = 1 WHERE id = ?').run(w.root)
    raw.prepare("INSERT INTO flag (node_id, person_id, reason, created_at) VALUES (?, ?, 'weapons', ?)").run(w.root, w.ana, iso(T0 - 1000))
    const myra = await signIn(w.env, 'myra')
    const res = await myra.get('/admin')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    const html = await body(res)
    expect(repeatedIds(html)).toEqual([])
    const section = (id: string) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</section>', html.indexOf(`id="${id}"`)))
    expect(section('triage')).toContain(`href="/admin/node?path=${PLAIN}"`)
    expect(section('triage')).toContain('held')
    expect(section('appeals')).toContain("appeals aren't built yet")
    expect(section('flags')).toContain(`href="/admin/node?path=${EXAMPLE_ROOT}"`)
    expect(section('flags')).toContain('<b>paused</b>')
    expect(section('flags')).toContain('@ana')
    const reports = section('reports')
    expect(reports).toContain('this is an ad for a casino')
    expect(reports).toContain(`href="/admin/post?id=${LINKED}"`)
    expect(reports).toContain('copyright notice')
    expect(reports).toContain('owner@example.com')
    expect(reports).toContain('direct message d_abcdefgh12')
    // newest first: the DM's report, the copyright notice, the post report
    expect(reports.indexOf('report 3')).toBeLessThan(reports.indexOf('report 2'))
    expect(reports.indexOf('report 2')).toBeLessThan(reports.indexOf('report 1'))
    expect(html).toContain('confirms with your password.')
  })
})

describe('acts on a node', () => {
  it('hide: a public row, a new version for it and its parent, and the page answers 410 with the reason; restore undoes it', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    const [v0, p0, m0] = [w.version(w.branch), w.version(w.root), w.moderated()]
    const res = await act(myra, nodeUrl(EXAMPLE_BRANCH), { do: 'hide', reason: '  copies a  paid texture pack ' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${nodeUrl(EXAMPLE_BRANCH)}&done=hide`)
    expect(w.q('SELECT hidden FROM node WHERE id = ?', w.branch).hidden).toBe(1)
    expect(w.mods()).toEqual([{ by_person: w.myraId, action: 'hide', node_id: w.branch, post_id: null, person_id: null, reason: 'copies a paid texture pack', public: 1 }])
    expect(w.version(w.branch)).not.toBe(v0)
    expect(w.version(w.root)).not.toBe(p0)
    expect(w.moderated()).not.toBe(m0)
    expect(await body(await myra.get(`${nodeUrl(EXAMPLE_BRANCH)}&done=hide`))).toContain('hidden. its page answers 410 with your reason.')

    const gone = await new Browser(w.env).req(`/w/${EXAMPLE_BRANCH}`, { headers: HTML })
    expect(gone.status).toBe(410)
    expect(await body(gone)).toContain('reason: copies a paid texture pack')

    expect((await act(myra, nodeUrl(EXAMPLE_BRANCH), { do: 'unhide', reason: 'it was the free pack' })).status).toBe(303)
    expect(w.q('SELECT hidden FROM node WHERE id = ?', w.branch).hidden).toBe(0)
    expect(w.mods().map(m => [m.action, m.public])).toEqual([['hide', 1], ['unhide', 1]])
    expect((await new Browser(w.env).req(`/w/${EXAMPLE_BRANCH}`, { headers: HTML })).status).toBe(200)
  })

  it('a missing or too-long reason is refused with nothing changed; so is an act that changes nothing', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    const v0 = w.version(w.root)
    for (const reason of ['', '   ', 'x'.repeat(501)]) {
      const res = await act(myra, nodeUrl(EXAMPLE_ROOT), { do: 'hide', reason })
      expect(res.status).toBe(400)
      expect(await body(res)).toContain('say why: one line, up to 500 characters.')
    }
    const none = await act(myra, nodeUrl(EXAMPLE_ROOT), { do: 'hide' })
    expect(none.status).toBe(400)
    const already = await act(myra, nodeUrl(EXAMPLE_ROOT), { do: 'unhide', reason: 'nothing to undo' })
    expect(already.status).toBe(400)
    expect(await body(already)).toContain('this shwarm is not hidden already.')
    const unpause = await act(myra, nodeUrl(EXAMPLE_ROOT), { do: 'unpause', reason: 'x' })
    expect(await body(unpause)).toContain("this shwarm isn't paused.")
    expect((await act(myra, nodeUrl(EXAMPLE_ROOT), { do: 'block', reason: 'x', category: 'nope' })).status).toBe(400)
    expect((await act(myra, postUrl(LINKED), { do: 'hide', reason: '' })).status).toBe(400)
    expect((await act(myra, postUrl(LINKED), { do: 'remove_link', link: '7', reason: 'x' })).status).toBe(400)
    expect((await act(myra, '/admin/report?id=1', { do: 'resolve', reason: '' })).status).toBe(400)
    expect(w.mods()).toEqual([])
    expect(w.version(w.root)).toBe(v0)
    expect(w.q('SELECT hidden FROM node WHERE id = ?', w.root).hidden).toBe(0)
    expect(w.q('SELECT hidden, links FROM post WHERE id = ?', LINKED).hidden).toBe(0)
    expect(w.q('SELECT resolved_at FROM report WHERE id = 1').resolved_at).toBeNull()
  })

  it('overturns triage as triage.mjs does: clear a held node, then block it with a category', async () => {
    const w = await world()
    const raw = w.env.DB.raw
    raw.prepare("UPDATE node SET triage = 'held' WHERE path = ?").run(PLAIN)
    const id = w.q('SELECT id FROM node WHERE path = ?', PLAIN).id
    const myra = await signIn(w.env, 'myra')
    const v0 = w.version(id)
    expect((await act(myra, nodeUrl(PLAIN), { do: 'clear', reason: 'a fair contest' })).status).toBe(303)
    expect(w.q('SELECT triage FROM node WHERE id = ?', id).triage).toBe('clear')
    expect(w.version(id)).not.toBe(v0)
    expect(w.mods()).toEqual([{ by_person: w.myraId, action: 'clear_triage', node_id: id, post_id: null, person_id: null, reason: 'a fair contest', public: 1 }])
    expect(w.q("SELECT model, answer FROM triage_decision WHERE node_id = ? ORDER BY id DESC LIMIT 1", id)).toEqual({ model: 'myra', answer: 'no' })
    const v1 = w.version(id)
    expect((await act(myra, nodeUrl(PLAIN), { do: 'block', category: 'spam', reason: 'a link farm' })).status).toBe(303)
    expect(w.q('SELECT triage FROM node WHERE id = ?', id).triage).toBe('blocked')
    expect(w.version(id)).not.toBe(v1)
    expect(w.mods().map(m => [m.action, m.reason, m.public])).toEqual([['clear_triage', 'a fair contest', 1], ['block_triage', 'spam: a link farm', 1]])
  })

  it('unpause: one public row, its open flags resolved, a new version', async () => {
    const w = await world()
    const raw = w.env.DB.raw
    raw.prepare('UPDATE node SET paused = 1 WHERE id = ?').run(w.root)
    raw.prepare("INSERT INTO flag (node_id, person_id, reason, created_at) VALUES (?, ?, 'spam', ?), (?, ?, 'weapons', ?)").run(w.root, w.ana, iso(T0), w.root, w.bo, iso(T0))
    const myra = await signIn(w.env, 'myra')
    const page = await body(await myra.get(nodeUrl(EXAMPLE_ROOT)))
    expect(repeatedIds(page)).toEqual([])
    expect(page).toContain('value="unpause"')
    const v0 = w.version(w.root)
    expect((await act(myra, nodeUrl(EXAMPLE_ROOT), { do: 'unpause', reason: 'flags were a pile-on' })).status).toBe(303)
    expect(w.q('SELECT paused FROM node WHERE id = ?', w.root).paused).toBe(0)
    expect(w.all('SELECT resolved_at FROM flag').every(f => f.resolved_at === iso(T0))).toBe(true)
    expect(w.version(w.root)).not.toBe(v0)
    expect(w.mods()).toEqual([{ by_person: w.myraId, action: 'unpause', node_id: w.root, post_id: null, person_id: null, reason: 'flags were a pile-on', public: 1 }])
  })

  it('resolves one flag or all of them, with one private row', async () => {
    const w = await world()
    const raw = w.env.DB.raw
    raw.prepare("INSERT INTO flag (node_id, person_id, reason, created_at) VALUES (?, ?, 'spam', ?), (?, ?, 'weapons', ?)").run(w.root, w.ana, iso(T0), w.root, w.bo, iso(T0))
    const [first] = w.all('SELECT id FROM flag ORDER BY id')
    const myra = await signIn(w.env, 'myra')
    const v0 = w.version(w.root)
    expect((await act(myra, nodeUrl(EXAMPLE_ROOT), { do: 'resolve_flags', flag: String(first.id), reason: 'not spam' })).status).toBe(303)
    expect(w.all('SELECT resolved_at FROM flag ORDER BY id').map(f => f.resolved_at)).toEqual([iso(T0), null])
    expect((await act(myra, nodeUrl(EXAMPLE_ROOT), { do: 'resolve_flags', flag: 'all', reason: 'looked, fine' })).status).toBe(303)
    expect(w.all('SELECT resolved_at FROM flag').every(f => f.resolved_at)).toBe(true)
    expect(w.mods().map(m => [m.action, m.node_id, m.public])).toEqual([['resolve_flag', w.root, 0], ['resolve_flag', w.root, 0]])
    expect(w.version(w.root)).toBe(v0) // nothing public changed
    expect((await act(myra, nodeUrl(EXAMPLE_ROOT), { do: 'resolve_flags', flag: 'all', reason: 'again' })).status).toBe(400)
    expect(w.mods()).toHaveLength(2)
  })
})

describe('acts on a post', () => {
  it('hide takes it out of the thread with one public row and a new node version; restore brings it back', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    const page = await body(await myra.get(postUrl(LINKED)))
    expect(repeatedIds(page)).toEqual([])
    expect(page).toContain('look at this')
    const thread = async () => body(await new Browser(w.env).req(`/w/${EXAMPLE_BRANCH}`, { headers: HTML }))
    expect(await thread()).toContain('look at this')
    const [v0, m0] = [w.version(w.branch), w.moderated()]
    const res = await act(myra, postUrl(LINKED), { do: 'hide', reason: 'casino ad' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${postUrl(LINKED)}&done=hide`)
    expect(w.q('SELECT hidden FROM post WHERE id = ?', LINKED).hidden).toBe(1)
    expect(w.mods()).toEqual([{ by_person: w.myraId, action: 'hide', node_id: w.branch, post_id: LINKED, person_id: null, reason: 'casino ad', public: 1 }])
    expect(w.version(w.branch)).not.toBe(v0)
    expect(w.moderated()).not.toBe(m0)
    forgetVersions()
    expect(await thread()).not.toContain('look at this')
    expect((await act(myra, postUrl(LINKED), { do: 'unhide', reason: 'misread it' })).status).toBe(303)
    expect(w.q('SELECT hidden FROM post WHERE id = ?', LINKED).hidden).toBe(0)
    expect(w.mods().map(m => m.action)).toEqual(['hide', 'unhide'])
  })

  it('removes one link by its place, with one public row and a new node version', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    const page = await body(await myra.get(postUrl(LINKED)))
    expect(page).toContain('https://bad.example/two')
    const v0 = w.version(w.branch)
    expect((await act(myra, postUrl(LINKED), { do: 'remove_link', link: '1', was: JSON.stringify({ url: 'https://bad.example/two', sha256: 'b'.repeat(64) }), reason: 'malware' })).status).toBe(303)
    expect(JSON.parse(w.q('SELECT links FROM post WHERE id = ?', LINKED).links)).toEqual([{ url: 'https://codeberg.org/ana/one', sha256: 'a'.repeat(64) }])
    expect(w.mods()).toEqual([{ by_person: w.myraId, action: 'remove_link', node_id: w.branch, post_id: LINKED, person_id: null, reason: 'malware', public: 1 }])
    expect(w.version(w.branch)).not.toBe(v0)
    expect(await body(await myra.get(`${postUrl(LINKED)}&done=remove_link`))).toContain('link removed.')
  })
})

describe('resolving a report', () => {
  it('sets resolved_at and the resolution, writes one private row, and leaves the queue', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    const page = await body(await myra.get('/admin/report?id=1'))
    expect(page).toContain('this is an ad for a casino')
    expect(page).toContain('@bo')
    const v0 = w.version(w.branch)
    const token = formTokenIn(await (await myra.get('/admin')).text())
    const r = await myra.req('/admin/report?id=1', { form: { form_token: token, do: 'resolve', back: 'queue', reason: 'hid the post' } })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/admin?done=resolve#reports')
    expect(w.q('SELECT resolved_at, resolution FROM report WHERE id = 1')).toEqual({ resolved_at: iso(T0), resolution: 'hid the post' })
    expect(w.mods()).toEqual([{ by_person: w.myraId, action: 'resolve_report', node_id: w.branch, post_id: LINKED, person_id: null, reason: 'hid the post', public: 0 }])
    expect(w.version(w.branch)).toBe(v0)
    const queue = await body(await myra.get('/admin?done=resolve'))
    expect(queue).toContain('report resolved.')
    expect(queue).not.toContain('this is an ad for a casino')
    // A DM's report has no node or post.
    expect((await act(myra, '/admin/report?id=3', { do: 'resolve', reason: 'blocked the sender' })).status).toBe(303)
    expect(w.mods()[1]).toMatchObject({ action: 'resolve_report', node_id: null, post_id: null, public: 0 })
    expect((await act(myra, '/admin/report?id=3', { do: 'resolve', reason: 'again' })).status).toBe(400)
    expect(w.mods()).toHaveLength(2)
  })
})
