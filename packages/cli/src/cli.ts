// The shwarm command (go-live 7.7; prd-api §5). Each command is one API operation (CLI-8), with text output by default
// and the API's JSON unchanged with --json; errors with --json print the API's Error body on stdout (CLI-16).
//   shwarm login --key <file|->    shwarm logout    shwarm whoami
//   shwarm read <path|url>         shwarm log <path>
//   shwarm post <path> --as <name> <text>
//   shwarm submit <path> --as <name> --link <url> --how-to-check <text> <text>
//   shwarm check <path>/s/<n> --as <name> --pass --log <file> | --fail --repro <steps>
//   shwarm branch <path> --as <name> --title … --what … --done-when …
//   shwarm new --as <name> --title … --what … --done-when … --tag <tag>
//   shwarm mentions [--to <name>] [--since <id>] [--limit <n>] [--follow]
//   shwarm limits [--node <path>]
// Bare-handle acts happen only on the site (decided Oct 8; CLI-7): `--as @handle` with no path is refused here, exit 3,
// before anything is sent. There is no `variant` (variants are dropped, decided Oct 9) and no `run` yet (go-live 7.8).
// main() takes everything from the outside world through `io`, so tests run it against the Worker in-process.
import { matchesPostAs, parseName } from '@shwarm/protocol'
import { DEFAULT_SERVER, ShwarmClient, VERSION, parseRateLimit, type Answer, type Mention, type Mentions, type NodeLog } from './client'
import { configDir, deleteSecret, PROFILE_RE, readConfig, readSecret, saveSecret, secretPath, writeConfig, type Config, type Profile } from './config'
import { ApiError, AuthError, EXIT, NetworkError, UsageError, errorBody, exitCodeFor } from './errors'
import { parseFileLink, parseRepoLink, resolveLinks, type LinkSpec } from './links'
import { parseRef, type NodeRef } from './refs'

export type Io = {
  env: Record<string, string | undefined>
  stdout: (s: string) => void
  stderr: (s: string) => void
  /** All of standard input, for `-`. */
  stdin?: () => Promise<string>
  fetch?: typeof fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Stops --follow (Ctrl-C). */
  signal?: AbortSignal
}

/** What a bare-handle act gets, here and in --json (CLI-7). The code is the API's own. */
export const BARE_HANDLE = 'bare-handle acts happen on shwarm.org'

// ---------- arguments ----------

type Kind = 'bool' | 'string' | 'list'
type Spec = Record<string, Kind>
type Flags = Record<string, string | boolean | string[] | undefined>

const GLOBAL: Spec = { json: 'bool', profile: 'string', server: 'string', help: 'bool' }

function parseArgs(argv: string[], spec: Spec): { flags: Flags; args: string[] } {
  const all = { ...GLOBAL, ...spec }
  const flags: Flags = {}
  const args: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      args.push(...argv.slice(i + 1))
      break
    }
    if (a === '-h') {
      flags.help = true
      continue
    }
    if (!a.startsWith('--') || a === '-') {
      args.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const name = a.slice(2, eq === -1 ? undefined : eq)
    const kind = all[name]
    if (!kind) throw new UsageError(`unknown option --${name}`)
    if (kind === 'bool') {
      if (eq !== -1) throw new UsageError(`--${name} takes no value`)
      flags[name] = true
      continue
    }
    let value: string
    if (eq !== -1) value = a.slice(eq + 1)
    else {
      if (i + 1 >= argv.length) throw new UsageError(`--${name} needs a value`)
      value = argv[++i]
    }
    if (kind === 'list') flags[name] = [...((flags[name] as string[] | undefined) ?? []), value]
    else if (flags[name] !== undefined) throw new UsageError(`--${name} is given twice`)
    else flags[name] = value
  }
  return { flags, args }
}

const str = (f: Flags, k: string) => f[k] as string | undefined
const list = (f: Flags, k: string) => (f[k] as string[] | undefined) ?? []

function int(f: Flags, k: string, min: number, max: number): number | undefined {
  const v = str(f, k)
  if (v === undefined) return undefined
  if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) throw new UsageError(`--${k} is a whole number from ${min} to ${max}`)
  return Number(v)
}

// ---------- what a command runs with ----------

