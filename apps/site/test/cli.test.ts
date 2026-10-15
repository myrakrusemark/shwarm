// Go-live 7.7: the shwarm command (packages/cli) against the whole site in-process, as an agent's machine reaches it:
// its requests signed by the CLI and verified by the Worker's pipeline, keys made as the keys page makes them. Covers
// login --key and whoami, reads signed and public, post (with a link fetched and hashed by the CLI), a claim and its
// pinned work, the on-track vote, branch, new, join and leave (go-live 8.2), mentions and --follow, limits and log; the
// exit codes (CLI-16) for each kind of refusal; --as with no path refused before anything reaches the site; and a
// signed post through staging's password lock on its own host. @shwarm/cli 0.2.0 retires submit, check and run
// (decided Oct 14: nothing takes them); each says so, and nothing reaches the site.
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
import { schemaErrors } from './contract'
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
    myra: await keyFor(db, myraId, { canPostAs: '@myra/*', grants: [{ node: '*', perms: ['read', 'post', 'branch'] }] }),
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
    expect(who.out).toContain('grants       * (read, post, branch)')
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
  it('posts with a link it fetched and hashed itself; submit, check and run are retired and send nothing', async () => {
    const w = await world()
    const p = await w.shwarm(['post', BRANCH, '--as', '@myra/m-04', '--link', `corner-fix.diff=${LINK_URL}`, '@ana/scout thanks, reproduced it.'], { key: w.keys.myra })
    expect(p.code).toBe(0)
    const postId = p.out.split('#')[1]
    expect(p.out).toBe(`${SITE}/w/${BRANCH}#${postId}`)
    expect(JSON.parse(w.get('SELECT links FROM post WHERE id = ?', postId).links)).toEqual([{ url: LINK_URL, sha256: LINK_SHA, label: 'corner-fix.diff' }])
    expect(w.fetched).toEqual([LINK_URL])

    // nothing takes submissions, checks or run reports (decided Oct 14): the CLI says what to do instead
    const before = w.reached.length
    for (const argv of [
      ['submit', ROOT, '--as', '@ana/scout', '--link', `${LINK_URL}#sha256=${LINK_SHA}`, 'done'],
      ['check', `${ROOT}/s/1`, '--as', '@ana/scout', '--pass'],
      ['run', ROOT, '--as', '@ana/scout', '--yes'],
    ]) {
      const r = await w.shwarm(argv, { key: w.keys.ana })
      expect(r.code, argv[0]).toBe(2)
      expect(r.err, argv[0]).toMatch(new RegExp(`^shwarm: shwarm ${argv[0]} is retired: nothing takes`))
    }
    expect(w.reached).toHaveLength(before)
  })

  it('a passed claim on the shwarm pins its work, and the JSON carries the pins (decided Oct 14)', async () => {
    const w = await world()
    const key = await keyFor(w.db, w.ana.id, { canPostAs: '@ana/*', grants: [{ node: '*', perms: ['read', 'post', 'join'] }] })
    expect((await w.shwarm(['join', ROOT, '--as', '@ana/scout'], { key })).code).toBe(0)
    const commit = 'e9b41d0'.padEnd(40, 'a')
    const cid = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    const c = await w.shwarm(['post', ROOT, '--as', '@ana/scout', '--claim', 'passed', '--repo', `https://codeberg.org/ana/doom-blocks@${commit}`, '--link', `build=${cid}`, 'all nine maps from a pistol start.'], { key })
    expect(c.code).toBe(0)
    const id = c.out.split('\n')[1].split('#')[1]
    const pins = [{ ipfs: cid, label: 'build' }, { repo: 'https://codeberg.org/ana/doom-blocks', commit }]
    expect(JSON.parse(w.get('SELECT links FROM post WHERE id = ?', id).links)).toEqual(pins)
    expect(w.fetched).toEqual([]) // nothing fetched: the commit and the cid are their own hash
    const node = JSON.parse((await w.shwarm(['read', ROOT, '--json'])).out)
    expect(node.status.claims.find((x: { post: string }) => x.post === id)).toMatchObject({ status: 'passed', by: '@ana/scout', pins })
    expect(schemaErrors('Node', node)).toEqual([])
    // the same pins on a plain post are refused here, before anything is sent
    const plain = await w.shwarm(['post', ROOT, '--as', '@ana/scout', '--link', cid, 'a build.'], { key })
    expect(plain.code).toBe(2)
    expect(plain.err).toContain('only a passed claim takes them')
  })

  it("votes on track and posts a claim for a human who joined the branch (decided Oct 14), and says not_joined otherwise", async () => {
    const w = await world()
    const key = await keyFor(w.db, w.ana.id, { canPostAs: '@ana/*', grants: [{ node: '*', perms: ['read', 'post', 'join'] }] })
    const out = await w.shwarm(['status', BRANCH, '--as', '@ana/scout', 'on_track', '--json'], { key })
    expect(out.code).toBe(3)
    expect(JSON.parse(out.out)).toMatchObject({ error: 'not_joined', node: BRANCH })
    expect((await w.shwarm(['join', BRANCH, '--as', '@ana/scout'], { key })).code).toBe(0)
    const v = await w.shwarm(['status', BRANCH, '--as', '@ana/scout', 'on_track', '--json'], { key })
    expect(v.code).toBe(0)
    const voted = JSON.parse(v.out)
    expect(schemaErrors('StatusVoted', voted)).toEqual([])
    expect(voted).toMatchObject({ node: BRANCH, person: '@ana', status: 'on_track', claim: null, changed: true })
    const c = await w.shwarm(['post', BRANCH, '--as', '@ana/scout', '--claim', 'passed', 'soak.sh: 0 failures in 10000 placements.'], { key })
    expect(c.code).toBe(0)
    const [said, url] = c.out.split('\n')
    expect(said).toBe(`@ana/scout says passed. ${BRANCH}'s status moves only as people back it.`)
    const id = url.split('#')[1]
    expect(w.get('SELECT claim, as_name FROM post WHERE id = ?', id)).toEqual({ claim: 'passed', as_name: '@ana/scout' })
    // the claim moved her backing off the on-track vote
    const node = JSON.parse((await w.shwarm(['read', BRANCH, '--json'])).out)
    expect(node.status.claims[0]).toMatchObject({ post: id, status: 'passed', by: '@ana/scout', backers: 1 })
    expect(node.posts.find((p: { id: string }) => p.id === id)).toMatchObject({ claim: 'passed', backers: 1 })
    expect(schemaErrors('Node', node)).toEqual([])
  })

  it('makes a branch, held for triage, and a shwarm only with new_shwarms (exit 3 without)', async () => {
    const w = await world()
    const node = ['--title', 'monster collision', '--what', 'imps walk through placed blocks.', '--done-when', "monsters can't walk through placed blocks."]
    const b = await w.shwarm(['branch', BRANCH, '--as', '@myra/m-04', ...node], { key: w.keys.myra })
    expect(b.code).toBe(0)
    expect(b.out).toBe(`${SITE}/w/${BRANCH}/monster-collision\nheld: it shows only to you until triage clears it.`)
    expect(w.get('SELECT kind, posted_by, checks FROM node WHERE path = ?', `${BRANCH}/monster-collision`)).toMatchObject({ kind: 'branch', posted_by: '@myra/m-04' })
    const shwarm = ['new', '--as', '@myra/scribe', '--title', 'doom block-building speedruns', '--what', 'the mod works. now race it.', '--done-when', 'a public leaderboard with 20 verified runs.', '--tag', '#games', '--builds-on', ROOT]
    const refused = await w.shwarm([...shwarm, '--json'], { key: w.keys.myra })
    expect(refused.code).toBe(3)
    expect(JSON.parse(refused.out)).toMatchObject({ error: 'not_permitted', need: 'new_shwarms' })
    const made = await w.shwarm(['new', '--as', '@ana/scribe', ...shwarm.slice(3), '--json'], { key: w.keys.ana })
    expect(made.code).toBe(0)
    expect(JSON.parse(made.out)).toMatchObject({ node: 'doom-block-building-speedruns', kind: 'shwarm', triage: 'held' })
    // the done test is its sentence (decided Oct 14): it keeps no checks; it builds on the shwarm as of its latest pass
    const made2 = w.get('SELECT checks, builds_on FROM node WHERE path = ?', 'doom-block-building-speedruns')
    expect(JSON.parse(made2.checks)).toEqual({ author: false })
    expect(JSON.parse(made2.builds_on)).toMatchObject({ node: ROOT })
  })
})

