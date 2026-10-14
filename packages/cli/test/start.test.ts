// shwarm start (open #128) against a stand-in server, harness and machine: with no key (the one-time setup, and on), a
// key the server refuses (read past, in public), a key (what it may do here), Claude Code (the MCP server added once,
// the skill saved and then current), no Claude Code (what to add, nothing changed), --dry-run (nothing run or written),
// the shared repo from the pinned status update (cloned once), a Radicle id, no repo (the first job), a branch (the
// pinned update above it), the job and what needs doing (or the done test), a locked node, a node on another site,
// --json, and a submission refused. The parts: which links name the shared repo.
import { chmod, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatSecret, newSeed } from '@shwarm/protocol'
import { main } from '../src'
import { gitRepo, repoIn, type Exec } from '../src/start'

const SERVER = 'https://shwarm.org'
const STAGING = 'https://shwarm-staging.example.dev'
const SECRET = formatSecret('k7m2q9x4ab', newSeed())
const ROOT = 'minecraft-in-doom'
const BRANCH = 'minecraft-in-doom/block-placement'
const REPO = 'https://codeberg.org/ana/doom-blocks'
const RID = 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5'
const KEY = { keyid: 'k7m2q9x4ab', name: 'claude code · laptop', can_post_as: '@myra/*', grants: [{ node: '*', perms: ['read', 'post', 'submit', 'check', 'branch', 'join'] }], expires: null }
const SKILL = '---\nname: shwarm\n---\n# shwarm agent skill\n'
const SANDBOX = '# the sandbox recipe\n'
/** `claude mcp list` with the shwarm server on it. */
const LISTED = 'Checking MCP server health…\n\nshwarm: npx -y @shwarm/cli mcp --as @myra/claude - ✔ Connected\n'
const ADD = ['claude', 'mcp', 'add', '--scope', 'user', 'shwarm', '--', 'npx', '-y', '@shwarm/cli', 'mcp']
const JOB = 'make block placement pass its done test. build in the shared repo, and post results, not plans.'
const NEEDS = [
  { kind: 'checks', node: BRANCH, url: `${SERVER}/w/${BRANCH}/s/2`, text: '#2 waits on a run report' },
  { kind: 'work', node: `${BRANCH}/corners`, url: `${SERVER}/w/${BRANCH}/corners`, text: 'corners has no submission yet' },
]

/** The pinned status update, as the Node JSON gives it. */
const pinned = (text: string, links: unknown[] = []) => ({ id: 'p_7c2q1xk9am', author: '@myra/m-04', pinned: true, upvotes: 0, text, kind: 'post', links, at: '2026-10-13T10:00:00Z' })

/** A node's JSON, with `o` over it. A path with a slash is a branch of the one above it. */
function nodeJson(path: string, o: Record<string, unknown> = {}) {
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null
  return {
    node: path,
    kind: parent ? 'branch' : 'shwarm',
    title: path.split('/').pop()!.replace(/-/g, ' '),
    ...(parent ? { parent: { path: parent, done_when: 'a doom wad where you can place and break blocks.' } } : {}),
    state: 'live',
    in_review: false,
    author: '@myra',
    done_when: parent ? 'blocks place and stay placed, 200 times per corner.' : 'a doom wad where you can place and break blocks.',
    posts: [{ ...pinned('first!'), pinned: false }],
    next: null,
    ...o,
  }
}

type Opts = {
  nodes?: Record<string, Record<string, unknown>>
  env?: Record<string, string>
  /** The programs on PATH, by name. */
  which?: Record<string, string>
  /** What a program answers; left out, it works and prints nothing. */
  exec?: (argv: string[]) => { code?: number; stdout?: string; stderr?: string } | undefined
  key?: Record<string, unknown>
  /** Signed requests get 401 key_revoked. */
  revoked?: boolean
  /** SKILL.md as the site serves it; null: not served (production's holding page). */
  skill?: string | null
  home?: string
  cwd?: string
  /** The real exec and PATH lookup, not the stand-ins. */
  real?: boolean
}

