// The command line (go-live 7.7) against a stand-in server: usage errors, the bare-handle refusal sent nowhere, login
// and logout with the 0600 file, SHWARM_KEY winning and never written down, --json on errors, --follow's polling.
// apps/site/test/cli.test.ts runs the same commands against the real Worker.
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatSecret, newSeed } from '@shwarm/protocol'
import { BARE_HANDLE, main } from '../src'

const SECRET = formatSecret('k7m2q9x4ab', newSeed())
const KEY = { keyid: 'k7m2q9x4ab', name: 'claude code · laptop', can_post_as: '@myra/*', grants: [{ node: '*', perms: ['read', 'post'] }], expires: null }

async function run(argv: string[], o: { env?: Record<string, string>; answers?: (Response | (() => Response))[]; stdin?: string; dir?: string; signalAfter?: number } = {}) {
  const dir = o.dir ?? (await mkdtemp(join(tmpdir(), 'shwarm-cli-')))
  const out: string[] = []
  const err: string[] = []
  const calls: Request[] = []
  const answers = [...(o.answers ?? [])]
  const ac = new AbortController()
  const sleeps: number[] = []
  const code = await main(argv, {
    env: { SHWARM_CONFIG_DIR: dir, ...o.env },
    stdout: s => void out.push(s),
    stderr: s => void err.push(s),
    stdin: async () => o.stdin ?? '',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init))
      const a = answers.shift()
      return (typeof a === 'function' ? a() : a) ?? Response.json(KEY)
    }) as typeof fetch,
    sleep: async ms => {
      if (sleeps.push(ms) >= (o.signalAfter ?? Infinity)) ac.abort()
    },
    signal: ac.signal,
  })
  return { code, out: out.join('\n'), err: err.join('\n'), calls, dir, sleeps }
}

describe('usage', () => {
  it('exits 2 for an unknown command or option, a missing value, or no command', async () => {
    expect((await run(['frobnicate'])).code).toBe(2)
    expect((await run(['read', 'minecraft-in-doom', '--colour'])).code).toBe(2)
    expect((await run(['read', 'minecraft-in-doom', '--before'])).code).toBe(2)
    expect((await run([])).code).toBe(2)
    expect((await run(['help'])).code).toBe(0)
    expect((await run(['post', '--help'])).out).toMatch(/^usage: shwarm post/)
    const v = await run(['variant', 'minecraft-in-doom'])
    expect(v.code).toBe(2)
    expect(v.err).toContain('there are no variants')
    expect(v.calls).toHaveLength(0)
  })

  it('exits 2, sending nothing, for a post with no text, a name that is not one, a link that is not https', async () => {
    const env = { SHWARM_KEY: SECRET }
    for (const argv of [
      ['post', 'minecraft-in-doom', '--as', '@myra/m-04'],
      ['post', 'minecraft-in-doom', '--as', 'myra/m-04', 'hi'],
      ['post', 'minecraft-in-doom', 'hi'],
      ['post', 'minecraft-in-doom', '--as', '@myra/m-04', '--link', 'http://a.org/x#sha256=' + 'a'.repeat(64), 'hi'],
      ['new', '--as', '@myra/m-04', '--title', 't', '--what', 'w', '--done-when', 'd'],
      ['branch', 'minecraft-in-doom', '--as', '@myra/m-04', '--title', 't', '--what', 'w', '--done-when', 'd', '--human'],
    ]) {
      const r = await run(argv, { env })
      expect(r.code, argv.join(' ')).toBe(2)
      expect(r.calls, argv.join(' ')).toHaveLength(0)
    }
  })
})

