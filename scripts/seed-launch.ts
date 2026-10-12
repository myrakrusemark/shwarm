// Seed import tool (go-live 3.1, A18): docs/launch-shwarms.json → createNode calls through core, as bare @myra
// with via 'seed', written out as one .sql file and applied with `wrangler d1 execute --file`.
//
// Run from the repo root with vite-node (it ships with vitest, so nothing new to install; plain node can't load
// core's extensionless imports):
//
//   npx -y vite-node scripts/seed-launch.ts -- --offline                     dry run against an empty database
//   npx -y vite-node scripts/seed-launch.ts -- --target staging --dry-run    plan against staging, write nothing
//   npx -y vite-node scripts/seed-launch.ts -- --target staging              plan, apply, check
//   npx -y vite-node scripts/seed-launch.ts -- --target staging --replace    restore the pre-seed bookmark, then seed again
//   npx -y vite-node scripts/seed-launch.ts -- --target production --allow-production --slugs a,b   (3.10 / 11.1 only)
//
// --approved (go-live 3.10, 12.1) picks the slugs from proofreading instead: only wave-1 shwarms (--wave N or --wave all
// for others) whose latest verdict in tracker/proof.json is approve, whose done test hasn't changed since (checked
// against the git history of the list), and that aren't in docs/launch-drops.md. It prints what's ready, what isn't and
// what's dropped. With --slugs too, every named slug must be ready. It never adds the running example.
//
//   npx -y vite-node scripts/seed-launch.ts -- --approved --offline          the list, and a dry run of it; no Cloudflare
//   npx -y vite-node scripts/seed-launch.ts -- --target production --allow-production --approved            (from a terminal)
//
// How it reaches D1 without an admin endpoint: core runs against a local copy (node:sqlite, the test stand-in)
// that holds what it needs to read from the target (@myra, settings, existing nodes). Each committed batch is
// recorded and rendered as plain SQL with quoted literals (src/seed/sql.ts). Wrangler sends a --remote --file to
// D1's import API, which runs the whole file or none of it ("if the execution fails to complete, your DB will
// return to its original state"); --local runs it as one D1 batch, also all or nothing. The file starts with
// guards that stop it at the first statement if the target changed since the plan read it.
//
// Idempotent by slug: a rerun skips every slug already there and reports it. Exit codes: 0 done, 1 a parse or
// core failure (nothing applied), 2 refused or bad arguments, 3 applied but the read-back didn't match.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXAMPLE_BRANCH, EXAMPLE_PEOPLE } from '../apps/site/src/seed/example'
import { formatReport, planSeed, type ExistingNode, type PersonState, type Target, type TargetState } from '../apps/site/src/seed/plan'
import { sqlString } from '../apps/site/src/seed/sql'
import { formatReadiness, parseDrops, readiness, type AtApproval, type LaunchEntry, type Readiness } from '../apps/site/src/seed/approved'
import { testDb } from '../apps/site/test/d1'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(ROOT, 'apps/site')
const STATE_FILE = join(SITE, '.wrangler/seed-state.json') // .wrangler/ is git-ignored

export type Args = {
  target: Target | null
  dryRun: boolean
  offline: boolean
  example: boolean
  replace: boolean
  allowProduction: boolean
  slugs: string[] | null
  file: string
  out: string | null
  yes: boolean
  approved: boolean // pick the slugs from proofreading (tracker/proof.json)
  wave: number | null // with approved: which wave (default 1); null is every wave
}

export class Refused extends Error {}

export function parseArgs(argv: string[]): Args {
  const a: Args = { target: null, dryRun: false, offline: false, example: true, replace: false, allowProduction: false, slugs: null, file: join(ROOT, 'docs/launch-shwarms.json'), out: null, yes: false, approved: false, wave: 1 }
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
    else if (k === '--offline') a.offline = a.dryRun = true
    else if (k === '--no-example') a.example = false
    else if (k === '--replace') a.replace = true
    else if (k === '--allow-production') a.allowProduction = true
    else if (k === '--slugs') a.slugs = val().split(',').map(s => s.trim()).filter(Boolean)
    else if (k === '--file') a.file = resolve(val())
    else if (k === '--out') a.out = resolve(val())
    else if (k === '--yes') a.yes = true
    else if (k === '--approved') a.approved = true
    else if (k === '--wave') {
      const v = val()
      if (v === 'all') a.wave = null
      else if (/^[1-9]$/.test(v)) a.wave = Number(v)
      else throw new Refused(`--wave is a wave number or all, not "${v}"`)
    }
    else throw new Refused(`unknown option ${k}`)
  }
  return a
}

