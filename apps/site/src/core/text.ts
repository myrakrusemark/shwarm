// Text input rules: caps (table B "technical caps"), links (shwarm stores only text; work is linked
// with a fingerprint), mentions (protocol §9) and slugs (protocol §3).
import { isRadRepo, isValidName, ShwarmError, type Link, type WebLink } from '@shwarm/protocol'
import { HIDDEN_CLASS } from '../render/hidden'

export const MAX_TEXT = 20_000 // characters in a post
export const MAX_TITLE = 120
export const MAX_LINKS = 20
export const MAX_LOG_BYTES = 65_536 // inline log cap (64 KB); bigger logs are linked
export const MAX_SLUG = 80 // OPEN: slug length isn't decided; long titles are cut at a word edge

const bad = (message: string, details: Record<string, unknown> = {}) => new ShwarmError('bad_request', message, details)

/**
 * Line breaks as \n: browsers send a textarea's as \r\n, so a node's words are stored one way and the same words sent
 * again from a form compare equal (an edit's "no change").
 */
export const lf = <T,>(v: T): T => (typeof v === 'string' ? (v.replace(/\r\n?/g, '\n') as T) : v)

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

// Self-hashing addresses, read by pattern: `new URL` lowercases an ipfs "host", which breaks a base58 CIDv0.
/**
 * ipfs://<cid>[/path]: a CIDv0 (Qm…, base58) or a CIDv1 in base32 (b…). An ipns:// name can change, so it isn't one, and
 * neither is a path with a `.` or `..` step, plain or percent-encoded: a gateway resolves `<cid>/../../ipns/<name>` to
 * that name.
 */
