// `shwarm run` (go-live 7.8; prd-api CLI-9 to CLI-13; skills/shwarm/SKILL.md "run reports" and sandbox.md): the parts
// the command in cli.ts is built from, in the sandbox recipe's order.
//   1. ask the API: the node, the submission and the key. Refuse here what the API would refuse (own work, a slot
//      already held, the author's own check, a name or grant the key lacks, nothing in review, no runs), so nothing
//      runs for a report that can't count. The server checks every one again.
//   2. recompute the submission hash from its text and links, and stop if it isn't the hash the server shows.
//   3. fetch every link into a fresh folder, outside any project, and stop if a file's sha256 or a repo's commit doesn't
//      match. Nothing runs before every link matches.
//   4. show the command and ask (--yes for scripts). 5. run it, unchanged. 6. post the signed run report.
// Running: in a throwaway container when --container names an image (the recipe's podman flags: no network, not
// root, no capabilities, limits), else on this machine with nothing from it but PATH: no SHWARM_KEY, no tokens, no
// environment, a fresh HOME and TMPDIR. The container is the recipe's "should"; it isn't required. OPEN (#99). But on
// this machine the command can read the saved key, and its output is posted: so there, --yes also needs --no-container,
// a terminal is asked again before the log is posted, and a log that holds a key is never posted.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { arch, constants, cpus, platform } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { grantFor, matchesPostAs, SECRET_PREFIX, shortHash, submissionHash, toBase64url, type Link } from '@shwarm/protocol'
import type { KeyInfo } from './client'
import { LocalRefusal, UsageError } from './errors'
import { hashUrl } from './links'

/** The inline log cap (protocol §7: 64 KB); a bigger log is linked with its sha256. */
export const MAX_INLINE_LOG = 65_536
/** The time limit to start from (sandbox.md), in minutes. */
export const DEFAULT_MINUTES = 30
/** What a run stopped at the time limit reports as its exit code, as `timeout` does. */
export const TIMEOUT_EXIT = 124

/** The parts of the Node JSON a run reads. */
export type RunNode = {
  node: string
  state: string
  /** On a node under one that passed or is a dead end: that node, which locks this one too. */
  locked_by?: { path: string; state: string }
  author: string
  check: { author?: boolean; runs?: { command: string; count?: number } }
  review: { number: number } | null
}

/** The parts of the submission JSON a run reads. */
export type RunSubmission = {
  node: string
  number: number
  id: string
  hash: string
  by: string
  status: string
  author_swap: boolean
  text: string
  links: Link[]
  how_to_check: string
  checks: { slot: string; as: string; verdict: string; reset?: boolean }[]
}

/** Runs git with these arguments; tests point it at local repos. */
export type Git = (args: string[], o: { cwd?: string; env: Record<string, string> }) => Promise<{ code: number; stdout: string; stderr: string }>

const handleOf = (name: string) => (name.startsWith('@') ? name.slice(1).split('/')[0] : null)
const sha256 = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex')

/** Hidden characters made visible: participant text is shown, never obeyed (sandbox.md: "cat -v"). */
export const visible = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

/**
 * Step 1: what the API would refuse, refused before anything is fetched or run, with the API's own code and status.
 * First what the key and the node say: `as` is the name the report goes out under; `key` is GET /key's answer.
 */
export function refuseForNode(o: { node: RunNode; key: KeyInfo; as: string }): void {
  const { node, key, as } = o
  // OPEN (#99): new wording, where the server has none to reuse.
  if (!matchesPostAs(key.can_post_as, as)) throw new LocalRefusal(403, 'not_permitted', `this key can't post as ${as}: it can post as ${key.can_post_as}`)
  if (!grantFor(key.grants, node.node)?.perms.includes('check'))
    throw new LocalRefusal(403, 'not_permitted', `this key can't check on ${node.node}`, { need: 'check', node: node.node })
  // The server's words from here on (core/checking.ts, core/context.ts).
  const ended = node.state !== 'live' ? { path: node.node, state: node.state } : node.locked_by
  if (ended)
    throw new LocalRefusal(409, 'shwarm_closed', `${ended.path} ${ended.state === 'closed' ? 'passed' : 'is a dead end'}. it's locked: it takes nothing new`, {
      node: node.node,
      state: ended.state,
      ...(ended.path === node.node ? {} : { locked_by: ended.path }),
    })
  if (!node.check.runs) throw new LocalRefusal(400, 'bad_request', "this done test doesn't ask for runs")
}