/** Whether wrangler will really ask before it applies. With no terminal, or in CI, its confirm answers yes by itself. */
export const interactive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI

/** Every refusal, before anything is read or written. Production needs its own flag and named slugs, and never replaces. */
export function checkArgs(a: Args, tty = interactive()): void {
  if (a.approved) a.example = false
  if (a.offline) {
    if (a.target) throw new Refused('--offline plans against an empty database; leave out --target')
    if (a.replace || a.allowProduction) throw new Refused('--offline only plans')
    return
  }
  if (!a.target) throw new Refused('say where: --target local, --target staging or --target production (or --offline for a dry run)')
  if (a.target === 'production') {
    if (!a.allowProduction) throw new Refused('production is refused without --allow-production')
    if (!a.slugs?.length && !a.approved) throw new Refused('production imports name their slugs (--slugs a,b) or take the approved ones (--approved): only shwarms Myra approved in 12.1')
    if (a.replace) throw new Refused('--replace never runs on production')
    if (a.yes) throw new Refused("--yes isn't taken on production: wrangler asks before it applies")
    if (!a.dryRun && !tty) throw new Refused('production applies only from a terminal, where wrangler asks first. with no terminal (an agent, CI) it would apply without asking')
    a.example = false
  } else if (a.allowProduction) throw new Refused('--allow-production goes only with --target production')
  if (a.replace && a.dryRun) throw new Refused('--replace changes the database; dry-run without it')
  if (a.approved && a.replace) throw new Refused('--approved adds to what is there; it never replaces')
}

// ---------- wrangler ----------

export type Wrangler = (args: string[], inherit?: boolean) => string

const wrangler: Wrangler = (args, inherit = false) => {
  const r = spawnSync('npx', ['wrangler', ...args], { cwd: SITE, encoding: 'utf8', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed${r.stderr ? `:\n${r.stderr}` : ''}`)
  return r.stdout ?? ''
}

// Local dev uses the staging env's D1 binding (the default env has none), like `npm run migrate:check`.
const where = (t: Target) => (t === 'local' ? ['--env', 'staging', '--local'] : ['--env', t, '--remote'])

function query<T>(t: Target, sql: string, w: Wrangler = wrangler): T[] {
  const out = w(['d1', 'execute', 'DB', ...where(t), '--json', '--command', sql])
  const json = JSON.parse(out.slice(out.indexOf('[')))
  return (json[0]?.results ?? []) as T[]
}

const seededCount = (t: Target, w: Wrangler) => query<{ n: number }>(t, 'SELECT count(*) AS n FROM node WHERE seeded = 1', w)[0]?.n ?? 0

function readTarget(t: Target): TargetState {
  const myra = query<PersonState>(t, "SELECT id, handle, status, email_verified_at, founding, established_at FROM person WHERE handle = 'myra'")[0] ?? null
  const nodes = query<ExistingNode>(t, 'SELECT path, kind, state, license, hidden, paused FROM node')
  const handles = query<{ handle: string }>(t, `SELECT handle FROM person WHERE handle IN (${EXAMPLE_PEOPLE.map(sqlString).join(', ')})`).map(r => r.handle)
  const settings = query<{ key: string; value: string }>(t, 'SELECT key, value FROM setting')
  return { myra, nodes, handles, settings }
}

type SavedState = { staging?: { bookmark: string; at: string } }
const readSaved = (file: string): SavedState => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {})

/**
 * Staging only: a Time Travel bookmark taken just before the first seed, kept so --replace can go back to it.
 * The state file lives in one checkout's .wrangler/, so a seed from another checkout finds none: then a bookmark
 * is saved only while staging holds no seeded node, or --replace would later restore to a seeded point.
 */
export function bookmarkBeforeFirstSeed(w: Wrangler = wrangler, file = STATE_FILE): void {
  const saved = readSaved(file)
  if (saved.staging) return
  const seeded = seededCount('staging', w)
  if (seeded) {
    console.log(`no bookmark saved: staging already holds ${seeded} seeded node${seeded > 1 ? 's' : ''}, so now isn't before the first seed.`)
    console.log('--replace from this checkout will refuse. see docs/runbook.md, "re-seeding staging", to restore by hand.')
    return
  }
  const out = w(['d1', 'time-travel', 'info', 'DB', '--env', 'staging', '--json'])
  const info = JSON.parse(out.slice(out.indexOf('{')))
  if (typeof info?.bookmark !== 'string') throw new Error('wrangler gave no Time Travel bookmark')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ ...saved, staging: { bookmark: info.bookmark, at: new Date().toISOString() } }, null, 2))
  console.log(`saved a staging bookmark from before the first seed: ${info.bookmark}`)
}

