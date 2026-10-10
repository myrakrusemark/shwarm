// The seed plan (go-live 3.1). Runs every create through core, as bare @myra with via 'seed' (A18), against a
// local copy of the target database, records each committed batch, and writes the batches out as one .sql file
// to apply with `wrangler d1 execute --file`. Nothing here talks to Cloudflare; scripts/seed-launch.ts does.
//
// The local copy holds what the plan needs to read: the @myra row (with its real id), the target's settings, and
// a stand-in for every node already there, with its real kind, state, license, hidden and paused, so slugs are
// checked against them (go-live 3.10, 11.1). Rows the plan creates
// get ids from a sentinel range and are written into the SQL as subqueries by path or handle (see sql.ts).
import type { Actor } from '../core/actor'
import { TreeEngine, type Command } from '../core/engine'
import { EXAMPLE_BRANCH, EXAMPLE_PEOPLE, EXAMPLE_ROOT, ROOT_AGE_MIN, runExample, type ExampleHandle } from './example'
import { mapLaunchShwarm, NOT_IMPORTED, type Note } from './launch'
import { recordingDb, type Recorded } from './recorder'
import { renderStatement, SENTINEL_MIN, sqlString, type IdMap } from './sql'

export type Target = 'offline' | 'local' | 'staging' | 'production'

export const PERSON_BASE = SENTINEL_MIN // 8e12: people the plan creates get ids above this
export const NODE_BASE = 9_000_000_000_000 // nodes the plan creates (and placeholders) get ids above this

export type PersonState = { id: number; handle: string; status: string; email_verified_at: string | null; founding: number; established_at: string | null }

/** A node already on the target: what core reads when a planned node names it (a slug it would take). */
export type ExistingNode = { path: string; kind: string; state: string; license: string; hidden: number; paused: number }

/** What the plan reads from the target first. */
export type TargetState = {
  myra: PersonState | null
  nodes: ExistingNode[] // every node already there
  handles: string[] // which of the example's handles are taken
  settings: { key: string; value: string }[]
}

export type SeedOptions = {
  target: Target
  now: number
  example: boolean // the running example (never on production)
  only?: string[] // slugs to import; required on production (3.10, 11.1)
}

export type ShwarmReport = { slug: string; wave: number | null; status: 'new' | 'exists' | 'failed'; notes: Note[] }
export type SeedReport = {
  target: Target
  shwarms: ShwarmReport[]
  example: { status: 'new' | 'exists' | 'skipped' | 'failed' | 'off'; notes: Note[] }
  problems: string[] // anything that stops the whole plan
  failures: number
}

export type SeedPlan = {
  report: SeedReport
  sql: string // the whole file; empty when there are failures
  statements: number
  newPaths: string[] // what the target should hold after the file is applied
  newHandles: string[]
}

const MYRA = 'myra'

/** Refuses production unless it's narrowed to named slugs, with no example. scripts/seed-launch.ts adds its own flag on top. */
export function checkTarget(o: SeedOptions): void {
  if (o.target === 'production') {
    if (!o.only?.length) throw new Error('production imports name their slugs: one approved shwarm at a time (go-live 3.10, 11.1)')
    if (o.example) throw new Error('the running example never goes to production')
  }
}

