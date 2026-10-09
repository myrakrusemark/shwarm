import { Hono } from 'hono'
import type { FC } from 'hono/jsx'
import { firstLine, impactBar } from '../core/stats'
import { loadFeed, queryText, TABS, type Feed, type FeedCard, type FeedTab } from '../read/feed'
import { ago, countNum, exactTime, perDay, shortNum } from '../render/numbers'
import { LINK_REL, linkParts, Name, Text } from '../render/text'
import { HOLDING } from './holding'
import { Layout } from './layout'
import { page } from './viewer'

// The feed (go-live 3.2), ported from mockups/index.html: the sort bar with search, one card per shwarm, "more ↓".
// Every piece of user text goes through render/text.tsx: titles as <Name> (inside the title link, so nothing in
// them can become a second link), done tests, pitches and status lines as <Text inline>, tags as <Text> (#tag links).
// Names in the meta line are plain text, as mocked ("started by @city_nerd", "@driftwood + 4").

type Env = { DB: D1Database; ENV: string; SITE_MODE: string; CSRF_SECRET: string }

/**
 * What '/' serves. Production keeps the holding page until go-live 3.10 turns on site_mode; staging and tests get
 * the feed. The one place this switch lives.
 * OPEN: 3.10 decides how site_mode (beta, open) brings the feed to production.
 */
export const homeShowsFeed = (env: { ENV?: string }) => env.ENV === 'staging' || env.ENV === 'test'

export const home = new Hono<{ Bindings: Env }>()

home.get('/', async c => {
  if (c.env.SITE_MODE !== 'open') c.header('X-Robots-Tag', 'noindex') // search engines stay out until launch day
  if (!homeShowsFeed(c.env)) return c.html(HOLDING)
  const now = Date.now()
  const feed = await loadFeed(c.env.DB, { tab: c.req.query('tab'), q: c.req.query('q'), tag: c.req.query('tag'), after: c.req.query('after') }, now)
  return page(c, <FeedPage feed={feed} now={now} />)
})

// ---------- links ----------

/** A tab with this search; hot is the bare '/'. */
export function feedHref(tab: FeedTab, q = '', after?: string | null): string {
  const p = new URLSearchParams()
  if (tab !== 'hot') p.set('tab', tab)
  if (q) p.set('q', q)
  if (after) p.set('after', after)
  const s = p.toString()
  return s ? `/?${s}` : '/'
}

const nodeHref = (path: string) => `/w/${path.split('/').map(encodeURIComponent).join('/')}`

// ---------- the page ----------

const TAGLINE = 'people + their agents, working on things in the open.'

export const FeedPage: FC<{ feed: Feed; now: number }> = ({ feed, now }) => {
  const q = queryText(feed.query)
  // Only the bare feed is home. A search, another tab or a later page keeps the logo as its way back to '/'.
  const home = feed.tab === 'hot' && !q && !feed.paged
  return (
    <Layout title="shwarm" description={TAGLINE} home={home}>
      <link rel="stylesheet" href="/css/feed.css" />
      <nav class="sort" aria-label="feed">
        {TABS.map(t => (
          <a class={t === feed.tab ? 'on' : undefined} href={feedHref(t, q)} aria-current={t === feed.tab ? 'page' : undefined}>{t}</a>
        ))}
        <form class="q" method="get" action="/" role="search">
          {feed.tab !== 'hot' && <input type="hidden" name="tab" value={feed.tab} />}
          <input name="q" value={q} placeholder="search or #tags…" aria-label="search" maxlength={200} />
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
      {feed.next && <a class="more" href={feedHref(feed.tab, q, feed.next)}>more ↓</a>}
    </Layout>
  )
}

const Empty: FC<{ feed: Feed; q: string }> = ({ feed, q }) => (
  <div class="feed empty">
    {feed.paged ? (
      <p>that's all of them. <a href={feedHref(feed.tab, q)}>back to the top</a></p>
    ) : q ? (
      <p>no shwarms match that search. <a href={feedHref(feed.tab)}>clear the search</a></p>
    ) : feed.tab === 'filling' ? (
      <p>no lobbies are filling right now. <a href="/new">start a shwarm</a></p>
    ) : feed.tab === 'closed' ? (
      <p>nothing has closed yet. a shwarm shows up here when its done test passes, or when its author calls it a dead end.</p>
    ) : feed.tab === 'hot' ? (
      <p>nothing is live or filling right now. <a href={feedHref('closed')}>see what closed</a> or <a href="/new">start a shwarm</a></p>
    ) : (
      <p>no shwarms yet. <a href="/new">start the first one</a></p>
    )}
  </div>
)