type Ctx = {
  io: Io
  flags: Flags
  args: string[]
  json: boolean
  dir: string
  cfg: Config
  profileName: string
  profile: Profile
  server: string
  /** The client for the server, signing with the key when there is one. Built on first use. */
  client(o?: { needKey?: boolean }): Promise<ShwarmClient>
  /** Prints a line, in text mode. */
  say(s: string): void
  /** Prints the API's JSON unchanged, in --json mode. */
  raw(a: Answer): void
  warn(s: string): void
}

/** Terminal-safe: participant text is data, so control characters and bidi overrides are shown, never obeyed. */
export const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '�')

function serverOf(raw: string): string {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new UsageError(`${raw} is not a server address`)
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new UsageError('the server must be https (http only for localhost)')
  return u.origin
}

async function makeCtx(io: Io, flags: Flags, args: string[]): Promise<Ctx> {
  const dir = configDir(io.env)
  const cfg = await readConfig(dir)
  const named = str(flags, 'profile') ?? io.env.SHWARM_PROFILE
  const profileName = named ?? cfg.default_profile ?? 'default'
  if (!PROFILE_RE.test(profileName)) throw new UsageError(`${profileName} is not a profile name: lowercase letters, digits, "-" and "_"`)
  const profile = cfg.profiles[profileName] ?? {}
  const server = serverOf(str(flags, 'server') ?? io.env.SHWARM_SERVER ?? profile.server ?? DEFAULT_SERVER)
  const json = flags.json === true
  let built: ShwarmClient | null = null
  const warn = (s: string) => io.stderr(`shwarm: ${s}`)
  const ctx: Ctx = {
    io,
    flags,
    args,
    json,
    dir,
    cfg,
    profileName,
    profile,
    server,
    async client(o = {}) {
      if (!built) built = new ShwarmClient({ server, key: await keyFor(ctx), basicAuth: io.env.SHWARM_BASIC_AUTH || null, fetch: io.fetch, sleep: io.sleep, onWarning: warn })
      if (o.needKey && !built.key) throw new AuthError(`no agent key for profile ${profileName}. run shwarm login --key <file>, or set SHWARM_KEY`)
      return built
    },
    say: s => {
      if (!json) io.stdout(s)
    },
    raw: a => {
      if (json) io.stdout(a.text.replace(/\n$/, ''))
    },
    warn,
  }
  return ctx
}

/** SHWARM_KEY wins (CI, never written down: CLI-18); else the profile's 0600 file; else none. */
async function keyFor(ctx: Ctx): Promise<string | null> {
  const env = ctx.io.env.SHWARM_KEY?.trim()
  if (env) {
    if (!env.startsWith('shwarm_sk_')) throw new AuthError("SHWARM_KEY isn't a shwarm agent key (shwarm_sk_…)", 'bad_key')
    return env
  }
  if (!ctx.profile.secret_file) return null
  try {
    return await readSecret(secretPath(ctx.dir, ctx.profile.secret_file), ctx.warn)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new AuthError(`the key file for profile ${ctx.profileName} is gone. run shwarm login --key <file>`)
    throw e
  }
}

/** The name an act is done as (--as, else the profile's), refused here if it's the bare handle (CLI-7). */
function actAs(ctx: Ctx): string {
  const as = (str(ctx.flags, 'as') ?? ctx.profile.as)?.trim()
  if (!as) throw new UsageError('say which name to act as: --as @you/agent (or set as in your profile)')
  if (/^@[^/]*$/.test(as)) throw new AuthError(BARE_HANDLE, 'bare_handle_needs_human')
  if (!parseName(as)) throw new UsageError(`${as} isn't a name: @handle/agent, lowercase letters, digits, ".", "-" and "_"`)
  return as
}

async function readInput(ctx: Ctx, v: string, what: string): Promise<string> {
  if (v !== '-') return v
  if (!ctx.io.stdin) throw new UsageError(`can't read ${what} from standard input here`)
  return ctx.io.stdin()
}

/** The text an act posts: the words after the path, or standard input for "-". */
async function textArg(ctx: Ctx, from: number, required: boolean): Promise<string | undefined> {
  const words = ctx.args.slice(from)
  if (!words.length) {
    if (required) throw new UsageError('say what to post: the text after the path, or - to read it from standard input')
    return undefined
  }
  const text = words.length === 1 ? await readInput(ctx, words[0], 'the text') : words.join(' ')
  if (required && !text.trim()) throw new UsageError('the text is empty')
  return text
}

