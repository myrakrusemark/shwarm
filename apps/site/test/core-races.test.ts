// Race tests (go-live 2.3 and 5.6 "done when"): parallel requests at kickoff (the last seat), the final check,
// simultaneous submissions, a final check racing a new submission and the sign-off, repros racing to reopen, and a
// final check racing a dead end, 100 times each, with zero double results. The control runs the same races
// without the tree's queue and shows the invariants catch the double results it produces.
import { describe, expect, it } from 'vitest'
import type { Actor } from '../src/core/actor'
import { TreeEngine, treeName, type Command } from '../src/core/engine'
import { agent, person, site, stepped, World, type P } from './core-fixtures'

const RUNS = 100
const RACERS = 5
const MID = 'minecraft-in-doom'

type Mode = 'queued' | 'unqueued'
const send = (w: World, mode: Mode, cmd: Command) => (mode === 'queued' ? w.engine.run(cmd) : w.engine.exec(cmd))

async function people(w: World, n: number): Promise<P[]> {
  const out: P[] = []
  for (let i = 0; i < n; i++) out.push(await person(w.db, `racer_${i}`))
  return out
}

/** The queue runs commands in the order they arrive, so each run sends them in a new order. */
function shuffled<T>(xs: T[]): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const codes = (errors: any[]) => [...new Set(errors.map(e => e?.code ?? String(e)))].sort().join()

/** Fire every command at once; collect results and errors. */
async function fire(w: World, mode: Mode, cmds: Command[]) {
  const settled = await Promise.allSettled(cmds.map(c => send(w, mode, c)))
  return {
    ok: settled.filter(s => s.status === 'fulfilled').map(s => (s as PromiseFulfilledResult<any>).value),
    errors: settled.filter(s => s.status === 'rejected').map(s => (s as PromiseRejectedResult).reason),
  }
}

/** The last seat: lobby of 3 with 2 seated, then 5 people join at once. Returns what's wrong, if anything. */
async function kickoffRace(mode: Mode): Promise<string[]> {
  const w = new World()
  const [myra, kestrel, ...racers] = await people(w, 2 + RACERS)
  await w.shwarm(site(myra), { lobby: 3 })
  await w.join(site(kestrel), MID)
  const r = await fire(w, mode, racers.map(p => ({ type: 'join', actor: site(p), input: { node: MID } })))
  const problems: string[] = []
  if (r.errors.length) problems.push(`${r.errors.length} joins failed`)
  const filled = w.events(MID, 'lobby_filled').length
  if (filled !== 1) problems.push(`${filled} lobby_filled events`)
  if (r.ok.filter(x => x.kickoff).length !== 1) problems.push(`${r.ok.filter(x => x.kickoff).length} kickoffs reported`)
  const seats = w.all('SELECT number FROM seat ORDER BY number').map(s => s.number)
  if (seats.join() !== '1,2,3,4,5,6,7') problems.push(`seats ${seats.join()}`)
  if (w.node(MID).state !== 'live') problems.push(`state ${w.node(MID).state}`)
  const notices = w.all("SELECT COUNT(*) AS n FROM inbox_item WHERE kind = 'system'")[0].n
  if (notices !== 3) problems.push(`${notices} kickoff notices`)
  return problems
}

/** The final check: 2 people checks needed, 1 in, then 5 people pass it at once. */
async function finalCheckRace(mode: Mode): Promise<string[]> {
  const w = new World()
  const [myra, kestrel, lumpy, ...racers] = await people(w, 3 + RACERS)
  await w.shwarm(site(myra), { check: { people: 2 } })
  await w.join(site(kestrel), MID)
  const s = await w.submit(agent(kestrel), MID)
  await w.pass(site(lumpy), MID, s.id)
  const r = await fire(
    w,
    mode,
    racers.map(p => ({ type: 'check', actor: site(p), input: { node: MID, on: s.id, verdict: 'pass', log: 'corner 0: 0/200 failed' } })),
  )
  const problems: string[] = []
  // The first one in passes it; a closed node takes no more passes (A25).
  if (r.ok.length !== 1 || (r.errors.length && codes(r.errors) !== 'shwarm_closed')) problems.push(`${r.ok.length} checks went in; refused: ${codes(r.errors)}`)
  const passed = w.events(MID, 'passed').length
  if (passed !== 1) problems.push(`${passed} passed events`)
  const closes = w.all("SELECT COUNT(*) AS n FROM inbox_item WHERE kind = 'system' AND text LIKE '%passed%'")[0].n
  const involved = new Set(w.all('SELECT person_id FROM seat UNION SELECT person_id FROM post').map(x => x.person_id)).size
  if (closes > involved) problems.push(`${closes} pass notices for ${involved} people`)
  if (w.node(MID).state !== 'closed') problems.push(`state ${w.node(MID).state}`)
  if (w.sub(s.id).status !== 'passed') problems.push(`submission ${w.sub(s.id).status}`)
  return problems
}

