// The analytics page (go-live 11.4, decided Oct 9: "Analytics: our own counts, a funnel first, on an admin page";
// renamed from the beta funnel, Myra, Oct 16: "i want general analytics. graphs."). /admin/analytics answers "how is
// shwarm doing?" from our own tables (read/beta.ts) and the server-side traffic counts (web/traffic.ts), as charts with
// their numbers under each (web/charts.tsx). Behind adminGate like every other admin page (web/admin-gate.ts: Access,
// a verified active admin, the password step-up); everyone else, signed out included, gets the plain 404 page, so the
// address isn't advertised. A reading page: prose under headings, the sidebar's boxes only.
import { Hono } from 'hono'
import type { FC } from 'hono/jsx'
import { activity, funnel, lastDays, STEPS, testers, trafficByDay, trafficTop, type DayActivity, type Funnel, type CountryWho, type Ranked, type Tester, type TrafficDay } from '../read/beta'
import { adminGate, type AdminEnv } from './admin-gate'
import { AdminNav } from './admin-nav'
import { Bars, Columns, Legend, type Series } from './charts'
import { AgentResources, Layout } from './layout'
import { w } from '../words'
import { page } from './viewer'

type Env = { Bindings: AdminEnv & { CSRF_SECRET: string } }
export const admin = new Hono<Env>()

export const PATH = '/admin/analytics'
const DAYS = 30
const DAY = 86_400_000

// The old address, from before the rename (old summary mails link to it). Gated first, so it stays a 404 for others.
admin.get('/admin/beta', async c => {
  const g = await adminGate(c)
  if ('stop' in g) return g.stop
  return c.redirect(PATH, 301)
})

admin.get(PATH, async c => {
  const g = await adminGate(c)
  if ('stop' in g) return g.stop
  const now = Date.now()
  const days = lastDays(now, DAYS)
  const db = c.env.DB
  const people = await testers(db)
  const [f, act, traffic, top] = await Promise.all([funnel(db, people), activity(db, days), trafficByDay(db, days), trafficTop(db, days)])
  return page(c, <AnalyticsPage v={{ funnel: f, people, activity: act, traffic, top, now }} />)
})

type View = { funnel: Funnel; people: Tester[]; activity: DayActivity[]; traffic: TrafficDay[]; top: { referrers: Ranked[]; countries: CountryWho[]; languages: Ranked[] }; now: number }

const SECTIONS: [string, string][] = [
  ['glance', 'at a glance'],
  ['growth', 'sign-ups and posts'],
  ['visits', 'visits'],
  ['where', 'where they come from'],
  ['loop', 'the loop'],
  ['testers', 'testers'],
]

const n = (x: number) => x.toLocaleString('en-US')

/** A count and its drop from the step before ("−3"), when it dropped. The funnel is nested, so it never rises. */
const Step: FC<{ x: number; prev?: number }> = ({ x, prev }) => (
  <td class="num">
    {n(x)}
    {prev !== undefined && prev > x && <span class="drop"> −{n(prev - x)}</span>}
  </td>
)

const LoopTable: FC<{ f: Funnel }> = ({ f }) => (
  <table class="adm">
    <thead><tr><th>step</th><th class="num">invited</th><th class="num">all accounts</th></tr></thead>
    <tbody>
      <tr><td>invited</td><Step x={f.invited} /><td class="num">—</td></tr>
      {STEPS.map((step, i) => (
        <tr>
          <td>{step}</td>
          <Step x={f.fromInvites[i]} prev={i === 0 ? f.invited : f.fromInvites[i - 1]} />
          <Step x={f.all[i]} prev={i === 0 ? undefined : f.all[i - 1]} />
        </tr>
      ))}
    </tbody>
  </table>
)

