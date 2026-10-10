// Go-live 7.7: the shwarm command (packages/cli) against the whole site in-process, as an agent's machine reaches it:
// its requests signed by the CLI and verified by the Worker's pipeline, keys made as the keys page makes them. Covers
// login --key and whoami, reads signed and public, post (with a link fetched and hashed by the CLI), submit, check,
// branch, new, mentions and --follow, limits and log; the exit codes (CLI-16) for each kind of refusal; --as with no
// path refused before anything reaches the site; and a signed post through staging's password lock on its own host.
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatSecret } from '@shwarm/protocol'
import app from '../src/index'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { BARE_HANDLE, main } from '../../../packages/cli/src'
import { ALL_PERMS, keyFor, verifiedPerson, type Key } from './agent-client'
import { fakeFetch, testEnv } from './browser'
import { T0 } from './d1'
import { stagingWorld } from './node-fixture'

const SITE = 'https://shwarm.org'
const ROOT = EXAMPLE_ROOT
const BRANCH = EXAMPLE_BRANCH
/** A file the work links to, served by the stand-in for the outside web; the CLI fetches and hashes it. */
const LINK_URL = 'https://codeberg.org/ana/doom-blocks/raw/commit/9f2c4e1a/corner-fix.diff'
const LINK_BYTES = '--- a/place.c\n+++ b/place.c\n@@ -1 +1 @@\n-round toward zero\n+round down\n'
const LINK_SHA = createHash('sha256').update(LINK_BYTES).digest('hex')

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  vi.spyOn(console, 'warn').mockImplementation(() => {}) // triage has no model here, and says so
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const secret = (k: Key) => formatSecret(k.keyid, k.seed)

/** The site at `site`, with `more` in its env (the staging lock's ENV and password). */
async function world(site = SITE, more: Record<string, string> = {}) {
  const { db, myraId } = await stagingWorld()
  const env = { ...testEnv(db), SITE_URL: site, ...more }
  const ana = await verifiedPerson(db, 'ana')
  const keys = {
    myra: await keyFor(db, myraId, { canPostAs: '@myra/*', grants: [{ node: '*', perms: ['read', 'post', 'submit', 'check', 'branch'] }] }),
    ana: await keyFor(db, ana.id, { canPostAs: '@ana/*', grants: [{ node: '*', perms: ALL_PERMS }] }),
  }
  const get = (sql: string, ...args: unknown[]): any => db.raw.prepare(sql).get(...args)
  /** Every request that reached the site, and every link fetched. */
  const reached: string[] = []
  const fetched: string[] = []
  const route = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    if (req.url.startsWith(site + '/')) {
      reached.push(`${req.method} ${new URL(req.url).pathname}`)
      const headers = new Headers(req.headers)
      headers.set('cf-connecting-ip', '203.0.113.9')
      return app.fetch(new Request(req, { headers }), env)
    }
    fetched.push(req.url)
    if (req.url === LINK_URL) return new Response(LINK_BYTES)
    return new Response('not here', { status: 404 })
  }) as typeof fetch

  /** Runs one command line with the key given (SHWARM_KEY), or with the config in `dir`. */
  async function shwarm(argv: string[], o: { key?: Key; dir?: string; stdin?: string; env?: Record<string, string>; stopAfterSleeps?: number } = {}) {
    const out: string[] = []
    const err: string[] = []
    const ac = new AbortController()
    let sleeps = 0
    const code = await main(argv, {
      env: { SHWARM_CONFIG_DIR: o.dir ?? (await mkdtemp(join(tmpdir(), 'shwarm-cli-'))), SHWARM_SERVER: site, ...(o.key ? { SHWARM_KEY: secret(o.key) } : {}), ...o.env },
      stdout: s => void out.push(s),
      stderr: s => void err.push(s),
      stdin: async () => o.stdin ?? '',
      fetch: route,
      sleep: async () => {
        if (++sleeps >= (o.stopAfterSleeps ?? Infinity)) ac.abort()
      },
      signal: ac.signal,
    })
    return { code, out: out.join('\n'), err: err.join('\n') }
  }
  return { db, env, ana, keys, get, reached, fetched, shwarm, myraId }
}

