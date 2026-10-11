#!/usr/bin/env node
// Restores a nightly backup (go-live 11.1, apps/site/src/jobs/backup.ts) into a D1 database: the restore drill (11.2)
// and the real thing. Run from the repo root; it calls the site's own wrangler, so it needs no new dependency.
//
//   node scripts/restore-backup.mjs [YYYY-MM-DD] [--from staging|production] [--env staging|production] [--db <name>]
//                                   [--i-mean-production] [--local [--persist-to <dir>]]
//
// It downloads the manifest and the dump of that day, or of the latest day of the last 31 when none is given, from
// the --from env's bucket (default: the same env as --env), checks the dump's sha256 and size against the manifest,
// and loads it into the target: --db, a database name (a fresh one made with `wrangler d1 create` and migrated with
// `wrangler d1 migrations apply <name> --env <env> --remote`), or else the --env's own database (default: staging).
// The target must already have the backup's migrations, all of them and no more, and hold no people, nodes or audit
// events: the dump empties each table before it fills it, and audit_event refuses deletes anyway. It never touches
// production without --i-mean-production. Afterwards it prints each table's rows next to the manifest's, and exits 1
// on any difference.
//
// The drill (11.2): last night's production backup into a fresh staging database:
//   npx wrangler d1 create shwarm-restore-drill        (add it under env.staging's d1_databases only if wrangler asks)
//   npx wrangler d1 migrations apply shwarm-restore-drill --env staging --remote
//   node scripts/restore-backup.mjs --from production --db shwarm-restore-drill
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(ROOT, 'apps/site')
const BUCKETS = { staging: 'shwarm-backups-staging', production: 'shwarm-backups' }
const DATABASES = { staging: 'shwarm-staging', production: 'shwarm-production' }
const LOOK_BACK_DAYS = 31

function die(msg) {
  console.error(`restore-backup: ${msg}`)
  process.exit(1)
}

// ---------- arguments ----------

const argv = process.argv.slice(2)
const flags = new Map()
const positional = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) positional.push(a)
  else if (['--i-mean-production', '--local'].includes(a)) flags.set(a.slice(2), true)
  else if (['--from', '--env', '--db', '--persist-to'].includes(a)) {
    if (argv[i + 1] === undefined) die(`${a} needs a value`)
    flags.set(a.slice(2), argv[++i])
  } else die(`unknown option ${a}`)
}
const day = positional[0]
if (positional.length > 1 || (day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(day))) die('usage: node scripts/restore-backup.mjs [YYYY-MM-DD] [--from <env>] [--env <env>] [--db <name>]')
const env = flags.get('env') ?? 'staging'
const from = flags.get('from') ?? env
for (const e of [env, from]) if (!(e in BUCKETS)) die(`no such env: ${e} (staging or production)`)
const db = flags.get('db') ?? 'DB'
const local = flags.get('local') === true
if ((env === 'production' || db === DATABASES.production) && !flags.get('i-mean-production'))
  die('that restores into production. if you mean it, add --i-mean-production')
if (from !== env && db === 'DB' && env === 'staging')
  console.warn(`restore-backup: loading ${from}'s backup into staging's own database (${DATABASES.staging}). the drill uses a fresh --db.`)

// ---------- wrangler ----------

const where = local ? ['--local', ...(flags.has('persist-to') ? ['--persist-to', resolve(flags.get('persist-to'))] : [])] : ['--remote']

function wrangler(args, { quiet = false } = {}) {
  const r = spawnSync('npx', ['wrangler', ...args], { cwd: SITE, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0 && !quiet) die(`wrangler ${args.slice(0, 3).join(' ')} failed:\n${r.stderr || r.stdout}`)
  return r
}

/** One query against the target, as rows. */
function query(sql) {
  const r = wrangler(['d1', 'execute', db, '--env', env, ...where, '--json', '--command', sql])
  const out = r.stdout.slice(r.stdout.indexOf('['))
  return JSON.parse(out)[0].results
}

const tmp = mkdtempSync(join(tmpdir(), 'shwarm-restore-'))
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }))

