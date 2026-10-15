// Go-live 4.4, the rest, as no lobby left it (decided Oct 9): joining a live shwarm (working on it). Editing a shwarm
// (decided Oct 10) is gone for users (decided Oct 12: once posted, a shwarm's or a branch's words can't be changed): no
// link, form mode or save, and the forms say so; versions kept before then still show. core's editNode stays as the
// operator's seed card-fix tool (seed/edit.ts), and its rules are tested here as that tool runs them.
// Go-live 4.8: editing any of your own plain posts (with "edited" and its history), deleting one (a tombstone), "make it
// a branch" from a post, and no "claimed by" anywhere a page is drawn.
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { rollupStats } from '../src/jobs/stats'
import { readContributors, readChain, readNodeEdits } from '../src/read/node'
import { NO_EDIT, type EditNodeInput } from '../src/core/nodes'
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
    expect(await w.join(site(bmo), MID)).toMatchObject({ node: MID, joined: true })
  })

  it('join a live shwarm with no limit: no kickoff, no event, no notice', async () => {
    expect(await w.join(site(ana), MID)).toMatchObject({ node: MID, joined: true })
    expect(await w.join(site(finn), MID)).toMatchObject({ node: MID, joined: true })
    expect(await w.join(site(kes), MID)).toMatchObject({ node: MID, joined: true })
    expect(w.all('SELECT number FROM seat WHERE left_at IS NULL ORDER BY number').map(r => r.number)).toEqual([1, 2, 3, 4, 5])
    expect(w.events(MID)).toEqual([])
    expect(w.all("SELECT person_id FROM inbox_item WHERE kind = 'system'")).toEqual([])
    // a double click keeps the one join
    expect(await w.join(site(ana), MID)).toMatchObject({ node: MID, joined: false })
    // anyone but the author can leave; an agent only with the key's join permission (decided Oct 12)
    expect(await w.run({ type: 'leave', actor: site(ana), input: { node: MID } })).toEqual({ node: MID, as: '@ana', person: '@ana', left: true })
    await refused(w.run({ type: 'leave', actor: site(myra), input: { node: MID } }), 'bad_request')
    await refused(w.join(agent(finn), MID), 'not_permitted', { need: 'join', node: MID })
    // branches are joined too (decided Oct 12), and count the joiner in the shwarm
    await w.branch(site(myra), MID)
    expect(await w.join(site(ana), `${MID}/block-placement`)).toMatchObject({ joined: true, nodes: [`${MID}/block-placement`, MID] })
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

})

// ---------- core: edit (decided Oct 10, '"edit" replaces re-pitch') ----------

