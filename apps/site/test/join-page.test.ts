// Go-live 8.2, the site half: joining from the page (decided Oct 12, "Joining as a celebration: one design", "Branches
// can be joined"). A join button on the node's own post and one in the contributors box, one "say hi!" modal with
// Myra's words, the hello as a post marked "✿ joined" or a quiet "✿ @you joined" line, joined state and leave, branches,
// a refused join keeping its words in the reopened modal, and a person's joined agents grouped under them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { MAX_TEXT } from '../src/core/text'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, repeatedIds, testEnv } from './browser'
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

async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const q = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).get(...args) as any
  return { ...w, env, q }
}

async function member(env: ReturnType<typeof testEnv>, handle: string) {
  const pid = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
  env.DB.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(new Date(T0).toISOString(), pid)
  const b = new Browser(env)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return { b, pid }
}

const page = async (b: Browser, path: string) => body(await b.req(`/w/${path}`, { headers: HTML }))
async function act(b: Browser, path: string, fields: Record<string, string>) {
  const token = formTokenIn(await page(b, path))
  return b.req(`/w/${path}`, { form: { form_token: token, ...fields } })
}
/** One part of the page, from its opening tag to the next part's. */
const part = (html: string, from: string, to: string) => {
  const i = html.indexOf(from)
  expect(i, from).toBeGreaterThan(-1)
  return html.slice(i, html.indexOf(to, i + from.length))
}
const head = (html: string) => part(html, '<div class="state">', '</section>')
const modal = (html: string) => part(html, '<div class="dn-scrim" id="jn-scrim"', '<script src="/js/node.js"')
const late = (html: string) => part(html, '<div class="late">', '<div class="box agent-res">')

describe('the join buttons and the say-hi modal (8.2)', () => {
  it("a shwarm: join under the live badge and in contributors, both open one modal with Myra's words", async () => {
    const { env } = await world()
    const { b } = await member(env, 'ana')
    const html = await page(b, EXAMPLE_ROOT)
    expect(repeatedIds(html)).toEqual([])
    // the head: the status, then join (a form that posts a plain join with scripts off)
    const h = head(html)
    expect(h).toMatch(/^<div class="state"><span class="st live">[^<]*<\/span><span id="jn-state"><form method="post" action="\/w\/minecraft-in-doom" class="seat-act">/)
    expect(h).toContain('<input type="hidden" name="do" value="join"/><button class="btn jn-open" type="submit">join</button>')
    expect(late(html)).toContain('<button class="btn plain jn-open" type="submit">join</button>')
    expect(late(html)).toContain("join to say you're working on this.")
    // the modal: hidden until a button opens it, a dialog with a name, the words exactly as approved
    const m = modal(html)
    expect(m).toMatch(/^<div class="dn-scrim" id="jn-scrim" hidden="">/)
    expect(m).toContain('<form class="dn jn seat-act" role="dialog" aria-modal="true" aria-labelledby="jn-title" method="post" action="/w/minecraft-in-doom">')
    expect(m).toContain('<h2 id="jn-title"><span>say hi!</span><button type="button" id="jn-close" aria-label="close">×</button></h2>')
    expect(m).toContain('<p>you are joining the <b>root</b> branch of <b>minecraft in doom</b>. you can leave at any time.</p>')
    expect(m).toContain('<label for="jn-hi" class="jn-label">introduce yourself and your agents below. what will you be working on? (optional)</label>')
    expect(m).toContain(`<textarea id="jn-hi" name="hello" maxlength="${MAX_TEXT}"></textarea>`)
    expect(m).toContain('<div class="sec go"><span></span><button class="btn" type="submit" id="jn-go">join</button></div>')
    expect(m).toContain('<input type="hidden" name="do" value="join"/>')
  })

  it("a branch: the branch's title and the shwarm's in the modal, \"on this branch\" offers join", async () => {
    const { env } = await world()
    const { b } = await member(env, 'ana')
    const html = await page(b, EXAMPLE_BRANCH)
    expect(head(html)).toContain('<button class="btn jn-open" type="submit">join</button>')
    expect(modal(html)).toContain('<p>you are joining the <b>block placement</b> branch of <b>minecraft in doom</b>. you can leave at any time.</p>')
    expect(late(html)).toContain("join to say you're working on this branch.")
    expect(html).toContain('<li>press "join" when you start, so others know someone\'s on it.</li>')
  })

  it('signed out: both joins go to sign-in and back; no modal', async () => {
    const { env } = await world()
    const html = await page(new Browser(env), EXAMPLE_ROOT)
    expect(head(html)).toContain(`<span id="jn-state"><a class="btn" href="/signin?next=%2Fw%2F${EXAMPLE_ROOT}">join</a></span>`)
    expect(html).toContain(`<a class="btn plain" href="/signin?next=%2Fw%2F${EXAMPLE_ROOT}">join</a>`)
    expect(html).not.toContain('id="jn-scrim"')
  })

  it('an ended node offers no join anywhere', async () => {
    const { env, db } = await world()
    db.raw.prepare("UPDATE node SET state = 'dead_end', dead_end_note = 'x' WHERE path = ?").run(PLAIN)
    const { b } = await member(env, 'ana')
    const html = await page(b, PLAIN)
    expect(head(html)).not.toContain('join')
    expect(html).not.toContain('id="jn-scrim"')
  })
})

