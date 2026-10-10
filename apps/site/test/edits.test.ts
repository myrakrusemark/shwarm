// Go-live 4.4, the rest, as no lobby left it (decided Oct 9): joining a live shwarm (working on it). Editing a shwarm
// until someone else joins or anything is submitted (decided Oct 10, '"edit" replaces re-pitch'), with its history and
// a new triage round, from the "edit" link on its page through the /new form.
// Go-live 4.8: editing any of your own plain posts (with "edited" and its history), deleting one (a tombstone), "make it
// a branch" from a post, and no "claimed by" anywhere a page is drawn.
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { rollupStats } from '../src/jobs/stats'
import { readContributors, readChain, readNodeEdits } from '../src/read/node'
import type { EditNodeInput } from '../src/core/nodes'
import { readProfile } from '../src/read/profile'
import { EXAMPLE_ROOT } from '../src/seed/example'
import { describeNode, nodeSql } from '../src/triage/decide'
import { CATEGORIES } from '../src/triage/rubric'
import { triageNode } from '../src/triage/run'
import { resetReadLimit } from '../src/web/read-limit'
import { addPerson } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, repeatedIds, testEnv } from './browser'
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
    expect(rows.find(r => r.handle === '@ana')).toEqual({ person_id: ana.id, handle: '@ana', posts: 0, upvotes: 0, dms: false })
    const profile = await readProfile(w.db, ana.id, { owner: false, now: w.now })
    expect(profile.working.map(r => r.path)).toEqual([MID])
  })

  it("a closed or dead-end shwarm takes no joins", async () => {
    await w.deadEnd(myra, MID)
    await refused(w.join(site(ana), MID), 'shwarm_closed')
  })
})

// ---------- core: edit (decided Oct 10, '"edit" replaces re-pitch') ----------