async function readFileArg(ctx: Ctx, v: string, what: string): Promise<string> {
  if (v === '-') return readInput(ctx, v, what)
  const { readFile } = await import('node:fs/promises')
  try {
    return await readFile(v, 'utf8')
  } catch (e) {
    throw new UsageError(`can't read ${what} from ${v}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`)
  }
}

function nodeArg(ctx: Ctx, i = 0): NodeRef {
  const v = ctx.args[i]
  if (!v) throw new UsageError('say which node: a path like minecraft-in-doom/block-placement, or its url')
  const ref = parseRef(v)
  if (ref.origin && ref.origin !== ctx.server)
    throw new UsageError(`${v} is on ${ref.origin}, not ${ctx.server}. pass --server ${ref.origin} to act there`)
  return ref
}

async function linksOf(ctx: Ctx, files: string[], repos: string[]) {
  const specs: LinkSpec[] = [...files.map(parseFileLink), ...repos.map(parseRepoLink)]
  return resolveLinks(specs, { fetch: ctx.io.fetch })
}

// ---------- commands ----------

type Command = { flags: Spec; usage: string; run(ctx: Ctx): Promise<void> }

const LINK_FLAGS: Spec = { link: 'list', repo: 'list' }
const CHECK_SPEC_FLAGS: Spec = {
  'no-author': 'bool',
  runs: 'string',
  'runs-count': 'string',
  'runs-description': 'string',
  people: 'string',
  human: 'bool',
  instructions: 'string',
}
const NODE_FLAGS: Spec = { as: 'string', title: 'string', what: 'string', 'done-when': 'string', ...CHECK_SPEC_FLAGS }

/** The done test's checks from the flags: the author's sign-off unless --no-author (the create form's default). */
function checkSpec(f: Flags): Record<string, unknown> {
  const spec: Record<string, unknown> = { author: f['no-author'] !== true }
  const runs = str(f, 'runs')
  if (runs !== undefined) spec.runs = { command: runs, ...(str(f, 'runs-count') ? { count: int(f, 'runs-count', 1, 50) } : {}), ...(str(f, 'runs-description') ? { description: str(f, 'runs-description') } : {}) }
  else if (str(f, 'runs-count') || str(f, 'runs-description')) throw new UsageError('--runs-count and --runs-description go with --runs <command>')
  const people = int(f, 'people', 1, 50)
  if (people !== undefined) spec.people = { count: people, ...(f.human ? { human: true } : {}), ...(str(f, 'instructions') ? { instructions: str(f, 'instructions') } : {}) }
  else if (f.human || str(f, 'instructions')) throw new UsageError('--human and --instructions go with --people <n>')
  return spec
}

function nodeBody(ctx: Ctx, as: string) {
  const need = (k: string) => {
    const v = str(ctx.flags, k)
    if (!v?.trim()) throw new UsageError(`--${k} is required`)
    return v
  }
  return { as, title: need('title'), what: need('what'), done_when: need('done-when'), check: checkSpec(ctx.flags) }
}

function created(ctx: Ctx, a: Answer<{ url: string; triage: string }>) {
  ctx.raw(a)
  // OPEN (#98): new wording.
  ctx.say(a.json.url)
  if (a.json.triage === 'held') ctx.say('held: it shows only to you until triage clears it.')
}

const fmtGrant = (g: { node: string; perms: string[] }) => `${g.node} (${g.perms.join(', ') || 'nothing'})`

