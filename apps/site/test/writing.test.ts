// Go-live 4.4 and 4.5: the page's forms. Posting from the compose box (limit line, the inline 429 with the wait,
// mentions to the inbox, double clicks), and joining and leaving a shwarm (working on it; no lobby since Oct 9).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
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

const HTML = { accept: 'text/html' }

async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const q = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).get(...args)
  return { ...w, env, q }
}

async function member(env: ReturnType<typeof testEnv>, handle: string, o: { verified?: boolean } = {}) {
  const pid = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
  if (o.verified !== false) env.DB.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(new Date(T0).toISOString(), pid)
  const b = new Browser(env)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return { b, pid }
}

/** Submit one of the node page's forms the way the browser would: with the token from the page itself. */
async function act(b: Browser, path: string, fields: Record<string, string>) {
  const token = formTokenIn(await (await b.req(`/w/${path}`, { headers: HTML })).text())
  return b.req(`/w/${path}`, { form: { form_token: token, ...fields } })
}

describe('posting (4.5)', () => {
  it('posts as the bare handle and lands on the new post', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    const res = await act(b, EXAMPLE_ROOT, { do: 'post', text: 'hello world' })
    expect(res.status).toBe(303)
    const row = q("SELECT id, as_name, text FROM post WHERE text = 'hello world'") as { id: string; as_name: string }
    expect(row.as_name).toBe('@ana')
    expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}#${row.id}`)
    const html = await body(await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))
    expect(html).toContain(`id="${row.id}"`)
    expect(html).toContain('4 quick replies left, then 1 every 5 min')
  })

  it('the sixth quick post shows the wait and keeps the draft', async () => {
    const { env } = await world()
    const { b } = await member(env, 'ana')
    for (let i = 1; i <= 5; i++) expect((await act(b, EXAMPLE_ROOT, { do: 'post', text: `post ${i}` })).status).toBe(303)
    const res = await act(b, EXAMPLE_ROOT, { do: 'post', text: 'one too many' })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    const html = await body(res)
    expect(html).toContain('slow down: you can post here again in')
    expect(html).toContain('>one too many</textarea>')
  })

  it('a mention of @myra creates an inbox item', async () => {
    const { env, q, myraId } = await world()
    const { b } = await member(env, 'ana')
    expect((await act(b, EXAMPLE_ROOT, { do: 'post', text: 'hi @myra, look at this' })).status).toBe(303)
    expect((q("SELECT COUNT(*) AS n FROM inbox_item WHERE person_id = ? AND kind = 'mention'", myraId) as { n: number }).n).toBe(1)
  })

  it('a double click posts once', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    const token = formTokenIn(await (await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML })).text())
    const form = { form_token: token, do: 'post', text: 'only once' }
    const [r1, r2] = [await b.req(`/w/${EXAMPLE_ROOT}`, { form }), await b.req(`/w/${EXAMPLE_ROOT}`, { form })]
    expect(r1.headers.get('location')).toBe(r2.headers.get('location'))
    expect((q("SELECT COUNT(*) AS n FROM post WHERE text = 'only once'") as { n: number }).n).toBe(1)
  })

  it('replies to a post in the thread', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    await act(b, EXAMPLE_ROOT, { do: 'post', text: 'first' })
    const first = q("SELECT id FROM post WHERE text = 'first'") as { id: string }
    expect((await act(b, EXAMPLE_ROOT, { do: 'post', text: 'second', reply_to: first.id })).status).toBe(303)
    expect((q("SELECT reply_to FROM post WHERE text = 'second'") as { reply_to: string }).reply_to).toBe(first.id)
  })

  it('refuses empty posts, forged forms, signed-out posts and unverified accounts', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    const empty = await act(b, EXAMPLE_ROOT, { do: 'post', text: '   ' })
    expect(empty.status).toBe(400)
    expect(await body(empty)).toContain('write something first.')
    expect((await b.req(`/w/${EXAMPLE_ROOT}`, { form: { form_token: 'nope', do: 'post', text: 'x' } })).status).toBe(403)
    const out = new Browser(env)
    const res = await out.req(`/w/${EXAMPLE_ROOT}`, { form: { do: 'post', text: 'x' } })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`/signin?next=${encodeURIComponent('/w/' + EXAMPLE_ROOT)}`)
    const { b: unv } = await member(env, 'newbie', { verified: false })
    const html = await body(await unv.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))
    expect(html).toContain('verify your email to post')
    expect(html).not.toContain('name="text"')
    expect((q("SELECT COUNT(*) AS n FROM post WHERE text = 'x'") as { n: number }).n).toBe(0)
  })
})

