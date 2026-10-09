#!/usr/bin/env node
// Myra's triage queue (go-live 8.1), until the 8.4 admin console. Plain node, no packages: the SQL is built by
// src/triage/decide.ts (node loads the .ts file itself) and sent with wrangler. Run it from apps/site:
//
//   node scripts/triage.mjs list --env staging
//   node scripts/triage.mjs clear <path> "<reason>" --env staging
//   node scripts/triage.mjs block <path> "<category>" "<reason>" --env production
//
// list: held nodes, and launch shwarms the model flagged or couldn't check (they stay public), newest first.
// clear: the node goes public. block: only its author sees it, with the category, the reason and how to appeal.
// Categories: weapons, surveillance, spam, protected_assets. The reason goes in the public moderation log (8.5).
// --as <handle> names who decided (default myra). Every SQL statement is printed before it runs. clear and block
// go as one file (`wrangler d1 execute --remote --file`), which D1 applies whole or not at all; wrangler asks
// before it applies, unless --yes is given.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DecideError, decideStatements, describeNode, nodeSql, parseBlockReason, printable, queueSql, toSqlScript } from '../src/triage/decide.ts'

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const USAGE = `usage:
  node scripts/triage.mjs list --env staging|production
  node scripts/triage.mjs clear <path> "<reason>" --env staging|production [--as <handle>] [--yes]
  node scripts/triage.mjs block <path> "<category>" "<reason>" --env staging|production [--as <handle>] [--yes]`

function fail(msg, code = 2) {
  console.error(msg)
  process.exit(code)
}

function parse(argv) {
  const pos = []
  const o = { env: null, as: undefined, yes: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--env') o.env = argv[++i]
    else if (a === '--as') o.as = argv[++i]
    else if (a === '--yes') o.yes = true
    else if (a === '-h' || a === '--help') fail(USAGE, 0)
    else if (a.startsWith('--')) fail(`unknown option ${a}\n${USAGE}`)
    else pos.push(a)
  }
  if (o.env !== 'staging' && o.env !== 'production') fail(`--env staging or --env production\n${USAGE}`)
  return { pos, ...o }
}

function wrangler(env, args, inherit = false) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--env', env, '--remote', ...args], {
    cwd: SITE,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  })
  if (r.status !== 0) fail(`wrangler failed${r.stderr ? `:\n${r.stderr}` : ''}`, 1)
  return r.stdout
}

function query(env, sql) {
  console.log(`-- ${env}\n${sql}`)
  const out = wrangler(env, ['--json', '--command', sql])
  const parsed = JSON.parse(out.slice(out.indexOf('[')))
  return parsed.flatMap(r => r.results ?? [])
}

function age(iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (m < 60) return `${m}m`
  if (m < 48 * 60) return `${Math.round(m / 60)}h`
  return `${Math.round(m / 1440)}d`
}

/** What the latest decision says about the category: the model's top category, Myra's block, or the error. */
function categoryOf(r) {
  if (!r.answer) return '-'
  if (r.answer === 'error') return printable(`error: ${r.reason}`.slice(0, 60))
  if (r.model === 'myra') return parseBlockReason(r.reason)?.category ?? '-'
  return printable(r.reason) || '-'
}

function list(env) {
  const rows = query(env, queueSql())
  if (!rows.length) return console.log('\nthe queue is empty.')
  // Every field goes through printable: a title is the author's text, and a terminal acts on escape sequences.
  const table = rows.map(r => [printable(r.path), printable(r.title.slice(0, 40)), printable(r.seeded ? `${r.triage} (seed, public)` : r.triage), printable(r.answer ?? '-'), categoryOf(r), age(r.created_at)])
  const head = ['path', 'title', 'triage', 'answer', 'category', 'age']
  const w = head.map((h, i) => Math.max(h.length, ...table.map(t => String(t[i]).length)))
  const line = t => t.map((c, i) => String(c).padEnd(w[i])).join('  ')
  console.log('\n' + line(head))
  for (const t of table) console.log(line(t))
}

function decide(env, d, yes) {
  let stmts
  try {
    stmts = decideStatements(d)
  } catch (e) {
    if (e instanceof DecideError) fail(e.message)
    throw e
  }
  const [before] = query(env, nodeSql(d.path))
  if (!before) fail(`no node at ${d.path} on ${env}`)
  console.log(`\n${describeNode(before)}\n`)
  const sql = toSqlScript(stmts)
  const dir = join(SITE, '.wrangler/triage') // .wrangler/ is git-ignored
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${env}-${d.action}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`)
  writeFileSync(file, sql)
  console.log(`-- ${env}, ${file}\n${sql}`)
  wrangler(env, ['--file', file, ...(yes ? ['--yes'] : [])], true)
  const [after] = query(env, nodeSql(d.path))
  if (after?.triage !== (d.action === 'block' ? 'blocked' : 'clear')) fail(`${d.path} is ${printable(after?.triage ?? 'gone')}, not ${d.action === 'block' ? 'blocked' : 'clear'}: nothing was applied?`, 3)
  console.log(`\n${d.path} is ${printable(after.triage)} now.`)
}

const { pos, env, as, yes } = parse(process.argv.slice(2))
const [cmd, ...rest] = pos
if (cmd === 'list' && rest.length === 0) list(env)
else if (cmd === 'clear' && rest.length === 2) decide(env, { action: 'clear', path: rest[0], reason: rest[1], by: as }, yes)
else if (cmd === 'block' && rest.length === 3) decide(env, { action: 'block', path: rest[0], category: rest[1], reason: rest[2], by: as }, yes)
else fail(USAGE)
