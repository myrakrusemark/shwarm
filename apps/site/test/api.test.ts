// Go-live 7.4: the agent API's calls, through the whole site as an agent reaches it, and their answers checked against
// docs/openapi.yaml (test/contract.ts). The done-when cases: contract tests pass (a held create among them), every
// bare-handle act from a key returns 403, and createShwarm with a key lacking new_shwarms returns 403 not_permitted
// with need=new_shwarms.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERRORS } from '@shwarm/protocol'
import app from '../src/index'
import type { Grant } from '../src/core/actor'
import { MENTIONS_MAX } from '../src/api/routes'
import { KEY_REQUESTS } from '../src/api/limits'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { ALL_PERMS, keyFor, send, verifiedPerson, type Key, type Sent } from './agent-client'
import { fakeFetch, testEnv } from './browser'
import { hasResponse, responseSchema, schemaErrors, spec } from './contract'
import { T0 } from './d1'
import { PLAIN, stagingWorld } from './node-fixture'

const SITE = 'https://shwarm.org'
const ROOT = EXAMPLE_ROOT
const BRANCH = EXAMPLE_BRANCH
const SHA = '47853eff7820cb27b904be73451ddba31331f33fd68aca45fa2d66471c16c785'
const LINK = { url: 'https://codeberg.org/ana/doom-blocks/raw/branch/fixes/corner-fix.diff', sha256: SHA, label: 'corner-fix.diff' }

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

/** The running example on staging, @myra and @ana each with a key that may do everything. */
async function world() {
  const { db, myraId } = await stagingWorld()
  const env = { ...testEnv(db), SITE_URL: SITE }
  const ana = await verifiedPerson(db, 'ana')
  const keys = {
    myra: await keyFor(db, myraId, { canPostAs: '@myra/*', grants: [{ node: '*', perms: ALL_PERMS }] }),
    ana: await keyFor(db, ana.id, { canPostAs: '@ana/*', grants: [{ node: '*', perms: ALL_PERMS }] }),
  }
  const get = (sql: string, ...args: unknown[]): any => db.raw.prepare(sql).get(...args)
  const all = (sql: string, ...args: unknown[]): any[] => db.raw.prepare(sql).all(...args)
  const call = (key: Key, o: Parameters<typeof send>[3]) => send(app, env, key, o)
  /** Another verified person with a key; `grants` and can-post-as as given. */
  const someone = async (handle: string, grants: Grant[] = [{ node: '*', perms: ALL_PERMS }], canPostAs = `@${handle}/*`) => {
    const p = await verifiedPerson(db, handle)
    return { ...p, key: await keyFor(db, p.id, { canPostAs, grants }) }
  }
  const myraKey = (grants: Grant[], canPostAs = '@myra/*') => keyFor(db, myraId, { canPostAs, grants, name: 'another' })
  return { db, env, myraId, ana, keys, get, all, call, someone, myraKey }
}

/** The answer is one openapi.yaml lists for the operation, and its body follows the schema there. */
function conforms(op: string, r: Sent, schema?: string) {
  expect(hasResponse(op, r.status), `${op} answered ${r.status}, which openapi.yaml doesn't list`).toBe(true)
  const name = schema ?? (r.status === 429 ? 'RateLimitError' : r.status >= 400 ? 'Error' : responseSchema(op, r.status))
  expect(schemaErrors(name, r.json), `${name}: ${r.text.slice(0, 400)}`).toEqual([])
}

const post = (as: string | undefined, text = 'place, break, save, reload: all work.', extra: Record<string, unknown> = {}) => ({
  ...(as === undefined ? {} : { as }),
  kind: 'post',
  text,
  ...extra,
})
const nodeBody = (as: string | undefined, extra: Record<string, unknown> = {}) => ({
  ...(as === undefined ? {} : { as }),
  title: 'monster collision',
  what: 'imps walk through placed blocks; the blockmap is only built at level load.',
  done_when: "monsters can't walk through placed blocks, and placing one costs under 0.1 ms.",
  check: { author: true },
  ...extra,
})
const shwarmBody = (as: string | undefined, extra: Record<string, unknown> = {}) =>
  nodeBody(as, { title: 'doom block-building speedruns', what: 'the mod works. now race it.', done_when: 'a public leaderboard with 20 verified runs.', tags: ['#games'], ...extra })

/** The error codes nothing answers with since Oct 14 (submissions, checks and locks retired), kept while v0 is additive. */
const RETIRED = ['not_established', 'slot_taken', 'not_a_submission', 'shwarm_closed', 'missing_evidence', 'missing_repro', 'hash_mismatch', 'log_too_large']

/** Submission #2 on the shwarm, as one from before Oct 14 reads (history, written raw: nothing takes submissions now). */
function oldSubmission(w: Awaited<ReturnType<typeof world>>): string {
  const root = w.get('SELECT id FROM node WHERE path = ?', ROOT).id
  const had = w.get('SELECT post_id FROM submission WHERE node_id = ? AND number = 2', root)
  if (had) return had.post_id
  w.db.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_oldsub0002', ?, ?, '@myra/m-07', 'submission', 'two-line fix on top of #1.', ?)").run(root, w.myraId, new Date(T0 - 3_600_000).toISOString())
  w.db.raw.prepare("INSERT INTO submission (post_id, node_id, number, hash, how_to_check, status) VALUES ('p_oldsub0002', ?, 2, ?, 'place 200 times per corner.', 'superseded')").run(root, 'b'.repeat(64))
  return 'p_oldsub0002'
}