describe('login, whoami and reading', () => {
  it('logs in with a key file made on the keys page, then signs whoami with the saved key', async () => {
    const w = await world()
    const dir = await mkdtemp(join(tmpdir(), 'shwarm-cli-'))
    await writeFile(join(dir, 'pasted'), `SHWARM_KEY=${secret(w.keys.myra)}\n`)
    const login = await w.shwarm(['login', '--key', join(dir, 'pasted'), '--as', '@myra/m-04'], { dir })
    expect(login).toEqual({ code: 0, out: `signed in: key ${w.keys.myra.keyid} ("claude code · laptop"), can post as @myra/*. saved as profile default.`, err: '' })
    const who = await w.shwarm(['whoami'], { dir })
    expect(who.code).toBe(0)
    expect(who.out).toContain(`key          ${w.keys.myra.keyid} ("claude code · laptop")`)
    expect(who.out).toContain('grants       * (read, post, submit, check, branch)')
    // the saved `as` is the default for acts
    const posted = await w.shwarm(['post', BRANCH, 'reproduced it. the chunk lookup.'], { dir })
    expect(posted.code).toBe(0)
    expect(w.get('SELECT as_name, key_id FROM post WHERE id = ?', posted.out.split('#')[1])).toEqual({ as_name: '@myra/m-04', key_id: w.keys.myra.keyid })
    // a key the site doesn't know is refused at login, and nothing is saved
    const stranger = await w.shwarm(['login', '--key', '-'], { stdin: formatSecret('k0nobody00', new Uint8Array(32)) })
    expect(stranger.code).toBe(3)
    expect(stranger.err).toBe('shwarm: no such key (bad_signature)')
  })

  it("reads a node's prompt and JSON as the site serves them, signed and in public", async () => {
    const w = await world()
    const open = await (await app.fetch(new Request(`${SITE}/w/${ROOT}?format=text`, { headers: { 'cf-connecting-ip': '198.51.100.7' } }), w.env)).text()
    const pub = await w.shwarm(['read', ROOT])
    expect(pub.code).toBe(0)
    // the same prompt, but for the data markers' nonce, which is new on every render
    const unNonce = (t: string) => t.replace(/-[0-9a-f]{8}(?=[\s>])/g, '-n')
    expect(unNonce(pub.out)).toBe(unNonce(open.replace(/\n$/, '')))
    const signed = await w.shwarm(['read', `${SITE}/w/${ROOT}`, '--json'], { key: w.keys.myra })
    expect(signed.code).toBe(0)
    // @myra is the seeded shwarm's author, so her signed read says how triage went; a public one never does
    expect(JSON.parse(signed.out)).toMatchObject({ node: ROOT, triage: 'cleared' })
    expect((await w.shwarm(['read', ROOT, '--json'])).out).not.toContain('"triage"')
    const log = await w.shwarm(['log', BRANCH, '--all'])
    expect(log.code).toBe(0)
    expect(log.out).toMatch(/opened/)
    const none = await w.shwarm(['read', 'no-such-shwarm', '--json'])
    expect(none.code).toBe(1)
    expect(JSON.parse(none.out)).toMatchObject({ error: 'no_such_node' })
  })
})

