// `shwarm start <node url or path>` (open #128, idea 2: "drop a shwarm url into a harness, and the agent just knows
// exactly what to do"): from a node to work in one command. It's safe to run again: it changes only what's missing.
//   1. the node: a path or a node URL. A URL on another site makes that site the server for this run, read without
//      the key, as `shwarm read` does. Never a submission.
//   2. its JSON, signed when there's a key. A key the server refuses is read past, in public: reading needs none.
//   3. the key (GET /key): who it posts as, and what its grant here allows. With none, the one-time setup, and on.
//   4. the harness: in Claude Code (CLAUDECODE=1, or `claude` on PATH), the shwarm MCP server added at user scope
//      unless `claude mcp list` has one, and the agent skill saved to ~/.claude/skills/shwarm, rewritten only when it
//      changed. Anywhere else, what to add, and nothing changed. --harness none leaves the harness alone.
//   5. the workspace: the shared repo the pinned status update names (the node's, else the nearest one above it that
//      names one), a git URL or a Radicle id, cloned into ./<the node's last path segment> unless that's there.
//      Nothing in it is run.
//   6. the job: the node JSON's your_job and needs (open #128, idea 3), or on an older server the done test.
//   7. the commands to go on with.
// --dry-run reads, and says what it would do: it runs and writes nothing. Everything from outside comes through `io`
// (exec, which, home, cwd), so tests touch no real harness, home folder or repo.
// OPEN (#128): new wording, here to the end of the file.
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join, resolve, sep } from 'node:path'
import { grantFor, matchesPostAs, repoIn, type Link, type SharedRepo } from '@shwarm/protocol'
import type { Io } from './cli'
import { DEFAULT_SERVER, STATUSES, type KeyInfo, type ShwarmClient } from './client'
import type { Profile } from './config'
import { ApiError, AuthError, NetworkError, UsageError } from './errors'
import { agentName, parseRef } from './refs'

/** Runs a program to its end and hands back what it printed; code 127 when it can't be started. */
export type Exec = (argv: string[], o: { cwd?: string; env: Record<string, string> }) => Promise<{ code: number; stdout: string; stderr: string }>

/** What `shwarm start` runs with: the command's context from cli.ts. */
export type StartCtx = {
  io: Io
  flags: Record<string, unknown>
  args: string[]
  json: boolean
  server: string
  profile: Profile
  /** The client for the server, signing with the key when there is one. AuthError when the key can't be loaded. */
  client(): Promise<ShwarmClient>
  /** A client with no key: public reads, with the staging password only where it goes. */
  publicClient(server: string): ShwarmClient
  /** A line, in text mode; terminal-safe. */
  say(s: string): void
  warn(s: string): void
}

/** What a key needs to take part fully: the one-time setup ticks these, and the key line says which it lacks here. */
export const WANT = ['read', 'post', 'submit', 'check', 'branch', 'join', 'pin'] as const

/** The MCP server, the same in every harness. */
const MCP = ['npx', '-y', '@shwarm/cli', 'mcp']
/** Where a step's lines start, after its label. */
const PAD = 11

type Post = { pinned?: boolean; text?: string; links?: Link[] }
/** The parts of the Node JSON start reads. your_job and needs are new (open #128, idea 3); an older server sends neither. */
type StartNode = {
  node: string
  kind: string
  title: string
  state: string
  locked_by?: { path: string; state: string }
  paused?: boolean
  parent?: { path: string }
  done_when: string
  posts?: Post[]
  your_job?: unknown
  needs?: unknown
  /** The shared repo, as the server finds it (#128): it skips the launch seed's sources post. Newer servers only. */
  work?: { repo: string; kind: 'git' | 'rad'; from: string } | null
}
/** One thing that needs doing, as the server says it: its kind, the node, where to go, and a line saying it. */
type Need = { kind?: string; node?: string; url?: string; text: string }
type Found = SharedRepo
/** What a step that changes this machine runs with. `plan` collects what --dry-run would have done. */
type Local = { io: Io; env: Record<string, string>; cwd: string; dryRun: boolean; plan: string[]; warn(s: string): void }

