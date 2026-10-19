// Participant text as Markdown (decided Oct 19; supersedes table B #49's plain text): posts, a shwarm's or branch's
// what and done test, notes. One parse for the renderer (render/text.tsx) and for the names a post notifies
// (extractMentions), so what links is what notifies.
//
// The subset GitHub comments use, read the forgiving way: headings (# to ######), paragraphs that keep every line
// break, ``` and ~~~ fences, > quotes, - * + and 1. lists (nested by indent, [ ] and [x] tasks), pipe tables with
// :--: alignment, --- rules; inline `code`, **strong**, *em* (and _em_, never inside a word), ~~struck~~,
// [label](https://…) links and \ escapes. An image ![alt](url) is only a link: shwarm never embeds media. No raw HTML:
// every "<" stays text. Not here (yet): indented code blocks (an agent's indented lines stay prose), setext headings,
// footnotes, math (open #144).
//
// Web addresses, @names and #tags are read first and kept whole, so an "_" or "*" inside one never starts emphasis.
// Every scan is bounded: nesting depth, label and address length, a closer that wasn't found is never looked for again,
// and one budget of steps per line (BUDGET_PER_CHAR) shared by every look-ahead in it. A line that spends its budget
// reads as plain text from there on, so no post of 20,000 characters costs more than a few milliseconds to read.
import { proseTokens } from './text'

export type Inline =
  | { t: 'text'; s: string }
  | { t: 'code'; s: string }
  | { t: 'strong' | 'em' | 'del'; kids: Inline[] }
  | { t: 'link'; href: string; kids: Inline[] }

export type Align = 'left' | 'center' | 'right' | null
export type ListItem = { task: boolean | null; blocks: Block[] }
export type Block =
  | { t: 'p'; lines: Inline[][] }
  | { t: 'h'; level: number; kids: Inline[] }
  | { t: 'code'; code: string }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' }

const MAX_DEPTH = 8 // quotes and lists inside each other; deeper lines read as paragraphs
const MAX_INLINE_DEPTH = 12 // emphasis and links inside each other; deeper runs read as text
const MAX_LABEL = 1000 // characters in a link's [label]
const MAX_DEST = 2048 // characters in a link's (address), as a link field (core/text.ts)
const MAX_COLUMNS = 30
const BUDGET_PER_CHAR = 16 // look-ahead steps a line may take, per character of it, for links and emphasis together

export const textLines = (s: string) => s.replace(/\r\n?/g, '\n').split('\n')

// ---------- blocks ----------

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const HEADING = /^ {0,3}(#{1,6})(?=[ \t]|$)[ \t]*(.*?)(?:[ \t]+#+)?[ \t]*$/
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?(.*)$/
const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+)(\S.*)$/
const DELIM_CELL = /^:?-+:?$/

/** The text as blocks. */
export function parseText(text: string): Block[] {
  return parseBlocks(textLines(text), 0)
}

function isFence(line: string): RegExpExecArray | null {
  const m = FENCE.exec(line)
  // a ``` fence's info string can't hold a backtick ("```a``` b" is inline code), as CommonMark reads it
  return m && !(m[1][0] === '`' && m[2].includes('`')) ? m : null
}

