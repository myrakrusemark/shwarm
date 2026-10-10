// shwarm run (go-live 7.8) against a stand-in server: each refusal made before anything runs (own work, a slot held,
// the author's sign-off, a name or grant the key lacks, no runs, nothing in review, a submission hash or a link that
// doesn't match), the question and --yes, the report's fields, a log too big to go inline saved and posted later with
// --report, and the parts: the script hash, the container's flags, the time limit. apps/site/test/cli.test.ts runs
// it against the real Worker.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { formatSecret, newSeed, submissionHash, type Link } from '@shwarm/protocol'
import { main } from '../src'
import { containerArgv, runCommand, scriptHash, systemGit, visible, type Git } from '../src/run'

const SECRET = formatSecret('k7m2q9x4ab', newSeed())
const SERVER = 'https://shwarm.org'
const PATH = 'minecraft-in-doom/block-placement'
const KEY = { keyid: 'k7m2q9x4ab', name: 'runner', can_post_as: '@lumpy/*', grants: [{ node: '*', perms: ['read', 'check'] }], expires: null }
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')

/** A file the submission links, served by the stand-in web. */
const FILE_URL = 'https://codeberg.org/ana/doom-blocks/raw/commit/9f2c4e1a/corner-fix.diff'
const FILE_BYTES = '--- a/place.c\n+++ b/place.c\n'
/** The repo the submission links, as a local repo the git stand-in clones instead. */
const REPO_URL = 'https://codeberg.org/ana/doom-blocks'
let repoDir = ''
let commit = ''
/** Where the check script leaves a mark when it runs, so a test can tell nothing ran. */
let marks = ''

beforeAll(async () => {
  repoDir = await mkdtemp(join(tmpdir(), 'shwarm-repo-'))
  marks = await mkdtemp(join(tmpdir(), 'shwarm-marks-'))
  await writeFile(join(repoDir, 'check.sh'), `#!/bin/sh\necho "placed 200, 0 failures"\necho ran >> "${marks}/ran"\n[ -z "$SHWARM_KEY" ] || echo "the key leaked"\n`)
  await chmod(join(repoDir, 'check.sh'), 0o755)
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repoDir, encoding: 'utf8' }).trim()
  git('init', '--quiet')
  git('add', 'check.sh')
  git('commit', '--quiet', '-m', 'check')
  commit = git('rev-parse', 'HEAD')
})

/** git, with the repo's https address pointing at the local repo (file:// allowed for it alone). */
const localGit: Git = (args, o) =>
  systemGit(
    args.map(a => (a === REPO_URL ? repoDir : a === 'protocol.allow=never' ? 'protocol.file.allow=always' : a)),
    o,
  )

type World = { node?: Record<string, unknown>; sub?: Record<string, unknown>; links?: Link[]; key?: Record<string, unknown>; served?: Record<string, string> }

async function world(w: World = {}) {
  const links = w.links ?? [{ url: FILE_URL, sha256: sha(FILE_BYTES), label: 'corner-fix.diff' }, { repo: REPO_URL, commit }]
  const text = 'corner fix, take three.'
  const sub = {
    node: PATH,
    number: 2,
    id: 'p_7c2q1xk9am',
    hash: await submissionHash({ text, links }),
    by: '@ana/scout',
    status: 'in_review',
    author_swap: false,
    text,
    links,
    how_to_check: 'run ./check.sh. expect 0 failures.',
    checks: [],
    ...w.sub,
  }
  const node = { node: PATH, state: 'live', author: '@bmo_fan', check: { runs: { command: './check.sh', count: 2 }, author: true }, review: { number: 2 }, ...w.node }
  return { node, sub, key: { ...KEY, ...w.key }, served: { [FILE_URL]: FILE_BYTES, ...w.served } as Record<string, string> }
}