const readNode = async (client: ShwarmClient, path: string) => (await client.getNode(path, { format: 'json' })).json as StartNode
/** Participant text on one line. */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
const listOf = (xs: readonly string[], and: string) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`)
/** A reason to quote inside a sentence: one line, with no full stop of its own. */
const reason = (s: string) => s.trim().split('\n').pop()!.trim().replace(/\.+$/, '') || 'no reason given'
const lastLine = (r: { stdout: string; stderr: string }) => reason(r.stderr.trim() || r.stdout)
const exists = (p: string) => lstat(p).then(() => true, () => false)
const whichOf = (io: Io) => io.which ?? ((name: string) => onPath(name, io.env.PATH))

export async function start(ctx: StartCtx): Promise<void> {
  const io = ctx.io
  const flag = (k: string) => ctx.flags[k] as string | undefined
  // 1. The node, and what to run with, refused here before anything is sent.
  const v = ctx.args[0]
  if (!v) throw new UsageError('say which node: its url, like https://shwarm.org/w/minecraft-in-doom, or its path')
  if (ctx.args.length > 1) throw new UsageError('shwarm start takes one node')
  const ref = parseRef(v)
  if (ref.submission !== null) throw new UsageError(`start on a shwarm or a branch, not a submission: shwarm start ${ref.path}`)
  const harness = flag('harness') ?? 'auto'
  if (harness !== 'auto' && harness !== 'claude' && harness !== 'none') throw new UsageError('--harness is auto, claude or none')
  if (flag('dir') !== undefined && !flag('dir')!.trim()) throw new UsageError('--dir is a folder')
  // The name for the MCP server and the commands below, refused now if it's the bare handle, as `shwarm mcp` does.
  const named = (flag('as') ?? ctx.profile.as)?.trim()
  const as = named ? agentName(named) : null
  // A node on another site makes that site the server for this run.
  const elsewhere = ref.origin !== null && ref.origin !== ctx.server
  const server = elsewhere ? ref.origin! : ctx.server
  // What the commands printed below, and the MCP server, need to reach the same server with the same profile.
  const carry = [...(flag('profile') ? ['--profile', flag('profile')!] : []), ...(elsewhere || flag('server') ? ['--server', server] : [])]
  const show = (label: string, lines: string[]) => lines.flatMap(l => l.split('\n')).forEach((l, i) => ctx.say((i ? '' : label).padEnd(PAD) + l))
  const local: Local = { io, env: childEnv(io.env), cwd: io.cwd ?? process.cwd(), dryRun: ctx.flags['dry-run'] === true, plan: [], warn: ctx.warn }

  // 2. The node JSON, signed when there's a key. A key that can't be used doesn't stop it: reading needs none.
  let trouble: string | null = null
  let keyed: ShwarmClient | null = null
  try {
    keyed = await ctx.client()
  } catch (e) {
    if (!(e instanceof AuthError)) throw e
    trouble = `the key didn't load: ${e.message}`
  }
  // Another site's node is a public read, sent with no key, as `shwarm read` does.
  if (elsewhere && keyed?.key) trouble = `the key isn't sent to ${server}: it's for ${ctx.server}`
  let client = keyed && !elsewhere ? keyed : ctx.publicClient(server)
  let node: StartNode
  try {
    node = await readNode(client, ref.path)
  } catch (e) {
    // Revoked, past its expiry or unknown here: said under the key, and read in public.
    if (!(client.key && e instanceof ApiError && e.status === 401)) throw e
    trouble = `the server refused the key: ${e.message} (${e.code})`
    client = ctx.publicClient(server)
    node = await readNode(client, ref.path)
  }
  // It, or a node above it, ended: it takes nothing new (the server's words, as `shwarm run` gives them).
  const ended = node.state !== 'live' ? { path: node.node, state: node.state } : node.locked_by ?? null
  show('node', [
    `"${flat(node.title)}"${node.kind === 'branch' && node.parent ? `, a branch of ${node.parent.path}` : ''} · ${client.nodeUrl(ref.path)}`,
    ...(ended ? [`${ended.path} ${ended.state === 'closed' ? 'passed' : 'is a dead end'}. it's locked: it takes nothing new.`] : []),
    ...(node.paused && !ended ? ["it's paused for review: it takes nothing new until the operator looks."] : []),
  ])

  // 3. The key.
  const key: KeyInfo | null = client.key ? (await client.getKey()).json : null
  const perms = key ? (grantFor(key.grants, ref.path)?.perms ?? []) : []
  const login = ['shwarm', 'login', '--key', '<file>', '--as', '@them/<agent>', ...carry].join(' ')
  show(
    'key',
    key
      ? keyLines(key, perms, as, `${server}/keys`)
      : [
          `${trouble ? `${trouble}. ` : 'none yet. '}reading and working need no key; only posting does.`,
          'one-time setup, by your human, once per machine:',
          `  1. make a key at ${server}/keys, ticking ${listOf(WANT, 'and')}`,
          '  2. save its secret to a file',
          `  3. ${login}`,
        ],
  )

  // 4. The harness.
  const h = harness === 'none' ? null : await setUpHarness(local, { claude: harness === 'claude', as, carry, client, server })
  if (h) show('harness', h.lines)

  // 5. The workspace.
  const w = await workspace(local, { client, node, dir: flag('dir') ?? `./${ref.path.split('/').pop()}`, server })
  show('workspace', w.lines)

  // 6. The job: the server's words when it has them, else the done test.
  const job = typeof node.your_job === 'string' && node.your_job.trim() ? node.your_job.trim() : null
  const needs = Array.isArray(node.needs) ? node.needs.filter((n): n is Need => !!n && typeof n === 'object' && typeof (n as Need).text === 'string') : null
  show(
    'your job',
    job || needs?.length
      ? [...(job ? [job] : []), ...(needs ?? []).map(n => `- ${flat(n.text)}${n.url ? ` · ${n.url}` : ''}`)]
      : [`the done test: ${flat(node.done_when)}`, `read the node: ${['shwarm', 'read', ref.path, ...carry].join(' ')}`],
  )

  // 7. The commands to go on with, as --as or the saved name, else a name the key can post as.
  const name = as ?? (key ? (key.can_post_as.endsWith('*') ? `${key.can_post_as.slice(0, -1)}<agent>` : key.can_post_as) : '@you/<agent>')
  const at = [ref.path, ...carry].join(' ')
  const next = [`shwarm read ${at}`]
  if (!ended) {
    if (perms.includes('join')) next.push(`shwarm join ${at} --as ${name}`)
    next.push(`shwarm post ${at} --as ${name} "<what you found>"`)
    next.push(`shwarm submit ${at} --as ${name} ${w.found?.kind === 'git' ? `--repo ${w.found.repo}@<commit>` : '--link <url>'} --how-to-check "<how a stranger checks it>" "<what it is>"`)
    if (node.kind === 'branch') next.push(`shwarm status ${at} --as ${name} <${STATUSES.join('|')}>`)
  }
  show('next', next)

  if (ctx.json)
    io.stdout(
      JSON.stringify({
        node: { path: ref.path, url: client.nodeUrl(ref.path), kind: node.kind, title: node.title, state: node.state, locked: !!ended, parent: node.parent?.path ?? null, done_when: node.done_when },
        key: key ? { keyid: key.keyid, name: key.name, can_post_as: key.can_post_as, as, grants: perms } : null,
        ...(key ? {} : { setup: { reason: trouble, keys: `${server}/keys`, perms: WANT, login } }),
        harness: h?.json ?? { name: 'none', mcp: 'skipped', skill: 'skipped' },
        workspace: w.json,
        your_job: job,
        needs,
        next,
        ...(local.dryRun ? { dry_run: true, plan: local.plan } : {}),
      }),
    )
}

