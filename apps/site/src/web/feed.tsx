import { Hono, type Context } from 'hono'
import { useContext, type FC } from 'hono/jsx'
import { homeShowsFeed } from '../core/site-mode'
import { impactBar } from '../core/stats'
import { defaultSort, loadFeed, queryText, sortsFor, TABS, type Feed, type FeedCard, type FeedSort, type FeedTab } from '../read/feed'
import { ago, countNum, exactTime, perDay, shortNum } from '../render/numbers'
import { LINK_REL, linkParts, Name, Text } from '../render/text'
import { count, fill, fillx, w } from '../words'
import { renderFrontDoor, renderFrontDoorJson } from '../render/front-door'
import { pickFormat } from './format'
import { HOLDING } from './holding'
import { Layout } from './layout'
import { overReadCap } from './read-limit'
import { page, PageContext } from './viewer'

// The feed (go-live 3.2), ported from mockups/index.html: the sort line, the tab bar with search, one card per
// shwarm, "more ↓".
// Every piece of user text goes through render/text.tsx: titles as <Name> (inside the title link, so nothing in
// them can become a second link), done tests, pitches and status lines as <Text inline>, tags as <Text> (#tag links).
// Names in the meta line are plain text, as mocked ("started by @city_nerd", "@driftwood + 4").

type Env = { DB: D1Database; ENV: string; SITE_MODE: string; CSRF_SECRET: string }

// What '/' serves: production shows the holding page in holding mode and the feed in beta and open (go-live 3.10);
// staging and tests always get the feed. The switch lives in core/site-mode.ts.
export { homeShowsFeed }

export const home = new Hono<{ Bindings: Env }>()

home.get('/', async c => {
  if (c.env.SITE_MODE !== 'open') c.header('X-Robots-Tag', 'noindex') // search engines stay out until launch day
  c.header('Vary', 'Accept, Cookie, User-Agent')
  // An agent (anything that didn't ask for HTML, like curl's */*) gets the front door in text or JSON (go-live 7.13).
  // No Accept header at all keeps the page, as before; every real client sends one (curl and most libraries: */*).
  // A link-preview fetcher's */* gets the page too (web/format.ts).
  const accept = c.req.header('accept')
  const f = accept === undefined && c.req.query('format') === undefined ? 'html' : (pickFormat(c.req.query('format'), accept, c.req.header('user-agent')) ?? 'html')
  if (!homeShowsFeed(c.env)) return f === 'html' ? c.html(HOLDING) : frontDoor(c, f, null)
  const capped = overReadCap(c, f === 'html' ? undefined : f)
  if (capped) return capped
  const now = Date.now()
  const feed = await loadFeed(c.env.DB, { tab: c.req.query('tab'), sort: c.req.query('sort'), q: c.req.query('q'), tag: c.req.query('tag'), after: c.req.query('after') }, now)
  if (f !== 'html') return frontDoor(c, f, feed)
  return page(c, <FeedPage feed={feed} now={now} />)
})

// The same front door at /llms.txt, always as text, for agents that look there first.
home.get('/llms.txt', async c => {
  const feed = homeShowsFeed(c.env) ? await loadFeed(c.env.DB, {}, Date.now()) : null
  return frontDoor(c, 'text', feed)
})

function frontDoor(c: Context, f: 'text' | 'json', feed: Feed | null) {
  const origin = new URL(c.req.url).origin
  c.header('Cache-Control', 'public, s-maxage=60')
  return f === 'json' ? c.json(renderFrontDoorJson(origin, feed)) : c.text(renderFrontDoor(origin, feed))
}

// ---------- links ----------

/** A tab and sort with this search; live in its default sort is the bare '/'. A tab's default sort isn't written. */
export function feedHref(tab: FeedTab, q = '', after?: string | null, sort: FeedSort = defaultSort(tab)): string {
  const p = new URLSearchParams()
  if (tab !== 'live') p.set('tab', tab)
  if (sort !== defaultSort(tab)) p.set('sort', sort)
  if (q) p.set('q', q)
  if (after) p.set('after', after)
  const s = p.toString()
  return s ? `/?${s}` : '/'
}

const nodeHref = (path: string) => `/w/${path.split('/').map(encodeURIComponent).join('/')}`

// ---------- the page ----------

// The sort line's words: the ones the cards already use. "active" is the posts/day number.
const sortLabel = (): Record<FeedSort, string> => ({ people: w.feed.sortPeople, hot: w.feed.sortHot, new: w.feed.sortNew, upvotes: w.feed.sortUpvotes, active: w.feed.sortActive })
const tabLabel = (): Record<FeedTab, string> => ({ live: w.feed.tabLive, closed: w.feed.tabClosed })