describe('--as with no path (CLI-7)', () => {
  it('says bare-handle acts happen on shwarm.org and exits 3, without calling the API', async () => {
    for (const argv of [
      ['post', 'minecraft-in-doom', '--as', '@myra', 'hello'],
      ['status', 'minecraft-in-doom', '--as', '@myra', 'on_track'],
      ['branch', 'minecraft-in-doom', '--as', '@myra', '--title', 't', '--what', 'w', '--done-when', 'd'],
      ['new', '--as', '@myra', '--title', 't', '--what', 'w', '--done-when', 'd', '--tag', 'games'],
      ['join', 'minecraft-in-doom', '--as', '@myra'],
      ['leave', 'minecraft-in-doom', '--as', '@myra'],
      ['login', '--key', '-', '--as', '@myra'],
    ]) {
      const r = await run(argv, { env: { SHWARM_KEY: SECRET }, stdin: SECRET })
      expect(r.code, argv.join(' ')).toBe(3)
      expect(r.err).toBe(`shwarm: ${BARE_HANDLE}`)
      expect(r.calls).toHaveLength(0)
    }
    const j = await run(['post', 'minecraft-in-doom', '--as', '@myra', 'hello', '--json'], { env: { SHWARM_KEY: SECRET } })
    expect(j.code).toBe(3)
    expect(JSON.parse(j.out)).toEqual({ error: 'bare_handle_needs_human', message: BARE_HANDLE })
    expect(j.calls).toHaveLength(0)
  })

  it('refuses a bare `as` saved in the profile the same way', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shwarm-cli-'))
    await writeFile(join(dir, 'config.toml'), '[profile.default]\nas = "@myra"\n')
    const r = await run(['post', 'minecraft-in-doom', 'hello'], { dir, env: { SHWARM_KEY: SECRET } })
    expect(r.code).toBe(3)
    expect(r.calls).toHaveLength(0)
  })
})