/** Simultaneous submissions: 5 people submit to one node at once. */
async function submissionRace(mode: Mode): Promise<string[]> {
  const w = new World()
  const [myra, kestrel, ...racers] = await people(w, 2 + RACERS)
  await w.shwarm(site(myra), { check: { people: 1 } })
  await w.join(site(kestrel), MID)
  const r = await fire(
    w,
    mode,
    racers.map((p, i) => ({ type: 'submit', actor: agent(p), input: { node: MID, text: `try ${i}`, links: [{ repo: 'https://codeberg.org/x/y', commit: String(i).repeat(40) }], howToCheck: 'run it' } })),
  )
  const problems: string[] = []
  if (r.errors.length) problems.push(`${r.errors.length} submissions failed`)
  const numbers = w.all('SELECT number FROM submission ORDER BY number').map(x => x.number)
  if (numbers.join() !== '1,2,3,4,5') problems.push(`numbers ${numbers.join()}`)
  const events = w.events(MID, 'submission').map(e => e.number)
  if (new Set(events).size !== events.length || events.length !== RACERS) problems.push(`submission events ${events.join()}`)
  if (w.node(MID).next_submission !== RACERS + 1) problems.push(`next_submission ${w.node(MID).next_submission}`)
  const open = w.all("SELECT COUNT(*) AS n FROM submission WHERE status = 'in_review'")[0].n
  if (open !== 1) problems.push(`${open} in review`)
  return problems
}

/**
 * Two submissions finishing at once (go-live 5.6): #1 needs 2 people checks and the author; 1 is in. The final
 * checks on #1, a new #2 and the author's sign-off on #1 all arrive together. Either #1 passes (the sign-off came
 * after a final check, before #2) and #2 is refused, or #2 replaces #1 and nothing passes.
 */
async function mixedFinishRace(mode: Mode): Promise<string[]> {
  const w = new World()
  const [myra, kestrel, lumpy, finn, ...racers] = await people(w, 4 + RACERS)
  await w.shwarm(site(myra), { check: { people: 2, author: true } })
  await w.join(site(kestrel), MID)
  const s1 = await w.submit(agent(kestrel), MID)
  await w.pass(site(lumpy), MID, s1.id)
  const sub2: Command = { type: 'submit', actor: agent(finn), input: { node: MID, text: 'another way', links: [{ repo: 'https://codeberg.org/f/y', commit: 'b'.repeat(40) }], howToCheck: 'run it' } }
  const signOff: Command = { type: 'check', actor: stepped(myra), input: { node: MID, on: s1.id, slot: 'author', verdict: 'pass', text: 'played it' } }
  const finals: Command[] = racers.map(p => ({ type: 'check', actor: site(p), input: { node: MID, on: s1.id, verdict: 'pass', log: 'corner 0: 0/200 failed' } }))
  await fire(w, mode, shuffled([...finals, sub2, signOff]))
  const problems: string[] = []
  const passed = w.events(MID, 'passed').length
  if (passed > 1) problems.push(`${passed} passed events`)
  const one = w.sub(s1.id).status
  const two = w.get('SELECT status FROM submission WHERE number = 2')?.status
  if (passed === 1) {
    if (one !== 'passed' || two !== undefined || w.node(MID).state !== 'closed') problems.push(`passed, but #1 ${one}, #2 ${two}, node ${w.node(MID).state}`)
  } else if (one !== 'superseded' || two !== 'in_review' || w.node(MID).state !== 'live') problems.push(`no pass, but #1 ${one}, #2 ${two}, node ${w.node(MID).state}`)
  const notices = w.all("SELECT COUNT(*) AS n FROM inbox_item WHERE kind = 'sign_off' AND post_id = ?", s1.id)[0].n
  const mails = w.all("SELECT COUNT(*) AS n FROM email_outbox WHERE template = 'sign_off_ready'")[0].n
  if (notices > 1 || mails !== notices) problems.push(`${notices} sign-off notices, ${mails} mails`)
  if (w.all("SELECT 1 FROM inbox_item WHERE kind = 'sign_off' AND post_id = ? AND done_at IS NULL", s1.id).length) problems.push('#1 still waits on the author')
  return problems
}

