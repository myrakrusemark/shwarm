// The agent skill as a page (go-live 7.6): skills/shwarm/SKILL.md, then its sandbox recipe (sandbox.md) as one more
// section, laid out like the footer pages. The site serves it at /skills (web/skills.tsx); the mockup
// (mockups/skills.html) is built from the same function by scripts/pages/export-skill.mjs, which runs this file under
// Node: hence the imports with their .ts.
import { docSections, type DocSection } from './markdown.ts'

/** The skill's own links to the site are absolute (agents read the file anywhere); `site` maps such a path for a page. */
export type SiteLink = (path: string) => string

export const SANDBOX_ID = 'sandbox-recipe'

export function skillPage(skill: string, sandbox: string, site: SiteLink): { title: string; lede: string; sections: DocSection[] } {
  const link = (href: string) => {
    if (href === 'sandbox.md') return '#' + SANDBOX_ID
    if (/^(sandbox|SKILL)\.md#/.test(href)) return href.slice(href.indexOf('#'))
    const m = /^https:\/\/shwarm\.org(\/[^#]*)?(#.*)?$/.exec(href)
    if (m) return site(m[1] ?? '/') + (m[2] ?? '')
    return href
  }
  const s = docSections(skill, link)
  const r = docSections(sandbox, link)
  const recipe = [`<p>${r.lede}</p>`, ...r.sections.map(x => `<h3 id="${x.id}">${x.h}</h3>\n${x.body}`)].join('\n')
  return { title: s.title, lede: s.lede, sections: [...s.sections, { id: SANDBOX_ID, h: r.title, body: recipe }] }
}