describe('postToNode', () => {
  it('posts to a thread as an agent: 201, PostCreated, the limits left in the body and the headers', async () => {
    const w = await world()
    const replyTo = w.get("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.kind = 'post' ORDER BY p.created_at LIMIT 1", BRANCH).id
    const r = await w.call(w.keys.myra, { path: `/w/${BRANCH}`, body: post('@myra/m-04', '@ana/scout thanks, reproduced it. the chunk lookup.', { links: [LINK], reply_to: replyTo }) })
    expect(r.status).toBe(201)
    conforms('postToNode', r, 'PostCreated')
    expect(r.json).toEqual({
      id: expect.stringMatching(/^p_/),
      url: `${SITE}/w/${BRANCH}#${r.json.id}`,
      node: BRANCH,
      as: '@myra/m-04',
      at: new Date(T0).toISOString(),
      mentions: ['@ana/scout'],
      limits: { thread_posts: { burst_left: 4, then: '1 per 5 min' } },
    })
    expect(r.res.headers.get('ratelimit-policy')).toBe('"thread";q=5;w=1500, "requests";q=120;w=60')
    expect(r.res.headers.get('ratelimit')).toBe('"thread";r=4;t=0, "requests";r=119;t=0')
    expect(w.get('SELECT as_name, key_id, kind, links, reply_to FROM post WHERE id = ?', r.json.id)).toEqual({
      as_name: '@myra/m-04',
      key_id: w.keys.myra.keyid,
      kind: 'post',
      links: JSON.stringify([LINK]),
      reply_to: replyTo,
    })
    // a body with no kind is a thread post (protocol §6)
    const plain = await w.call(w.keys.myra, { path: `/w/${BRANCH}`, body: { as: '@myra/m-04', text: 'and the corners.' } })
    expect(plain.status).toBe(201)
  })

  it('says when the thread post count runs out: 429 with Retry-After and the wait in RateLimit', async () => {
    const w = await world()
    for (let i = 1; i <= 5; i++) {
      const r = await w.call(w.keys.myra, { path: `/w/${BRANCH}`, body: post('@myra/m-04', `post ${i}`) })
      expect(r.status).toBe(201)
      if (i === 5) expect(r.res.headers.get('ratelimit')).toBe('"thread";r=0;t=300, "requests";r=115;t=0')
    }
    // another agent of the same person shares the count
    const r = await w.call(w.keys.myra, { path: `/w/${BRANCH}`, body: post('@myra/m-07', 'one more') })
    expect(r.status).toBe(429)
    conforms('postToNode', r)
    expect(r.json).toMatchObject({ error: 'rate_limited', limit: 'thread_posts', person: '@myra', node: BRANCH, retry_after: 300 })
    expect(r.res.headers.get('retry-after')).toBe('300')
    expect(r.res.headers.get('ratelimit')).toBe('"thread";r=0;t=300, "requests";r=114;t=0')
  })

  it('refuses what it can not read as 400: bad JSON, a non-object, an unknown kind or field, `attach` for `links`', async () => {
    const w = await world()
    const cases: [unknown, string][] = [
      ['{"as": "@myra/m-04", ', 'the body is not JSON'],
      [['a list'], 'send a JSON object as the body'],
      [{ as: '@myra/m-04', kind: 'vote', text: 'x' }, 'kind is post or status'],
      // the author's sign-off and dead end retired on Oct 14: kinds like any other
      [{ as: '@myra/m-04', kind: 'sign_off', text: 'x' }, 'kind is post or status'],
      [{ as: '@myra/m-04', kind: 'dead_end', text: 'x' }, 'kind is post or status'],
      [post('@myra/m-04', 'x', { colour: 'red' }), 'a post has unknown fields: colour'],
      [post('@myra/m-04', 'x', { attach: [LINK] }), 'links go in `links`, not `attach`'],
      [post('@myra/m-04', 'x'.repeat(20_001)), 'text is longer than 20000 characters'],
      [post('@myra/m-04', 'x', { links: [{ url: 'https://example.org/a.zip' }] }), 'links[0] needs a sha256 (a file) or a commit (a repo)'],
    ]
    for (const [body, message] of cases) {
      const r = await w.call(w.keys.myra, { path: `/w/${BRANCH}`, body: typeof body === 'string' ? body : body })
      expect(r.status, message).toBe(400)
      expect(r.json.message).toBe(message)
      conforms('postToNode', r)
    }
    expect(w.all('SELECT id FROM post WHERE key_id = ?', w.keys.myra.keyid)).toEqual([])
  })

  it("answers a node the key's human can't see as not there, and lets the author's own agents in", async () => {
    const w = await world()
    const made = await w.call(w.keys.ana, { path: `/w/${BRANCH}/branches`, body: nodeBody('@ana/scout') })
    expect(made.status).toBe(202)
    const theirs = await w.call(w.keys.myra, { path: `/w/${made.json.node}`, body: post('@myra/m-04') })
    expect(theirs.status).toBe(404)
    expect(theirs.json).toMatchObject({ error: 'no_such_node' })
    conforms('postToNode', theirs)
    expect((await w.call(w.keys.ana, { path: `/w/${made.json.node}`, body: post('@ana/scout') })).status).toBe(201)
    expect((await w.call(w.keys.myra, { path: '/w/no-such-shwarm', body: post('@myra/m-04') })).json).toMatchObject({ error: 'no_such_node' })
    // the name is read first, as core reads it: a bare `as` is refused as such anywhere
    expect((await w.call(w.keys.myra, { path: `/w/${made.json.node}`, body: post('@myra') })).json).toMatchObject({ error: 'bare_handle_needs_human' })
    expect((await w.call(w.keys.myra, { path: '/w/no-such-shwarm', body: post('@myra') })).json).toMatchObject({ error: 'bare_handle_needs_human' })
  })
})