/**
 * --replace: staging goes back to the pre-seed bookmark; local starts from a fresh, migrated database. Never
 * production. A restore takes the schema back too, so the migrations are applied again after it.
 */
export function reset(t: Target, w: Wrangler = wrangler, file = STATE_FILE): void {
  if (t === 'production') throw new Refused('--replace never runs on production')
  if (t === 'local') {
    console.log('resetting the local database: deleting it and applying the migrations again')
    rmSync(join(SITE, '.wrangler/state/v3/d1'), { recursive: true, force: true })
    w(['d1', 'migrations', 'apply', 'DB', '--env', 'staging', '--local'], true)
    return
  }
  const saved = readSaved(file).staging
  if (!saved)
    throw new Refused('no pre-seed bookmark is saved (the first seed on staging takes one). see docs/runbook.md, "re-seeding staging", for the manual reset')
  console.log(`restoring staging to ${saved.at} (bookmark ${saved.bookmark}).`)
  console.log('everything written to staging since then goes: seeded shwarms, posts, and any accounts made after it.')
  console.log('wrangler asks to confirm, and prints a bookmark that undoes the restore.')
  w(['d1', 'time-travel', 'restore', 'DB', '--env', 'staging', '--bookmark', saved.bookmark], true)
  // A declined confirm leaves wrangler at exit 0, so check the restore really happened.
  if (seededCount(t, w)) throw new Refused('seeded shwarms are still there, so the reset did not happen (declined?). nothing written')
  console.log('applying the migrations again: the restore took the schema back to the bookmark too.')
  w(['d1', 'migrations', 'apply', 'DB', '--env', 'staging', '--remote'], true)
}

/** After applying: every new node is there; seeded shwarms have @myra in seat 1 and their pinned post. */
function verify(t: Target, paths: string[], hasPinned: Set<string>): string[] {
  if (!paths.length) return []
  const myra = query<{ id: number }>(t, "SELECT id FROM person WHERE handle = 'myra'")[0]?.id
  const rows = query<{ path: string; state: string; seeded: number; pinned: number; seat1: number | null }>(
    t,
    `SELECT n.path, n.state, n.seeded, n.pinned_post_id IS NOT NULL AS pinned, s.person_id AS seat1
     FROM node n LEFT JOIN seat s ON s.node_id = n.id AND s.number = 1 WHERE n.path IN (${paths.map(sqlString).join(', ')})`,
  )
  const by = new Map(rows.map(r => [r.path, r]))
  const bad: string[] = []
  for (const p of paths) {
    const r = by.get(p)
    if (!r) bad.push(`${p}: missing`)
    else if (p === EXAMPLE_BRANCH) continue
    else if (r.seeded !== 1 || r.seat1 !== myra) bad.push(`${p}: not seeded with @myra working on it`)
    // No lobby (decided Oct 9): every shwarm is live once it's posted.
    else if (r.state !== 'live') bad.push(`${p}: state ${r.state}`)
    else if (hasPinned.has(p) && r.pinned !== 1) bad.push(`${p}: no pinned post`)
  }
  return bad
}

// ---------- what's approved (3.10, 12.1) ----------