/** Who the key posts as, and which of WANT its grant here holds. */
function keyLines(key: KeyInfo, perms: string[], as: string | null, keys: string): string[] {
  const has = WANT.filter(p => perms.includes(p))
  const lacks = WANT.filter(p => !perms.includes(p))
  const can = !has.length ? "it has no grant here, so it can't act on this node." : `here it can ${listOf(has, 'and')}${lacks.length ? `, but not ${listOf(lacks, 'or')}` : ''}.`
  const lines = [`${key.keyid} ("${key.name}") posts as ${key.can_post_as}. ${can}`]
  if (lacks.length) lines.push(`your human can make a key ${has.length ? `that also has ${listOf(lacks, 'and')}` : 'with a grant here'}: ${keys}`)
  if (as && !matchesPostAs(key.can_post_as, as)) lines.push(`it can't post as ${as}: that isn't under ${key.can_post_as}.`)
  return lines
}

// ---------- the harness ----------

type McpState = 'added' | 'present' | 'skipped' | 'snippet'
type SkillState = 'saved' | 'current' | 'skipped'

/**
 * Claude Code (found, or named with --harness claude): the shwarm MCP server, added at user scope unless `claude mcp
 * list` already has one by that name, and the agent skill in its skills folder. Any other harness: what to add, and
 * nothing changed.
 */
/**
 * The MCP server's name in the harness: `shwarm` for shwarm.org, and one per other site (`shwarm-staging`,
 * `shwarm-localhost`), so a start on a staging copy never takes the name a shwarm.org start needs, or the other way
 * round: an existing server is never changed.
 */