/** Reopening: a passed node, then 5 repros on its passing submission at once. Exactly one reopens it. */
async function reopenRace(mode: Mode): Promise<string[]> {
  const w = new World()
  const [myra, kestrel, lumpy, ...racers] = await people(w, 3 + RACERS)
  await w.shwarm(site(myra), { check: { people: 1 } })
  await w.join(site(kestrel), MID)
  const s = await w.submit(agent(kestrel), MID)
  await w.pass(site(lumpy), MID, s.id)
  const r = await fire(w, mode, racers.map(p => ({ type: 'check', actor: site(p), input: { node: MID, on: s.id, verdict: 'fail', repro: 'place on corner 3. the block vanishes.' } })))
  const problems: string[] = []
  if (r.errors.length) problems.push(`${r.errors.length} repros failed: ${codes(r.errors)}`)
  const reopened = w.events(MID, 'reopened').length
  if (reopened !== 1) problems.push(`${reopened} reopened events`)
  if (w.node(MID).state !== 'live') problems.push(`state ${w.node(MID).state}`)
  if (w.sub(s.id).status !== 'passed') problems.push(`submission ${w.sub(s.id).status}`) // the pass stays on record
  return problems
}

/** A final check racing the author's dead end: 2 people checks needed, 1 in. Exactly one of them ends the node. */
async function deadEndRace(mode: Mode): Promise<string[]> {
  const w = new World()
  const [myra, kestrel, lumpy, ...racers] = await people(w, 3 + RACERS)
  await w.shwarm(site(myra), { check: { people: 2 } })
  await w.join(site(kestrel), MID)
  const s = await w.submit(agent(kestrel), MID)
  await w.pass(site(lumpy), MID, s.id)
  const end: Command = { type: 'deadEnd', actor: stepped(myra), input: { node: MID, note: 'the engine caps dynamic geometry.' } }
  const finals: Command[] = racers.map(p => ({ type: 'check', actor: site(p), input: { node: MID, on: s.id, verdict: 'pass', log: 'corner 0: 0/200 failed' } }))
  const r = await fire(w, mode, shuffled([...finals, end]))
  const problems: string[] = []
  const passed = w.events(MID, 'passed').length
  const ended = w.events(MID, 'dead_end').length
  if (passed + ended !== 1) problems.push(`${passed} passed and ${ended} dead_end events`)
  const state = w.node(MID).state
  if (state !== (passed ? 'closed' : 'dead_end')) problems.push(`state ${state}`)
  if (r.errors.length && codes(r.errors) !== 'shwarm_closed') problems.push(`refused: ${codes(r.errors)}`)
  return problems
}

const RACES = {
  'kickoff (the last seat)': kickoffRace,
  'the final check': finalCheckRace,
  'two simultaneous submissions': submissionRace,
  'mixed finish (final checks, a new submission, the sign-off)': mixedFinishRace,
  'reopen (repros on the passing submission)': reopenRace,
  'final check vs dead end': deadEndRace,
}

// What each race does without the queue: every racer reads before anyone writes.
const DOUBLED: Record<keyof typeof RACES, RegExp> = {
  'kickoff (the last seat)': /^[2-5] lobby_filled events$/,
  'the final check': /^[2-5] passed events$/,
  'two simultaneous submissions': /^[1-4] submissions failed$/, // every racer took #1; the unique index refused the rest
  'mixed finish (final checks, a new submission, the sign-off)': /^[2-5] sign-off notices/, // each final check saw itself as the last
  'reopen (repros on the passing submission)': /^[2-5] reopened events$/,
  'final check vs dead end': /^[1-5] passed and 1 dead_end events$/,
}

