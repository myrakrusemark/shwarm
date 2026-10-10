// The staging world (test/node-fixture.ts) with "minecraft in doom" passed through core (go-live 5.7): @kestrel's agent
// submits v1.0 built on @finn_irl's heads-up, @lumpy posts the run, @marceline the human people check, and @myra, the
// author, signs off. A few upvotes go in through core and the stats job rolls them up, as on staging.
import type { Command } from '../src/core/engine'
import { TreeEngine } from '../src/core/engine'
import { rollupStats } from '../src/jobs/stats'
import { EXAMPLE_ROOT } from '../src/seed/example'
import { agent, MIN, site, stepped, type P } from './core-fixtures'
import { T0 } from './d1'
import { stagingWorld } from './node-fixture'

export const PK3 = { url: 'https://zenodo.org/records/17346201/files/mcdoom-v1.pk3', sha256: '9c4e07b2'.padEnd(60, '0') + 'a71f', label: 'mcdoom-v1.pk3' }
export const SOURCE = { repo: 'https://codeberg.org/kestrel/mcdoom', commit: 'e9b41d0'.padEnd(40, '0') }
export const RECORDING = { url: 'https://archive.org/download/mcdoom-checks/bunker.mp4', sha256: '7'.repeat(64), label: 'recording' }
export const RELEASE = { name: 'minecraft in doom v1.0', version: 'v1.0', howToUse: 'uzdoom -iwad freedoom2.wad -file mcdoom-v1.pk3' }

type Run = <T = any>(cmd: Command) => Promise<T>

/**
 * `before` runs its acts on the tree before the shwarm passes: once it passed, its branches are locked with it
 * (core/context.ts needLive, OPEN #92), so a branch's own run has to come first.
 */
export async function closedWorld(o: { extra?: string[]; before?: (x: { run: Run; p: (handle: string) => P; db: Awaited<ReturnType<typeof stagingWorld>>['db'] }) => Promise<void> } = {}) {
  const w = await stagingWorld(o)
  const { db } = w
  const p = (handle: string): P => ({ id: (db.raw.prepare('SELECT id FROM person WHERE handle = ?').get(handle) as { id: number }).id, handle })
  // The engine's clock moves a minute per command, from T0 on (the example's events are all before T0).
  const clock = { now: T0 }
  const engine = new TreeEngine(db, () => clock.now)
  const run: Run = <T = any>(cmd: Command): Promise<T> => {
    clock.now += MIN
    return engine.run(cmd) as Promise<T>
  }
  await o.before?.({ run, p, db })
  const heads = (db.raw.prepare("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.as_name = '@finn_irl'").get(EXAMPLE_ROOT) as { id: string }).id
  const sub = await run<{ id: string; number: number; hash: string }>({
    type: 'submit',
    actor: agent(p('kestrel'), 'swarm/r-40'),
    input: {
      node: EXAMPLE_ROOT,
      text: 'a uzdoom mod: dig, place and break blocks, build while imps hunt you. freedoom assets only. 61 fps on the reference rig.',
      links: [PK3, SOURCE],
      howToCheck: 'run ./bench.sh and ./license-scan.sh mcdoom-v1.pk3, then play the test map for 10 minutes.',
      builtOn: [{ post: heads, note: 'root cause' }],
      release: RELEASE,
    },
  })
  await run({
    type: 'check',
    actor: site(p('lumpy')),
    input: { node: EXAMPLE_ROOT, on: sub.id, slot: 'run', submissionHash: sub.hash.slice(0, 7), scriptHash: '5d02b7e', exit: 0, log: 'bench.sh: min 61 fps\nlicense-scan.sh: clean\nexit 0', env: 'linux, rtx 3060' },
  })
  await run({ type: 'check', actor: site(p('marceline')), input: { node: EXAMPLE_ROOT, on: sub.id, verdict: 'pass', text: 'played 10 minutes, dug to y=-80, built a bunker under fire.', evidence: [RECORDING] } })
  await run({ type: 'check', actor: stepped(p('myra')), input: { node: EXAMPLE_ROOT, on: sub.id, slot: 'author', verdict: 'pass', text: "played it for an hour with my kid. it's what we wanted." } })
  // Counted upvotes: three on the agent's submission (rolled up into @kestrel), two on finn's heads-up, one on gunter's offer.
  const upvote = (who: string, post: string) => run({ type: 'upvote', actor: site(p(who)), input: { node: EXAMPLE_ROOT, post } })
  const gunter = (db.raw.prepare("SELECT id FROM post WHERE as_name = '@gunter'").get() as { id: string }).id
  for (const who of ['bmo_fan', 'finn_irl', 'gunter']) await upvote(who, sub.id)
  for (const who of ['bmo_fan', 'gunter']) await upvote(who, heads)
  await upvote('lumpy', gunter)
  await rollupStats(db, clock.now)
  return { ...w, p, run, clock, sub, heads }
}
