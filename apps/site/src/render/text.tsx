// The safe text renderer (go-live 3.3): post text, done tests, commands, logs and names.
// Markdown in, HTML out (decided Oct 19; core/markdown.ts reads it). No raw HTML ever: every character of input is
// escaped, and the only markup is what this file writes. Line breaks are kept; http(s) links, @names and #tags become
// links. Links are never embedded as media: an image is a link. A [label](address) link names its host beside the
// label unless the label already does, so the words can't hide where it goes.
import { raw } from 'hono/html'
import type { FC } from 'hono/jsx'
import { isValidName } from '@shwarm/protocol'
import { labelText, parseInline, parseText, textLines, type Block, type Inline } from '../core/markdown'
import { proseTokens } from '../core/text'
import { BIDI_RE, escapeOf, HIDDEN_RE, hiddenName } from './hidden'

/** rel on every outside link: no ranking credit, user content, no window.opener, no referrer. */
export const LINK_REL = 'nofollow ugc noopener noreferrer'

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** HTML-escapes text for an element body or a double-quoted attribute. */
export const esc = (s: string) => s.replace(/[&<>"']/g, ch => ESC[ch])

const hiddenSpan = (ch: string) => `<span class="hid" title="${hiddenName(ch)}">${escapeOf(ch)}</span>`

/** Escaped text with every hidden character shown as a visible escape (commands, code, logs, names). */
const strict = (s: string) => esc(s).replace(HIDDEN_RE, hiddenSpan)
/** Escaped prose: only the bidi controls are shown (see hidden.ts). */
const prose = (s: string) => esc(s).replace(BIDI_RE, hiddenSpan)

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

/** The link target and the text to show, or null if this isn't an http(s) address that can be linked. */
export function linkParts(candidate: string): { href: string; text: string } | null {
  let u: URL
  try {
    u = new URL(candidate)
  } catch {
    return null
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null
  // A user name or password before an "@" ("https://google.com@evil.example/") puts a trusted-looking name
  // in front of the real host. Such an address stays plain text.
  // OPEN: not linked at all; showing it linked without the user part is the other choice.
  if (u.username || u.password) return null
  // The shown text is built from the parsed host, so it always names where the link goes. The URL parser
  // turns a non-ASCII host into punycode (xn--…), so a look-alike domain shows its punycode.
  // OPEN: every non-ASCII domain shows as punycode, not only mixed-script ones; simplest and strictest.
  const origin = `${u.protocol}//${u.host}`
  // An ASCII address whose host reads as parsed is shown as typed.
  const rest = candidate.slice(origin.length)
  if (/^[\x21-\x7e]+$/.test(candidate) && candidate.slice(0, origin.length).toLowerCase() === origin && /^(?:[/?#]|$)/.test(rest))
    return { href: u.href, text: candidate }
  const tail = u.pathname + u.search + u.hash
  let shown = tail
  try {
    shown = decodeURI(tail) // readable paths; hidden characters are escaped when shown
  } catch {
    // malformed escapes: show it encoded
  }
  return { href: u.href, text: origin + shown }
}

// OPEN: outside links open in the same tab (no target), with " ↗" as in the mockups.
export function renderLink(candidate: string): string | null {
  const p = linkParts(candidate)
  if (!p) return null
  return `<a class="out" href="${esc(p.href)}" rel="${LINK_REL}">${strict(p.text)}<span class="ext" aria-hidden="true"> ↗</span></a>`
}

export const tagHref = (tag: string) => `/?tag=${encodeURIComponent(tag)}`

// ---------- inline text ----------

/** Prose without code spans: links, @names and #tags (core/text.ts finds them, so what links is what notifies). */
function linkify(s: string): string {
  let out = ''
  let at = 0
  for (const t of proseTokens(s)) {
    let html: string | null
    if (t.kind === 'url') html = renderLink(t.text)
    else if (t.kind === 'mention') html = renderNameLink(t.text)
    else html = `<a class="t" href="${esc(tagHref(t.text.slice(1)))}">${esc(t.text)}</a>`
    if (!html) continue
    out += prose(s.slice(at, t.start)) + html
    at = t.start + t.text.length
  }
  return out + prose(s.slice(at))
}

/** A [label](address) link. Outside, with nofollow and the ↗, and the host beside it unless the label names it. */
function mdLink(n: Extract<Inline, { t: 'link' }>): string {
  const label = inlines(n.kids, false)
  if (n.href.startsWith('/')) return `<a href="${esc(n.href)}">${label || strict(n.href)}</a>`
  const p = linkParts(n.href)
  if (!p) return label ? `${label} (${strict(n.href)})` : strict(n.href)
  const host = new URL(p.href).host
  const named = labelText(n.kids).toLowerCase().includes(host.replace(/^www\./, ''))
  const tail = label && !named ? ` <span class="host">${strict(host)}</span>` : ''
  return `<a class="out" href="${esc(p.href)}" rel="${LINK_REL}">${label || strict(p.text)}<span class="ext" aria-hidden="true"> ↗</span></a>${tail}`
}

/** Inline nodes as HTML. Inside a link's label (`linked` false) nothing more is linked. */
function inlines(ns: Inline[], linked = true): string {
  let out = ''
  for (const n of ns) {
    if (n.t === 'text') out += linked ? linkify(n.s) : prose(n.s)
    else if (n.t === 'code') out += `<code>${strict(n.s)}</code>`
    else if (n.t === 'link') out += linked ? mdLink(n) : inlines(n.kids, false)
    else out += `<${n.t}>${inlines(n.kids, linked)}</${n.t}>`
  }
  return out
}

const ALIGN = { left: ' class="l"', center: ' class="c"', right: ' class="r"' } as const
const cellAttr = (a: 'left' | 'center' | 'right' | null) => (a ? ALIGN[a] : '')
const lineHtml = (ls: Inline[][]) => ls.map(l => inlines(l)).join('<br>')

/** Blocks as HTML. A heading sits under the page's own: # is an <h3>, ###### an <h6>. */
function blocks(bs: Block[]): string {
  return bs
    .map(b => {
      switch (b.t) {
        case 'p':
          return `<p>${lineHtml(b.lines)}</p>`
        case 'h': {
          const h = `h${Math.min(6, b.level + 2)}`
          return `<${h} class="mh">${inlines(b.kids)}</${h}>`
        }
        case 'code':
          return `<pre class="code"><code>${strict(b.code)}</code></pre>`
        case 'quote':
          return `<blockquote>${blocks(b.blocks)}</blockquote>`
        case 'hr':
          return '<hr>'
        case 'list': {
          const tag = b.ordered ? 'ol' : 'ul'
          const items = b.items.map(it => {
            // an item's first paragraph sits in the <li> itself, as GitHub draws a tight list
            const [first, ...rest] = it.blocks
            const body = first?.t === 'p' ? lineHtml(first.lines) + (rest.length ? '\n' + blocks(rest) : '') : blocks(it.blocks)
            const box = it.task === null ? '' : `<span class="tick" aria-hidden="true">${it.task ? '☑' : '☐'}</span> `
            return `<li${it.task === null ? '' : ' class="task"'}>${box}${body}</li>`
          })
          return `<${tag}${b.ordered && b.start !== 1 ? ` start="${b.start}"` : ''}>${items.join('')}</${tag}>`
        }
        case 'table': {
          const head = b.head.map((c, k) => `<th${cellAttr(b.align[k])}>${inlines(c)}</th>`).join('')
          const rows = b.rows.map(r => `<tr>${r.map((c, k) => `<td${cellAttr(b.align[k])}>${inlines(c)}</td>`).join('')}</tr>`).join('')
          return `<div class="tbl"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
        }
      }
    })
    .join('\n')
}

// ---------- the public functions ----------

/**
 * Post text as HTML: Markdown blocks (core/markdown.ts), every line break kept.
 * With `inline`, one run of text with <br> at line breaks and only inline marks (done tests in lists, notes); with
 * `marks: false` as well, only `code` and links (a title).
 * With `addressed`, an @name that opens the text is marked as who the post is addressed to (design system `.to`).
 */
export function renderText(text: string, opts: { inline?: boolean; addressed?: boolean; marks?: boolean } = {}): string {
  if (opts.inline) return textLines(text).map(l => inlines(parseInline(l, 0, opts.marks !== false))).join('<br>')
  const html = blocks(parseText(text))
  // An opening @name renders as `<a href="/@…">` (urls carry class="out", tags class="t"), so this only adds a class.
  return opts.addressed && html.startsWith('<p><a href="/@') ? '<p><a class="to" href="/@' + html.slice('<p><a href="/@'.length) : html
}

/** A done-test command: monospace, every hidden character shown. */
export const renderCommand = (cmd: string) =>
  cmd.includes('\n') ? `<pre class="cmd"><code>${strict(cmd)}</code></pre>` : `<code class="cmd">${strict(cmd)}</code>`

/** A run log: escaped preformatted text, hidden characters shown, nothing linked. */
export const renderLog = (log: string) => `<pre class="log">${strict(log.replace(/\r\n?/g, '\n'))}</pre>`

// ---------- components ----------

export const Text: FC<{ text: string; inline?: boolean; addressed?: boolean; marks?: boolean }> = ({ text, inline, addressed, marks }) =>
  inline ? raw(renderText(text, { inline: true, marks })) : raw(`<div class="txt">${renderText(text, { addressed })}</div>`)
export const Command: FC<{ cmd: string }> = ({ cmd }) => raw(renderCommand(cmd))
export const Log: FC<{ text: string }> = ({ text }) => raw(renderLog(text))
export const Name: FC<{ name: string; link?: boolean; class?: string }> = props =>
  raw(props.link ? renderNameLink(props.name, props.class) : renderName(props.name))
/** Plain text with nothing linked and every hidden character shown (titles inside links, link labels, hosts). */
export const Plain: FC<{ text: string }> = ({ text }) => raw(strict(text))