describe('submitting from the compose box (5.1)', () => {
  const BRANCH = EXAMPLE_BRANCH
  const FILE = `https://codeberg.org/ana/doom-blocks/raw/branch/main/corner-fix-2.diff ${'4e'.repeat(32)}`
  const form = (o: Record<string, string> = {}) => ({
    do: 'submit',
    text: 'rounds toward negative infinity now. corners place every time.',
    links: FILE,
    how_to_check: 'load corner-repro.lmp, place 200 times on each corner. expect 0 failures.',
    ...o,
  })
  const subCount = (q: (sql: string, ...a: unknown[]) => unknown) =>
    (q('SELECT COUNT(*) AS n FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ?', BRANCH) as { n: number }).n

  it('a verified member sees the submit mode on a live node, a new launch shwarm too (no lobby), not on an ended one', async () => {
    const { env, db } = await world()
    const { b } = await member(env, 'ana')
    const html = await body(await b.req(`/w/${BRANCH}`, { headers: HTML }))
    expect(html).toContain('<summary>submit work against the done test</summary>')
    expect(html).toContain('<button class="btn" type="submit" name="do" value="submit">submit</button>')
    expect(html).toContain('<button class="btn plain" type="submit" name="do" value="post">post</button>')
    expect(html).not.toMatch(/<details class="submit" open/)
    expect(await body(await b.req(`/w/${PLAIN}`, { headers: HTML }))).toContain('submit work against the done test')
    db.raw.prepare("UPDATE node SET state = 'dead_end', dead_end_note = 'x' WHERE path = ?").run(PLAIN)
    expect(await body(await b.req(`/w/${PLAIN}`, { headers: HTML }))).not.toContain('submit work against the done test')
  })

  it('submits with links, built on, how to check and release fields, and lands on the new submission', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    const res = await act(b, BRANCH, form({
      links: `${FILE}\nhttps://codeberg.org/ana/doom-blocks ${'b'.repeat(40)} src/p_map.c`,
      built_on: '#2 the corner fix this goes on top of\n#1',
      release_name: 'doom blocks',
      release_version: '0.3.1',
      release_how_to_use: 'gzdoom -file doom-blocks.pk3',
    }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`/w/${BRANCH}/s/3`)
    const row = q("SELECT s.release_title, s.release_version, s.release_how_to_use, p.links FROM submission s JOIN post p ON p.id = s.post_id WHERE s.number = 3") as any
    expect(row).toMatchObject({ release_title: 'doom blocks', release_version: '0.3.1', release_how_to_use: 'gzdoom -file doom-blocks.pk3' })
    expect(JSON.parse(row.links)).toEqual([
      { url: 'https://codeberg.org/ana/doom-blocks/raw/branch/main/corner-fix-2.diff', sha256: '4e'.repeat(32) },
      { repo: 'https://codeberg.org/ana/doom-blocks', commit: 'b'.repeat(40), path: 'src/p_map.c' },
    ])
    const page = await body(await b.req(`/w/${BRANCH}/s/3`, { headers: HTML }))
    expect(page).toContain('<h1>submission #3</h1>')
    expect(page).toContain('<a href="/w/minecraft-in-doom/block-placement/s/2">@myra/m-07</a> #2 (the corner fix this goes on top of), <a href="/w/minecraft-in-doom/block-placement/s/1">@myra/m-04</a> #1</dd>')
    expect(page).toContain('<dt>release</dt><dd>doom blocks · version 0.3.1</dd>')
    expect(page).toContain('gzdoom -file doom-blocks.pk3')
    // the newer submission replaces #2 in review
    expect((q("SELECT s.status FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.number = 2", BRANCH) as { status: string }).status).toBe('superseded')
  })

  it('a second submission the same day is refused with the wait, and the draft is kept', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    expect((await act(b, BRANCH, form())).status).toBe(303)
    const res = await act(b, BRANCH, form({ text: 'a second try, same day', release_name: 'kept name' }))
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(80_000)
    const html = await body(res)
    expect(html).toContain('one submission per person per day here. next in about 24 hours.')
    expect(html).toContain('>a second try, same day</textarea>')
    expect(html).toContain(`>${FILE}</textarea>`)
    expect(html).toContain('value="kept name"')
    expect(html).toMatch(/<details class="submit" open/)
    expect(subCount(q)).toBe(3)
  })

  it('a double click submits once', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    const token = formTokenIn(await (await b.req(`/w/${BRANCH}`, { headers: HTML })).text())
    const [r1, r2] = [await b.req(`/w/${BRANCH}`, { form: { form_token: token, ...form() } }), await b.req(`/w/${BRANCH}`, { form: { form_token: token, ...form() } })]
    expect(r2.headers.get('location')).toBe(r1.headers.get('location'))
    expect(subCount(q)).toBe(3)
  })

  it('refuses a bad sha256, an unpinned link, no link, no how to check and a bad built on, inline with the draft kept', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    const cases: [Record<string, string>, string][] = [
      [{ links: 'https://x.org/fix.diff 3f9a' }, 'links[0].sha256 must be 64 lowercase hex characters.'],
      [{ links: 'https://x.org/fix.diff' }, 'links[0] needs a sha256 (a file) or a commit (a repo).'],
      [{ links: '' }, 'a submission links the work'],
      [{ how_to_check: '  ' }, 'how_to_check is required.'],
      [{ built_on: 'finn said so' }, 'built on, line 1: start with a post id (p_…) or a submission number (#1).'],
      [{ built_on: '#9' }, 'built on: there is no #9 here.'],
      [{ text: '' }, 'say what you did in the text box first.'],
    ]
    for (const [o, msg] of cases) {
      const res = await act(b, BRANCH, form({ how_to_check: 'kept steps', ...o }))
      expect(res.status, msg).toBe(400)
      const html = await body(res)
      expect(html, msg).toMatch(new RegExp(`<p class="err" role="alert">${msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
      expect(html).toMatch(/<details class="submit" open/)
      if (!('how_to_check' in o)) expect(html).toContain('>kept steps</textarea>')
    }
    expect(subCount(q)).toBe(2)
  })

  it('signed out goes to sign-in; an expired form is refused; a closed node takes no submissions', async () => {
    const { env, db, q } = await world()
    const out = await new Browser(env).req(`/w/${BRANCH}`, { form: form() })
    expect(out.status).toBe(303)
    expect(out.headers.get('location')).toBe(`/signin?next=${encodeURIComponent('/w/' + BRANCH)}`)
    const { b } = await member(env, 'ana')
    expect((await b.req(`/w/${BRANCH}`, { form: { form_token: 'expired', ...form() } })).status).toBe(403)
    db.raw.prepare("UPDATE node SET state = 'closed' WHERE path = ?").run(BRANCH)
    const token = formTokenIn(await (await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML })).text())
    const closed = await b.req(`/w/${BRANCH}`, { form: { form_token: token, ...form() } })
    expect(closed.status).toBe(400)
    expect(await body(closed)).toContain('is closed. it takes no submissions.')
    expect(subCount(q)).toBe(2)
  })
})

describe('join and leave (4.4, decided Oct 9)', () => {
  it('joining a new launch shwarm says you are working on it; it was live already', async () => {
    const { env, q } = await world()
    expect((q('SELECT state FROM node WHERE path = ?', PLAIN) as { state: string }).state).toBe('live')
    const { b } = await member(env, 'ana')
    expect(await body(await b.req(`/w/${PLAIN}`, { headers: HTML }))).toContain("join to say you're working on this.")
    const res = await act(b, PLAIN, { do: 'join' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`/w/${PLAIN}`)
    expect((q('SELECT state FROM node WHERE path = ?', PLAIN) as { state: string }).state).toBe('live')
    expect((q("SELECT COUNT(*) AS n FROM audit_event a JOIN node n ON n.id = a.node_id WHERE n.path = ?", PLAIN) as { n: number }).n).toBe(0)
    // a double click changes nothing
    expect((await act(b, PLAIN, { do: 'join' })).status).toBe(303)
    expect((q("SELECT COUNT(*) AS n FROM seat s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.left_at IS NULL", PLAIN) as { n: number }).n).toBe(2)
  })

  it("leaves any time while it's live, and the author can't leave", async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    await act(b, PLAIN, { do: 'join' })
    const html = await body(await b.req(`/w/${PLAIN}`, { headers: HTML }))
    expect(html).toContain("you're working on this.")
    expect(html).toContain('<button class="linkish" type="submit">leave</button>')
    expect((await act(b, PLAIN, { do: 'leave' })).status).toBe(303)
    expect((q("SELECT COUNT(*) AS n FROM seat s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.left_at IS NULL", PLAIN) as { n: number }).n).toBe(1)
    // the author's forged leave says why, at the top (the author's box has no leave)
    const author = new Browser(env)
    env.DB.raw.prepare('UPDATE person SET password_hash = ? WHERE handle = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), 'myra')
    expect((await author.post('/signin', { email: 'myra@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    const res = await act(author, PLAIN, { do: 'leave' })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain("the author can't leave their own shwarm.")
  })

  it('a refused join says why next to it', async () => {
    const { env, db } = await world()
    db.raw.prepare("UPDATE node SET state = 'closed' WHERE path = ?").run(PLAIN)
    const { b } = await member(env, 'ana')
    const token = formTokenIn(await (await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML })).text())
    const res = await b.req(`/w/${PLAIN}`, { form: { form_token: token, do: 'join' } })
    expect(res.status).toBe(400)
    expect(await body(res)).toMatch(/class="err[^"]*" role="alert">[^<]*closed/)
  })
})

describe('signed-out actions go to sign-in and back (4.1)', () => {
  it('join, post and start a shwarm each come back to where they started', async () => {
    const { env } = await world()
    const pid = await addPerson(env.DB, 'ana', { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
    env.DB.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(new Date(T0).toISOString(), pid)
    const out = new Browser(env)
    const plain = await body(await out.req(`/w/${PLAIN}`, { headers: HTML }))
    const post = await body(await out.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))
    const start = await out.get('/new')
    const legs: [string, string][] = [
      ['join', `/w/${PLAIN}`],
      ['post', `/w/${EXAMPLE_ROOT}`],
      ['start a shwarm', '/new'],
    ]
    expect(plain).toContain(`href="/signin?next=${encodeURIComponent(`/w/${PLAIN}`)}">join</a>`)
    expect(post).toContain(`href="/signin?next=${encodeURIComponent(`/w/${EXAMPLE_ROOT}`)}">sign in</a>`)
    expect(start.headers.get('location')).toBe('/signin?next=%2Fnew')
    for (const [what, next] of legs) {
      const b = new Browser(env)
      const res = await b.post('/signin', { email: 'ana@example.org', password: GOOD_PASSWORD, next })
      expect(res.headers.get('location'), what).toBe(next)
    }
  })
})
