// What the beta funnel admin page (web/admin.tsx) and the daily summary mail (jobs/summary.ts) read (go-live 11.4,
// decided Oct 9: "Analytics: our own counts, a funnel first, on an admin page"). All from our own tables: no
// third-party analytics. Each is one query, aggregated in SQL or by indexed lookups per person, so a view costs a
// handful of queries on the free D1 plan whatever the site's size.
//
// Who counts: the funnel and the testers leave out seed accounts (the launch seed's and the running example's people,
// whose password hash starts with '!', seed/plan.ts) and admins (the operator, not a tester). Daily activity and the
// summary leave out seed accounts only.

/** SQL: the person row `a` is a seeded account, which can't sign in. */
export const SEED = (a: string) => `${a}.password_hash LIKE '!%'`

/**
 * The steps of the loop, in order (decided Oct 15, #141: claims in place of submissions and checks). The funnel is
 * nested: a person is through a step only if they also reached every step before it, so no step counts more people
 * than the one above it, and a person's furthest step is the last one of that unbroken run (someone who backed
 * another's claim but never made one stops at "joined").
 */
export const STEPS = ['signed up', 'verified', 'first post', 'joined a shwarm or branch', 'first claim', 'first backing', 'first pass'] as const

export type Tester = {
  id: number
  handle: string
  status: string
  created_at: string
  invited: boolean
  reached: boolean[] // one per STEPS, each on its own
  furthest: number // index into STEPS: the last step reached with every step before it
  last_active: string | null
}

type TesterRow = {
  id: number
  handle: string
  status: string
  created_at: string
  invited: number
  verified: number
  last_post: string | null
  joined: number
  claimed: number
  backed: number
  passed: number
}

/**
 * Every tester, newest sign-up first, with the steps they reached (#141). A first claim is a claim they posted, on
 * the site or by an agent of theirs. A first backing is backing someone else's claim (their own claim backs itself, so
 * it doesn't count); backing isn't kept once it's taken off, so this counts one they hold now (a builder's default). A
 * first pass is a crowd pass record citing a claim they posted. Submissions and checks from before Oct 14 count for
 * none of these. Per person, each column is an indexed lookup (post_person, status_vote_person, pass_record_claim).
 */
export async function testers(db: D1Database): Promise<Tester[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.handle, p.status, p.created_at,
         EXISTS (SELECT 1 FROM signup_allow a WHERE a.email_norm = p.email_norm) AS invited,
         p.email_verified_at IS NOT NULL AS verified,
         (SELECT MAX(created_at) FROM post WHERE person_id = p.id) AS last_post,
         EXISTS (SELECT 1 FROM seat WHERE person_id = p.id) AS joined,
         EXISTS (SELECT 1 FROM post po WHERE po.person_id = p.id AND po.claim IS NOT NULL) AS claimed,
         EXISTS (SELECT 1 FROM status_vote v JOIN post c ON c.id = v.claim_id WHERE v.person_id = p.id AND c.person_id <> p.id) AS backed,
         EXISTS (SELECT 1 FROM post po JOIN pass_record r ON r.claim_id = po.id
                 WHERE po.person_id = p.id AND po.claim = 'passed' AND r.kind = 'crowd' AND r.status = 'passed') AS passed
       FROM person p WHERE NOT ${SEED('p')} AND p.is_admin = 0
       ORDER BY p.created_at DESC, p.id DESC`,
    )
    .all<TesterRow>()
  return results.map(r => {
    const reached = [true, !!r.verified, !!r.last_post, !!r.joined, !!r.claimed, !!r.backed, !!r.passed]
    return { id: r.id, handle: r.handle, status: r.status, created_at: r.created_at, invited: !!r.invited, reached, furthest: through(reached), last_active: r.last_post }
  })
}

/** The last step reached with every step before it (signing up always counts). */
export const through = (reached: boolean[]) => {
  const stop = reached.indexOf(false)
  return stop === -1 ? reached.length - 1 : Math.max(0, stop - 1)
}

export type Funnel = {
  invited: number // rows on signup_allow, less the admins' and seed accounts' own
  all: number[] // per STEPS: how many accounts got through it, every step before it included
  fromInvites: number[] // the same, for accounts whose email is on signup_allow
}

export async function funnel(db: D1Database, people: Tester[]): Promise<Funnel> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM signup_allow a
       WHERE NOT EXISTS (SELECT 1 FROM person p WHERE p.email_norm = a.email_norm AND (p.is_admin = 1 OR ${SEED('p')}))`,
    )
    .first<{ n: number }>()
  const count = (list: Tester[]) => STEPS.map((_, i) => list.filter(t => t.furthest >= i).length)
  return { invited: row?.n ?? 0, all: count(people), fromInvites: count(people.filter(t => t.invited)) }
}

