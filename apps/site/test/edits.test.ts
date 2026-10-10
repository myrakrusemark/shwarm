// Go-live 4.4, the rest, as no lobby left it (decided Oct 9): joining a live shwarm (working on it), and re-pitching a
// shwarm until its first submission (with its history and a new triage round).
// Go-live 4.8: editing any of your own plain posts (with "edited" and its history), deleting one (a tombstone), "make it
// a branch" from a post, and no "claimed by" anywhere a page is drawn.
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { rollupStats } from '../src/jobs/stats'
import { readContributors, readChain, readPitchEdits } from '../src/read/node'
import { readProfile } from '../src/read/profile'
import { EXAMPLE_ROOT } from '../src/seed/example'
import { describeNode, nodeSql } from '../src/triage/decide'
import { CATEGORIES } from '../src/triage/rubric'
import { triageNode } from '../src/triage/run'
import { resetReadLimit } from '../src/web/read-limit'
import { addPerson } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { agent, HOUR, MIN, person, refused, site, stepped, T0, World, type P } from './core-fixtures'
import { PLAIN, stagingWorld } from './node-fixture'

const MID = 'minecraft-in-doom'
const iso = (ms: number) => new Date(ms).toISOString()

/** A Workers AI stand-in that answers Clef's way (as test/triage.test.ts does), or waits for `hold` first. */
function fakeClef() {
  let choice: 'yes' | 'no' | 'unsure' = 'no'
  let hold: Promise<void> | null = null
  const calls: unknown[] = []
  const ai = {
    run: async (_model: string, input: unknown) => {
      calls.push(input)
      if (hold) await hold
      const p = { yes: 0.1, no: 0.1, unsure: 0.1, [choice]: 0.8 }
      const answers: Record<string, unknown> = { hard_block: { type: 'choice', choice, probabilities: p, confidence: 0.8 } }
      for (const c of CATEGORIES) answers[c] = { type: 'noul', noul: c === 'spam' ? 0.9 : 0.05 }
      return { model: 'clef-flash', answers, usage: { input_tokens: 900, output_tokens: 12 } }
    },
  }
  return { ai: ai as unknown as Ai, calls, answer: (c: typeof choice) => void (choice = c), hold: (p: Promise<void> | null) => void (hold = p) }
}

// ---------- core: join ----------

describe('join: working on it (4.4, decided Oct 9)', () => {
  let w: World
  let myra: P, bmo: P, ana: P, finn: P, kes: P

  beforeEach(async () => {
    w = new World()
    myra = await person(w.db, 'myra')
    bmo = await person(w.db, 'bmo_fan')
    ana = await person(w.db, 'ana')
    finn = await person(w.db, 'finn_irl')
    kes = await person(w.db, 'kestrel')
    await w.shwarm(site(myra)) // live at once
    expect(await w.join(site(bmo), MID)).toEqual({ node: MID, joined: true })
  })

  it('join a live shwarm with no limit: no kickoff, no event, no notice', async () => {
    expect(await w.join(site(ana), MID)).toEqual({ node: MID, joined: true })
    expect(await w.join(site(finn), MID)).toEqual({ node: MID, joined: true })
    expect(await w.join(site(kes), MID)).toEqual({ node: MID, joined: true })
    expect(w.all('SELECT number FROM seat WHERE left_at IS NULL ORDER BY number').map(r => r.number)).toEqual([1, 2, 3, 4, 5])
    expect(w.events(MID)).toEqual([])
    expect(w.all("SELECT person_id FROM inbox_item WHERE kind = 'system'")).toEqual([])
    // a double click keeps the one join
    expect(await w.join(site(ana), MID)).toEqual({ node: MID, joined: false })
    // anyone but the author can leave; humans only; branches have none
    expect(await w.run({ type: 'leave', actor: site(ana), input: { node: MID } })).toEqual({ node: MID })
    await refused(w.run({ type: 'leave', actor: site(myra), input: { node: MID } }), 'bad_request')
    await refused(w.join(agent(finn), MID), 'bare_handle_needs_human')
    await w.branch(site(myra), MID)
    await refused(w.join(site(ana), `${MID}/block-placement`), 'bad_request')
  })

  it('a late joiner shows as working on it: among its contributors and on their profile', async () => {
    await w.post(site(bmo), MID, 'renderer first.')
    await w.join(site(ana), MID)
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(MID)
    const chain = (await readChain(w.db, MID, null))!
    const { rows } = await readContributors(w.db, chain.node)
    // posters first (none counted yet: the stats job hasn't run), then the author, then the others in the order they joined
    expect(rows.map(r => r.handle)).toEqual(expect.arrayContaining(['@myra', '@bmo_fan', '@ana']))
    expect(rows.find(r => r.handle === '@ana')).toEqual({ person_id: ana.id, handle: '@ana', posts: 0, upvotes: 0 })
    const profile = await readProfile(w.db, ana.id, { owner: false, now: w.now })
    expect(profile.working.map(r => r.path)).toEqual([MID])
  })

  it("a closed or dead-end shwarm takes no joins", async () => {
    await w.deadEnd(myra, MID)
    await refused(w.join(site(ana), MID), 'shwarm_closed')
  })
})