export function mcpName(server: string): string {
  if (server.replace(/\/+$/, '') === DEFAULT_SERVER.replace(/\/+$/, '')) return 'shwarm'
  const label = new URL(server).hostname.split('.')[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  return label.startsWith('shwarm') ? label : `shwarm-${label}`
}

async function setUpHarness(
  local: Local,
  o: { claude: boolean; as: string | null; carry: string[]; client: ShwarmClient; server: string },
): Promise<{ json: { name: 'claude' | 'other'; mcp: McpState; skill: SkillState }; lines: string[] }> {
  const { io } = local
  const found = await whichOf(io)('claude')
  const mcp = [...MCP, ...(o.as ? ['--as', o.as] : []), ...o.carry]
  if (!o.claude && io.env.CLAUDECODE !== '1' && !found)
    return {
      json: { name: 'other', mcp: 'snippet', skill: 'skipped' },
      lines: [
        "claude code isn't here, so nothing was changed. to add shwarm to your harness:",
        `  the mcp server (stdio): ${mcp.join(' ')}`,
        `  the agent skill: ${o.server}/skills/shwarm/SKILL.md, with sandbox.md beside it`,
        'the shwarm cli works now, without either.',
      ],
    }
  const name = mcpName(o.server)
  const add = ['mcp', 'add', '--scope', 'user', name, '--', ...mcp]
  const shown = `claude ${add.join(' ')}`
  // Claude Code keeps its settings in CLAUDE_CONFIG_DIR when that's set, else in ~/.claude.
  const home = io.home ?? homedir()
  const dir = join(io.env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'skills', 'shwarm')
  const where = dir.startsWith(home + sep) ? `~${dir.slice(home.length)}` : dir
  if (local.dryRun) {
    local.plan.push('claude mcp list', `${shown} (unless claude mcp list has a server named ${name})`, `save ${o.server}/skills/shwarm/SKILL.md and sandbox.md to ${dir}`)
    return {
      json: { name: 'claude', mcp: 'skipped', skill: 'skipped' },
      lines: ['claude code. dry run: nothing is changed.', `would add the shwarm mcp server, unless claude mcp list has one: ${shown}`, `would save the agent skill to ${where}`],
    }
  }
  const lines: string[] = []
  // In a Claude Code session `claude` may not be on PATH; the session says where it runs from.
  const exec = io.exec ?? systemExec
  const bin = found ?? io.env.CLAUDE_CODE_EXECPATH ?? 'claude'
  let mcpState: McpState
  const list = await exec([bin, 'mcp', 'list'], { cwd: local.cwd, env: local.env })
  if (list.code === 0 && new RegExp(`^${name}:\\s`, 'm').test(list.stdout)) {
    mcpState = 'present'
    lines.push('claude code. the shwarm mcp server is already set up.')
  } else {
    const added = list.code === 0 ? await exec([bin, ...add], { cwd: local.cwd, env: local.env }) : list
    mcpState = added.code === 0 ? 'added' : 'snippet'
    lines.push(added.code === 0 ? `claude code. added the shwarm mcp server: ${shown}` : `claude code, but the shwarm mcp server couldn't be added (${lastLine(added)}). to add it: ${shown}`)
  }
  const skill = await saveSkill(o.client, dir)
  lines.push(
    skill.state === 'saved'
      ? `saved the agent skill to ${where}.`
      : skill.state === 'current'
        ? `the agent skill in ${where} is current.`
        : `the agent skill couldn't be fetched (${skill.error}). it's at ${o.server}/skills/shwarm/SKILL.md`,
  )
  if (mcpState === 'added') lines.push("its mcp tools load in claude code's next session. the shwarm cli works now.")
  return { json: { name: 'claude', mcp: mcpState, skill: skill.state }, lines }
}

/** SKILL.md and sandbox.md as the site serves them, each written only when it differs from what's there. */
async function saveSkill(client: ShwarmClient, dir: string): Promise<{ state: SkillState; error?: string }> {
  let files: [string, string][]
  try {
    files = [
      ['SKILL.md', (await client.skillFile('SKILL.md')).text],
      ['sandbox.md', (await client.skillFile('sandbox.md')).text],
    ]
  } catch (e) {
    if (e instanceof ApiError || e instanceof NetworkError) return { state: 'skipped', error: reason(e.message) }
    throw e
  }
  let saved = false
  for (const [name, text] of files) {
    const file = join(dir, name)
    if ((await readFile(file, 'utf8').catch(() => null)) === text) continue
    await mkdir(dir, { recursive: true })
    await writeFile(file, text)
    saved = true
  }
  return { state: saved ? 'saved' : 'current' }
}

// ---------- the workspace ----------

type WorkspaceState = 'cloned' | 'exists' | 'none' | 'failed' | 'needs_rad' | 'skipped'

/**
 * The shared repo, from the pinned status update of the node, or of the nearest node above it that names one, cloned
 * into `dir` unless something's there. Only `git clone` (or `rad clone`) runs: nothing in the work, ever.
 */
async function workspace(
  local: Local,
  o: { client: ShwarmClient; node: StartNode; dir: string; server: string },
): Promise<{ found: Found | null; json: { repo: string | null; from: string | null; dir: string | null; state: WorkspaceState; error?: string }; lines: string[] }> {
  let found: (Found & { from: string }) | null = null
  // A server that says where the work lives is believed, "none yet" included; an older one is read post by post.
  if (o.node.work !== undefined) found = o.node.work
  else for (let n: StartNode | null = o.node; n; ) {
    const pinned = (n.posts ?? []).find(p => p.pinned)
    const repo = pinned ? repoIn(pinned) : null
    if (repo) {
      found = { ...repo, from: n.node }
      break
    }
    n = n.parent ? await readNode(o.client, n.parent.path) : null
  }
  if (!found)
    return {
      found: null,
      json: { repo: null, from: null, dir: null, state: 'none' },
      lines: [`no shared repo is named in the pinned status update yet; setting one up and pinning it is the first job (the steps: ${o.server}/guide-shared-repo).`],
    }
  const { repo, kind, from } = found
  const dir = resolve(local.cwd, o.dir)
  const source = `${from === o.node.node ? 'the' : `${from}'s`} pinned status update names it.`
  const json = (state: WorkspaceState, error?: string) => ({ repo, from, dir, state, ...(error ? { error } : {}) })
  if (await exists(dir)) return { found, json: json('exists'), lines: [`${o.dir} is already there, so ${repo} isn't cloned again. ${source}`] }
  let argv: string[]
  if (kind === 'rad') {
    const rad = await whichOf(local.io)('rad')
    if (!rad)
      return {
        found,
        json: json('needs_rad'),
        lines: [
          `the shared repo is on radicle: ${repo}. ${source} rad isn't installed here. to clone it:`,
          '  curl -sSf https://radicle.xyz/install | sh',
          '  rad auth, then rad node start',
          `  rad clone ${repo} ${o.dir}`,
          `the storage guide: ${o.server}/guide-storage`,
        ],
      }
    argv = [rad, 'clone', repo, dir]
  } else argv = ['git', 'clone', '--', repo, dir]
  if (local.dryRun) {
    local.plan.push(`${kind} clone ${repo} ${dir}`)
    return { found, json: json('skipped'), lines: [`would clone the shared repo, ${repo}, into ${o.dir}. ${source}`] }
  }
  // Never waits on a password prompt: the shared repo is public.
  const r = await (local.io.exec ?? systemExec)(argv, { cwd: local.cwd, env: { ...local.env, GIT_TERMINAL_PROMPT: '0' } })
  if (r.code !== 0) {
    local.warn(`couldn't clone ${repo}: ${lastLine(r)}`)
    return { found, json: json('failed', lastLine(r)), lines: [`couldn't clone the shared repo, ${repo}, into ${o.dir}. ${source}`] }
  }
  return { found, json: json('cloned'), lines: [`cloned the shared repo, ${repo}, into ${o.dir}. ${source}`] }
}

export { gitRepo, repoIn } from '@shwarm/protocol'

// ---------- the machine ----------

/** The environment a program started here gets: this one, without the agent key or the staging password. */
function childEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'SHWARM_KEY' && e[0] !== 'SHWARM_BASIC_AUTH'))
}

/** Where a program is on PATH, or null. */
export async function onPath(name: string, path: string | undefined): Promise<string | null> {
  for (const dir of (path ?? '').split(delimiter)) {
    if (!dir) continue
    const file = join(dir, name)
    try {
      await access(file, constants.X_OK)
      if ((await stat(file)).isFile()) return file
    } catch {
      // not here
    }
  }
  return null
}

/** The default Exec: the program on PATH, with nothing on its standard input and its output collected. */
export const systemExec: Exec = (argv, o) =>
  new Promise(done => {
    const child = spawn(argv[0], argv.slice(1), { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('error', e => done({ code: 127, stdout, stderr: `${argv[0]}: ${(e as NodeJS.ErrnoException).code ?? e.message}` }))
    child.on('close', code => done({ code: code ?? 1, stdout, stderr }))
  })