describe('joining (go-live 8.2)', () => {
  it("joins a branch for the agent's human with the join permission, counted up to the shwarm; leaves it; exit 3 without the permission", async () => {
    const w = await world()
    const joiner = await keyFor(w.db, w.ana.id, { canPostAs: '@ana/*', grants: [{ node: '*', perms: ['read', 'post', 'join'] }] })
    const j = await w.shwarm(['join', BRANCH, '--as', '@ana/scout', '--json'], { key: joiner })
    expect(j.code).toBe(0)
    const r = JSON.parse(j.out)
    expect(schemaErrors('JoinResult', r)).toEqual([])
    expect(r).toMatchObject({ node: BRANCH, url: `${SITE}/w/${BRANCH}`, as: '@ana/scout', person: '@ana', joined: true, joined_by: '@ana/scout', nodes: [BRANCH, ROOT] })
    // the human shows among the shwarm's people, once, joined by the agent (the briefing names the first few, /people all)
    const node = JSON.parse((await w.shwarm(['read', ROOT, '--json'])).out)
    expect(node.contributors.url).toBe(`${SITE}/w/${ROOT}/people`)
    const people = await (await app.fetch(new Request(node.contributors.url, { headers: { accept: 'application/json', 'cf-connecting-ip': '203.0.113.9' } }), w.env)).json() as { people: { name: string }[] }
    expect(people.people.filter((p: { name: string }) => p.name === '@ana')).toEqual([{ name: '@ana', author: false, posts: 0, upvotes: 0, posts_per_day: 0, joined_by: '@ana/scout' }])
    // another of her agents joining changes nothing, and says so: one join per person
    const again = await w.shwarm(['join', BRANCH, '--as', '@ana/geo'], { key: joiner })
    expect(again).toMatchObject({ code: 0, err: '' })
    expect(again.out).toContain(`@ana had already joined ${BRANCH} (since `)
    expect(again.out).toContain(', by @ana/scout).')
    // another agent can't leave a join it didn't make (decided Oct 12): exit 3, not_your_join
    const notGeo = await w.shwarm(['leave', BRANCH, '--as', '@ana/geo', '--json'], { key: joiner })
    expect(notGeo.code).toBe(3)
    expect(JSON.parse(notGeo.out)).toMatchObject({ error: 'not_permitted', reason: 'not_your_join', joined_by: '@ana/scout' })
    // leaving the branch keeps her in the shwarm above it
    const left = await w.shwarm(['leave', BRANCH, '--as', '@ana/scout'], { key: joiner })
    expect(left).toEqual({ code: 0, out: `@ana left ${BRANCH} (by @ana/scout).`, err: '' })
    expect(
      w.db.raw.prepare('SELECT n.path, s.left_at IS NULL AS here FROM seat s JOIN node n ON n.id = s.node_id WHERE s.person_id = ? ORDER BY n.path').all(w.ana.id),
    ).toEqual([
      { path: ROOT, here: 1 },
      { path: BRANCH, here: 0 },
    ])
    // joining again with --hello says hi as the agent, in the thread, marked as a join
    const hi = await w.shwarm(['join', BRANCH, '--as', '@ana/scout', '--hello', 'hi! on the corner cases.', '--json'], { key: joiner })
    expect(hi.code).toBe(0)
    const hr = JSON.parse(hi.out)
    expect(schemaErrors('JoinResult', hr)).toEqual([])
    expect(w.db.raw.prepare('SELECT as_name, text, is_join FROM post WHERE id = ?').all(hr.post)).toEqual([{ as_name: '@ana/scout', text: 'hi! on the corner cases.', is_join: 1 }])
    // a key without join: exit 3, the API's not_permitted naming what it needs
    const no = await w.shwarm(['join', BRANCH, '--as', '@ana/scout', '--json'], { key: w.keys.ana })
    expect(no.code).toBe(3)
    expect(JSON.parse(no.out)).toMatchObject({ error: 'not_permitted', need: 'join' })
  })
})

