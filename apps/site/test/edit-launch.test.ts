// The launch edits (card fixes, Oct 11; scripts/edit-launch.ts, src/seed/edit.ts): editNode run as @myra on a copy,
// written out as SQL, applied to a seeded target, lands exactly as the core edit does, and refuses a locked node.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { checkArgs, parseArgs, Refused } from '../../../scripts/edit-launch'
import { siteActor } from '../src/core/actor'
import { TreeEngine } from '../src/core/engine'
import { editInputOf, planEdits, type EditState } from '../src/seed/edit'
import { mapLaunchShwarm } from '../src/seed/launch'
import { planSeed, type TargetState } from '../src/seed/plan'
import { addPerson, T0, testDb } from './d1'

const LIST: any[] = JSON.parse(readFileSync(new URL('../../../docs/launch-shwarms.json', import.meta.url), 'utf8'))
const SLUGS = ['bot-beats-freedoom', 'kart-race-on-the-moon', 'libreoffice-screen-reader-labels']
const LATER = T0 + 3_600_000

const all = (db: any, sql: string, ...args: unknown[]) => db.raw.prepare(sql).all(...args).map((r: any) => ({ ...r }))

/** The launch list as it stood before the fixes: older words for the three slugs. */
const OLD = LIST.map(e =>
  SLUGS.includes(e.slug)
    ? { ...e, done_when: e.done_when + ' (old words)', license: undefined, builds_on: e.slug === 'libreoffice-screen-reader-labels' ? 'libreoffice, https://git.libreoffice.org/core' : e.builds_on }
    : e,
).map(e => (e.license === undefined ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'license')) : e))

/** A staging-like target with the old words seeded, and every node cleared by triage. */
async function seeded() {
  const db: any = testDb()
  await addPerson(db, 'early_one')
  const myraId = await addPerson(db, 'myra')
  db.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(new Date(T0).toISOString(), myraId)
  const st: TargetState = {
    myra: all(db, "SELECT id, handle, status, email_verified_at, founding, established_at FROM person WHERE handle = 'myra'")[0],
    nodes: [],
    handles: [],
    settings: all(db, 'SELECT key, value FROM setting'),
  }
  const plan = await planSeed(testDb(), OLD, st, { target: 'staging', now: T0, example: false, only: SLUGS })
  expect(plan.report.failures).toBe(0)
  return { db, myraId, sql: plan.sql }
}

function finish(db: any, sql: string) {
  db.raw.exec(sql)
  db.raw.exec("UPDATE node SET triage = 'clear'")
}

/** What scripts/edit-launch.ts reads from the target, from a test database. */
function stateOf(db: any, slugs: string[]): EditState {
  const tree = `SELECT id FROM node WHERE path IN (${slugs.map(s => `'${s}'`).join(', ')}) OR root_id IN (SELECT id FROM node WHERE path IN (${slugs.map(s => `'${s}'`).join(', ')}))`
  const myra = all(db, "SELECT id, handle, status, email_verified_at, founding, established_at, is_admin FROM person WHERE handle = 'myra'")[0]
  return {
    myra,
    nodes: all(db, `SELECT * FROM node WHERE id IN (${tree})`),
    tags: all(db, `SELECT * FROM node_tag WHERE node_id IN (${tree}) ORDER BY rowid`),
    seats: all(db, `SELECT * FROM seat WHERE node_id IN (${tree})`),
    submissions: all(db, `SELECT * FROM submission WHERE node_id IN (${tree})`),
    buckets: all(db, "SELECT * FROM rate_bucket WHERE bucket LIKE 'thread:%'"),
    settings: all(db, 'SELECT key, value FROM setting'),
  }
}

const strip = (rows: any[], drop: string[]) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))))

