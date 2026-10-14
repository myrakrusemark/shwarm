import { raw } from 'hono/html'
import type { FC } from 'hono/jsx'
import pages from '../content/pages.json'
import { currentLang, w } from '../words'
import { translations } from '../words/translations'
import { AgentResources, Layout } from './layout'

// Footer pages and guides. Text comes from scripts/pages/content.py via export-site.py; it's our own trusted copy.
// `intro` is a figure whose text bits are {{tN}}, filled from `introText` (or its translation).
type Page = { slug: string; title: string; lede: string; intro?: string; introText?: string[]; sections: { id: string; h: string; body: string }[] }
export const PAGES = pages as Page[]
export const findPage = (slug: string) => PAGES.find(p => p.slug === slug)

/**
 * A page in a language: each part's translation from translations/<code>.json, keyed doc.<slug>.title, .lede,
 * .intro.<n>, .<section>.h and .<section>.body (the localize tool edits them beside the site's words), English for any
 * part a language lacks. Translations are of our own copy and checked for the English's links, code and tags
 * (test/doc-translations.test.ts), so they're as trusted as the English.
 */
export function pageIn(p: Page, lang: string): Page {
  const t = translations[lang]
  const tr = (key: string, en: string) => t?.[`doc.${p.slug}.${key}`]?.text || en
  const bits = (p.introText ?? []).map((en, i) => tr(`intro.${i}`, en))
  return {
    ...p,
    title: tr('title', p.title),
    lede: tr('lede', p.lede),
    intro: p.intro?.replace(/\{\{t(\d+)\}\}/g, (_, i) => bits[Number(i)] ?? ''),
    sections: p.sections.map(s => ({ ...s, h: tr(`${s.id}.h`, s.h), body: tr(`${s.id}.body`, s.body) })),
  }
}

/** Pages whose English is the one that counts: a translation says so at the top (decided Oct 14). */
const BINDING = new Set(['terms', 'privacy'])

// The API docs (/openapi.yaml, /docs/…) are served only where the reading pages are (web/api-docs.tsx). Where they
// aren't, a row linking one goes back to how the api page had it before go-live 7.5: no link, "not built yet".
// OPEN (#96): the docs stay unpublished on production while it holds, until Myra approves the v0 freeze and the words.
const DOC_ROW = /<li><a href="\/(?:openapi\.yaml|docs\/[^"]*)">(.*?)<\/li>/g
const unlinkDocs = (html: string) => html.replace(DOC_ROW, '<li><a href="#">$1 · <span class="soon">not built yet</span></li>')

/** The page as shown: where the API docs aren't served, its rows linking them say "not built yet". */
export const pageShown = (p: Page, docs: boolean): Page => (docs ? p : { ...p, sections: p.sections.map(s => ({ ...s, body: unlinkDocs(s.body) })) })

/** A footer page or guide; `docs` false where the API docs aren't served. */
export const DocPage: FC<{ page: Page; docs?: boolean }> = ({ page: p, docs = true }) => {
  const lang = currentLang()
  const page = pageShown(pageIn(p, lang), docs)
  return (
  <Layout title={`${page.title} · shwarm`} description={page.lede.replace(/<[^>]+>/g, '').slice(0, 200)} canonical={`/${page.slug}`}>
    <div class="dochead"><h1>{page.title}</h1><p>{raw(page.lede)}</p></div>
    <div class="doc">
      <article id="main" tabindex={-1}>
        {lang !== 'en' && BINDING.has(page.slug) && <p class="note">{w.chrome.translationNote}</p>}
        {page.intro && <div class="intro">{raw(page.intro)}</div>}
        {page.sections.map(s => (
          <section id={s.id}><h2>{raw(s.h)}</h2><div class="body">{raw(s.body)}</div></section>
        ))}
      </article>
      <aside class="toc">
        <div class="box"><h2>{w.chrome.onThisPage}</h2><ol>{page.sections.map(s => <li><a href={`#${s.id}`}>{raw(s.h)}</a></li>)}</ol></div>
        <AgentResources current={`/${page.slug}`} />
      </aside>
    </div>
  </Layout>
  )
}