describe('editing a shwarm until someone else joins or anything is submitted (decided Oct 10)', () => {
  let w: World
  let myra: P, ana: P

  /** The shwarm as it stands, as editNode takes it, so each test changes only what it names. */
  const current = (node = MID): Omit<EditNodeInput, 'node'> => {
    const n = w.node(node)
    const bo = n.builds_on ? JSON.parse(n.builds_on) : null
    return {
      title: n.title,
      what: n.what,
      doneWhen: n.done_when,
      check: JSON.parse(n.checks),
      tags: w.all('SELECT tag FROM node_tag WHERE node_id = ? ORDER BY rowid', n.id).map(r => r.tag),
      license: n.license,
      buildsOn: bo ? (bo.node ?? bo) : null,
    }
  }
  const edit = (by: Parameters<World['post']>[0], o: Partial<EditNodeInput> = {}, node = MID) =>
    w.run({ type: 'editNode', actor: by, input: { node, ...current(node), ...o } })
  const NEW = { title: 'minecraft in doom, rebuilt', what: 'a real voxel world inside doom, with every asset open.' }

  beforeEach(async () => {
    w = new World()
    myra = await person(w.db, 'myra')
    ana = await person(w.db, 'ana')
    await w.shwarm(site(myra))
  })

  it('the author changes everything the form holds; the old version goes to the history; the address stays', async () => {
    const before = w.node(MID)
    w.tick(HOUR)
    const changed = {
      ...NEW,
      doneWhen: 'e1m1 to e1m9 rebuilt from blocks, finished from a pistol start on skill 3.',
      check: { runs: { command: './bench.sh', count: 3 }, author: true },
      tags: ['games', 'voxels'],
      license: 'GPL-3.0',
    }
    expect(await edit(stepped(myra), changed)).toEqual({ node: MID, edited: true, at: iso(w.now), triage: 'pending' })
    expect(w.node(MID)).toMatchObject({
      path: MID,
      title: NEW.title,
      what: NEW.what,
      done_when: changed.doneWhen,
      checks: JSON.stringify({ author: true, runs: { command: './bench.sh', count: 3 } }),
      license: 'GPL-3.0',
      builds_on: null,
      changed_at: iso(w.now), // the stats job reads changed nodes
    })
    expect(current().tags).toEqual(['games', 'voxels'])
    expect(w.all('SELECT by_name, title, what, done_when, checks, license, builds_on, tags, edited_at FROM node_edit')).toEqual([
      { by_name: '@myra', title: before.title, what: before.what, done_when: before.done_when, checks: before.checks, license: before.license, builds_on: null, tags: '["games","gzdoom"]', edited_at: iso(w.now) },
    ])
    // the search index follows, done test too
    expect(w.all("SELECT rowid FROM node_fts WHERE node_fts MATCH 'rebuilt'")).toEqual([{ rowid: before.id }])
    expect(w.all("SELECT rowid FROM node_fts WHERE node_fts MATCH 'pistol'")).toEqual([{ rowid: before.id }])
    // the same words again change nothing and spend nothing
    const tokens = w.get('SELECT tokens FROM rate_bucket').tokens
    expect(await edit(stepped(myra))).toMatchObject({ edited: false })
    expect(w.all('SELECT 1 FROM node_edit')).toHaveLength(1)
    expect(w.get('SELECT tokens FROM rate_bucket').tokens).toBe(tokens)
    // the done test alone is an edit too
    expect(await edit(stepped(myra), { doneWhen: 'e1m1 rebuilt from blocks.' })).toMatchObject({ edited: true })
    expect(w.all('SELECT 1 FROM node_edit')).toHaveLength(2)
  })

  it('only the author, as the bare handle on the site, with the password; each field checked as a create checks it', async () => {
    await refused(edit(site(myra), NEW), 'not_permitted', { need: 'step_up' })
    await refused(edit(stepped(ana), NEW), 'not_permitted', { need: 'author' })
    await refused(edit(agent(myra), NEW), 'bare_handle_needs_human')
    await refused(edit(stepped(myra), { title: ' ' }), 'bad_request')
    await refused(edit(stepped(myra), { title: 'x'.repeat(121) }), 'bad_request')
    await refused(edit(stepped(myra), { doneWhen: ' ' }), 'no_done_test')
    await refused(edit(stepped(myra), { check: { author: false } }), 'no_done_test')
    await refused(edit(stepped(myra), { tags: [] }), 'bad_request')
    await refused(edit(stepped(myra), { license: 'WTFPL' }), 'bad_license')
    expect(w.all('SELECT 1 FROM node_edit')).toEqual([])
  })

  it("the author's own seat doesn't lock it; another person's first join does, for good, even after they leave", async () => {
    expect(w.all('SELECT person_id FROM seat')).toEqual([{ person_id: myra.id }]) // the author is down as working on it
    // branches opening change nothing: only a join or a submission locks it
    await w.branch(site(ana), MID)
    expect(await edit(stepped(myra), { title: 'minecraft in doom, take two' })).toMatchObject({ edited: true })
    await w.join(site(ana), MID)
    const e = await refused(edit(stepped(myra), NEW), 'bad_request', { reason: 'joined' })
    expect(e.message).toBe(`someone else joined ${MID}. its words stay as they are`)
    await w.run({ type: 'leave', actor: site(ana), input: { node: MID } })
    await refused(edit(stepped(myra), NEW), 'bad_request', { reason: 'joined' })
    expect(w.node(MID).title).toBe('minecraft in doom, take two')
    expect(w.all('SELECT 1 FROM node_edit')).toHaveLength(1)
  })

  it('anything submitted locks it, by anyone', async () => {
    await w.submit(agent(ana), MID) // ana never joined
    const e = await refused(edit(stepped(myra), NEW), 'bad_request', { reason: 'submitted' })
    expect(e.message).toBe(`${MID} has a submission. its words stay as they are`)
  })

  it("a submission to any of its branches locks it too; opening a branch doesn't", async () => {
    await w.branch(site(ana), MID)
    expect(await edit(stepped(myra), { title: 'minecraft in doom, take two' })).toMatchObject({ edited: true })
    await w.submit(agent(ana), `${MID}/block-placement`)
    const e = await refused(edit(stepped(myra), NEW), 'bad_request', { reason: 'submitted' })
    expect(e.message).toBe(`${MID} has a submission. its words stay as they are`)
  })

  it("an ended branch keeps the license it ended under; a shwarm can't build on its own branch", async () => {
    await w.branch(site(myra), MID)
    await w.deadEnd(myra, `${MID}/block-placement`)
    expect(await edit(stepped(myra), { license: 'GPL-3.0' })).toMatchObject({ edited: true })
    expect(w.node(MID).license).toBe('GPL-3.0')
    expect(w.node(`${MID}/block-placement`).license).not.toBe('GPL-3.0')
    await refused(edit(stepped(myra), { buildsOn: `${MID}/block-placement` }), 'bad_request')
    expect(w.node(`${MID}/block-placement`).builds_on).toBeNull()
  })

  it('line breaks sent as \\r\\n are the same words: no edit', async () => {
    const check = { author: true, people: { count: 1, instructions: 'load it.\nplay e1m1.' } }
    expect(await edit(stepped(myra), { what: 'line one.\n\nline two.', check })).toMatchObject({ edited: true })
    const crlf = { what: 'line one.\r\n\r\nline two.', check: { ...check, people: { ...check.people, instructions: 'load it.\r\nplay e1m1.' } } }
    expect(await edit(stepped(myra), crlf)).toMatchObject({ edited: false })
    expect(await edit(stepped(myra), { ...crlf, title: 'minecraft in doom, take two' })).toMatchObject({ edited: true })
    expect(w.node(MID).what).toBe('line one.\n\nline two.')
  })

  it('a branch keeps the words it was opened with', async () => {
    await w.branch(site(myra), MID)
    const e = await refused(edit(stepped(myra), { title: 'x', what: 'y' }, `${MID}/block-placement`), 'bad_request')
    expect(e.message).toBe('a branch keeps the words it was opened with')
  })

  it('an ended shwarm keeps its words; a blocked one is refused', async () => {
    w.db.raw.prepare("UPDATE node SET triage = 'blocked' WHERE path = ?").run(MID)
    await refused(edit(stepped(myra), NEW), 'not_permitted', { reason: 'blocked' })
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(MID)
    await w.deadEnd(myra, MID)
    await refused(edit(stepped(myra), NEW), 'shwarm_closed')
  })

  it('builds on as a create takes it: an ended shwarm brings its license, to the branches too; a live one is refused', async () => {
    await w.shwarm(site(ana), { title: 'doom speedruns', license: 'GPL-3.0' })
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = 'doom-speedruns'").run() // so myra sees it
    const live = await refused(edit(stepped(myra), { buildsOn: 'doom-speedruns' }), 'bad_request')
    expect(live.message).toBe('doom-speedruns is still live. a shwarm is built on once it passed or is a dead end')
    await refused(edit(stepped(myra), { buildsOn: 'no-such-shwarm' }), 'bad_request')
    await w.deadEnd(ana, 'doom-speedruns')
    await w.branch(site(myra), MID)
    // the upstream license wins over any sent
    expect(await edit(stepped(myra), { buildsOn: 'doom-speedruns', license: 'MIT' })).toMatchObject({ edited: true })
    expect(w.node(MID)).toMatchObject({ license: 'GPL-3.0', builds_on: '{"node":"doom-speedruns"}' })
    expect(w.node(`${MID}/block-placement`)).toMatchObject({ license: 'GPL-3.0', builds_on: '{"node":"doom-speedruns"}' })
    // an outside project needs its license
    await refused(edit(stepped(myra), { buildsOn: { name: 'freedoom' } as any }), 'bad_license')
    await edit(stepped(myra), { buildsOn: { name: 'freedoom', url: 'https://freedoom.github.io/', license: 'BSD-3-Clause' } })
    expect(w.node(MID).license).toBe('BSD-3-Clause')
    // and builds on nothing again: the license picked
    await edit(stepped(myra), { buildsOn: null, license: 'Apache-2.0' })
    expect(w.node(MID)).toMatchObject({ license: 'Apache-2.0', builds_on: null })
    expect(w.node(`${MID}/block-placement`)).toMatchObject({ license: 'Apache-2.0', builds_on: null })
  })

  it('a cleared shwarm goes back to being checked; a held one stays held', async () => {
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(MID)
    const moderated = () => w.get("SELECT value FROM setting WHERE key = 'moderated_at'")?.value ?? null
    const m0 = moderated()
    await edit(stepped(myra), NEW)
    expect(w.node(MID)).toMatchObject({ triage: 'pending', triage_since: iso(w.now) })
    expect(moderated()).not.toBe(m0) // it left the public, so every signed-out ETag moves
    w.db.raw.prepare("UPDATE node SET triage = 'held' WHERE path = ?").run(MID)
    w.tick(MIN)
    expect(await edit(stepped(myra), { title: 'minecraft in doom, third try' })).toMatchObject({ edited: true, triage: 'held' })
    expect(w.node(MID)).toMatchObject({ triage: 'held', triage_since: iso(w.now - MIN) })
  })

  it('the new words get a triage round of their own; an answer about the old words moves nothing', async () => {
    const clef = fakeClef()
    const env = { DB: w.db, AI: clef.ai }
    const id = w.node(MID).id
    expect(await triageNode(env, id, { now: w.now })).toMatchObject({ kind: 'decided', triage: 'clear' })
    w.tick(HOUR)
    await edit(stepped(myra), { ...NEW, doneWhen: 'a new done test, read again.' })
    expect(w.node(MID).triage).toBe('pending')
    // a new round: the model is asked again, about the new words
    clef.answer('unsure')
    expect(await triageNode(env, id, { now: w.now })).toMatchObject({ kind: 'decided', triage: 'held' })
    expect(clef.calls).toHaveLength(2)
    expect(JSON.stringify(clef.calls[1])).toContain('minecraft in doom, rebuilt')
    expect(JSON.stringify(clef.calls[1])).toContain('a new done test, read again.')
    // a call out when the author edits again: its answer is about words no longer there
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE id = ?").run(id)
    w.tick(HOUR)
    await edit(stepped(myra), { title: 'minecraft in doom, round three' })
    let release!: () => void
    clef.hold(new Promise<void>(r => (release = r)))
    clef.answer('no')
    const call = triageNode(env, id, { now: w.now })
    await vi.waitFor(() => expect(clef.calls).toHaveLength(3))
    w.tick(MIN)
    await edit(stepped(myra), { title: 'minecraft in doom, round four' })
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
    const titles = (all: boolean) => readNodeEdits(w.db, id, all).then(es => es.map(e => [e.title, e.written_at]))
    // still pending (not seeded, so nobody else sees it): edited before triage answered, then the new words clear
    w.tick(MIN)
    await edit(stepped(myra), { title: 'nice title', what: 'nice what' })
    const t1 = iso(w.now)
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE id = ?").run(id)
    expect(await readChain(w.db, MID, null)).not.toBeNull()
    expect(await titles(false)).toEqual([])
    expect(await titles(true)).toEqual([['minecraft in doom', null]])
    // cleared, then edited: that version was public, so it stays in everyone's history
    w.tick(MIN)
    await edit(stepped(myra), { title: 'nicer title', what: 'nicer what' })
    const t2 = iso(w.now)
    // held after a complaint, edited while held, then Myra clears the new words: the held words stay the author's
    w.db.raw.prepare("UPDATE node SET triage = 'held' WHERE id = ?").run(id)
    w.tick(MIN)
    await edit(stepped(myra), { title: 'nicest title', what: 'nicest what', doneWhen: 'a nicer done test.' })
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE id = ?").run(id)
    expect(await titles(false)).toEqual([['nice title', t1]]) // written when the first edit replaced the start
    expect(await titles(true)).toEqual([['nicer title', t2], ['nice title', t1], ['minecraft in doom', null]])
    // each version shows only what the edit after it changed: the last one changed the done test
    const all = await readNodeEdits(w.db, id, true)
    expect(all[0].done_when).toBe(w.all('SELECT done_when FROM node_edit ORDER BY id')[0].done_when)
    expect(all.slice(1).map(e => e.done_when)).toEqual([undefined, undefined])
    expect(all.map(e => e.spec ?? e.license ?? e.tags ?? e.builds_on)).toEqual([undefined, undefined, undefined])
    // everyone else compares the version they see with the next one they see (the node now): its done test differed
    expect((await readNodeEdits(w.db, id, false))[0].done_when).toBe(all[0].done_when)
    // the hand-decide script shows Myra every earlier version and who sees it
    const shown = describeNode(w.all(nodeSql(MID).replace(/;$/, ''))[0] as any)
    expect(shown).toContain('  earlier version 1, newest first (shown to its author only):\n  title:\n    | nicer title\n  what:\n    | nicer what\n  done when:')
    expect(shown).toContain('  earlier version 2, newest first (shown to everyone):\n  title:\n    | nice title')
    expect(shown).toContain('  earlier version 3, newest first (shown to its author only):\n  title:\n    | minecraft in doom')
  })

  it("a re-pitch's rows from before Oct 10 show their title and what, and nothing else as changed", async () => {
    const id = w.node(MID).id
    w.db.raw.prepare("INSERT INTO node_edit (node_id, by_name, title, what, edited_at, was_public) VALUES (?, '@myra', 'the first title', 'the first what', ?, 1)").run(id, iso(w.now))
    w.tick(MIN)
    await edit(stepped(myra), { doneWhen: 'a changed done test.', tags: ['games'] })
    const es = await readNodeEdits(w.db, id, true)
    expect(es.map(e => e.title)).toEqual(['minecraft in doom', 'the first title'])
    expect(es[0]).toMatchObject({ tags: ['games', 'gzdoom'] })
    expect(es[0].done_when).toContain('uzdoom mod')
    expect(es[1]).toEqual({ title: 'the first title', what: 'the first what', by_name: '@myra', edited_at: iso(w.now - MIN), written_at: null })
  })

  it('an edited node still pending ten minutes into its round is held, not before', async () => {
    const id = w.node(MID).id
    w.tick(HOUR) // long past the first round's ten minutes
    await edit(stepped(myra), NEW)
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

  describe('edit (decided Oct 10)', () => {
    const unescape = (v: string) => v.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    const attr = (tag: string, name: string) => {
      const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
      return m ? unescape(m[1]) : null
    }
    /** The fields a browser would send from the page's form.new, as it was filled in. */
    function formValues(raw: string): Record<string, string> {
      const at = raw.indexOf('<form method="post" action="/new"')
      expect(at, 'the /new form').toBeGreaterThan(-1)
      const form = raw.slice(at, raw.indexOf('</form>', at))
      const out: Record<string, string> = {}
      for (const [tag] of form.matchAll(/<input[^>]*>/g)) {
        const name = attr(tag, 'name')
        if (!name || attr(tag, 'type') === 'password') continue
        if (attr(tag, 'type') === 'checkbox') {
          if (/\schecked(=""|\s|\/?>)/.test(tag)) out[name] = 'on'
        } else out[name] = attr(tag, 'value') ?? ''
      }
      for (const [, at, text] of form.matchAll(/<textarea([^>]*)>([\s\S]*?)<\/textarea>/g)) out[attr(at, 'name')!] = unescape(text)
      for (const [, at, opts] of form.matchAll(/<select([^>]*)>([\s\S]*?)<\/select>/g)) {
        const name = attr(at, 'name')
        const sel = /<option[^>]*value="([^"]*)"[^>]*selected/.exec(opts)
        if (name && sel) out[name] = unescape(sel[1])
      }
      return out
    }
    const editPage = async (b: Browser, path = PLAIN) => b.req(`/new?edit=${encodeURIComponent(path)}`, { headers: HTML })
    const save = async (b: Browser, change: Record<string, string>, path = PLAIN) => {
      const fields = formValues(await (await editPage(b, path)).text())
      return b.req('/new', { form: { ...fields, ...change } })
    }

    it('the author sees "edit" on the shwarm; it opens the form filled in; saving changes all of it behind the password', async () => {
      const { env, q } = await world()
      const before = q<{ id: number; title: string; what: string; done_when: string; checks: string; license: string }>('SELECT id, title, what, done_when, checks, license FROM node WHERE path = ?', PLAIN)
      const b = await signIn(env, 'myra', { make: false })
      let html = await page(b, `/w/${PLAIN}`)
      expect(html).toContain(`<a class="edit-it" href="/new?edit=${PLAIN}">edit</a>`)
      expect(html).not.toContain('re-pitch')
      expect(html).toContain('<summary>mark it a dead end</summary>') // the author's own box keeps the dead end
      expect(html).not.toContain('<summary>edited</summary>')
      // the form, filled in as it stands
      let res = await editPage(b)
      expect(res.status).toBe(200)
      html = await body(res)
      expect(html).toContain('<h1 class="title" id="heading">edit shwarm</h1>')
      expect(html).toContain(`<input type="hidden" name="edit" value="${PLAIN}"/>`)
      expect(html).toContain(`value="${before.title}"`)
      expect(html).toContain(`>${before.done_when}</textarea>`)
      expect(html).toContain('<button class="btn" type="submit" id="go">save changes</button>')
      expect(html).toContain('confirms with your password.')
      expect(html).not.toContain('id="e-pw"') // signing in opened the 10-minute window
      expect(repeatedIds(html)).toEqual([])
      // saved untouched: nothing changes, and builds on keeps its stored name (no new github lookup renames it)
      res = await save(b, {})
      expect(res.status).toBe(303)
      expect(q('SELECT COUNT(*) AS n FROM node_edit WHERE node_id = ?', before.id)).toEqual({ n: 0 })
      // nor when the browser sends a textarea's line breaks as \r\n
      expect(before.what).toContain('\n')
      const crlf = Object.fromEntries(Object.entries(formValues(await (await editPage(b)).text())).map(([k, v]) => [k, v.replace(/\n/g, '\r\n')]))
      expect((await b.req('/new', { form: crlf })).status).toBe(303)
      expect(q('SELECT COUNT(*) AS n FROM node_edit WHERE node_id = ?', before.id)).toEqual({ n: 0 })
      // once the window is closed, a save without the password is refused at the form, the new words kept
      vi.setSystemTime(T0 + 11 * MIN)
      expect(await body(await editPage(b))).toContain('<label class="pw" for="e-pw">password <input id="e-pw"')
      res = await save(b, { title: 'a bot that beats freedoom, fast', done_when: 'it finishes map01 in under a minute.' })
      expect(res.status).toBe(400)
      html = await body(res)
      expect(html).toContain('<p class="err top" role="alert">enter your password to confirm.</p>')
      expect(html).toContain('value="a bot that beats freedoom, fast"')
      expect(html).toContain('>it finishes map01 in under a minute.</textarea>')
      // it builds on vizdoom (MIT, from github); dropping that, the license picked is the one it takes
      expect(html).toContain('value="https://github.com/Farama-Foundation/ViZDoom"')
      const nothing = { builds_on: '', builds_on_name: '', builds_on_license: '' }
      res = await save(b, { title: 'a bot that beats freedoom, fast', done_when: 'it finishes map01 in under a minute.', ...nothing, license: 'GPL-3.0', password: GOOD_PASSWORD })
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe(`/w/${PLAIN}`)
      expect(q('SELECT path, title, what, done_when, checks, license, builds_on FROM node WHERE path = ?', PLAIN)).toEqual({
        path: PLAIN,
        title: 'a bot that beats freedoom, fast',
        what: before.what,
        done_when: 'it finishes map01 in under a minute.',
        checks: before.checks, // the run command's description, which the form doesn't show, is kept
        license: 'GPL-3.0',
        builds_on: null,
      })
      // the history shows the version it replaced, done test and license too
      html = await page(b, `/w/${PLAIN}`)
      expect(html).toContain('<summary>edited</summary>')
      expect(html).toMatch(new RegExp(`<span class="note">started <span title="[^"]+">[^<]+</span></span><b>${before.title}</b>`))
      const hist = html.slice(html.indexOf('<summary>edited</summary>'), html.indexOf('</details>', html.indexOf('<summary>edited</summary>')))
      expect(hist).toContain('<h3>done when</h3>')
      expect(hist).toContain('<div class="note">builds on ViZDoom</div>')
      expect(hist).toContain('<div class="note">license MIT</div>')
      expect(hist).not.toContain('<h3>checked by</h3>') // the checks didn't change
      // the same words again: back to the page, nothing new in the history
      res = await save(b, {})
      expect(res.status).toBe(303)
      expect(q('SELECT COUNT(*) AS n FROM node_edit WHERE node_id = ?', before.id)).toEqual({ n: 1 })
      // a launch shwarm stays public while it's checked again (seeded, still pending)
      expect(await body(await new Browser(env).req(`/w/${PLAIN}`, { headers: HTML }))).toContain('a bot that beats freedoom, fast')
    })

    it('words edited before triage cleared them never reach the signed-out page; the author still sees them', async () => {
      const { env, q } = await world()
      // a shwarm by a user (not seeded), still being checked
      env.DB.raw.prepare("UPDATE node SET seeded = 0, triage = 'pending' WHERE path = ?").run(PLAIN)
      const before = q<{ title: string; what: string }>('SELECT title, what FROM node WHERE path = ?', PLAIN)
      const b = await signIn(env, 'myra', { make: false })
      const res = await save(b, { title: 'speedrunning freedoom, together', what: 'new words.' })
      expect(res.status).toBe(303)
      env.DB.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(PLAIN) // the new words clear
      const out = await body(await new Browser(env).req(`/w/${PLAIN}`, { headers: HTML }))
      expect(out).toContain('speedrunning freedoom, together')
      expect(out).not.toContain('<summary>edited</summary>')
      expect(out).not.toContain(before.title)
      expect(out).not.toContain(before.what.split('\n')[0])
      const mine = await page(b, `/w/${PLAIN}`)
      expect(mine).toContain('<summary>edited</summary>')
      expect(mine).toContain(`<b>${before.title}</b>`)
    })

    it("only its author: nobody else gets the link, and the form refuses them", async () => {
      const { env, q } = await world()
      const b = await signIn(env, 'ana')
      expect(await page(b, `/w/${PLAIN}`)).not.toContain('href="/new?edit=')
      const res = await editPage(b)
      expect(res.status).toBe(403)
      const html = await body(res)
      expect(html).toContain('<p class="err top" role="alert">only its author edits a shwarm.</p>')
      expect(html).not.toContain('<form method="post" action="/new"')
      // a forged save is refused the same way, and changes nothing
      const author = await signIn(env, 'myra', { make: false })
      const fields = formValues(await (await editPage(author)).text())
      const forged = await b.req('/new', { form: { ...fields, form_token: formTokenIn(await page(b, `/w/${PLAIN}`)), title: 'mine now' } })
      expect(forged.status).toBe(403)
      expect(q('SELECT title FROM node WHERE path = ?', PLAIN)).not.toEqual({ title: 'mine now' })
      // signed out, it goes to sign in
      expect((await new Browser(env).req(`/new?edit=${PLAIN}`)).headers.get('location')).toBe(`/signin?next=${encodeURIComponent(`/new?edit=${PLAIN}`)}`)
      expect((await editPage(b, 'no-such-shwarm')).status).toBe(404)
    })

    it("another person's join locks it for good, even after they leave; the dead end stays in the author's box", async () => {
      const { env } = await world()
      const author = await signIn(env, 'myra', { make: false })
      const stale = formValues(await (await editPage(author)).text())
      const b = await signIn(env, 'ana')
      expect((await act(b, { do: 'join' }, `/w/${PLAIN}`)).status).toBe(303)
      expect((await act(b, { do: 'leave' }, `/w/${PLAIN}`)).status).toBe(303)
      const html = await page(author, `/w/${PLAIN}`)
      expect(html).not.toContain('href="/new?edit=')
      expect(html).toContain('<summary>mark it a dead end</summary>')
      // the form says why, in place of the form
      const form = await body(await editPage(author))
      expect(form).toContain(`<p class="err top" role="alert">someone else joined ${PLAIN}. its words stay as they are.</p>`)
      expect(form).not.toContain('<form method="post" action="/new"')
      // a save from a page opened before the join is refused the same way
      const res = await author.req('/new', { form: { ...stale, title: 'too late', password: GOOD_PASSWORD } })
      expect(res.status).toBe(400)
      expect(await body(res)).toContain(`someone else joined ${PLAIN}. its words stay as they are.`)
      // a re-pitch form from an old tab goes to the edit form, which says why
      const old = await act(author, { do: 'repitch', title: 'too late', what: 'new words.' }, `/w/${PLAIN}`)
      expect(old.status).toBe(303)
      expect(old.headers.get('location')).toBe(`/new?edit=${PLAIN}`)
    })

    it('a submission locks it; a branch has no edit', async () => {
      const { env } = await world()
      const author = await signIn(env, 'myra', { make: false })
      const b = await signIn(env, 'ana')
      const sub = { do: 'submit', text: 'a first bot.', links: `https://codeberg.org/ana/bot/raw/branch/main/bot.py ${'4e'.repeat(32)}`, how_to_check: 'run it against freedoom map01.' }
      expect((await act(b, sub, `/w/${PLAIN}`)).status).toBe(303)
      expect(await page(author, `/w/${PLAIN}`)).not.toContain('href="/new?edit=')
      expect(await body(await editPage(author))).toContain(`${PLAIN} has a submission. its words stay as they are.`)
      // a branch: no link on its page, and the form says why
      const branch = `${EXAMPLE_ROOT}/block-placement`
      const mine = await signIn(env, 'myra', { make: false })
      expect(await page(mine, `/w/${branch}`)).not.toContain('href="/new?edit=')
      expect(await body(await editPage(mine, branch))).toContain('a branch keeps the words it was opened with.')
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