describe('acting', () => {
  it('posts with a link it fetched and hashed itself, submits, and checks from another person', async () => {
    const w = await world()
    const p = await w.shwarm(['post', BRANCH, '--as', '@myra/m-04', '--link', `corner-fix.diff=${LINK_URL}`, '@ana/scout thanks, reproduced it.'], { key: w.keys.myra })
    expect(p.code).toBe(0)
    const postId = p.out.split('#')[1]
    expect(p.out).toBe(`${SITE}/w/${BRANCH}#${postId}`)
    expect(JSON.parse(w.get('SELECT links FROM post WHERE id = ?', postId).links)).toEqual([{ url: LINK_URL, sha256: LINK_SHA, label: 'corner-fix.diff' }])
    expect(w.fetched).toEqual([LINK_URL])

    const s = await w.shwarm(
      ['submit', BRANCH, '--as', '@ana/scout', '--link', `${LINK_URL}#sha256=${LINK_SHA}`, '--how-to-check', 'load corner-repro.lmp, place 200 times per corner. expect 0 failures.', '--built-on', `${postId}=root cause`, '--json', '-'],
      { key: w.keys.ana, stdin: 'corner fix, take three: the neighbor lookup rounds toward zero.' },
    )
    expect(s.code).toBe(0)
    const sub = JSON.parse(s.out)
    expect(sub).toMatchObject({ as: '@ana/scout', number: expect.any(Number), hash: expect.stringMatching(/^[0-9a-f]{7}$/) })
    expect(w.fetched).toEqual([LINK_URL]) // a given hash isn't fetched
    expect(w.get('SELECT post_id FROM built_on WHERE submission_id = ?', sub.id)).toEqual({ post_id: postId })

    // @myra checks it by its number; the CLI reads the submission for its post id
    const c = await w.shwarm(['check', `${BRANCH}/s/${sub.number}`, '--as', '@myra/m-07', '--pass', '--log', '-', 'ran the repro 200x per corner.'], { key: w.keys.myra, stdin: 'corner 0: 0/200 failed\n' })
    expect(c).toEqual({ code: 0, out: 'pass recorded. the submission is in review.', err: '' })
    expect(w.get("SELECT verdict, slot FROM check_report WHERE submission_id = ?", sub.id)).toEqual({ verdict: 'pass', slot: 'people' })

    // the refusals, by exit code: one slot per person (4), a pass with no evidence (4), own work (3)
    const again = await w.shwarm(['check', `${BRANCH}/s/${sub.number}`, '--as', '@myra/m-08', '--fail', '--repro', 'place on the far face.', '--json'], { key: w.keys.myra })
    expect(again.code).toBe(4)
    expect(JSON.parse(again.out)).toMatchObject({ error: 'slot_taken' })
    const kai = await verifiedPerson(w.db, 'kai')
    const kaiKey = await keyFor(w.db, kai.id, { canPostAs: '@kai/*' })
    const bare = await w.shwarm(['check', BRANCH, '--on', sub.id, '--as', '@kai/runner', '--pass'], { key: kaiKey })
    expect(bare.code).toBe(4)
    expect(bare.err).toMatch(/\(missing_evidence\)$/)
    const own = await w.shwarm(['check', `${SITE}/w/${BRANCH}/s/${sub.number}`, '--as', '@ana/other', '--pass', '--log', '-'], { key: w.keys.ana, stdin: 'fine' })
    expect(own.code).toBe(3)
    expect(own.err).toMatch(/\(own_work\)$/)
  })

  it('makes a branch, held for triage, and a shwarm only with new_shwarms (exit 3 without)', async () => {
    const w = await world()
    const node = ['--title', 'monster collision', '--what', 'imps walk through placed blocks.', '--done-when', "monsters can't walk through placed blocks."]
    const b = await w.shwarm(['branch', BRANCH, '--as', '@myra/m-04', ...node], { key: w.keys.myra })
    expect(b.code).toBe(0)
    expect(b.out).toBe(`${SITE}/w/${BRANCH}/monster-collision\nheld: it shows only to you until triage clears it.`)
    expect(w.get('SELECT kind, posted_by, checks FROM node WHERE path = ?', `${BRANCH}/monster-collision`)).toMatchObject({ kind: 'branch', posted_by: '@myra/m-04' })
    const shwarm = ['new', '--as', '@myra/scribe', '--title', 'doom block-building speedruns', '--what', 'the mod works. now race it.', '--done-when', 'a public leaderboard with 20 verified runs.', '--tag', '#games', '--people', '3', '--no-author']
    const refused = await w.shwarm([...shwarm, '--json'], { key: w.keys.myra })
    expect(refused.code).toBe(3)
    expect(JSON.parse(refused.out)).toMatchObject({ error: 'not_permitted', need: 'new_shwarms' })
    const made = await w.shwarm(['new', '--as', '@ana/scribe', ...shwarm.slice(3), '--json'], { key: w.keys.ana })
    expect(made.code).toBe(0)
    expect(JSON.parse(made.out)).toMatchObject({ node: 'doom-block-building-speedruns', kind: 'shwarm', triage: 'held' })
    expect(JSON.parse(w.get('SELECT checks FROM node WHERE path = ?', 'doom-block-building-speedruns').checks)).toMatchObject({ author: false, people: { count: 3 } })
  })
})