describe('joining from the modal (8.2)', () => {
  it('with words: a post marked "✿ joined", the page lands on it, both buttons say joined, leave undoes it', async () => {
    const { env, q } = await world()
    const { b, pid } = await member(env, 'ana')
    const res = await act(b, EXAMPLE_ROOT, { do: 'join', hello: "hi! i'm on block placement with @myra. my agents run the soak test." })
    expect(res.status).toBe(303)
    const post = q('SELECT id, as_name, is_join, kind FROM post WHERE person_id = ? AND is_join = 1', pid)
    expect(post).toMatchObject({ as_name: '@ana', is_join: 1, kind: 'post' })
    expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}#${post.id}`)
    // a mention in the hello reaches the inbox, as in any post
    expect(q("SELECT COUNT(*) AS n FROM inbox_item i JOIN person p ON p.id = i.person_id WHERE p.handle = 'myra' AND i.kind = 'mention' AND i.post_id = ?", post.id).n).toBe(1)
    const html = await page(b, EXAMPLE_ROOT)
    expect(html).toContain(`<div class="c jn-mine" id="${post.id}"><div class="who"><span class="jt">✿ joined</span><b><a href="/@ana">@ana</a></b>`)
    expect(head(html)).toContain('<span id="jn-state"><span class="joined" tabindex="-1">✿ joined</span></span>')
    expect(late(html)).toContain(`<div class="note"><b>you're working on this.</b> <a href="#${post.id}">your join is in the thread</a> · <form method="post" action="/w/${EXAMPLE_ROOT}" class="seat-act">`)
    expect(late(html)).toContain('<button class="linkish" type="submit">leave</button>')
    expect(html).not.toContain('id="jn-scrim"') // nothing left to join
    // a signed-out reader sees the marked post too
    expect(await page(new Browser(env), EXAMPLE_ROOT)).toContain('<span class="jt">✿ joined</span><b><a href="/@ana">@ana</a></b>')
    // a second click posts nothing more
    expect((await act(b, EXAMPLE_ROOT, { do: 'join', hello: 'hi again' })).status).toBe(303)
    expect(q('SELECT COUNT(*) AS n FROM post WHERE person_id = ?', pid).n).toBe(1)
    // leave: both buttons come back
    expect((await act(b, EXAMPLE_ROOT, { do: 'leave' })).status).toBe(303)
    const after = await page(b, EXAMPLE_ROOT)
    expect(head(after)).toContain('<button class="btn jn-open" type="submit">join</button>')
    expect(after).toContain('id="jn-scrim"')
  })

  it('with no words: no post, a quiet "✿ @ana joined" line under the pinned post, which "your join" points at', async () => {
    const { env, q } = await world()
    const { b, pid } = await member(env, 'ana')
    const res = await act(b, EXAMPLE_ROOT, { do: 'join', hello: '   ' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}`)
    expect(q('SELECT COUNT(*) AS n FROM post WHERE person_id = ?', pid).n).toBe(0)
    const html = await page(b, EXAMPLE_ROOT)
    expect(html).toMatch(/<div class="c ev jn-mine" id="jn-row">✿ <b><a href="\/@ana">@ana<\/a><\/b> joined · <span title="[^"]+">[^<]+<\/span><\/div>/)
    // right under the pinned post (and its replies), before the thread's other posts
    const pin = html.indexOf('<div class="c pin"')
    const line = html.indexOf('id="jn-row"')
    expect(pin).toBeGreaterThan(-1)
    expect(line).toBeGreaterThan(pin)
    expect(html.slice(pin + 1, html.lastIndexOf('<div', line)).match(/<div class="c( |")/g)?.length ?? 0).toBe(0)
    expect(late(html)).toContain('<a href="#jn-row">your join is in the thread</a>')
    // signed out it's a plain quiet line; filtered to agents, it's gone
    const out = await page(new Browser(env), EXAMPLE_ROOT)
    expect(out).toMatch(/<div class="c ev">✿ <b><a href="\/@ana">@ana<\/a><\/b> joined · /)
    expect(await body(await new Browser(env).req(`/w/${EXAMPLE_ROOT}?show=agents`, { headers: HTML }))).not.toContain('<a href="/@ana">@ana</a></b> joined')
  })

  it('a branch: joined there and counted in the shwarm; leaving the branch leaves only it', async () => {
    const { env, q } = await world()
    const { b, pid } = await member(env, 'ana')
    expect((await act(b, EXAMPLE_BRANCH, { do: 'join' })).status).toBe(303)
    const seats = () => env.DB.raw.prepare('SELECT n.path, s.left_at IS NULL AS here FROM seat s JOIN node n ON n.id = s.node_id WHERE s.person_id = ? ORDER BY n.path').all(pid)
    expect(seats()).toEqual([{ path: EXAMPLE_ROOT, here: 1 }, { path: EXAMPLE_BRANCH, here: 1 }])
    const html = await page(b, EXAMPLE_BRANCH)
    expect(head(html)).toContain('✿ joined')
    expect(html).toContain('id="jn-row"')
    expect((await act(b, EXAMPLE_BRANCH, { do: 'leave' })).status).toBe(303)
    expect(seats()).toEqual([{ path: EXAMPLE_ROOT, here: 1 }, { path: EXAMPLE_BRANCH, here: 0 }])
    expect(q('SELECT COUNT(*) AS n FROM post WHERE person_id = ?', pid).n).toBe(0)
  })

  it('a refused join with words opens the modal again, with the reason and the words kept', async () => {
    const { env } = await world()
    const { b } = await member(env, 'ana')
    const long = 'x'.repeat(MAX_TEXT + 1)
    const res = await act(b, EXAMPLE_ROOT, { do: 'join', hello: long })
    expect(res.status).toBe(400)
    const html = await body(res)
    const m = modal(html)
    expect(m).toMatch(/^<div class="dn-scrim" id="jn-scrim">/) // open, not hidden
    expect(m).toContain(`aria-describedby="jn-err" autofocus="">${long}</textarea>`)
    expect(m).toMatch(/<p class="err" id="jn-err" role="alert">[^<]+<\/p>/)
    expect(late(html)).not.toContain('role="alert"')
  })
})

describe('agents in contributors and the thread (8.2)', () => {
  it("a person's joined agents sit beside them, \"@ana · @ana/claude\"; an agent's join is a quiet line", async () => {
    const { env, db } = await world()
    const { b, pid } = await member(env, 'ana')
    const node = db.raw.prepare('SELECT id FROM node WHERE path = ?').get(EXAMPLE_ROOT) as { id: number }
    const at = new Date(T0 - 60_000).toISOString()
    db.raw.prepare('INSERT INTO agent_seat (node_id, as_name, person_id, key_id, through_id, joined_at) VALUES (?, ?, ?, NULL, NULL, ?)').run(node.id, '@ana/claude', pid, at)
    db.raw.prepare('UPDATE node SET last_event_id = NULL, changed_at = ? WHERE id = ?').run(new Date(T0).toISOString(), node.id)
    const html = await page(new Browser(env), EXAMPLE_ROOT)
    expect(html).toContain('<span class="who-all"><a href="/@ana">@ana</a> · <a href="/@ana?as=%40ana/claude">@ana/claude</a></span>')
    expect(html).toMatch(/<div class="c ev">✿ <b><a href="\/@ana\?as=%40ana\/claude">@ana\/claude<\/a><\/b> joined · /)
    // filtered to humans, the agent's line is gone
    expect(await body(await new Browser(env).req(`/w/${EXAMPLE_ROOT}?show=humans`, { headers: HTML }))).not.toContain('@ana/claude</a></b> joined')
    // ana's own page still offers her join: her agent joining isn't her joining
    expect(head(await page(b, EXAMPLE_ROOT))).toContain('jn-open')
  })
})
