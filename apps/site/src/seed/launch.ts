// Maps one entry of docs/launch-shwarms.json to a createNode input plus the text of its pinned first post
// (go-live 3.1, A18, A20, table B "launch-shwarms.json fields"). Pure: no database. Every change it makes is
// returned as a note, so the dry run can list what it changed, normalized, dropped or couldn't parse.
import { LICENSES, type CreateNodeInput } from '../core/nodes'
import { MAX_SLUG, MAX_TITLE } from '../core/text'

export type LaunchShwarm = {
  slug: string
  wave?: number
  title: string
  category?: string
  tags: string[]
  what: string
  done_when: string
  checked_by: {
    runs?: { command?: string; count?: number; description?: string } | null
    people?: { count?: number; human?: boolean; instructions?: string } | null
    author?: boolean
  }
  lobby: number
  builds_on?: string | { name: string; url?: string; license: string } | null
  sources?: string[]
  why_now?: string | null
  size?: string
  needs_humans?: string | null
  risk_notes?: string | null
  variant_of?: string // optional: the slug of the launch shwarm this one is a variant of
}

export type NoteKind = 'changed' | 'normalized' | 'dropped' | 'warning' | 'failed'
export type Note = { field: string; kind: NoteKind; text: string }

export type MappedShwarm = {
  slug: string
  wave: number | null
  input: CreateNodeInput
  pinned: string | null // the pinned first post: the sources, and the builds-on text when the structured field lost some of it
  notes: Note[]
}

/** Fields the import never copies: risk notes stay private (table B); the rest has no place on a node yet. */
export const NOT_IMPORTED = ['wave', 'category', 'size', 'needs_humans', 'risk_notes'] as const

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
// Bidi controls and zero-width characters: refused in done-test commands (go-live 3.3, Trojan Source).
const HIDDEN = /[‪-‮⁦-⁩​-‏⁠﻿]/
const URL_RE = /https?:\/\/\S+/g

const short = (s: string, n = 70) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const q = (s: string) => `"${short(s)}"`

// ---------- run commands ----------

/**
 * "python replay.py demos/ (replays each demo and prints ...)" → command "python replay.py demos/" and the words as a
 * description. A group counts as words, not shell, when it sits outside quotes and comments, follows a space, ends
 * the command or is followed by a space, has at least three words, and holds no shell operator (&& || ; | ` $().
 * Shell comments (# ...) stay in the command: they're valid shell.
 */
