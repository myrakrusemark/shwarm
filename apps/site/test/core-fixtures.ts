// Fixtures for the domain core tests: people, actors, an engine on a fixed clock, and a running example.
import { keyActor, siteActor, type Actor, type Perm } from '../src/core/actor'
import { TreeEngine, type Command } from '../src/core/engine'
import { addPerson, T0, testDb } from './d1'

export { T0 }
export const MIN = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000

export type P = { id: number; handle: string }

/** A verified person; founding (so established) unless told otherwise. */
export async function person(db: D1Database, handle: string, o: { founding?: boolean; establishedAt?: string | null; verified?: boolean } = {}): Promise<P> {
  const id = await addPerson(db, handle)
  await db
    .prepare('UPDATE person SET email_verified_at = ?, founding = ?, established_at = ? WHERE id = ?')
    .bind(o.verified === false ? null : new Date(T0).toISOString(), o.founding === false ? 0 : 1, o.establishedAt ?? null, id)
    .run()
  return { id, handle }
}

export const site = (p: P): Actor => siteActor(p)
/** The site actor with the password just re-entered: sign-off, dead ends and re-pitches need it (A5). */
export const stepped = (p: P): Actor => siteActor(p, { steppedUp: true })
export const agent = (p: P, path = 'm-04', perms: Perm[] = ['read', 'post', 'submit', 'check', 'branch'], node = '*'): Actor =>
  keyActor(p, `@${p.handle}/${path}`, { id: `${p.handle}-key`, canPostAs: `@${p.handle}/*`, grants: [{ node, perms }] })

export const SHA = (c: string) => c.repeat(64).slice(0, 64)
export const COMMIT = 'a'.repeat(40)
export const WORK = [{ url: 'https://codeberg.org/myra/doom-blocks/raw/branch/fixes/corner-fix.diff', sha256: SHA('3f') }]
export const EVIDENCE = [{ url: 'https://archive.org/download/doom-blocks-checks/rerun.mp4', sha256: SHA('2d') }]

export class World {
  now = T0
  db: D1Database & { raw: any }
  engine: TreeEngine
  constructor() {
    this.db = testDb()
    this.engine = new TreeEngine(this.db, () => this.now)
  }
  run<T = any>(cmd: Command): Promise<T> {
    return this.engine.run(cmd) as Promise<T>
  }
  tick(ms: number) {
    this.now += ms
  }
  all<T = any>(sql: string, ...args: unknown[]): T[] {
    return this.db.raw.prepare(sql).all(...args).map((r: any) => ({ ...r }))
  }
  get<T = any>(sql: string, ...args: unknown[]): T {
    const r = this.db.raw.prepare(sql).get(...args)
    return r && { ...r }
  }
  events(path: string, event?: string): any[] {
    return this.all(
      `SELECT a.* FROM audit_event a JOIN node n ON n.id = a.node_id WHERE n.path = ? ${event ? 'AND a.event = ?' : ''} ORDER BY a.rowid`,
      ...(event ? [path, event] : [path]),
    )
  }
  node(path: string): any {
    return this.get('SELECT * FROM node WHERE path = ?', path)
  }
  sub(id: string): any {
    return this.get('SELECT * FROM submission WHERE post_id = ?', id)
  }

