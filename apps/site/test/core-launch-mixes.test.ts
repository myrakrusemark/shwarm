// Every check mix the launch shwarms use (go-live 5.3 "done when"), taken from docs/launch-shwarms.json through
// the import's own mapping, walked from a submission to a pass: runs, then people (human or not), then the author.
// Data-driven, so a mix added to the list is covered without touching this file.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCheckSpec, type CheckSpec } from '../src/core/checks'
import { mapLaunchShwarm } from '../src/seed/launch'
import { agent, DAY, person, refused, site, World, type P } from './core-fixtures'

const LIST: any[] = JSON.parse(readFileSync(new URL('../../../docs/launch-shwarms.json', import.meta.url), 'utf8'))
const MID = 'minecraft-in-doom'

/** One spec per distinct mix: run count, people count, at least one human, author. Commands and words don't matter here. */
const mixes = new Map<string, { spec: CheckSpec; slugs: string[] }>()
for (const e of LIST) {
  const spec = parseCheckSpec(mapLaunchShwarm(e).input.check)
  const key = `runs ${spec.runs?.count ?? 0} · people ${spec.people?.count ?? 0}${spec.people?.human ? ' (one human)' : ''}${spec.author ? ' · author' : ''}`
  const m = mixes.get(key) ?? { spec, slugs: [] }
  m.slugs.push(e.slug)
  mixes.set(key, m)
}

type Crowd = { myra: P; kestrel: P; others: P[] }

async function world(spec: CheckSpec): Promise<{ w: World } & Crowd> {
  const w = new World()
  const myra = await person(w.db, 'myra')
  const kestrel = await person(w.db, 'kestrel')
  const others: P[] = []
  for (const h of ['lumpy', 'finn_irl', 'marceline', 'tallgrass', 'bmo_fan', 'gunter']) others.push(await person(w.db, h))
  await w.shwarm(site(myra), { check: spec })
  await w.join(site(kestrel), MID)
  return { w, myra, kestrel, others }
}

/** Runs, then the people checks (the last one human), then the author. Returns the result of the last check. */
async function walk(w: World, spec: CheckSpec, c: Crowd, s: { id: string; hash: string }, people: number, author: boolean) {
  const queue = [...c.others]
  let last: any
  for (let i = 0; i < (spec.runs?.count ?? 0); i++) last = await w.runReport(agent(queue.shift()!, 'runner'), MID, s.id, s.hash)
  for (let i = 0; i < people; i++) {
    const p = queue.shift()!
    expect(last?.submission_state ?? 'in_review').toBe('in_review') // nothing passes early
    last = await w.pass(i === people - 1 ? site(p) : agent(p), MID, s.id) // agents first; the last one is a human
  }
  if (author) {
    expect(last?.submission_state ?? 'in_review').toBe('in_review')
    last = await w.signOff(c.myra, MID, s.id)
  }
  return last
}

describe('the launch check mixes', () => {
  it('has the mixes the list uses', () => {
    expect(mixes.size).toBeGreaterThanOrEqual(4)
    expect([...mixes.values()].reduce((n, m) => n + m.slugs.length, 0)).toBe(LIST.length)
  })

  for (const [name, { spec, slugs }] of mixes) {
    describe(`${name} (${slugs.length} shwarms, e.g. ${slugs[0]})`, () => {
      it('walks a submission to a pass and closes the node', async () => {
        const { w, ...c } = await world(spec)
        const s = await w.submit(agent(c.kestrel), MID)
        expect(s.checks.map((r: any) => r.slot)).toEqual([
          ...Array(spec.runs?.count ?? 0).fill('run'),
          ...Array(spec.people?.count ?? 0).fill('people'),
          ...(spec.author ? ['author'] : []),
        ])
        const r = await walk(w, spec, c, s, spec.people?.count ?? 0, spec.author)
        expect(r).toMatchObject({ submission_state: 'passed', node_state: 'closed' })
        expect(w.events(MID, 'passed')).toHaveLength(1)
        // the author heard once, by inbox and mail, and nothing is left waiting on them
        const signOff = w.all("SELECT done_at FROM inbox_item WHERE kind = 'sign_off'")
        expect(signOff).toHaveLength(spec.author ? 1 : 0)
        for (const i of signOff) expect(i.done_at).not.toBeNull()
        expect(w.all("SELECT 1 FROM email_outbox WHERE template = 'sign_off_ready'")).toHaveLength(spec.author ? 1 : 0)
      })

      if (spec.people?.human)
        it("doesn't pass on agents' people checks alone (at least one human)", async () => {
          const { w, ...c } = await world(spec)
          const s = await w.submit(agent(c.kestrel), MID)
          const [a, b, ...rest] = c.others
          for (let i = 0; i < (spec.runs?.count ?? 0); i++) await w.runReport(agent(rest[i], 'runner'), MID, s.id, s.hash)
          for (const p of [a, b]) expect((await w.pass(agent(p), MID, s.id)).submission_state).toBe('in_review') // more agent checks than needed
          if (spec.author) await refused(w.signOff(c.myra, MID, s.id), 'not_permitted', { need: 'other_checks' })
          expect(w.node(MID).state).toBe('live')
          const r = await w.pass(site(rest.at(-1)!), MID, s.id)
          expect(r.submission_state).toBe(spec.author ? 'in_review' : 'passed')
        })

      it('lets a standing fail block only the submission it was posted on (#37)', async () => {
        const { w, ...c } = await world(spec)
        const s1 = await w.submit(agent(c.kestrel), MID)
        const [skeptic, ...rest] = c.others
        await w.fail(site(skeptic), MID, s1.id)
        // every other check passes #1, and it still can't pass
        const crowd = { ...c, others: rest }
        const r1 = await walk(w, spec, crowd, s1, spec.people?.count ?? 0, false)
        expect(r1?.submission_state ?? 'in_review').toBe('in_review')
        if (spec.author) await refused(w.signOff(c.myra, MID, s1.id), 'not_permitted', { need: 'other_checks' })
        // a new submission starts clean: the repro on #1 doesn't block it
        w.tick(DAY)
        const s2 = await w.submit(agent(c.kestrel), MID)
        expect(w.sub(s1.id).status).toBe('superseded')
        const r2 = await walk(w, spec, { ...c, others: [skeptic, ...rest] }, s2, spec.people?.count ?? 0, spec.author)
        expect(r2).toMatchObject({ submission_state: 'passed', node_state: 'closed' })
      })

      if (spec.author)
        it("swaps the author check for one more outside people check on @myra's own agents' work (A9)", async () => {
          const { w, ...c } = await world(spec)
          const s = await w.submit(agent(c.myra, 'm-07'), MID)
          expect(s.authorSwap).toBe(true)
          expect(s.checks.filter((r: any) => r.slot === 'people')).toHaveLength((spec.people?.count ?? 0) + 1)
          expect(s.checks.some((r: any) => r.slot === 'author')).toBe(false)
          await refused(w.pass(site(c.myra), MID, s.id), 'own_work')
          // the usual people checks aren't enough: it needs one more from outside @myra's account
          const r = await walk(w, spec, c, s, spec.people?.count ?? 0, false)
          expect(r.submission_state).toBe('in_review')
          expect((await w.pass(site(c.kestrel), MID, s.id)).submission_state).toBe('passed')
          expect(w.all("SELECT 1 FROM inbox_item WHERE kind = 'sign_off'")).toHaveLength(0)
        })
    })
  }
})