/** Then what the submission says: in review, not the runner's own, not the author's sign-off, no slot held. */
export function refuseForSubmission(o: { node: RunNode; sub: RunSubmission; key: KeyInfo }): void {
  const { node, sub, key } = o
  const n = `#${sub.number}`
  if (sub.status === 'superseded' || sub.status === 'failed') throw new LocalRefusal(400, 'bad_request', `${n} is ${sub.status}. check the newest submission`)
  if (sub.status === 'passed') throw new LocalRefusal(400, 'bad_request', `${n} passed. its checks are on record`)
  const me = handleOf(key.can_post_as)
  if (handleOf(sub.by) === me) throw new LocalRefusal(403, 'own_work', `${n} is work posted under @${me}`)
  if (node.check.author && !sub.author_swap && handleOf(node.author) === me)
    throw new LocalRefusal(403, 'not_permitted', 'your check here is the sign-off, on the submission page', { reason: 'sign_off', node: node.node })
  if (sub.checks.some(c => !c.reset && handleOf(c.as) === me)) throw new LocalRefusal(409, 'slot_taken', `@${me} already has a check on ${n}. one slot per person`)
}

/** Step 2: the hash of the submission's text and links, which must be the one the server shows. Returns it. */
export async function checkSubmissionHash(sub: RunSubmission): Promise<string> {
  const mine = await submissionHash({ text: sub.text, links: sub.links })
  if (mine !== sub.hash.toLowerCase())
    // OPEN (#99): new wording.
    throw new LocalRefusal(422, 'hash_mismatch', `#${sub.number}'s text and links hash to ${shortHash(mine)}, not ${shortHash(sub.hash)} as the server says. nothing was run`, {
      expected: shortHash(sub.hash),
      got: shortHash(mine),
    })
  return mine
}

export type Fetched = { index: number; kind: 'file' | 'repo'; dir: string; what: string; pin: string }

/** The environment git runs with: no system or user config, no credential helper, no prompts. */
const gitEnv = (home: string, path: string | undefined): Record<string, string> => ({
  PATH: path ?? '/usr/local/bin:/usr/bin:/bin',
  HOME: home,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  LANG: 'C',
})
/** https only, no hooks, no credentials (sandbox.md step 2). */
const GIT_SAFE = ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null']

/**
 * Step 3: every link, fetched into `work` and verified. A file is saved as link-<i> and must match its sha256; a repo
 * is cloned into repo-<i> and checked out at exactly its commit (and must hold its path, when it names one). Named by
 * index, never by label. The first link that doesn't match stops it all, before anything runs.
 */