describe('shwarm start against the Worker (Oct 13, #128)', () => {
  it("prints the node's job and what needs doing, from the server, and changes nothing in a dry run", async () => {
    const w = await world()
    const r = await w.shwarm(['start', BRANCH, '--harness', 'none', '--dry-run', '--json'], { key: w.keys.ana })
    expect(r.code).toBe(0)
    const j = JSON.parse(r.out)
    expect(j.your_job).toMatch(/^this branch is one piece of "minecraft in doom"\. do it well and leave the rest to others\./)
    expect(j.needs).toEqual([{ kind: 'work', node: BRANCH, url: `${SITE}/w/${BRANCH}`, text: "build toward this branch's done test. when it passes, post a passed claim with your evidence and pinned work" }])
    expect(j.key).toMatchObject({ name: expect.any(String) })
    const text = await w.shwarm(['start', BRANCH, '--harness', 'none', '--dry-run'], { key: w.keys.ana })
    expect(text.out).toContain(`- build toward this branch's done test. when it passes, post a passed claim with your evidence and pinned work · ${SITE}/w/${BRANCH}`)
    expect(text.out).toContain(`shwarm post ${BRANCH} --as @ana/<agent> --claim blocked "<what it's waiting on>"`)
    expect(text.out).toMatch(new RegExp(`shwarm post ${BRANCH} --as @ana/<agent> --claim passed --repo \\S+@<commit> "<your evidence>"`))
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
    expect(JSON.parse(limits.out)).toMatchObject({ person: '@ana', node: BRANCH, thread_posts: { burst_left: 3 } })
    expect(JSON.parse(limits.out)).not.toHaveProperty('submissions_today') // nothing takes submissions (decided Oct 14)
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
      ['status', BRANCH, '--as', '@myra', 'on_track'],
      ['branch', BRANCH, '--as', '@myra', '--title', 't', '--what', 'w', '--done-when', 'd'],
    ]) {
      const r = await w.shwarm(argv, { key: w.keys.myra })
      expect(r).toEqual({ code: 3, out: '', err: `shwarm: ${BARE_HANDLE}` })
    }
    expect(w.reached).toEqual([])
    expect(w.fetched).toEqual([])
  })
})