const git = (args: string[]) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args[0]} failed`)
  return r.stdout
}

/**
 * The launch list as it stood when each verdict was given: the newest commit of docs/launch-shwarms.json at or before
 * that time. An edit made before a verdict but committed after it reads as a change, so it asks for a second look,
 * never the other way round. Undefined for every slug when the list isn't the repo's or git can't be read.
 */
export function gitAtApproval(file: string): AtApproval {
  const rel = 'docs/launch-shwarms.json'
  if (resolve(file) !== join(ROOT, rel)) return () => undefined
  let commits: { sha: string; at: number }[]
  try {
    commits = git(['log', '--format=%H %cI', '--', rel])
      .split('\n')
      .filter(Boolean)
      .map(l => ({ sha: l.slice(0, l.indexOf(' ')), at: Date.parse(l.slice(l.indexOf(' ') + 1)) }))
  } catch {
    return () => undefined
  }
  const lists = new Map<string, Map<string, LaunchEntry>>()
  return (slug, at) => {
    const t = Date.parse(at)
    const c = commits.find(c => c.at <= t) // newest first
    if (!c) return null
    if (!lists.has(c.sha)) lists.set(c.sha, new Map((JSON.parse(git(['show', `${c.sha}:${rel}`])) as LaunchEntry[]).map(e => [e.slug, e])))
    return lists.get(c.sha)!.get(slug) ?? null
  }
}

/** The readiness of each launch shwarm in `a.wave`, from the proofreading files next to the list. */
export function approvedFrom(entries: LaunchEntry[], a: Pick<Args, 'file' | 'wave'>, at: AtApproval = gitAtApproval(a.file)): Readiness[] {
  const proof = JSON.parse(readFileSync(join(ROOT, 'tracker/proof.json'), 'utf8'))
  const drops = existsSync(join(ROOT, 'docs/launch-drops.md')) ? parseDrops(readFileSync(join(ROOT, 'docs/launch-drops.md'), 'utf8')) : new Set<string>()
  return readiness(entries, proof, { dropped: drops, atApproval: at, wave: a.wave })
}

// ---------- main ----------

export async function main(argv: string[]): Promise<number> {
  let a: Args
  try {
    a = parseArgs(argv)
    checkArgs(a)
  } catch (e) {
    console.error(`seed-launch: ${(e as Error).message}`)
    return 2
  }
  const target: Target = a.offline ? 'offline' : a.target!
  try {
    const entries = JSON.parse(readFileSync(a.file, 'utf8'))
    if (!Array.isArray(entries)) throw new Refused(`${a.file} is not a list`)
    if (a.replace) {
      // Parse everything before resetting anything: a typo in the JSON shouldn't cost staging its data.
      const pre = await planSeed(testDb(), entries, { myra: null, nodes: [], handles: [], settings: [] }, { target: 'offline', now: Date.now(), example: a.example })
      if (pre.report.failures) {
        console.log(formatReport(pre.report))
        console.error(`\n${pre.report.failures} failure${pre.report.failures > 1 ? 's' : ''}; nothing reset, nothing written.`)
        return 1
      }
      reset(target)
    }
    if (a.approved) {
      const rows = approvedFrom(entries, a)
      console.log(`proofreading, ${a.wave === null ? 'every wave' : `wave ${a.wave}`}:\n${formatReadiness(rows)}\n`)
      const ready = rows.filter(r => r.status === 'ready').map(r => r.slug)
      const notReady = (a.slugs ?? []).filter(s => !ready.includes(s))
      if (notReady.length) throw new Refused(`not approved and ready: ${notReady.join(', ')}. nothing written`)
      a.slugs = a.slugs ?? ready
      if (!a.slugs.length) {
        console.log('nothing approved to import.')
        return 0
      }
    }
    const state: TargetState = target === 'offline' ? { myra: null, nodes: [], handles: [], settings: [] } : readTarget(target)
    const plan = await planSeed(testDb(), entries, state, { target, now: Date.now(), example: a.example, ...(a.slugs ? { only: a.slugs } : {}) })
    console.log(formatReport(plan.report))
    if (plan.report.failures) {
      console.error(`\n${plan.report.failures} failure${plan.report.failures > 1 ? 's' : ''}; nothing written.`)
      return 1
    }
    if (!plan.newPaths.length) {
      console.log('\nnothing new to import.')
      return 0
    }
    const out = a.out ?? join(SITE, '.wrangler/seed', `${target}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, plan.sql)
    console.log(`\nwrote ${plan.statements} statements for ${plan.newPaths.length} nodes to ${out}`)
    if (a.dryRun) return 0

    if (target === 'staging') bookmarkBeforeFirstSeed()
    wrangler(['d1', 'execute', 'DB', ...where(target), '--file', out, ...(a.yes && target !== 'production' ? ['--yes'] : [])], true)
    const pinned = new Set(plan.report.shwarms.filter(s => s.notes.some(n => n.field === 'pinned post' && n.kind === 'changed')).map(s => s.slug))
    const bad = verify(target, plan.newPaths, pinned)
    if (bad.length) {
      console.error(`\napplied, but the read-back doesn't match:\n${bad.join('\n')}`)
      return 3
    }
    console.log(`\napplied and checked: ${plan.newPaths.length} new nodes on ${target}.`)
    return 0
  } catch (e) {
    console.error(`seed-launch: ${(e as Error).message}`)
    return e instanceof Refused ? 2 : 1
  }
}

// Run directly (vite-node puts itself in argv[1]), not when a test imports it.
if (/(seed-launch\.ts|vite-node(\.m?js)?)$/.test(process.argv[1] ?? '')) main(process.argv.slice(2)).then(code => process.exit(code))