const IPFS = /^ipfs:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})(\/[^\s?#]*)?$/
/** A magnet's exact topic: a BitTorrent v1 infohash (40 hex or 32 base32, SHA-1, as git commits are) or a v2 one (sha256). */
const XT = /^urn:(btih:([0-9a-fA-F]{40}|[A-Za-z2-7]{32})|btmh:1220[0-9a-fA-F]{64})$/
/**
 * The magnet parameters a pin may carry besides its topics: a name, trackers, web seeds and the length. Anything else
 * could point past the hash, as a BEP 46 mutable source (`xs=urn:btpk:…`) does, so it's refused.
 */
const MAGNET_KEYS = new Set(['xt', 'dn', 'tr', 'ws', 'xl'])
const decodeURIComponentSafe = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
function isIpfs(s: unknown): s is string {
  const m = typeof s === 'string' && s.length <= 2048 ? IPFS.exec(s) : null
  if (!m) return false
  // Decoded first, so %2e%2e and %2f count as the dots and slashes they become.
  return !decodeURIComponentSafe(m[2] ?? '').split(/[/\\]/).some(step => step === '.' || step === '..')
}
function isMagnet(s: unknown): s is string {
  if (typeof s !== 'string' || s.length > 2048 || !s.startsWith('magnet:?') || /\s/.test(s)) return false
  const params = s
    .slice('magnet:?'.length)
    .split('&')
    .map(kv => {
      const i = kv.indexOf('=')
      return i < 0 ? ([kv, ''] as const) : ([kv.slice(0, i), kv.slice(i + 1)] as const)
    })
  if (params.some(([k]) => !MAGNET_KEYS.has(k))) return false
  // Every topic is a hash (a hybrid torrent carries a v1 and a v2 one), and there is at least one.
  const topics = params.filter(([k]) => k === 'xt').map(([, v]) => decodeURIComponentSafe(v))
  return topics.length > 0 && topics.every(t => XT.test(t))
}

const KEYS = ['url', 'sha256', 'repo', 'commit', 'path', 'label', 'name']
const PIN_KEYS = [...KEYS, 'ipfs', 'magnet']

/**
 * One link from a list: `{url, sha256}` for a file or `{repo, commit, path?}` for a repo at a commit, with an optional
 * label (`name` is accepted as its spelling in protocol §6). With `pins` (a passed claim's pinned work), also the
 * addresses that carry their own hash: `{ipfs}`, `{magnet}` (either may come as `url`), and a `rad:` repo with a full
 * commit. Anything that can change under the link is refused, with the same words for every unpinned shape.
 */
function parseLink(l: unknown, at: string, field: string, pins: boolean): Link {
  if (!l || typeof l !== 'object') throw bad(`${at} is not a link`, { field })
  const o = l as Record<string, unknown>
  const label = o.label ?? o.name
  if (label !== undefined && (typeof label !== 'string' || label.length > 200)) throw bad(`${at} has a bad label`, { field })
  const extra = Object.keys(o).filter(k => !(pins ? PIN_KEYS : KEYS).includes(k))
  if (extra.length) throw bad(`${at} has unknown fields: ${extra.join(', ')}`, { field })
  const labelled = label ? { label: label as string } : {}
  if (pins && !('sha256' in o) && !('commit' in o)) {
    const ipfs = o.ipfs ?? (isIpfs(o.url) ? o.url : undefined)
    const magnet = o.magnet ?? (isMagnet(o.url) ? o.url : undefined)
    if (ipfs !== undefined || magnet !== undefined) {
      if ([o.ipfs, o.magnet, o.url, o.repo, o.path].filter(x => x !== undefined).length > 1) throw bad(`${at} is one link, not several`, { field })
      // OPEN: new words (pinned work, decided Oct 14).
      if (ipfs !== undefined && !isIpfs(ipfs)) throw bad(`${at}.ipfs is not an ipfs://<cid> address, with no . or .. in its path`, { field })
      if (magnet !== undefined && !isMagnet(magnet))
        throw bad(`${at}.magnet needs xt=urn:btih:<hash> or xt=urn:btmh:<hash>, and takes only xt, dn, tr, ws and xl`, { field })
      return ipfs !== undefined ? { ipfs: ipfs as string, ...labelled } : { magnet: magnet as string, ...labelled }
    }
  }
  if ('sha256' in o) {
    if (!isHttpUrl(o.url)) throw bad(`${at}.url is not a web address`, { field })
    if (typeof o.sha256 !== 'string' || !HEX64.test(o.sha256)) throw bad(`${at}.sha256 must be 64 lowercase hex characters`, { field })
    if ('repo' in o || 'commit' in o) throw bad(`${at} is either a file or a repo, not both`, { field })
    return { url: o.url, sha256: o.sha256, ...labelled }
  }
  if ('commit' in o) {
    const repo = o.repo ?? o.url // protocol §6 spells it {url, commit}
    if (!isHttpUrl(repo) && !(pins && typeof repo === 'string' && isRadRepo(repo))) throw bad(`${at}.repo is not a web address`, { field })
    if (typeof o.commit !== 'string' || !COMMIT.test(o.commit)) throw bad(`${at}.commit must be a full commit id`, { field })
    if (o.path !== undefined && (typeof o.path !== 'string' || o.path.length > 500)) throw bad(`${at}.path is not a path`, { field })
    return { repo, commit: o.commit, ...(o.path ? { path: o.path as string } : {}), ...labelled }
  }
  throw bad(`${at} needs a sha256 (a file) or a commit (a repo)`, { field })
}

function parseList<T extends Link>(v: unknown, field: string, pins: boolean): T[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw bad(`${field} must be a list of links`, { field })
  if (v.length > MAX_LINKS) throw bad(`at most ${MAX_LINKS} links per post`, { field })
  return v.map((l, i) => parseLink(l, `${field}[${i}]`, field, pins) as T)
}

/** Links, never files: each one pinned, by a sha256 (a file) or a full commit (a repo), at an https address. */
export const parseLinks = (v: unknown, field = 'links'): WebLink[] => parseList<WebLink>(v, field, false)

/**
 * A passed claim's pinned work (decided Oct 14, "One model for every node"): the links parseLinks takes, and also an
 * ipfs:// address, a magnet link or a rad: repo with a full commit, which carry their own hash.
 */
export const parsePins = (v: unknown, field = 'links'): Link[] => parseList<Link>(v, field, true)

// ---------- how post text is read: one rule for what the renderer links and what notifies ----------

export type Block = { code: string } | { lines: string[] }

export const textLines = (s: string) => s.replace(/\r\n?/g, '\n').split('\n')

/** Post text as blocks: paragraphs (split at blank lines) and ``` fences. An unclosed fence runs to the end. */
export function textBlocks(text: string): Block[] {
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ lines: para })
    para = []
  }
  const ls = textLines(text)
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i]
    if (/^ {0,3}```/.test(line)) {
      flush()
      const code: string[] = []
      for (i++; i < ls.length && !/^ {0,3}```\s*$/.test(ls[i]); i++) code.push(ls[i])
      // the info string after ``` (a language name) is dropped
      out.push({ code: code.join('\n') })
    } else if (!line.trim()) flush()
    else para.push(line)
  }
  flush()
  return out
}

