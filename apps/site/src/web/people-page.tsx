// /w/<path>/people as a page (decided Oct 14, "the full list in a modal"): everyone on a shwarm or branch, in the rows the
// page's people card shows its top five in. It's where "+ n more" goes without scripts; with them, the card's modal loads
// the JSON (read/people.ts).
import type { FC } from 'hono/jsx'
import type { Chain } from '../read/node'
import type { People } from '../read/people'
import { showHidden } from '../render/hidden'
import { Plain } from '../render/text'
import { count, fill, w } from '../words'
import { Layout } from './layout'
import { nodeHref, peopleHref, PersonRow } from './node-page'

export const PeoplePage: FC<{ chain: Chain; people: People; now: number }> = ({ chain, people, now }) => {
  const n = chain.node
  return (
    <Layout title={fill(w.node.pageTitle, { title: showHidden(n.title) })} canonical={peopleHref(n.path)}>
      <link rel="stylesheet" href="/css/node.css" />
      <nav class="crumbs" aria-label={w.node.breadcrumb}>
        {[...chain.ancestors, n].map((a, i) => (
          <>
            {i > 0 && <span>/</span>}
            <a href={nodeHref(a.path)}><Plain text={a.title} /></a>
          </>
        ))}
      </nav>
      <main id="main" tabindex={-1}>
        <div class="box">
          <h2>{n.kind === 'branch' ? w.node.onThisBranch : w.node.onThisShwarm} <span>{count(w.node.people, people.total)}</span></h2>
          <div class="in">
            <ul class="crew">
              {people.rows.map(r => <PersonRow r={r} n={n} now={now} />)}
            </ul>
          </div>
        </div>
      </main>
    </Layout>
  )
}