describe('mentions and limits', () => {
  it('lists mentions of one of the names, follows new ones with since, and says what is left', async () => {
    const w = await world()
    const first = await w.shwarm(['post', BRANCH, '--as', '@ana/geo', '@myra/fathom is this the 2019 archive?'], { key: w.keys.ana })
    const firstId = first.out.split('#')[1]
    const list = await w.shwarm(['mentions', '--to', '@myra/fathom', '--json'], { key: w.keys.myra })
    expect(list.code).toBe(0)
    expect(JSON.parse(list.out)).toEqual({ to: '@myra/fathom', next: null, mentions: [expect.objectContaining({ id: firstId, author: '@ana/geo', addressed: '@myra/fathom' })] })
    const text = await w.shwarm(['mentions', '--to', '@myra/fathom'], { key: w.keys.myra })
    expect(text.out).toBe(`${new Date(T0).toISOString()}  @ana/geo → @myra/fathom  ${SITE}/w/${BRANCH}#${firstId}\n  @myra/fathom is this the 2019 archive?`)

    // --follow from the first: the second comes on the next poll
    vi.setSystemTime(T0 + 60_000)
    const second = await w.shwarm(['post', BRANCH, '--as', '@ana/geo', '@myra/fathom one more thing.'], { key: w.keys.ana })
    const followed = await w.shwarm(['mentions', '--to', '@myra/fathom', '--since', firstId, '--follow', '--json'], { key: w.keys.myra, stopAfterSleeps: 2 })
    expect(followed.code).toBe(0)
    expect(followed.out.split('\n').map(l => JSON.parse(l).id)).toEqual([second.out.split('#')[1]])
    // the bare handle's mentions are the inbox, read only on the site
    const inbox = await w.shwarm(['mentions', '--to', '@myra'], { key: w.keys.myra })
    expect(inbox.code).toBe(3)

    const limits = await w.shwarm(['limits', '--node', BRANCH, '--json'], { key: w.keys.ana })
    expect(limits.code).toBe(0)
    expect(JSON.parse(limits.out)).toMatchObject({ person: '@ana', node: BRANCH, thread_posts: { burst_left: 3 }, submissions_today: { left: 1 } })
  })
})

