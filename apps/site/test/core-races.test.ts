// Race tests (go-live 2.3 and 5.6 "done when"): parallel joins and parallel backing (each person twice at once; there
// is no lobby or kickoff since Oct 9), and a pass come due that several acts reach at once (submissions, checks and
// sign-off retired on Oct 14), 100 times each, with zero double results. The control runs the joins and backing without
// the tree's queue and shows the invariants catch the double results it produces; the pass needs no queue.
import { describe, expect, it } from 'vitest'
import type { Actor } from '../src/core/actor'
import { TreeEngine, treeName, type Command } from '../src/core/engine'
import { DAY, person, site, World, type P } from './core-fixtures'

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

/** Joins: 5 people each join twice at once (a double click). Each is down once, with no error. Returns what's wrong. */
async function joinRace(mode: Mode): Promise<string[]> {
  const w = new World()
  const [myra, kestrel, ...racers] = await people(w, 2 + RACERS)
  await w.shwarm(site(myra))
  await w.join(site(kestrel), MID)
  const r = await fire(w, mode, shuffled([...racers, ...racers].map(p => ({ type: 'join', actor: site(p), input: { node: MID } }))))
  const problems: string[] = []
  if (r.errors.length) problems.push(`${r.errors.length} joins failed`)
  if (r.ok.filter(x => x.joined).length !== RACERS) problems.push(`${r.ok.filter(x => x.joined).length} joins reported`)
  const seats = w.all('SELECT number FROM seat ORDER BY number').map(s => s.number)
  if (seats.join() !== '1,2,3,4,5,6,7') problems.push(`seats ${seats.join()}`)
  if (w.node(MID).state !== 'live') problems.push(`state ${w.node(MID).state}`)
  if (w.events(MID).length) problems.push(`${w.events(MID).length} events`)
  return problems
}

/** Backing: 5 people each back one passed claim twice at once (a double click). Each backs it once, with one upvote. */
async function backRace(mode: Mode): Promise<string[]> {
  const w = new World()
  const [myra, kestrel, ...racers] = await people(w, 2 + RACERS)
  await w.shwarm(site(myra))
  await w.join(site(kestrel), MID)
  for (const p of racers) await w.join(site(p), MID)
  const c = await w.post(site(kestrel), MID, 'all nine maps play through.', { claim: 'passed' })
  const r = await fire(w, mode, shuffled([...racers, ...racers].map(p => ({ type: 'back', actor: site(p), input: { node: MID, post: c.id, on: true } }))))
  const problems: string[] = []
  if (r.errors.length) problems.push(`${r.errors.length} backs failed`)
  const changed = r.ok.filter(x => x.changed).length
  if (changed !== RACERS) problems.push(`${changed} backs reported`)
  const votes = w.all("SELECT COUNT(*) AS n FROM status_vote WHERE claim_id = ? AND status = 'passed'", c.id)[0].n
  if (votes !== RACERS + 1) problems.push(`${votes} backers`)
  const up = w.all('SELECT COUNT(*) AS n FROM upvote WHERE post_id = ?', c.id)[0].n
  if (up !== RACERS) problems.push(`${up} upvotes`)
  return problems
}

/**
 * The moment a pass comes due, 5 people vote on track at once: every one of their batches advances the band past the
 * same change to passed. Exactly one dated line, one crowd pass record, one 'passed' row and one author notice.
 */
async function passRace(mode: Mode): Promise<string[]> {
  const w = new World()
  const [myra, kestrel, lumpy, finn, ...racers] = await people(w, 4 + RACERS)
  await w.shwarm(site(myra))
  for (const p of [kestrel, lumpy, finn, ...racers]) await w.join(site(p), MID)
  const c = await w.post(site(kestrel), MID, 'all nine maps play through.', { claim: 'passed' })
  await w.run({ type: 'back', actor: site(lumpy), input: { node: MID, post: c.id, on: true } })
  await w.run({ type: 'back', actor: site(finn), input: { node: MID, post: c.id, on: true } })
  w.tick(2 * DAY) // passed led on track by 3 from the start: it became the status 16 hours in
  const r = await fire(w, mode, shuffled(racers.map(p => ({ type: 'status', actor: site(p), input: { node: MID, status: 'on_track' } }))))
  const problems: string[] = []
  if (r.errors.length) problems.push(`refused: ${codes(r.errors)}`)
  const count = (sql: string) => w.all(sql)[0].n
  const lines = count("SELECT COUNT(*) AS n FROM status_change WHERE to_status = 'passed'")
  const records = count("SELECT COUNT(*) AS n FROM pass_record WHERE kind = 'crowd'")
  const passed = w.events(MID, 'passed').length
  const notices = count("SELECT COUNT(*) AS n FROM inbox_item WHERE kind = 'system' AND post_id IS NOT NULL")
  if ([lines, records, passed, notices].join() !== '1,1,1,1') problems.push(`${lines} lines, ${records} records, ${passed} passed events, ${notices} notices`)
  return problems
}

const RACES = {
  'joins (each person twice at once)': joinRace,
  'backing (each person twice at once)': backRace,
}

// What each race does without the queue: every racer reads before anyone writes.
const DOUBLED: Record<keyof typeof RACES, RegExp> = {
  'joins (each person twice at once)': /^[1-5] joins failed$/, // both of a pair read "not joined"; the second insert hits the key
  'backing (each person twice at once)': /^([6-9]|10) backs reported$/, // both of a pair read "not backing" and say they changed it
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

// A change of status is written by whoever advances the band past it first, inside the tree or from the stats job,
// which runs outside it (core/status.ts flipStatements): so the database's keys keep it single, queue or no queue.
describe('a pass come due, reached by several acts at once', () => {
  for (const mode of ['queued', 'unqueued'] as const)
    it(`${mode}: ${RUNS} runs, written once`, async () => {
      const bad: string[] = []
      for (let i = 0; i < RUNS; i++) {
        const p = await passRace(mode)
        if (p.length) bad.push(`run ${i}: ${p.join('; ')}`)
      }
      expect(bad).toEqual([])
    }, 30_000)
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
      for (const root of ['alpha', 'beta', 'gamma', 'delta']) await send(create(seed, { kind: 'shwarm', title: root, tags: ['x'] }))
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