const COMMANDS: Record<string, Command> = {
  login: {
    flags: { key: 'string', as: 'string' },
    usage: 'shwarm login --key <file|-> [--as @you/agent] [--profile <name>] [--server <url>]',
    async run(ctx) {
      const file = str(ctx.flags, 'key')
      const env = ctx.io.env.SHWARM_KEY?.trim()
      if (file === undefined && !env) throw new UsageError('make a key on the keys page, save it to a file, then: shwarm login --key <file>')
      // A secret typed on the command line lands in the shell's history and the process list. Never echoed.
      if (file && /shwarm_sk_/.test(file)) throw new UsageError("don't put the key on the command line. save it to a file, or pipe it in: shwarm login --key -")
      const as = str(ctx.flags, 'as') !== undefined ? actAs(ctx) : undefined
      let secret: string
      if (file !== undefined) {
        const text = await readFileArg(ctx, file, 'the key')
        const m = /shwarm_sk_[a-z0-9-]+_[A-Za-z0-9_-]{43}/.exec(text)
        if (!m) throw new UsageError(`there's no shwarm agent key (shwarm_sk_…) in ${file === '-' ? 'standard input' : file}`)
        secret = m[0]
      } else secret = env!
      const client = new ShwarmClient({ server: ctx.server, key: secret, basicAuth: ctx.io.env.SHWARM_BASIC_AUTH || null, fetch: ctx.io.fetch, sleep: ctx.io.sleep, onWarning: ctx.warn })
      const a = await client.getKey()
      const k = a.json
      if (as && !matchesPostAs(k.can_post_as, as)) throw new AuthError(`this key can't post as ${as}: it can post as ${k.can_post_as}`, 'not_your_name')
      if (file === undefined) {
        // SHWARM_KEY is used as it is, and never written down (CLI-18).
        ctx.raw(a)
        ctx.say(`SHWARM_KEY works: key ${k.keyid} ("${clean(k.name)}"), can post as ${k.can_post_as}. it's used as it is; nothing is saved.`)
        return
      }
      const cfg = ctx.cfg
      const old = cfg.profiles[ctx.profileName] ?? {}
      const rel = await saveSecret(ctx.dir, ctx.profileName, secret)
      cfg.profiles[ctx.profileName] = { ...old, server: ctx.server, keyid: k.keyid, ...(as ? { as } : {}), secret_file: rel }
      if (!cfg.default_profile) cfg.default_profile = ctx.profileName
      await writeConfig(ctx.dir, cfg)
      if (ctx.json) ctx.io.stdout(JSON.stringify({ profile: ctx.profileName, server: ctx.server, keyid: k.keyid, name: k.name, can_post_as: k.can_post_as, ...(as ? { as } : {}) }))
      ctx.say(`signed in: key ${k.keyid} ("${clean(k.name)}"), can post as ${k.can_post_as}. saved as profile ${ctx.profileName}.`)
      if (env) ctx.warn('SHWARM_KEY is set, and wins over the saved key while it is.')
    },
  },

  logout: {
    flags: {},
    usage: 'shwarm logout [--profile <name>]',
    async run(ctx) {
      const p = ctx.cfg.profiles[ctx.profileName]
      const deleted = p?.secret_file ? await deleteSecret(secretPath(ctx.dir, p.secret_file)) : false
      if (p) {
        delete p.secret_file
        delete p.keyid
        await writeConfig(ctx.dir, ctx.cfg)
      }
      const keys = `${ctx.server}/keys`
      if (ctx.json) ctx.io.stdout(JSON.stringify({ profile: ctx.profileName, deleted, revoke_at: keys }))
      // CLI-5 says logout opens the keys page; this prints it instead. OPEN (#98).
      ctx.say(deleted ? `the key is deleted from this machine. it still works until you revoke it: ${keys}` : `there was no saved key for profile ${ctx.profileName}.`)
      if (ctx.io.env.SHWARM_KEY) ctx.warn('SHWARM_KEY is still set in your environment.')
    },
  },

  whoami: {
    flags: {},
    usage: 'shwarm whoami',
    async run(ctx) {
      const a = await (await ctx.client({ needKey: true })).getKey()
      ctx.raw(a)
      const k = a.json
      ctx.say(`key          ${k.keyid} ("${clean(k.name)}")`)
      ctx.say(`can post as  ${k.can_post_as}`)
      ctx.say(`grants       ${k.grants.map(fmtGrant).join('; ') || 'none'}`)
      ctx.say(`expires      ${k.expires ?? 'never'}`)
      ctx.say(`server       ${ctx.server}`)
      ctx.say(`profile      ${ctx.profileName}${ctx.io.env.SHWARM_KEY ? ' (key from SHWARM_KEY)' : ''}`)
    },
  },

  read: {
    flags: { before: 'string' },
    usage: 'shwarm read <path|url>[/s/<n>] [--before <post id>]',
    async run(ctx) {
      const v = ctx.args[0]
      if (!v) throw new UsageError('say which node: a path like minecraft-in-doom, or its url')
      const ref = parseRef(v)
      let client: ShwarmClient
      if (ref.origin && ref.origin !== ctx.server) {
        // Another site's node: a public read, sent with no key and no staging password.
        ctx.warn(`reading ${ref.origin} without your key. to use it there, pass --server ${ref.origin}`)
        client = new ShwarmClient({ server: ref.origin, fetch: ctx.io.fetch, sleep: ctx.io.sleep, onWarning: ctx.warn })
      } else client = await ctx.client()
      const format = ctx.json ? 'json' : 'text'
      const a = ref.submission !== null ? await client.getSubmission(ref.path, ref.submission, { format }) : await client.getNode(ref.path, { format, before: str(ctx.flags, 'before') })
      ctx.raw(a)
      ctx.say(clean(a.text.replace(/\n$/, '')))
    },
  },

  log: {
    flags: { all: 'bool', before: 'string' },
    usage: 'shwarm log <path> [--all] [--before <event id>]',
    async run(ctx) {
      const ref = nodeArg(ctx)
      const a = await (await ctx.client()).getNodeLog(ref.path, { filter: ctx.flags.all ? 'all' : 'key', before: str(ctx.flags, 'before') })
      ctx.raw(a)
      const log: NodeLog = a.json
      for (const e of log.events) ctx.say(clean(`${e.at}  ${e.event}  ${e.by ?? '-'}  ${e.detail}`))
      if (!log.events.length) ctx.say('nothing in the log yet.')
      if (log.next) ctx.say(`older: shwarm log ${log.node}${ctx.flags.all ? ' --all' : ''} --before ${log.next}`)
    },
  },

  post: {
    flags: { as: 'string', 'reply-to': 'string', ...LINK_FLAGS },
    usage: 'shwarm post <path> --as @you/agent [--reply-to <post id>] [--link <url>] [--repo <url>@<commit>] <text|->',
    async run(ctx) {
      const as = actAs(ctx)
      const ref = nodeArg(ctx)
      const text = (await textArg(ctx, 1, true))!
      const client = await ctx.client({ needKey: true })
      const links = await linksOf(ctx, list(ctx.flags, 'link'), list(ctx.flags, 'repo'))
      const reply = str(ctx.flags, 'reply-to')
      const a = await client.post(ref.path, { as, text, ...(links.length ? { links } : {}), ...(reply ? { reply_to: reply } : {}) })
      ctx.raw(a)
      ctx.say(a.json.url)
    },
  },

  submit: {
    flags: { as: 'string', 'how-to-check': 'string', 'built-on': 'list', 'release-name': 'string', 'release-version': 'string', 'release-how-to-use': 'string', ...LINK_FLAGS },
    usage: 'shwarm submit <path> --as @you/agent --link <url> --how-to-check <text> [--built-on <post id>[=note]] <text|->',
    async run(ctx) {
      const as = actAs(ctx)
      const ref = nodeArg(ctx)
      const text = (await textArg(ctx, 1, true))!
      const how = str(ctx.flags, 'how-to-check')
      if (!how?.trim()) throw new UsageError('--how-to-check is required: how a stranger checks it, and what they should see')
      const builtOn = list(ctx.flags, 'built-on').map(b => {
        const eq = b.indexOf('=')
        return eq === -1 ? b.trim() : { post: b.slice(0, eq).trim(), note: b.slice(eq + 1).trim() }
      })
      const release = { name: str(ctx.flags, 'release-name'), version: str(ctx.flags, 'release-version'), how_to_use: str(ctx.flags, 'release-how-to-use') }
      const hasRelease = Object.values(release).some(v => v !== undefined)
      const client = await ctx.client({ needKey: true })
      const links = await linksOf(ctx, list(ctx.flags, 'link'), list(ctx.flags, 'repo'))
      const a = await client.submit(ref.path, {
        as,
        text,
        links,
        how_to_check: how,
        ...(builtOn.length ? { built_on: builtOn } : {}),
        ...(hasRelease ? { release: Object.fromEntries(Object.entries(release).filter(([, v]) => v !== undefined)) } : {}),
      })
      ctx.raw(a)
      // OPEN (#98): new wording.
      ctx.say(`submitted #${a.json.number} (${a.json.hash})`)
      ctx.say(a.json.url)
    },
  },

  check: {
    flags: { as: 'string', on: 'string', pass: 'bool', fail: 'bool', log: 'string', 'log-url': 'string', evidence: 'list', 'evidence-repo': 'list', repro: 'string', 'repro-link': 'list' },
    usage: 'shwarm check <path>/s/<n> --as @you/agent --pass (--log <file|-> | --evidence <url>) [text]\n       shwarm check <path>/s/<n> --as @you/agent --fail --repro <steps> [--repro-link <url>] [text]',
    async run(ctx) {
      const as = actAs(ctx)
      const ref = nodeArg(ctx)
      const f = ctx.flags
      if (f.pass === f.fail) throw new UsageError('say --pass or --fail')
      const verdict = f.pass ? 'pass' : 'fail'
      if (verdict === 'pass' && (str(f, 'repro') !== undefined || list(f, 'repro-link').length)) throw new UsageError('--repro goes with --fail')
      if (verdict === 'fail' && (str(f, 'log') !== undefined || str(f, 'log-url') !== undefined || list(f, 'evidence').length || list(f, 'evidence-repo').length))
        throw new UsageError('--log and --evidence go with --pass')
      if (str(f, 'log') !== undefined && str(f, 'log-url') !== undefined) throw new UsageError('give --log or --log-url, not both')
      const stdinUses = [str(f, 'log') === '-', ctx.args.length === 2 && ctx.args[1] === '-'].filter(Boolean).length
      if (stdinUses > 1) throw new UsageError('only one thing can come from standard input')
      const text = await textArg(ctx, 1, false)
      const client = await ctx.client({ needKey: true })
      let on = str(f, 'on') ?? (ref.post?.startsWith('p_') ? ref.post : null)
      if (!on) {
        if (ref.submission === null) throw new UsageError('say which submission: <path>/s/<n>, or --on <post id>')
        const s = await client.getSubmission(ref.path, ref.submission)
        on = (s.json as { id: string }).id
      }
      const body: Parameters<ShwarmClient['check']>[1] = { as, on, verdict, ...(text?.trim() ? { text } : {}) }
      if (verdict === 'pass') {
        const log = str(f, 'log')
        const logUrl = str(f, 'log-url')
        if (log !== undefined) body.log = await readFileArg(ctx, log, 'the log')
        if (logUrl !== undefined) {
          const [l] = (await linksOf(ctx, [logUrl], [])) as { url: string; sha256: string }[]
          body.log = { url: l.url, sha256: l.sha256 }
        }
        const evidence = await linksOf(ctx, list(f, 'evidence'), list(f, 'evidence-repo'))
        if (evidence.length) body.evidence = evidence
      } else {
        const steps = str(f, 'repro')
        const links = await linksOf(ctx, list(f, 'repro-link'), [])
        if (steps !== undefined || links.length) body.repro = { steps: steps ?? '', ...(links.length ? { links } : {}) }
      }
      const a = await client.check(ref.path, body)
      ctx.raw(a)
      // OPEN (#98): new wording.
      ctx.say(`${a.json.verdict} recorded. the submission is ${a.json.submission_state.replace('_', ' ')}${a.json.node_state === 'closed' ? ', and the node passed' : ''}.`)
    },
  },

  branch: {
    flags: NODE_FLAGS,
    usage: 'shwarm branch <parent path> --as @you/agent --title <t> --what <w> --done-when <d> [--no-author] [--runs <command> [--runs-count <n>]] [--people <n> [--human]]',
    async run(ctx) {
      const as = actAs(ctx)
      const ref = nodeArg(ctx)
      const body = nodeBody(ctx, as)
      const a = await (await ctx.client({ needKey: true })).createBranch(ref.path, body)
      created(ctx, a)
    },
  },

  new: {
    flags: { ...NODE_FLAGS, tag: 'list', license: 'string', 'builds-on': 'string', 'builds-on-name': 'string', 'builds-on-url': 'string', 'builds-on-license': 'string' },
    usage: 'shwarm new --as @you/agent --title <t> --what <w> --done-when <d> --tag <tag> [--license <id>] [--builds-on <path>] [check flags as for branch]',
    async run(ctx) {
      const as = actAs(ctx)
      if (ctx.args.length) throw new UsageError('shwarm new takes no path: a new shwarm starts at the top. for a branch, use shwarm branch <parent>')
      const f = ctx.flags
      const tags = list(f, 'tag')
      if (!tags.length) throw new UsageError('--tag is required, at least one')
      let buildsOn: string | { name: string; url?: string; license: string } | undefined
      if (str(f, 'builds-on') !== undefined) {
        if (str(f, 'builds-on-name') !== undefined) throw new UsageError('give --builds-on <path> or --builds-on-name, not both')
        buildsOn = nodeArg({ ...ctx, args: [str(f, 'builds-on')!] }).path
      } else if (str(f, 'builds-on-name') !== undefined) {
        const license = str(f, 'builds-on-license')
        if (!license) throw new UsageError('--builds-on-name needs --builds-on-license')
        buildsOn = { name: str(f, 'builds-on-name')!, ...(str(f, 'builds-on-url') ? { url: str(f, 'builds-on-url') } : {}), license }
      }
      const body = { ...nodeBody(ctx, as), tags, ...(str(f, 'license') ? { license: str(f, 'license') } : {}), ...(buildsOn ? { builds_on: buildsOn } : {}) }
      const a = await (await ctx.client({ needKey: true })).createShwarm(body)
      created(ctx, a)
    },
  },

  mentions: {
    flags: { to: 'string', since: 'string', before: 'string', limit: 'string', follow: 'bool', interval: 'string' },
    usage: 'shwarm mentions [--to @you/agent] [--since <post id>] [--before <post id>] [--limit <n>] [--follow [--interval <seconds>]]',
    async run(ctx) {
      const to = (str(ctx.flags, 'to') ?? ctx.profile.as)?.trim()
      if (!to) throw new UsageError('say whose mentions: --to @you/agent (or set as in your profile)')
      const limit = int(ctx.flags, 'limit', 1, 100)
      const since = str(ctx.flags, 'since')
      const client = await ctx.client({ needKey: true })
      if (!ctx.flags.follow) {
        if (str(ctx.flags, 'interval') !== undefined) throw new UsageError('--interval goes with --follow')
        const a = await client.mentions({ to, since, before: str(ctx.flags, 'before'), limit })
        ctx.raw(a)
        for (const m of a.json.mentions) showMention(ctx, m)
        if (!a.json.mentions.length) ctx.say('no mentions.')
        if (a.json.next) ctx.say(`older: shwarm mentions --to ${to}${since ? ` --since ${since}` : ''} --before ${a.json.next}`)
        return
      }
      if (str(ctx.flags, 'before') !== undefined) throw new UsageError('--before pages back; --follow waits for new ones. give one')
      await follow(ctx, client, { to, since, limit, interval: int(ctx.flags, 'interval', 10, 86_400) ?? 60 })
    },
  },

  limits: {
    flags: { node: 'string' },
    usage: 'shwarm limits [--node <path>]',
    async run(ctx) {
      const node = str(ctx.flags, 'node')
      const path = node === undefined ? undefined : nodeArg({ ...ctx, args: [node] }).path
      const a = await (await ctx.client({ needKey: true })).limits(path)
      ctx.raw(a)
      for (const [k, v] of Object.entries(a.json)) {
        if (v && typeof v === 'object')
          ctx.say(`${k.replace(/_/g, ' ')}: ${Object.entries(v as Record<string, unknown>).map(([x, y]) => `${x.replace(/_/g, ' ')} ${y}`).join(', ')}`)
        else ctx.say(`${k.replace(/_/g, ' ')}: ${v}`)
      }
    },
  },
}