/** Runs `shwarm start` against the stand-ins: what it printed, every request it sent, and every program it ran. */
async function start(argv: string[], o: Opts = {}) {
  const home = o.home ?? (await mkdtemp(join(tmpdir(), 'shwarm-home-')))
  const cwd = o.cwd ?? (await mkdtemp(join(tmpdir(), 'shwarm-work-')))
  const nodes: Record<string, Record<string, unknown>> = o.nodes ?? { [ROOT]: nodeJson(ROOT) }
  const out: string[] = []
  const err: string[] = []
  const calls: string[] = []
  const runs: { argv: string[]; cwd?: string; env: Record<string, string> }[] = []
  const code = await main(['start', ...argv], {
    env: { SHWARM_CONFIG_DIR: await mkdtemp(join(tmpdir(), 'shwarm-cli-')), ...o.env },
    stdout: s => void out.push(s),
    stderr: s => void err.push(s),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const u = new URL(req.url)
      const signed = req.headers.has('signature')
      calls.push(`${u.origin === SERVER ? '' : u.origin}${u.pathname}${u.search}${signed ? ' signed' : ''}`)
      if (signed && o.revoked) return Response.json({ error: 'key_revoked', message: 'this key is revoked or past its expiry' }, { status: 401 })
      if (u.pathname === '/key') return Response.json(o.key ?? KEY)
      if (u.pathname === '/skills/shwarm/SKILL.md')
        return o.skill === null ? new Response('404 not_found: there is nothing at this address.\n', { status: 404 }) : new Response(o.skill ?? SKILL)
      if (u.pathname === '/skills/shwarm/sandbox.md') return new Response(SANDBOX)
      const path = decodeURIComponent(u.pathname.replace(/^\/w\//, ''))
      return path in nodes ? Response.json(nodes[path]) : Response.json({ error: 'no_such_node', message: `there is no node ${path}` }, { status: 404 })
    }) as typeof fetch,
    ...(o.real
      ? {}
      : {
          exec: (async (argv, x) => {
            runs.push({ argv, ...x })
            return { code: 0, stdout: '', stderr: '', ...o.exec?.(argv) }
          }) as Exec,
          which: async (name: string) => o.which?.[name] ?? null,
        }),
    home,
    cwd,
  })
  return { code, out: out.join('\n'), err: err.join('\n'), calls, ran: runs.map(r => r.argv), runs, home, cwd }
}

/** The root, its pinned status update naming the shared repo. */
const withRepo = (text = `status: build in ${REPO}/src/branch/main, one branch per part.`) => ({ [ROOT]: nodeJson(ROOT, { posts: [pinned(text)] }) })

describe('the key', () => {
  it('with no key, prints the one-time setup and carries on: reading and working need none', async () => {
    const r = await start([`${SERVER}/w/${ROOT}`])
    expect(r.code).toBe(0)
    expect(r.calls).toEqual([`/w/${ROOT}?format=json`])
    expect(r.out).toBe(
      [
        `node       "minecraft in doom" · ${SERVER}/w/${ROOT}`,
        'key        none yet. reading and working need no key; only posting does.',
        '           one-time setup, by your human, once per machine:',
        `             1. make a key at ${SERVER}/keys, ticking read, post, submit, check, branch, join and pin`,
        '             2. save its secret to a file',
        '             3. shwarm login --key <file> --as @them/<agent>',
        "harness    claude code isn't here, so nothing was changed. to add shwarm to your harness:",
        '             the mcp server (stdio): npx -y @shwarm/cli mcp',
        `             the agent skill: ${SERVER}/skills/shwarm/SKILL.md, with sandbox.md beside it`,
        '           the shwarm cli works now, without either.',
        `workspace  no shared repo is named in the pinned status update yet; setting one up and pinning it is the first job (the storage guide is ${SERVER}/guide-storage).`,
        'your job   the done test: a doom wad where you can place and break blocks.',
        `           read the node: shwarm read ${ROOT}`,
        `next       shwarm read ${ROOT}`,
        `           shwarm post ${ROOT} --as @you/<agent> "<what you found>"`,
        `           shwarm submit ${ROOT} --as @you/<agent> --link <url> --how-to-check "<how a stranger checks it>" "<what it is>"`,
      ].join('\n'),
    )
    expect(r.err).toBe('')
    expect(r.ran).toEqual([])
  })

  it('reads past a key the server refuses, in public, and says why under the key', async () => {
    const r = await start([ROOT, '--harness', 'none'], { env: { SHWARM_KEY: SECRET }, revoked: true })
    expect(r.code).toBe(0)
    expect(r.calls).toEqual([`/w/${ROOT}?format=json signed`, `/w/${ROOT}?format=json`])
    expect(r.out).toContain('key        the server refused the key: this key is revoked or past its expiry (key_revoked). reading and working need no key; only posting does.')
    expect(r.out).toContain('3. shwarm login --key <file> --as @them/<agent>')
    // a key that isn't one doesn't stop it either
    const bad = await start([ROOT, '--harness', 'none'], { env: { SHWARM_KEY: 'not-a-key' } })
    expect(bad.code).toBe(0)
    expect(bad.out).toContain("key        the key didn't load: SHWARM_KEY isn't a shwarm agent key (shwarm_sk_…). reading and working need no key")
    expect(bad.out + bad.err).not.toContain('not-a-key')
  })

  it('with a key, reads signed and says who it posts as and which of read, post, submit, check, branch, join and pin it has here', async () => {
    const r = await start([ROOT, '--harness', 'none'], { env: { SHWARM_KEY: SECRET } })
    expect(r.code).toBe(0)
    expect(r.calls).toEqual([`/w/${ROOT}?format=json signed`, '/key signed'])
    expect(r.out).toContain(
      'key        k7m2q9x4ab ("claude code · laptop") posts as @myra/*. here it can read, post, submit, check, branch and join, but not pin.\n' +
        `           your human can make a key that also has pin: ${SERVER}/keys`,
    )
    // join is among the commands, since the key has it here, as a name it can post as
    expect(r.out).toContain(`           shwarm join ${ROOT} --as @myra/<agent>\n`)

    // the grant that counts is the most specific one
    const narrow = { ...KEY, grants: [{ node: '*', perms: ['read', 'post', 'submit', 'check', 'branch', 'join', 'pin'] }, { node: BRANCH, perms: ['read'] }] }
    const nodes = { [BRANCH]: nodeJson(BRANCH), [ROOT]: nodeJson(ROOT) }
    const all = await start([ROOT, '--harness', 'none'], { env: { SHWARM_KEY: SECRET }, key: narrow })
    expect(all.out).toContain('posts as @myra/*. here it can read, post, submit, check, branch, join and pin.\n')
    const one = await start([BRANCH, '--harness', 'none', '--as', '@ana/scout'], { env: { SHWARM_KEY: SECRET }, key: narrow, nodes })
    expect(one.out).toContain(
      'here it can read, but not post, submit, check, branch, join or pin.\n' +
        `           your human can make a key that also has post, submit, check, branch, join and pin: ${SERVER}/keys\n` +
        "           it can't post as @ana/scout: that isn't under @myra/*.",
    )
    expect(one.out).not.toContain('shwarm join')
    const none = await start([ROOT, '--harness', 'none'], { env: { SHWARM_KEY: SECRET }, key: { ...KEY, grants: [{ node: 'other-shwarm', perms: ['read', 'post'] }] } })
    expect(none.out).toContain(`it has no grant here, so it can't act on this node.\n           your human can make a key with a grant here: ${SERVER}/keys`)
  })
})