function personInsert(db: D1Database, handle: string, at: string, id?: number) {
  // Sign-in disabled: the hash names no algorithm, so verifyPassword says no. Mail to .invalid never leaves.
  const cols = 'handle, email, email_norm, email_verified_at, password_hash, status, founding, terms_version, terms_accepted_at, age_confirmed_at, created_at'
  const vals: unknown[] = [handle, `${handle}@example.invalid`, `${handle}@example.invalid`, at, '!seed: sign-in disabled', 'active', 1, '0.1', at, at, at]
  return id === undefined
    ? db.prepare(`INSERT INTO person (${cols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...vals)
    : db.prepare(`INSERT INTO person (id, ${cols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, ...vals)
}

async function setUpCopy(db: D1Database, state: TargetState, at: string): Promise<void> {
  const stmts: D1PreparedStatement[] = [
    // Anchors: a row at each base, so every row the plan creates gets an id above it.
    personInsert(db, 'seed_anchor', at, PERSON_BASE),
    db
      .prepare(
        `INSERT INTO node (id, path, slug, kind, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, hidden, created_at)
         VALUES (?, ':seed-anchor', 'seed-anchor', 'shwarm', 'x', 'x', 'x', '{}', 1, 'x', ?, '@seed_anchor', 'closed', 1, ?)`,
      )
      .bind(NODE_BASE, PERSON_BASE, at),
    ...state.settings.map(s =>
      db.prepare('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(s.key, s.value, at),
    ),
  ]
  if (state.myra) {
    const m = state.myra
    stmts.push(
      db
        .prepare(
          `INSERT INTO person (id, handle, email, email_norm, email_verified_at, password_hash, status, founding, established_at, terms_version, terms_accepted_at, age_confirmed_at, created_at)
           VALUES (?, ?, 'copy@example.invalid', 'copy@example.invalid', ?, '!', ?, ?, ?, '0.1', ?, ?, ?)`,
        )
        .bind(m.id, m.handle, m.email_verified_at, m.status, m.founding, m.established_at, at, at, at),
    )
  }
  // Nodes already on the target, as core would load them. Branches and the variants made before they were dropped
  // (Oct 9) point at the anchor, which the schema needs; their ids map back to the real rows by path when the SQL is written.
  for (const n of state.nodes)
    stmts.push(
      db
        .prepare(
          `INSERT INTO node (path, slug, kind, parent_id, variant_of_id, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, hidden, paused, dead_end_note, created_at)
           VALUES (?, ?, ?, ?, ?, 'x', 'x', 'x', '{}', 1, ?, ?, '@seed_anchor', ?, ?, ?, 'x', ?)`,
        )
        .bind(n.path, n.path.split('/').pop(), n.kind, n.kind === 'branch' ? NODE_BASE : null, n.kind === 'variant' ? NODE_BASE : null, n.license, PERSON_BASE, n.state, n.hidden ? 1 : 0, n.paused ? 1 : 0, at),
    )
  await db.batch(stmts)
}

const errText = (e: unknown) => {
  const x = e as { code?: string; message?: string }
  return x?.code ? `${x.code}: ${x.message}` : String(x?.message ?? e)
}

export async function planSeed(copy: D1Database, entries: unknown[], state: TargetState, o: SeedOptions): Promise<SeedPlan> {
  checkTarget(o)
  const at = new Date(o.now).toISOString()
  const report: SeedReport = { target: o.target, shwarms: [], example: { status: o.example ? 'skipped' : 'off', notes: [] }, problems: [], failures: 0 }
  const empty = (): SeedPlan => ({ report: { ...report, failures: report.failures + report.problems.length }, sql: '', statements: 0, newPaths: [], newHandles: [] })

  if (state.myra) {
    if (state.myra.handle !== MYRA || state.myra.id >= PERSON_BASE) report.problems.push('the @myra row read from the target looks wrong')
    else if (state.myra.status !== 'active' || !state.myra.email_verified_at) report.problems.push('@myra must be active and verified on the target')
  } else if (o.target === 'staging' || o.target === 'production') report.problems.push(`there is no @myra account on ${o.target}. sign up there first`)
  if (report.problems.length) return empty()

  await setUpCopy(copy, state, at)
  const db = recordingDb(copy)
  let clock = o.now
  const engine = new TreeEngine(db, () => clock)
  const run = (cmd: Command) => engine.run(cmd)
  const chunks: { label: string; batches: Recorded[][] }[] = []

  // No @myra yet (local or offline only): the plan makes one, sign-in disabled, so the seed has someone to act as.
  let myraId = state.myra?.id
  if (myraId === undefined) {
    await db.batch([personInsert(db, MYRA, at)])
    myraId = (await copy.prepare('SELECT id FROM person WHERE handle = ?').bind(MYRA).first<{ id: number }>())!.id
    chunks.push({ label: 'local @myra (sign-in disabled)', batches: db.take() })
  }
  const seed: Actor = { personId: myraId, handle: MYRA, as: '@' + MYRA, via: 'seed' }

  // ---- the launch shwarms ----
  const only = o.only ? new Set(o.only) : null
  const there = new Set(state.nodes.map(n => n.path))
  const listed = new Set<string>()
  const made = new Set<string>()
  for (const e of entries) {
    const m = mapLaunchShwarm(e)
    listed.add(m.slug)
    if (only && !only.has(m.slug)) continue
    const r: ShwarmReport = { slug: m.slug, wave: m.wave, status: 'new', notes: m.notes }
    report.shwarms.push(r)
    if (there.has(m.slug)) {
      r.status = 'exists'
      r.notes = []
      continue
    }
    if (m.notes.some(n => n.kind === 'failed')) {
      r.status = 'failed'
      continue
    }
    clock = o.example && m.slug === EXAMPLE_ROOT ? o.now - ROOT_AGE_MIN * 60_000 : o.now
    try {
      await run({ type: 'createNode', actor: seed, input: m.input })
      if (m.pinned) await run({ type: 'post', actor: seed, input: { node: m.slug, text: m.pinned, pin: true } })
      made.add(m.slug)
    } catch (err) {
      r.status = 'failed'
      r.notes = [...r.notes, { field: 'core', kind: 'failed', text: errText(err) }]
    }
    chunks.push({ label: m.slug, batches: db.take() })
  }
  if (only) for (const s of only) if (!listed.has(s)) report.problems.push(`${s} is not in the launch list`)
  const seen = new Set<string>()
  for (const r of report.shwarms) {
    if (seen.has(r.slug)) report.problems.push(`${r.slug} is in the launch list twice`)
    seen.add(r.slug)
  }

  // ---- the running example (staging and local only) ----
  const newHandles: string[] = []
  if (o.example) {
    const ex = report.example
    const taken = EXAMPLE_PEOPLE.filter(h => state.handles.includes(h))
    if (there.has(EXAMPLE_BRANCH)) ex.status = 'exists'
    else if (!made.has(EXAMPLE_ROOT))
      ex.notes.push({ field: 'example', kind: 'warning', text: `skipped: it goes in with ${EXAMPLE_ROOT}, which this run doesn't create. reset the target (--replace) to add both` })
    else if (taken.length) ex.notes.push({ field: 'example', kind: 'warning', text: `skipped: the example's handles are taken (${taken.map(h => '@' + h).join(', ')})` })
    else {
      try {
        await db.batch(EXAMPLE_PEOPLE.map(h => personInsert(db, h, new Date(o.now - ROOT_AGE_MIN * 60_000).toISOString())))
        const { results } = await copy
          .prepare(`SELECT id, handle FROM person WHERE handle IN (${EXAMPLE_PEOPLE.map(() => '?').join(', ')})`)
          .bind(...EXAMPLE_PEOPLE)
          .all<{ id: number; handle: ExampleHandle }>()
        const people = Object.fromEntries(results.map(p => [p.handle, p])) as Record<ExampleHandle, { id: number; handle: string }>
        await runExample(
          (ago, cmd) => {
            clock = o.now - ago * 60_000
            return run(cmd)
          },
          { myra: { id: myraId, handle: MYRA }, ...people },
        )
        ex.status = 'new'
        newHandles.push(...EXAMPLE_PEOPLE)
      } catch (err) {
        ex.status = 'failed'
        ex.notes.push({ field: 'example', kind: 'failed', text: errText(err) })
      }
      chunks.push({ label: 'running example', batches: db.take() })
    }
  }

  report.failures = report.shwarms.filter(s => s.status === 'failed').length + (report.example.status === 'failed' ? 1 : 0) + report.problems.length
  const newPaths = [...made, ...(report.example.status === 'new' ? [EXAMPLE_BRANCH] : [])]
  if (report.failures) return { report, sql: '', statements: 0, newPaths: [], newHandles: [] }

  // ---- write it out ----
  const ids: IdMap = new Map()
  for (const n of (await copy.prepare('SELECT id, path FROM node WHERE id > ?').bind(NODE_BASE).all<{ id: number; path: string }>()).results)
    ids.set(n.id, `(SELECT id FROM node WHERE path = ${sqlString(n.path)})`)
  for (const p of (await copy.prepare('SELECT id, handle FROM person WHERE id > ?').bind(PERSON_BASE).all<{ id: number; handle: string }>()).results)
    ids.set(p.id, `(SELECT id FROM person WHERE handle = ${sqlString(p.handle)})`)

  const lines: string[] = []
  let statements = 0
  // Guards first. Each writes a NULL into meta.value (NOT NULL) when the target moved since the plan read it,
  // so the file stops at its first statement and nothing is written. D1 has no RAISE outside triggers.
  const guard = (why: string, cond: string) => {
    lines.push(`INSERT INTO meta (key, value) SELECT ${sqlString('seed guard: ' + why)}, NULL WHERE ${cond};`)
    statements++
  }
  guard('@myra changed', state.myra ? `(SELECT id FROM person WHERE handle = 'myra' AND status = 'active') IS NOT ${state.myra.id}` : `EXISTS (SELECT 1 FROM person WHERE handle = 'myra')`)
  const list = (xs: string[]) => xs.map(sqlString).join(', ')
  if (newPaths.length) guard('a path is taken', `EXISTS (SELECT 1 FROM node WHERE path IN (${list(newPaths)}))`)
  if (newHandles.length) guard('a handle is taken', `EXISTS (SELECT 1 FROM person WHERE handle IN (${list(newHandles)}))`)
  for (const c of chunks) {
    if (!c.batches.length) continue
    lines.push(`-- ${c.label.replace(/[^\w @().-]/g, '')}`)
    for (const b of c.batches)
      for (const s of b) {
        lines.push(renderStatement(s.sql, s.args, ids))
        statements++
      }
  }
  const head = [
    `-- shwarm launch seed (go-live 3.1). target ${o.target}, planned ${at}, ${newPaths.length} new nodes, ${statements} statements.`,
    '-- written by scripts/seed-launch.ts from core commands run as @myra (via seed). do not edit by hand: plan again.',
  ]
  return { report, sql: [...head, ...lines, ''].join('\n'), statements, newPaths, newHandles }
}

// ---------- the dry-run report ----------

export function formatReport(r: SeedReport): string {
  const out: string[] = []
  out.push(`seed plan for ${r.target}: ${r.shwarms.length} launch shwarms`)
  out.push(`never imported: ${NOT_IMPORTED.join(', ')} (risk notes stay private)`)
  for (const p of r.problems) out.push(`problem: ${p}`)
  for (const s of r.shwarms) {
    out.push('')
    out.push(`${s.slug}${s.wave !== null ? ` (wave ${s.wave})` : ''}: ${s.status === 'exists' ? 'already there, skipped' : s.status}`)
    for (const n of s.notes) out.push(`  ${n.kind.padEnd(10)} ${n.field.padEnd(12)} ${n.text}`)
  }
  out.push('')
  out.push(`running example: ${r.example.status}`)
  for (const n of r.example.notes) out.push(`  ${n.kind.padEnd(10)} ${n.text}`)
  const count = (st: ShwarmReport['status']) => r.shwarms.filter(s => s.status === st).length
  const kinds = new Map<string, number>()
  for (const s of r.shwarms) for (const n of s.notes) kinds.set(n.kind, (kinds.get(n.kind) ?? 0) + 1)
  out.push('')
  out.push(`${count('new')} new, ${count('exists')} already there, ${count('failed')} failed. notes: ${[...kinds].map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`)
  return out.join('\n')
}