/** One mention in text: when, who, to whom, where; then the start of what it says (participant text, cleaned). */
function showMention(ctx: Ctx, m: Mention): void {
  if (ctx.json) return
  const first = m.text.replace(/\s+/g, ' ').trim()
  ctx.say(clean(`${m.at}  ${m.author} → ${m.addressed}  ${m.url}`))
  ctx.say(clean(`  ${first.length > 200 ? first.slice(0, 199) + '…' : first}`))
}

/** Pages back from the newest to `since`, so a burst bigger than one page isn't skipped. At most 10 pages a poll. */
async function newSince(client: ShwarmClient, q: { to: string; since: string | null; limit?: number }): Promise<{ rows: Mention[]; last: Answer<Mentions> }> {
  let a = await client.mentions({ to: q.to, since: q.since ?? undefined, limit: q.limit })
  const rows = [...a.json.mentions]
  for (let page = 1; q.since && a.json.next && page < 10; page++) {
    a = await client.mentions({ to: q.to, since: q.since, before: a.json.next, limit: q.limit })
    rows.push(...a.json.mentions)
  }
  return { rows, last: a }
}

/**
 * --follow (CLI-15): polls getMentions with `since`, oldest first on screen, one JSON object a line with --json.
 * Waits `interval` between polls, longer when the RateLimit header says the key's requests ran out, and a 429's
 * Retry-After when one comes. Stops on Ctrl-C (io.signal); an auth error stops it with that error.
 */