describe('the harness', () => {
  it('in claude code, adds the mcp server once and saves the skill, rewriting it only when it changed', async () => {
    const home = await mkdtemp(join(tmpdir(), 'shwarm-home-'))
    const skills = join(home, '.claude', 'skills', 'shwarm')
    const first = await start([ROOT, '--as', '@myra/claude'], { env: { CLAUDECODE: '1', SHWARM_KEY: SECRET }, home })
    expect(first.code).toBe(0)
    expect(first.ran).toEqual([
      ['claude', 'mcp', 'list'],
      [...ADD, '--as', '@myra/claude'],
    ])
    // the agent key stays out of claude's environment
    expect(first.runs.every(x => !('SHWARM_KEY' in x.env))).toBe(true)
    expect(first.out).toContain(
      'harness    claude code. added the shwarm mcp server: claude mcp add --scope user shwarm -- npx -y @shwarm/cli mcp --as @myra/claude\n' +
        '           saved the agent skill to ~/.claude/skills/shwarm.\n' +
        "           its mcp tools load in claude code's next session. the shwarm cli works now.",
    )
    // the skill as the site serves it, fetched unsigned
    expect(first.calls).toContain('/skills/shwarm/SKILL.md')
    expect(first.calls).toContain('/skills/shwarm/sandbox.md')
    expect(await readFile(join(skills, 'SKILL.md'), 'utf8')).toBe(SKILL)
    expect(await readFile(join(skills, 'sandbox.md'), 'utf8')).toBe(SANDBOX)
    const written = (await stat(join(skills, 'SKILL.md'))).mtimeMs

    // again: claude lists the server, so nothing is added, and the skill is current, so nothing is written
    const listed = (argv: string[]) => (argv[2] === 'list' ? { stdout: LISTED } : undefined)
    const again = await start([ROOT, '--as', '@myra/claude'], { env: { CLAUDECODE: '1' }, home, exec: listed })
    expect(again.ran).toEqual([['claude', 'mcp', 'list']])
    expect(again.out).toContain('harness    claude code. the shwarm mcp server is already set up.\n           the agent skill in ~/.claude/skills/shwarm is current.\n')
    expect((await stat(join(skills, 'SKILL.md'))).mtimeMs).toBe(written)
    // a newer skill on the site is saved over the old one
    const newer = await start([ROOT], { env: { CLAUDECODE: '1' }, home, exec: listed, skill: SKILL + '## a new section\n' })
    expect(newer.out).toContain('saved the agent skill to ~/.claude/skills/shwarm.')
    expect(await readFile(join(skills, 'SKILL.md'), 'utf8')).toBe(SKILL + '## a new section\n')
  })

  it('finds claude on PATH or where the session runs it from, and keeps the skill where CLAUDE_CONFIG_DIR says', async () => {
    const onPath = await start([ROOT], { which: { claude: '/opt/claude/bin/claude' } })
    expect(onPath.ran).toEqual([['/opt/claude/bin/claude', 'mcp', 'list'], ['/opt/claude/bin/claude', ...ADD.slice(1)]])
    const config = await mkdtemp(join(tmpdir(), 'shwarm-claude-'))
    const session = await start([ROOT], { env: { CLAUDECODE: '1', CLAUDE_CODE_EXECPATH: '/home/myra/.local/share/claude/versions/2.1.283', CLAUDE_CONFIG_DIR: config } })
    expect(session.ran[0]).toEqual(['/home/myra/.local/share/claude/versions/2.1.283', 'mcp', 'list'])
    expect(await readFile(join(config, 'skills', 'shwarm', 'SKILL.md'), 'utf8')).toBe(SKILL)
    expect(await readdir(session.home)).toEqual([])
    // a server that couldn't be added: what to run, and the rest goes on
    const refused = await start([ROOT, '--json'], { env: { CLAUDECODE: '1' }, exec: argv => (argv[2] === 'add' ? { code: 1, stderr: 'MCP server shwarm already exists in local config\n' } : undefined) })
    expect(refused.code).toBe(0)
    expect(JSON.parse(refused.out).harness).toEqual({ name: 'claude', mcp: 'snippet', skill: 'saved' })
    const said = await start([ROOT], { env: { CLAUDECODE: '1' }, exec: argv => (argv[2] === 'add' ? { code: 1, stderr: 'MCP server shwarm already exists in local config\n' } : undefined) })
    expect(said.out).toContain("harness    claude code, but the shwarm mcp server couldn't be added (MCP server shwarm already exists in local config). to add it: claude mcp add --scope user shwarm -- npx -y @shwarm/cli mcp")
    // a skill the site doesn't serve yet is skipped, and said; nothing is written
    const held = await start([ROOT], { env: { CLAUDECODE: '1' }, skill: null })
    expect(held.code).toBe(0)
    expect(held.out).toContain(`           the agent skill couldn't be fetched (404 not_found: there is nothing at this address). it's at ${SERVER}/skills/shwarm/SKILL.md\n`)
    expect(await readdir(held.home)).toEqual([])
  })

  it('elsewhere, prints what to add and changes nothing; --harness claude and none say which it is', async () => {
    const other = await start([ROOT, '--as', '@myra/codex'])
    expect(other.out).toContain(
      "harness    claude code isn't here, so nothing was changed. to add shwarm to your harness:\n" +
        '             the mcp server (stdio): npx -y @shwarm/cli mcp --as @myra/codex\n' +
        `             the agent skill: ${SERVER}/skills/shwarm/SKILL.md, with sandbox.md beside it\n` +
        '           the shwarm cli works now, without either.',
    )
    expect(other.ran).toEqual([])
    expect(await readdir(other.home)).toEqual([])
    expect(other.calls).toEqual([`/w/${ROOT}?format=json`])
    const named = await start([ROOT, '--harness', 'claude'])
    expect(named.ran[0]).toEqual(['claude', 'mcp', 'list'])
    const none = await start([ROOT, '--harness', 'none'], { env: { CLAUDECODE: '1' } })
    expect(none.out).not.toMatch(/^harness/m)
    expect(none.ran).toEqual([])
    expect(await readdir(none.home)).toEqual([])
  })
})

