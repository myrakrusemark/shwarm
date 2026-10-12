// Author edits of launch shwarms already posted (card fixes, Oct 11, Myra's yes in chat: docs/card-fixes-oct11.md).
// For each slug it loads the card's full content from docs/launch-shwarms.json, reads the node as it stands on the
// target D1, and runs core's editNode as @myra on the site, exactly as if she pressed edit (apps/site/src/seed/edit.ts):
// the old version goes to node_edit, triage goes back to 'pending' (the minute sweep checks it again), the version
// moves, and a node someone else joined or submitted to is refused. The password step-up is the one check skipped.
// The writes go out as one .sql file applied with `wrangler d1 execute --file`, all or nothing, starting with guards
// that stop it if @myra or any of the nodes changed since the plan read them.
//
// Run from the repo root with vite-node (as scripts/seed-launch.ts):
//
//   npx -y vite-node scripts/edit-launch.ts -- --target staging --dry-run                 plan against staging, write nothing
//   npx -y vite-node scripts/edit-launch.ts -- --target staging                           plan, apply, check
//   npx -y vite-node scripts/edit-launch.ts -- --target production --allow-production     (from a terminal: wrangler asks first)
//
// --skip-missing leaves out slugs the target doesn't have (staging lacks some of production's); without it they stop the run.
// --slugs a,b narrows it; the default is every slug in --fixes (docs/card-fixes-oct11.json). Production applies only
// from a terminal, as seed-launch does: with no terminal (an agent, CI) wrangler would apply without asking.
// Exit codes: 0 done, 1 a parse or core failure (nothing applied), 2 refused or bad arguments, 3 applied but the
// read-back didn't match.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatEditReport, planEdits, type EditPlan, type EditState, type EditTarget } from '../apps/site/src/seed/edit'
import { sqlString } from '../apps/site/src/seed/sql'
import { testDb } from '../apps/site/test/d1'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(ROOT, 'apps/site')

export type Args = { target: EditTarget | null; dryRun: boolean; allowProduction: boolean; slugs: string[] | null; file: string; fixes: string; out: string | null; yes: boolean; skipMissing: boolean }

export class Refused extends Error {}

export function parseArgs(argv: string[]): Args {
  const a: Args = { target: null, dryRun: false, allowProduction: false, slugs: null, file: join(ROOT, 'docs/launch-shwarms.json'), fixes: join(ROOT, 'docs/card-fixes-oct11.json'), out: null, yes: false, skipMissing: false }
  const rest = argv.filter(x => x !== '--')
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i]
    const val = () => {
      const v = rest[++i]
      if (v === undefined || v.startsWith('--')) throw new Refused(`${k} needs a value`)
      return v
    }
    if (k === '--target') {
      const t = val()
      if (t !== 'local' && t !== 'staging' && t !== 'production') throw new Refused(`--target is local, staging or production, not "${t}"`)
      a.target = t
    } else if (k === '--dry-run') a.dryRun = true
    else if (k === '--allow-production') a.allowProduction = true
    else if (k === '--slugs') a.slugs = val().split(',').map(s => s.trim()).filter(Boolean)
    else if (k === '--file') a.file = resolve(val())
    else if (k === '--fixes') a.fixes = resolve(val())
    else if (k === '--out') a.out = resolve(val())
    else if (k === '--yes') a.yes = true
    else if (k === '--skip-missing') a.skipMissing = true
    else throw new Refused(`unknown option ${k}`)
  }
  return a
}

/** Whether wrangler will really ask before it applies. With no terminal, or in CI, its confirm answers yes by itself. */
export const interactive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI

/** Every refusal, before anything is read or written. Production needs its own flag and a terminal, as seed-launch. */
export function checkArgs(a: Args, tty = interactive()): void {
  if (!a.target) throw new Refused('say where: --target local, --target staging or --target production')
  if (a.slugs && !a.slugs.length) throw new Refused('--slugs names at least one slug')
  if (a.target === 'production') {
    if (!a.allowProduction) throw new Refused('production is refused without --allow-production')
    if (a.yes) throw new Refused("--yes isn't taken on production: wrangler asks before it applies")
    if (!a.dryRun && !tty) throw new Refused('production applies only from a terminal, where wrangler asks first. with no terminal (an agent, CI) it would apply without asking')
  } else if (a.allowProduction) throw new Refused('--allow-production goes only with --target production')
}

/** The slugs to edit: --slugs, or every slug in the fixes file. Each must be in the fixes file. */
export function slugsOf(a: Pick<Args, 'slugs' | 'fixes'>): string[] {
  const fixes = JSON.parse(readFileSync(a.fixes, 'utf8')) as { slug: string }[]
  if (!Array.isArray(fixes)) throw new Refused(`${a.fixes} is not a list`)
  const known = fixes.map(f => f.slug)
  if (!a.slugs) return known
  const odd = a.slugs.filter(s => !known.includes(s))
  if (odd.length) throw new Refused(`not in ${a.fixes}: ${odd.join(', ')}`)
  return a.slugs
}

// ---------- wrangler ----------

export type Wrangler = (args: string[], inherit?: boolean) => string