describe('one model for every node (decided Oct 14)', () => {
  it('takes no submission, people check or run report on any node: 400, a kind like any unknown one (Oct 15), and writes nothing', async () => {
    const w = await world()
    const lee = await w.someone('lee')
    const before = w.get('SELECT (SELECT COUNT(*) FROM post) AS posts, (SELECT COUNT(*) FROM submission) AS subs, (SELECT COUNT(*) FROM check_report) AS checks')
    for (const path of [ROOT, BRANCH]) {
      const sub = await w.call(w.keys.ana, { path: `/w/${path}`, body: { as: '@ana/scout', kind: 'submission', text: 'corner fix.', links: [LINK], how_to_check: 'place 200 times per corner.' } })
      expect(sub.status, path).toBe(400)
      expect(sub.json).toEqual({ error: 'bad_request', message: 'kind is post or status' })
      conforms('postToNode', sub)
      for (const body of [
        { as: '@lee/r', verdict: 'pass', log: 'corner 0: 0/200 failed' },
        { as: '@lee/r', slot: 'run', submission_hash: 'aaaaaaa', script_hash: '5d02b7e', exit: 0, log: 'ok', env: 'linux' },
        { as: '@lee/r', slot: 'author', verdict: 'pass', text: 'checked it' },
      ]) {
        const r = await w.call(lee.key, { path: `/w/${path}`, body: { kind: 'check', on: 'p_aaaaaaaaaa', ...body } })
        expect(r.status, path).toBe(400)
        expect(r.json).toEqual({ error: 'bad_request', message: 'kind is post or status' })
        conforms('postToNode', r)
      }
      // the author's sign-off and dead end, and reopen, went the same way: unknown kinds
      for (const kind of ['sign_off', 'dead_end', 'reopen', 'run']) {
        const r = await w.call(w.keys.ana, { path: `/w/${path}`, body: { as: '@ana/scout', kind, text: 'x' } })
        expect(r.json, kind).toEqual({ error: 'bad_request', message: 'kind is post or status' })
      }
    }
    expect(w.get('SELECT (SELECT COUNT(*) FROM post) AS posts, (SELECT COUNT(*) FROM submission) AS subs, (SELECT COUNT(*) FROM check_report) AS checks')).toEqual(before)
  })

  it("a passed claim on the shwarm links the work: a repo, a file, ipfs:// and magnet:; another post's links are https only", async () => {
    const w = await world()
    const kai = await w.someone('kai', [{ node: '*', perms: ['read', 'post', 'join'] }])
    expect((await w.call(kai.key, { path: `/w/${ROOT}/join`, body: { as: '@kai/geo' } })).status).toBe(200)
    const pins = [
      { repo: 'https://codeberg.org/kai/doom-blocks', commit: 'e9b41d0'.padEnd(40, 'a') },
      LINK,
      { ipfs: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/mid.pk3', label: 'mod build' },
      { magnet: 'magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=mid.pk3' },
      { repo: 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5', commit: 'e9b41d0'.padEnd(40, 'b') },
    ]
    const made = await w.call(kai.key, { path: `/w/${ROOT}`, body: post('@kai/geo', 'all nine maps from a pistol start, 60 fps.', { claim: 'passed', links: pins }) })
    expect(made.status).toBe(201)
    conforms('postToNode', made)
    expect(made.json.claim).toBe('passed')
    const node = await w.call(kai.key, { path: `/w/${ROOT}?format=json` })
    conforms('getNode', node)
    expect(node.json.status.claims.find((c: any) => c.post === made.json.id)).toMatchObject({ status: 'passed', by: '@kai/geo', pins })
    // a plain post (or a blocked claim) takes only https links
    const plain = await w.call(kai.key, { path: `/w/${ROOT}`, body: post('@kai/geo', 'a build.', { links: [pins[2]] }) })
    expect(plain.status).toBe(400)
    conforms('postToNode', plain)
  })

  it("marking a shwarm passed is its author's act, on the site: 403 bare_handle_needs_human, nothing written", async () => {
    const w = await world()
    const r = await w.call(w.keys.myra, { path: `/w/${ROOT}`, body: { as: '@myra/m-04', kind: 'mark_passed', post: 'p_aaaaaaaaaa' } })
    expect(r.status).toBe(403)
    expect(r.json).toMatchObject({ error: 'bare_handle_needs_human', message: 'marking your shwarm passed happens only on the site, as @myra' })
    conforms('postToNode', r)
    expect(w.all("SELECT id FROM pass_record WHERE kind = 'author' AND at >= ?", new Date(T0).toISOString())).toEqual([])
  })
})

describe('bare-handle acts from a key', () => {
  it('every one returns 403, and none writes anything or is kept for a retry', async () => {
    const w = await world()
    const sub = w.get("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.kind = 'post' LIMIT 1", ROOT).id
    const at = (path: string, body: unknown, op: string) => ({ path, body, op })
    const acts = [
      at(`/w/${BRANCH}`, post('@myra'), 'postToNode'),
      at(`/w/${BRANCH}`, post(undefined), 'postToNode'),
      at(`/w/${ROOT}`, { as: '@myra', kind: 'status', status: 'on_track' }, 'postToNode'),
      // pinning isn't one any more (decided Oct 13): `pin: true` with the key's pin permission (status-vote.test.ts)
      ...['upvote', 'back', 'mark_passed', 'repitch', 'edit', 'flag'].map(kind => at(`/w/${ROOT}`, { as: '@myra/m-04', kind, post: sub }, 'postToNode')),
      // a shwarm's words: nobody changes them once posted (decided Oct 12); v0 keeps the same 403
      ...['edit', 'repitch'].map(kind => at(`/w/${ROOT}`, { as: '@myra/m-04', kind, title: 'a new title', what: 'new words.' }, 'postToNode')),
      at(`/w/${ROOT}/branches`, nodeBody('@myra'), 'createBranch'),
      at(`/w/${ROOT}/branches`, nodeBody(undefined), 'createBranch'),
      at('/shwarms', shwarmBody('@myra'), 'createShwarm'),
      at('/shwarms', shwarmBody(undefined), 'createShwarm'),
    ]
    const before = w.get('SELECT (SELECT COUNT(*) FROM post) AS posts, (SELECT COUNT(*) FROM node) AS nodes, (SELECT COUNT(*) FROM check_report) AS checks, (SELECT COUNT(*) FROM upvote) AS ups')
    for (const a of acts) {
      const r = await w.call(w.keys.myra, { path: a.path, body: a.body })
      expect(r.status, JSON.stringify(a.body)).toBe(403)
      expect(r.json.error, JSON.stringify(a.body)).toBe('bare_handle_needs_human')
      conforms(a.op, r)
    }
    // no edit path for a node's words (decided Oct 12): the 403 says it can't be changed, not that the site does it
    const fixed = await w.call(w.keys.myra, { path: `/w/${ROOT}`, body: { as: '@myra/m-04', kind: 'edit', title: 'a new title' } })
    expect(fixed.json.message).toBe("once a shwarm or branch is posted, it can't be changed")
    for (const method of ['PUT', 'PATCH'])
      expect((await w.call(w.keys.myra, { method, path: `/w/${ROOT}`, body: { as: '@myra/m-04', title: 'a new title' } })).status, method).not.toBeLessThan(400)
    // nothing reopens (decided Oct 9): `reopen` is no act at all, so it's an unknown kind
    const reopen = await w.call(w.keys.myra, { path: `/w/${BRANCH}`, body: { as: '@myra/m-04', kind: 'reopen' } })
    expect(reopen.status).toBe(400)
    expect(reopen.json).toMatchObject({ error: 'bad_request', message: 'kind is post or status' })
    conforms('postToNode', reopen)
    // the human's inbox: mentions of the bare handle are read only on the site
    const inbox = await w.call(w.keys.myra, { path: '/mentions?to=@myra' })
    expect(inbox.status).toBe(403)
    expect(inbox.json).toMatchObject({ error: 'not_your_name' })
    conforms('getMentions', inbox)
    expect(w.get('SELECT (SELECT COUNT(*) FROM post) AS posts, (SELECT COUNT(*) FROM node) AS nodes, (SELECT COUNT(*) FROM check_report) AS checks, (SELECT COUNT(*) FROM upvote) AS ups')).toEqual(before)
    expect(w.all('SELECT * FROM idempotency')).toEqual([])
  })
})

describe('createBranch', () => {
  it('202 held: the branch shows only to its author, and their keys read how triage went', async () => {
    const w = await world()
    const r = await w.call(w.keys.myra, { path: `/w/${BRANCH}/branches`, body: nodeBody('@myra/m-04') })
    expect(r.status).toBe(202)
    conforms('createBranch', r)
    const path = `${BRANCH}/monster-collision`
    // no fixed `state` and no `license` (decided Oct 15: the fields that only held one value left; everything is MIT)
    expect(r.json).toEqual({ url: `${SITE}/w/${path}`, node: path, kind: 'branch', triage: 'held', limits: { new_nodes_today: { left: 2 } } })
    expect(r.res.headers.get('ratelimit')).toBe('"new_nodes";r=2;t=0, "requests";r=119;t=0')
    expect(w.get('SELECT posted_by, author_id, kind FROM node WHERE path = ?', path)).toEqual({ posted_by: '@myra/m-04', author_id: w.myraId, kind: 'branch' })

    const read = (key: Key, accept = 'application/json') => w.call(key, { path: `/w/${path}`, headers: { accept } })
    const mine = await read(w.keys.myra)
    expect(mine.status).toBe(200)
    conforms('getNode', mine)
    expect(mine.json).toMatchObject({ node: path, kind: 'branch', author: '@myra', posted_by: '@myra/m-04', triage: 'held' })
    const text = await read(w.keys.myra, 'text/plain')
    expect(text.res.headers.get('content-type')).toMatch(/^text\/plain/)
    expect(text.text).toContain('monster collision')
    // anyone else, signed or not, finds nothing there
    const theirs = await read(w.keys.ana)
    expect(theirs.status).toBe(404)
    conforms('getNode', theirs)
    expect((await app.fetch(new Request(`${SITE}/w/${path}`, { headers: { 'cf-connecting-ip': '198.51.100.7' } }), w.env)).status).toBe(404)
    // a key of the author's that may not read there reads as the public does
    const noRead = await w.myraKey([{ node: '*', perms: ['post'] }])
    expect((await read(noRead)).status).toBe(404)

    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(path)
    expect((await read(w.keys.myra)).json.triage).toBe('cleared')
    expect((await read(w.keys.ana)).json).not.toHaveProperty('triage')
    w.db.raw.prepare("UPDATE node SET triage = 'blocked' WHERE path = ?").run(path)
    const blocked = await read(w.keys.myra)
    expect(blocked.json.triage).toBe('blocked')
    conforms('getNode', blocked)
  })

  it('takes a branch under any node the minute it is posted, naming no checks; refuses one without the branch permission, or with fields a branch has no use for', async () => {
    const w = await world()
    const fresh = await w.call(w.keys.myra, { path: `/w/${PLAIN}/branches`, body: nodeBody('@myra/m-04') })
    expect(fresh.status).toBe(202)
    expect(fresh.json).toMatchObject({ kind: 'branch', triage: 'held' })
    expect(w.get('SELECT state FROM node WHERE path = ?', fresh.json.node).state).toBe('live')
    // a branch never keeps an author check, so the one nodeBody asks for is dropped (decided Oct 13)
    expect(JSON.parse(w.get('SELECT checks FROM node WHERE path = ?', fresh.json.node).checks)).toEqual({ author: false })
    // nothing locks (decided Oct 14): a shwarm whose status is dead end still takes branches
    const plainId = w.get('SELECT id FROM node WHERE path = ?', PLAIN).id
    w.db.raw.prepare("INSERT OR REPLACE INTO branch_status (node_id, current, lead_hours, changed_at, at) VALUES (?, 'dead_end', 0, ?, ?)").run(plainId, new Date(T0).toISOString(), new Date(T0).toISOString())
    const ended = await w.call(w.keys.myra, { path: `/w/${PLAIN}/branches`, body: nodeBody('@myra/m-04', { title: 'another' }) })
    expect(ended.status).toBe(202)
    conforms('createBranch', ended)
    // a stored grant that still holds the retired submit and check gets nothing from them
    const plain = await w.myraKey([{ node: '*', perms: ['read', 'post', 'submit', 'check'] as any }])
    const denied = await w.call(plain, { path: `/w/${BRANCH}/branches`, body: nodeBody('@myra/m-04') })
    expect(denied.status).toBe(403)
    expect(denied.json).toMatchObject({ error: 'not_permitted', need: 'branch', node: BRANCH })
    conforms('createBranch', denied)
    // and GET /key lists the grant without them (decided Oct 15: they left the API)
    const key = await w.call(plain, { path: '/key' })
    expect(key.json.grants).toEqual([{ node: '*', perms: ['read', 'post'] }])
    conforms('getKey', key)
    const tags = await w.call(w.keys.myra, { path: `/w/${BRANCH}/branches`, body: nodeBody('@myra/m-04', { tags: ['#x'] }) })
    expect(tags.json).toMatchObject({ error: 'bad_request', message: 'a branch has unknown fields: tags' })
    // a branch may name no checks: its pass is a passed claim (decided Oct 14). it still needs a done test
    expect((await w.call(w.keys.myra, { path: `/w/${BRANCH}/branches`, body: nodeBody('@myra/m-04', { check: {} }) })).status).toBe(202)
    const empty = await w.call(w.keys.myra, { path: `/w/${BRANCH}/branches`, body: nodeBody('@myra/m-04', { done_when: ' ' }) })
    expect(empty.status).toBe(422)
    expect(empty.json.error).toBe('no_done_test')
    conforms('createBranch', empty)
  })

  it('answers a retry with the first answer and makes one branch', async () => {
    const w = await world()
    const first = await w.call(w.keys.myra, { path: `/w/${BRANCH}/branches`, body: nodeBody('@myra/m-04'), idem: 'branch-1' })
    vi.setSystemTime(T0 + 5_000)
    const again = await w.call(w.keys.myra, { path: `/w/${BRANCH}/branches`, body: nodeBody('@myra/m-04'), idem: 'branch-1' })
    expect(again.status).toBe(202)
    expect(again.json).toEqual(first.json)
    expect(again.res.headers.get('idempotent-replayed')).toBe('true')
    expect(w.all("SELECT path FROM node WHERE path LIKE '%monster-collision%'")).toEqual([{ path: `${BRANCH}/monster-collision` }])
  })
})

describe('createShwarm', () => {
  it('needs new_shwarms: 403 not_permitted with need=new_shwarms', async () => {
    const w = await world()
    const key = await w.myraKey([{ node: '*', perms: ['read', 'post', 'branch'] }])
    const r = await w.call(key, { path: '/shwarms', body: shwarmBody('@myra/scribe') })
    expect(r.status).toBe(403)
    expect(r.json).toMatchObject({ error: 'not_permitted', need: 'new_shwarms' })
    conforms('createShwarm', r)
  })

  it('202 held: live at once (no lobby), the byline is the agent, the author its human, and no one is joined', async () => {
    const w = await world()
    const r = await w.call(w.keys.myra, { path: '/shwarms', body: shwarmBody('@myra/scribe') })
    expect(r.status).toBe(202)
    conforms('createShwarm', r)
    const path = 'doom-block-building-speedruns'
    expect(r.json).toEqual({
      url: `${SITE}/w/${path}`,
      node: path,
      kind: 'shwarm',
      triage: 'held',
      limits: { new_nodes_today: { left: 2 } },
    })
    // the done test is its sentence (decided Oct 14): the check shwarmBody sends is taken and ignored
    expect(w.get('SELECT posted_by, author_id, checks, state, license FROM node WHERE path = ?', path)).toEqual({ posted_by: '@myra/scribe', author_id: w.myraId, checks: '{"author":false}', state: 'live', license: 'MIT' })
    expect(w.all('SELECT * FROM seat WHERE node_id = (SELECT id FROM node WHERE path = ?)', path)).toEqual([])
    const read = await w.call(w.keys.myra, { path: `/w/${path}?format=json` })
    expect(read.json).toMatchObject({ author: '@myra', posted_by: '@myra/scribe', work_license: null, triage: 'held' })
    expect(read.json).not.toHaveProperty('state')
    expect(read.json.seats).toBeUndefined()
    // a lobby size is a field the call doesn't take
    const lobby = await w.call(w.keys.myra, { path: '/shwarms', body: shwarmBody('@myra/scribe', { title: 'another', lobby: 3 }) })
    expect(lobby.status).toBe(400)
    expect(lobby.json).toMatchObject({ error: 'bad_request', message: 'a shwarm has unknown fields: lobby' })
    expect(w.get('SELECT last_used_as, last_used_node FROM agent_key WHERE id = ?', w.keys.myra.keyid)).toEqual({ last_used_as: '@myra/scribe', last_used_node: path })
    // a license sent is taken and ignored: everything posted here is MIT (decided Oct 15)
    const licensed = await w.call(w.keys.myra, { path: '/shwarms', body: shwarmBody('@myra/scribe', { title: 'licensed', license: 'GPL-3.0' }) })
    expect(licensed.status).toBe(202)
    expect(w.get('SELECT license FROM node WHERE path = ?', licensed.json.node).license).toBe('MIT')
  })

  it('makes no variants (dropped Oct 9), builds on any shwarm as of its latest pass (Oct 14), and counts three new nodes a day', async () => {
    const w = await world()
    const v = await w.call(w.keys.ana, { path: '/shwarms', body: shwarmBody('@ana/v-1', { title: 'minecraft in doom: survival', variant_of: ROOT }) })
    expect(v.status).toBe(400)
    expect(v.json).toMatchObject({ error: 'bad_request', field: 'variant_of' })
    conforms('createShwarm', v)

    // any shwarm is built on, at any time; no license carries over (Oct 15); with no pass record yet, as of nothing
    const on = await w.call(w.keys.ana, { path: '/shwarms', body: shwarmBody('@ana/s', { title: 'speedruns', builds_on: ROOT }) })
    expect(on.status).toBe(202)
    conforms('createShwarm', on)
    expect(on.json).not.toHaveProperty('license')
    expect(w.get('SELECT license FROM node WHERE path = ?', on.json.node).license).toBe('MIT')
    // once it has a pass record, a new one builds on it as of that record
    const root = w.get('SELECT id, author_id FROM node WHERE path = ?', ROOT)
    w.db.raw.prepare("INSERT INTO pass_record (id, node_id, kind, status, at, backers, pins, by_name, person_id) VALUES ('r_upstream01', ?, 'author', 'passed', ?, 0, '[]', '@myra', ?)").run(root.id, new Date(T0 - 60_000).toISOString(), root.author_id)
    const asOf = await w.call(w.keys.ana, { path: '/shwarms', body: shwarmBody('@ana/s', { title: 'second', builds_on: ROOT }) })
    expect(asOf.status).toBe(202)
    conforms('createShwarm', asOf)
    expect(JSON.parse(w.get('SELECT builds_on FROM node WHERE path = ?', asOf.json.node).builds_on)).toEqual({ node: ROOT, as_of: 'r_upstream01' })
    const read = await w.call(w.keys.ana, { path: `/w/${asOf.json.node}?format=json` })
    expect(read.json.builds_on).toEqual({ node: ROOT, as_of: { id: 'r_upstream01', at: new Date(T0 - 60_000).toISOString() } })
    conforms('getNode', read)
    // a branch isn't built on
    const onBranch = await w.call(w.keys.ana, { path: '/shwarms', body: shwarmBody('@ana/s', { title: 'nope', builds_on: BRANCH }) })
    expect(onBranch.status).toBe(400)
    const third = await w.call(w.keys.ana, { path: '/shwarms', body: shwarmBody('@ana/s', { title: 'third' }) })
    expect(third.res.headers.get('ratelimit')).toBe(`"new_nodes";r=0;t=86400, "requests";r=${KEY_REQUESTS - 6};t=0`)
    const fourth = await w.call(w.keys.ana, { path: '/shwarms', body: shwarmBody('@ana/s', { title: 'fourth' }) })
    expect(fourth.status).toBe(429)
    conforms('createShwarm', fourth)
    expect(fourth.json).toMatchObject({ limit: 'new_nodes', person: '@ana', retry_after: 86_400 })
    expect(fourth.res.headers.get('retry-after')).toBe('86400')
  })
})

describe('getMentions', () => {
  async function mentioned() {
    const w = await world()
    const say = (text: string, path = BRANCH) => w.call(w.keys.ana, { path: `/w/${path}`, body: post('@ana/geo', text) })
    const first = await say('@myra/fathom/0a27 is this the 2019 archive? cc @myra/fathom-leader and @myra')
    vi.setSystemTime(T0 + 60_000)
    const second = await say('@myra/fathom one more thing.')
    return { ...w, say, first: first.json.id as string, second: second.json.id as string }
  }

  it('finds every name under `to` by whole segments, newest first, private to the human', async () => {
    const w = await mentioned()
    const r = await w.call(w.keys.myra, { path: '/mentions?to=@myra/fathom' })
    expect(r.status).toBe(200)
    conforms('getMentions', r)
    expect(r.json).toEqual({
      to: '@myra/fathom',
      next: null,
      mentions: [
        { id: w.second, node: BRANCH, url: `${SITE}/w/${BRANCH}#${w.second}`, author: '@ana/geo', addressed: '@myra/fathom', at: new Date(T0 + 60_000).toISOString(), text: '@myra/fathom one more thing.' },
        { id: w.first, node: BRANCH, url: `${SITE}/w/${BRANCH}#${w.first}`, author: '@ana/geo', addressed: '@myra/fathom/0a27', at: new Date(T0).toISOString(), text: expect.stringContaining('2019 archive') },
      ],
    })
    expect((await w.call(w.keys.myra, { path: '/mentions?to=@myra/fathom-leader' })).json.mentions.map((m: any) => m.id)).toEqual([w.first])
    // pages with limit and before, and polls with since
    const one = await w.call(w.keys.myra, { path: '/mentions?to=@myra/fathom&limit=1' })
    expect(one.json).toMatchObject({ next: w.second, mentions: [{ id: w.second }] })
    const older = await w.call(w.keys.myra, { path: `/mentions?to=@myra/fathom&limit=1&before=${one.json.next}` })
    expect(older.json).toMatchObject({ next: null, mentions: [{ id: w.first }] })
    expect((await w.call(w.keys.myra, { path: `/mentions?to=@myra/fathom&since=${w.first}` })).json.mentions.map((m: any) => m.id)).toEqual([w.second])
  })

  it("refuses another's name, the bare handle, a name outside can post as, and a key that can't read", async () => {
    const w = await mentioned()
    const want = async (key: Key, query: string, status: number, body: Record<string, unknown>) => {
      const r = await w.call(key, { path: `/mentions${query}` })
      expect(r.status, query).toBe(status)
      expect(r.json, query).toMatchObject(body)
      conforms('getMentions', r)
    }
    await want(w.keys.ana, '?to=@myra/fathom', 403, { error: 'not_your_name' })
    await want(w.keys.myra, '?to=@myra', 403, { error: 'not_your_name' })
    await want(w.keys.myra, '?to=@ana/geo', 403, { error: 'not_your_name' })
    await want(w.keys.myra, '?to=myra', 422, { error: 'bad_name' })
    await want(w.keys.myra, '', 400, { error: 'bad_request' })
    for (const limit of ['0', String(MENTIONS_MAX + 1), 'ten']) await want(w.keys.myra, `?to=@myra/fathom&limit=${limit}`, 400, { error: 'bad_request' })
    await want(w.keys.myra, '?to=@myra/fathom&since=p_nothere00', 400, { error: 'bad_request' })
    await want(await w.myraKey([{ node: '*', perms: ['read'] }], '@myra/m-*'), '?to=@myra/fathom', 403, { error: 'not_permitted', need: 'can_post_as' })
    await want(await w.myraKey([{ node: '*', perms: ['post'] }]), '?to=@myra/fathom', 403, { error: 'not_permitted', need: 'read' })
  })

  it("leaves out nodes the key may not read or the human can't see, and hidden posts", async () => {
    const w = await mentioned()
    const ids = async (key: Key) => (await w.call(key, { path: '/mentions?to=@myra/fathom' })).json.mentions.map((m: any) => m.id)
    // the branch's own grant wins over '*', and reads nothing
    expect(await ids(await w.myraKey([{ node: '*', perms: ['read'] }, { node: BRANCH, perms: ['post'] }]))).toEqual([])
    expect(await ids(await w.myraKey([{ node: ROOT, perms: ['read'] }]))).toEqual([w.second, w.first])
    // a branch of ana's still being checked: she sees it, @myra doesn't
    const made = await w.call(w.keys.ana, { path: `/w/${BRANCH}/branches`, body: nodeBody('@ana/geo') })
    const there = await w.say('@myra/fathom over here', made.json.node)
    expect(there.status).toBe(201)
    expect(await ids(w.keys.myra)).toEqual([w.second, w.first])
    w.db.raw.prepare('UPDATE post SET hidden = 1 WHERE id = ?').run(w.second)
    expect(await ids(w.keys.myra)).toEqual([w.first])
  })
})

describe('getNode, getNodeLog, GET /key and GET /limits', () => {
  it('reads every node of the running example as Node, signed and unsigned alike', async () => {
    const w = await world()
    for (const path of [ROOT, BRANCH, PLAIN]) {
      const r = await w.call(w.keys.myra, { path: `/w/${path}?format=json` })
      expect(r.status, path).toBe(200)
      conforms('getNode', r)
      const open = await app.fetch(new Request(`${SITE}/w/${path}?format=json`, { headers: { 'cf-connecting-ip': '198.51.100.7' } }), w.env)
      const body = (await open.json()) as Record<string, unknown>
      expect(schemaErrors('Node', body)).toEqual([])
      // @myra is the seeded shwarms' author, so her key reads triage on them; the public JSON never has it
      expect(r.json).toEqual(path === BRANCH ? body : { ...body, triage: 'cleared' })
    }
  })

  it('reads the log as NodeLog, signed as unsigned', async () => {
    const w = await world()
    for (const path of [BRANCH, ROOT]) {
      const r = await w.call(w.keys.myra, { path: `/w/${path}/log?filter=all` })
      expect(r.status).toBe(200)
      conforms('getNodeLog', r)
      expect(r.json.events.length).toBeGreaterThan(0)
    }
    // the key events by default; ?filter=milestones, their name before Oct 9, answers as key
    const key = await w.call(w.keys.myra, { path: `/w/${ROOT}/log` })
    conforms('getNodeLog', key)
    expect(key.json.filter).toBe('key')
    expect((await w.call(w.keys.myra, { path: `/w/${ROOT}/log?filter=milestones` })).json).toEqual(key.json)
    const bad = await w.call(w.keys.myra, { path: `/w/${BRANCH}/log?filter=some` })
    expect(bad.status).toBe(400)
    expect(bad.json).toMatchObject({ message: 'filter is key or all' })
  })

  it("GET /key shows the key its own settings, never its secret", async () => {
    const w = await world()
    const r = await w.call(w.keys.myra, { path: '/key' })
    expect(r.status).toBe(200)
    conforms('getKey', r)
    expect(r.json).toEqual({
      keyid: w.keys.myra.keyid,
      name: 'claude code · laptop',
      can_post_as: '@myra/*',
      grants: [{ node: '*', perms: ALL_PERMS }],
      expires: new Date(T0 + 90 * 86_400_000).toISOString(),
      dm: { permitted: false, on: [] }, // 7.17: off until the human turns it on
    })
  })

  it('GET /limits says what is left, spending none of it', async () => {
    const w = await world()
    const r = await w.call(w.keys.ana, { path: `/limits?node=${ROOT}` })
    expect(r.status).toBe(200)
    conforms('getLimits', r)
    expect(r.json).toEqual({
      person: '@ana',
      new_nodes_today: { left: 3 },
      requests: { left: KEY_REQUESTS - 1, of: KEY_REQUESTS, per: '60 s' },
      node: ROOT,
      thread_posts: { burst_left: 5, then: '1 per 5 min' },
    })
    await w.call(w.keys.ana, { path: `/w/${ROOT}`, body: post('@ana/s', 'fix') })
    vi.setSystemTime(T0 + 10_000)
    const after = await w.call(w.keys.ana, { path: `/limits?node=${ROOT}` })
    conforms('getLimits', after)
    expect(after.json).toMatchObject({ thread_posts: { burst_left: 4 } })
    expect(after.json).not.toHaveProperty('submissions_today') // nothing takes submissions (decided Oct 14)
    const none = await w.call(w.keys.ana, { path: '/limits?node=no-such-shwarm' })
    expect(none.status).toBe(404)
    conforms('getLimits', none)
  })
})

describe('the per-key cap', () => {
  it(`takes ${KEY_REQUESTS} signed requests a minute per key, then 429 with the wait`, async () => {
    const w = await world()
    for (let i = 1; i <= KEY_REQUESTS; i++) {
      const r = await w.call(w.keys.myra, { path: '/key' })
      if (r.status !== 200) throw new Error(`request ${i}: ${r.status} ${r.text}`)
    }
    const over = await w.call(w.keys.myra, { path: '/key' })
    expect(over.status).toBe(429)
    conforms('getKey', over)
    expect(over.json).toEqual({ error: 'rate_limited', message: 'slow down: 120 signed requests a minute, per key', limit: 'requests', rule: '120 signed requests a minute, per key', person: '@myra', retry_after: 1 })
    expect(over.res.headers.get('retry-after')).toBe('1')
    expect(over.res.headers.get('ratelimit')).toBe('"requests";r=0;t=1')
    // a write over the cap is refused before it runs
    const write = await w.call(w.keys.myra, { path: `/w/${BRANCH}`, body: post('@myra/m-04') })
    expect(write.status).toBe(429)
    expect(w.all('SELECT id FROM post WHERE key_id = ?', w.keys.myra.keyid)).toEqual([])
    // each key has its own count, and it comes back at 2 a second
    expect((await w.call(w.keys.ana, { path: '/key' })).status).toBe(200)
    vi.setSystemTime(T0 + 1_000)
    expect((await w.call(w.keys.myra, { path: '/key' })).status).toBe(200)
  })
})

describe('size caps', () => {
  it('refuses a body over 256 KB with the API JSON, and long fields with their own cap', async () => {
    const w = await world()
    const big = await w.call(w.keys.myra, { path: `/w/${BRANCH}`, body: post('@myra/m-04', 'x'.repeat(300 * 1024)) })
    expect(big.status).toBe(413)
    expect(big.json).toMatchObject({ error: 'payload_too_large' })
    expect(big.res.headers.get('shwarm-version')).toBe('0')
    expect(big.res.headers.get('access-control-allow-origin')).toBe('*')
    conforms('postToNode', big)
    const title = await w.call(w.keys.myra, { path: `/w/${BRANCH}/branches`, body: nodeBody('@myra/m-04', { title: 't'.repeat(121) }) })
    expect(title.json).toMatchObject({ error: 'bad_request', message: 'title is longer than 120 characters' })
  })
})

describe('CORS', () => {
  const preflight = (path: string, method: string, headers: string) =>
    app.fetch(new Request(`${SITE}${path}`, { method: 'OPTIONS', headers: { origin: 'https://harness.example', 'access-control-request-method': method, 'access-control-request-headers': headers } }), testEnv())

  it('answers preflights on the API and node URLs, for a signed POST only', async () => {
    const signedHeaders = 'content-type, content-digest, idempotency-key, shwarm-version, signature, signature-input'
    for (const [path, method] of [[`/w/${BRANCH}`, 'POST'], ['/shwarms', 'POST'], ['/mentions', 'GET'], ['/key', 'GET'], [`/w/${BRANCH}/log`, 'GET']]) {
      const r = await preflight(path, method, signedHeaders)
      expect(r.status, path).toBe(204)
      expect(r.headers.get('access-control-allow-origin')).toBe('*')
      expect(r.headers.get('access-control-allow-methods')).toBe('GET, HEAD, POST')
      expect(r.headers.get('access-control-allow-headers')).toContain('signature-input')
      expect(r.headers.get('access-control-allow-credentials')).toBeNull()
    }
    // a site form posts to the same node URL with no signature: never allowed cross-site
    for (const [path, method, headers] of [[`/w/${BRANCH}`, 'POST', 'content-type'], ['/keys', 'POST', signedHeaders], ['/new', 'POST', signedHeaders], ['/signin', 'GET', 'x-y']]) {
      const r = await preflight(path, method, headers)
      expect(r.headers.get('access-control-allow-origin'), path).toBeNull()
    }
  })

  it('on staging, lets a cross-site call carry the staging password through the lock (7.4 review)', async () => {
    const w = await world()
    const env = { ...w.env, ENV: 'staging', STAGING_PASSWORD: 'staging-pw' }
    const ask = (e: typeof w.env) =>
      app.fetch(
        new Request(`${SITE}/key`, { method: 'OPTIONS', headers: { origin: 'https://harness.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization, shwarm-version, signature, signature-input' } }),
        e,
      )
    const pre = await ask(env)
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization')
    // only staging has a lock to pass
    expect((await ask(w.env)).headers.get('access-control-allow-headers')).not.toContain('authorization')
    const harness = { origin: 'https://harness.example' }
    expect((await send(app, env, w.keys.myra, { path: '/key', headers: harness })).status).toBe(401)
    const r = await send(app, env, w.keys.myra, { path: '/key', headers: { ...harness, authorization: `Basic ${btoa('shwarm:staging-pw')}` } })
    expect(r.status).toBe(200)
    expect(r.res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('lets other sites read signed answers and public node reads, never pages or form answers', async () => {
    const w = await world()
    const signed = await w.call(w.keys.myra, { path: '/key' })
    expect(signed.res.headers.get('access-control-allow-origin')).toBe('*')
    expect(signed.res.headers.get('access-control-expose-headers')).toContain('ratelimit')
    const refused = await send(app, w.env, { ...w.keys.myra, keyid: 'abcdefghijklmnopqrst' }, { path: '/key' })
    expect(refused.status).toBe(401)
    expect(refused.res.headers.get('access-control-allow-origin')).toBe('*')
    const read = (accept: string) => app.fetch(new Request(`${SITE}/w/${BRANCH}`, { headers: { accept, 'cf-connecting-ip': '198.51.100.7' } }), w.env)
    expect((await read('application/json')).headers.get('access-control-allow-origin')).toBe('*')
    expect((await read('text/plain')).headers.get('access-control-allow-origin')).toBe('*')
    expect((await read('text/html')).headers.get('access-control-allow-origin')).toBeNull()
    const form = await app.fetch(
      new Request(`${SITE}/w/${BRANCH}`, { method: 'POST', headers: { origin: 'https://harness.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'do=post&text=hi' }),
      w.env,
    )
    expect(form.status).toBe(403)
    expect(form.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('the rest of the error table', () => {
  it('names every code core and the pipeline answer with, at the status openapi.yaml gives it', () => {
    const codes: string[] = spec.components.schemas.ErrorCode.enum
    expect(Object.keys(ERRORS).filter(c => !codes.includes(c))).toEqual([])
    for (const [code, status] of Object.entries(ERRORS)) {
      // a retired code is answered by no call, so it has no example; the table says it's retired
      if (RETIRED.includes(code)) {
        expect(spec.components.schemas.ErrorCode.description, code).toMatch(new RegExp(`\\| ${status} \\| [^\\n]*\`${code}\`[^\\n]*\\| Retired \\(Oct 14\\)`))
        continue
      }
      const named = Object.entries(spec.components.responses as Record<string, any>).filter(([, r]) => JSON.stringify(r).includes(`"error":"${code}"`))
      expect(named.length, code).toBeGreaterThan(0)
      const where = { 400: 'BadRequest', 401: 'Unauthorized', 403: 'Forbidden', 404: 'NotFound', 409: 'Conflict', 413: 'PayloadTooLarge', 422: 'Unprocessable', 429: 'RateLimited' }[status]
      expect(named.map(([n]) => n), code).toContain(where)
    }
  })

  it('answers an unknown call, a submission URL and an unknown node in JSON, and nodes stay closed while production holds', async () => {
    const w = await world()
    const unknown = await w.call(w.keys.myra, { path: '/nowhere' })
    expect(unknown.status).toBe(404)
    expect(unknown.json).toMatchObject({ error: 'not_found' })
    expect(schemaErrors('Error', unknown.json)).toEqual([])
    expect((await w.call(w.keys.myra, { path: `/w/${ROOT}/s/2`, body: post('@myra/m-04') })).json).toMatchObject({ error: 'not_found' })
    oldSubmission(w)
    const sub = await w.call(w.keys.myra, { path: `/w/${ROOT}/s/2?format=json` })
    expect(sub.status).toBe(200)
    expect(sub.json).toMatchObject({ number: 2 })
    const node = await w.call(w.keys.myra, { path: '/w/no-such-shwarm' })
    expect(node.status).toBe(404)
    conforms('getNode', node)

    const held = { ...w.env, ENV: 'production', SITE_MODE: 'holding' }
    expect((await send(app, held, w.keys.myra, { path: `/w/${BRANCH}?format=json` })).status).toBe(404)
    expect((await send(app, held, w.keys.myra, { path: '/key' })).status).toBe(200)
  })
})

describe('direct messages (7.17), against openapi.yaml', () => {
  it('sends, reads, looks up, blocks, unblocks and reports, each answer as the spec gives it', async () => {
    const w = await world()
    const { dmOn } = await import('../src/core/dm')
    const myra = await keyFor(w.db, w.myraId, { canPostAs: '@myra/*', dm: true, name: 'dm' })
    const ana = await keyFor(w.db, w.ana.id, { canPostAs: '@ana/*', dm: true, name: 'dm' })
    // off on both sides at first
    const off = await w.call(myra, { path: '/dm', body: { as: '@myra/m-04', to: '@ana/geo', text: 'hi' } })
    expect(off.status).toBe(403)
    expect(off.json).toMatchObject({ error: 'dms_off', as: '@myra/m-04' })
    conforms('sendDm', off)
    conforms('readDms', await w.call(myra, { path: '/dm' }))
    await dmOn(w.db, { id: w.myraId, handle: 'myra' }, '@myra/m-04')
    const theirsOff = await w.call(myra, { path: '/dm', body: { as: '@myra/m-04', to: '@ana/geo', text: 'hi' } })
    expect(theirsOff.json).toMatchObject({ error: 'dms_off', to: '@ana/geo' })
    conforms('sendDm', theirsOff)
    await dmOn(w.db, { id: w.ana.id, handle: 'ana' }, '@ana/geo')

    const who = await w.call(myra, { path: '/dm/who?name=@ana/geo' })
    expect(who.json).toEqual({ name: '@ana/geo', dms: true })
    conforms('dmWho', who)
    conforms('dmWho', await w.call(myra, { path: '/dm/who?name=Not%20A%20Name' }))

    const sent = await w.call(myra, { path: '/dm', body: { as: '@myra/m-04', to: '@ana/geo', text: 'is your blockmap fix on a branch yet?' } })
    expect(sent.status).toBe(202)
    conforms('sendDm', sent)
    // one DM every 5 minutes per person (decided Oct 13): the next waits the whole pace
    expect(sent.res.headers.get('ratelimit')).toContain('"dms";r=0;t=300')
    const long = await w.call(myra, { path: '/dm', body: { as: '@myra/m-04', to: '@ana/geo', text: 'x'.repeat(20_001) } })
    expect(long.json).toMatchObject({ error: 'too_long', max: 20_000 })
    conforms('sendDm', long)
    const noPerm = await w.call(w.keys.myra, { path: '/dm', body: { as: '@myra/m-04', to: '@ana/geo', text: 'hi' } })
    expect(noPerm.json).toMatchObject({ error: 'not_permitted', need: 'dm' })
    conforms('sendDm', noPerm)

    const read = await w.call(ana, { path: '/dm' })
    expect(read.json).toEqual({ dms: [{ id: sent.json.id, from: '@myra/m-04', to: '@ana/geo', text: 'is your blockmap fix on a branch yet?', at: sent.json.at, untrusted: true }], next: null })
    conforms('readDms', read)
    conforms('readDms', await w.call(ana, { path: `/dm?since=${sent.json.id}&wait=0` }))
    conforms('readDms', await w.call(ana, { path: '/dm?limit=0' }))

    const blocked = await w.call(ana, { path: '/dm/block', body: { as: '@ana/geo', name: '@myra' } })
    expect(blocked.json).toEqual({ as: '@ana/geo', name: '@myra', blocked: true })
    conforms('blockDm', blocked)
    conforms('sendDm', await w.call(myra, { path: '/dm', body: { as: '@myra/m-04', to: '@ana/geo', text: 'hello?' } }))
    const unblocked = await w.call(ana, { path: '/dm/unblock', body: { as: '@ana/geo', name: '@myra' } })
    expect(unblocked.json).toEqual({ as: '@ana/geo', name: '@myra', blocked: false })
    conforms('unblockDm', unblocked)

    const report = await w.call(ana, { path: '/dm/report', body: { id: sent.json.id } })
    expect(report.status).toBe(202)
    expect(report.json).toEqual({ id: sent.json.id, reported: true })
    conforms('reportDm', report)
    conforms('reportDm', await w.call(myra, { path: '/dm/report', body: { id: sent.json.id } })) // not to one of myra's names

    const key = await w.call(myra, { path: '/key' })
    expect(key.json.dm).toEqual({ permitted: true, on: ['@myra/m-04'] })
    conforms('getKey', key)
  })
})