// ---------- core: re-pitch ----------

describe('re-pitching a shwarm until its first submission (4.4, decided Oct 9)', () => {
  let w: World
  let myra: P, ana: P

  const repitch = (by: Parameters<World['post']>[0], title = 'minecraft in doom, rebuilt', what = 'a real voxel world inside doom, with every asset open.', node = MID) =>
    w.run({ type: 'repitch', actor: by, input: { node, title, what } })

  beforeEach(async () => {
    w = new World()
    myra = await person(w.db, 'myra')
    ana = await person(w.db, 'ana')
    await w.shwarm(site(myra))
  })

  it('the author changes the title and what; the old ones go to the history; the address and done test stay', async () => {
    const before = w.node(MID)
    w.tick(HOUR)
    expect(await repitch(stepped(myra))).toEqual({ node: MID, repitched: true, at: iso(w.now), triage: 'pending' })
    const after = w.node(MID)
    expect(after).toMatchObject({ path: MID, title: 'minecraft in doom, rebuilt', what: 'a real voxel world inside doom, with every asset open.', done_when: before.done_when, checks: before.checks })
    expect(w.all('SELECT by_name, title, what, edited_at FROM node_edit')).toEqual([{ by_name: '@myra', title: before.title, what: before.what, edited_at: iso(w.now) }])
    // the search index follows
    expect(w.all("SELECT rowid FROM node_fts WHERE node_fts MATCH 'rebuilt'")).toEqual([{ rowid: before.id }])
    // the same words again change nothing and spend nothing
    const tokens = w.get('SELECT tokens FROM rate_bucket').tokens
    expect(await repitch(stepped(myra))).toMatchObject({ repitched: false })
    expect(w.all('SELECT 1 FROM node_edit')).toHaveLength(1)
    expect(w.get('SELECT tokens FROM rate_bucket').tokens).toBe(tokens)
  })

  it('only the author, as the bare handle on the site, with the password; only a live shwarm with nothing submitted', async () => {
    await refused(repitch(site(myra)), 'not_permitted', { need: 'step_up' })
    await refused(repitch(stepped(ana)), 'not_permitted', { need: 'author' })
    await refused(repitch(agent(myra)), 'bare_handle_needs_human')
    await refused(repitch(stepped(myra), ' ', 'x'), 'bad_request')
    await refused(repitch(stepped(myra), 'x'.repeat(121), 'x'), 'bad_request')
    expect(w.all('SELECT 1 FROM node_edit')).toEqual([])
    // others joining and branches opening change nothing: it's live from the start
    await w.join(site(ana), MID)
    await w.branch(site(ana), MID)
    expect(await repitch(stepped(myra), 'minecraft in doom, take two')).toMatchObject({ repitched: true })
    // a branch keeps the words it was opened with (OPEN)
    await refused(repitch(stepped(ana), 'x', 'y', `${MID}/block-placement`), 'bad_request')
    // the first submission ends it
    await w.submit(agent(ana), MID)
    const e = await refused(repitch(stepped(myra)), 'bad_request')
    expect(e.message).toBe(`${MID} has a submission. its title and what stay as they are`)
    expect(w.node(MID).title).toBe('minecraft in doom, take two')
    expect(w.all('SELECT 1 FROM node_edit')).toHaveLength(1)
  })

  it('an ended shwarm keeps its words', async () => {
    await w.deadEnd(myra, MID)
    await refused(repitch(stepped(myra)), 'shwarm_closed')
  })

  it('a cleared shwarm goes back to being checked; a held one stays held; a blocked one is refused', async () => {
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(MID)
    const moderated = () => w.get("SELECT value FROM setting WHERE key = 'moderated_at'")?.value ?? null
    const m0 = moderated()
    await repitch(stepped(myra))
    expect(w.node(MID)).toMatchObject({ triage: 'pending', triage_since: iso(w.now) })
    expect(moderated()).not.toBe(m0) // it left the public, so every signed-out ETag moves
    w.db.raw.prepare("UPDATE node SET triage = 'held' WHERE path = ?").run(MID)
    w.tick(MIN)
    expect(await repitch(stepped(myra), 'minecraft in doom, third try')).toMatchObject({ repitched: true, triage: 'held' })
    expect(w.node(MID)).toMatchObject({ triage: 'held', triage_since: iso(w.now - MIN) })
    w.db.raw.prepare("UPDATE node SET triage = 'blocked' WHERE path = ?").run(MID)
    await refused(repitch(stepped(myra), 'minecraft in doom, fourth try'), 'not_permitted', { reason: 'blocked' })
    expect(w.node(MID).title).toBe('minecraft in doom, third try')
  })

  it('the new words get a triage round of their own; an answer about the old words moves nothing', async () => {
    const clef = fakeClef()
    const env = { DB: w.db, AI: clef.ai }
    const id = w.node(MID).id
    expect(await triageNode(env, id, { now: w.now })).toMatchObject({ kind: 'decided', triage: 'clear' })
    w.tick(HOUR)
    await repitch(stepped(myra))
    expect(w.node(MID).triage).toBe('pending')
    // a new round: the model is asked again, about the new words
    clef.answer('unsure')
    expect(await triageNode(env, id, { now: w.now })).toMatchObject({ kind: 'decided', triage: 'held' })
    expect(clef.calls).toHaveLength(2)
    expect(JSON.stringify(clef.calls[1])).toContain('minecraft in doom, rebuilt')
    // a call out when the author re-pitches again: its answer is about words no longer there
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE id = ?").run(id)
    w.tick(HOUR)
    await repitch(stepped(myra), 'minecraft in doom, round three')
    let release!: () => void
    clef.hold(new Promise<void>(r => (release = r)))
    clef.answer('no')
    const call = triageNode(env, id, { now: w.now })
    await vi.waitFor(() => expect(clef.calls).toHaveLength(3))
    w.tick(MIN)
    await repitch(stepped(myra), 'minecraft in doom, round four')
    release()
    expect(await call).toEqual({ kind: 'skipped', why: 'decided meanwhile' })
    expect(w.node(MID).triage).toBe('pending')
    clef.hold(null)
    // the stale answer wasn't kept as this round's, so the next run asks about round four
    expect(await triageNode(env, id, { now: w.now })).toMatchObject({ kind: 'decided', triage: 'clear' })
    expect(JSON.stringify(clef.calls[3])).toContain('round four')
  })

  it("words triage never cleared stay out of the public history: replaced while pending or held, they show to the author alone", async () => {
    const id = w.node(MID).id
    const titles = (all: boolean) => readPitchEdits(w.db, id, all).then(es => es.map(e => [e.title, e.written_at]))
    // still pending (not seeded, so nobody else sees it): re-pitched before triage answered, then the new words clear
    w.tick(MIN)
    await repitch(stepped(myra), 'nice title', 'nice what')
    const t1 = iso(w.now)
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE id = ?").run(id)
    expect(await readChain(w.db, MID, null)).not.toBeNull()
    expect(await titles(false)).toEqual([])
    expect(await titles(true)).toEqual([['minecraft in doom', null]])
    // cleared, then re-pitched: that version was public, so it stays in everyone's history
    w.tick(MIN)
    await repitch(stepped(myra), 'nicer title', 'nicer what')
    const t2 = iso(w.now)
    // held after a complaint, re-pitched while held, then Myra clears the new words: the held words stay the author's
    w.db.raw.prepare("UPDATE node SET triage = 'held' WHERE id = ?").run(id)
    w.tick(MIN)
    await repitch(stepped(myra), 'nicest title', 'nicest what')
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE id = ?").run(id)
    expect(await titles(false)).toEqual([['nice title', t1]]) // written when the first re-pitch replaced the start
    expect(await titles(true)).toEqual([['nicer title', t2], ['nice title', t1], ['minecraft in doom', null]])
    // the hand-decide script shows Myra every earlier version and who sees it
    const shown = describeNode(w.all(nodeSql(MID).replace(/;$/, ''))[0] as any)
    expect(shown).toContain('  earlier pitch 1, newest first (shown to its author only):\n  title:\n    | nicer title\n  what:\n    | nicer what')
    expect(shown).toContain('  earlier pitch 2, newest first (shown to everyone):\n  title:\n    | nice title')
    expect(shown).toContain('  earlier pitch 3, newest first (shown to its author only):\n  title:\n    | minecraft in doom')
  })

  it('a re-pitched node still pending ten minutes into its round is held, not before', async () => {
    const id = w.node(MID).id
    w.tick(HOUR) // long past the first round's ten minutes
    await repitch(stepped(myra))
    const env = { DB: w.db } // no AI binding: every call is an error
    expect(await triageNode(env, id, { now: w.now })).toMatchObject({ kind: 'error', escalated: false })
    expect(await triageNode(env, id, { now: w.now + 10 * MIN })).toMatchObject({ kind: 'error', escalated: true })
    expect(w.node(MID).triage).toBe('held')
  })
})