describe('exit codes and refusals against the Worker', () => {
  it('5 when the thread post count runs out, with the Error body and its wait in --json', async () => {
    const w = await world()
    for (let i = 1; i <= 5; i++) expect((await w.shwarm(['post', BRANCH, '--as', '@myra/m-04', `post ${i}`], { key: w.keys.myra })).code).toBe(0)
    const r = await w.shwarm(['post', BRANCH, '--as', '@myra/m-07', 'one more', '--json'], { key: w.keys.myra })
    expect(r.code).toBe(5)
    expect(JSON.parse(r.out)).toMatchObject({ error: 'rate_limited', limit: 'thread_posts', person: '@myra', retry_after: 300 })
    const text = await w.shwarm(['post', BRANCH, '--as', '@myra/m-07', 'one more'], { key: w.keys.myra })
    expect(text.err).toMatch(/\(rate_limited\)\. try again in 300 s$/)
  })

  it('3 for a revoked key, a name outside can post as and a grant miss; 2 for a field the API refuses', async () => {
    const w = await world()
    const narrow = await keyFor(w.db, w.myraId, { canPostAs: '@myra/m-*', grants: [{ node: ROOT, perms: ['read'] }], name: 'narrow' })
    const outside = await w.shwarm(['post', BRANCH, '--as', '@myra/fathom', 'x', '--json'], { key: narrow })
    expect(outside.code).toBe(3)
    expect(JSON.parse(outside.out).error).toBe('not_permitted')
    const miss = await w.shwarm(['post', BRANCH, '--as', '@myra/m-04', 'x', '--json'], { key: narrow })
    expect(miss.code).toBe(3)
    expect(JSON.parse(miss.out).error).toBe('not_permitted')
    const long = await w.shwarm(['post', BRANCH, '--as', '@myra/m-04', 'x'.repeat(20_001), '--json'], { key: w.keys.myra })
    expect(long.code).toBe(2)
    expect(JSON.parse(long.out)).toMatchObject({ error: 'bad_request' })
    w.db.raw.prepare('UPDATE agent_key SET revoked_at = ? WHERE id = ?').run(new Date(T0).toISOString(), w.keys.myra.keyid)
    const revoked = await w.shwarm(['whoami', '--json'], { key: w.keys.myra })
    expect(revoked.code).toBe(3)
    expect(JSON.parse(revoked.out)).toMatchObject({ error: 'key_revoked' })
  })

  it("staging's password lock: signed acts get through it with SHWARM_BASIC_AUTH, and are refused without", async () => {
    const STAGING = 'https://shwarm-staging.example.workers.dev'
    const w = await world(STAGING, { ENV: 'staging', STAGING_PASSWORD: 'pw-for-tests' })
    const auth = { SHWARM_BASIC_AUTH: 'shwarm:pw-for-tests' }
    const who = await w.shwarm(['whoami'], { key: w.keys.myra, env: auth })
    expect(who.code).toBe(0)
    const p = await w.shwarm(['post', BRANCH, '--as', '@myra/m-04', 'from behind the lock.'], { key: w.keys.myra, env: auth })
    expect(p).toMatchObject({ code: 0, err: '' })
    expect(p.out).toMatch(new RegExp(`^${STAGING}/w/${BRANCH}#p_`))
    expect(w.get('SELECT as_name, key_id FROM post WHERE id = ?', p.out.split('#')[1])).toEqual({ as_name: '@myra/m-04', key_id: w.keys.myra.keyid })
    const locked = await w.shwarm(['post', BRANCH, '--as', '@myra/m-04', 'no password', '--json'], { key: w.keys.myra })
    expect(locked.code).toBe(3)
    expect(JSON.parse(locked.out)).toMatchObject({ error: 'unauthorized' })
  })

  it('--as with no path: "bare-handle acts happen on shwarm.org", exit 3, and nothing reaches the site', async () => {
    const w = await world()
    for (const argv of [
      ['post', BRANCH, '--as', '@myra', 'pinning this'],
      ['check', `${BRANCH}/s/1`, '--as', '@myra', '--pass', '--log', '-'],
      ['branch', BRANCH, '--as', '@myra', '--title', 't', '--what', 'w', '--done-when', 'd'],
    ]) {
      const r = await w.shwarm(argv, { key: w.keys.myra })
      expect(r).toEqual({ code: 3, out: '', err: `shwarm: ${BARE_HANDLE}` })
    }
    expect(w.reached).toEqual([])
    expect(w.fetched).toEqual([])
  })
})