export function splitRunCommand(raw: string): { command: string; description?: string; notes: Note[] } {
  const notes: Note[] = []
  const fail = (text: string) => ({ command: raw, notes: [{ field: 'check.runs', kind: 'failed' as const, text }] })
  if (HIDDEN.test(raw)) return fail('the command holds a bidi control or zero-width character')
  if (/[\r\n]/.test(raw)) return fail('the command is more than one line')
  const groups: { start: number; end: number }[] = []
  let quote: string | null = null
  let depth = 0
  let open = -1
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (quote) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = null
      continue
    }
    // An apostrophe inside a word ("position's") is prose, not a quote; no launch command quotes that way.
    if (c === "'" && /\p{L}/u.test(raw[i - 1] ?? '') && /\p{L}/u.test(raw[i + 1] ?? '')) continue
    if (c === "'" || c === '"') quote = c
    else if (c === '\\') i++
    else if (c === '#' && depth === 0 && (i === 0 || /\s/.test(raw[i - 1]))) break // a comment: the rest is left alone
    else if (c === '(') {
      if (depth === 0) open = i
      depth++
    } else if (c === ')') {
      if (depth === 0) return fail('the command has a ")" with no "("')
      depth--
      if (depth === 0) groups.push({ start: open, end: i })
    }
  }
  if (quote) return fail('the command has an unclosed quote')
  if (depth) return fail('the command has a "(" with no ")"')

  const prose = groups.filter(({ start, end }) => {
    const inner = raw.slice(start + 1, end)
    const before = raw[start - 1]
    const after = raw[end + 1]
    return (
      start > 0 &&
      /\s/.test(before) &&
      (after === undefined || /\s/.test(after)) &&
      inner.trim().split(/\s+/).length >= 3 &&
      !/&&|\|\||;|\||`|\$\(/.test(inner)
    )
  })
  if (!prose.length) return { command: raw.trim(), notes }
  let command = raw
  for (const g of [...prose].reverse()) {
    const left = command.slice(0, g.start).trimEnd()
    const right = command.slice(g.end + 1).trimStart()
    command = right ? `${left} ${right}` : left
  }
  command = command.trim()
  const description = prose.map(g => raw.slice(g.start + 1, g.end).trim()).join('; ')
  // In full: the command locks with the done test, so the proofread needs every character.
  notes.push({ field: 'check.runs', kind: 'changed', text: `command split: "${command}", and the words in brackets went to runs.description: "${description}"` })
  return { command, description, notes }
}

// ---------- licenses ----------

export type FoundLicense = { id: string; raw: string; assumed?: string; inherit: boolean }

// Longest first; each match blanks its span so "cc by-sa" isn't also read as "cc by".
const LICENSE_PATTERNS: { re: RegExp; id: (m: RegExpMatchArray) => string; assumed?: (m: RegExpMatchArray) => string | undefined; inherit?: false }[] = [
  { re: /\bcc[ -]?by[ -]?sa(?:[ -]?(4\.0))?\b/, id: () => 'CC-BY-SA-4.0', assumed: m => (m[1] ? undefined : 'version 4.0') },
  { re: /\bcc[ -]?by(?:[ -]?(4\.0))?\b/, id: () => 'CC-BY-4.0', assumed: m => (m[1] ? undefined : 'version 4.0') },
  { re: /\bcc0(?:[ -]?1\.0)?\b/, id: () => 'CC0-1.0' },
  { re: /\bagpl(?:[ -]?v?(3)(?:\.0)?)?(?:-or-later|\+)?\b/, id: () => 'AGPL-3.0', assumed: m => (m[1] ? undefined : 'version 3.0') },
  { re: /\blgpl(?:[ -]?v?(2\.1|3)(?:\.0)?)?(?:-or-later|\+)?\b/, id: m => `LGPL-${m[1] === '2.1' ? '2.1' : '3.0'}`, assumed: m => (m[1] ? undefined : 'version 3.0') },
  { re: /\bgpl(?:[ -]?v?([23])(?:\.0)?)?(?:-or-later|\+)?\b/, id: m => (m[1] === '2' ? 'GPL-2.0' : 'GPL-3.0'), assumed: m => (m[1] ? undefined : 'version 3.0') },
  { re: /\bapache(?:[ -]?(?:license[ -]?)?(2\.0))?\b/, id: () => 'Apache-2.0', assumed: m => (m[1] ? undefined : 'version 2.0') },
  { re: /\bmit\b/, id: () => 'MIT' },
  { re: /\bbsd[ -]?2[ -]?clause\b/, id: () => 'BSD-2-Clause' },
  { re: /\bbsd(?:[ -]?(3)[ -]?clause)?\b/, id: () => 'BSD-3-Clause', assumed: m => (m[1] ? undefined : 'the 3-clause form') },
  { re: /\bodbl\b/, id: () => 'ODbL-1.0' },
  { re: /\bdbcl\b/, id: () => 'DbCL-1.0' },
  { re: /\bpublic[ -]domain\b/, id: () => 'public domain', inherit: false },
]

/** Every license named in a piece of text (URLs left out), as SPDX-style ids. */
export function findLicenses(text: string): FoundLicense[] {
  let s = text.replace(URL_RE, ' ').toLowerCase()
  const out: FoundLicense[] = []
  for (const p of LICENSE_PATTERNS) {
    for (;;) {
      const m = s.match(p.re)
      if (!m) break
      const id = p.id(m)
      if (!out.some(f => f.id === id)) out.push({ id, raw: m[0], assumed: p.assumed?.(m), inherit: p.inherit !== false })
      s = s.slice(0, m.index!) + ' '.repeat(m[0].length) + s.slice(m.index! + m[0].length)
    }
  }
  return out
}

/** One license a node can take from what was found: MIT with CC BY 4.0 is the A2 default pair. */
function oneLicense(found: FoundLicense[]): { id: string; from: FoundLicense[] } | null {
  const usable = found.filter(f => f.inherit)
  if (usable.length === 1) return { id: usable[0].id, from: usable }
  const ids = usable.map(f => f.id).sort()
  if (ids.length === 2 && ids[0] === 'CC-BY-4.0' && ids[1] === 'MIT') return { id: 'MIT+CC-BY-4.0', from: usable }
  return null
}

// ---------- builds on ----------

type Piece = { head: string; url: string | null; tail: string }

const words = (s: string) => s.toLowerCase().replace(URL_RE, ' ').match(/[a-z0-9][a-z0-9'.-]*/g) ?? []
const STOP = new Set(['and', 'plus', 'the', 'a', 'an', 'of', 'by', 'with', 'from', 'for', 'at', 'on', 'in', 'via'])

/** Pull URLs out, trimming the punctuation and unmatched ")" that prose wraps around them. */
function urlsIn(s: string): { url: string; start: number; end: number }[] {
  const out: { url: string; start: number; end: number }[] = []
  for (const m of s.matchAll(URL_RE)) {
    let url = m[0]
    for (;;) {
      if (/[.,;:]$/.test(url)) url = url.slice(0, -1)
      else if (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1)
      else break
    }
    out.push({ url, start: m.index!, end: m.index! + url.length })
  }
  return out
}

/** "a (mit) https://x + b https://y, which bundles c" → one piece per URL, each with the words around it. */
function pieces(text: string): Piece[] {
  // Split on " + ", then fold a part with no URL into the next one (or the last), since "lilypond + midi" is one thing.
  const parts = text.split(/\s\+\s/)
  const merged: string[] = []
  let carry = ''
  for (const p of parts) {
    const cur = carry ? `${carry} + ${p}` : p
    if (urlsIn(cur).length) {
      merged.push(cur)
      carry = ''
    } else carry = cur
  }
  if (carry) merged.length ? (merged[merged.length - 1] += ` + ${carry}`) : merged.push(carry)

  const out: Piece[] = []
  for (const part of merged) {
    const urls = urlsIn(part)
    if (!urls.length) {
      out.push({ head: part, url: null, tail: '' })
      continue
    }
    let cursor = 0
    urls.forEach((u, i) => {
      let head = part.slice(cursor, u.start)
      let after = u.end
      // A URL in brackets, "(https://x)": drop both brackets.
      const close = part.slice(after).match(/^\s*\)/)
      if (/\(\s*$/.test(head) && close) {
        head = head.replace(/\(\s*$/, '')
        after += close[0].length
      }
      if (i + 1 < urls.length) {
        // Up to the next URL, a bracket right after this one is this one's ("https://x (dbcl), plus y https://z").
        const own = part.slice(after, urls[i + 1].start).match(/^\s*\([^()]*\)/)?.[0] ?? ''
        out.push({ head, url: u.url, tail: own })
        cursor = after + own.length
      } else {
        out.push({ head, url: u.url, tail: part.slice(after) })
        cursor = part.length
      }
    })
  }
  return out
}

/** The upstream's name: its words before the URL, without license brackets or license-only phrases. */
function nameOf(p: Piece): string {
  let s = p.head
  s = s.replace(/\([^()]*\)/g, m => (findLicenses(m).length || !m.slice(1, -1).trim() ? ' ' : m))
  s = s
    .split(',')
    .filter(part => {
      const w = words(part).filter(x => !STOP.has(x))
      const lic = findLicenses(part)
      const licWords = new Set(lic.flatMap(l => words(l.raw)))
      return !(lic.length && w.every(x => licWords.has(x)))
    })
    .join(',')
  s = s.replace(/^[\s,;:+]*(?:(?:and|plus)\s+)?/i, '')
  s = s.replace(/[\s,;:+-]+$/, '').replace(/\s+(?:at|from|via|on|in)$/i, '') // "public api at https://..."
  return s.replace(/[\s,;:+-]+$/, '').replace(/\s+/g, ' ').trim()
}

export type BuildsOnResult = {
  buildsOn: { name: string; url?: string; license: string } | null
  keepText: boolean // the text goes in the pinned post too, because the structured field lost some of it
  notes: Note[]
}

/**
 * Free text → one {name, url, license}. A node holds one upstream and takes its license (protocol §8, A2), so:
 * the first upstream whose text names one usable license wins; public domain passes nothing on; no license → no
 * builds_on (the A2 default applies). Whatever the structured field can't hold goes in the pinned post verbatim.
 */
export function parseBuildsOn(v: LaunchShwarm['builds_on']): BuildsOnResult {
  const notes: Note[] = []
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim()) || v === 'None') return { buildsOn: null, keepText: false, notes }
  if (typeof v === 'object') {
    // Already structured (Myra can write this in the JSON during the proofread): check it, don't guess.
    const lic = typeof v.license === 'string' ? oneLicense(findLicenses(v.license)) : null
    const id = typeof v.license === 'string' && (LICENSES.includes(v.license) || /^[A-Za-z0-9.+-]{2,40}$/.test(v.license)) ? v.license : lic?.id
    if (typeof v.name !== 'string' || !v.name.trim() || !id) return { buildsOn: null, keepText: false, notes: [{ field: 'builds_on', kind: 'failed', text: 'builds_on as an object needs a name and a license' }] }
    if (v.url !== undefined && !isHttpUrl(v.url)) return { buildsOn: null, keepText: false, notes: [{ field: 'builds_on', kind: 'failed', text: `builds_on.url ${q(String(v.url))} is not a web address` }] }
    return { buildsOn: { name: v.name.trim(), ...(v.url ? { url: v.url } : {}), license: id }, keepText: false, notes }
  }
  const text = v.trim()
  const ps = pieces(text)
  for (const p of ps) if (p.url && !isHttpUrl(p.url)) notes.push({ field: 'builds_on', kind: 'failed', text: `${q(p.url)} is not a web address` })

  const parsed = ps.map(p => ({ p, name: nameOf(p), found: findLicenses(`${p.head} ${p.tail}`) }))
  const pick = parsed.find(x => x.p.url !== null && oneLicense(x.found)) ?? parsed.find(x => oneLicense(x.found))
  let buildsOn: BuildsOnResult['buildsOn'] = null
  if (pick) {
    const lic = oneLicense(pick.found)!
    const name = pick.name || (pick.p.url ? new URL(pick.p.url).host : '')
    if (!name) notes.push({ field: 'builds_on', kind: 'failed', text: `no name before ${q(pick.p.url ?? text)}` })
    else if (name.length > 200) notes.push({ field: 'builds_on', kind: 'failed', text: `the name is over 200 characters: ${q(name)}` })
    buildsOn = { name, ...(pick.p.url ? { url: pick.p.url } : {}), license: lic.id }
    const raws = lic.from.map(f => f.raw).join(' + ')
    if (raws !== lic.id) notes.push({ field: 'builds_on', kind: 'normalized', text: `license ${q(raws)} → ${lic.id}` })
    for (const f of lic.from) if (f.assumed) notes.push({ field: 'builds_on', kind: 'warning', text: `${q(f.raw)} names no version; assumed ${f.assumed}` })
    if (!LICENSES.includes(lic.id)) notes.push({ field: 'builds_on', kind: 'warning', text: `${lic.id} isn't on the A2 list; the shwarm takes it anyway, since builds on takes the upstream license` })
    notes.push({ field: 'license', kind: 'changed', text: `${lic.id}, taken from ${short(name, 40)} (builds on takes the upstream license)` })
  } else {
    const pd = parsed.some(x => x.found.some(f => !f.inherit))
    const many = parsed.find(x => x.found.filter(f => f.inherit).length > 1)
    notes.push({
      field: 'builds_on',
      kind: 'dropped',
      text: many
        ? `more than one license named (${many.found.map(f => f.id).join(', ')}); builds_on stays empty and the shwarm takes the default license`
        : pd
          ? 'public domain passes no license on; builds_on stays empty and the shwarm takes the default license'
          : 'no license named; builds_on stays empty and the shwarm takes the default license',
    })
  }

  // Anything the structured field doesn't hold: list the words, and keep the whole text in the pinned post.
  const kept = new Set([...(buildsOn ? words(buildsOn.name) : []), ...(pick ? pick.found.flatMap(f => words(f.raw)) : [])])
  const lost = words(text).filter(w => !STOP.has(w) && !kept.has(w))
  const others = parsed.filter(x => x !== pick && x.p.url).map(x => x.p.url!)
  if (others.length && buildsOn) notes.push({ field: 'builds_on', kind: 'dropped', text: `${others.length} more upstream${others.length > 1 ? 's' : ''} only in the pinned post: ${others.map(u => short(u, 50)).join(', ')}` })
  else if (lost.length && buildsOn) notes.push({ field: 'builds_on', kind: 'dropped', text: `words not in {name, url, license}: "${short(lost.join(' '), 60)}"` })
  return { buildsOn, keepText: !buildsOn || lost.length > 0 || others.length > 0, notes }
}

function isHttpUrl(s: unknown): s is string {
  if (typeof s !== 'string' || s.length > 2048) return false
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

// ---------- the whole entry ----------

/** The pinned first post. Its first line is the feed's status line until the author pins another (table B #40). */
export function pinnedPostText(sources: string[], buildsOnText: string | null): string | null {
  const parts: string[] = []
  if (sources.length) parts.push(['where this pitch comes from:', ...sources].join('\n'))
  if (buildsOnText) parts.push(`builds on: ${buildsOnText}`)
  return parts.length ? parts.join('\n\n') : null
}

/**
 * A launch shwarm that is a variant of another: an explicit `variant_of` slug, or else a #variant tag plus a
 * title that starts with the other one's title and a colon ("minecraft in doom: survival").
 */
function variantOf(e: Partial<LaunchShwarm> & { variant_of?: unknown }, all: unknown[]): { slug: string | null; note: Note | null } {
  if (typeof e.variant_of === 'string') return { slug: e.variant_of, note: null }
  if (!Array.isArray(e.tags) || !e.tags.some(t => t === '#variant' || t === 'variant')) return { slug: null, note: null }
  const title = String(e.title ?? '')
  const parent = all.find((x): x is LaunchShwarm => !!x && typeof x === 'object' && (x as LaunchShwarm).slug !== e.slug && title.startsWith(`${(x as LaunchShwarm).title}:`))
  if (!parent) return { slug: null, note: { field: 'kind', kind: 'warning', text: 'tagged #variant, but no other launch shwarm\'s title starts this one; imported as a plain shwarm' } }
  return { slug: parent.slug, note: { field: 'kind', kind: 'changed', text: `imported as a variant of ${parent.slug} (from its #variant tag and its title)` } }
}

export function mapLaunchShwarm(raw: unknown, all: unknown[] = []): MappedShwarm {
  const notes: Note[] = []
  const fail = (field: string, text: string) => notes.push({ field, kind: 'failed', text })
  const e = (raw && typeof raw === 'object' ? raw : {}) as Partial<LaunchShwarm>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')

  const slug = str(e.slug)
  if (!SLUG_RE.test(slug) || slug.length > MAX_SLUG) fail('slug', `${q(slug)} is not a slug: lowercase letters, digits and single dashes, up to ${MAX_SLUG}`)
  const title = str(e.title).trim()
  if (!title || [...title].length > MAX_TITLE) fail('title', `the title is empty or over ${MAX_TITLE} characters`)
  else if (title !== e.title) notes.push({ field: 'title', kind: 'normalized', text: 'spaces trimmed' })

  let what = str(e.what).trim()
  if (!what) fail('what', 'the pitch is empty')
  const whyNow = str(e.why_now).trim()
  if (whyNow) {
    // Table B: why_now is appended to what. As its own last paragraph, labeled, so it reads as a separate thought.
    what = `${what}\n\nwhy now: ${whyNow.replace(/^why now:\s*/i, '')}`
    notes.push({ field: 'what', kind: 'changed', text: `why_now appended as a last paragraph, "why now: ${short(whyNow, 40)}"` })
  }

  const doneWhen = str(e.done_when).trim()
  if (!doneWhen || doneWhen.length > 2000) fail('done_when', 'the done test is empty or over 2000 characters')

  const cb = e.checked_by
  const check: { runs?: { command: string; count: number; description?: string }; people?: { count: number; human: boolean; instructions?: string }; author: boolean } = { author: false }
  if (!cb || typeof cb !== 'object') fail('checked_by', 'checked_by is missing')
  else {
    const r = cb.runs
    if (r && typeof r === 'object' && (r.command !== undefined || r.count !== undefined)) {
      if (typeof r.command !== 'string' || !r.command.trim()) fail('check.runs', 'runs need a command')
      else if (!Number.isInteger(r.count) || (r.count as number) < 1) fail('check.runs', 'runs.count must be a whole number from 1')
      else if (typeof r.description === 'string' && r.description.trim()) {
        // Already split in the JSON: keep both as written.
        if (HIDDEN.test(r.command)) fail('check.runs', 'the command holds a bidi control or zero-width character')
        check.runs = { command: r.command.trim(), count: r.count as number, description: r.description.trim() }
      } else {
        const s = splitRunCommand(r.command)
        notes.push(...s.notes)
        check.runs = { command: s.command, count: r.count as number, ...(s.description ? { description: s.description } : {}) }
      }
    }
    const p = cb.people
    if (p && typeof p === 'object' && p.count !== undefined) {
      if (!Number.isInteger(p.count) || (p.count as number) < 1) fail('check.people', 'people.count must be a whole number from 1')
      else {
        const instructions = str(p.instructions).trim()
        check.people = { count: p.count as number, human: p.human === true, ...(instructions ? { instructions } : {}) }
      }
    }
    if (cb.author !== undefined && typeof cb.author !== 'boolean') fail('check.author', 'author must be true or false')
    check.author = cb.author === true
    if (!check.runs && !check.people && !check.author) fail('checked_by', 'the done test names no check')
  }

  const tags: string[] = []
  if (!Array.isArray(e.tags) || !e.tags.length) fail('tags', 'a shwarm needs at least one tag')
  else {
    for (const t of e.tags) {
      const tag = str(t).trim().replace(/^#/, '').toLowerCase()
      if (!TAG_RE.test(tag)) fail('tags', `${q(str(t))} is not a tag`)
      else if (!tags.includes(tag)) tags.push(tag)
    }
    if (tags.length > 8) fail('tags', 'more than 8 tags')
  }

  const lobby = e.lobby
  if (!Number.isInteger(lobby) || (lobby as number) < 1) fail('lobby', 'lobby must be a whole number from 1')
  else if (lobby !== 2) notes.push({ field: 'lobby', kind: 'warning', text: `lobby is ${lobby}; A18 seeds lobby 2. kept as written` })

  const b = parseBuildsOn(e.builds_on)
  notes.push(...b.notes)

  const sources: string[] = []
  if (e.sources !== undefined && e.sources !== null && !Array.isArray(e.sources)) fail('sources', 'sources must be a list of links')
  for (const s of Array.isArray(e.sources) ? e.sources : []) {
    if (!isHttpUrl(s)) fail('sources', `${q(String(s))} is not a web address`)
    else sources.push(s)
  }
  const pinned = pinnedPostText(sources, b.keepText && typeof e.builds_on === 'string' ? e.builds_on.trim() : null)
  if (pinned) notes.push({ field: 'pinned post', kind: 'changed', text: `${sources.length} source${sources.length === 1 ? '' : 's'}${b.keepText && typeof e.builds_on === 'string' ? ', plus the builds-on text as written' : ''}` })
  else notes.push({ field: 'pinned post', kind: 'warning', text: 'no sources, so no pinned post' })

  const v = variantOf(e, all)
  if (v.note) notes.push(v.note)
  if (v.slug !== null && !SLUG_RE.test(v.slug)) fail('variant_of', `${q(v.slug)} is not a slug`)
  const input: CreateNodeInput = {
    kind: v.slug ? 'variant' : 'shwarm',
    ...(v.slug ? { variantOf: v.slug } : {}),
    slug,
    title,
    what,
    doneWhen,
    check,
    tags,
    lobby: lobby as number,
    ...(b.buildsOn ? { buildsOn: b.buildsOn } : {}),
  }
  return { slug, wave: typeof e.wave === 'number' ? e.wave : null, input, pinned, notes }
}