describe("core editNode, the operator's seed card-fix tool only (no user edits since Oct 12): its Oct 10 rules", () => {
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
      check: { runs: { command: './bench.sh', count: 3 }, author: true }, // taken and ignored: no node keeps checks (decided Oct 14)
      tags: ['games', 'voxels'],
      license: 'GPL-3.0',
    }
    expect(await edit(stepped(myra), changed)).toEqual({ node: MID, edited: true, at: iso(w.now), triage: 'pending' })
    expect(w.node(MID)).toMatchObject({
      path: MID,
      title: NEW.title,
      what: NEW.what,
      done_when: changed.doneWhen,
      checks: JSON.stringify({ author: false }),
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

  it('a submission from before Oct 14 locks it, whoever made it', async () => {
    w.oldSubmission(ana, MID) // ana never joined
    const e = await refused(edit(stepped(myra), NEW), 'bad_request', { reason: 'submitted' })
    expect(e.message).toBe(`${MID} has a submission. its words stay as they are`)
  })

  it("a submission a branch took before Oct 14 locks it too; opening a branch doesn't", async () => {
    await w.branch(site(ana), MID)
    expect(await edit(stepped(myra), { title: 'minecraft in doom, take two' })).toMatchObject({ edited: true })
    // nothing takes submissions now (decided Oct 14); one from before stays, as history
    const bp = w.node(`${MID}/block-placement`).id
    w.db.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_oldbranch1', ?, ?, '@ana/m-04', 'submission', 'old work', ?)").run(bp, ana.id, iso(w.now))
    w.db.raw.prepare("INSERT INTO submission (post_id, node_id, number, hash, how_to_check, author_swap) VALUES ('p_oldbranch1', ?, 1, ?, 'run it', 0)").run(bp, 'a'.repeat(64))
    const e = await refused(edit(stepped(myra), NEW), 'bad_request', { reason: 'submitted' })
    expect(e.message).toBe(`${MID} has a submission. its words stay as they are`)
  })

  it("a new license reaches its branches; a shwarm can't build on its own branch", async () => {
    await w.branch(site(myra), MID)
    expect(await edit(stepped(myra), { license: 'GPL-3.0' })).toMatchObject({ edited: true })
    expect([w.node(MID).license, w.node(`${MID}/block-placement`).license]).toEqual(['GPL-3.0', 'GPL-3.0'])
    const e = await refused(edit(stepped(myra), { buildsOn: `${MID}/block-placement` }), 'bad_request')
    expect(e.message).toBe('builds_on names a shwarm on shwarm, or an outside project as {name, url, license}')
    expect(w.node(`${MID}/block-placement`).builds_on).toBeNull()
  })

  it('line breaks sent as \\r\\n are the same words: no edit', async () => {
    expect(await edit(stepped(myra), { what: 'line one.\n\nline two.', doneWhen: 'load it.\nplay e1m1.' })).toMatchObject({ edited: true })
    const crlf = { what: 'line one.\r\n\r\nline two.', doneWhen: 'load it.\r\nplay e1m1.' }
    expect(await edit(stepped(myra), crlf)).toMatchObject({ edited: false })
    expect(await edit(stepped(myra), { ...crlf, title: 'minecraft in doom, take two' })).toMatchObject({ edited: true })
    expect(w.node(MID).what).toBe('line one.\n\nline two.')
  })

  it('a branch keeps the words it was opened with', async () => {
    await w.branch(site(myra), MID)
    const e = await refused(edit(stepped(myra), { title: 'x', what: 'y' }, `${MID}/block-placement`), 'bad_request')
    expect(e.message).toBe('a branch keeps the words it was opened with')
  })

  it('a blocked shwarm is refused', async () => {
    w.db.raw.prepare("UPDATE node SET triage = 'blocked' WHERE path = ?").run(MID)
    await refused(edit(stepped(myra), NEW), 'not_permitted', { reason: 'blocked' })
    expect(w.all('SELECT 1 FROM node_edit')).toEqual([])
  })

  it('builds on as a create takes it: any shwarm brings its license, to the branches too (decided Oct 14)', async () => {
    await w.shwarm(site(ana), { title: 'doom speedruns', license: 'GPL-3.0' })
    await refused(edit(stepped(myra), { buildsOn: 'doom-speedruns' }), 'bad_request') // still being checked: myra can't see it
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = 'doom-speedruns'").run()
    await refused(edit(stepped(myra), { buildsOn: 'no-such-shwarm' }), 'bad_request')
    await w.branch(site(myra), MID)
    // the upstream license wins over any sent; it has no pass record, so it's built on as it stands
    const upstream = '{"node":"doom-speedruns","as_of":null}'
    expect(await edit(stepped(myra), { buildsOn: 'doom-speedruns', license: 'MIT' })).toMatchObject({ edited: true })
    expect(w.node(MID)).toMatchObject({ license: 'GPL-3.0', builds_on: upstream })
    expect(w.node(`${MID}/block-placement`)).toMatchObject({ license: 'GPL-3.0', builds_on: upstream })
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
    const sub = w.oldSubmission(kes, MID) // from before Oct 14, when a shwarm took submissions
    await refused(del(site(kes), sub.id), 'not_permitted', { kind: 'submission' })
    await refused(del(site(kes), 'p_doesnotexist1'), 'bad_request')
    expect(w.all('SELECT 1 FROM post WHERE deleted_at IS NOT NULL')).toEqual([])
  })

  it('a deleted post takes no edit, upvote or reply; a deleted pinned post is unpinned', async () => {
    const p = await w.post(site(kes), MID, 'a thing to build on.')
    await del(site(kes), p.id)
    await refused(w.run({ type: 'editPost', actor: site(kes), input: { node: MID, post: p.id, text: 'back again' } }), 'bad_request')
    await refused(w.run({ type: 'upvote', actor: site(myra), input: { node: MID, post: p.id } }), 'bad_request')
    await refused(w.post(site(myra), MID, 'replying to nothing', { replyTo: p.id }), 'bad_request')
    const pin = await w.post(site(myra), MID, 'status update: started.', { pin: true })
    await del(site(myra), pin.id)
    expect(w.pins(MID)).toEqual([])
  })

  it("a deleted pinned post's first line leaves the feed's status line at once, not at the next stats run", async () => {
    const id = w.node(MID).id
    await w.branch(site(myra), MID) // on track, the status line falls back to its branches
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
    expect(line()).toBe('1 branch on track.')
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
  /** The people card: who's on the node, and joining (decided Oct 14, "One card for a node's people"). */
  const card = (html: string) => {
    const i = html.indexOf('<div class="box people" id="people">')
    expect(i).toBeGreaterThan(-1)
    return html.slice(i, html.indexOf('<div class="box', i + 1))
  }
  async function act(b: Browser, fields: Record<string, string>, path = `/w/${EXAMPLE_ROOT}`) {
    const token = formTokenIn(await page(b, path))
    return b.req(path, { form: { form_token: token, ...fields } })
  }

  describe('join (4.4, decided Oct 9)', () => {
    it('a live shwarm offers "join" in its people card; joining shows you there and on your profile; leave undoes it', async () => {
      const { env, q } = await world()
      const b = await signIn(env, 'ana')
      let box = card(await page(b))
      expect(box).toContain('<input type="hidden" name="do" value="join"/>')
      expect(box).toContain("or give your agent this shwarm's url:")
      const res = await act(b, { do: 'join' })
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}`)
      expect(q("SELECT s.number FROM seat s JOIN person p ON p.id = s.person_id WHERE p.handle = 'ana'")).toEqual({ number: 7 }) // after @myra, @bmo_fan, @finn_irl and @kestrel through the branch, @marceline and @lumpy
      box = card(await page(b))
      // the card shows the top five; the full list, behind "+ n more", has her
      expect(box).toContain(`href="/w/${EXAMPLE_ROOT}/people"`)
      const people: any = await (await b.req(`/w/${EXAMPLE_ROOT}/people?format=json`)).json()
      expect(people.people.map((x: any) => x.name)).toContain('@ana')
      expect(box).toContain("you're working on this shwarm.")
      expect(box).not.toContain('value="join"')
      // no lobby, no kickoff: joining writes no event
      expect(q("SELECT COUNT(*) AS n FROM audit_event a JOIN node n ON n.id = a.node_id WHERE n.path = ? AND a.event = 'lobby_filled'", EXAMPLE_ROOT)).toEqual({ n: 0 })
      expect(await body(await b.req('/@ana', { headers: HTML }))).toContain('minecraft in doom')
      // leave sits under it, and undoes it
      expect(box).toContain('<input type="hidden" name="do" value="leave"/>')
      expect((await act(b, { do: 'leave' })).status).toBe(303)
      expect(q("SELECT s.left_at IS NOT NULL AS gone FROM seat s JOIN person p ON p.id = s.person_id WHERE p.handle = 'ana'")).toEqual({ gone: 1 })
      expect(card(await page(b))).toContain('value="join"')
    })

    it('signed out, "join" goes to sign-in; unverified, it waits; the author has no leave; a branch offers it too', async () => {
      const { env } = await world()
      const out = card(await page(new Browser(env)))
      expect(out).toContain(`<a class="btn plain" href="/signin?next=%2Fw%2F${EXAMPLE_ROOT}">join</a>`)
      const quiet = await signIn(env, 'quiet', { verified: false })
      expect(card(await page(quiet))).toContain('verify your email to join.')
      const author = await signIn(env, 'myra', { make: false })
      const mine = card(await page(author, `/w/${PLAIN}`))
      expect(mine).toContain("you're working on this shwarm.")
      expect(mine).not.toContain('value="leave"')
      const b = await signIn(env, 'ana')
      expect(card(await page(b, `/w/${PLAIN}`))).toContain('value="join"') // a new launch shwarm is live too
      // a branch is joined too (decided Oct 12, "Branches can be joined")
      const branch = card(await page(b, `/w/${EXAMPLE_ROOT}/block-placement`))
      expect(branch).toContain('value="join"')
      expect(branch).toContain("or give your agent this branch's url:")
    })
  })

  describe("no editing a shwarm's or a branch's words (decided Oct 12)", () => {
    it('no user edit path exists: no link, no form mode, no save; an old edit link, edit form or re-pitch form is refused and changes nothing', async () => {
      const { env, q } = await world()
      const before = q<{ id: number; title: string }>('SELECT id, title, what, done_when, checks, license, builds_on FROM node WHERE path = ?', PLAIN)
      const nodes = q<{ n: number }>('SELECT COUNT(*) AS n FROM node').n
      // the author of a shwarm nobody else joined, nothing submitted: what Oct 10 called editable
      const author = await signIn(env, 'myra', { make: false })
      for (const path of [PLAIN, `${EXAMPLE_ROOT}/block-placement`]) {
        const html = await page(author, `/w/${path}`)
        expect(html).not.toContain('/new?edit=')
        expect(html).not.toContain('class="edit-it"')
      }
      // the old edit link: refused, no form, nothing of the node read into it
      let res = await author.req(`/new?edit=${PLAIN}`, { headers: HTML })
      expect(res.status).toBe(410)
      let html = await body(res)
      expect(html).toContain(`<p class="err top" role="alert">${NO_EDIT}</p>`)
      expect(html).not.toContain('<form method="post" action="/new"')
      expect(html).not.toContain(before.title)
      // a save from an old edit tab, with the password: refused, the node unchanged, no new shwarm made from it
      const token = formTokenIn(await page(author, '/new'))
      const fields = { form_token: token, edit: PLAIN, title: 'mine now', what: 'new words.', done_when: 'it is done.', c_author: 'on', tags: '#games', license: 'MIT', password: GOOD_PASSWORD }
      res = await author.req('/new', { form: fields })
      expect(res.status).toBe(410)
      expect(await body(res)).toContain(NO_EDIT)
      expect(q('SELECT id, title, what, done_when, checks, license, builds_on FROM node WHERE path = ?', PLAIN)).toEqual(before)
      expect(q('SELECT COUNT(*) AS n FROM node').n).toBe(nodes)
      expect(q('SELECT COUNT(*) AS n FROM node_edit WHERE node_id = ?', before.id)).toEqual({ n: 0 })
      // a re-pitch form from an old tab: refused with why
      res = await act(author, { do: 'repitch', title: 'too late', what: 'new words.' }, `/w/${PLAIN}`)
      expect(res.status).toBe(400)
      expect(await body(res)).toContain(NO_EDIT)
      expect(q('SELECT title FROM node WHERE path = ?', PLAIN)).toEqual({ title: before.title })
    })

    it('the create and branch forms say, by the button, that once posted it can\'t be changed', async () => {
      const { env } = await world()
      const b = await signIn(env, 'myra', { make: false })
      for (const path of ['/new', `/new?parent=${EXAMPLE_ROOT}`]) {
        const html = await body(await b.req(path, { headers: HTML }))
        expect(html, path).toMatch(/<span class="note" id="go-note">[^<]*<b id="fixed-note">once posted, nothing on this form can be changed.<\/b><\/span>/)
        expect(html, path).not.toContain('someone else joins or anything is submitted')
        expect(html, path).not.toContain('id="e-pw"')
      }
      // the lock note sits with the checks, so only the shwarm form has it: a branch takes no checks (decided Oct 14)
      expect(await body(await b.req('/new', { headers: HTML }))).toContain("the done test can't change once it's posted.")
    })

    it("a shwarm edited before Oct 12 still shows its history: to everyone if the old words were public, else to its author alone", async () => {
      const { env, q } = await world()
      const n = q<{ id: number; title: string; created_at: string }>('SELECT id, title, created_at FROM node WHERE path = ?', PLAIN)
      env.DB.raw
        .prepare('INSERT INTO node_edit (node_id, by_name, title, what, edited_at, was_public) VALUES (?, ?, ?, ?, ?, 1), (?, ?, ?, ?, ?, 0)')
        .run(n.id, '@myra', 'the words it started with', 'the first what.', iso(T0 - 2 * HOUR), n.id, '@myra', 'words never cleared', 'unseen.', iso(T0 - HOUR))
      const out = await body(await new Browser(env).req(`/w/${PLAIN}`, { headers: HTML }))
      expect(out).toContain('<summary>edited</summary>')
      expect(out).toContain('<b>the words it started with</b>')
      expect(out).not.toContain('words never cleared')
      const mine = await page(await signIn(env, 'myra', { make: false }), `/w/${PLAIN}`)
      expect(mine).toContain('<b>words never cleared</b>')
      expect(mine).not.toContain('/new?edit=')
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

    it('"make it a branch" opens the branch form filled from the post; only plain posts', async () => {
      const { env, q } = await world()
      const b = await signIn(env, 'ana')
      await act(b, { do: 'post', text: 'monster collision\n\nimps walk through placed blocks: the blockmap is only built at level load.' })
      const id = q<{ id: string }>("SELECT id FROM post WHERE text LIKE 'monster collision%'").id
      const block = postIn(await page(b), id)
      expect(block).toContain(`<a href="/new?parent=${EXAMPLE_ROOT}&from=${id}">start a branch from this post</a>`) // body() decodes &amp;
      const form = await body(await b.req(`/new?parent=${EXAMPLE_ROOT}&from=${id}`))
      expect(form).toContain('<h1 class="title" id="heading">new branch</h1>')
      expect(form).toContain('value="monster collision"')
      expect(form).toContain('>monster collision\n\nimps walk through placed blocks: the blockmap is only built at level load.</textarea>')
      // anything but a plain post here starts empty
      const claim = q<{ id: string }>('SELECT id FROM post WHERE claim IS NOT NULL LIMIT 1')
      for (const from of [claim.id, 'p_doesnotexist1', 'nonsense']) {
        const empty = await body(await b.req(`/new?parent=${EXAMPLE_ROOT}&from=${from}`))
        expect(empty).toContain('<h1 class="title" id="heading">new branch</h1>')
        expect(empty).not.toContain('value="monster collision"')
      }
      // a new shwarm takes branches at once
      await act(b, { do: 'post', text: 'a first post.' }, `/w/${PLAIN}`)
      const lp = q<{ id: string }>("SELECT id FROM post WHERE text = 'a first post.'").id
      expect(postIn(await page(b, `/w/${PLAIN}`), lp)).toContain('start a branch from this post')
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