const wrangler: Wrangler = (args, inherit = false) => {
  const r = spawnSync('npx', ['wrangler', ...args], { cwd: SITE, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed${r.stderr ? `:\n${r.stderr}` : ''}`)
  return r.stdout ?? ''
}

// Local dev uses the staging env's D1 binding (the default env has none), like `npm run migrate:check`.
const where = (t: EditTarget) => (t === 'local' ? ['--env', 'staging', '--local'] : ['--env', t, '--remote'])

function query<T>(t: EditTarget, sql: string, w: Wrangler = wrangler): T[] {
  const out = w(['d1', 'execute', 'DB', ...where(t), '--json', '--command', sql])
  const json = JSON.parse(out.slice(out.indexOf('[')))
  return (json[0]?.results ?? []) as T[]
}

/** What editNode reads, from the target: the named shwarms and their branches with their tags, seats and submissions. */
export function readTarget(t: EditTarget, slugs: string[], w: Wrangler = wrangler): EditState {
  const myra = query<EditState['myra'] & object>(t, "SELECT id, handle, status, email_verified_at, founding, established_at, is_admin FROM person WHERE handle = 'myra'", w)[0] ?? null
  const paths = slugs.map(sqlString).join(', ')
  const tree = `SELECT id FROM node WHERE path IN (${paths}) OR root_id IN (SELECT id FROM node WHERE path IN (${paths}))`
  const nodes = query<Record<string, unknown>>(t, `SELECT * FROM node WHERE id IN (${tree})`, w)
  const tags = query<Record<string, unknown>>(t, `SELECT * FROM node_tag WHERE node_id IN (${tree}) ORDER BY rowid`, w)
  const seats = query<Record<string, unknown>>(t, `SELECT * FROM seat WHERE node_id IN (${tree})`, w)
  const submissions = query<Record<string, unknown>>(t, `SELECT * FROM submission WHERE node_id IN (${tree})`, w)
  const buckets = myra ? query<Record<string, unknown>>(t, `SELECT * FROM rate_bucket WHERE bucket IN (SELECT 'thread:' || ${Number(myra.id)} || ':' || id FROM node WHERE path IN (${paths}))`, w) : []
  const settings = query<{ key: string; value: string }>(t, 'SELECT key, value FROM setting', w)
  return { myra, nodes, tags, seats, submissions, buckets, settings }
}

/** After applying: each node holds the planned words, has one more node_edit row, and is being checked again. */
export function verify(t: EditTarget, plan: EditPlan, before: EditState, w: Wrangler = wrangler): string[] {
  const paths = plan.edited.map(sqlString).join(', ')
  const rows = query<Record<string, unknown> & { edits: number }>(
    t,
    `SELECT n.*, (SELECT count(*) FROM node_edit e WHERE e.node_id = n.id) AS edits FROM node n WHERE n.path IN (${paths})`,
    w,
  )
  const bad: string[] = []
  for (const p of plan.edited) {
    const r = rows.find(x => x.path === p)
    const want = plan.after.get(p)!
    if (!r) {
      bad.push(`${p}: missing`)
      continue
    }
    for (const f of ['title', 'what', 'done_when', 'checks', 'license', 'builds_on'] as const) if ((r[f] ?? null) !== (want[f] ?? null)) bad.push(`${p}: ${f} isn't what was planned`)
    const was = before.nodes.find(x => x.path === p)!
    if (r.last_event_id === was.last_event_id) bad.push(`${p}: the version didn't move`)
    if (r.triage === 'clear' && was.triage === 'clear' && r.triage_since === was.triage_since) bad.push(`${p}: triage didn't start again`)
  }
  return bad
}

export async function main(argv: string[], w: Wrangler = wrangler): Promise<number> {
  let a: Args
  let slugs: string[]
  try {
    a = parseArgs(argv)
    checkArgs(a)
    slugs = slugsOf(a)
  } catch (e) {
    console.error(`edit-launch: ${(e as Error).message}`)
    return 2
  }
  const target = a.target!
  try {
    const entries = JSON.parse(readFileSync(a.file, 'utf8'))
    if (!Array.isArray(entries)) throw new Refused(`${a.file} is not a list`)
    const state = readTarget(target, slugs, w)
    const plan = await planEdits(testDb(), entries, state, { target, now: Date.now(), slugs })
    console.log(formatEditReport(plan))
    const failures = plan.problems.length + plan.reports.filter(r => r.status === 'failed' || (r.status === 'missing' && !a.skipMissing)).length
    if (failures) {
      console.error(`\n${failures} failure${failures > 1 ? 's' : ''}; nothing written.`)
      return 1
    }
    const refused = plan.reports.filter(r => r.status === 'refused')
    if (refused.length) console.log(`\nrefused (locked, left as they are): ${refused.map(r => r.slug).join(', ')}`)
    const missing = plan.reports.filter(r => r.status === 'missing')
    if (missing.length) console.log(`\nnot on ${target}, skipped (--skip-missing): ${missing.map(r => r.slug).join(', ')}`)
    if (!plan.edited.length) {
      console.log('\nnothing to edit.')
      return 0
    }
    const out = a.out ?? join(SITE, '.wrangler/edit', `${target}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, plan.sql)
    console.log(`\nwrote ${plan.statements} statements for ${plan.edited.length} shwarms to ${out}`)
    if (a.dryRun) return 0

    w(['d1', 'execute', 'DB', ...where(target), '--file', out, ...(a.yes && target !== 'production' ? ['--yes'] : [])], true)
    const bad = verify(target, plan, state, w)
    if (bad.length) {
      console.error(`\napplied, but the read-back doesn't match:\n${bad.join('\n')}`)
      return 3
    }
    console.log(`\napplied and checked: ${plan.edited.length} shwarms edited on ${target}. triage checks each again within a few minutes (the minute sweep).`)
    return refused.length ? 2 : 0
  } catch (e) {
    console.error(`edit-launch: ${(e as Error).message}`)
    return e instanceof Refused ? 2 : 1
  }
}

// Run directly (vite-node puts itself in argv[1]), not when a test imports it.
if (/(edit-launch\.ts|vite-node(\.m?js)?)$/.test(process.argv[1] ?? '')) main(process.argv.slice(2)).then(code => process.exit(code))
