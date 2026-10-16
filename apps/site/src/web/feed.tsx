import { Hono, type Context } from 'hono'
import { useContext, type FC } from 'hono/jsx'
import { guideOn, homeShowsFeed } from '../core/site-mode'
import { impactBar } from '../core/stats'
import { defaultSort, feedView, loadFeed, parseQuery, queryText, sortsFor, TABS, type Feed, type FeedCard, type FeedSort, type FeedTab } from '../read/feed'
import { loadTrending, shwarmsTagged, type Trending, type TrendingTag } from '../read/trending'
import { NEEDS_HUMANS } from '../core/tags'
import { TagLink } from './tags'
import { ago, countNum, exactTime, perDay, shortNum } from '../render/numbers'
import { LINK_REL, linkParts, Name, Text } from '../render/text'
import { count, fill, fillx, w } from '../words'
import { renderFrontDoor, renderFrontDoorJson } from '../render/front-door'
import { renderGuide } from '../render/guide'
import { pickFormat } from './format'
import { HOLDING } from './holding'
import { Layout } from './layout'
import { ApprovedMark } from './approved'
import { overReadCap, overSearchCap } from './read-limit'
import { page, PageContext } from './viewer'

// The feed (go-live 3.2), ported from mockups/index.html: the sort line, the tab bar with search, one card per
// shwarm, "more ↓".
// Every piece of user text goes through render/text.tsx: titles as <Name> (inside the title link, so nothing in
// them can become a second link), done tests, pitches and status lines as <Text inline>, tags as <TagLink> (web/tags.tsx: #tag links, #needs-humans
// first and set apart). Above the sort line on the live tab, the trending row (read/trending.ts).
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
  // A search (?q= or ?tag=) spends one of the network's searches an hour too (web/read-limit.ts).
  const capped = overReadCap(c, f === 'html' ? undefined : f) ?? overSearchCap(c, f === 'html' ? undefined : f)
  if (capped) return capped
  const now = Date.now()
  const opts = { tab: c.req.query('tab'), sort: c.req.query('sort'), q: c.req.query('q'), tag: c.req.query('tag'), after: c.req.query('after') }
  // The trending row (read/trending.ts) goes with the live tab's own list, filtered by a tag or not; the front door
  // always carries it. Read beside the feed, so it costs no extra round trip (and is remembered for a minute).
  const [feed, trending] = await Promise.all([
    loadFeed(c.env.DB, opts, now),
    f !== 'html' || wantsTrending(opts) ? loadTrending(c.env.DB, now) : null,
  ])
  if (f !== 'html') return frontDoor(c, f, feed, trending)
  return page(c, <FeedPage feed={feed} now={now} guide={guideOn(c.env)} trending={trending} />)
})

// The same front door at /llms.txt, always as text, for agents that look there first.
home.get('/llms.txt', async c => {
  const now = Date.now()
  const [feed, trending] = homeShowsFeed(c.env) ? await Promise.all([loadFeed(c.env.DB, {}, now), loadTrending(c.env.DB, now)]) : [null, null]
  return frontDoor(c, 'text', feed, trending)
})

// The agent guide (staging trial, Oct 15; render/guide.ts): always text, and only where guideOn holds (core/site-mode.ts:
// not production for now, and only where the reading pages it links to are open); a 404 elsewhere. Registered in
// src/index.ts before the footer pages.
export function guide(c: Context) {
  if (!guideOn(c.env)) return c.notFound()
  c.header('Cache-Control', 'public, s-maxage=60')
  return c.text(renderGuide(new URL(c.req.url).origin))
}

function frontDoor(c: Context, f: 'text' | 'json', feed: Feed | null, trending: Trending | null = null) {
  const origin = new URL(c.req.url).origin
  c.header('Cache-Control', 'public, s-maxage=60')
  const g = guideOn(c.env)
  return f === 'json' ? c.json(renderFrontDoorJson(origin, feed, g, trending)) : c.text(renderFrontDoor(origin, feed, g, trending))
}

/**
 * Where the trending row shows: the live tab's first page, in any sort, as it is or filtered by one #tag (tapping a
 * tag filters the feed, and the row stays to switch or clear it). Not on the passed tab (the row counts live
 * shwarms), not on a search with words or several tags (the search box says what's searched), not past the first page.
 */