function parseBlocks(ls: string[], depth: number): Block[] {
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ t: 'p', lines: para.map(l => parseInline(l)) })
    para = []
  }
  for (let i = 0; i < ls.length; ) {
    const line = ls[i]
    let m: RegExpExecArray | null
    if ((m = isFence(line))) {
      flush()
      const ch = m[1][0]
      const len = m[1].length
      const code: string[] = []
      let j = i + 1
      for (; j < ls.length; j++) {
        const c = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(ls[j])
        if (c && c[1][0] === ch && c[1].length >= len) break
        code.push(ls[j])
      }
      out.push({ t: 'code', code: code.join('\n') }) // an unclosed fence runs to the end; the info string is dropped
      i = j + 1
      continue
    }
    if (!line.trim()) {
      flush()
      i++
      continue
    }
    if ((m = HEADING.exec(line)) && m[2]) {
      flush()
      out.push({ t: 'h', level: m[1].length, kids: parseInline(m[2]) })
      i++
      continue
    }
    if (HR.test(line)) {
      flush()
      out.push({ t: 'hr' })
      i++
      continue
    }
    if (depth < MAX_DEPTH && QUOTE.test(line)) {
      flush()
      const inner: string[] = []
      while (i < ls.length && (m = QUOTE.exec(ls[i]))) {
        inner.push(m[1])
        i++
      }
      out.push({ t: 'quote', blocks: parseBlocks(inner, depth + 1) })
      continue
    }
    // a list may follow a paragraph line directly ("steps:\n- one"); a numbered one only when it starts at 1
    if (depth < MAX_DEPTH && (m = LIST.exec(line)) && (!para.length || !/\d/.test(m[2]) || parseInt(m[2], 10) === 1)) {
      flush()
      const r = parseList(ls, i, depth)
      out.push(r.block)
      i = r.next
      continue
    }
    if (line.includes('|') && i + 1 < ls.length) {
      const head = splitRow(line)
      const delim = splitRow(ls[i + 1])
      if (head.length && head.length === delim.length && head.length <= MAX_COLUMNS && delim.every(c => DELIM_CELL.test(c))) {
        flush()
        const align = delim.map((c): Align => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null))
        const rows: Inline[][][] = []
        let j = i + 2
        for (; j < ls.length && ls[j].includes('|') && ls[j].trim(); j++) {
          const cells = splitRow(ls[j]).slice(0, head.length)
          while (cells.length < head.length) cells.push('')
          rows.push(cells.map(c => parseInline(c)))
        }
        out.push({ t: 'table', align, head: head.map(c => parseInline(c)), rows })
        i = j
        continue
      }
    }
    para.push(line)
    i++
  }
  flush()
  return out
}

/** Leading whitespace as columns, a tab as 4. */
function indentOf(line: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === ' ') n++
    else if (ch === '\t') n += 4 - (n % 4)
    else break
  }
  return n
}

/** The line with up to `n` columns of indent taken off. */
function dedent(line: string, n: number): string {
  let cols = 0
  let k = 0
  while (k < line.length && cols < n && (line[k] === ' ' || line[k] === '\t')) {
    cols += line[k] === '\t' ? 4 - (cols % 4) : 1
    k++
  }
  return line.slice(k)
}

function parseList(ls: string[], start: number, depth: number): { block: Block; next: number } {
  const first = LIST.exec(ls[start])!
  const ordered = /\d/.test(first[2])
  const kind = ordered ? first[2].slice(-1) : first[2] // "." or ")", or the bullet: a different one starts a new list
  const items: ListItem[] = []
  let i = start
  while (i < ls.length) {
    const m = HR.test(ls[i]) ? null : LIST.exec(ls[i])
    if (!m || /\d/.test(m[2]) !== ordered || (ordered ? m[2].slice(-1) : m[2]) !== kind) break
    const spaces = m[3].length
    const content = m[1].length + m[2].length + (spaces > 4 ? 1 : spaces)
    // Lines indented at least this far stay in the item. CommonMark asks for the item's content column; two spaces
    // past the marker is enough here, since "1. one\n  - sub" is how people write a nested list.
    const need = Math.min(content, m[1].length + 2)
    const body = [m[4]]
    let blanks = 0
    for (i++; i < ls.length; i++) {
      const l = ls[i]
      if (!l.trim()) {
        blanks++
        continue
      }
      if (indentOf(l) >= need) {
        for (; blanks; blanks--) body.push('')
        body.push(dedent(l, content))
        continue
      }
      if (blanks || LIST.test(l) || HR.test(l) || QUOTE.test(l) || isFence(l) || (HEADING.exec(l)?.[2] ?? '')) break
      body.push(l) // a lazy line: it carries on the item's last paragraph
    }
    const task = /^\[([ xX])\](?:[ \t]+|$)/.exec(body[0])
    if (task) body[0] = body[0].slice(task[0].length)
    items.push({ task: task ? task[1] !== ' ' : null, blocks: parseBlocks(body, depth + 1) })
  }
  return { block: { t: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items }, next: i }
}

