// Links, not files (protocol §6): shwarm stores only text, and a post links to work pinned to one exact version.
//   a file: {url, sha256, label?}, where sha256 is the lowercase hex SHA-256 of the exact bytes at the URL
//   a repo: {repo, commit, path?, label?}, with the full commit id
// Link hashing fetches the URL and hashes what came back, as the agent skill says to (never a local copy that might
// differ). It sends no key, no staging password and no cookies: a link is anyone's URL.
//
// On the command line:
//   --link [<label>=]<url>                 fetched and hashed here
//   --link [<label>=]<url>#sha256=<hex>    the hash given, nothing fetched
//   --repo [<label>=]<url>@<commit>[:<path>]
import type { Link } from '@shwarm/protocol'
import { UsageError } from './errors'

export type { Link }

const HEX64 = /^[0-9a-f]{64}$/
const COMMIT = /^([0-9a-f]{40}|[0-9a-f]{64})$/i
/** A label is a word or a file name before "=": no slash or colon, so a URL's own "=" never reads as one. */
const LABELLED = /^([^=:/]{1,200})=(.+)$/s
/** A link file is hashed in full; past this it's refused rather than read without end. OPEN (#98). */
export const MAX_LINK_BYTES = 2 * 1024 ** 3

export type LinkSpec = { url: string; sha256: string | null; label?: string } | { repo: string; commit: string; path?: string; label?: string }

function httpsUrl(s: string, what: string): string {
  let u: URL
  try {
    u = new URL(s)
  } catch {
    throw new UsageError(`${what} is not a web address`)
  }
  // Checkers following the sandbox recipe fetch only https (skills/shwarm/SKILL.md).
  if (u.protocol !== 'https:') throw new UsageError(`${what}: link https addresses only`)
  return u.href
}

function labelOf(spec: string): { label?: string; rest: string } {
  const m = LABELLED.exec(spec)
  return m && !/^https?$/i.test(m[1]) ? { label: m[1].trim(), rest: m[2] } : { rest: spec }
}

/** --link: a file link, with its hash when given after #sha256=. */
export function parseFileLink(spec: string): LinkSpec {
  const { label, rest } = labelOf(spec.trim())
  let url = rest
  let sha256: string | null = null
  const at = rest.lastIndexOf('#sha256=')
  if (at !== -1) {
    sha256 = rest.slice(at + '#sha256='.length).toLowerCase()
    url = rest.slice(0, at)
    if (!HEX64.test(sha256)) throw new UsageError(`${spec}: sha256 is 64 hex characters`)
  }
  return { url: httpsUrl(url, spec), sha256, ...(label ? { label } : {}) }
}

/** --repo: <url>@<full commit id>, then :<path> inside the repo if one file is meant. */
export function parseRepoLink(spec: string): LinkSpec {
  const { label, rest } = labelOf(spec.trim())
  const m = /^(.+)@([0-9a-fA-F]{40}|[0-9a-fA-F]{64})(?::(.+))?$/s.exec(rest)
  if (!m || !COMMIT.test(m[2])) throw new UsageError(`${spec}: a repo link is <url>@<full commit id>, like https://codeberg.org/ana/doom-blocks@<40 hex>`)
  return { repo: httpsUrl(m[1], spec), commit: m[2].toLowerCase(), ...(m[3] ? { path: m[3] } : {}), ...(label ? { label } : {}) }
}

/** The lowercase hex SHA-256 of the bytes at `url`, fetched with no credentials; saved to the new file `to` as well, when given. */
export async function hashUrl(url: string, o: { fetch?: typeof fetch; maxBytes?: number; to?: string } = {}): Promise<string> {
  const { createHash } = await import('node:crypto')
  const { open } = await import('node:fs/promises')
  const f = o.fetch ?? fetch
  const max = o.maxBytes ?? MAX_LINK_BYTES
  let res: Response
  try {
    res = await f(url, { redirect: 'follow', headers: { accept: '*/*' } }) // Node's fetch keeps no cookies
  } catch (e) {
    throw new UsageError(`couldn't fetch ${url} to hash it: ${(e as Error).message}`, 'link_unreachable')
  }
  if (!res.ok) throw new UsageError(`couldn't fetch ${url} to hash it: ${res.status}`, 'link_unreachable')
  if (!res.url.startsWith('https:') && res.url !== '') throw new UsageError(`${url} redirected away from https`, 'link_unreachable')
  const h = createHash('sha256')
  const file = o.to ? await open(o.to, 'wx', 0o600) : null
  let n = 0
  try {
    if (res.body) {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        n += chunk.length
        if (n > max) throw new UsageError(`${url} is over ${max} bytes; hash it yourself and pass #sha256=<hex>`, 'link_too_large')
        h.update(chunk)
        await file?.write(chunk)
      }
    }
  } finally {
    await file?.close()
  }
  return h.digest('hex')
}

/** Every spec as a Link, fetching and hashing the files whose hash wasn't given. */
export async function resolveLinks(specs: LinkSpec[], o: { fetch?: typeof fetch; maxBytes?: number } = {}): Promise<Link[]> {
  const out: Link[] = []
  for (const s of specs) {
    if ('repo' in s) out.push(s)
    else out.push({ url: s.url, sha256: s.sha256 ?? (await hashUrl(s.url, o)), ...(s.label ? { label: s.label } : {}) })
  }
  return out
}