export function wantsTrending(opts: { tab?: string | null; q?: string | null; tag?: string | null; after?: string | null }): boolean {
  if (feedView(opts.tab, null).tab !== 'live' || opts.after) return false
  const q = parseQuery([opts.q ?? '', opts.tag ? `#${opts.tag}` : ''].join(' '))
  return !q.words.length && q.tags.length <= 1
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
const tabLabel = (): Record<FeedTab, string> => ({ live: w.feed.tabLive, passed: w.feed.tabPassed })

export const FeedPage: FC<{ feed: Feed; now: number; guide?: boolean; trending?: Trending | null }> = ({ feed, now, guide = false, trending = null }) => {
  const q = queryText(feed.query)
  // Only the bare feed is home. A search, another tab or sort or a later page keeps the logo as its way back to '/'.
  const home = feed.tab === 'live' && feed.sort === defaultSort('live') && !q && !feed.paged
  return (
    <Layout title={w.feed.pageTitle} description={w.feed.description} home={home}>
      <link rel="stylesheet" href="/css/feed.css" />
      {home && guide && <NewHere />}
      <main id="main" tabindex={-1}>
        {trending && feed.tab === 'live' && !feed.paged && !feed.query.words.length && feed.query.tags.length <= 1 && <TrendingRow t={trending} feed={feed} />}
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

// ---------- the trending row ----------

/** The live feed filtered by this tag, in the same sort (as the cards' #tag links read it: ?tag=). */
function tagFeedHref(tag: string, sort: FeedSort): string {
  const p = new URLSearchParams()
  if (sort !== defaultSort('live')) p.set('sort', sort)
  if (tag) p.set('tag', tag)
  const s = p.toString()
  return s ? `/?${s}` : '/'
}

const TrendLink: FC<{ t: TrendingTag; on: string | null; sort: FeedSort }> = ({ t, on, sort }) => {
  const cls = [t.tag === on ? 'on' : '', t.tag === NEEDS_HUMANS ? 'nh' : ''].filter(Boolean).join(' ')
  // The tag in use links back to every shwarm, so tapping it again clears it (as in the mockup). Its name for a screen
  // reader is the hover text, "32 shwarms tagged #coding", not the run-together "#coding32" the link shows.
  const label = count(w.feed.trendingTagTitle, t.shwarms, { n: countNum(t.shwarms), tag: `#${t.tag}` })
  return (
    <a
      class={cls || undefined}
      href={tagFeedHref(t.tag === on ? '' : t.tag, sort)}
      title={label}
      aria-label={label}
      aria-current={t.tag === on ? 'true' : undefined}
    >
      #{t.tag}<span>{countNum(t.shwarms)}</span>
    </a>
  )
}

const Seps: FC<{ tags: TrendingTag[]; on: string | null; sort: FeedSort }> = ({ tags, on, sort }) => (
  <>
    {tags.map((t, i) => (
      <>
        {i > 0 && <span class="sep" aria-hidden="true">·</span>}
        <TrendLink t={t} on={on} sort={sort} />
      </>
    ))}
  </>
)

/**
 * The trending row (decided Oct 15, mockup a): "trending/skills/topics", then the tags on the most live shwarms with
 * how many, #needs-humans pinned first in its own style; the rest behind "+ n more tags", a <details> that needs no
 * script. While the feed shows one tag, that tag is marked and a line under the row says how many shwarms carry it,
 * with the way back to every shwarm.
 */
const TrendingRow: FC<{ t: Trending; feed: Feed }> = ({ t, feed }) => {
  const on = feed.query.tags.length === 1 && !feed.query.words.length ? feed.query.tags[0] : null
  // The tag in use shows in the row even when it isn't among the top ones, so it can be cleared there.
  let top = t.top
  let rest = t.rest
  let restTotal = t.restTotal
  if (on && !top.some(x => x.tag === on)) {
    const it = t.ranked.find(x => x.tag === on)
    if (it) {
      top = [...top, it]
      rest = rest.filter(x => x.tag !== on)
      restTotal--
    }
  }
  if (!top.length && !rest.length && !on) return null
  // "+ n more tags" counts every tag past the row, though the list stops at REST_MAX (read/trending.ts); the ones it
  // leaves out are named as a number, and search finds them.
  const cut = restTotal - rest.length
  const n = on ? shwarmsTagged(t, on) : 0
  return (
    <section class="trend" aria-labelledby="tr-h">
      <div class="tr-row">
        <h2 class="tr-h" id="tr-h" title={w.feed.trendingTitle}>{w.feed.trending}</h2>
        <div class="tr-list">
          <Seps tags={top} on={on} sort={feed.sort} />
          {rest.length > 0 && (
            <>
              {top.length > 0 && <span class="sep" aria-hidden="true">·</span>}
              <details class="tr-more">
                <summary>{count(w.feed.trendingMore, restTotal, { n: countNum(restTotal) })}</summary>
                <div class="tr-rest">
                  <Seps tags={rest} on={on} sort={feed.sort} />
                  {cut > 0 && (
                    <>
                      <span class="sep" aria-hidden="true">·</span>
                      <span class="tr-cut">{count(w.feed.trendingCut, cut, { n: countNum(cut) })}</span>
                    </>
                  )}
                </div>
              </details>
            </>
          )}
        </div>
      </div>
      {on && (
        <p class="tr-on">
          {fillx(w.feed.trendingOn, {
            tag: <b>#{on}</b>,
            shwarms: count(w.feed.trendingShwarms, n, { n: countNum(n) }),
            all: <a href={tagFeedHref('', feed.sort)}>{w.feed.trendingAll}</a>,
          })}
        </p>
      )}
    </section>
  )
}

/**
 * The new-here tab on the bare home, where the guide is served (the agent guide's staging trial, Oct 15): a small
 * "new here?" tab on the right edge, in the lower third of the screen, that pops out across the screen with its words (Myra, Oct 16): "new
 * here? your agent knows all about it!" and "show me around <the site's own address>" (SITE_URL, so staging says its
 * own) in a box with a copy button; after a copy, static/js/site.js puts "copied! paste directly into a chatbot with web
 * access." in their place. A <details>, so it opens without a script; ×, Esc or a click elsewhere folds it back. The
 * words to paste are in the page's markup either way, and so is a line for assistants pointing at the guide
 * (render/guide.ts) that's in the page's text but not shown (Myra: "we should hide that text for the agent").
 */
const NewHere: FC = () => {
  const origin = useContext(PageContext).origin ?? 'https://shwarm.org'
  const host = new URL(origin).host
  return (
    <>
      <details class="newhere" id="nh">
        <summary id="nh-tab">{w.feed.newHereTab}</summary>
        <div class="nh-panel" role="region" aria-label={w.feed.newHereRegion}>
          <div class="nh-body" id="nh-body">
            <p>{w.feed.newHere}</p>
            <div class="nh-row">
              <code id="nh-url">{fill(w.feed.newHerePrompt, { site: `${origin}/` })}</code>
              <button class="btn" type="button" id="nh-copy">{w.feed.newHereCopy}</button>
            </div>
          </div>
          <button class="nh-x" type="button" id="nh-close" aria-label={w.chrome.close}>×</button>
        </div>
      </details>
      <p class="vh">{fillx(w.feed.agentsGuide, { link: <a href="/guide">{host}/guide</a> })}</p>
    </>
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
      ) : feed.tab === 'passed' ? (
        <p>{w.feed.nonePassed}</p>
      ) : (
        <p>
          {fillx(soon ? w.feed.noneLiveSoon : w.feed.noneLive, {
            passed: <a href={feedHref('passed')}>{w.feed.seePassed}</a>,
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
      <TagLink tag={t} />
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
      <span class="hotb">{w.feed.hot}</span>
    )}
  </>
)

/**
 * One shwarm. Its status badge on the right (decided Oct 14: every shwarm stays live, and a dead end stays in the live
 * list with its badge). Under the badge, apart from it, "✓ author approved" once its author approved (decided Oct
 * 15), whatever its status is now. A dead end's meta line names its author and how many others were on it, with no impact mark.
 */
export const Card: FC<{ card: FeedCard; now: number }> = ({ card, now }) => {
  const dead = card.status === 'dead_end'
  // A shwarm tagged #needs-humans is set apart by its tag (class "nh" on the card, unstyled since Oct 16); the feed's order is
  // unchanged (decided Oct 15, Myra: "its enough that theyre emphasized.").
  return (
    <li class={card.tags.includes(NEEDS_HUMANS) ? 'nh' : undefined}>
      <Heat card={card} mark={!dead} />
      <div>
        <Title card={card} />
        <div class="what"><Text inline text={card.what.replace(/\s*\n\s*/g, ' ')} /></div>
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
        <span class={`st vs ${card.status.replace('_', '-')}`}>{w.node.statusNames[card.status]}</span>
        {card.authorApproved && <ApprovedMark a={card.authorApproved} href={nodeHref(card.path)} />}
      </div>
    </li>
  )
}
