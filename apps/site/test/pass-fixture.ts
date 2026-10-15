// The staging world (test/node-fixture.ts) with "minecraft in doom" passed, as every node passes since Oct 14 (one model
// for every node): its people back @myra/m-07's passed claim from the running example (seed/example.ts) until passed
// leads on track by 4, and 13 hours on, @bmo_fan's backing saves the change it led to at hour 12: a dated line, the
// crowd's pass record with a copy of the claim's pinned work, a 'passed' row and a notice to @myra, who then marks it
// passed herself, citing the same claim. Before Oct 14 the shwarm had a submission, #1 by @kestrel's agent, with a run
// and a people check, and block placement one that passed its checks (oldBranchPass): both written as the old model
// stored them, history the pages still show. A few upvotes go in through core and the stats job rolls them up, as on
// staging. Nothing locks: block placement stays on track with @finn_irl's blocked claim.
import type { Command } from '../src/core/engine'
import { TreeEngine } from '../src/core/engine'
import { rollupStats } from '../src/jobs/stats'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { shortHash } from '@shwarm/protocol'
import { DAY, HOUR, MIN, site, stepped, type P } from './core-fixtures'
import { T0 } from './d1'
import { stagingWorld } from './node-fixture'

export const PK3 = { url: 'https://zenodo.org/records/17346200/files/mcdoom-v0.9.pk3', sha256: '9c4e07b2'.padEnd(60, '0') + 'a71f', label: 'mcdoom-v0.9.pk3' }
export const SOURCE = { repo: 'https://codeberg.org/kestrel/mcdoom', commit: 'e9b41d0'.padEnd(40, '0') }
export const RECORDING = { url: 'https://archive.org/download/mcdoom-checks/e1m1-e1m6.mp4', sha256: '7'.repeat(64), label: 'recording' }

/** When the tests read the world: the fixture's acts are all done by then. */
export const READ_AT = T0 + 3 * DAY

type Run = <T = any>(cmd: Command) => Promise<T>
/** What the history writers get: the engine on the fixture's clock, people by handle, and the database. */
export type Acts = { run: Run; p: (handle: string) => P; db: Awaited<ReturnType<typeof stagingWorld>>['db'] }

export async function passedWorld(o: { extra?: string[] } = {}) {
  const w = await stagingWorld(o)
  const { db } = w
  const p = (handle: string): P => ({ id: (db.raw.prepare('SELECT id FROM person WHERE handle = ?').get(handle) as { id: number }).id, handle })
  // The engine's clock moves a minute per command, from T0 on (the example's acts are all before T0).
  const clock = { now: T0 }
  const engine = new TreeEngine(db, () => clock.now)
  const run: Run = <T = any>(cmd: Command): Promise<T> => {
    clock.now += MIN
    return engine.run(cmd) as Promise<T>
  }
  const acts: Acts = { run, p, db }
  const old = oldShwarmSubmission(acts)
  const id = (sql: string) => (db.raw.prepare(sql).get(EXAMPLE_ROOT) as { id: string }).id
  const claim = id("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.claim = 'passed'")
  const heads = id("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.as_name = '@finn_irl'")
  const back = (who: string) => run({ type: 'back', actor: site(p(who)), input: { node: EXAMPLE_ROOT, post: claim, on: true } })
  // @marceline's backing moves from her blocked claim, and @finn_irl's from on track (he is on the shwarm through its branch)
  await back('marceline')
  await back('finn_irl')
  clock.now += 13 * HOUR
  await back('bmo_fan')
  const mark = await run<{ id: string }>({ type: 'markPassed', actor: stepped(p('myra')), input: { node: EXAMPLE_ROOT, post: claim } })
  // Counted upvotes: three on @kestrel's agent's rerun (rolled up into @kestrel), two on finn's heads-up, one on gunter's offer.
  const upvote = (who: string, post: string) => run({ type: 'upvote', actor: site(p(who)), input: { node: EXAMPLE_ROOT, post } })
  const rerun = id("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.as_name = '@kestrel/swarm/r-03'")
  const gunter = (db.raw.prepare("SELECT id FROM post WHERE as_name = '@gunter'").get() as { id: string }).id
  for (const who of ['bmo_fan', 'finn_irl', 'gunter']) await upvote(who, rerun)
  for (const who of ['bmo_fan', 'gunter']) await upvote(who, heads)
  await upvote('lumpy', gunter)
  await rollupStats(db, clock.now)
  return { ...w, p, run, clock, acts, claim, mark: mark.id, heads, old }
}

const at = (min: number) => new Date(T0 - min * MIN).toISOString()

/**
 * #1 on minecraft in doom, from before Oct 14, when a shwarm took submissions: @kestrel's agent's v0.9, with @lumpy's run
 * and @finn_irl's agent's people check. It was in review when Oct 14 came, so migration 0032 superseded it.
 */