export type DayActivity = { day: string; signups: number; posts: number; submissions: number; checks: number; passes: number }
const ACTIVITY = ['signups', 'posts', 'submissions', 'checks', 'passes'] as const

/** 'YYYY-MM-DD' for `days` UTC days ending today, oldest first. */
export function lastDays(now: number, days: number): string[] {
  const today = Math.floor(now / 86_400_000) * 86_400_000
  return Array.from({ length: days }, (_, i) => new Date(today - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10))
}

/** Sign-ups, thread posts, submissions, checks (run and people) and passes per UTC day, over `days` (from lastDays). */
export async function activity(db: D1Database, days: string[]): Promise<DayActivity[]> {
  const from = days[0]
  const real = `SELECT id FROM person WHERE NOT ${SEED('person')}`
  const { results } = await db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, 'signups' AS what, COUNT(*) AS n FROM person p
         WHERE created_at >= ?1 AND NOT ${SEED('p')} GROUP BY 1
       UNION ALL
       SELECT substr(created_at, 1, 10), 'posts', COUNT(*) FROM post
         WHERE created_at >= ?1 AND kind = 'post' AND person_id IN (${real}) GROUP BY 1
       UNION ALL
       SELECT substr(po.created_at, 1, 10), 'submissions', COUNT(*) FROM post po JOIN submission s ON s.post_id = po.id
         WHERE po.created_at >= ?1 AND po.kind = 'submission' AND po.person_id IN (${real}) GROUP BY 1
       UNION ALL
       SELECT substr(created_at, 1, 10), 'checks', COUNT(*) FROM check_report
         WHERE created_at >= ?1 AND slot <> 'author' AND person_id IN (${real}) GROUP BY 1
       UNION ALL
       SELECT substr(a.at, 1, 10), 'passes', COUNT(*) FROM audit_event a
         WHERE a.event = 'passed' AND a.at >= ?1
           AND NOT EXISTS (SELECT 1 FROM post po JOIN person pe ON pe.id = po.person_id WHERE po.id = a.submission_id AND ${SEED('pe')})
         GROUP BY 1`,
    )
    .bind(from)
    .all<{ day: string; what: (typeof ACTIVITY)[number]; n: number }>()
  const out = new Map(days.map(d => [d, { day: d, signups: 0, posts: 0, submissions: 0, checks: 0, passes: 0 } as DayActivity]))
  for (const r of results) {
    const d = out.get(r.day)
    if (d) d[r.what] = r.n
  }
  return [...out.values()]
}

export type TrafficKinds = { page: number; prompt: number; json: number; api: number; other: number }
export type TrafficWhos = { person: number; crawler: number; script: number; agent: number; unknown: number }
export type TrafficDay = TrafficKinds & { day: string; errors: number; who: TrafficWhos }
export type Ranked = { name: string; hits: number }
export type CountryWho = { name: string; person: number; crawler: number; script: number; agent: number; unknown: number; hits: number }

const noKinds = (): TrafficKinds => ({ page: 0, prompt: 0, json: 0, api: 0, other: 0 })
const noWhos = (): TrafficWhos => ({ person: 0, crawler: 0, script: 0, agent: 0, unknown: 0 })

// Every count, old and new: traffic_count (from Oct 13, with who and language) and traffic_daily (before, who unknown).
// Each day is in only one of them, so nothing counts twice.
const TRAFFIC = `(SELECT day, kind, referrer, country, status_class, who, lang, hits FROM traffic_count
  UNION ALL SELECT day, kind, referrer, country, status_class, 'unknown' AS who, '' AS lang, hits FROM traffic_daily)`

/** Requests per day by kind (every status), and how many of them were 4xx or 5xx. On the table's key: day first. */
export async function trafficByDay(db: D1Database, days: string[]): Promise<TrafficDay[]> {
  const { results } = await db
    .prepare(
      `SELECT day, kind, who, SUM(hits) AS hits, SUM(CASE WHEN status_class >= 4 THEN hits ELSE 0 END) AS errors
       FROM ${TRAFFIC} WHERE day >= ? AND day <= ? GROUP BY day, kind, who`,
    )
    .bind(days[0], days.at(-1))
    .all<{ day: string; kind: keyof TrafficKinds; who: keyof TrafficWhos; hits: number; errors: number }>()
  const out = new Map(days.map(d => [d, { day: d, ...noKinds(), errors: 0, who: noWhos() } as TrafficDay]))
  for (const r of results) {
    const d = out.get(r.day)
    if (!d || !(r.kind in noKinds())) continue
    d[r.kind] += r.hits
    d.errors += r.errors
    if (r.who in d.who) d.who[r.who] += r.hits
  }
  return [...out.values()]
}

/**
 * The top referring sites over the days; the top countries, each split by who sent the requests; and the languages
 * people's browsers ask for first (people only, counted from Oct 13).
 */
export async function trafficTop(
  db: D1Database,
  days: string[],
  limit = 10,
): Promise<{ referrers: Ranked[]; countries: CountryWho[]; languages: Ranked[] }> {
  const [r, c, l] = await Promise.all([
    db
      .prepare(
        `SELECT referrer AS name, SUM(hits) AS hits FROM ${TRAFFIC}
         WHERE day >= ? AND day <= ? AND referrer <> '' GROUP BY referrer ORDER BY hits DESC, name LIMIT ?`,
      )
      .bind(days[0], days.at(-1), limit)
      .all<Ranked>(),
    db
      .prepare(
        `SELECT country AS name, SUM(hits) AS hits,
           SUM(CASE WHEN who = 'person' THEN hits ELSE 0 END) AS person, SUM(CASE WHEN who = 'crawler' THEN hits ELSE 0 END) AS crawler,
           SUM(CASE WHEN who = 'script' THEN hits ELSE 0 END) AS script, SUM(CASE WHEN who = 'agent' THEN hits ELSE 0 END) AS agent,
           SUM(CASE WHEN who = 'unknown' THEN hits ELSE 0 END) AS unknown
         FROM ${TRAFFIC} WHERE day >= ? AND day <= ? AND country <> '' GROUP BY country ORDER BY hits DESC, name LIMIT ?`,
      )
      .bind(days[0], days.at(-1), limit)
      .all<CountryWho>(),
    db
      .prepare(
        `SELECT lang AS name, SUM(hits) AS hits FROM traffic_count
         WHERE day >= ? AND day <= ? AND who = 'person' AND lang <> '' GROUP BY lang ORDER BY hits DESC, name LIMIT ?`,
      )
      .bind(days[0], days.at(-1), limit)
      .all<Ranked>(),
  ])
  return { referrers: r.results, countries: c.results, languages: l.results }
}

export type DaySummary = {
  day: string
  requests: TrafficKinds
  signups: number
  first_posts: number
  first_submissions: number
  checks: number
  passes: number
}

/**
 * One day's line for the summary mail. First posts and first submissions are people whose first one fell on the day:
 * the day's rows on the post_created index, then one indexed look back per person.
 */
export async function daySummary(db: D1Database, day: string): Promise<DaySummary> {
  const start = `${day}T00:00:00.000Z`
  const end = new Date(Date.parse(start) + 86_400_000).toISOString()
  const real = `SELECT id FROM person WHERE NOT ${SEED('person')}`
  const [traffic, counts] = await Promise.all([
    db.prepare(`SELECT kind, SUM(hits) AS hits FROM ${TRAFFIC} WHERE day = ? GROUP BY kind`).bind(day).all<{ kind: keyof TrafficKinds; hits: number }>(),
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM person p WHERE created_at >= ?1 AND created_at < ?2 AND NOT ${SEED('p')}) AS signups,
           (SELECT COUNT(DISTINCT po.person_id) FROM post po WHERE po.created_at >= ?1 AND po.created_at < ?2 AND po.person_id IN (${real})
              AND NOT EXISTS (SELECT 1 FROM post q WHERE q.person_id = po.person_id AND q.created_at < ?1)) AS first_posts,
           (SELECT COUNT(DISTINCT po.person_id) FROM post po WHERE po.created_at >= ?1 AND po.created_at < ?2 AND po.kind = 'submission'
              AND po.person_id IN (${real})
              AND NOT EXISTS (SELECT 1 FROM post q WHERE q.person_id = po.person_id AND q.kind = 'submission' AND q.created_at < ?1)) AS first_submissions,
           (SELECT COUNT(*) FROM check_report WHERE created_at >= ?1 AND created_at < ?2 AND slot <> 'author' AND person_id IN (${real})) AS checks,
           (SELECT COUNT(*) FROM audit_event a WHERE a.event = 'passed' AND a.at >= ?1 AND a.at < ?2
              AND NOT EXISTS (SELECT 1 FROM post po JOIN person pe ON pe.id = po.person_id WHERE po.id = a.submission_id AND ${SEED('pe')})) AS passes`,
      )
      .bind(start, end)
      .first<Record<string, number>>(),
  ])
  const requests = noKinds()
  for (const r of traffic.results) if (r.kind in requests) requests[r.kind] += r.hits
  const c = counts ?? {}
  return {
    day,
    requests,
    signups: c.signups ?? 0,
    first_posts: c.first_posts ?? 0,
    first_submissions: c.first_submissions ?? 0,
    checks: c.checks ?? 0,
    passes: c.passes ?? 0,
  }
}
