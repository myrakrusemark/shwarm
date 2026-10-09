// The safe text renderer (go-live 3.3, table B #49): post text, done tests, commands, logs and names.
// Plain text in, HTML out. No raw HTML ever: every character of input is escaped, and the only markup is
// what this file writes. Line breaks are kept; ``` fences and `inline code` show monospace; http(s) links,
// @names and #tags become links. Links are never embedded as media.
import { raw } from 'hono/html'
import type { FC } from 'hono/jsx'
import { isValidName } from '@shwarm/protocol'
import { BIDI_RE, escapeOf, HIDDEN_RE, hiddenName } from './hidden'

/** rel on every outside link: no ranking credit, user content, no window.opener, no referrer. */
export const LINK_REL = 'nofollow ugc noopener noreferrer'

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** HTML-escapes text for an element body or a double-quoted attribute. */
export const esc = (s: string) => s.replace(/[&<>"']/g, ch => ESC[ch])

const hiddenSpan = (ch: string) => `<span class="hid" title="${hiddenName(ch)}">${escapeOf(ch)}</span>`

/** Escaped text with every hidden character shown as a visible escape (commands, code, logs, names). */
const strict = (s: string) => esc(s).replace(new RegExp(HIDDEN_RE.source, 'g'), hiddenSpan)
/** Escaped prose: only the bidi controls are shown (see hidden.ts). */
const prose = (s: string) => esc(s).replace(new RegExp(BIDI_RE.source, 'g'), hiddenSpan)

// ---------- names, links, tags ----------

/** Where an @name links: /@handle for a person, /@handle?as=@handle/path for one of their agents. */
export function nameHref(name: string): string | null {
  if (!isValidName(name)) return null
  const [handle] = name.slice(1).split('/')
  return name.includes('/') ? `/@${handle}?as=%40${name.slice(1)}` : `/@${handle}`
}

/** A name or display name as text, hidden characters shown. */
export const renderName = (name: string) => strict(name)

/** An @name as a link (or as text, if it isn't a valid name). */
export function renderNameLink(name: string, cls?: string): string {
  const href = nameHref(name)
  if (!href) return strict(name)
  return `<a${cls ? ` class="${esc(cls)}"` : ''} href="${esc(href)}">${esc(name)}</a>`
}

/** The link target and the text to show, or null if this isn't an http(s) address. */
export function linkParts(candidate: string): { href: string; text: string } | null {
  let u: URL
  try {
    u = new URL(candidate)
  } catch {
    return null
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null
  // The URL parser turns a non-ASCII host into punycode (xn--…). An address typed in plain ASCII is shown as
  // typed; any other is shown from the parsed form, so a look-alike domain shows its punycode.
  // OPEN: every non-ASCII domain shows as punycode, not only mixed-script ones; simplest and strictest.
  if (/^[\x21-\x7e]+$/.test(candidate)) return { href: u.href, text: candidate }
  let shown = u.href
  try {
    shown = decodeURI(u.href) // readable paths; hidden characters are escaped when shown
  } catch {
    // malformed escapes: show it encoded
  }
  return { href: u.href, text: shown }
}

// OPEN: outside links open in the same tab (no target), with " ↗" as in the mockups.
export function renderLink(candidate: string): string | null {
  const p = linkParts(candidate)
  if (!p) return null
  return `<a class="out" href="${esc(p.href)}" rel="${LINK_REL}">${strict(p.text)}<span class="ext" aria-hidden="true"> ↗</span></a>`
}

export const tagHref = (tag: string) => `/?tag=${encodeURIComponent(tag)}`

// ---------- inline text ----------

const SCHEME = '[Hh][Tt][Tt][Pp][Ss]?://'
const URL_BODY = "[^\\s<>\"'`\\u061C\\u200B-\\u200F\\u202A-\\u202E\\u2060\\u2066-\\u2069\\uFEFF]+"
// The same mention rule as core extractMentions, so what links is what notifies.
const MENTION = '(?<![A-Za-z0-9_@])@([a-z0-9_]{2,32}(?:/[a-z0-9][a-z0-9._-]{0,63}){0,6})'
// Tags as core takes them (lowercase letters, digits, dashes). One letter at least, so "#2" stays text.
const TAG = '(?<![A-Za-z0-9_&#/])#([a-z0-9][a-z0-9-]{0,31})(?![A-Za-z0-9_])'
const TOKEN = new RegExp(`(${SCHEME}${URL_BODY})|${MENTION}|${TAG}`, 'g')

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

/** Prose without code spans: links, @names and #tags. */
function linkify(s: string): string {
  let out = ''
  let at = 0
  for (const m of s.matchAll(TOKEN)) {
    const start = m.index!
    let token = m[0]
    let html: string | null = null
    if (m[1]) {
      token = trimUrl(m[1])
      html = renderLink(token)
    } else if (m[2]) {
      token = '@' + m[2].replace(/[._-]+$/, '')
      html = isValidName(token) ? renderNameLink(token) : null
    } else if (m[3]) {
      const tag = m[3].replace(/-+$/, '')
      token = '#' + tag
      html = /[a-z]/.test(tag) ? `<a class="t" href="${esc(tagHref(tag))}">${esc(token)}</a>` : null
    }
    if (!html) continue
    out += prose(s.slice(at, start)) + html
    at = start + token.length
  }
  return out + prose(s.slice(at))
}

/** One line or paragraph: `code` spans first, then links in the rest. */
function inline(s: string): string {
  let out = ''
  let at = 0
  for (const m of s.matchAll(/`([^`\n]+)`/g)) {
    out += linkify(s.slice(at, m.index!)) + `<code>${strict(m[1])}</code>`
    at = m.index! + m[0].length
  }
  return out + linkify(s.slice(at))
}

const lines = (s: string) => s.replace(/\r\n?/g, '\n').split('\n')

// ---------- the public functions ----------

/**
 * Post text as HTML: paragraphs at blank lines, <br> at line breaks, ``` fences as <pre><code>.
 * With `inline`, one run of text with <br> at line breaks and no paragraphs or fences (done tests, titles).
 */
export function renderText(text: string, opts: { inline?: boolean } = {}): string {
  if (opts.inline) return lines(text).map(inline).join('<br>')
  const out: string[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`)
    para = []
  }
  const ls = lines(text)
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i]
    if (/^ {0,3}```/.test(line)) {
      flush()
      const code: string[] = []
      for (i++; i < ls.length && !/^ {0,3}```\s*$/.test(ls[i]); i++) code.push(ls[i])
      // the info string after ``` (a language name) is dropped; an unclosed fence runs to the end
      out.push(`<pre class="code"><code>${strict(code.join('\n'))}</code></pre>`)
    } else if (!line.trim()) flush()
    else para.push(line)
  }
  flush()
  return out.join('\n')
}

/** A done-test command: monospace, every hidden character shown. */
export const renderCommand = (cmd: string) =>
  cmd.includes('\n') ? `<pre class="cmd"><code>${strict(cmd)}</code></pre>` : `<code class="cmd">${strict(cmd)}</code>`

/** A run log: escaped preformatted text, hidden characters shown, nothing linked. */
export const renderLog = (log: string) => `<pre class="log">${strict(log.replace(/\r\n?/g, '\n'))}</pre>`

// ---------- components ----------

export const Text: FC<{ text: string; inline?: boolean }> = ({ text, inline }) =>
  inline ? raw(renderText(text, { inline: true })) : raw(`<div class="txt">${renderText(text)}</div>`)
export const Command: FC<{ cmd: string }> = ({ cmd }) => raw(renderCommand(cmd))
export const Log: FC<{ text: string }> = ({ text }) => raw(renderLog(text))
export const Name: FC<{ name: string; link?: boolean; class?: string }> = props =>
  raw(props.link ? renderNameLink(props.name, props.class) : renderName(props.name))