const daysSince = (at: string | null, now: number) => {
  if (!at) return '—'
  const d = Math.floor((now - Date.parse(at)) / DAY)
  return d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`
}

const TesterTable: FC<{ people: Tester[]; now: number }> = ({ people, now }) =>
  !people.length ? (
    <p>no testers yet.</p>
  ) : (
    <table class="adm">
      <thead><tr><th>handle</th><th>joined</th><th>furthest step</th><th>last active</th><th class="num">since</th></tr></thead>
      <tbody>
        {people.map(t => (
          <tr>
            <td>
              {t.status === 'active' ? <a href={`/@${t.handle}`}>@{t.handle}</a> : <span>@{t.handle}</span>}
              {t.invited && <span class="mk"> invited</span>}
              {t.status !== 'active' && <span class="mk"> {t.status}</span>}
            </td>
            <td class="day">{t.created_at.slice(0, 10)}</td>
            <td>{STEPS[t.furthest]}</td>
            <td class="day">{t.last_active ? t.last_active.slice(0, 10) : '—'}</td>
            <td class="num">{daysSince(t.last_active, now)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

const ActivityTable: FC<{ rows: DayActivity[] }> = ({ rows }) => (
  <table class="adm">
    <thead><tr><th>day</th><th class="num">sign-ups</th><th class="num">posts</th><th class="num">claims</th></tr></thead>
    <tbody>
      {[...rows].reverse().map(r => (
        <tr><td class="day">{r.day}</td><td class="num">{n(r.signups)}</td><td class="num">{n(r.posts)}</td><td class="num">{n(r.claims)}</td></tr>
      ))}
    </tbody>
  </table>
)

const TrafficTable: FC<{ rows: TrafficDay[] }> = ({ rows }) => (
  <table class="adm">
    <thead><tr><th>day</th><th class="num">pages</th><th class="num">prompts</th><th class="num">json</th><th class="num">api</th><th class="num">other</th><th class="num">errors</th></tr></thead>
    <tbody>
      {[...rows].reverse().map(r => (
        <tr><td class="day">{r.day}</td><td class="num">{n(r.page)}</td><td class="num">{n(r.prompt)}</td><td class="num">{n(r.json)}</td><td class="num">{n(r.api)}</td><td class="num">{n(r.other)}</td><td class="num">{n(r.errors)}</td></tr>
      ))}
    </tbody>
  </table>
)

const WhoTable: FC<{ rows: TrafficDay[] }> = ({ rows }) => (
  <table class="adm">
    <thead><tr><th>day</th><th class="num">people</th><th class="num">crawlers</th><th class="num">scripts</th><th class="num">agents</th><th class="num">unknown</th></tr></thead>
    <tbody>
      {[...rows].reverse().map(r => (
        <tr><td class="day">{r.day}</td><td class="num">{n(r.who.person)}</td><td class="num">{n(r.who.crawler)}</td><td class="num">{n(r.who.script)}</td><td class="num">{n(r.who.agent)}</td><td class="num">{n(r.who.unknown)}</td></tr>
      ))}
    </tbody>
  </table>
)

const CountryTable: FC<{ rows: CountryWho[] }> = ({ rows }) => (
  <table class="adm">
    <thead><tr><th>country</th><th class="num">all</th><th class="num">people</th><th class="num">crawlers</th><th class="num">scripts</th><th class="num">agents</th><th class="num">unknown</th></tr></thead>
    <tbody>
      {rows.map(r => (
        <tr><td>{r.name}</td><td class="num">{n(r.hits)}</td><td class="num">{n(r.person)}</td><td class="num">{n(r.crawler)}</td><td class="num">{n(r.script)}</td><td class="num">{n(r.agent)}</td><td class="num">{n(r.unknown)}</td></tr>
      ))}
    </tbody>
  </table>
)

/** The numbers behind a chart, folded away under it. */
const Numbers: FC<{ children: unknown }> = ({ children }) => (
  <details class="nums">
    <summary>the numbers</summary>
    {children}
  </details>
)

const Tile: FC<{ value: number; label: string }> = ({ value, label }) => (
  <div class="tile"><b>{n(value)}</b><span>{label}</span></div>
)

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

const WHO: { key: keyof TrafficDay['who']; label: string; slot: Series['slot'] }[] = [
  { key: 'person', label: 'people', slot: 1 },
  { key: 'crawler', label: 'crawlers', slot: 2 },
  { key: 'script', label: 'scripts', slot: 3 },
  { key: 'agent', label: 'agents', slot: 4 },
  { key: 'unknown', label: 'unknown', slot: 'none' },
]

const ranked = (rows: Ranked[]) => rows.map(r => ({ name: r.name, value: r.hits }))

const AnalyticsPage: FC<{ v: View }> = ({ v }) => {
  const days = v.activity.map(r => r.day)
  const week = v.activity.slice(-7)
  const who = WHO.map(x => ({ label: x.label, slot: x.slot, values: v.traffic.map(r => r.who[x.key]) }))
  const whoShown = who.filter(s => sum(s.values) > 0)
  const posts: Series[] = [
    { label: 'other posts', slot: 1, values: v.activity.map(r => Math.max(0, r.posts - r.claims)) },
    { label: 'claims', slot: 2, values: v.activity.map(r => r.claims) },
  ]
  return (
    <Layout title="analytics · shwarm" noindex>
      <link rel="stylesheet" href="/css/admin.css" />
      <div class="dochead">
        <h1>analytics</h1>
        <p>how shwarm is doing, from our own tables and counts kept on the server. no cookies, nothing from other companies. the last {DAYS} days, in utc. only admins see this page.</p>
      </div>
      <div class="doc">
        <article id="main" tabindex={-1}>
          <AdminNav here={PATH} />
          <section id="glance">
            <h2>at a glance</h2>
            <div class="body">
              <div class="tiles">
                <Tile value={v.people.length} label="accounts" />
                <Tile value={sum(week.map(r => r.signups))} label="new this week" />
                <Tile value={sum(v.activity.map(r => r.posts))} label="posts" />
                <Tile value={sum(v.traffic.map(r => r.who.person))} label="people's requests" />
                <Tile value={sum(v.traffic.map(r => r.api))} label="agent calls" />
              </div>
              <p class="note">accounts leave out seed accounts and admins. new this week is the last 7 days; posts, requests and calls are the last {DAYS}.</p>
            </div>
          </section>
          <section id="growth">
            <h2>sign-ups and posts</h2>
            <div class="body">
              <p>new accounts per day. hover over a day to see its numbers.</p>
              <Columns days={days} label="sign-ups per day" series={[{ label: 'sign-ups', slot: 1, values: v.activity.map(r => r.signups) }]} />
              <h3>posts</h3>
              <p>thread posts per day, claims among them.</p>
              <Legend series={posts} />
              <Columns days={days} label="posts per day, claims among them" series={posts} />
              <Numbers><ActivityTable rows={v.activity} /></Numbers>
            </div>
          </section>
          <section id="visits">
            <h2>visits</h2>
            <div class="body">
              <p>requests per day, by who sent them. these are requests, not people: there are no cookies, so one person reading ten pages counts ten. people are browsers. crawlers say they are one, or send no name. scripts are the rest, like curl. agents are signed api calls. it's a guess from the headers: a careful bot can pass as a person. unknown is before oct 13, when this wasn't counted.</p>
              <Legend series={whoShown} />
              <Columns days={days} label="requests per day, by who sent them" series={whoShown} />
              <Numbers>
                <WhoTable rows={v.traffic} />
                <h3>by kind</h3>
                <p>pages are html, prompts are text answers, api is signed agent calls.</p>
                <TrafficTable rows={v.traffic} />
              </Numbers>
            </div>
          </section>
          <section id="where">
            <h2>where they come from</h2>
            <div class="body">
              <h3>referring sites</h3>
              <Bars rows={ranked(v.top.referrers)} none="no other sites linked here yet." />
              <h3>countries</h3>
              <Bars rows={v.top.countries.map(c => ({ name: c.name, value: c.hits, note: `${n(c.person)} from people` }))} none="no countries yet." />
              {v.top.countries.length > 0 && <Numbers><CountryTable rows={v.top.countries} /></Numbers>}
              <h3>people's browser languages</h3>
              <Bars rows={ranked(v.top.languages)} none="no languages yet. counted from oct 13." />
            </div>
          </section>
          <section id="loop">
            <h2>the loop</h2>
            <div class="body">
              <p>how many accounts got through each step in order. an account counts at a step only if it also reached every step before it. seed accounts and admins aren't counted.</p>
              <Bars rows={STEPS.map((step, i) => ({ name: step, value: v.funnel.all[i], note: `${n(v.funnel.fromInvites[i])} invited` }))} none="no accounts yet." />
              <Numbers><LoopTable f={v.funnel} /></Numbers>
            </div>
          </section>
          <section id="testers">
            <h2>testers</h2>
            <div class="body">
              <p>{v.people.length === 1 ? '1 account' : `${n(v.people.length)} accounts`}, newest first. furthest step is the last one they reached in order, as in the loop. last active is their newest post (a claim is a post).</p>
              <TesterTable people={v.people} now={v.now} />
            </div>
          </section>
        </article>
        <aside class="toc">
          <div class="box"><h2>{w.chrome.onThisPage}</h2><ol>{SECTIONS.map(([id, h]) => <li><a href={`#${id}`}>{h}</a></li>)}</ol></div>
          <AgentResources />
        </aside>
      </div>
    </Layout>
  )
}