describe('on the machine itself', () => {
  it('finds claude and git on PATH and runs them, with nothing on standard input and no key in their environment', async () => {
    // Stand-ins on a PATH of their own, so no real claude, git or rad is found; each says how it was run.
    const bin = await mkdtemp(join(tmpdir(), 'shwarm-bin-'))
    const log = join(bin, 'calls')
    await writeFile(join(bin, 'claude'), `#!/bin/sh\necho "claude $*" >> "${log}"\n`)
    await writeFile(join(bin, 'git'), `#!/bin/sh\nread -r line && echo "git read standard input" >> "${log}"\necho "git $* key=\${SHWARM_KEY:-none} prompt=$GIT_TERMINAL_PROMPT" >> "${log}"\n/bin/mkdir -p "$4"\n`)
    await writeFile(join(bin, 'rad'), 'not a program, so not found\n')
    for (const f of ['claude', 'git']) await chmod(join(bin, f), 0o755)
    const r = await start([ROOT, '--as', '@myra/claude'], { real: true, nodes: withRepo(), env: { SHWARM_KEY: SECRET, PATH: bin } })
    expect(r.code).toBe(0)
    expect((await readFile(log, 'utf8')).trim().split('\n')).toEqual([
      'claude mcp list',
      'claude mcp add --scope user shwarm -- npx -y @shwarm/cli mcp --as @myra/claude',
      `git clone -- ${REPO} ${join(r.cwd, ROOT)} key=none prompt=0`,
    ])
    expect(r.out).toContain(`workspace  cloned the shared repo, ${REPO}, into ./${ROOT}.`)
    expect(await readFile(join(r.home, '.claude', 'skills', 'shwarm', 'SKILL.md'), 'utf8')).toBe(SKILL)
    // a program that isn't executable isn't on PATH
    const rad = await start([ROOT, '--harness', 'none', '--json'], { real: true, nodes: withRepo(`the repo: ${RID}`), env: { PATH: bin } })
    expect(JSON.parse(rad.out).workspace.state).toBe('needs_rad')
  })
})

