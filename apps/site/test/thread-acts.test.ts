// Go-live 4.6 and 4.7: the author's pinned "status update" post (pin, edit, history, the feed's status line) and upvotes
// on thread posts (the toggle, humans only, never your own or your agents' posts, counted per A6, tallies and impact).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { isEstablished } from '../src/core/context'
import { rollupStats } from '../src/jobs/stats'
import { EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { addPerson } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { agent, DAY, HOUR, person, refused, site, T0, World, type P } from './core-fixtures'
import { stagingWorld } from './node-fixture'

const MID = 'minecraft-in-doom'
const iso = (ms: number) => new Date(ms).toISOString()

// ---------- core ----------

describe('upvotes (4.7): the rules', () => {
  let w: World
  let myra: P, kestrel: P, lumpy: P, newbie: P
  let kPost: string

  const up = (by: Parameters<World['post']>[0], post: string, on = true) => w.run({ type: 'upvote', actor: by, input: { node: MID, post, up: on } })
  const tally = (post: string) => w.get<{ n: number }>('SELECT COUNT(*) AS n FROM upvote WHERE post_id = ? AND counted = 1', post).n
  const established = (p: P) => w.get<{ established_at: string | null }>('SELECT established_at FROM person WHERE id = ?', p.id).established_at

  beforeEach(async () => {
    w = new World()
    myra = await person(w.db, 'myra')
    kestrel = await person(w.db, 'kestrel')
    lumpy = await person(w.db, 'lumpy')
    newbie = await person(w.db, 'newbie', { founding: false })
    await w.shwarm(site(myra))
    await w.join(site(kestrel), MID)
    kPost = (await w.post(site(kestrel), MID)).id
  })

  it('toggles: on, on again changes nothing, off, off again changes nothing', async () => {
    expect(await up(site(myra), kPost)).toEqual({ post: kPost, up: true, counted: true, upvotes: 1 })
    const before = w.node(MID).last_event_id
    expect(await up(site(myra), kPost)).toEqual({ post: kPost, up: true, counted: true, upvotes: 1 })
    expect(w.node(MID).last_event_id).toBe(before) // a double click writes nothing
    expect(await up(site(lumpy), kPost)).toMatchObject({ upvotes: 2 })
    expect(await up(site(myra), kPost, false)).toEqual({ post: kPost, up: false, counted: false, upvotes: 1 })
    expect(await up(site(myra), kPost, false)).toMatchObject({ up: false, upvotes: 1 })
    expect(w.all('SELECT person_id FROM upvote WHERE post_id = ?', kPost)).toEqual([{ person_id: lumpy.id }])
    // up defaults to on; anything but a boolean is refused
    expect(await w.run({ type: 'upvote', actor: site(myra), input: { node: MID, post: kPost } })).toMatchObject({ up: true, upvotes: 2 })
    await refused(w.run({ type: 'upvote', actor: site(myra), input: { node: MID, post: kPost, up: 'no' as any } }), 'bad_request')
  })

  it("refuses your own posts and your agents' posts: own_work", async () => {
    await refused(up(site(kestrel), kPost), 'own_work')
    const mine = await w.post(agent(kestrel, 'swarm/r-03'), MID)
    await refused(up(site(kestrel), mine.id), 'own_work')
    expect(await up(site(myra), mine.id)).toMatchObject({ upvotes: 1 }) // anyone else may
  })

  it('humans only, verified, as the bare handle on the site', async () => {
    await refused(up(agent(myra), kPost), 'bare_handle_needs_human')
    await refused(up({ ...agent(myra), as: '@myra' }, kPost), 'bare_handle_needs_human')
    const unverified = await person(w.db, 'quiet', { verified: false })
    await refused(up(site(unverified), kPost), 'not_permitted', { reason: 'unverified' })
    expect(w.all('SELECT * FROM upvote')).toEqual([])
  })

  it('refuses a post that is hidden, made up, or in another thread', async () => {
    await w.branch(site(myra), MID)
    const there = await w.post(site(kestrel), `${MID}/block-placement`)
    await refused(up(site(myra), there.id), 'bad_request')
    await refused(up(site(myra), 'p_doesnotexist1'), 'bad_request')
    await refused(up(site(myra), 'nonsense'), 'bad_request')
    w.db.raw.prepare('UPDATE post SET hidden = 1 WHERE id = ?').run(kPost)
    await refused(up(site(myra), kPost), 'bad_request')
  })

  it("a new account's upvote is kept but not counted (A6)", async () => {
    expect(await up(site(newbie), kPost)).toEqual({ post: kPost, up: true, counted: false, upvotes: 0 })
    expect(w.get('SELECT counted FROM upvote WHERE post_id = ? AND person_id = ?', kPost, newbie.id)).toEqual({ counted: 0 })
    expect(tally(kPost)).toBe(0)
    // an established account's counts
    await up(site(myra), kPost)
    expect(tally(kPost)).toBe(1)
  })

  it('any upvote gives the poster an upvoted post; a week-old account with one is established', async () => {
    const nPost = (await w.post(site(newbie), MID, 'first post here.')).id
    expect(established(newbie)).toBeNull()
    // an upvote from an account that isn't established counts toward "has an upvoted post" too (A6)
    const other = await person(w.db, 'other', { founding: false })
    await up(site(other), nPost)
    expect(established(newbie)).toBe(iso(T0 + 7 * DAY)) // created at T0: a week from then
    w.tick(DAY)
    expect(await up(site(newbie), kPost)).toMatchObject({ counted: false }) // not yet
    w.tick(6 * DAY)
    await up(site(newbie), kPost, false)
    expect(await up(site(newbie), kPost)).toMatchObject({ counted: true, upvotes: 1 }) // a week old with an upvoted post
    // an account older than a week is established from the upvote on
    const old = await person(w.db, 'old_timer', { founding: false })
    w.db.raw.prepare('UPDATE person SET created_at = ? WHERE id = ?').run(iso(T0 - 30 * DAY), old.id)
    const oPost = (await w.post(site(old), MID, 'been around.')).id
    await up(site(myra), oPost)
    expect(established(old)).toBe(iso(w.now))
    // founding accounts never get a date: they're established already
    await up(site(newbie), (await w.post(site(lumpy), MID, 'hi')).id)
    expect(established(lumpy)).toBeNull()
  })

  it('taking back the only upvote before the week is up takes the date away; after, it stays', async () => {
    const nPost = (await w.post(site(newbie), MID, 'first post here.')).id
    await up(site(myra), nPost)
    await up(site(lumpy), nPost)
    await up(site(myra), nPost, false)
    expect(established(newbie)).toBe(iso(T0 + 7 * DAY)) // one upvote left
    await up(site(lumpy), nPost, false)
    expect(established(newbie)).toBeNull()
    await up(site(myra), nPost)
    w.tick(8 * DAY)
    await up(site(myra), nPost, false)
    expect(established(newbie)).toBe(iso(T0 + 7 * DAY)) // passed: established for good
    const row = w.get('SELECT * FROM person WHERE id = ?', newbie.id)
    expect(isEstablished(row, w.now)).toBe(true)
  })

  it("an upvote racing a take-back in another tree still leaves the poster's date (A6)", async () => {
    await w.shwarm(site(myra), { title: 'tetris in excel' })
    await w.join(site(kestrel), 'tetris-in-excel')
    const a = (await w.post(site(newbie), MID, 'first post here.')).id
    const b = (await w.post(site(newbie), 'tetris-in-excel', 'a second one.')).id
    await up(site(myra), a)
    expect(established(newbie)).toBe(iso(T0 + 7 * DAY))
    // Trees queue apart: @lumpy's upvote on b reads the date, then @myra's take-back on a (the other tree) clears it
    // before @lumpy's batch runs.
    const batch = w.db.batch
    w.db.batch = (async (stmts: D1PreparedStatement[]) => {
      w.db.batch = batch
      await w.engine.exec({ type: 'upvote', actor: site(myra), input: { node: MID, post: a, up: false } })
      return batch(stmts)
    }) as typeof batch
    await w.run({ type: 'upvote', actor: site(lumpy), input: { node: 'tetris-in-excel', post: b } })
    expect(w.all('SELECT post_id FROM upvote')).toEqual([{ post_id: b }])
    expect(established(newbie)).toBe(iso(T0 + 7 * DAY))
  })

  it('tallies and impact roll up with the stats job, from counted upvotes only', async () => {
    await w.post(site(myra), MID, 'a second post.')
    await up(site(myra), kPost)
    await up(site(lumpy), kPost)
    await up(site(newbie), kPost) // kept, not counted
    await rollupStats(w.db, w.now)
    const id = w.node(MID).id
    expect(w.get('SELECT upvotes, posts, impact FROM node_stats WHERE node_id = ?', id)).toEqual({ upvotes: 2, posts: 2, impact: 1 })
    expect(w.get('SELECT upvotes FROM person_node_stats WHERE node_id = ? AND person_id = ?', id, kestrel.id)).toEqual({ upvotes: 2 })
    // taking one back moves the node (changed_at), so the next run rolls it up again
    w.tick(10 * 60_000)
    await up(site(lumpy), kPost, false)
    await rollupStats(w.db, w.now)
    expect(w.get('SELECT upvotes, impact FROM node_stats WHERE node_id = ?', id)).toEqual({ upvotes: 1, impact: 0.5 })
  })
})

describe('the pinned post and edits (4.6): the rules', () => {
  let w: World
  let myra: P, kestrel: P

  const edit = (by: Parameters<World['post']>[0], post: string, text: string, node = MID) => w.run({ type: 'editPost', actor: by, input: { node, post, text } })

  beforeEach(async () => {
    w = new World()
    myra = await person(w.db, 'myra')
    kestrel = await person(w.db, 'kestrel')
    await w.shwarm(site(myra))
    await w.join(site(kestrel), MID)
  })

  it('the author pins a post as the bare handle; a new pin joins the ones there, latest first; a reply is never pinned', async () => {
    const one = await w.post(site(myra), MID, 'status update: just started.', { pin: true })
    expect(w.pins(MID)).toEqual([one.id])
    w.tick(1000)
    const two = await w.post(site(myra), MID, 'status update: renderer closed.', { pin: true })
    expect(w.pins(MID)).toEqual([two.id, one.id]) // decided Oct 14: several pins, nothing unpinned but by hand
    await refused(w.post(site(myra), MID, 'pinned reply?', { pin: true, replyTo: one.id }), 'bad_request')
    await refused(w.post(site(kestrel), MID, 'mine now', { pin: true }), 'not_permitted', { need: 'author' })
    // an agent pins only with the key's pin permission (decided Oct 13; status-vote.test.ts has the rest)
    await refused(w.post(agent(myra), MID, 'from my agent', { pin: true }), 'not_permitted', { need: 'pin' })
    expect(w.pins(MID)).toEqual([two.id, one.id])
  })

  it("pin and unpin a post already in the thread: anyone's post or submission, never a reply (decided Oct 14)", async () => {
    const pin = (by: Parameters<World['post']>[0], post: string, on = true) => w.run<{ pinned: boolean; changed: boolean }>({ type: 'pinPost', actor: by, input: { node: MID, post, pin: on } })
    const theirs = await w.post(site(kestrel), MID, 'the collision fix is in review.')
    w.tick(1000)
    expect(await pin(site(myra), theirs.id)).toMatchObject({ pinned: true, changed: true })
    expect(await pin(site(myra), theirs.id)).toMatchObject({ pinned: true, changed: false }) // a double click
    w.tick(1000)
    const sub = w.oldSubmission(kestrel, MID) // from before Oct 14, when a shwarm took submissions
    await pin(site(myra), sub.id)
    expect(w.pins(MID)).toEqual([sub.id, theirs.id])
    // unpinned, a post goes back to its place; the other pins stay
    expect(await pin(site(myra), theirs.id, false)).toMatchObject({ pinned: false, changed: true })
    expect(w.pins(MID)).toEqual([sub.id])
    expect(await pin(site(myra), theirs.id, false)).toMatchObject({ changed: false })
    const reply = await w.post(site(kestrel), MID, 'a reply', { replyTo: theirs.id })
    await refused(pin(site(myra), reply.id), 'bad_request')
    await refused(pin(site(kestrel), theirs.id), 'not_permitted', { need: 'author' })
    await refused(pin(agent(myra), theirs.id), 'not_permitted', { need: 'pin' })
    await refused(pin(site(myra), 'p_doesnotexist1'), 'bad_request')
    expect(w.pins(MID)).toEqual([sub.id])
  })

  it('the poster edits: the version it replaces goes to the history; the same text again changes nothing', async () => {
    const p = await w.post(site(myra), MID, 'status update: just started.', { pin: true })
    w.tick(HOUR)
    expect(await edit(site(myra), p.id, 'status update: renderer closed.')).toMatchObject({ id: p.id, edited: true, at: iso(w.now) })
    expect(w.get('SELECT text, edited_at FROM post WHERE id = ?', p.id)).toEqual({ text: 'status update: renderer closed.', edited_at: iso(w.now) })
    expect(w.all('SELECT text, links, edited_at FROM post_edit WHERE post_id = ?', p.id)).toEqual([{ text: 'status update: just started.', links: '[]', edited_at: iso(w.now) }])
    const v = w.node(MID).last_event_id
    w.tick(HOUR)
    expect(await edit(site(myra), p.id, 'status update: renderer closed.')).toMatchObject({ edited: false })
    expect(w.node(MID).last_event_id).toBe(v)
    expect(w.all('SELECT 1 FROM post_edit')).toHaveLength(1)
    await refused(edit(site(myra), p.id, '   '), 'bad_request')
  })

  it('only the poster edits, under the same name, and only plain posts', async () => {
    const p = await w.post(site(myra), MID, 'status update: just started.', { pin: true })
    await refused(edit(site(kestrel), p.id, 'mine now'), 'not_permitted', { need: 'poster' })
    const byAgent = await w.post(agent(myra), MID, 'from m-04')
    await refused(edit(site(myra), byAgent.id, 'the human rewrites it'), 'not_permitted', { need: 'poster' })
    await refused(edit(agent(myra), byAgent.id, 'no edit grant'), 'not_permitted', { need: 'edit' })
    const sub = w.oldSubmission(kestrel, MID) // from before Oct 14, when a shwarm took submissions
    await refused(edit(site(kestrel), sub.id, 'changed my mind'), 'not_permitted', { kind: 'submission' })
    await refused(edit(site(myra), 'p_doesnotexist1', 'x'), 'bad_request')
  })

  it("the status line is the pinned post's first line, and follows its edits (table B #40)", async () => {
    const id = w.node(MID).id
    const line = () => w.get<{ status_line: string }>('SELECT status_line FROM node_stats WHERE node_id = ?', id).status_line
    await rollupStats(w.db, w.now)
    expect(line()).toBe('') // on track, with no branches to count
    const p = await w.post(site(myra), MID, 'status update: just started.\n\nmore detail below the first line.', { pin: true })
    w.tick(10 * 60_000)
    await rollupStats(w.db, w.now)
    expect(line()).toBe('status update: just started.')
    w.tick(10 * 60_000)
    await edit(site(myra), p.id, 'status update: renderer closed (61 fps).')
    w.tick(10 * 60_000)
    await rollupStats(w.db, w.now)
    expect(line()).toBe('status update: renderer closed (61 fps).')
    // with several pins, the one pinned last speaks; unpinned, the one before speaks again (decided Oct 14)
    const q = await w.post(site(kestrel), MID, 'demo friday.')
    w.tick(10 * 60_000)
    await w.run({ type: 'pinPost', actor: site(myra), input: { node: MID, post: q.id, pin: true } })
    w.tick(10 * 60_000)
    await rollupStats(w.db, w.now)
    expect(line()).toBe('demo friday.')
    await w.run({ type: 'pinPost', actor: site(myra), input: { node: MID, post: q.id, pin: false } })
    w.tick(10 * 60_000)
    await rollupStats(w.db, w.now)
    expect(line()).toBe('status update: renderer closed (61 fps).')
  })
})

// ---------- on the page ----------

const HTML = { accept: 'text/html' }

describe('on the page', () => {
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
    const q = <T = any>(sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).get(...args) as T
    // @myra, the author of the running example's shwarm, signs in like anyone else
    w.db.raw.prepare('UPDATE person SET password_hash = ? WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), w.myraId)
    const finnPost = q<{ id: string }>("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.as_name = '@finn_irl'", EXAMPLE_ROOT).id
    // the example's pinned posts, the latest pinned first
    const pins = () =>
      (w.db.raw.prepare('SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.pinned_at IS NOT NULL ORDER BY p.pinned_at DESC, p.id DESC').all(EXAMPLE_ROOT) as { id: string }[]).map(r => r.id)
    return { ...w, env, q, finnPost, pins }
  }

  async function signIn(env: ReturnType<typeof testEnv>, handle: string, o: { make?: boolean; founding?: boolean } = {}) {
    if (o.make !== false) {
      const pid = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
      env.DB.raw.prepare('UPDATE person SET email_verified_at = ?, founding = ? WHERE id = ?').run(iso(T0), o.founding === false ? 0 : 1, pid)
    }
    const b = new Browser(env)
    expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
    return b
  }

  const page = async (b: Browser, path = `/w/${EXAMPLE_ROOT}`) => body(await b.req(path, { headers: HTML }))
  /** One post's block on the page: from its id to the next post. */
  const postIn = (html: string, id: string) => {
    const i = html.indexOf(`id="${id}"`)
    expect(i, id).toBeGreaterThan(-1)
    const next = html.indexOf('<div class="c', i)
    return html.slice(i, next === -1 ? undefined : next)
  }
  async function act(b: Browser, fields: Record<string, string>, path = `/w/${EXAMPLE_ROOT}`) {
    const token = formTokenIn(await page(b, path))
    return b.req(path, { form: { form_token: token, ...fields } })
  }

  describe('upvotes (4.7)', () => {
    it('the ▲ toggles from the page and comes back to the post, on the same sort', async () => {
      const { env, finnPost, q } = await world()
      const b = await signIn(env, 'ana')
      let block = postIn(await page(b), finnPost)
      expect(block).toContain('<input type="hidden" name="up" value="1"/>')
      expect(block).toContain('aria-pressed="false"')
      expect(block).toMatch(/>▲ 0<\/button>/)
      const token = formTokenIn(await page(b))
      const res = await b.req(`/w/${EXAMPLE_ROOT}?sort=new`, { form: { form_token: token, do: 'upvote', post: finnPost, up: '1' } })
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}?sort=new#${finnPost}`)
      block = postIn(await page(b), finnPost)
      expect(block).toContain('aria-pressed="true"')
      expect(block).toContain('<input type="hidden" name="up" value="0"/>')
      expect(block).toMatch(/>▲ 1<\/button>/)
      // a double click says the same thing twice: still one upvote
      expect((await act(b, { do: 'upvote', post: finnPost, up: '1' })).status).toBe(303)
      expect(q<{ n: number }>('SELECT COUNT(*) AS n FROM upvote WHERE post_id = ?', finnPost).n).toBe(1)
      // and off again
      expect((await act(b, { do: 'upvote', post: finnPost, up: '0' })).status).toBe(303)
      expect(postIn(await page(b), finnPost)).toMatch(/aria-pressed="false"[^>]*>▲ 0<\/button>/)
    })

    it('your own posts show the count, not a button; a forged upvote on one is refused under it', async () => {
      const { env } = await world()
      const b = await signIn(env, 'ana')
      await act(b, { do: 'post', text: 'my own post' })
      const mine = env.DB.raw.prepare("SELECT id FROM post WHERE text = 'my own post'").get().id
      const block = postIn(await page(b), mine)
      expect(block).toContain('<span class="up">▲ 0</span>')
      expect(block).not.toContain('name="up"')
      const res = await act(b, { do: 'upvote', post: mine, up: '1' })
      expect(res.status).toBe(400)
      expect(postIn(await body(res), mine)).toContain("you can't upvote your own posts or your agents'.")
    })

    it('signed out, the ▲ goes to sign-in and back (4.1)', async () => {
      const { env, finnPost } = await world()
      await signIn(env, 'ana') // makes the account
      const out = new Browser(env)
      expect(postIn(await page(out), finnPost)).toContain(`<a class="up" href="/signin?next=%2Fw%2F${EXAMPLE_ROOT}" title="sign in to upvote">▲ 0</a>`)
      const res = await out.post('/signin', { email: 'ana@example.org', password: GOOD_PASSWORD, next: `/w/${EXAMPLE_ROOT}` })
      expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}`)
      expect(postIn(await page(out), finnPost)).toContain('name="up" value="1"')
      // a signed-out POST goes to sign-in too
      const anon = await new Browser(env).req(`/w/${EXAMPLE_ROOT}`, { form: { do: 'upvote', post: finnPost, up: '1' } })
      expect(anon.headers.get('location')).toBe(`/signin?next=${encodeURIComponent('/w/' + EXAMPLE_ROOT)}`)
    })

    it("a new account's ▲ is pressed but isn't counted yet", async () => {
      const { env, finnPost, q } = await world()
      const b = await signIn(env, 'newbie', { founding: false })
      expect((await act(b, { do: 'upvote', post: finnPost, up: '1' })).status).toBe(303)
      const block = postIn(await page(b), finnPost)
      expect(block).toMatch(/aria-pressed="true" title="your upvote doesn't count: you gave it before your account was a week old and had a post someone upvoted\.">▲ 0<\/button>/)
      expect(q('SELECT counted FROM upvote WHERE post_id = ?', finnPost)).toEqual({ counted: 0 })
    })

    it('an unverified account sees the count only', async () => {
      const { env, finnPost } = await world()
      const pid = await addPerson(env.DB, 'quiet', { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
      expect(pid).toBeGreaterThan(0)
      const b = await signIn(env, 'quiet', { make: false })
      expect(postIn(await page(b), finnPost)).toContain('<span class="up">▲ 0</span>')
    })
  })

  describe('the pinned "status update" post (4.6)', () => {
    it("the author pins a post from the compose box, and the feed card shows its first line", async () => {
      const { env, q, db, pins } = await world()
      const b = await signIn(env, 'myra', { make: false })
      const html = await page(b)
      expect(html).toContain('<input type="checkbox" name="pin" value="1"/> pin this message at the top of the thread</label>')
      const res = await act(b, { do: 'post', text: 'status update: renderer is closed (61 fps). placement is the last real blocker.\n\nmore below.', pin: '1' })
      expect(res.status).toBe(303)
      const pinned = pins()[0]
      expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}#${pinned}`)
      expect(q<{ text: string }>('SELECT text FROM post WHERE id = ?', pinned).text).toMatch(/^status update: renderer/)
      const after = await page(b)
      expect(after.indexOf(`id="${pinned}"`)).toBeLessThan(after.indexOf('where this pitch comes from:')) // leads the thread
      expect(after).toContain(`<div class="c pin" id="${pinned}">`)
      await rollupStats(db, T0 + 60_000)
      const feed = await body(await new Browser(env).req('/', { headers: HTML }))
      expect(feed).toContain('status update: renderer is closed (61 fps). placement is the last real blocker.')
      expect(feed).not.toContain('more below.')
    })

    it('the author edits the pinned post in place; the history lists the old version; the feed follows', async () => {
      const { env, db, pins } = await world()
      const b = await signIn(env, 'myra', { make: false })
      await act(b, { do: 'post', text: 'status update: just started.', pin: '1' })
      const pinned = pins()[0]
      let block = postIn(await page(b), pinned)
      expect(block).toContain('<summary>edit</summary>')
      expect(block).toContain('>status update: just started.</textarea>')
      expect(block).not.toContain('<summary>edit history')
      vi.setSystemTime(T0 + HOUR)
      const res = await act(b, { do: 'edit', post: pinned, text: 'status update: renderer closed.' })
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}#${pinned}`)
      block = postIn(await page(b), pinned)
      expect(block).toContain('pinned · updated <span title=')
      expect(block).toContain('<summary>edit history</summary>')
      expect(block).toMatch(/<li><span class="note">posted <span title="[^"]+">1h ago<\/span><\/span><div class="txt"><p>status update: just started\.<\/p><\/div><\/li>/)
      await rollupStats(db, T0 + HOUR + 60_000)
      expect(await body(await new Browser(env).req('/', { headers: HTML }))).toContain('status update: renderer closed.')
      // an empty edit comes back to the form
      const empty = await act(b, { do: 'edit', post: pinned, text: '  ' })
      expect(empty.status).toBe(400)
      expect(postIn(await body(empty), pinned)).toMatch(/<details class="edit" open="">[\s\S]*write something first\./)
    })

    it('the same text again with the pin ticked is pinned, not taken for a double click; a double click still posts once', async () => {
      const { env, q, pins } = await world()
      const b = await signIn(env, 'myra', { make: false })
      const text = 'status update: placement is the last blocker.'
      await act(b, { do: 'post', text })
      const first = q<{ id: string }>('SELECT id FROM post WHERE text = ?', text).id
      const res = await act(b, { do: 'post', text, pin: '1' })
      const pinned = pins()[0]
      expect(pinned).not.toBe(first)
      expect(q<{ text: string }>('SELECT text FROM post WHERE id = ?', pinned).text).toBe(text)
      expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}#${pinned}`)
      expect((await act(b, { do: 'post', text, pin: '1' })).headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}#${pinned}`)
      expect(q<{ n: number }>('SELECT COUNT(*) AS n FROM post WHERE text = ?', text).n).toBe(2)
    })

    it("nobody else gets the pin box or the edit form; a forged edit is refused", async () => {
      const { env, q, pins } = await world()
      const author = await signIn(env, 'myra', { make: false })
      await act(author, { do: 'post', text: 'status update: just started.', pin: '1' })
      const pinned = pins()[0]
      const b = await signIn(env, 'ana')
      const html = await page(b)
      expect(html).not.toContain('name="pin"')
      expect(postIn(html, pinned)).not.toContain('<summary>edit</summary>')
      const res = await act(b, { do: 'edit', post: pinned, text: 'mine now' })
      expect(res.status).toBe(400)
      expect(postIn(await body(res), pinned)).toContain('only @myra edits this post.')
      expect(q<{ text: string }>('SELECT text FROM post WHERE id = ?', pinned).text).toBe('status update: just started.')
      // a pin sent by someone else is refused at the compose box, with the box's draft kept
      const pin = await act(b, { do: 'post', text: 'pin this', pin: '1' })
      expect(pin.status).toBe(400)
      expect(await body(pin)).toContain('only the author pins a post, as their bare handle.')
    })

    it("the author pins anyone's post from the post itself, above the pins already there, and unpins it (decided Oct 14)", async () => {
      const { env, finnPost, pins } = await world()
      const [sources] = pins() // the launch seed's pinned sources post
      const author = await signIn(env, 'myra', { make: false })
      expect(postIn(await page(author), finnPost)).toMatch(/<input type="hidden" name="do" value="pin"\/><input type="hidden" name="post" value="p_\w+"\/><input type="hidden" name="pin" value="1"\/><button type="submit">pin<\/button>/)
      const res = await act(author, { do: 'pin', post: finnPost, pin: '1' })
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}#${finnPost}`)
      expect(pins()).toEqual([finnPost, sources])
      let html = await page(author)
      expect(html).toContain(`<div class="c pin" id="${finnPost}">`)
      expect(html).toContain(`<div class="c pin" id="${sources}">`)
      expect(html.indexOf(`id="${finnPost}"`)).toBeLessThan(html.indexOf(`id="${sources}"`)) // the latest pinned leads
      expect(postIn(html, finnPost)).toContain('<input type="hidden" name="pin" value="0"/><button type="submit">unpin</button>')
      // a second click changes nothing
      expect((await act(author, { do: 'pin', post: finnPost, pin: '1' })).status).toBe(303)
      expect(pins()).toEqual([finnPost, sources])
      // nobody else gets the control, and a forged one is refused under the post
      const b = await signIn(env, 'ana')
      expect(postIn(await page(b), finnPost)).not.toContain('value="pin"')
      const forged = await act(b, { do: 'pin', post: finnPost, pin: '0' })
      expect(forged.status).toBe(400)
      expect(postIn(await body(forged), finnPost)).toContain('only the author pins a post, as their bare handle.')
      // unpinned, it goes back to its place; the other pin stays
      expect((await act(author, { do: 'pin', post: finnPost, pin: '0' })).status).toBe(303)
      expect(pins()).toEqual([sources])
      html = await page(author)
      expect(html).toContain(`<div class="c" id="${finnPost}">`)
    })
  })
})