  // ---- shortcuts for the running example ----
  shwarm(by: Actor, o: Partial<{ title: string; check: unknown; license: string; tags: string[]; buildsOn: unknown }> = {}) {
    return this.run({
      type: 'createNode',
      actor: by,
      input: {
        kind: 'shwarm',
        title: o.title ?? 'minecraft in doom',
        what: "this one is for fun, and anyone can play it free: no copy of doom or minecraft needed.",
        doneWhen: "a downloadable uzdoom mod rebuilds freedoom phase 1 maps e1m1 to e1m9 entirely from blocks, where every wall can be dug out, gathered blocks can be placed again or crafted with at least 10 recipes, guns you pick up sit in a minecraft-style inventory, and freedoom's monsters fight beside at least 4 new blocky ones drawn fresh, including an imp that explodes and blows holes in block walls; each map can be finished from a pistol start on skill 3, it holds 60 fps on the reference rig (a ryzen 5 3600 with a gtx 1660 at 1080p), and it uses only freedoom and other open assets.",
        check: o.check ?? { author: true },
        tags: o.tags ?? ['#games', '#gzdoom'],
        ...(o.license !== undefined ? { license: o.license } : {}),
        ...(o.buildsOn !== undefined ? { buildsOn: o.buildsOn as any } : {}),
      },
    })
  }
  branch(by: Actor, parent: string, o: Partial<{ title: string; check: unknown }> = {}) {
    return this.run({
      type: 'createNode',
      actor: by,
      input: {
        kind: 'branch',
        parent,
        title: o.title ?? 'block placement',
        what: 'blocks place and break on any face.',
        doneWhen: "blocks place and break on any face, including chunk edges and corners, and the player can't walk through them.",
        check: o.check ?? { author: true },
      },
    })
  }
  join(by: Actor, node: string) {
    return this.run({ type: 'join', actor: by, input: { node } })
  }
  post(by: Actor, node: string, text = 'reproduced it. the chunk lookup, not the sight check.', extra: Record<string, unknown> = {}) {
    return this.run({ type: 'post', actor: by, input: { node, text, ...extra } })
  }
  submit(by: Actor, node: string, text = 'two-line fix on top of #1.', extra: Record<string, unknown> = {}) {
    return this.run({ type: 'submit', actor: by, input: { node, text, links: WORK, howToCheck: 'place 200 times per corner. expect 0 failures.', ...extra } })
  }
  pass(by: Actor, node: string, on: string, extra: Record<string, unknown> = {}) {
    return this.run({ type: 'check', actor: by, input: { node, on, verdict: 'pass', evidence: EVIDENCE, ...extra } })
  }
  fail(by: Actor, node: string, on: string, extra: Record<string, unknown> = {}) {
    return this.run({ type: 'check', actor: by, input: { node, on, verdict: 'fail', repro: { steps: 'place on corner 3. the block vanishes.' }, ...extra } })
  }
  /** The author's sign-off: asked for by name, on the site, stepped up. A pass says what was checked; a fail carries a repro. */
  signOff(by: P | Actor, node: string, on: string, verdict: 'pass' | 'fail' = 'pass', extra: Record<string, unknown> = {}) {
    const actor = 'via' in by ? by : stepped(by)
    const backing = verdict === 'pass' ? { text: 'played it for 10 minutes, no stutter' } : { repro: { steps: 'place on corner 3. the block vanishes.' } }
    return this.run({ type: 'check', actor, input: { node, on, slot: 'author', verdict, ...backing, ...extra } })
  }
  deadEnd(by: P | Actor, node: string, note = 'the engine cannot do it') {
    return this.run({ type: 'deadEnd', actor: 'via' in by ? by : stepped(by), input: { node, note } })
  }
  runReport(by: Actor, node: string, on: string, hash: string, exit = 0, extra: Record<string, unknown> = {}) {
    return this.run({
      type: 'check',
      actor: by,
      input: { node, on, slot: 'run', submissionHash: hash.slice(0, 7), scriptHash: '5d02b7e', exit, log: `soak.sh: 10000 placements\nexit ${exit}`, env: 'linux, rtx 3060', ...extra },
    })
  }
}

/** Expect a ShwarmError with this code (and optionally these details). */
export async function refused(p: Promise<unknown>, code: string, details?: Record<string, unknown>) {
  try {
    await p
  } catch (e: any) {
    if (e?.code !== code) throw new Error(`expected ${code}, got ${e?.code ?? e}: ${e?.message}`)
    if (details) for (const [k, v] of Object.entries(details)) if (JSON.stringify(e.details[k]) !== JSON.stringify(v)) throw new Error(`${code}.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(e.details[k])}`)
    return e
  }
  throw new Error(`expected ${code}, but it went through`)
}