async function run(argv: string[], o: { world?: Awaited<ReturnType<typeof world>>; answer?: string; noAsk?: boolean; post?: Response } = {}) {
  const w = o.world ?? (await world())
  const out: string[] = []
  const err: string[] = []
  const calls: { method: string; url: string; body: any }[] = []
  const fetched: string[] = []
  const asked: string[] = []
  const code = await main(argv, {
    env: { SHWARM_CONFIG_DIR: await mkdtemp(join(tmpdir(), 'shwarm-cli-')), SHWARM_KEY: SECRET, PATH: process.env.PATH },
    stdout: s => void out.push(s),
    stderr: s => void err.push(s),
    stdin: async () => '',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const u = new URL(req.url)
      if (u.origin !== SERVER) {
        fetched.push(req.url)
        return req.url in w.served ? new Response(w.served[req.url]) : new Response('not here', { status: 404 })
      }
      calls.push({ method: req.method, url: u.pathname, body: req.method === 'POST' ? await req.json() : null })
      if (req.method === 'POST') return o.post ?? Response.json({ id: 'c_1', post: 'p_2', on: w.sub.id, verdict: 'pass', slot: 'run', submission_state: 'in_review', node_state: 'live' }, { status: 201 })
      if (u.pathname === '/key') return Response.json(w.key)
      if (u.pathname === `/w/${PATH}`) return Response.json(w.node)
      if (u.pathname === `/w/${PATH}/s/2`) return Response.json(w.sub)
      return Response.json({ error: 'no_such_node', message: 'no' }, { status: 404 })
    }) as typeof fetch,
    git: localGit,
    ...(o.noAsk
      ? {}
      : {
          ask: async (q: string) => {
            asked.push(q)
            return o.answer ?? 'y'
          },
        }),
  })
  const posts = calls.filter(c => c.method === 'POST')
  return { code, out: out.join('\n'), err: err.join('\n'), calls, posts, fetched, asked }
}

const ran = () => access(join(marks, 'ran')).then(() => true, () => false)
const clearMarks = () => rm(join(marks, 'ran'), { force: true })