// ---------- core: delete ----------

describe('deleting a post (4.8)', () => {
  let w: World
  let myra: P, kes: P

  const del = (by: Parameters<World['post']>[0], post: string, node = MID) => w.run({ type: 'deletePost', actor: by, input: { node, post } })

  beforeEach(async () => {
    w = new World()
    myra = await person(w.db, 'myra')
    kes = await person(w.db, 'kestrel')
    await w.shwarm(site(myra))
    await w.join(site(kes), MID)
  })

  it('the poster deletes: a tombstone stays, its text, links, versions and mentions go; again changes nothing', async () => {
    const p = await w.post(site(kes), MID, 'ping @myra: the chunk lookup.', { links: [{ url: 'https://codeberg.org/k/x.diff', sha256: 'ab'.repeat(32) }] })
    await w.run({ type: 'editPost', actor: site(kes), input: { node: MID, post: p.id, text: 'ping @myra: the chunk lookup, not the sight check.' } })
    const reply = await w.post(site(myra), MID, 'thanks', { replyTo: p.id })
    w.tick(HOUR)
    expect(await del(site(kes), p.id)).toEqual({ id: p.id, node: MID, deleted: true, at: iso(w.now) })
    expect(w.get('SELECT text, links, deleted_at, edited_at FROM post WHERE id = ?', p.id)).toEqual({ text: '', links: '[]', deleted_at: iso(w.now), edited_at: iso(w.now - HOUR) })
    expect(w.all('SELECT 1 FROM post_edit WHERE post_id = ?', p.id)).toEqual([])
    expect(w.all('SELECT 1 FROM mention WHERE post_id = ?', p.id)).toEqual([])
    expect(w.get('SELECT reply_to FROM post WHERE id = ?', reply.id)).toEqual({ reply_to: p.id }) // replies stay where they were
    const v = w.node(MID).last_event_id
    expect(await del(site(kes), p.id)).toMatchObject({ deleted: false })
    expect(w.node(MID).last_event_id).toBe(v)
  })

  it('only the poster, under the same name, and only plain posts', async () => {
    const p = await w.post(site(kes), MID)
    await refused(del(site(myra), p.id), 'not_permitted', { need: 'poster' })
    const byAgent = await w.post(agent(kes), MID, 'from m-04')
    await refused(del(site(kes), byAgent.id), 'not_permitted', { need: 'poster' })
    await refused(del(agent(kes), byAgent.id), 'not_permitted', { need: 'delete' }) // a key needs the delete grant
    const sub = await w.submit(site(kes), MID)
    await refused(del(site(kes), sub.id), 'not_permitted', { kind: 'submission' })
    await refused(del(site(kes), 'p_doesnotexist1'), 'bad_request')
    expect(w.all('SELECT 1 FROM post WHERE deleted_at IS NOT NULL')).toEqual([])
  })

  it('a deleted post takes no edit, upvote, reply or built-on; a deleted pinned post is unpinned', async () => {
    const p = await w.post(site(kes), MID, 'a thing to build on.')
    await del(site(kes), p.id)
    await refused(w.run({ type: 'editPost', actor: site(kes), input: { node: MID, post: p.id, text: 'back again' } }), 'bad_request')
    await refused(w.run({ type: 'upvote', actor: site(myra), input: { node: MID, post: p.id } }), 'bad_request')
    await refused(w.post(site(myra), MID, 'replying to nothing', { replyTo: p.id }), 'bad_request')
    await refused(w.submit(site(myra), MID, 'built on it', { builtOn: [p.id] }), 'bad_request')
    const pin = await w.post(site(myra), MID, 'status update: started.', { pin: true })
    await del(site(myra), pin.id)
    expect(w.node(MID).pinned_post_id).toBeNull()
  })

  it("a deleted pinned post's first line leaves the feed's status line at once, not at the next stats run", async () => {
    const id = w.node(MID).id
    const pin = await w.post(site(myra), MID, 'status update: something to take back.', { pin: true })
    await rollupStats(w.db, w.now)
    const line = () => w.get('SELECT status_line FROM node_stats WHERE node_id = ?', id).status_line
    expect(line()).toBe('status update: something to take back.')
    // deleting another post leaves it alone
    const other = await w.post(site(kes), MID, 'just a post.')
    await del(site(kes), other.id)
    expect(line()).toBe('status update: something to take back.')
    await del(site(myra), pin.id)
    expect(line()).toBe('')
    // the next run fills in the fallback
    w.tick(MIN)
    await rollupStats(w.db, w.now)
    expect(line()).not.toContain('take back')
    expect(line()).not.toBe('')
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
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function world() {
    const w = await stagingWorld()
    const env = testEnv(w.db)
    const q = <T = any>(sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).get(...args) as T
    w.db.raw.prepare('UPDATE person SET password_hash = ? WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), w.myraId)
    return { ...w, env, q }
  }

  async function signIn(env: ReturnType<typeof testEnv>, handle: string, o: { make?: boolean; verified?: boolean } = {}) {
    if (o.make !== false) {
      const pid = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
      if (o.verified !== false) env.DB.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(iso(T0), pid)
    }
    const b = new Browser(env)
    expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
    return b
  }

  const page = async (b: Browser, path = `/w/${EXAMPLE_ROOT}`) => body(await b.req(path, { headers: HTML }))
  const postIn = (html: string, id: string) => {
    const i = html.indexOf(`id="${id}"`)
    expect(i, id).toBeGreaterThan(-1)
    const next = html.indexOf('<div class="c', i)
    return html.slice(i, next === -1 ? undefined : next)
  }
  const boxOf = (html: string, heading: string) => {
    const i = html.indexOf(`<h2>${heading} `)
    expect(i, heading).toBeGreaterThan(-1)
    return html.slice(i, html.indexOf('<div class="box', i))
  }
  async function act(b: Browser, fields: Record<string, string>, path = `/w/${EXAMPLE_ROOT}`) {
    const token = formTokenIn(await page(b, path))
    return b.req(path, { form: { form_token: token, ...fields } })
  }

  describe('join (4.4, decided Oct 9)', () => {
    it('a live shwarm offers "join" under its contributors; joining shows you there and on your profile; leave undoes it', async () => {
      const { env, q } = await world()
      const b = await signIn(env, 'ana')
      let box = boxOf(await page(b), 'contributors')
      expect(box).toContain('<input type="hidden" name="do" value="join"/>')
      expect(box).toContain("join to say you're working on this.")
      const res = await act(b, { do: 'join' })
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}`)
      expect(q("SELECT s.number FROM seat s JOIN person p ON p.id = s.person_id WHERE p.handle = 'ana'")).toEqual({ number: 3 })
      box = boxOf(await page(b), 'contributors')
      expect(box).toContain('href="/@ana">@ana</a>')
      expect(box).toContain("you're working on this.")
      expect(box).not.toContain('value="join"')
      // no lobby, no kickoff: joining writes no event
      expect(q("SELECT COUNT(*) AS n FROM audit_event a JOIN node n ON n.id = a.node_id WHERE n.path = ? AND a.event = 'lobby_filled'", EXAMPLE_ROOT)).toEqual({ n: 0 })
      expect(await body(await b.req('/@ana', { headers: HTML }))).toContain('minecraft in doom')
      // leave sits under it, and undoes it
      expect(box).toContain('<input type="hidden" name="do" value="leave"/>')
      expect((await act(b, { do: 'leave' })).status).toBe(303)
      expect(q("SELECT s.left_at IS NOT NULL AS gone FROM seat s JOIN person p ON p.id = s.person_id WHERE p.handle = 'ana'")).toEqual({ gone: 1 })
      expect(boxOf(await page(b), 'contributors')).toContain('value="join"')
    })

    it('signed out, "join" goes to sign-in; unverified, it waits; the author has no leave; a branch and an ended shwarm offer none', async () => {
      const { env } = await world()
      const out = boxOf(await page(new Browser(env)), 'contributors')
      expect(out).toContain(`<a class="btn plain" href="/signin?next=%2Fw%2F${EXAMPLE_ROOT}">join</a>`)
      const quiet = await signIn(env, 'quiet', { verified: false })
      expect(boxOf(await page(quiet), 'contributors')).toContain('verify your email to join.')
      const author = await signIn(env, 'myra', { make: false })
      const mine = boxOf(await page(author, `/w/${PLAIN}`), 'contributors')
      expect(mine).toContain("you're working on this.")
      expect(mine).not.toContain('value="leave"')
      const b = await signIn(env, 'ana')
      expect(boxOf(await page(b, `/w/${PLAIN}`), 'contributors')).toContain('value="join"') // a new launch shwarm is live too
      expect(boxOf(await page(b, `/w/${EXAMPLE_ROOT}/block-placement`), 'on this branch')).not.toContain('join')
      env.DB.raw.prepare("UPDATE node SET state = 'dead_end', dead_end_note = 'x' WHERE path = ?").run(PLAIN)
      expect(boxOf(await page(b, `/w/${PLAIN}`), 'contributors')).not.toContain('join')
    })
  })

  describe('re-pitch (4.4)', () => {
    it('the author re-pitches a live shwarm behind the password; the history shows the old pitch', async () => {
      const { env, q } = await world()
      const before = q<{ title: string; what: string }>('SELECT title, what FROM node WHERE path = ?', PLAIN)
      const b = await signIn(env, 'myra', { make: false })
      let html = await page(b, `/w/${PLAIN}`)
      expect(html).toContain('<summary>re-pitch it</summary>')
      expect(html).toContain('<input type="hidden" name="do" value="repitch"/>')
      expect(html).toContain('you can re-pitch until the first submission.')
      expect(html).toContain('<summary>mark it a dead end</summary>') // both, in the author's own box
      expect(html).toContain(`value="${before.title}"`)
      expect(html).not.toContain('<summary>re-pitched</summary>')
      // signing in opened the 10-minute window; once it's closed, a re-pitch without the password is refused at the
      // form, the new words kept
      vi.setSystemTime(T0 + 11 * MIN)
      let res = await act(b, { do: 'repitch', title: 'a bot that beats freedoom, fast', what: 'new words.' }, `/w/${PLAIN}`)
      expect(res.status).toBe(400)
      html = await body(res)
      expect(html).toMatch(/<details open="">\s*<summary>re-pitch it<\/summary>[\s\S]*enter your password to confirm\./)
      expect(html).toContain('value="a bot that beats freedoom, fast"')
      expect(html).toContain('>new words.</textarea>')
      // an empty what is refused before the password
      res = await act(b, { do: 'repitch', title: 'x', what: ' ' }, `/w/${PLAIN}`)
      expect(await body(res)).toContain('a pitch needs a title and a what.')
      res = await act(b, { do: 'repitch', title: 'a bot that beats freedoom, fast', what: 'new words.', password: GOOD_PASSWORD }, `/w/${PLAIN}`)
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe(`/w/${PLAIN}`)
      expect(q('SELECT title, what, path FROM node WHERE path = ?', PLAIN)).toEqual({ title: 'a bot that beats freedoom, fast', what: 'new words.', path: PLAIN })
      html = await page(b, `/w/${PLAIN}`)
      expect(html).toContain('<summary>re-pitched</summary>')
      expect(html).toMatch(new RegExp(`<span class="note">started <span title="[^"]+">[^<]+</span></span><b>${before.title}</b>`))
      // a launch shwarm stays public while it's checked again (seeded, still pending)
      expect(await body(await new Browser(env).req(`/w/${PLAIN}`, { headers: HTML }))).toContain('a bot that beats freedoom, fast')
    })

    it('words re-pitched before triage cleared them never reach the signed-out page; the author still sees them', async () => {
      const { env, q } = await world()
      // a shwarm by a user (not seeded), still being checked
      env.DB.raw.prepare("UPDATE node SET seeded = 0, triage = 'pending' WHERE path = ?").run(PLAIN)
      const before = q<{ title: string; what: string }>('SELECT title, what FROM node WHERE path = ?', PLAIN)
      const b = await signIn(env, 'myra', { make: false })
      const res = await act(b, { do: 'repitch', title: 'speedrunning freedoom, together', what: 'new words.' }, `/w/${PLAIN}`)
      expect(res.status).toBe(303)
      env.DB.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(PLAIN) // the new words clear
      const out = await body(await new Browser(env).req(`/w/${PLAIN}`, { headers: HTML }))
      expect(out).toContain('speedrunning freedoom, together')
      expect(out).not.toContain('<summary>re-pitched</summary>')
      expect(out).not.toContain(before.title)
      expect(out).not.toContain(before.what.split('\n')[0])
      const mine = await page(b, `/w/${PLAIN}`)
      expect(mine).toContain('<summary>re-pitched</summary>')
      expect(mine).toContain(`<b>${before.title}</b>`)
    })

    it('the first submission takes the re-pitch away; nobody else gets the form, and a forged one is refused', async () => {
      const { env } = await world()
      const author = await signIn(env, 'myra', { make: false })
      expect(await page(author, `/w/${PLAIN}`)).toContain('re-pitch it')
      const b = await signIn(env, 'ana')
      expect(await page(b, `/w/${PLAIN}`)).not.toContain('re-pitch it')
      let res = await act(b, { do: 'repitch', title: 'mine now', what: 'mine.' }, `/w/${PLAIN}`)
      expect(res.status).toBe(400)
      expect(await body(res)).toContain('only the author re-pitches.')
      const sub = { do: 'submit', text: 'a first bot.', links: `https://codeberg.org/ana/bot/raw/branch/main/bot.py ${'4e'.repeat(32)}`, how_to_check: 'run it against freedoom map01.' }
      expect((await act(b, sub, `/w/${PLAIN}`)).status).toBe(303)
      let html = await page(author, `/w/${PLAIN}`)
      expect(html).not.toContain('re-pitch it')
      expect(html).toContain('<summary>mark it a dead end</summary>')
      // a re-pitch sent anyway (a stale page) says why, at the top
      res = await act(author, { do: 'repitch', title: 'too late', what: 'late.', password: GOOD_PASSWORD }, `/w/${PLAIN}`)
      expect(res.status).toBe(400)
      html = await body(res)
      expect(html).toContain(`<p class="err flash" role="alert">${PLAIN} has a submission. its title and what stay as they are.</p>`)
    })
  })

  describe('own posts: edit, delete, make it a branch (4.8)', () => {
    it('any own plain post can be edited; it shows "edited" with the history', async () => {
      const { env, q } = await world()
      const b = await signIn(env, 'ana')
      await act(b, { do: 'post', text: 'the corner bug is in the chunk lookup.' })
      const id = q<{ id: string }>("SELECT id FROM post WHERE text = 'the corner bug is in the chunk lookup.'").id
      let block = postIn(await page(b), id)
      expect(block).toContain('<summary>edit</summary>')
      expect(block).toContain('<summary>delete</summary>')
      vi.setSystemTime(T0 + HOUR)
      const res = await act(b, { do: 'edit', post: id, text: 'the corner bug is in the chunk lookup, not the sight check.' })
      expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}#${id}`)
      block = postIn(await page(b), id)
      expect(block).toContain('the corner bug is in the chunk lookup, not the sight check.')
      expect(block).toContain('<summary>edited</summary>')
      expect(block).toMatch(/<span class="note">posted <span title="[^"]+">1h ago<\/span><\/span><div class="txt"><p>the corner bug is in the chunk lookup\.<\/p><\/div>/)
      // someone else's post offers neither
      const other = q<{ id: string }>("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.as_name = '@finn_irl'", EXAMPLE_ROOT).id
      expect(postIn(await page(b), other)).not.toMatch(/<summary>(edit|delete)<\/summary>/)
    })

    it('delete leaves a tombstone; its replies stay; signed out sees the tombstone too', async () => {
      const { env, q } = await world()
      const b = await signIn(env, 'ana')
      await act(b, { do: 'post', text: 'a post to take back.' })
      const id = q<{ id: string }>("SELECT id FROM post WHERE text = 'a post to take back.'").id
      const m = await signIn(env, 'myra', { make: false })
      await act(m, { do: 'post', text: 'a reply that stays.', reply_to: id })
      const res = await act(b, { do: 'delete', post: id })
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}#${id}`)
      const html = await page(new Browser(env))
      const block = postIn(html, id)
      expect(html).toContain(`<div class="c gone" id="${id}">`)
      expect(block).toContain('this post was deleted.')
      expect(block).not.toContain('a post to take back.')
      expect(html).toContain('a reply that stays.')
      expect(html.indexOf('a reply that stays.')).toBeGreaterThan(html.indexOf(`id="${id}"`))
      // the prompt and the JSON say so too
      const prompt = await (await new Browser(env).req(`/w/${EXAMPLE_ROOT}?format=text`)).text()
      expect(prompt).toMatch(new RegExp(`id=${id} [^\\n]*deleted`))
      expect(prompt).toContain('(deleted by its poster)')
      const json = await (await new Browser(env).req(`/w/${EXAMPLE_ROOT}?format=json`)).json<any>()
      expect(json.posts.find((p: any) => p.id === id)).toMatchObject({ text: '', links: [], deleted: true })
      // a second click lands on the tombstone, and an edit of it is refused under it
      expect((await act(b, { do: 'delete', post: id })).status).toBe(303)
      const edit = await act(b, { do: 'edit', post: id, text: 'back' })
      expect(edit.status).toBe(400)
      expect(postIn(await body(edit), id)).toContain(`${id} was deleted.`)
    })

    it('"make it a branch" opens the branch form filled from the post; only plain posts, only on a live node', async () => {
      const { env, q } = await world()
      const b = await signIn(env, 'ana')
      await act(b, { do: 'post', text: 'monster collision\n\nimps walk through placed blocks: the blockmap is only built at level load.' })
      const id = q<{ id: string }>("SELECT id FROM post WHERE text LIKE 'monster collision%'").id
      const block = postIn(await page(b), id)
      expect(block).toContain(`<a href="/new?parent=${EXAMPLE_ROOT}&from=${id}">make it a branch</a>`) // body() decodes &amp;
      const form = await body(await b.req(`/new?parent=${EXAMPLE_ROOT}&from=${id}`))
      expect(form).toContain('<h1 class="title" id="heading">new branch</h1>')
      expect(form).toContain('value="monster collision"')
      expect(form).toContain('>monster collision\n\nimps walk through placed blocks: the blockmap is only built at level load.</textarea>')
      // anything but a plain post here starts empty
      const sub = q<{ post_id: string }>('SELECT s.post_id FROM submission s JOIN node n ON n.id = s.node_id LIMIT 1')
      for (const from of [sub?.post_id ?? 'p_doesnotexist1', 'nonsense']) {
        const empty = await body(await b.req(`/new?parent=${EXAMPLE_ROOT}&from=${from}`))
        expect(empty).toContain('<h1 class="title" id="heading">new branch</h1>')
        expect(empty).not.toContain('value="monster collision"')
      }
      // a new shwarm takes branches at once; an ended one's posts have no "make it a branch"
      await act(b, { do: 'post', text: 'a first post.' }, `/w/${PLAIN}`)
      const lp = q<{ id: string }>("SELECT id FROM post WHERE text = 'a first post.'").id
      expect(postIn(await page(b, `/w/${PLAIN}`), lp)).toContain('make it a branch')
      env.DB.raw.prepare("UPDATE node SET state = 'dead_end', dead_end_note = 'x' WHERE path = ?").run(PLAIN)
      expect(postIn(await page(b, `/w/${PLAIN}`), lp)).not.toContain('make it a branch')
    })
  })
})

// ---------- no "claimed by" (4.8, open question #19) ----------

describe('no claim state (4.8)', () => {
  it('no page template or mockup says "claimed by"', () => {
    const files = [
      ...['../src/web/', '../src/render/', '../src/email/'].flatMap(d => readdirSync(new URL(d, import.meta.url)).map(f => new URL(d + f, import.meta.url))),
      ...readdirSync(new URL('../../../mockups/', import.meta.url))
        .filter(f => f.endsWith('.html'))
        .map(f => new URL('../../../mockups/' + f, import.meta.url)),
    ]
    expect(files.length).toBeGreaterThan(20)
    const offenders = files.filter(f => /claimed by/i.test(readFileSync(f, 'utf8'))).map(f => f.pathname)
    expect(offenders).toEqual([])
  })
})