/** A table row's cells: split at each "|" that isn't escaped or inside `code`; the outer pipes are optional. */
function splitRow(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  const s = line.trim()
  for (let k = 0; k < s.length; k++) {
    const ch = s[k]
    if (ch === '\\' && s[k + 1] === '|') {
      cell += '|'
      k++
    } else if (ch === '`') {
      const run = runOf(s, k, '`')
      const close = closingTicks(s, k + run, run)
      const end = close < 0 ? k + run : close + run
      cell += s.slice(k, end)
      k = end - 1
    } else if (ch === '|') {
      cells.push(cell)
      cell = ''
    } else cell += ch
  }
  cells.push(cell)
  if (s.startsWith('|')) cells.shift()
  if (s.endsWith('|') && !s.endsWith('\\|') && cells.length) cells.pop()
  return cells.map(c => c.trim())
}

// ---------- inline ----------

const PUNCT = /[!-/:-@[-`{-~]/
const WORD = /[\p{L}\p{N}]/u

const runOf = (s: string, at: number, ch: string) => {
  let k = at
  while (s[k] === ch) k++
  return k - at
}

/** Where a run of exactly `n` backticks starts, from `from` on, or -1. */
function closingTicks(s: string, from: number, n: number): number {
  for (let k = s.indexOf('`', from); k >= 0; k = s.indexOf('`', k)) {
    const run = runOf(s, k, '`')
    if (run === n) return k
    k += run
  }
  return -1
}

/** The web addresses, @names and #tags in a run, by where each starts: they're read whole. */
function wholeTokens(s: string): Map<number, number> {
  const at = new Map<number, number>()
  for (const t of proseTokens(s)) at.set(t.start, t.start + t.text.length)
  return at
}

type Budget = { left: number }
type Scan = { s: string; whole: Map<number, number>; depth: number; marks: boolean; failed: Map<string, number>; budget: Budget; lastClose: number }

/**
 * One line of prose as inline nodes. With `marks: false` only `code` is read (a title: no emphasis, no [links]).
 */
export function parseInline(s: string, depth = 0, marks = true, budget: Budget = { left: BUDGET_PER_CHAR * s.length + 256 }): Inline[] {
  if (depth > MAX_INLINE_DEPTH) return s ? [{ t: 'text', s }] : []
  const sc: Scan = { s, whole: wholeTokens(s), depth, marks, failed: new Map(), budget, lastClose: Math.max(s.lastIndexOf(']'), s.lastIndexOf(')')) }
  const out: Inline[] = []
  let buf = ''
  const push = (n: Inline) => {
    if (buf) out.push({ t: 'text', s: buf })
    buf = ''
    out.push(n)
  }
  for (let i = 0; i < s.length; ) {
    const whole = sc.whole.get(i)
    if (whole !== undefined) {
      push({ t: 'text', s: s.slice(i, whole) }) // its own node, so what follows can't run into it
      i = whole
      continue
    }
    const ch = s[i]
    if (ch === '`') {
      const run = runOf(s, i, '`')
      const close = closingTicks(s, i + run, run)
      if (close >= 0) {
        let code = s.slice(i + run, close)
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1)
        push({ t: 'code', s: code })
        i = close + run
      } else {
        buf += s.slice(i, i + run)
        i += run
      }
      continue
    }
    if (marks) {
      if (ch === '\\' && i + 1 < s.length && PUNCT.test(s[i + 1])) {
        buf += s[i + 1]
        i += 2
        continue
      }
      if (ch === '[' || (ch === '!' && s[i + 1] === '[')) {
        const l = link(sc, ch === '!' ? i + 1 : i)
        if (l) {
          push(l.node)
          i = l.end
          continue
        }
      }
      if (ch === '<') {
        const end = sc.whole.get(i + 1)
        if (end !== undefined && s[end] === '>' && /^https?:/i.test(s.slice(i + 1, end))) {
          push({ t: 'text', s: s.slice(i + 1, end) })
          i = end + 1
          continue
        }
      }
      if (ch === '*' || ch === '_' || ch === '~') {
        const run = runOf(s, i, ch)
        const e = emphasis(sc, i, run, ch)
        if (e) {
          push(e.node)
          i = e.end
          continue
        }
        buf += s.slice(i, i + run)
        i += run
        continue
      }
    }
    buf += ch
    i++
  }
  if (buf) out.push({ t: 'text', s: buf })
  return out
}