/** Downloads one object from the --from bucket to a file; null when it isn't there. */
function download(key) {
  const file = join(tmp, key.replace(/\//g, '_'))
  const r = wrangler(['r2', 'object', 'get', `${BUCKETS[from]}/${key}`, '--file', file, ...where], { quiet: true })
  return r.status === 0 ? file : null
}

// ---------- the backup ----------

const started = Date.now()
let manifestFile = null
let picked = day
if (day) manifestFile = download(`d1/${day}.json`)
else
  for (let i = 0; i <= LOOK_BACK_DAYS && !manifestFile; i++) {
    picked = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
    manifestFile = download(`d1/${picked}.json`)
  }
if (!manifestFile) die(day ? `no backup for ${day} in ${BUCKETS[from]}` : `no backup in the last ${LOOK_BACK_DAYS} days in ${BUCKETS[from]}`)
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
console.log(`backup ${picked} from ${BUCKETS[from]}: taken ${manifest.taken_at}, ${Object.keys(manifest.tables).length} tables`)

const dumpFile = download(manifest.key)
if (!dumpFile) die(`the manifest names ${manifest.key}, which isn't in ${BUCKETS[from]}`)
const body = readFileSync(dumpFile)
const sum = createHash('sha256').update(body).digest('hex')
if (body.length !== manifest.bytes || sum !== manifest.sha256)
  die(`${manifest.key} doesn't match its manifest: ${body.length} bytes, sha256 ${sum}; expected ${manifest.bytes} bytes, ${manifest.sha256}`)
console.log(`sha256 ok: ${sum}`)
const sqlFile = join(tmp, 'restore.sql')
writeFileSync(sqlFile, manifest.gzip ? gunzipSync(body) : body)

// ---------- the target ----------

const target = db === 'DB' ? `${env}'s database` : db
const applied = query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").length
  ? query('SELECT name FROM d1_migrations ORDER BY id').map(r => r.name)
  : []
if (manifest.migrations) {
  const want = manifest.migrations.join('\n')
  if (applied.join('\n') !== want) {
    const missing = manifest.migrations.filter(m => !applied.includes(m))
    const extra = applied.filter(m => !manifest.migrations.includes(m))
    die(
      `${target} isn't on the backup's schema.` +
        (missing.length ? `\n  not applied there: ${missing.join(', ')}` : '') +
        (extra.length ? `\n  applied there, not in the backup: ${extra.join(', ')}` : '') +
        `\n  migrate it to exactly the backup's migrations first (a fresh database: wrangler d1 migrations apply <name> --env ${env} --remote).`,
    )
  }
} else if (!applied.length) die(`${target} has no migrations applied: migrate it first`)
const [held] = query('SELECT (SELECT COUNT(*) FROM person) AS people, (SELECT COUNT(*) FROM node) AS nodes, (SELECT COUNT(*) FROM audit_event) AS events')
if (held.people || held.nodes || held.events)
  die(`${target} isn't empty (${held.people} people, ${held.nodes} nodes, ${held.events} audit events). restore into a fresh database: --db <name>`)

// ---------- restore and compare ----------

console.log(`loading ${manifest.sql_bytes ?? body.length} bytes of SQL into ${target} …`)
wrangler(['d1', 'execute', db, '--env', env, ...where, '--file', sqlFile, '--yes'])

const tables = Object.keys(manifest.tables)
// One column per table, 90 to a query: D1 allows 100 columns and only 5 terms in a compound SELECT.
const counts = new Map()
for (let i = 0; i < tables.length; i += 90) {
  const part = tables.slice(i, i + 90)
  const [row] = query(`SELECT ${part.map((t, j) => `(SELECT COUNT(*) FROM "${t.replace(/"/g, '""')}") AS c${j}`).join(', ')}`)
  part.forEach((t, j) => counts.set(t, row[`c${j}`]))
}
const width = Math.max(...tables.map(t => t.length))
let off = 0
for (const t of tables) {
  const want = manifest.tables[t]
  const got = counts.get(t)
  if (got !== want) off++
  console.log(`${t.padEnd(width)}  ${String(got).padStart(7)}  ${got === want ? 'ok' : `expected ${want}`}`)
}
const secs = ((Date.now() - started) / 1000).toFixed(1)
if (off) die(`${off} table(s) differ from the manifest (${secs} s)`)
console.log(`restored ${picked} into ${target}: ${tables.length} tables match the manifest, in ${secs} s`)