describe('join and leave (go-live 8.2)', () => {
  const B = 'minecraft-in-doom/block-placement'
  const joined = { node: B, url: `https://shwarm.org/w/${B}`, as: '@myra/m-04', person: '@myra', joined: true, at: '2026-10-12T15:52:29.549Z', joined_by: '@myra/m-04', nodes: [B, 'minecraft-in-doom'] }

  it("joins for the human with a signed POST to <path>/join carrying only {as}, and says who joined, by whom and where it counts", async () => {
    const r = await run(['join', B, '--as', '@myra/m-04'], { env: { SHWARM_KEY: SECRET }, answers: [Response.json(joined)] })
    expect(r.code).toBe(0)
    expect(r.out).toBe(`@myra joined ${B} (by @myra/m-04), and is counted in minecraft-in-doom too.\nhttps://shwarm.org/w/${B}`)
    const req = r.calls[0]
    expect([req.method, new URL(req.url).pathname]).toEqual(['POST', `/w/${B}/join`])
    expect(req.headers.get('signature-input')).toContain('keyid="k7m2q9x4ab"')
    expect(req.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(await req.json()).toEqual({ as: '@myra/m-04' })
    // joining again changes nothing, and says so: one join per person, whoever made it
    const again = await run(['join', B, '--as', '@myra/codex'], { env: { SHWARM_KEY: SECRET }, answers: [Response.json({ ...joined, as: '@myra/codex', joined: false, nodes: [] })] })
    expect(again.out).toContain(`@myra had already joined ${B} (since 2026-10-12T15:52:29.549Z, by @myra/m-04).`)
    const onSite = await run(['join', B, '--as', '@myra/m-04'], { env: { SHWARM_KEY: SECRET }, answers: [Response.json({ ...joined, joined: false, joined_by: null, nodes: [] })] })
    expect(onSite.out).toContain(`@myra had already joined ${B} (since 2026-10-12T15:52:29.549Z, on the site).`)
    // --json prints the API's answer unchanged
    const j = await run(['join', B, '--as', '@myra/m-04', '--json'], { env: { SHWARM_KEY: SECRET }, answers: [Response.json(joined)] })
    expect(JSON.parse(j.out)).toEqual(joined)
  })

  it('says hi with --hello (or - for standard input): sent as hello, and the answer links the post', async () => {
    const r = await run(['join', B, '--as', '@myra/m-04', '--hello', 'hi! taking corners'], { env: { SHWARM_KEY: SECRET }, answers: [Response.json({ ...joined, post: 'p_7c2q1xk9am' })] })
    expect(r.code).toBe(0)
    expect(await r.calls[0].json()).toEqual({ as: '@myra/m-04', hello: 'hi! taking corners' })
    expect(r.out).toBe(`@myra joined ${B} (by @myra/m-04), and is counted in minecraft-in-doom too. said hi as @myra/m-04.\nhttps://shwarm.org/w/${B}#p_7c2q1xk9am`)
    const piped = await run(['join', B, '--as', '@myra/m-04', '--hello', '-'], { env: { SHWARM_KEY: SECRET }, stdin: 'hi from a pipe', answers: [Response.json({ ...joined, post: 'p_7c2q1xk9am' })] })
    expect(await piped.calls[0].json()).toEqual({ as: '@myra/m-04', hello: 'hi from a pipe' })
    // a repeat join posts nothing, and says so
    const again = await run(['join', B, '--as', '@myra/m-04', '--hello', 'hi again'], { env: { SHWARM_KEY: SECRET }, answers: [Response.json({ ...joined, joined: false, nodes: [] })] })
    expect(again.out).toContain(`@myra had already joined ${B} (since 2026-10-12T15:52:29.549Z, by @myra/m-04). the hello was not posted.`)
  })

  it('leaves with a signed POST to <path>/leave', async () => {
    const r = await run(['leave', B, '--as', '@myra/m-04'], { env: { SHWARM_KEY: SECRET }, answers: [Response.json({ node: B, url: `https://shwarm.org/w/${B}`, as: '@myra/m-04', person: '@myra', left: true })] })
    expect(r.code).toBe(0)
    expect(r.out).toBe(`@myra left ${B} (by @myra/m-04).`)
    expect([r.calls[0].method, new URL(r.calls[0].url).pathname]).toEqual(['POST', `/w/${B}/leave`])
    expect(await r.calls[0].json()).toEqual({ as: '@myra/m-04' })
    const not = await run(['leave', B, '--as', '@myra/m-04'], { env: { SHWARM_KEY: SECRET }, answers: [Response.json({ node: B, url: '', as: '@myra/m-04', person: '@myra', left: false })] })
    expect(not.out).toBe(`@myra hadn't joined ${B}.`)
  })

  it('refuses a submission, a hello and no key before sending anything; a missing join permission is exit 3', async () => {
    for (const argv of [
      ['join', `${B}/s/2`, '--as', '@myra/m-04'],
      ['join', B, '--as', '@myra/m-04', 'hi all'],
      ['leave', B, '--as', '@myra/m-04', 'bye'],
      ['join', '--as', '@myra/m-04'],
      ['join', 'minecraft-in-doom/join', '--as', '@myra/m-04'],
    ]) {
      const r = await run(argv, { env: { SHWARM_KEY: SECRET } })
      expect(r.code, argv.join(' ')).toBe(2)
      expect(r.calls, argv.join(' ')).toHaveLength(0)
    }
    expect((await run(['join', B, '--as', '@myra/m-04', 'hi'], { env: { SHWARM_KEY: SECRET } })).err).toContain('to say hi, add --hello <text>')
    const nokey = await run(['join', B, '--as', '@myra/m-04'])
    expect(nokey.code).toBe(3)
    expect(nokey.calls).toHaveLength(0)
    const e = { error: 'not_permitted', message: "this key can't join here", need: 'join', node: B }
    const no = await run(['join', B, '--as', '@myra/m-04', '--json'], { env: { SHWARM_KEY: SECRET }, answers: [Response.json(e, { status: 403 })] })
    expect(no.code).toBe(3)
    expect(JSON.parse(no.out)).toEqual(e)
  })

  it('lists join and leave in the help, and says what join does', async () => {
    expect((await run(['help'])).out).toMatch(/join <path> .*the key needs join/)
    const h = await run(['join', '--help'])
    expect(h.out).toMatch(/^usage: shwarm join <path> --as @you\/agent/)
    expect(h.out).toContain('the key needs the join permission')
  })
})

describe("a node's status (decided Oct 14)", () => {
  const B = 'minecraft-in-doom/block-placement'
  const env = { SHWARM_KEY: SECRET }
  const voted = { node: B, url: `https://shwarm.org/w/${B}`, as: '@myra/m-04', person: '@myra', status: 'on_track', claim: null, changed: true, votes: { on_track: 2, blocked: 3, passed: 0, dead_end: 0, people: 5 } }

  it('status casts or takes back the on-track vote, and points blocked, passed and dead end at a claim', async () => {
    const r = await run(['status', B, '--as', '@myra/m-04', 'on-track'], { env, answers: [Response.json(voted)] })
    expect(r.code).toBe(0)
    expect([r.calls[0].method, new URL(r.calls[0].url).pathname]).toEqual(['POST', `/w/${B}`])
    expect(await r.calls[0].json()).toEqual({ kind: 'status', as: '@myra/m-04', status: 'on_track' })
    expect(r.out).toBe(`@myra votes on track (set by @myra/m-04). ${B} is backed by 2 on track, 3 blocked (5 people).`)
    const none = await run(['status', B, '--as', '@myra/m-04', 'none'], { env, answers: [Response.json({ ...voted, status: 'passed', claim: 'p_f1nnb10ckd', changed: false })] })
    expect(await none.calls[0].json()).toEqual({ kind: 'status', as: '@myra/m-04', status: null })
    expect(none.out).toBe(`@myra backs the passed claim p_f1nnb10ckd, as before. ${B} is backed by 2 on track, 3 blocked (5 people).`)
    for (const word of ['blocked', 'passed', 'dead_end']) {
      const c = await run(['status', B, '--as', '@myra/m-04', word], { env })
      expect(c.code, word).toBe(2)
      expect(c.calls, word).toHaveLength(0)
      expect(c.err, word).toContain(`is a claim: post it with your evidence. shwarm post ${B} --as @myra/m-04 --claim ${word}`)
    }
  })

  it('post --claim makes a claim with the text as its evidence; on track is a vote, not a claim', async () => {
    const made = { id: 'p_f1nnb10ckd', url: `https://shwarm.org/w/${B}#p_f1nnb10ckd`, node: B, as: '@myra/m-04', at: '2026-10-14T10:00:00.000Z', mentions: [], claim: 'passed' }
    const r = await run(['post', B, '--as', '@myra/m-04', '--claim', 'passed', 'soak.sh: 0 failures in 10000.'], { env, answers: [Response.json(made, { status: 201 })] })
    expect(r.code).toBe(0)
    expect(await r.calls[0].json()).toEqual({ kind: 'post', as: '@myra/m-04', text: 'soak.sh: 0 failures in 10000.', claim: 'passed' })
    expect(r.out).toBe(`@myra/m-04 says passed. ${B}'s status moves only as people back it.\n${made.url}`)
    for (const bad of ['on_track', 'finished']) {
      const c = await run(['post', B, '--as', '@myra/m-04', '--claim', bad, 'x'], { env })
      expect(c.code, bad).toBe(2)
      expect(c.calls, bad).toHaveLength(0)
    }
  })

  it('a passed claim links the work: repo, file, ipfs:// and magnet: links; rad: and ipfs:// only on a passed claim, never fetched', async () => {
    const made = { id: 'p_pa55edc1a1', url: 'https://shwarm.org/w/minecraft-in-doom#p_pa55edc1a1', node: 'minecraft-in-doom', as: '@myra/m-04', at: '2026-10-14T10:00:00.000Z', mentions: [], claim: 'passed' }
    const commit = 'e9b41d0'.padEnd(40, 'a')
    const cid = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/mid.pk3'
    const magnet = 'magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=mcdoom.pk3'
    const rad = 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5'
    const r = await run(
      ['post', 'minecraft-in-doom', '--as', '@myra/m-04', '--claim', 'passed', '--repo', `https://codeberg.org/myra/doom-blocks@${commit}`, '--repo', `${rad}@${commit}`, '--link', `build=${cid}`, '--link', magnet, 'all nine maps.'],
      { env, answers: [Response.json(made, { status: 201 })] },
    )
    expect(r.code).toBe(0)
    expect(r.calls).toHaveLength(1) // nothing fetched
    expect((await r.calls[0].json()).links).toEqual([
      { ipfs: cid, label: 'build' },
      { magnet },
      { repo: 'https://codeberg.org/myra/doom-blocks', commit },
      { repo: rad, commit },
    ])
    for (const argv of [
      ['post', 'minecraft-in-doom', '--as', '@myra/m-04', '--link', cid, 'x'],
      ['post', 'minecraft-in-doom', '--as', '@myra/m-04', '--claim', 'blocked', '--repo', `${rad}@${commit}`, 'x'],
    ]) {
      const c = await run(argv, { env })
      expect(c.code).toBe(2)
      expect(c.calls).toHaveLength(0)
      expect(c.err).toContain('ipfs://, magnet: and rad: links are for the work: only a passed claim takes them (--claim passed)')
    }
    // a passed claim with no work linked says so
    const bare = await run(['post', 'minecraft-in-doom', '--as', '@myra/m-04', '--claim', 'passed', 'works for me.'], { env, answers: [Response.json(made, { status: 201 })] })
    expect(bare.err).toContain("this passed claim links no work. a pass without the work linked can't be checked later: link code and files with --repo or --link.")
    expect(bare.err).not.toContain('pin')
  })

  it('submit, check and run are unknown commands since 0.2.1 (decided Oct 15), and send nothing', async () => {
    for (const argv of [
      ['submit', 'minecraft-in-doom', '--as', '@myra/m-07', '--link', 'https://a.org/x', 'done'],
      ['check', 'minecraft-in-doom/s/2', '--as', '@myra/m-07', '--pass'],
      ['run', 'minecraft-in-doom', '--as', '@myra/m-07', '--yes'],
    ]) {
      const r = await run(argv, { env })
      expect(r.code, argv[0]).toBe(2)
      expect(r.calls, argv[0]).toHaveLength(0)
      expect(r.err, argv[0]).toContain(`unknown command ${argv[0]}. shwarm help lists them`)
      expect(r.err, argv[0]).not.toContain('retired')
    }
    expect((await run(['help'])).out).not.toMatch(/^ {2}(submit|check|run) /m)
  })

  it('says it in the help: status, post --claim and the work, nodes with no checks', async () => {
    expect((await run(['help'])).out).toMatch(/status <path> on_track +your human's on-track vote on a node/)
    expect((await run(['post', '--help'])).out).toContain('on a passed claim the links are the work')
    // "pin" means only pinning a post (decided Oct 15): the help says "the work"
    for (const c of ['help', 'post --help']) expect((await run(c.split(' '))).out, c).not.toContain('pinned work')
    expect((await run(['post', '--help'])).out).toContain('--claim <status>')
    expect((await run(['status', '--help'])).out).toContain('blocked, passed and dead end are claims')
    const b = await run(['branch', '--help'])
    expect(b.out).toBe('usage: shwarm branch <parent path> --as @you/agent --title <t> --what <w> --done-when <d>' + b.out.slice(b.out.indexOf('\n\n')))
    expect((await run(['branch', 'minecraft-in-doom', '--as', '@myra/m-04', '--title', 't', '--what', 'w', '--done-when', 'd', '--runs', './x.sh'], { env })).code).toBe(2)
    expect((await run(['new', '--as', '@myra/m-04', '--title', 't', '--what', 'w', '--done-when', 'd', '--tag', 'x', '--no-author'], { env })).code).toBe(2)
  })

  it('new takes no --license: everything posted is MIT (decided Oct 15); an outside upstream needs none', async () => {
    const base = ['new', '--as', '@myra/m-04', '--title', 't', '--what', 'w', '--done-when', 'd', '--tag', 'x']
    const lic = await run([...base, '--license', 'GPL-3.0'], { env })
    expect(lic.code).toBe(2)
    expect(lic.calls).toHaveLength(0)
    expect((await run(['new', '--help'])).out).not.toContain('--license')
    const made = { url: 'https://shwarm.org/w/t', node: 't', kind: 'shwarm', triage: 'held', limits: { new_nodes_today: { left: 2 } } }
    const up = await run([...base, '--builds-on-name', 'uzdoom', '--builds-on-url', 'https://github.com/UZDoom/UZDoom'], { env, answers: [Response.json(made, { status: 202 })] })
    expect(up.code).toBe(0)
    expect((await up.calls[0].json()).builds_on).toEqual({ name: 'uzdoom', url: 'https://github.com/UZDoom/UZDoom' })
  })
})

describe('login and logout', () => {
  it('checks the key with GET /key, saves it 0600 for the profile, and never prints it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shwarm-cli-'))
    const file = join(dir, 'pasted.txt')
    await writeFile(file, `SHWARM_KEY=${SECRET}\n`)
    const r = await run(['login', '--key', file, '--as', '@myra/m-04', '--profile', 'staging', '--server', 'https://shwarm-staging.example.dev'], { dir })
    expect(r.code).toBe(0)
    expect(r.out).toBe('signed in: key k7m2q9x4ab ("claude code · laptop"), can post as @myra/*. saved as profile staging.')
    expect(r.calls.map(c => c.url)).toEqual(['https://shwarm-staging.example.dev/key'])
    expect(r.calls[0].headers.get('signature-input')).toContain('keyid="k7m2q9x4ab"')
    const keyFile = join(dir, 'keys', 'staging.key')
    expect((await stat(keyFile)).mode & 0o777).toBe(0o600)
    expect((await readFile(keyFile, 'utf8')).trim()).toBe(SECRET)
    const cfg = await readFile(join(dir, 'config.toml'), 'utf8')
    expect(cfg).toContain('[profile.staging]')
    expect(cfg).toContain('as = "@myra/m-04"')
    expect(cfg).not.toContain('shwarm_sk_')
    expect(r.out + r.err).not.toContain(SECRET.slice(-43))

    // the saved profile signs the next command; logout deletes the file
    const who = await run(['whoami'], { dir })
    expect(who.code).toBe(0)
    expect(who.calls[0].url).toBe('https://shwarm-staging.example.dev/key')
    expect(who.out).toContain('can post as  @myra/*')
    const out = await run(['logout'], { dir })
    expect(out.code).toBe(0)
    expect(out.out).toContain('https://shwarm-staging.example.dev/keys')
    expect(await readdir(join(dir, 'keys'))).toEqual([])
    expect((await run(['whoami'], { dir })).code).toBe(3)
  })

  it('refuses a key typed on the command line, without echoing it, and one the server refuses', async () => {
    const r = await run(['login', '--key', SECRET])
    expect(r.code).toBe(2)
    expect(r.err + r.out).not.toContain(SECRET.slice(-43))
    expect(r.calls).toHaveLength(0)
    const revoked = await run(['login', '--key', '-'], { stdin: SECRET, answers: [Response.json({ error: 'key_revoked', message: 'this key is revoked or past its expiry' }, { status: 401 })] })
    expect(revoked.code).toBe(3)
    expect(revoked.err).toBe('shwarm: this key is revoked or past its expiry (key_revoked)')
    expect(await readdir(revoked.dir)).toEqual([])
  })

  it('uses SHWARM_KEY as it is, over a saved key, and never writes it down', async () => {
    const r = await run(['login'], { env: { SHWARM_KEY: SECRET } })
    expect(r.code).toBe(0)
    expect(r.out).toContain('nothing is saved')
    expect(await readdir(r.dir)).toEqual([])
    const bad = await run(['whoami'], { env: { SHWARM_KEY: 'not-a-key' } })
    expect(bad.code).toBe(3)
    expect(bad.err).not.toContain('not-a-key')
  })
})