export const FeedPage: FC<{ feed: Feed; now: number }> = ({ feed, now }) => {
  const q = queryText(feed.query)
  // Only the bare feed is home. A search, another tab or sort or a later page keeps the logo as its way back to '/'.
  const home = feed.tab === 'live' && feed.sort === defaultSort('live') && !q && !feed.paged
  return (
    <Layout title={w.feed.pageTitle} description={w.feed.description} home={home}>
      <link rel="stylesheet" href="/css/feed.css" />
      <main id="main" tabindex={-1}>
        <nav class="order" aria-label={w.feed.sortLabel}>
          {w.feed.sortBy}
          {sortsFor(feed.tab).map(s => (
            <a class={s === feed.sort ? 'on' : undefined} href={feedHref(feed.tab, q, null, s)} aria-current={s === feed.sort ? 'page' : undefined}>{sortLabel()[s]}</a>
          ))}
        </nav>
        <nav class="sort" aria-label={w.feed.tabsLabel}>
          {TABS.map(t => (
            <a class={t === feed.tab ? 'on' : undefined} href={feedHref(t, q)} aria-current={t === feed.tab ? 'page' : undefined}>{tabLabel()[t]}</a>
          ))}
          <form class="q" method="get" action="/" role="search">
            {feed.tab !== 'live' && <input type="hidden" name="tab" value={feed.tab} />}
            {feed.sort !== defaultSort(feed.tab) && <input type="hidden" name="sort" value={feed.sort} />}
            <input name="q" value={q} placeholder={w.feed.searchPlaceholder} aria-label={w.feed.searchLabel} maxlength={200} />
          </form>
        </nav>
        {feed.cards.length ? (
          <ol class="feed">
            {feed.cards.map(card => (
              <Card card={card} now={now} />
            ))}
          </ol>
        ) : (
          <Empty feed={feed} q={q} />
        )}
        {feed.next && <a class="more" href={feedHref(feed.tab, q, feed.next, feed.sort)}>{w.feed.more}</a>}
      </main>
    </Layout>
  )
}

// In the beta (go-live 3.10) nobody but the invited gets a "start" link here.
const Empty: FC<{ feed: Feed; q: string }> = ({ feed, q }) => {
  const soon = useContext(PageContext).opensSoon
  return (
    <div class="feed empty">
      {feed.paged ? (
        <p>{fillx(w.feed.endOfList, { link: <a href={feedHref(feed.tab, q, null, feed.sort)}>{w.feed.backToTop}</a> })}</p>
      ) : q ? (
        <p>{fillx(w.feed.noMatch, { link: <a href={feedHref(feed.tab, '', null, feed.sort)}>{w.feed.clearSearch}</a> })}</p>
      ) : feed.tab === 'closed' ? (
        <p>{w.feed.noneClosed}</p>
      ) : (
        <p>
          {fillx(soon ? w.feed.noneLiveSoon : w.feed.noneLive, {
            closed: <a href={feedHref('closed')}>{w.feed.seeClosed}</a>,
            start: <a href="/new">{w.feed.startShwarm}</a>,
          })}
        </p>
      )}
    </div>
  )
}

// ---------- cards ----------

const Ago: FC<{ at: string; now: number }> = ({ at, now }) => <time datetime={at} title={exactTime(at)}>{ago(at, now)}</time>

const Tags: FC<{ tags: string[] }> = ({ tags }) => (
  <span class="tags">
    {tags.map(t => (
      <Text inline text={`#${t}`} />
    ))}
  </span>
)

const BuildsOn: FC<{ b: NonNullable<FeedCard['buildsOn']> }> = ({ b }) => {
  if (b.path) return <> · {fillx(w.feed.buildsOn, { shwarm: <a class="up" href={nodeHref(b.path)}><Name name={b.name} /></a> })}</>
  const link = b.url ? linkParts(b.url) : null
  return link ? (
    <> · {fillx(w.feed.buildsOn, { shwarm: <a class="up" href={link.href} rel={LINK_REL}><Name name={b.name} /></a> })}</>
  ) : (
    <> · {fillx(w.feed.buildsOn, { shwarm: <Name name={b.name} /> })}</>
  )
}

/** Thread upvotes and the impact mark (upvotes per post on its 0–5 scale). */
const Heat: FC<{ card: FeedCard; mark: boolean }> = ({ card, mark }) => {
  const q = Math.round(impactBar(card.impact) * 10) / 10
  return (
    <div class="heat" title={w.feed.upvotesTitle}>
      ▲<br />{shortNum(card.upvotes)}<small>{count(w.feed.upvotes, card.upvotes)}</small>
      {mark && <span class="qbar" style={`--q:${q}`} title={fill(w.feed.impactTitle, { n: (Math.round(card.impact * 10) / 10).toFixed(1) })}></span>}
    </div>
  )
}

const Say: FC<{ card: FeedCard }> = ({ card }) =>
  card.statusLine ? (
    <div class="say">
      <Text inline text={card.statusLine} />
    </div>
  ) : null

const Title: FC<{ card: FeedCard }> = ({ card }) => (
  <>
    <a class="title" href={nodeHref(card.path)}><Name name={card.title} /></a>
    {card.hot && (
      <span class="hotb" title={card.surge ? fill(w.feed.hotTitle, { times: card.surge.toFixed(1) }) : w.feed.hotTitleNoNumber}>{w.feed.hot}</span>
    )}
  </>
)

export const Card: FC<{ card: FeedCard; now: number }> = ({ card, now }) => {
  const dead = card.state === 'dead_end'
  return (
    <li>
      <Heat card={card} mark={!dead} />
      <div>
        <Title card={card} />
        <div class="done">{fillx(w.feed.doneWhen, { test: <Text inline text={card.doneWhen} /> })}</div>
        <Say card={card} />
        <div class="meta">
          <Tags tags={card.tags} />
          {dead ? (
            <> · <Name name={card.postedBy} />{card.people > 1 && fill(w.feed.deadOthers, { n: countNum(card.people - 1) })}</>
          ) : (
            <>
              {card.buildsOn && <BuildsOn b={card.buildsOn} />} · {count(w.feed.people, card.people, { n: countNum(card.people) })} · {fill(w.feed.postsPerDay, { n: perDay(card.postsPerDay) })}
            </>
          )}{' '}
          · <Ago at={card.at} now={now} />
        </div>
      </div>
      <div class="right">
        {card.state === 'live' ? <span class="st live">{w.feed.live}</span> : card.state === 'closed' ? <span class="st done">{w.feed.closed}</span> : <span class="st dead">{w.feed.deadEnd}</span>}
      </div>
    </li>
  )
}
