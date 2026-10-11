// A test agent key for one of the running example's demo accounts, on STAGING only (go-live 7.10; Myra's yes, Oct 10).
// The demo people (src/seed/example.ts: @bmo_fan, @finn_irl, …) can't sign in, so they can't open the keys page; this
// makes the key the way that page does (src/auth/keys.ts): a fresh Ed25519 pair here, only the public half and the
// grants go into D1, and the secret, shwarm_sk_<keyid>_<seed>, is written to a 0600 file and never printed.
//
//   npx tsx scripts/staging-test-key.mts --env staging --handle bmo_fan --out <file> [--post-as '*'] [--days 7]
//
// It refuses any --env but staging, any handle that isn't one of the example's demo people, and an account whose
// password isn't the seed's "sign-in disabled" marker (so never a real person's account, and never @myra). The grant is
// '*' with read, post, submit, check and branch (no new_shwarms). Revoke with:
//   npx wrangler d1 execute shwarm-staging --env staging --remote --command "UPDATE agent_key SET revoked_at = datetime('now') WHERE id = '<keyid>'"
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatSecret, newSeed, publicKeyFromSeed, toBase64url } from '@shwarm/protocol'
import { newKeyId, publicKeyProblem } from '../apps/site/src/auth/keys'
import { EXAMPLE_PEOPLE } from '../apps/site/src/seed/example'
import { sqlString } from '../apps/site/src/seed/sql'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(ROOT, 'apps/site')
const PERMS = ['read', 'post', 'submit', 'check', 'branch']

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
function die(msg: string): never {
  console.error(`staging-test-key: ${msg}`)
  process.exit(2)
}

if (arg('env') !== 'staging') die('only --env staging. this never makes keys anywhere else')
const handle = arg('handle') ?? die('--handle <one of the demo people> is needed')
if (!(EXAMPLE_PEOPLE as readonly string[]).includes(handle)) die(`@${handle} isn't one of the example's demo people (${EXAMPLE_PEOPLE.join(', ')})`)
const out = resolve(arg('out') ?? die('--out <file> for the secret is needed'))
if (existsSync(out)) die(`${out} exists; pick a new file`)
const tail = arg('post-as') ?? '*'
const days = Number(arg('days') ?? '7')
if (!Number.isInteger(days) || days < 1 || days > 90) die('--days is 1 to 90')

const seed = newSeed()
const publicKey = toBase64url(await publicKeyFromSeed(seed))
const bad = await publicKeyProblem(publicKey)
if (bad) die(bad)
const keyid = newKeyId()
const now = Date.now()
const at = new Date(now).toISOString()
const expires = new Date(now + days * 86_400_000).toISOString()
const canPostAs = `@${handle}/${tail}`

// One file, all or nothing (wrangler's --remote --file). The person must be a seeded demo account.
const who = `(SELECT id FROM person WHERE handle = ${sqlString(handle)} AND password_hash LIKE '!seed%' AND status = 'active')`
const sql = [
  `INSERT INTO agent_key (id, person_id, name, public_key, can_post_as, expires_at, created_at)
   SELECT ${sqlString(keyid)}, ${who}, ${sqlString('staging test key (go-live 7.10)')}, ${sqlString(publicKey)}, ${sqlString(canPostAs)}, ${sqlString(expires)}, ${sqlString(at)}
   WHERE ${who} IS NOT NULL;`,
  `INSERT INTO key_grant (key_id, node, perms) SELECT ${sqlString(keyid)}, '*', ${sqlString(JSON.stringify(PERMS))} WHERE EXISTS (SELECT 1 FROM agent_key WHERE id = ${sqlString(keyid)});`,
].join('\n')
const file = join(SITE, '.wrangler/test-keys', `${keyid}.sql`) // .wrangler/ is git-ignored; holds no secret
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, sql + '\n')

// D1's API answers 7403 now and then for no reason; try again.
let ok = false
for (let i = 0; i < 8 && !ok; i++) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'shwarm-staging', '--env', 'staging', '--remote', '--yes', '--file', file], { cwd: SITE, encoding: 'utf8' })
  if (r.status === 0) ok = true
  else if (/7403/.test(r.stdout + r.stderr)) spawnSync('sleep', ['4'])
  else die(`wrangler failed:\n${r.stderr || r.stdout}`)
}
if (!ok) die('wrangler kept answering 7403')

// Read it back: the key is there and belongs to the handle.
let back = ''
for (let i = 0; i < 8; i++) {
  const r = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'shwarm-staging', '--env', 'staging', '--remote', '--json', '--command', `SELECT p.handle, k.can_post_as FROM agent_key k JOIN person p ON p.id = k.person_id WHERE k.id = ${sqlString(keyid)}`],
    { cwd: SITE, encoding: 'utf8' },
  )
  back = r.stdout
  if (r.status === 0) break
  spawnSync('sleep', ['4'])
}
let row: { handle: string; can_post_as: string } | undefined
try {
  row = JSON.parse(back)[0].results[0]
} catch {}
if (row?.handle !== handle) {
  rmSync(file)
  die(`the key didn't land for @${handle} (was the account there and seeded?)`)
}

mkdirSync(dirname(out), { recursive: true, mode: 0o700 })
writeFileSync(out, formatSecret(keyid, seed) + '\n', { mode: 0o600 })
console.log(JSON.stringify({ handle, keyid, can_post_as: row.can_post_as, grants: [{ node: '*', perms: PERMS }], expires_at: expires, secret_file: out }))