/** The next index to look at from `k`, stepping over whole tokens, `code` and escapes. */
function step(sc: Scan, k: number): number {
  const whole = sc.whole.get(k)
  if (whole !== undefined) return whole
  const ch = sc.s[k]
  if (ch === '\\') return k + 2
  if (ch === '`') {
    const run = runOf(sc.s, k, '`')
    const close = closingTicks(sc.s, k + run, run)
    return close < 0 ? k + run : close + run
  }
  return k + 1
}

const KIND = { '*': ['em', 'strong'], _: ['em', 'strong'], '~': [null, 'del'] } as const

/**
 * **strong**, *em*, _em_ and ~~struck~~ opening at `i` (a run of `run` × `ch`). The opener has text right after it;
 * the closer has text right before it; "_" never opens or closes inside a word. A run of three closes strong and em
 * together. A one-character opener skips runs of two, so "*a **b** c*" reads as em around strong.
 */
function emphasis(sc: Scan, i: number, run: number, ch: '*' | '_' | '~'): { node: Inline; end: number } | null {
  const s = sc.s
  const after = s[i + run]
  if (after === undefined || /\s/.test(after)) return null
  if (ch === '_' && i > 0 && WORD.test(s[i - 1])) return null
  for (const width of run >= 2 ? [2, 1] : [1]) {
    const kind = KIND[ch][width - 1]
    if (!kind || (ch === '~' && run !== 2)) continue
    const key = ch + width
    const from = i + width
    if (from >= (sc.failed.get(key) ?? Infinity)) continue
    for (let k = from + 1; k < s.length; ) {
      if (--sc.budget.left < 0) return null
      if (s[k] !== ch || sc.whole.has(k)) {
        k = step(sc, k)
        continue
      }
      const len = runOf(s, k, ch)
      const fits = width === 2 ? len >= 2 : len === 1 || len >= 3
      const before = s[k - 1]
      const next = s[k + len]
      if (fits && !/\s/.test(before) && !(ch === '_' && next !== undefined && WORD.test(next))) {
        const close = k + len - width
        return { node: { t: kind, kids: parseInline(s.slice(from, close), sc.depth + 1, true, sc.budget) }, end: close + width }
      }
      k += len
    }
    sc.failed.set(key, Math.min(sc.failed.get(key) ?? Infinity, from))
  }
  return null
}

