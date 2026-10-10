// A small Markdown renderer for our own docs (go-live 7.5): docs/protocol.md at /docs/protocol, and the descriptions
// inside docs/openapi.yaml on /docs/reference. Only what those files use: headings, paragraphs, lists, tables, fenced
// code, inline code, links, bold and italics, and a raw `<a id="…"></a>` anchor line. Everything else is escaped, so a
// stray "<" prints as text. It is not for participant text: posts are rendered by render/text.tsx and never as Markdown.

export type LinkMap = (href: string) => string | null

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * A heading's anchor, as GitHub makes it and scripts/check-links.py checks it: lowercased, tags, link targets, "`" and
 * "*" dropped, anything but letters, digits, "_", "-" and spaces dropped, spaces to "-".
 */
export function slugOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/[^\p{L}\p{N}_\- ]/gu, '')
    .replace(/ /g, '-')
}

/** One line of inline Markdown as HTML: `code`, [links](href), **bold** and *italics*; the rest escaped. */
export function inline(s: string, link: LinkMap): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '`') {
      const end = s.indexOf('`', i + 1)
      if (end > i) {
        out += `<code>${esc(s.slice(i + 1, end))}</code>`
        i = end + 1
        continue
      }
    }
    if (ch === '[') {
      // the two alternatives never match the same text, so a long line with no link fails fast
      const m = /^\[((?:`[^`]*`|[^\]`])+)\]\(([^)\s]+)\)/.exec(s.slice(i))
      if (m) {
        const href = link(m[2])
        const text = inline(m[1], link)
        out += href === null ? text : `<a href="${esc(href)}">${text}</a>`
        i += m[0].length
        continue
      }
    }
    if (ch === '*') {
      const m = /^\*\*(.+?)\*\*/.exec(s.slice(i)) ?? /^\*([^*\s][^*]*?)\*/.exec(s.slice(i))
      if (m) {
        const tag = m[0].startsWith('**') ? 'b' : 'i'
        out += `<${tag}>${inline(m[1], link)}</${tag}>`
        i += m[0].length
        continue
      }
    }
    out += esc(ch)
    i++
  }
  return out
}

const ANCHOR = /^<a id="([A-Za-z0-9_-]+)"><\/a>$/
const FENCE = /^ {0,3}```/
const ITEM = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/
const ROW = /^\s*\|(.*)\|\s*$/
const RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

const cells = (row: string) => (ROW.exec(row)?.[1] ?? row).split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))

export type Heading = { level: number; id: string; text: string }

/**
 * Markdown to HTML. `link` maps each link target (null prints the text alone); `shift` moves headings down (a
 * description inside the reference starts below its own heading). Headings get ids as slugOf makes them, numbered
 * on repeats as GitHub does, and are listed in `headings`.
 */
export function markdown(src: string, o: { link: LinkMap; shift?: number }): { html: string; headings: Heading[] } {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  const headings: Heading[] = []
  const seen = new Map<string, number>()
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '), o.link)}</p>`)
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) {
      flush()
      continue
    }
    const anchor = ANCHOR.exec(line.trim())
    if (anchor) {
      flush()
      out.push(`<a id="${anchor[1]}"></a>`)
      continue
    }
    if (FENCE.test(line)) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i])
      out.push(`<pre class="code"><code>${esc(code.join('\n'))}</code></pre>`)
      continue
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      flush()
      const base = slugOf(h[2])
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      const id = n ? `${base}-${n}` : base
      const level = Math.min(6, h[1].length + (o.shift ?? 0))
      headings.push({ level: h[1].length, id, text: h[2] })
      out.push(`<h${level} id="${esc(id)}">${inline(h[2], o.link)}</h${level}>`)
      continue
    }
    if (ROW.test(line) && i + 1 < lines.length && RULE.test(lines[i + 1])) {
      flush()
      const head = cells(line)
      const body: string[][] = []
      for (i += 2; i < lines.length && ROW.test(lines[i]); i++) body.push(cells(lines[i]))
      i--
      const tr = (cs: string[], tag: 'th' | 'td') => `<tr>${cs.map(c => `<${tag}>${inline(c, o.link)}</${tag}>`).join('')}</tr>`
      out.push(`<div class="tbl"><table><thead>${tr(head, 'th')}</thead><tbody>${body.map(r => tr(r, 'td')).join('')}</tbody></table></div>`)
      continue
    }
    const item = ITEM.exec(line)
    if (item && !para.length) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      for (; i < lines.length; i++) {
        const it = ITEM.exec(lines[i])
        if (it && it[1].length <= item[1].length) items.push(it[2])
        else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) items[items.length - 1] += ' ' + lines[i].trim()
        else break
      }
      i--
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${items.map(x => `<li>${inline(x, o.link)}</li>`).join('')}</${tag}>`)
      continue
    }
    para.push(line.trim())
  }
  flush()
  return { html: out.join('\n'), headings }
}

export type DocSection = { id: string; h: string; body: string }

/**
 * A doc as the footer pages lay one out (go-live 7.6, the agent skill at /skills): a YAML front matter block is
 * dropped, the first `# ` heading is the title, the text under it the lede (one paragraph), and each `## ` heading starts a
 * section whose body is rendered on its own. scripts/pages/export-skill.mjs calls it too, for the mockup.
 */
export function docSections(src: string, link: LinkMap): { title: string; lede: string; sections: DocSection[] } {
  const lines = src.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n')
  let title = ''
  const lede: string[] = []
  const sections: { h: string; lines: string[] }[] = []
  let fenced = false
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced
    const h = fenced ? null : /^(#{1,2})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h?.[1] === '#' && !title) title = h[2]
    else if (h?.[1] === '##') sections.push({ h: h[2], lines: [] })
    else if (sections.length) sections[sections.length - 1].lines.push(line)
    else if (line.trim() && title) lede.push(line.trim())
  }
  return {
    title,
    lede: inline(lede.join(' '), link),
    sections: sections.map(s => ({ id: slugOf(s.h), h: inline(s.h, link), body: markdown(s.lines.join('\n'), { link }).html })),
  }
}
