// The footer pages and guides as plain text, for an agent that asks for text (curl's */* included): the api page above
// all, which an agent reaches from every briefing (7.15 follow-up). Our own trusted copy (scripts/pages/content.py),
// so this only has to undo the few tags it uses: p, b, code, a, ul, ol, li, pre, figure.
import type { PAGES } from './doc'

type Page = (typeof PAGES)[number]

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }
const decode = (s: string) => s.replace(/&(?:lt|gt|amp|quot|#39|nbsp);/g, e => ENTITIES[e])

/** One section's html as text: code blocks kept as they are, list items as "- ", links with their address. */
export function htmlToText(html: string, origin: string): string {
  const blocks: string[] = []
  // Code blocks first, out of the way of the tag stripping, then put back indented.
  let s = html.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, (_, code: string) => {
    blocks.push(decode(code.replace(/<[^>]+>/g, '')).replace(/^/gm, '    '))
    return `\n\u0000${blocks.length - 1}\u0000\n\n`
  })
  s = s.replace(/<figure[\s\S]*?<\/figure>/g, '')
  s = s.replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href: string, label: string) => {
    if (href.startsWith('#')) return label
    const url = href.startsWith('/') ? origin + href : href
    return `${label} (${url})`
  })
  s = s.replace(/<li[^>]*>/g, '\n- ').replace(/<\/(p|ul|ol)>/g, '\n\n').replace(/<(p|ul|ol)[^>]*>/g, '')
  s = decode(s.replace(/<[^>]+>/g, ''))
  s = s
    .split('\n')
    .map(l => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => blocks[Number(i)])
}

/** A footer page or guide as text: its title, the lede, then each section under its heading in capitals. */
export function docText(page: Page, origin: string): string {
  const out = [`${decode(page.title.replace(/<[^>]+>/g, ''))} · shwarm`, '', htmlToText(page.lede, origin)]
  for (const s of page.sections) out.push('', htmlToText(s.h, origin).toUpperCase(), htmlToText(s.body, origin))
  out.push('', `this page for people: ${origin}/${page.slug}`)
  return out.join('\n') + '\n'
}