describe('races, through the tree queue', () => {
  for (const [name, race] of Object.entries(RACES)) {
    it(`${name}: ${RUNS} runs, zero double results`, async () => {
      const bad: string[] = []
      for (let i = 0; i < RUNS; i++) {
        const p = await race('queued')
        if (p.length) bad.push(`run ${i}: ${p.join('; ')}`)
      }
      expect(bad).toEqual([])
    }, 30_000) // 100 runs each; the whole suite runs in parallel, so allow more than vitest's 5 s
  }
})

describe('control: the same races without the queue', () => {
  for (const [name, race] of Object.entries(RACES)) {
    it(`${name}: the race test catches the double result`, async () => {
      const p = await race('unqueued')
      expect(p.some(x => DOUBLED[name as keyof typeof RACES].test(x)), p.join('; ')).toBe(true)
    })
  }
})

describe('the queue', () => {
  it('runs commands one at a time, in order, and keeps going after a refusal', async () => {
    const w = new World()
    const [myra, kestrel] = await people(w, 2)
    await w.shwarm(site(myra))
    const order: string[] = []
    const a = w.engine.run({ type: 'join', actor: site(kestrel), input: { node: 'nope' } }).catch(e => order.push('refused:' + e.code))
    const b = w.engine.run({ type: 'join', actor: site(kestrel), input: { node: MID } }).then(() => order.push('joined'))
    await Promise.all([a, b])
    expect(order).toEqual(['refused:no_such_node', 'joined'])
  })
})

// Creates in different trees run on different ShwarmTree objects, so nothing queues them behind each other.
// One engine per tree name stands in for one Durable Object per tree.
describe('across trees', () => {
  const engines = (w: World) => {
    const m = new Map<string, TreeEngine>()
    return (cmd: Command) => {
      const name = treeName(cmd)
      if (!m.has(name)) m.set(name, new TreeEngine(w.db, () => w.now))
      return m.get(name)!.run(cmd)
    }
  }
  const create = (by: Actor, input: Record<string, unknown>): Command => ({
    type: 'createNode',
    actor: by,
    input: { what: 'w', doneWhen: 'd', check: { author: true }, ...input } as any,
  })

  it('keeps the 3-a-day limit when parallel creates land in different trees', async () => {
    for (let i = 0; i < 20; i++) {
      const w = new World()
      const [myra] = await people(w, 1)
      const seed = { ...site(myra), via: 'seed' as const }
      const send = engines(w)
      for (const root of ['alpha', 'beta', 'gamma', 'delta']) await send(create(seed, { kind: 'shwarm', title: root, tags: ['x'], lobby: 1 }))
      await send(create(site(myra), { kind: 'branch', parent: 'delta', title: 'one' }))
      await send(create(site(myra), { kind: 'branch', parent: 'delta', title: 'two' }))
      const r = await Promise.allSettled([
        send(create(site(myra), { kind: 'branch', parent: 'alpha', title: 'a' })),
        send(create(site(myra), { kind: 'branch', parent: 'beta', title: 'b' })),
        send(create(site(myra), { kind: 'branch', parent: 'gamma', title: 'c' })),
        send(create(site(myra), { kind: 'shwarm', title: 'epsilon', tags: ['x'] })),
      ])
      expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1)
      for (const x of r) if (x.status === 'rejected') expect(x.reason.code).toBe('rate_limited')
      expect(w.all('SELECT COUNT(*) AS n FROM node WHERE author_id = ? AND seeded = 0', myra.id)[0].n).toBe(3)
      // a refused create leaves nothing behind: no event, tag or seat
      expect(w.all("SELECT COUNT(*) AS n FROM audit_event WHERE event = 'branch_opened'")[0].n).toBe(w.all("SELECT COUNT(*) AS n FROM node WHERE kind = 'branch'")[0].n)
      expect(w.all("SELECT COUNT(*) AS n FROM node_tag t JOIN node n ON n.id = t.node_id WHERE n.path = 'epsilon'")[0].n).toBe(w.node('epsilon') ? 1 : 0)
    }
  })
})
