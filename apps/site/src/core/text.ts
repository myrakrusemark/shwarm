// Text input rules: caps (table B "technical caps"), links (shwarm stores only text; work is linked
// with a fingerprint), mentions (protocol §9) and slugs (protocol §3).
import { isValidName, ShwarmError, type Link } from '@shwarm/protocol'

export const MAX_TEXT = 20_000 // characters in a post
export const MAX_TITLE = 120
export const MAX_LINKS = 20
export const MAX_LOG_BYTES = 65_536 // inline log cap (64 KB); bigger logs are linked
export const MAX_SLUG = 80 // OPEN: slug length isn't decided; long titles are cut at a word edge

const bad = (message: string, details: Record<string, unknown> = {}) => new ShwarmError('bad_request', message, details)

/** A required plain-text field: trimmed, non-empty, under `max` characters. */
export function needText(v: unknown, field: string, max = MAX_TEXT): string {
  if (typeof v !== 'string' || !v.trim()) throw bad(`${field} is required`, { field })
  if ([...v].length > max) throw bad(`${field} is longer than ${max} characters`, { field })
  return v.trim()
}

export function optText(v: unknown, field: string, max = MAX_TEXT): string | null {
  if (v === undefined || v === null || v === '') return null
  return needText(v, field, max)
}

export const byteLength = (s: string) => new TextEncoder().encode(s).length

const HEX64 = /^[0-9a-f]{64}$/
const COMMIT = /^([0-9a-f]{40}|[0-9a-f]{64})$/ // a full git commit id (sha-1 or sha-256)

function isHttpUrl(s: unknown): s is string {
  if (typeof s !== 'string' || s.length > 2048) return false
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Links, never files: `{url, sha256}` for a file or `{repo, commit, path?}` for a repo at a commit, with an
 * optional label (`name` is accepted as its spelling in protocol §6). Anything unpinned is refused.
 */
export function parseLinks(v: unknown, field = 'links'): Link[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw bad(`${field} must be a list of links`, { field })
  if (v.length > MAX_LINKS) throw bad(`at most ${MAX_LINKS} links per post`, { field })
  return v.map((l, i): Link => {
    if (!l || typeof l !== 'object') throw bad(`${field}[${i}] is not a link`, { field })
    const o = l as Record<string, unknown>
    const label = o.label ?? o.name
    if (label !== undefined && (typeof label !== 'string' || label.length > 200)) throw bad(`${field}[${i}] has a bad label`, { field })
    const extra = Object.keys(o).filter(k => !['url', 'sha256', 'repo', 'commit', 'path', 'label', 'name'].includes(k))
    if (extra.length) throw bad(`${field}[${i}] has unknown fields: ${extra.join(', ')}`, { field })
    if ('sha256' in o) {
      if (!isHttpUrl(o.url)) throw bad(`${field}[${i}].url is not a web address`, { field })
      if (typeof o.sha256 !== 'string' || !HEX64.test(o.sha256)) throw bad(`${field}[${i}].sha256 must be 64 lowercase hex characters`, { field })
      if ('repo' in o || 'commit' in o) throw bad(`${field}[${i}] is either a file or a repo, not both`, { field })
      return { url: o.url, sha256: o.sha256, ...(label ? { label: label as string } : {}) }
    }
    if ('commit' in o) {
      const repo = o.repo ?? o.url // protocol §6 spells it {url, commit}
      if (!isHttpUrl(repo)) throw bad(`${field}[${i}].repo is not a web address`, { field })
      if (typeof o.commit !== 'string' || !COMMIT.test(o.commit)) throw bad(`${field}[${i}].commit must be a full commit id`, { field })
      if (o.path !== undefined && (typeof o.path !== 'string' || o.path.length > 500)) throw bad(`${field}[${i}].path is not a path`, { field })
      return { repo, commit: o.commit, ...(o.path ? { path: o.path as string } : {}), ...(label ? { label: label as string } : {}) }
    }
    throw bad(`${field}[${i}] needs a sha256 (a file) or a commit (a repo)`, { field })
  })
}

// '@' at the start or after anything that isn't a name character, then the longest name; trailing . - _ dropped.
const MENTION_RE = /(^|[^A-Za-z0-9_@])@([a-z0-9_]{2,32}(?:\/[a-z0-9][a-z0-9._-]{0,63}){0,6})/g

/** Names mentioned in a text, in order, without repeats. "thanks @myra/m-07." → ['@myra/m-07']; "a@b_c" → []. */
export function extractMentions(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(MENTION_RE)) {
    const name = '@' + m[2].replace(/[._-]+$/, '')
    if (isValidName(name) && !out.includes(name)) out.push(name)
  }
  return out
}

// Path segments the URLs use under /w/<path>/ (protocol §3; the submission page is /w/<path>/s/<n>).
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(['branches', 'log', 's', 'new', 'edit'])

/** "every US lead pipe, mapped" → 'every-us-lead-pipe-mapped' (protocol §3, proposed). '' when nothing is left. */
export function slugify(title: string): string {
  let s = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (s.length > MAX_SLUG) {
    s = s.slice(0, MAX_SLUG)
    const cut = s.lastIndexOf('-')
    if (cut > MAX_SLUG / 2) s = s.slice(0, cut)
    s = s.replace(/-+$/, '')
  }
  return s
}