const DEST_OK = (d: string) => /^https?:\/\/\S+$/i.test(d) || /^\/(?!\/)[^\s<>"'`\\]*$/.test(d)

/** [label](address "title") at `i` (the "["), or null. The address is http(s) or a path on this site. */
function link(sc: Scan, i: number): { node: Inline; end: number } | null {
  const s = sc.s
  if (i >= sc.lastClose || sc.budget.left < 0) return null // no "]" or ")" after it, or the line's budget is spent
  let nest = 0
  let k = i
  for (; k < s.length && k - i <= MAX_LABEL; ) {
    if (--sc.budget.left < 0) return null
    const ch = s[k]
    if (ch === '[') nest++
    else if (ch === ']' && --nest === 0) break
    k = ch === '\\' || ch === '`' ? step(sc, k) : k + 1
  }
  if (s[k] !== ']' || nest !== 0 || s[k + 1] !== '(') return null
  let j = k + 2
  while (s[j] === ' ') j++
  let dest = ''
  if (s[j] === '<') {
    const close = s.indexOf('>', j)
    if (close < 0 || close - j > MAX_DEST) return null
    dest = s.slice(j + 1, close)
    j = close + 1
  } else {
    let parens = 0
    const begin = j
    for (; j < s.length && j - begin <= MAX_DEST && !/\s/.test(s[j]); j++) {
      if (--sc.budget.left < 0) return null
      if (s[j] === '(') parens++
      else if (s[j] === ')' && --parens < 0) break
    }
    dest = s.slice(begin, j)
  }
  const title = /^\s+(?:"[^"]*"|'[^']*')/.exec(s.slice(j, j + MAX_LABEL))
  if (title) j += title[0].length
  while (s[j] === ' ') j++
  if (s[j] !== ')' || !DEST_OK(dest)) return null
  return { node: { t: 'link', href: dest, kids: parseInline(s.slice(i + 1, k), sc.depth + 1, true, sc.budget) }, end: j + 1 }
}

// ---------- reading it back ----------

/** Every inline run in the blocks, in order. */
function* inlinesOf(bs: Block[]): Generator<Inline[]> {
  for (const b of bs) {
    if (b.t === 'p') yield* b.lines
    else if (b.t === 'h') yield b.kids
    else if (b.t === 'quote') yield* inlinesOf(b.blocks)
    else if (b.t === 'list') for (const it of b.items) yield* inlinesOf(it.blocks)
    else if (b.t === 'table') {
      yield* b.head
      for (const r of b.rows) yield* r
    }
  }
}

/** The prose runs the renderer links in: text nodes, but not code and not inside a link's label. */
function* linkedText(ns: Inline[]): Generator<string> {
  for (const n of ns) {
    if (n.t === 'text') yield n.s
    else if (n.t === 'strong' || n.t === 'em' || n.t === 'del') yield* linkedText(n.kids)
  }
}

/**
 * Names mentioned in a post, in order, without repeats: the same ones the renderer links, so names in code, inside a
 * web address or inside a link's label don't notify. "thanks @myra/m-07." → ['@myra/m-07']; "a@b_c" → [].
 */
export function extractMentions(text: string): string[] {
  const out: string[] = []
  for (const run of inlinesOf(parseText(text)))
    for (const s of linkedText(run))
      for (const t of proseTokens(s)) if (t.kind === 'mention' && !out.includes(t.text)) out.push(t.text)
  return out
}

const inlineText = (ns: Inline[]): string => ns.map(n => (n.t === 'text' || n.t === 'code' ? n.s : inlineText(n.kids))).join('')

/** A link label's words, for the renderer's "does the label already name the host" test. */
export const labelText = inlineText

/**
 * The text without its block marks, for one-line cuts (a feed card's pitch): no #, >, list markers, fences, rules or
 * table delimiter rows; a table row's cells joined with " · ". Inline marks stay, for <Text inline>.
 */
export function blockless(text: string): string {
  const out: string[] = []
  for (const line of textLines(text)) {
    if (isFence(line) || HR.test(line) || /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line)) continue
    let l = line.replace(/^ {0,3}(?:>[ \t]?)+/, '')
    const h = HEADING.exec(l)
    if (h?.[2]) l = h[2]
    l = l.replace(/^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '')
    if (l.includes('|') && /^\s*\|.*\|\s*$/.test(l)) l = splitRow(l).filter(Boolean).join(' · ')
    out.push(l)
  }
  return out.join('\n')
}

/** Plain text with no marks at all, for a page's description and its link preview. */
export const plainOf = (text: string): string =>
  textLines(blockless(text))
    .map(l => inlineText(parseInline(l)))
    .join('\n')