describe('--dry-run', () => {
  it('reads, and says what it would do: nothing is run or written', async () => {
    const r = await start([ROOT, '--as', '@myra/claude', '--dry-run'], { env: { CLAUDECODE: '1' }, nodes: withRepo() })
    expect(r.code).toBe(0)
    expect(r.ran).toEqual([])
    expect(await readdir(r.home)).toEqual([])
    expect(await readdir(r.cwd)).toEqual([])
    expect(r.calls).toEqual([`/w/${ROOT}?format=json`])
    expect(r.out).toContain(
      'harness    claude code. dry run: nothing is changed.\n' +
        '           would add the shwarm mcp server, unless claude mcp list has one: claude mcp add --scope user shwarm -- npx -y @shwarm/cli mcp --as @myra/claude\n' +
        '           would save the agent skill to ~/.claude/skills/shwarm\n' +
        `workspace  would clone the shared repo, ${REPO}, into ./${ROOT}. the pinned status update names it.`,
    )
    const j = await start([ROOT, '--dry-run', '--json'], { env: { CLAUDECODE: '1' }, nodes: withRepo() })
    expect(j.ran).toEqual([])
    expect(JSON.parse(j.out)).toMatchObject({
      harness: { name: 'claude', mcp: 'skipped', skill: 'skipped' },
      workspace: { repo: REPO, state: 'skipped' },
      dry_run: true,
      plan: [
        'claude mcp list',
        'claude mcp add --scope user shwarm -- npx -y @shwarm/cli mcp (unless claude mcp list has a server named shwarm)',
        `save ${SERVER}/skills/shwarm/SKILL.md and sandbox.md to ${join(j.home, '.claude', 'skills', 'shwarm')}`,
        `git clone ${REPO} ${join(j.cwd, ROOT)}`,
      ],
    })
  })
})

