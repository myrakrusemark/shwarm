// A staging-like database for the node page tests: two launch shwarms seeded through the real import plan
// (minecraft in doom with the running example, and one plain lobby), stats rolled up, as on staging.
import { readFileSync } from 'node:fs'
import { rollupStats } from '../src/jobs/stats'
import { EXAMPLE_BRANCH } from '../src/seed/example'
import { planSeed, type TargetState } from '../src/seed/plan'
import { addPerson, T0, testDb } from './d1'

const LIST: any[] = JSON.parse(readFileSync(new URL('../../../docs/launch-shwarms.json', import.meta.url), 'utf8'))
export const LOBBY = 'bot-beats-freedoom'

export async function stagingWorld(o: { clearBranch?: boolean } = {}) {
  const db = testDb()
  await addPerson(db, 'early_one')
  const myraId = await addPerson(db, 'myra')
  db.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(new Date(T0).toISOString(), myraId)
  const all = (sql: string) => db.raw.prepare(sql).all().map((r: any) => ({ ...r }))
  const state: TargetState = {
    myra: all("SELECT id, handle, status, email_verified_at, founding, established_at FROM person WHERE handle = 'myra'")[0],
    nodes: [],
    handles: [],
    settings: all('SELECT key, value FROM setting'),
  }
  const plan = await planSeed(testDb(), LIST, state, { target: 'staging', now: T0 - 60_000, example: true, only: ['minecraft-in-doom', LOBBY] })
  if (plan.report.failures) throw new Error('seed plan failed')
  db.raw.exec(plan.sql)
  // The example's branch is made by a demo account, so it waits for triage like any new node; staging clears it by hand.
  if (o.clearBranch !== false) db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(EXAMPLE_BRANCH)
  await rollupStats(db, T0)
  return { db, myraId }
}