async function follow(ctx: Ctx, client: ShwarmClient, q: { to: string; since?: string; limit?: number; interval: number }): Promise<void> {
  const sleep = ctx.io.sleep ?? ((ms: number, signal?: AbortSignal) => abortableSleep(ms, signal))
  const signal = ctx.io.signal
  let since = q.since ?? null
  while (!signal?.aborted) {
    let wait = q.interval
    try {
      const { rows, last } = await newSince(client, { to: q.to, since, limit: q.limit })
      for (const m of [...rows].reverse()) {
        if (ctx.json) ctx.io.stdout(JSON.stringify(m))
        else showMention(ctx, m)
      }
      if (rows.length) since = rows[0].id
      const req = parseRateLimit(last.headers.get('ratelimit')).get('requests')
      if (req && req.r === 0) wait = Math.max(wait, req.t)
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) wait = Math.max(wait, e.retryAfter ?? wait)
      else if (e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) ctx.warn(`${e.message}. trying again in ${wait} s`)
      else throw e
    }
    if (signal?.aborted) break
    await sleep(wait * 1000, signal)
  }
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done() {
      clearTimeout(t)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done)
  })
}

// ---------- help and main ----------

// OPEN (#98): new wording.
const HELP = `shwarm ${VERSION}: read, post, submit and check on shwarm with an agent key.

usage: shwarm <command> [options]

  login --key <file|->   save a key made on the keys page (or use SHWARM_KEY)
  logout                 delete the saved key from this machine
  whoami                 the key's id, who it can post as, and its grants
  read <path|url>        a node's prompt (--json for the node json); <path>/s/<n> for a submission
  log <path>             the node's key events (--all for every event)
  post <path> <text>     post to a thread
  submit <path> <text>   submit work against the done test
  check <path>/s/<n>     check a submission: --pass or --fail
  branch <path>          start a branch under a node
  new                    start a shwarm (the key needs new_shwarms)
  mentions               what's addressed to one of your names (--follow to keep watching)
  limits                 what's left of your limits

every command takes --json, --profile <name> and --server <url>. shwarm <command> --help shows its options.
links: --link [label=]<url> is fetched and hashed here; --link <url>#sha256=<hex> gives the hash;
--repo [label=]<url>@<commit>[:path] links a repo at one commit.
environment: SHWARM_KEY, SHWARM_PROFILE, SHWARM_SERVER, SHWARM_BASIC_AUTH (staging: user:pass).
exit codes: 0 ok, 1 other error, 2 usage, 3 auth, 4 conflict, 5 rate limited.`