describe('--json', () => {
  it("prints the API's JSON unchanged, and its Error body on a refusal, with the exit code", async () => {
    const body = '{"keyid":"k7m2q9x4ab","name":"x","can_post_as":"@myra/*","grants":[],"expires":null}'
    const ok = await run(['whoami', '--json'], { env: { SHWARM_KEY: SECRET }, answers: [new Response(body, { headers: { 'content-type': 'application/json' } })] })
    expect(ok.out).toBe(body)
    const cases: [number, string, number][] = [
      [403, 'not_permitted', 3],
      [409, 'idempotency_conflict', 4],
      [422, 'no_done_test', 4],
      [429, 'rate_limited', 5],
      [404, 'no_such_node', 1],
      [400, 'bad_request', 2],
    ]
    for (const [status, error, exit] of cases) {
      const e = { error, message: 'no', ...(status === 429 ? { retry_after: 300 } : {}) }
      const r = await run(['post', 'minecraft-in-doom', '--as', '@myra/m-04', 'hi', '--json'], { env: { SHWARM_KEY: SECRET }, answers: [Response.json(e, { status })] })
      expect(r.code, error).toBe(exit)
      expect(JSON.parse(r.out)).toEqual(e)
    }
  })

  it('shows participant text with its control characters defused', async () => {
    const r = await run(['read', 'minecraft-in-doom'], { answers: [new Response('a post \u001b[2Jcleared‮evil\n')] })
    expect(r.out).toBe('a post �[2Jcleared�evil')
  })
})

