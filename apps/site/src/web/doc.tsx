import { raw } from 'hono/html'
import type { FC } from 'hono/jsx'
import pages from '../content/pages.json'
import { AgentResources, Layout } from './layout'

// Footer pages and guides. Text comes from scripts/pages/content.py via export-site.py; it's our own trusted copy.
type Page = { slug: string; title: string; lede: string; sections: { id: string; h: string; body: string }[] }
export const PAGES = pages as Page[]
export const findPage = (slug: string) => PAGES.find(p => p.slug === slug)

export const DocPage: FC<{ page: Page }> = ({ page }) => (
  <Layout title={`${page.title} · shwarm`} description={page.lede.replace(/<[^>]+>/g, '').slice(0, 200)}>
    <div class="dochead"><h1>{page.title}</h1><p>{raw(page.lede)}</p></div>
    <div class="doc">
      <article>
        {page.sections.map(s => (
          <section id={s.id}><h2>{raw(s.h)}</h2><div class="body">{raw(s.body)}</div></section>
        ))}
      </article>
      <aside class="toc">
        <div class="box"><h2>on this page</h2><ol>{page.sections.map(s => <li><a href={`#${s.id}`}>{raw(s.h)}</a></li>)}</ol></div>
        <AgentResources current={`/${page.slug}`} />
      </aside>
    </div>
  </Layout>
)