/** One line split into `inline code` spans and the prose around them. */
export function inlineRuns(line: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = []
  let at = 0
  for (const m of line.matchAll(/`([^`\n]+)`/g)) {
    if (m.index! > at) out.push({ code: false, text: line.slice(at, m.index!) })
    out.push({ code: true, text: m[1] })
    at = m.index! + m[0].length
  }
  if (at < line.length) out.push({ code: false, text: line.slice(at) })
  return out
}

const SCHEME = '[Hh][Tt][Tt][Pp][Ss]?://'
const URL_BODY = `[^\\s<>"'\`${HIDDEN_CLASS}]+`
// '@' at the start or after anything that isn't a name character, then the longest name.
const MENTION = '(?<![A-Za-z0-9_@])@([a-z0-9_]{2,32}(?:/[a-z0-9][a-z0-9._-]{0,63}){0,6})'
// Tags as core takes them (lowercase letters, digits, dashes). One letter at least, so "#2" stays text.
const TAG = '(?<![A-Za-z0-9_&#/])#([a-z0-9][a-z0-9-]{0,31})(?![A-Za-z0-9_])'
const TOKEN = new RegExp(`(${SCHEME}${URL_BODY})|${MENTION}|${TAG}`, 'gu')

/** Trailing punctuation isn't part of a link; a ")" is, when the link opened one. */
function trimUrl(s: string): string {
  for (;;) {
    const last = s.at(-1)
    if (!last) return s
    if ('.,;:!?*_~\'"'.includes(last)) s = s.slice(0, -1)
    else if (last === ')' && count(s, '(') < count(s, ')')) s = s.slice(0, -1)
    else if (last === ']' && count(s, '[') < count(s, ']')) s = s.slice(0, -1)
    else if (last === '}' && count(s, '{') < count(s, '}')) s = s.slice(0, -1)
    else return s
  }
}
const count = (s: string, ch: string) => s.split(ch).length - 1

/**
 * Trailing . - _ after an agent name are punctuation ("thanks @myra/m-07."). A bare handle can't hold . or -,
 * and its underscores are its own: handles may end in "_".
 */
const mentionName = (raw: string) => '@' + (raw.includes('/') ? raw.replace(/[._-]+$/, '') : raw)

export type Token = { kind: 'url' | 'mention' | 'tag'; start: number; text: string }

/**
 * The web addresses, @names and #tags in a run of prose (no code), in order. `text` is the token as it reads:
 * an address without trailing punctuation, a valid name, a tag with a letter in it. Text inside an address
 * is never a name or a tag.
 */
export function* proseTokens(s: string): Generator<Token> {
  for (const m of s.matchAll(TOKEN)) {
    const start = m.index!
    if (m[1]) yield { kind: 'url', start, text: trimUrl(m[1]) }
    else if (m[2]) {
      const name = mentionName(m[2])
      if (isValidName(name)) yield { kind: 'mention', start, text: name }
    } else if (m[3]) {
      const tag = m[3].replace(/-+$/, '')
      if (/[a-z]/.test(tag)) yield { kind: 'tag', start, text: '#' + tag }
    }
  }
}

/**
 * Names mentioned in a post, in order, without repeats: the same ones the renderer links, so names in code
 * or inside a web address don't notify. "thanks @myra/m-07." → ['@myra/m-07']; "a@b_c" → [].
 */
export function extractMentions(text: string): string[] {
  const out: string[] = []
  for (const b of textBlocks(text)) {
    if (!('lines' in b)) continue
    for (const line of b.lines)
      for (const run of inlineRuns(line)) {
        if (run.code) continue
        for (const t of proseTokens(run.text)) if (t.kind === 'mention' && !out.includes(t.text)) out.push(t.text)
      }
  }
  return out
}

// Path segments the URLs use under /w/<path>/ (protocol §3; the submission page is /w/<path>/s/<n>).
// join and leave (go-live 8.2): an agent's POST /w/<path>/join and /leave (api/routes.ts). people (Oct 14): everyone
// on a node, the full list behind the page's top five (web/node-routes.tsx).
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(['branches', 'log', 's', 'new', 'edit', 'join', 'leave', 'people'])

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