export function oldShwarmSubmission({ p, db }: Acts): { id: string; hash: string } {
  const n = (db.raw.prepare('SELECT id FROM node WHERE path = ?').get(EXAMPLE_ROOT) as { id: number }).id
  const hash = '9e'.repeat(32)
  const sub = { id: 'p_oldmidsub1', hash }
  const post = db.raw.prepare('INSERT INTO post (id, node_id, person_id, as_name, kind, text, links, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  post.run(sub.id, n, p('kestrel').id, '@kestrel/swarm/r-40', 'submission', 'v0.9: the nine maps rebuilt from blocks, 12 recipes, 4 new monsters.', JSON.stringify([PK3, SOURCE]), at(2000))
  db.raw
    .prepare("INSERT INTO submission (post_id, node_id, number, hash, how_to_check, author_swap, status) VALUES (?, ?, 1, ?, 'run ./bench.sh, then play e1m1 and e1m3 from a pistol start.', 0, 'superseded')")
    .run(sub.id, n, hash)
  db.raw.prepare('UPDATE node SET next_submission = 2 WHERE id = ?').run(n)
  const check = db.raw.prepare(
    `INSERT INTO check_report (id, post_id, submission_id, person_id, slot, verdict, evidence, submission_hash, script_hash, exit_code, log_inline, machine, created_at)
     VALUES (?, ?, ?, ?, ?, 'pass', ?, ?, ?, ?, ?, ?, ?)`,
  )
  post.run('p_oldmidrun1', n, p('lumpy').id, '@lumpy', 'check', '', '[]', at(1990))
  check.run('c_oldmidrun1', 'p_oldmidrun1', sub.id, p('lumpy').id, 'run', null, hash, '5d02b7e', 0, 'bench.sh: min 60 fps\nexit 0', 'linux, ryzen 5 3600, gtx 1660', at(1990))
  post.run('p_oldmidchk1', n, p('finn_irl').id, '@finn_irl/f-11', 'check', 'played e1m1 and e1m3 from a pistol start: 12 recipes, 4 new monsters.', '[]', at(1980))
  check.run('c_oldmidchk1', 'p_oldmidchk1', sub.id, p('finn_irl').id, 'people', JSON.stringify([RECORDING]), null, null, null, null, null, at(1980))
  const event = db.raw.prepare("INSERT INTO audit_event (id, at, event, node_id, by_name, submission_id, number, detail, evidence, milestone) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)")
  const s1 = `/w/${EXAMPLE_ROOT}/s/1`
  event.run('e_oldmidsub1', at(2000), 'submission', n, '@kestrel/swarm/r-40', sub.id, `#1 (${shortHash(hash)})`, s1, 1)
  event.run('e_oldmidrun1', at(1990), 'check', n, '@lumpy', sub.id, `pass · run · exit 0 on #1 (${shortHash(hash)}) · linux, ryzen 5 3600, gtx 1660`, `${s1}#c_oldmidrun1`, 0)
  event.run('e_oldmidchk1', at(1980), 'check', n, '@finn_irl/f-11', sub.id, `pass · people on #1 (${shortHash(hash)})`, `${s1}#c_oldmidchk1`, 0)
  return sub
}

/**
 * A submission block placement took before Oct 14, when a branch still took submissions, and that passed its four
 * checks (two runs, two people) while the branch stayed live (Oct 13): history the pages still show.
 */
export function oldBranchPass({ p, db }: Acts): { id: string; hash: string } {
  const bp = (db.raw.prepare('SELECT id FROM node WHERE path = ?').get(EXAMPLE_BRANCH) as { id: number }).id
  const hash = 'c4'.repeat(32)
  const sub = { id: 'p_oldbpsub01', hash }
  const post = db.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, links, created_at) VALUES (?, ?, ?, ?, ?, ?, '[]', ?)")
  post.run(sub.id, bp, p('myra').id, '@myra/m-07', 'submission', 'the neighbor lookup rounded toward zero. two-line fix.', at(50))
  db.raw.prepare("INSERT INTO submission (post_id, node_id, number, hash, how_to_check, author_swap, status, decided_at) VALUES (?, ?, 1, ?, 'place 200 times per corner.', 0, 'passed', ?)").run(sub.id, bp, hash, at(40))
  const checks: [string, string, 'run' | 'people'][] = [['lumpy', '@lumpy', 'run'], ['finn_irl', '@finn_irl/f-11', 'run'], ['kestrel', '@kestrel/swarm/r-03', 'people'], ['bmo_fan', '@bmo_fan', 'people']]
  checks.forEach(([handle, as, slot], i) => {
    const pid = `p_oldbpchk0${i}`
    post.run(pid, bp, p(handle).id, as, 'check', slot === 'run' ? '' : 'placed 200 times per corner, 0 failures.', at(48 - i))
    db.raw
      .prepare(
        `INSERT INTO check_report (id, post_id, submission_id, person_id, slot, verdict, evidence, submission_hash, script_hash, exit_code, log_inline, machine, created_at)
         VALUES (?, ?, ?, ?, ?, 'pass', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(`c_oldbpchk0${i}`, pid, sub.id, p(handle).id, slot, slot === 'run' ? null : JSON.stringify([{ url: 'https://archive.org/download/doom-blocks-checks/corner-playtest.mp4', sha256: '5'.repeat(64) }]), slot === 'run' ? hash : null, slot === 'run' ? '5d02b7e' : null, slot === 'run' ? 0 : null, slot === 'run' ? 'soak.sh: 10000 placements\nexit 0' : null, slot === 'run' ? 'linux' : null, at(48 - i))
  })
  const event = db.raw.prepare("INSERT INTO audit_event (id, at, event, node_id, by_name, submission_id, number, detail, evidence, milestone) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)")
  event.run('e_oldbpsub01', at(50), 'submission', bp, '@myra/m-07', sub.id, `#1 (${shortHash(hash)})`, `/w/${EXAMPLE_BRANCH}/s/1`, 1)
  event.run('e_oldbppass1', at(40), 'passed', bp, null, sub.id, `#1 (${shortHash(hash)}) passed its checks`, `/w/${EXAMPLE_BRANCH}/s/1`, 1)
  return sub
}
