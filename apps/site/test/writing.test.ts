// Go-live 4.4 and 4.5: the page's forms. Posting from the compose box (limit line, the inline 429 with the wait,
// mentions to the inbox, double clicks), no submit mode since Oct 14, and joining and leaving a shwarm (working on it;
// no lobby since Oct 9).
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

// Only a shwarm takes submissions (decided Oct 14): the example shwarm, where @myra's #1 and #2 are.
describe('no submissions (decided Oct 14: a pass is a passed claim people back)', () => {
  it('no submit mode on a shwarm or a branch, and a submit form from an old tab is refused with why', async () => {
    const { env, q } = await world()
    const { b } = await member(env, 'ana')
    for (const path of [EXAMPLE_ROOT, EXAMPLE_BRANCH, PLAIN]) {
      const html = await body(await b.req(`/w/${path}`, { headers: HTML }))
      expect(html, path).not.toContain('submit work against the done test')
      expect(html, path).not.toContain('value="submit"')
      expect(html, path).toContain('<button class="btn plain" type="submit" name="do" value="post">post</button>')
    }
    const res = await act(b, EXAMPLE_ROOT, { do: 'submit', text: 'my old draft', links: `https://codeberg.org/ana/fix.diff ${'4e'.repeat(32)}`, how_to_check: 'run it.' })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('a shwarm or branch takes no submissions. to say it passes, post a passed claim with your evidence.')
    expect((q("SELECT COUNT(*) AS n FROM post WHERE text = 'my old draft'") as { n: number }).n).toBe(0)
  })
})

describe('join and leave (4.4, decided Oct 9)', () => {
  it('joining a new launch shwarm says you are working on it; it was live already', async () => {
    const { env, q } = await world()
    expect((q('SELECT state FROM node WHERE path = ?', PLAIN) as { state: string }).state).toBe('live')
    const { b } = await member(env, 'ana')
    expect(await body(await b.req(`/w/${PLAIN}`, { headers: HTML }))).toContain("or give your agent this shwarm's url:")
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
    expect(html).toContain("you're working on this shwarm.")
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
    // nothing locks (decided Oct 14), but a paused node takes no writes until the operator looks (core/flags.ts)
    db.raw.prepare('UPDATE node SET paused = 1 WHERE path = ?').run(PLAIN)
    const { b } = await member(env, 'ana')
    const token = formTokenIn(await (await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML })).text())
    const res = await b.req(`/w/${PLAIN}`, { form: { form_token: token, do: 'join' } })
    expect(res.status).toBe(400)
    expect(await body(res)).toMatch(/<div class="late">[\s\S]*?<p class="err" role="alert">[^<]*paused[^<]*<\/p>/)
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