describe('shwarm run', () => {
  it('shows the command, asks, runs it with nothing from here, and posts the report', async () => {
    await clearMarks()
    const r = await run(['run', PATH, '--as', '@lumpy/runner', '--machine', 'linux, rtx 3060', 'ran it twice.'])
    expect(r.code).toBe(0)
    expect(r.out).toBe('pass recorded. the submission is in review.')
    expect(r.asked).toEqual(['run it? [y/N] '])
    expect(r.err).toContain('  command     ./check.sh')
    expect(r.err).toMatch(/  links       link-0 corner-fix\.diff \(sha256 [0-9a-f]{7}, matches\); repo-1 https:\/\/codeberg\.org\/ana\/doom-blocks \(commit [0-9a-f]{7}, matches\)/)
    expect(r.err).toContain(`  script      ./check.sh, sha256 ${sha(await readFile(join(repoDir, 'check.sh'))).slice(0, 7)}`)
    expect(r.err).toContain('it runs on this machine as you')
    expect(r.err).toContain('exit 0 after')
    expect(await ran()).toBe(true)
    expect(r.calls.map(c => `${c.method} ${c.url}`)).toEqual(['GET /key', `GET /w/${PATH}`, `GET /w/${PATH}/s/2`, `POST /w/${PATH}`])
    const w = await world()
    expect(r.posts[0].body).toEqual({
      kind: 'check',
      slot: 'run',
      as: '@lumpy/runner',
      on: 'p_7c2q1xk9am',
      submission_hash: w.sub.hash,
      script_hash: sha(await readFile(join(repoDir, 'check.sh'))),
      exit: 0,
      log: 'placed 200, 0 failures\n', // and no "the key leaked": SHWARM_KEY stays out of the command's environment
      env: 'linux, rtx 3060',
      text: 'ran it twice.',
    })
    expect(r.fetched).toEqual([FILE_URL])
  })

  it('posts a nonzero exit as a fail, with --yes and no question, and --dry-run posts nothing', async () => {
    const failing = await world({ node: { check: { runs: { command: 'exit 3' } } } })
    const r = await run(['run', `${PATH}/s/2`, '--as', '@lumpy/runner', '--yes'], { world: failing, noAsk: true })
    expect(r.code).toBe(0)
    expect(r.asked).toEqual([])
    expect(r.posts[0].body).toMatchObject({ exit: 3, log: '', script_hash: sha('exit 3') }) // no script file: the command's text
    const dry = await run(['run', PATH, '--as', '@lumpy/runner', '--yes', '--dry-run', '--json'], { world: failing })
    expect(dry.code).toBe(0)
    expect(dry.posts).toEqual([])
    expect(JSON.parse(dry.out)).toMatchObject({ kind: 'check', slot: 'run', exit: 3, env: expect.stringMatching(/^(linux|macos|windows|\w+), \w+, \d+ cpus$/) })
  })

  it('runs nothing when the human says no, and needs --yes where there is no terminal to ask', async () => {
    await clearMarks()
    const no = await run(['run', PATH, '--as', '@lumpy/runner'], { answer: 'n' })
    expect(no.code).toBe(1)
    expect(no.err).toContain('shwarm: not run. nothing was posted.')
    expect(no.posts).toEqual([])
    expect(await ran()).toBe(false)
    const piped = await run(['run', PATH, '--as', '@lumpy/runner', '--json'], { noAsk: true })
    expect(piped.code).toBe(2)
    expect(JSON.parse(piped.out).error).toBe('usage')
    expect(piped.calls).toEqual([])
  })

  it('refuses before fetching or running anything what the API would refuse, with its code and exit', async () => {
    await clearMarks()
    const cases: [string, World, string, number][] = [
      ['own work', { sub: { by: '@lumpy/m-04' } }, 'own_work', 3],
      ['a slot held by another of my names', { sub: { checks: [{ slot: 'people', as: '@lumpy/scout', verdict: 'pass' }] } }, 'slot_taken', 4],
      ["the author's sign-off", { node: { author: '@lumpy' } }, 'not_permitted', 3],
      ['a name outside can post as', { key: { can_post_as: '@lumpy/ci-*' } }, 'not_permitted', 3],
      ['a grant without check', { key: { grants: [{ node: '*', perms: ['read', 'check'] }, { node: 'minecraft-in-doom', perms: ['read'] }] } }, 'not_permitted', 3],
      ['no runs in the done test', { node: { check: { author: true } } }, 'bad_request', 2],
      ['a passed submission', { sub: { status: 'passed' } }, 'bad_request', 2],
      ['a locked node', { node: { state: 'closed' } }, 'shwarm_closed', 4],
      ['a submission whose text was changed', { sub: { text: 'corner fix, take four.' } }, 'hash_mismatch', 4],
    ]
    for (const [what, w, error, exit] of cases) {
      const r = await run(['run', PATH, '--as', '@lumpy/runner', '--json'], { world: await world(w) })
      expect(r.code, what).toBe(exit)
      expect(JSON.parse(r.out).error, what).toBe(error)
      expect(r.posts, what).toEqual([])
      expect(r.fetched, what).toEqual([])
      expect(r.asked, what).toEqual([])
    }
    // a reset check doesn't hold a slot
    const reset = await run(['run', PATH, '--as', '@lumpy/runner', '--yes', '--dry-run'], { world: await world({ sub: { checks: [{ slot: 'run', as: '@lumpy/r', verdict: 'pass', reset: true }] } }) })
    expect(reset.code).toBe(0)
    expect(await ran()).toBe(true)
  })

  it('refuses a link with a wrong hash, a wrong commit or a missing path before anything runs', async () => {
    await clearMarks()
    const cases: [string, Link[], RegExp][] = [
      ['a file with a wrong hash', [{ url: FILE_URL, sha256: sha('something else') }, { repo: REPO_URL, commit }], /^link 0 \(https:\/\/codeberg\.org\/.+\) doesn't match its sha256: it hashes to [0-9a-f]{7}, not [0-9a-f]{7}\. nothing was run$/],
      ['a commit the repo lacks', [{ repo: REPO_URL, commit: 'f'.repeat(40) }], /^link 0 \(https:\/\/codeberg\.org\/ana\/doom-blocks\) has no commit fffffff\. nothing was run$/],
      ['a path the commit lacks', [{ repo: REPO_URL, commit, path: 'soak.sh', label: 'soak' }], /^link 0 \(soak\) has no soak\.sh at [0-9a-f]{7}\. nothing was run$/],
      ['a link that is not https', [{ url: 'http://codeberg.org/x', sha256: sha('x') }], /isn't an https address/],
    ]
    for (const [what, links, message] of cases) {
      const r = await run(['run', PATH, '--as', '@lumpy/runner', '--json'], { world: await world({ links }) })
      expect(r.code, what).toBe(4)
      expect(JSON.parse(r.out), what).toMatchObject({ error: 'link_mismatch', message: expect.stringMatching(message), link: 0 })
      expect(r.asked, what).toEqual([])
      expect(r.posts, what).toEqual([])
    }
    expect(await ran()).toBe(false)
  })

  it('saves a log over 64 KB to be linked, and posts it with --report once the link holds the same bytes', async () => {
    const big = await world({ node: { check: { runs: { command: 'head -c 70000 /dev/zero | tr "\\0" x' } } } })
    const r = await run(['run', PATH, '--as', '@lumpy/runner', '--yes'], { world: big })
    expect(r.code).toBe(1)
    expect(r.posts).toEqual([])
    expect(r.err).toMatch(/the log is 69 KB, over the 64 KB that goes inline\. it's saved at .+run\.log \(sha256 [0-9a-f]{64}\)/)
    const file = /shwarm run --report (\S+) --log-url <url>/.exec(r.err)![1]
    const logUrl = 'https://archive.org/download/runs/block-placement-2.log'
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved).toMatchObject({ server: SERVER, node: PATH, log_sha256: sha('x'.repeat(70000)), report: { exit: 0, on: 'p_7c2q1xk9am' } })
    expect(saved.report.log).toBeUndefined()

    // a link that doesn't hold the log is refused; the right one is posted
    const wrong = await run(['run', '--report', file, '--log-url', logUrl], { world: { ...big, served: { [logUrl]: 'x' } } })
    expect(wrong.code).toBe(4)
    expect(wrong.posts).toEqual([])
    const posted = await run(['run', '--report', file, '--log-url', logUrl], { world: { ...big, served: { [logUrl]: 'x'.repeat(70000) } } })
    expect(posted.code).toBe(0)
    expect(posted.posts[0].body).toMatchObject({ kind: 'check', slot: 'run', as: '@lumpy/runner', exit: 0, log: { url: logUrl, sha256: sha('x'.repeat(70000)) } })
  })

  it('saves a report the server could not take for now, to post again with --report', async () => {
    const r = await run(['run', PATH, '--as', '@lumpy/runner', '--yes'], { post: Response.json({ error: 'rate_limited', message: 'slow down', retry_after: 3600 }, { status: 429 }) })
    expect(r.code).toBe(5)
    const file = /to post it again: shwarm run --report (\S+)/.exec(r.err)![1]
    const again = await run(['run', '--report', file])
    expect(again.code).toBe(0)
    expect(again.posts[0].body).toMatchObject({ exit: 0, log: 'placed 200, 0 failures\n' })
  })
})

describe('the parts', () => {
  it("hashes the script the command runs, or the command's text, never a file outside the work", async () => {
    const work = await mkdtemp(join(tmpdir(), 'shwarm-work-'))
    await writeFile(join(work, 'soak.sh'), 'echo soak\n')
    const outside = await mkdtemp(join(tmpdir(), 'shwarm-outside-'))
    await writeFile(join(outside, 'x.sh'), 'echo x\n')
    await symlink(join(outside, 'x.sh'), join(work, 'link.sh'))
    const file = { script: 'soak.sh', hash: sha('echo soak\n') }
    expect(await scriptHash('./soak.sh --fps 60', work, work)).toEqual({ script: './soak.sh', hash: file.hash })
    expect(await scriptHash('bash -e soak.sh && ./license-scan.sh', work, work)).toEqual(file)
    expect(await scriptHash('make test', work, work)).toEqual({ script: null, hash: sha('make test') })
    expect(await scriptHash(`sh ${join(outside, 'x.sh')}`, work, work)).toEqual({ script: null, hash: sha(`sh ${join(outside, 'x.sh')}`) })
    expect(await scriptHash('./link.sh', work, work)).toEqual({ script: null, hash: sha('./link.sh') })
    expect(await scriptHash('../x.sh', work, work)).toEqual({ script: null, hash: sha('../x.sh') })
  })

  it("builds the sandbox recipe's container run", () => {
    const base = { image: 'docker.io/library/debian:stable-slim@sha256:' + 'a'.repeat(64), work: '/tmp/shwarm-run-1/work', minutes: 30, uid: 1000, gid: 1000 }
    const podman = containerArgv({ ...base, engine: 'podman', cwd: '/tmp/shwarm-run-1/work/repo-1' })
    expect(podman.join(' ')).toBe(
      `podman run --rm --network=none --userns=keep-id --cap-drop=ALL --security-opt=no-new-privileges --cpus=2 --memory=4g --pids-limit=256 --read-only --tmpfs /tmp:rw,size=1g -v /tmp/shwarm-run-1/work:/work:rw -w /work/repo-1 ${base.image} timeout 30m sh /work/.shwarm-run.sh`,
    )
    const docker = containerArgv({ ...base, engine: 'docker', cwd: base.work })
    expect(docker).toContain('--user')
    expect(docker).toContain('1000:1000')
    expect(docker).not.toContain('--userns=keep-id')
    expect(docker[docker.indexOf('-w') + 1]).toBe('/work')
  })

  it('stops a command at the time limit, everything it started with it, and reports 124', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shwarm-limit-'))
    const out = await runCommand({ argv: ['sh', '-c', 'echo start; sleep 30 & sleep 30'], cwd: dir, env: { PATH: process.env.PATH! }, logFile: join(dir, 'log'), limitMs: 300 })
    expect(out).toMatchObject({ exit: 124, timedOut: true, interrupted: false })
    expect(out.seconds).toBeLessThan(5)
    expect(await readFile(join(dir, 'log'), 'utf8')).toBe('start\n')
  })

  it('shows hidden characters in a command instead of passing them on', () => {
    expect(visible('./check.sh\u202e hs.kcehc')).toBe('./check.sh\\u202e hs.kcehc')
    expect(visible('a\u001b[2Jb\u200bc')).toBe('a\\u001b[2Jb\\u200bc')
  })
})