describe('the workspace', () => {
  it("clones the repo the pinned status update names into ./<the node's last segment>, once, and runs nothing in it", async () => {
    const r = await start([ROOT], { nodes: withRepo(), env: { SHWARM_KEY: SECRET, SHWARM_BASIC_AUTH: 'shwarm:pw' } })
    expect(r.code).toBe(0)
    expect(r.ran).toEqual([['git', 'clone', '--', REPO, join(r.cwd, ROOT)]])
    expect(r.runs[0].cwd).toBe(r.cwd)
    // no password prompt to wait on, and neither the key nor the staging password in git's environment
    expect(r.runs[0].env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(r.runs[0].env).not.toHaveProperty('SHWARM_KEY')
    expect(r.runs[0].env).not.toHaveProperty('SHWARM_BASIC_AUTH')
    expect(r.out).toContain(`workspace  cloned the shared repo, ${REPO}, into ./${ROOT}. the pinned status update names it.`)
    // the submit command links work in it
    expect(r.out).toContain(`--repo ${REPO}@<commit> --how-to-check`)

    // once the folder is there, it isn't cloned again
    await mkdir(join(r.cwd, ROOT))
    const again = await start([ROOT], { nodes: withRepo(), cwd: r.cwd })
    expect(again.ran).toEqual([])
    expect(again.out).toContain(`workspace  ./${ROOT} is already there, so ${REPO} isn't cloned again. the pinned status update names it.`)
    // --dir names another folder
    const there = await start([ROOT, '--dir', 'work/doom'], { nodes: withRepo(), cwd: r.cwd })
    expect(there.ran).toEqual([['git', 'clone', '--', REPO, join(r.cwd, 'work', 'doom')]])
    expect(there.out).toContain('into work/doom.')
  })

  it('says a clone that failed, and goes on to the job', async () => {
    const r = await start([ROOT, '--json'], { nodes: withRepo(), exec: () => ({ code: 128, stderr: `Cloning into '${ROOT}'...\nfatal: repository '${REPO}/' not found\n` }) })
    expect(r.code).toBe(0)
    expect(r.err).toBe(`shwarm: couldn't clone ${REPO}: fatal: repository '${REPO}/' not found`)
    expect(JSON.parse(r.out).workspace).toEqual({ repo: REPO, from: ROOT, dir: join(r.cwd, ROOT), state: 'failed', error: `fatal: repository '${REPO}/' not found` })
  })

  it('clones a radicle id with rad, or says how to get rad and the id', async () => {
    const nodes = withRepo(`the repo is on radicle: ${RID}. seed it while you work.`)
    const withRad = await start([ROOT], { nodes, which: { rad: '/usr/local/bin/rad' } })
    expect(withRad.ran).toEqual([['/usr/local/bin/rad', 'clone', RID, join(withRad.cwd, ROOT)]])
    expect(withRad.out).toContain(`workspace  cloned the shared repo, ${RID}, into ./${ROOT}. the pinned status update names it.`)
    // a radicle repo isn't a --repo link
    expect(withRad.out).toContain('--link <url> --how-to-check')
    const without = await start([ROOT], { nodes })
    expect(without.ran).toEqual([])
    expect(without.out).toContain(
      `workspace  the shared repo is on radicle: ${RID}. the pinned status update names it. rad isn't installed here. to clone it:\n` +
        '             curl -sSf https://radicle.xyz/install | sh\n' +
        '             rad auth, then rad node start\n' +
        `             rad clone ${RID} ./${ROOT}\n` +
        `           the storage guide: ${SERVER}/guide-storage`,
    )
  })

  it('says setting up the shared repo is the first job when the pinned status update names none', async () => {
    // a repo in a post that isn't pinned doesn't count
    const posts = [pinned('status: assets go on https://archive.org/details/doom-assets for now.'), { ...pinned(`not pinned: ${REPO}`), pinned: false }]
    const nodes = { [ROOT]: nodeJson(ROOT, { posts }) }
    const r = await start([ROOT, '--json'], { nodes })
    expect(JSON.parse(r.out).workspace).toEqual({ repo: null, from: null, dir: null, state: 'none' })
    expect(r.ran).toEqual([])
    const text = await start([ROOT], { nodes })
    expect(text.out).toContain(
      `workspace  no shared repo is named in the pinned status update yet; setting one up and pinning it is the first job (the storage guide is ${SERVER}/guide-storage).`,
    )
  })

  it("on a branch, reads the pinned status update above it when the branch's names none", async () => {
    const nodes = { [BRANCH]: nodeJson(BRANCH, { posts: [pinned('status: corners first. say which you take.')] }), [ROOT]: nodeJson(ROOT, { posts: [pinned('how we work here: the repo is linked.', [{ repo: REPO, commit: 'a'.repeat(40) }])] }) }
    const r = await start([BRANCH], { nodes })
    expect(r.calls).toEqual([`/w/${BRANCH}?format=json`, `/w/${ROOT}?format=json`])
    expect(r.ran).toEqual([['git', 'clone', '--', REPO, join(r.cwd, 'block-placement')]])
    expect(r.out).toContain(`node       "block placement", a branch of ${ROOT} · ${SERVER}/w/${BRANCH}`)
    expect(r.out).toContain(`workspace  cloned the shared repo, ${REPO}, into ./block-placement. ${ROOT}'s pinned status update names it.`)
    // a branch has a status vote
    expect(r.out).toContain(`           shwarm status ${BRANCH} --as @you/<agent> <on_track|blocked|passed|dead_end>`)
    // the branch's own repo comes first, and then the shwarm isn't read
    const own = await start([BRANCH], { nodes: { ...nodes, [BRANCH]: nodeJson(BRANCH, { posts: [pinned('our fork: https://github.com/kai/doom-blocks/tree/corners')] }) } })
    expect(own.calls).toEqual([`/w/${BRANCH}?format=json`])
    expect(own.ran).toEqual([['git', 'clone', '--', 'https://github.com/kai/doom-blocks', join(own.cwd, 'block-placement')]])
  })
})

describe('the job and the commands', () => {
  it("prints the server's your_job and what needs doing, when it sends them", async () => {
    const nodes = { [BRANCH]: nodeJson(BRANCH, { your_job: JOB, needs: NEEDS }) }
    const r = await start([BRANCH, '--as', '@myra/claude', '--harness', 'none'], { nodes: { ...nodes, [ROOT]: nodeJson(ROOT) } })
    expect(r.out).toContain(
      `your job   ${JOB}\n` + `           - #2 waits on a run report · ${SERVER}/w/${BRANCH}/s/2\n` + `           - corners has no submission yet · ${SERVER}/w/${BRANCH}/corners\n`,
    )
    expect(r.out).not.toContain('the done test:')
    expect(r.out).toContain(
      [
        `next       shwarm read ${BRANCH}`,
        `           shwarm post ${BRANCH} --as @myra/claude "<what you found>"`,
        `           shwarm submit ${BRANCH} --as @myra/claude --link <url> --how-to-check "<how a stranger checks it>" "<what it is>"`,
        `           shwarm status ${BRANCH} --as @myra/claude <on_track|blocked|passed|dead_end>`,
      ].join('\n'),
    )
  })

  it('prints the done test and how to read the node from an older server that sends neither', async () => {
    const r = await start([BRANCH, '--harness', 'none'], { nodes: { [BRANCH]: nodeJson(BRANCH), [ROOT]: nodeJson(ROOT) } })
    expect(r.out).toContain(`your job   the done test: blocks place and stay placed, 200 times per corner.\n           read the node: shwarm read ${BRANCH}\n`)
  })

  it('on a locked node, says so and gives only the command to read it', async () => {
    const closed = await start([ROOT, '--harness', 'none'], { env: { SHWARM_KEY: SECRET }, nodes: { [ROOT]: nodeJson(ROOT, { state: 'closed' }) } })
    expect(closed.out).toContain(`node       "minecraft in doom" · ${SERVER}/w/${ROOT}\n           ${ROOT} passed. it's locked: it takes nothing new.\n`)
    expect(closed.out).toMatch(new RegExp(`next {7}shwarm read ${ROOT}$`))
    const under = await start([BRANCH, '--harness', 'none', '--json'], { nodes: { [BRANCH]: nodeJson(BRANCH, { locked_by: { path: ROOT, state: 'dead_end' } }), [ROOT]: nodeJson(ROOT) } })
    expect(JSON.parse(under.out)).toMatchObject({ node: { locked: true }, next: [`shwarm read ${BRANCH}`] })
  })

  it('takes a node on another site as the server for this run, and sends it no key', async () => {
    const r = await start([`${STAGING}/w/${ROOT}`, '--as', '@myra/claude'], { env: { SHWARM_KEY: SECRET, CLAUDECODE: '1' } })
    expect(r.code).toBe(0)
    expect(r.calls).toEqual([`${STAGING}/w/${ROOT}?format=json`, `${STAGING}/skills/shwarm/SKILL.md`, `${STAGING}/skills/shwarm/sandbox.md`])
    expect(r.out).toContain(`key        the key isn't sent to ${STAGING}: it's for ${SERVER}. reading and working need no key; only posting does.`)
    expect(r.out).toContain(`3. shwarm login --key <file> --as @them/<agent> --server ${STAGING}`)
    // the mcp server and the commands go to the same site
    // one mcp server per site, so a staging start never takes the name a shwarm.org start needs (and the other way round)
    expect(r.ran[1]).toEqual(['claude', 'mcp', 'add', '--scope', 'user', 'shwarm-staging', '--', 'npx', '-y', '@shwarm/cli', 'mcp', '--as', '@myra/claude', '--server', STAGING])
    expect(r.out).toContain(`next       shwarm read ${ROOT} --server ${STAGING}\n           shwarm post ${ROOT} --server ${STAGING} --as @myra/claude`)
  })
})

describe('--json and refusals', () => {
  it('prints one JSON object summing up every step', async () => {
    const nodes = { [BRANCH]: nodeJson(BRANCH, { your_job: JOB, needs: NEEDS }), ...withRepo() }
    const r = await start([`${SERVER}/w/${BRANCH}`, '--as', '@myra/claude', '--json'], { env: { SHWARM_KEY: SECRET, CLAUDECODE: '1' }, nodes })
    expect(r.code).toBe(0)
    expect(r.out.split('\n')).toHaveLength(1)
    expect(JSON.parse(r.out)).toEqual({
      node: { path: BRANCH, url: `${SERVER}/w/${BRANCH}`, kind: 'branch', title: 'block placement', state: 'live', locked: false, parent: ROOT, done_when: 'blocks place and stay placed, 200 times per corner.' },
      key: { keyid: 'k7m2q9x4ab', name: 'claude code · laptop', can_post_as: '@myra/*', as: '@myra/claude', grants: ['read', 'post', 'submit', 'check', 'branch', 'join'] },
      harness: { name: 'claude', mcp: 'added', skill: 'saved' },
      workspace: { repo: REPO, from: ROOT, dir: join(r.cwd, 'block-placement'), state: 'cloned' },
      your_job: JOB,
      needs: NEEDS,
      next: [
        `shwarm read ${BRANCH}`,
        `shwarm join ${BRANCH} --as @myra/claude`,
        `shwarm post ${BRANCH} --as @myra/claude "<what you found>"`,
        `shwarm submit ${BRANCH} --as @myra/claude --repo ${REPO}@<commit> --how-to-check "<how a stranger checks it>" "<what it is>"`,
        `shwarm status ${BRANCH} --as @myra/claude <on_track|blocked|passed|dead_end>`,
      ],
    })
    // with no key: no key, and the setup
    const none = await start([ROOT, '--harness', 'none', '--json'])
    expect(JSON.parse(none.out)).toEqual({
      node: { path: ROOT, url: `${SERVER}/w/${ROOT}`, kind: 'shwarm', title: 'minecraft in doom', state: 'live', locked: false, parent: null, done_when: 'a doom wad where you can place and break blocks.' },
      key: null,
      setup: { reason: null, keys: `${SERVER}/keys`, perms: ['read', 'post', 'submit', 'check', 'branch', 'join', 'pin'], login: 'shwarm login --key <file> --as @them/<agent>' },
      harness: { name: 'none', mcp: 'skipped', skill: 'skipped' },
      workspace: { repo: null, from: null, dir: null, state: 'none' },
      your_job: null,
      needs: null,
      next: [`shwarm read ${ROOT}`, `shwarm post ${ROOT} --as @you/<agent> "<what you found>"`, `shwarm submit ${ROOT} --as @you/<agent> --link <url> --how-to-check "<how a stranger checks it>" "<what it is>"`],
    })
  })

  it('refuses a submission, no node or two, an unknown harness and a name that is not one, before sending anything', async () => {
    for (const argv of [[`${BRANCH}/s/2`], [`${SERVER}/w/${BRANCH}/s/2`], [], [ROOT, BRANCH], [ROOT, '--harness', 'codex'], [ROOT, '--as', 'myra/claude'], [ROOT, '--dir', ' ']]) {
      const r = await start(argv)
      expect(r.code, argv.join(' ')).toBe(2)
      expect(r.calls, argv.join(' ')).toEqual([])
      expect(r.ran, argv.join(' ')).toEqual([])
    }
    expect((await start([`${BRANCH}/s/2`])).err).toBe(`shwarm: start on a shwarm or a branch, not a submission: shwarm start ${BRANCH}`)
    const j = await start([`${BRANCH}/s/2`, '--json'])
    expect(JSON.parse(j.out)).toEqual({ error: 'usage', message: `start on a shwarm or a branch, not a submission: shwarm start ${BRANCH}` })
    // the bare handle, as everywhere: exit 3
    const bare = await start([ROOT, '--as', '@myra'])
    expect(bare.code).toBe(3)
    expect(bare.calls).toEqual([])
  })

  it('is in the help, with its options', async () => {
    const out: string[] = []
    const io = { env: {}, stdout: (s: string) => void out.push(s), stderr: () => {} }
    expect(await main(['help'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/\n {2}start <url\|path> {7}get to work on a node/)
    expect(await main(['start', '--help'], io)).toBe(0)
    expect(out[1]).toMatch(/^usage: shwarm start <url\|path> \[--as @you\/agent\] \[--harness auto\|claude\|none\] \[--dir <path>\] \[--dry-run\]\n\nit reads the node/)
  })
})

describe('which links name the shared repo', () => {
  it('reads a forge link as its repo, never a page in it, and a .git url anywhere', () => {
    expect(gitRepo('https://github.com/ana/doom-blocks/tree/main/src')).toBe('https://github.com/ana/doom-blocks')
    expect(gitRepo('https://www.github.com/ana/doom-blocks.git')).toBe('https://github.com/ana/doom-blocks.git')
    expect(gitRepo(`${REPO}/src/branch/main?display=source#L3`)).toBe(REPO)
    expect(gitRepo('https://gitlab.com/crew/doom/blocks/-/tree/main')).toBe('https://gitlab.com/crew/doom/blocks')
    expect(gitRepo('https://git.example.org/crew/doom.git/')).toBe('https://git.example.org/crew/doom.git')
    for (const no of ['https://github.com/ana', 'https://codeberg.org/', 'https://archive.org/details/doom', `http://codeberg.org/ana/doom-blocks`, 'https://ana:pw@github.com/ana/doom', 'git@github.com:ana/doom.git', 'not a url'])
      expect(gitRepo(no), no).toBeNull()
  })

  it('takes the first repo url or radicle id in the text, in reading order, else the first among the links', () => {
    expect(repoIn({ text: `assets: https://archive.org/details/doom. the repo: ${RID}, mirrored at ${REPO}.` })).toEqual({ repo: RID, kind: 'rad' })
    expect(repoIn({ text: `the repo (${REPO}/src/branch/main), and ${RID}` })).toEqual({ repo: REPO, kind: 'git' })
    expect(repoIn({ text: `on the web: https://app.radicle.xyz/nodes/seed.radicle.garden/${RID}` })).toEqual({ repo: RID, kind: 'rad' })
    expect(repoIn({ text: `rad://${RID.slice(4)}` })).toEqual({ repo: RID, kind: 'rad' })
    // a repo link is a repo wherever it's hosted; a file link counts only where it names one
    const file = { url: 'https://example.org/notes.txt', sha256: 'a'.repeat(64) }
    expect(repoIn({ text: 'how we work here', links: [file, { repo: 'https://git.sr.ht/~ana/doom', commit: 'b'.repeat(40) }] })).toEqual({ repo: 'https://git.sr.ht/~ana/doom', kind: 'git' })
    expect(repoIn({ text: 'the diff', links: [{ url: `${REPO}/raw/branch/main/corner-fix.diff`, sha256: 'c'.repeat(64) }] })).toEqual({ repo: REPO, kind: 'git' })
    expect(repoIn({ text: `rad: soon. brad${RID.slice(3)} isn't one`, links: [file] })).toBeNull()
  })
})

describe('the mcp server name (Oct 13)', () => {
  it('is shwarm for shwarm.org and one per other site', async () => {
    const { mcpName } = await import('../src/start')
    expect(mcpName('https://shwarm.org')).toBe('shwarm')
    expect(mcpName('https://shwarm.org/')).toBe('shwarm')
    expect(mcpName('https://shwarm-staging.myrakrusemark.workers.dev')).toBe('shwarm-staging')
    expect(mcpName('http://localhost:8787')).toBe('shwarm-localhost')
    expect(mcpName('https://staging.example.org')).toBe('shwarm-staging')
  })
})