describe('the launch edits', () => {
  test('the plan, applied, lands as the core edit does: new words, the old version in node_edit, triage again', async () => {
    const a = await seeded()
    const b = await seeded()
    finish(a.db, a.sql)
    finish(b.db, a.sql) // the same seed SQL, so both targets start identical

    const plan = await planEdits(testDb(), LIST, stateOf(a.db, SLUGS), { target: 'staging', now: LATER, slugs: SLUGS })
    expect(plan.problems).toEqual([])
    expect(plan.reports.map(r => r.status)).toEqual(['edit', 'edit', 'edit'])
    a.db.raw.exec(plan.sql)

    // The same edits through core, as the /new form's edit runs them.
    const engine = new TreeEngine(b.db, () => LATER, { beta: true })
    for (const s of SLUGS) await engine.run({ type: 'editNode', actor: siteActor({ id: b.myraId, handle: 'myra' }, { steppedUp: true }), input: editInputOf(LIST.find(e => e.slug === s)).input! })

    const nodes = (db: any) => strip(all(db, 'SELECT * FROM node ORDER BY id'), ['last_event_id'])
    expect(nodes(a.db)).toEqual(nodes(b.db))
    const edits = (db: any) => strip(all(db, 'SELECT * FROM node_edit ORDER BY id'), ['id'])
    expect(edits(a.db)).toEqual(edits(b.db))
    expect(edits(a.db)).toHaveLength(3)
    expect(all(a.db, 'SELECT * FROM rate_bucket ORDER BY bucket')).toEqual(all(b.db, 'SELECT * FROM rate_bucket ORDER BY bucket'))

    const row = (p: string) => all(a.db, 'SELECT * FROM node WHERE path = ?', p)[0]
    for (const s of SLUGS) {
      expect(row(s).done_when).toBe(mapLaunchShwarm(LIST.find(e => e.slug === s)).input.doneWhen)
      expect(row(s).triage).toBe('pending') // checked again; seeded, so still public while it is
      expect(row(s).triage_since).toBe(new Date(LATER).toISOString())
    }
    expect(row('kart-race-on-the-moon').license).toBe('CC-BY-SA-4.0')
    expect(row('libreoffice-screen-reader-labels').license).toBe('MPL-2.0')
    expect(JSON.parse(row('libreoffice-screen-reader-labels').builds_on)).toEqual({ name: 'libreoffice', url: 'https://git.libreoffice.org/core', license: 'MPL-2.0' })
    expect(all(a.db, "SELECT done_when FROM node_edit WHERE done_when LIKE '%(old words)'")).toHaveLength(3)

    // Planned again: nothing changes.
    const again = await planEdits(testDb(), LIST, stateOf(a.db, SLUGS), { target: 'staging', now: LATER + 60_000, slugs: SLUGS })
    expect(again.reports.map(r => r.status)).toEqual(['unchanged', 'unchanged', 'unchanged'])
    expect(again.sql).toBe('')
  })

  test('a node someone else joined, or one with a submission under it, is refused and left out of the file', async () => {
    const t = await seeded()
    finish(t.db, t.sql)
    const other = await addPerson(t.db, 'tester')
    const kart = all(t.db, "SELECT id FROM node WHERE path = 'kart-race-on-the-moon'")[0].id
    t.db.raw.prepare('INSERT INTO seat (node_id, person_id, number, joined_at) VALUES (?, ?, 2, ?)').run(kart, other, new Date(T0).toISOString())
    const plan = await planEdits(testDb(), LIST, stateOf(t.db, SLUGS), { target: 'staging', now: LATER, slugs: SLUGS })
    expect(plan.reports.find(r => r.slug === 'kart-race-on-the-moon')).toMatchObject({ status: 'refused', error: expect.stringContaining('someone else joined') })
    expect(plan.edited).toEqual(['bot-beats-freedoom', 'libreoffice-screen-reader-labels'])
    expect(plan.sql).not.toContain("'kart-race-on-the-moon'")
  })

  test('the file stops at its guards when a node moved after the plan read it', async () => {
    const t = await seeded()
    finish(t.db, t.sql)
    const plan = await planEdits(testDb(), LIST, stateOf(t.db, SLUGS), { target: 'staging', now: LATER, slugs: SLUGS })
    t.db.raw.exec("UPDATE node SET last_event_id = 'v_moved' WHERE path = 'bot-beats-freedoom'")
    expect(() => t.db.raw.exec(plan.sql)).toThrow()
    expect(all(t.db, 'SELECT * FROM node_edit')).toHaveLength(0)
  })

  test('a slug the target lacks is reported missing; production needs its flag and a terminal', async () => {
    const t = await seeded()
    finish(t.db, t.sql)
    const plan = await planEdits(testDb(), LIST, stateOf(t.db, ['bot-beats-freedoom', 'all-of-linux-in-rust']), { target: 'staging', now: LATER, slugs: ['bot-beats-freedoom', 'all-of-linux-in-rust'] })
    expect(plan.reports.map(r => r.status)).toEqual(['edit', 'missing'])
    expect(() => checkArgs(parseArgs(['--target', 'production']), true)).toThrow(Refused)
    expect(() => checkArgs(parseArgs(['--target', 'production', '--allow-production']), false)).toThrow(/terminal/)
    expect(() => checkArgs(parseArgs(['--target', 'production', '--allow-production', '--dry-run']), false)).not.toThrow()
    expect(() => checkArgs(parseArgs(['--target', 'production', '--allow-production']), true)).not.toThrow()
    expect(() => checkArgs(parseArgs(['--target', 'staging', '--allow-production']), true)).toThrow(Refused)
  })
})
