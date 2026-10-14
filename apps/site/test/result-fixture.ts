// The staging world (test/node-fixture.ts) with "minecraft in doom" passed through core (go-live 5.7): @kestrel's agent
// submits v1.0 built on @finn_irl's heads-up, @lumpy posts the run, @marceline the human people check, and @myra, the
// author, signs off. A few upvotes go in through core and the stats job rolls them up, as on staging.
// Its branch "block placement" is still live under it, #2 in review at three of four checks (seed/example.ts; a branch
// has no sign-off, decided Oct 13), and is locked once the shwarm passed (OPEN #92).
import type { CheckResult } from '../src/core/checking'
import type { Command } from '../src/core/engine'
import { TreeEngine } from '../src/core/engine'
import { rollupStats } from '../src/jobs/stats'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { agent, MIN, site, stepped, type P } from './core-fixtures'
import { T0 } from './d1'
import { stagingWorld } from './node-fixture'

export const PK3 = { url: 'https://zenodo.org/records/17346201/files/mcdoom-v1.pk3', sha256: '9c4e07b2'.padEnd(60, '0') + 'a71f', label: 'mcdoom-v1.pk3' }
export const SOURCE = { repo: 'https://codeberg.org/kestrel/mcdoom', commit: 'e9b41d0'.padEnd(40, '0') }
export const RECORDING = { url: 'https://archive.org/download/mcdoom-checks/e1m1-e1m6.mp4', sha256: '7'.repeat(64), label: 'recording' }
export const RELEASE = { name: 'minecraft in doom v1.0', version: 'v1.0', howToUse: 'uzdoom -iwad freedoom1.wad -file mcdoom-v1.pk3' }
export const PLAYTEST = { url: 'https://archive.org/download/doom-blocks-checks/corner-playtest.mp4', sha256: '5'.repeat(64), label: 'corner-playtest.mp4' }

type Run = <T = any>(cmd: Command) => Promise<T>
/** What `before` gets: the engine on the fixture's clock, people by handle, and the database. */
export type Acts = { run: Run; p: (handle: string) => P; db: Awaited<ReturnType<typeof stagingWorld>>['db'] }

/**
 * `before` runs its acts on the tree before the shwarm passes: once it passed, its branches are locked with it
 * (core/context.ts needLive, OPEN #92), so a branch's own run has to come first.
 */
export async function closedWorld(o: { extra?: string[]; before?: (x: Acts) => Promise<unknown> } = {}) {
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
      text: "a uzdoom mod: freedoom's first nine maps rebuilt from blocks. dig through any wall, craft from what you mine, and blow up the exploding imp. freedoom and other open assets only. 61 fps on the reference rig.",
      links: [PK3, SOURCE],
      howToCheck: 'run ./bench.sh, ./demos.sh and ./license-scan.sh mcdoom-v1.pk3, then play e1m1 and one later map from a pistol start for 15 minutes each.',
      builtOn: [{ post: heads, note: 'root cause' }],
      release: RELEASE,
    },
  })
  await run({
    type: 'check',
    actor: site(p('lumpy')),
    input: { node: EXAMPLE_ROOT, on: sub.id, slot: 'run', submissionHash: sub.hash.slice(0, 7), scriptHash: '5d02b7e', exit: 0, log: 'bench.sh: min 61 fps\ndemos.sh: 9 of 9 maps reached the exit\nlicense-scan.sh: clean\nexit 0', env: 'linux, ryzen 5 3600, gtx 1660' },
  })
  await run({ type: 'check', actor: site(p('marceline')), input: { node: EXAMPLE_ROOT, on: sub.id, verdict: 'pass', text: 'played e1m1 and e1m6 from a pistol start, 15 minutes each: dug through walls, crafted a door, blew up every monster, the exploding imp too.', evidence: [RECORDING] } })
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

/**
 * For `before`: the people check block placement's #2 waits on (seed/example.ts). @bmo_fan plays it, as their pinned
 * status update says, and #2 passes its checks. The branch stays live (decided Oct 13: its pass is its status vote), so
 * nothing closes and no pass notice goes out; it's locked only once the shwarm above it passed.
 */
export async function branchPassesItsChecks({ run, p, db }: Acts): Promise<CheckResult> {
  const two = (db.raw.prepare('SELECT s.post_id FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.number = 2').get(EXAMPLE_BRANCH) as { post_id: string }).post_id
  return run<CheckResult>({
    type: 'check',
    actor: site(p('bmo_fan')),
    input: { node: EXAMPLE_BRANCH, on: two, verdict: 'pass', text: 'played it tonight: 200 placements on every corner of every chunk. none vanished, and i never walked through one.', evidence: [PLAYTEST] },
  })
}
