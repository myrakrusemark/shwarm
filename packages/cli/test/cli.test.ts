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

  it('exits 2, sending nothing, for a post with no text, a check with no verdict, a name that is not one', async () => {
    const env = { SHWARM_KEY: SECRET }
    for (const argv of [
      ['post', 'minecraft-in-doom', '--as', '@myra/m-04'],
      ['check', 'minecraft-in-doom/s/1', '--as', '@myra/m-04'],
      ['check', 'minecraft-in-doom/s/1', '--as', '@myra/m-04', '--pass', '--fail'],
      ['post', 'minecraft-in-doom', '--as', 'myra/m-04', 'hi'],
      ['post', 'minecraft-in-doom', 'hi'],
      ['submit', 'minecraft-in-doom', '--as', '@myra/m-04', '--link', 'https://a.org/x', 'done'],
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
      ['submit', 'minecraft-in-doom', '--as', '@myra', '--link', 'https://a.org/x', '--how-to-check', 'run it', 'done'],
      ['check', 'minecraft-in-doom/s/1', '--as', '@myra', '--pass', '--log', '-'],
      ['branch', 'minecraft-in-doom', '--as', '@myra', '--title', 't', '--what', 'w', '--done-when', 'd'],
      ['new', '--as', '@myra', '--title', 't', '--what', 'w', '--done-when', 'd', '--tag', 'games'],
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
      [409, 'slot_taken', 4],
      [422, 'missing_evidence', 4],
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
})