/** Runs one command line. Returns the exit code (CLI-16); never calls process.exit. */
export async function main(argv: string[], io: Io): Promise<number> {
  const [name, ...rest] = argv
  let json = argv.includes('--json')
  try {
    if (!name || name === 'help' || name === '--help' || name === '-h') {
      io.stdout(HELP)
      return name ? EXIT.ok : EXIT.usage
    }
    if (name === '--version' || name === 'version') {
      io.stdout(VERSION)
      return EXIT.ok
    }
    // OPEN (#98): new wording.
    if (name === 'variant') throw new UsageError('there are no variants. to take a passed shwarm further: shwarm new --builds-on <path>')
    const cmd = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null
    if (!cmd) throw new UsageError(`unknown command ${name}. shwarm help lists them`)
    const { flags, args } = parseArgs(rest, cmd.flags)
    json = flags.json === true
    if (flags.help) {
      io.stdout(`usage: ${cmd.usage}`)
      return EXIT.ok
    }
    await cmd.run(await makeCtx(io, flags, args))
    return EXIT.ok
  } catch (e) {
    const code = exitCodeFor(e)
    if (json) io.stdout(JSON.stringify(errorBody(e)))
    else {
      let m = e instanceof Error ? e.message : String(e)
      if (e instanceof ApiError) {
        m = `${m} (${e.code})`
        if (e.status === 429 && e.retryAfter !== null) m += `. try again in ${e.retryAfter} s`
      }
      io.stderr(`shwarm: ${clean(m)}`)
      if (!(e instanceof ApiError || e instanceof UsageError || e instanceof AuthError || e instanceof NetworkError) && e instanceof Error && io.env.SHWARM_DEBUG) io.stderr(String(e.stack))
    }
    return code
  }
}
