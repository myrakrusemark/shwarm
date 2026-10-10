// Profiles (prd-api CLI-17, CLI-18): ~/.config/shwarm/config.toml, one profile per harness or key, each with its
// server, keyid, default `as` and where its secret is. The secret itself never goes in the config: it lives in
// keys/<profile>.key beside it, mode 0600 (CLI-4), or comes from SHWARM_KEY and is never written down.
// OPEN (#98): no OS keychain yet; the 0600 file is the fallback CLI-4 names.
//
//   default_profile = "staging"
//   [profile.staging]
//   server = "https://shwarm-staging.myrakrusemark.workers.dev"
//   keyid = "k7m2q9x4ab"
//   as = "@myra/m-04"
//   secret_file = "keys/staging.key"
//
// Only that much TOML is read: tables, `key = "string"` and comments. Other keys are kept as they are.
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { UsageError } from './errors'

export type Profile = { server?: string; keyid?: string; as?: string; secret_file?: string; [k: string]: string | undefined }
export type Config = { default_profile?: string; profiles: Record<string, Profile> }

export const PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** $SHWARM_CONFIG_DIR, else $XDG_CONFIG_HOME/shwarm, else ~/.config/shwarm. */
export function configDir(env: Record<string, string | undefined>): string {
  if (env.SHWARM_CONFIG_DIR) return env.SHWARM_CONFIG_DIR
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'shwarm')
}

const unquote = (v: string, line: number): string => {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(v)
  if (!m) throw new UsageError(`config.toml line ${line}: only "quoted strings" are read`, 'config')
  return m[1].replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
}
const quote = (v: string) => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"'

export function parseConfig(text: string): Config {
  const cfg: Config = { profiles: {} }
  let table: Profile | null = null
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/^\s+|\s+$/g, '')
    if (!line || line.startsWith('#')) return
    const t = /^\[\s*profile\.("?)([a-z0-9][a-z0-9_-]{0,31})\1\s*\]$/.exec(line)
    if (t) {
      table = cfg.profiles[t[2]] ??= {}
      return
    }
    if (line.startsWith('[')) throw new UsageError(`config.toml line ${i + 1}: only [profile.<name>] tables are read`, 'config')
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*(#[^"]*)?$/.exec(line)
    if (!kv) throw new UsageError(`config.toml line ${i + 1}: expected key = "value"`, 'config')
    const value = unquote(kv[2], i + 1)
    if (table) table[kv[1]] = value
    else if (kv[1] === 'default_profile') cfg.default_profile = value
  })
  return cfg
}

export function formatConfig(cfg: Config): string {
  const out = ['# shwarm cli profiles. secrets are never kept here: see secret_file (mode 0600), or SHWARM_KEY.']
  if (cfg.default_profile) out.push(`default_profile = ${quote(cfg.default_profile)}`)
  for (const [name, p] of Object.entries(cfg.profiles)) {
    out.push('', `[profile.${name}]`)
    for (const [k, v] of Object.entries(p)) if (v !== undefined) out.push(`${k} = ${quote(v)}`)
  }
  return out.join('\n') + '\n'
}

export async function readConfig(dir: string): Promise<Config> {
  let text: string
  try {
    text = await readFile(join(dir, 'config.toml'), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { profiles: {} }
    throw e
  }
  return parseConfig(text)
}

/** Writes a file readable by its owner only: a temporary file made 0600, then renamed over the old one. */
async function writePrivate(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, text, { mode: 0o600, flag: 'w' })
  await chmod(tmp, 0o600) // in case the file was there already, or the umask kept bits
  await rename(tmp, path)
}

export async function writeConfig(dir: string, cfg: Config): Promise<void> {
  await writePrivate(join(dir, 'config.toml'), formatConfig(cfg))
}

export const secretPath = (dir: string, file: string) => (isAbsolute(file) ? file : join(dir, file))

/** Saves a profile's secret as keys/<profile>.key, mode 0600, and returns that path relative to the config dir. */
export async function saveSecret(dir: string, profile: string, secret: string): Promise<string> {
  const rel = join('keys', `${profile}.key`)
  await mkdir(join(dir, 'keys'), { recursive: true, mode: 0o700 })
  await writePrivate(join(dir, rel), secret.trim() + '\n')
  return rel
}

/** The secret in a profile's file; `warn` hears when others can read the file. */
export async function readSecret(path: string, warn: (m: string) => void): Promise<string> {
  const s = await stat(path)
  // OPEN (#98): warned, not refused, as ssh would; the file still works.
  if (process.platform !== 'win32' && s.mode & 0o077) warn(`${path} can be read by others. run: chmod 600 ${path}`)
  return (await readFile(path, 'utf8')).trim()
}

export async function deleteSecret(path: string): Promise<boolean> {
  try {
    await rm(path)
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw e
  }
}