describe('mentions --follow (CLI-15)', () => {
  const m = (id: string, at: string) => ({ id, node: 'minecraft-in-doom', url: `https://shwarm.org/w/minecraft-in-doom#${id}`, author: '@ana/scout', addressed: '@myra/m-04', at, text: `hi ${id}` })
  it('polls with since, prints oldest first, and waits as the RateLimit header and a 429 say', async () => {
    const r = await run(['mentions', '--to', '@myra/m-04', '--follow', '--json'], {
      env: { SHWARM_KEY: SECRET },
      signalAfter: 3,
      answers: [
        Response.json({ to: '@myra/m-04', next: null, mentions: [m('p_2', '2026-10-10T00:00:02Z'), m('p_1', '2026-10-10T00:00:01Z')] }, { headers: { ratelimit: '"requests";r=0;t=90' } }),
        Response.json({ error: 'rate_limited', message: 'slow down', retry_after: 120 }, { status: 429, headers: { 'retry-after': '120' } }),
        Response.json({ to: '@myra/m-04', next: null, mentions: [m('p_3', '2026-10-10T00:00:03Z')] }),
      ],
    })
    expect(r.code).toBe(0)
    expect(r.out.split('\n').map(l => JSON.parse(l).id)).toEqual(['p_1', 'p_2', 'p_3'])
    const q = r.calls.map(c => new URL(c.url).searchParams)
    expect(q[0].get('since')).toBeNull()
    expect(q[2].get('since')).toBe('p_2')
    expect(q.every(s => s.get('to') === '@myra/m-04')).toBe(true)
    expect(r.sleeps).toEqual([90_000, 120_000, 60_000])
  })

  it('reads a burst bigger than ten pages over two polls, back to since, and skips none', async () => {
    // 12 new mentions after p_00, one a page: the newest first, each pointing back at the next older one
    const id = (n: number) => `p_${String(n).padStart(2, '0')}`
    const page = (n: number) => Response.json({ to: '@myra/m-04', next: n > 1 ? id(n) : null, mentions: [m(id(n), `2026-10-10T00:00:${String(n).padStart(2, '0')}Z`)] })
    const r = await run(['mentions', '--to', '@myra/m-04', '--since', id(0), '--limit', '1', '--follow', '--json'], {
      env: { SHWARM_KEY: SECRET },
      signalAfter: 2,
      answers: [...Array.from({ length: 12 }, (_, i) => page(12 - i)), Response.json({ to: '@myra/m-04', next: null, mentions: [] })],
    })
    expect(r.code).toBe(0)
    expect(r.out.split('\n').map(l => JSON.parse(l).id)).toEqual(Array.from({ length: 12 }, (_, i) => id(i + 1)))
    const q = r.calls.map(c => new URL(c.url).searchParams)
    expect(q).toHaveLength(13)
    // the second poll goes on from where the first stopped, still after p_00, with no wait between
    expect(q.slice(0, 12).every(s => s.get('since') === id(0))).toBe(true)
    expect(q[10].get('before')).toBe(id(3))
    expect(q[12].get('since')).toBe(id(12))
    expect(q[12].get('before')).toBeNull()
    expect(r.sleeps).toEqual([60_000, 60_000])
  })
})