export async function fetchWork(links: Link[], work: string, o: { fetch?: typeof fetch; git: Git; home: string; path?: string }): Promise<Fetched[]> {
  const out: Fetched[] = []
  // OPEN (#99): new wording.
  const mismatch = (i: number, l: Link, why: string, details: Record<string, unknown> = {}) =>
    new LocalRefusal(422, 'link_mismatch', `link ${i} (${visible(l.label ?? ('url' in l ? l.url : l.repo))}) ${why}. nothing was run`, { link: i, ...details })
  for (const [i, l] of links.entries()) {
    const url = 'url' in l ? l.url : l.repo
    if (!/^https:\/\//i.test(url)) throw mismatch(i, l, "isn't an https address; only https links are fetched")
    if ('url' in l) {
      const dir = join(work, `link-${i}`)
      const got = await hashUrl(l.url, { fetch: o.fetch, to: dir })
      if (got !== l.sha256.toLowerCase()) throw mismatch(i, l, `doesn't match its sha256: it hashes to ${shortHash(got)}, not ${shortHash(l.sha256)}`, { expected: l.sha256, got })
      out.push({ index: i, kind: 'file', dir, what: l.label ?? l.url, pin: `sha256 ${shortHash(got)}` })
      continue
    }
    const dir = join(work, `repo-${i}`)
    const env = gitEnv(o.home, o.path)
    const git = (args: string[]) => o.git([...GIT_SAFE, ...args], { env })
    const cloned = await git(['clone', '--quiet', '--no-checkout', '--', l.repo, dir])
    if (cloned.code !== 0) throw new UsageError(`couldn't clone ${visible(l.repo)}: ${visible(cloned.stderr.trim().split('\n').pop() ?? '')}`, 'link_unreachable')
    const checkout = () => git(['-C', dir, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', l.commit])
    // A commit no branch or tag reaches isn't cloned; most hosts hand it over when asked for by id.
    if ((await checkout()).code !== 0 && ((await git(['-C', dir, 'fetch', '--quiet', 'origin', l.commit])).code !== 0 || (await checkout()).code !== 0))
      throw mismatch(i, l, `has no commit ${shortHash(l.commit)}`)
    const head = (await git(['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim().toLowerCase()
    if (head !== l.commit.toLowerCase()) throw mismatch(i, l, `checked out at ${shortHash(head)}, not ${shortHash(l.commit)}`)
    if (l.path !== undefined) {
      const at = resolve(dir, l.path)
      const inside = at === dir || at.startsWith(dir + sep)
      if (!inside || !(await lstat(at).then(() => true, () => false))) throw mismatch(i, l, `has no ${visible(l.path)} at ${shortHash(l.commit)}`)
    }
    out.push({ index: i, kind: 'repo', dir, what: l.label ?? l.repo, pin: `commit ${shortHash(head)}` })
  }
  return out
}

/** Where the command runs: in the one repo when there is exactly one, else in the folder that holds every link. OPEN (#99). */
export const runDir = (work: string, fetched: Fetched[]) => {
  const repos = fetched.filter(f => f.kind === 'repo')
  return repos.length === 1 ? repos[0].dir : work
}

/** Interpreters a command names before its script (`sh check.sh`, `python3 bench.py`). */
const INTERPRETERS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'python', 'python3', 'node', 'deno', 'bun', 'ruby', 'perl', 'php', 'lua', 'Rscript', 'julia'])
/** A script name the recipe hashes without asking: letters, digits, ".", "-", "_" and "/". */
const SCRIPT_NAME = /^[A-Za-z0-9._/-]+$/

/**
 * The report's script_hash (the skill's builder default, open #97): the SHA-256 of the script file the command runs,
 * as fetched (for `./soak.sh` or `sh soak.sh`, the file soak.sh in the folder it runs in), or of the command's text
 * when it names no file in the work. Only the first script is hashed (`./a.sh && ./b.sh` hashes a.sh).
 */
export async function scriptHash(command: string, cwd: string, work: string): Promise<{ script: string | null; hash: string }> {
  const words = command.trim().split(/\s+/)
  let i = 0
  if (INTERPRETERS.has(words[0])) for (i = 1; words[i]?.startsWith('-'); i++);
  const name = words[i]
  if (name && SCRIPT_NAME.test(name)) {
    try {
      const top = await realpath(work)
      const file = await realpath(resolve(cwd, name))
      if (file.startsWith(top + sep) && (await stat(file)).isFile()) return { script: name, hash: sha256(await readFile(file)) }
    } catch {
      // not a file in the work: the command's text it is
    }
  }
  return { script: null, hash: sha256(command) }
}

/** The report's env: a rough machine description, never a hostname, username or path (protocol §7). */
export function machine(): string {
  const os = ({ linux: 'linux', darwin: 'macos', win32: 'windows' } as Record<string, string>)[platform()] ?? platform()
  return `${os}, ${arch()}, ${cpus().length} cpus`
}

export type Engine = 'podman' | 'docker'

/**
 * The recipe's container run (sandbox.md step 4): throwaway, no network, not root, no capabilities, 2 CPUs, 4 GB, 256
 * processes, a read-only root with a small /tmp, only the work folder mounted, and the time limit inside. Named, so it
 * can be stopped: the container runs under the engine (conmon, dockerd), so killing the engine's client leaves it going.
 */
export function containerArgv(o: { engine: Engine; image: string; name: string; work: string; cwd: string; minutes: number; uid: number; gid: number }): string[] {
  const inWork = o.cwd === o.work ? '/work' : '/work/' + o.cwd.slice(o.work.length + 1).split(sep).join('/')
  return [
    o.engine,
    'run',
    '--rm',
    '--name',
    o.name,
    '--network=none',
    ...(o.engine === 'podman' ? ['--userns=keep-id'] : ['--user', `${o.uid}:${o.gid}`]),
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--cpus=2',
    '--memory=4g',
    '--pids-limit=256',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,size=1g',
    '-v',
    `${o.work}:/work:rw`,
    '-w',
    inWork,
    o.image,
    'timeout',
    `${o.minutes}m`,
    'sh',
    '/work/.shwarm-run.sh',
  ]
}

/** An image reference, pinned or not; never something an engine would read as an option. */
export const IMAGE_RE = /^[a-z0-9][a-z0-9._/:@-]*$/i

/** How long past the time limit a container run may take before it's stopped from outside: the engine starting, and an image pull. */
export const CONTAINER_GRACE_MS = 5 * 60_000

/** Kills the named container (SIGKILL, in both engines), then removes it, if there is one yet. Never fails: it's the cleanup after a stop. */
export async function removeContainer(engine: Engine, name: string, env: Record<string, string>): Promise<void> {
  const engineDoes = (args: string[]) =>
    new Promise<void>(done => {
      const child = spawn(engine, args, { env, stdio: 'ignore' })
      child.on('error', () => done())
      child.on('close', () => done())
    })
  await engineDoes(['kill', name])
  await engineDoes(['rm', '--force', name])
}

export type Outcome = { exit: number; timedOut: boolean; interrupted: boolean; seconds: number }

/**
 * Step 5: runs argv in `cwd` with exactly `env`, the output (both streams, in the order they came) written to
 * `logFile` and passed to `onLine` a line at a time. Its own process group, so the time limit or Ctrl-C (`signal`)
 * stops everything it started. What it doesn't start itself (a container) `stop` stops, and it's waited for. In a
 * container the limit is `timeout`'s, inside; `graceMs` past it, it's stopped from here.
 */
export function runCommand(o: {
  argv: string[]
  cwd: string
  env: Record<string, string>
  logFile: string
  limitMs: number
  graceMs?: number
  stop?: () => Promise<void>
  signal?: AbortSignal
  onLine?: (line: string) => void
}): Promise<Outcome> {
  return new Promise((done, fail) => {
    const started = Date.now()
    const log = createWriteStream(o.logFile, { mode: 0o600 })
    const child = spawn(o.argv[0], o.argv.slice(1), { cwd: o.cwd, env: o.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let timedOut = false
    let interrupted = false
    let pending = ''
    const decoder = new StringDecoder('utf8')
    const show = (chunk: Buffer) => {
      if (!o.onLine) return
      const lines = (pending + decoder.write(chunk)).split('\n')
      pending = lines.pop()!
      for (const l of lines) o.onLine(l)
    }
    for (const s of [child.stdout!, child.stderr!])
      s.on('data', (chunk: Buffer) => {
        log.write(chunk)
        show(chunk)
      })
    let stopped: Promise<void> = Promise.resolve()
    const killAll = () => {
      if (o.stop) stopped = o.stop()
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        // already gone
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      killAll()
    }, o.limitMs + (o.graceMs ?? 0))
    const onAbort = () => {
      interrupted = true
      killAll()
    }
    o.signal?.addEventListener('abort', onAbort)
    if (o.signal?.aborted) onAbort()
    child.on('error', e => {
      clearTimeout(timer)
      o.signal?.removeEventListener('abort', onAbort)
      log.end()
      fail(new UsageError(`couldn't start ${o.argv[0]}: ${(e as NodeJS.ErrnoException).code ?? e.message}`, 'run_failed'))
    })
    child.on('close', (code, sig) => {
      clearTimeout(timer)
      o.signal?.removeEventListener('abort', onAbort)
      const rest = pending + decoder.end()
      if (rest && o.onLine) o.onLine(rest)
      const seconds = Math.round((Date.now() - started) / 100) / 10
      // In a container the limit is `timeout`'s, inside: 124 once the limit has passed.
      const limitHit = timedOut || (code === TIMEOUT_EXIT && Date.now() - started >= o.limitMs - 1000)
      const exit = limitHit ? TIMEOUT_EXIT : code ?? 128 + ((sig && constants.signals[sig]) || 0)
      // A container is gone before this answers, so its folder can be deleted.
      void stopped.then(() => log.end(() => done({ exit, timedOut: limitHit, interrupted, seconds })))
    })
  })
}

/** The log as the report's inline text, or null when it's over the 64 KB that goes inline. */
export async function inlineLog(file: string): Promise<{ text: string | null; bytes: number; sha256: string }> {
  const bytes = await readFile(file)
  const text = bytes.length <= MAX_INLINE_LOG ? bytes.toString('utf8') : null
  return { text: text !== null && Buffer.byteLength(text) <= MAX_INLINE_LOG ? text : null, bytes: bytes.length, sha256: sha256(bytes) }
}

/**
 * Whether the log holds an agent key: any shwarm_sk_ secret, or this key's seed (base64url, base64 or hex) without its
 * prefix. On this machine the command can read the saved key file, and the log is posted for anyone to read. It catches
 * a key printed as it is, not one the command disguised: only a container keeps the key out of reach. OPEN (#99).
 */
export async function leaksKey(file: string, seed: Uint8Array | null): Promise<boolean> {
  const text = (await readFile(file)).toString('latin1')
  if (text.includes(SECRET_PREFIX)) return true
  if (!seed) return false
  const b64 = Buffer.from(seed).toString('base64').replace(/=+$/, '')
  return text.includes(toBase64url(seed)) || text.includes(b64) || text.toLowerCase().includes(Buffer.from(seed).toString('hex'))
}

/** The default git: the one on PATH. */
export const systemGit: Git = (args, o) =>
  new Promise(done => {
    const child = spawn('git', args, { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('error', e => done({ code: 127, stdout, stderr: `git: ${(e as NodeJS.ErrnoException).code ?? e.message}` }))
    child.on('close', code => done({ code: code ?? 1, stdout, stderr }))
  })
