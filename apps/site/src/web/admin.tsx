// The beta funnel (go-live 11.4, decided Oct 9: "Analytics: our own counts, a funnel first, on an admin page"):
// /admin/beta answers "are beta testers getting through the loop?" from our own tables (read/beta.ts) and the
// server-side traffic counts (web/traffic.ts). Only a signed-in, active admin sees it; everyone else, signed out
// included, gets the plain 404 page, so the address isn't advertised. A reading page: prose under headings, tables
// for the numbers, the sidebar's boxes only.
import { Hono } from 'hono'
import type { FC } from 'hono/jsx'
import { sessionOf } from '../auth/request'
import { activity, funnel, lastDays, STEPS, testers, trafficByDay, trafficTop, type DayActivity, type Funnel, type Ranked, type Tester, type TrafficDay } from '../read/beta'
import { sendError } from './errors'
import { AgentResources, Layout } from './layout'
import { page } from './viewer'

type Env = { Bindings: { DB: D1Database; CSRF_SECRET: string } }
export const admin = new Hono<Env>()

const DAYS = 14
const DAY = 86_400_000

/** Whether the person is an active admin. */
async function isAdmin(db: D1Database, personId: number): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok FROM person WHERE id = ? AND is_admin = 1 AND status = 'active'").bind(personId).first()
  return !!row
}

admin.get('/admin/beta', async c => {
  const s = await sessionOf(c)
  if (!s || !(await isAdmin(c.env.DB, s.personId))) return sendError(c, { status: 404 })
  c.header('X-Robots-Tag', 'noindex')
  const now = Date.now()
  const days = lastDays(now, DAYS)
  const db = c.env.DB
  const people = await testers(db)
  const [f, act, traffic, top] = await Promise.all([funnel(db, people), activity(db, days), trafficByDay(db, days), trafficTop(db, days)])
  return page(c, <BetaPage v={{ funnel: f, people, activity: act, traffic, top, now }} />)
})

type View = { funnel: Funnel; people: Tester[]; activity: DayActivity[]; traffic: TrafficDay[]; top: { referrers: Ranked[]; countries: Ranked[] }; now: number }

const SECTIONS: [string, string][] = [
  ['loop', 'the loop'],
  ['testers', 'testers'],
  ['activity', 'daily activity'],
  ['traffic', 'traffic'],
]

const n = (x: number) => x.toLocaleString('en-US')

/** A count and its drop from the step before ("−3"), when it dropped. */
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
            <td>{t.created_at.slice(0, 10)}</td>
            <td>{STEPS[t.furthest]}</td>
            <td>{t.last_active ? t.last_active.slice(0, 10) : '—'}</td>
            <td class="num">{daysSince(t.last_active, now)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

const ActivityTable: FC<{ rows: DayActivity[] }> = ({ rows }) => (
  <table class="adm">
    <thead><tr><th>day</th><th class="num">sign-ups</th><th class="num">posts</th><th class="num">submissions</th><th class="num">checks</th><th class="num">passes</th></tr></thead>
    <tbody>
      {[...rows].reverse().map(r => (
        <tr><td>{r.day}</td><td class="num">{n(r.signups)}</td><td class="num">{n(r.posts)}</td><td class="num">{n(r.submissions)}</td><td class="num">{n(r.checks)}</td><td class="num">{n(r.passes)}</td></tr>
      ))}
    </tbody>
  </table>
)

const TrafficTable: FC<{ rows: TrafficDay[] }> = ({ rows }) => (
  <table class="adm">
    <thead><tr><th>day</th><th class="num">pages</th><th class="num">prompts</th><th class="num">json</th><th class="num">api</th><th class="num">other</th><th class="num">errors</th></tr></thead>
    <tbody>
      {[...rows].reverse().map(r => (
        <tr><td>{r.day}</td><td class="num">{n(r.page)}</td><td class="num">{n(r.prompt)}</td><td class="num">{n(r.json)}</td><td class="num">{n(r.api)}</td><td class="num">{n(r.other)}</td><td class="num">{n(r.errors)}</td></tr>
      ))}
    </tbody>
  </table>
)

const Top: FC<{ title: string; rows: Ranked[]; none: string }> = ({ title, rows, none }) => (
  <>
    <h3>{title}</h3>
    {rows.length ? <ol>{rows.map(r => <li>{r.name} <span class="mk">{n(r.hits)}</span></li>)}</ol> : <p>{none}</p>}
  </>
)

const BetaPage: FC<{ v: View }> = ({ v }) => (
  <Layout title="beta funnel · shwarm" noindex>
    <link rel="stylesheet" href="/css/admin.css" />
    <div class="dochead">
      <h1>beta funnel</h1>
      <p>are testers getting through the loop? counted from our own tables. only admins see this page.</p>
    </div>
    <div class="doc">
      <article id="main" tabindex={-1}>
        <section id="loop">
          <h2>the loop</h2>
          <div class="body">
            <p>how many accounts reached each step, and how many dropped off since the step before. seed accounts and admins aren't counted.</p>
            <LoopTable f={v.funnel} />
          </div>
        </section>
        <section id="testers">
          <h2>testers</h2>
          <div class="body">
            <p>{v.people.length === 1 ? '1 account' : `${n(v.people.length)} accounts`}, newest first. last active is their newest post, submission or check.</p>
            <TesterTable people={v.people} now={v.now} />
          </div>
        </section>
        <section id="activity">
          <h2>daily activity</h2>
          <div class="body">
            <p>the last {DAYS} days in utc, newest first. checks are run and people checks; sign-offs show in passes.</p>
            <ActivityTable rows={v.activity} />
          </div>
        </section>
        <section id="traffic">
          <h2>traffic</h2>
          <div class="body">
            <p>requests per day, counted on the server. these are requests, not people: there are no cookies, so one person reading ten pages counts ten. api is signed agent calls; prompts are text answers.</p>
            <TrafficTable rows={v.traffic} />
            <Top title="top referring sites" rows={v.top.referrers} none="no other sites linked here yet." />
            <Top title="top countries" rows={v.top.countries} none="no countries yet." />
          </div>
        </section>
      </article>
      <aside class="toc">
        <div class="box"><h2>on this page</h2><ol>{SECTIONS.map(([id, h]) => <li><a href={`#${id}`}>{h}</a></li>)}</ol></div>
        <AgentResources />
      </aside>
    </div>
  </Layout>
)