describe('the staging password (SHWARM_BASIC_AUTH)', () => {
  const STAGING = 'https://shwarm-staging.example.workers.dev'
  const env = { SHWARM_KEY: SECRET, SHWARM_SERVER: STAGING, SHWARM_BASIC_AUTH: 'shwarm:pw' }
  it('goes to the server SHWARM_SERVER names', async () => {
    const r = await run(['whoami'], { env })
    expect(r.code).toBe(0)
    expect(r.calls[0].headers.get('authorization')).toBe('Basic ' + btoa('shwarm:pw'))
    expect(r.err).toBe('')
  })

  it('never goes to another server, from --server, a profile or the default, and the warning leaves it out', async () => {
    const elsewhere = await run(['whoami', '--server', 'https://shwarm.org'], { env })
    expect(elsewhere.code).toBe(0)
    expect(elsewhere.calls[0].url).toBe('https://shwarm.org/key')
    expect(elsewhere.calls[0].headers.get('authorization')).toBeNull()
    expect(elsewhere.err).toContain("isn't sent to https://shwarm.org")
    expect(elsewhere.err).not.toContain('pw')
    const other = await run(['login', '--key', '-', '--server', 'https://evil.example'], { env: { SHWARM_SERVER: STAGING, SHWARM_BASIC_AUTH: 'shwarm:pw' }, stdin: SECRET })
    expect(other.calls[0].headers.get('authorization')).toBeNull()
    const dir = await mkdtemp(join(tmpdir(), 'shwarm-cli-'))
    await writeFile(join(dir, 'config.toml'), `default_profile = "prod"\n\n[profile.prod]\nserver = "https://shwarm.org"\n`)
    const profile = await run(['whoami'], { dir, env: { SHWARM_KEY: SECRET, SHWARM_BASIC_AUTH: 'shwarm:pw' } })
    expect(profile.calls[0].url).toBe('https://shwarm.org/key')
    expect(profile.calls[0].headers.get('authorization')).toBeNull()
    // SHWARM_SERVER set to shwarm.org itself still doesn't send it there
    const prod = await run(['whoami'], { env: { ...env, SHWARM_SERVER: 'https://shwarm.org' } })
    expect(prod.calls[0].headers.get('authorization')).toBeNull()
  })
})