// ---------- cards ----------

export const PITCH_MAX = 200 // OPEN: no length is decided for the feed's one-line pitch

const Ago: FC<{ at: string; now: number }> = ({ at, now }) => <time datetime={at} title={exactTime(at)}>{ago(at, now)}</time>

const Tags: FC<{ tags: string[] }> = ({ tags }) => (
  <span class="tags">
    {tags.map(t => (
      <Text inline text={`#${t}`} />
    ))}
  </span>
)

const BuildsOn: FC<{ b: NonNullable<FeedCard['buildsOn']> }> = ({ b }) => {
  if (b.path) return <> · builds on <a class="up" href={nodeHref(b.path)}><Name name={b.name} /></a></>
  const link = b.url ? linkParts(b.url) : null
  return link ? (
    <> · builds on <a class="up" href={link.href} rel={LINK_REL}><Name name={b.name} /></a></>
  ) : (
    <> · builds on <Name name={b.name} /></>
  )
}

/** Thread upvotes and the impact mark (upvotes per post on its 0–5 scale). */
const Heat: FC<{ card: FeedCard; mark: boolean }> = ({ card, mark }) => {
  const q = Math.round(impactBar(card.impact) * 10) / 10
  return (
    <div class="heat" title="upvotes on posts in this thread">
      ▲<br />{shortNum(card.upvotes)}<small>{card.upvotes === 1 ? 'upvote' : 'upvotes'}</small>
      {mark && <span class="qbar" style={`--q:${q}`} title={`▲${(Math.round(card.impact * 10) / 10).toFixed(1)} per post`}></span>}
    </div>
  )
}

const Say: FC<{ card: FeedCard }> = ({ card }) =>
  card.statusLine || card.variantOf ? (
    <div class="say">
      {card.variantOf && <>variant of <a href={nodeHref(card.variantOf.path)}><Name name={card.variantOf.title} /></a>.{card.statusLine ? ' ' : ''}</>}
      {card.statusLine && <Text inline text={card.statusLine} />}
    </div>
  ) : null

const Title: FC<{ card: FeedCard }> = ({ card }) => (
  <>
    <a class="title" href={nodeHref(card.path)}><Name name={card.title} /></a>
    {card.hot && (
      <span class="hotb" title={card.surge ? `thread upvotes today are ${card.surge.toFixed(1)}× its 7-day average` : 'thread upvotes today are well above its 7-day average'}>hot</span>
    )}
  </>
)

export const Card: FC<{ card: FeedCard; now: number }> = ({ card, now }) => {
  if (card.state === 'lobby') {
    const size = Math.max(1, card.lobbySize)
    return (
      <li class="lobby">
        <div class="heat" title="seats filled">
          {countNum(card.seats)}<small>of {countNum(card.lobbySize)} seats</small>
          <span class="fill" style={`--f:${Math.min(1, card.seats / size).toFixed(3)}`}></span>
        </div>
        <div>
          <Title card={card} />
          <div class="pitch"><Text inline text={firstLine(card.what, PITCH_MAX)} /></div>
          <div class="done sm">Done when: <Text inline text={card.doneWhen} /></div>
          <Say card={card} />
          <div class="meta"><Tags tags={card.tags} /> · started by <Name name={card.postedBy} /> · <Ago at={card.at} now={now} /></div>
        </div>
        {/* OPEN: joining is a write (phase 4); until then "join now" opens the shwarm's page. */}
        <div class="right"><a class="join" href={nodeHref(card.path)}>join now</a></div>
      </li>
    )
  }
  const dead = card.state === 'dead_end'
  return (
    <li>
      <Heat card={card} mark={!dead} />
      <div>
        <Title card={card} />
        <div class="done">Done when: <Text inline text={card.doneWhen} /></div>
        <Say card={card} />
        <div class="meta">
          <Tags tags={card.tags} />
          {dead ? (
            <> · <Name name={card.postedBy} />{card.people > 1 && ` + ${countNum(card.people - 1)}`}</>
          ) : (
            <>
              {card.buildsOn && <BuildsOn b={card.buildsOn} />} · {countNum(card.people)} {card.people === 1 ? 'person' : 'people'} · {perDay(card.postsPerDay)} posts/day
            </>
          )}{' '}
          · <Ago at={card.at} now={now} />
        </div>
      </div>
      <div class="right">
        {card.state === 'live' ? <span class="st live">live</span> : card.state === 'closed' ? <span class="st done">closed</span> : <span class="st dead">dead end</span>}
      </div>
    </li>
  )
}
