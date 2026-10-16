import { OPEN_NODE } from './visibility'
// The feed's queries (go-live 3.2): the two tabs, their sorts, search, and cursor paging. SQL lives here, not in the
// page.
//
// Tabs say which shwarms, sorts say in what order (decided Oct 12, "The feed: two tabs and a sort"; before that the
// tabs were hot, new and closed, and Oct 9's "No lobby" dropped filling). Every shwarm is live (nothing locks), so the
// tabs go by its status (decided Oct 14, "With nothing locking: … a passed tab"):
//   live     every shwarm whose status isn't passed, dead ends among them with their badge. sorts: people (the
//            default, Myra Oct 13), hot (live score), new, upvotes, active (posts per day)
//   passed   shwarms whose status is passed. sorts: new (passed, newest first, the default), upvotes, people
// The old ?tab=hot, ?tab=new and ?tab=filling still work: they read as live, sorted hot, new and people; ?tab=closed,
// the passed tab's name before Oct 14, reads as passed.
// A shwarm's status here is the one stored with its band (branch_status), which the stats job brings up to date within
// minutes of a change that comes with time alone (jobs/stats.ts).
// Search and #tags filter every tab; the sort stays.
//
// Each list is ordered by (k1, k2 = created_at, id), all descending, and paged by keyset: the cursor holds the last
// row's keys, so a page never repeats or skips a row because rows were added above it. The cursor is opaque to the
// reader (base64url JSON) and checked field by field; a broken one starts from the top.
//
// A request costs a few small queries: settings (hot only), one list per kind on the page, and the card details for
// that page's ids. Scores, the hot flag and its ratio come from node_stats, which the stats job (jobs/stats.ts)
// fills, so a view never counts a thread's posts or upvotes; nothing here counts agents.
import { readSettings } from '../core/settings'
import { WEEK_MS, rankingFrom, type Ranking } from '../core/stats'
import type { Status } from '../core/status'
import type { AuthorApproved } from './status'
import { NAME_SHOWN } from './names'
import { humansFirst } from '../core/tags'

export const TABS = ['live', 'passed'] as const
export type FeedTab = (typeof TABS)[number]

// OPEN: whether something like "needs hands" (fewest people first) joins these is undecided (open #39).
export const SORTS = ['people', 'hot', 'new', 'upvotes', 'active'] as const
export type FeedSort = (typeof SORTS)[number]
const PASSED_SORTS: readonly FeedSort[] = ['new', 'upvotes', 'people']

/** The sorts a tab offers, its default first. */
export const sortsFor = (tab: FeedTab): readonly FeedSort[] => (tab === 'live' ? SORTS : PASSED_SORTS)
export const defaultSort = (tab: FeedTab): FeedSort => sortsFor(tab)[0]

/** The tab and sort a request asks for. Anything unknown is the default; the old tabs read as live (see the top). */
export function feedView(tab: unknown, sort: unknown): { tab: FeedTab; sort: FeedSort } {
  const t: FeedTab = tab === 'passed' || tab === 'closed' ? 'passed' : 'live'
  const asked = typeof sort === 'string' ? sort : tab === 'new' ? 'new' : tab === 'hot' ? 'hot' : undefined
  const s = sortsFor(t).find(x => x === asked) ?? defaultSort(t)
  return { tab: t, sort: s }
}

export const PAGE_SIZE = 20

// ---------- what a reader may see ----------

/**
 * Nodes the public sees (A8, A18): triage cleared them, or Myra's proofreading did (seeded, still 'pending'), and
 * they aren't hidden. A held or blocked node is visible only to its author, on its own page.
 * OPEN: the feed never shows an author their own held node; it shows on its page and their profile.
 */
export const visibleSql = OPEN_NODE // one rule for every page (src/read/visibility.ts)

// OPEN: branches never appear in the feed; it lists shwarms (spec: "new (newest shwarms)", "branches don't take their
// own tags", and tags filter every tab), and the variants made before they were dropped, which read as shwarms.
export const TOP = "n.kind IN ('shwarm', 'variant')"

// ---------- search ----------

const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/ // as core/nodes.ts
export const MAX_QUERY = 200 // characters of the search box read; the rest is ignored
export const MAX_WORDS = 8
export const MAX_TAGS = 8
const MAX_WORD = 64

export type Query = { words: string[]; tags: string[] }

/**
 * The search box as words and #tags. Input is cut to MAX_QUERY characters, control characters become spaces, and
 * only words with a letter or digit in them are kept, so nothing that reaches FTS can be an operator on its own.
 */
export function parseQuery(input: string | null | undefined): Query {
  const words: string[] = []
  const tags: string[] = []
  const s = String(input ?? '').slice(0, MAX_QUERY).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
  for (let tok of s.split(/\s+/)) {
    if (!tok) continue
    if (tok.startsWith('#')) {
      const tag = tok.replace(/^#+/, '').toLowerCase()
      if (TAG_RE.test(tag)) {
        if (tags.length < MAX_TAGS && !tags.includes(tag)) tags.push(tag)
        continue
      }
      tok = tok.replace(/^#+/, '') // "#c++" isn't a tag: search for the word
    }
    tok = tok.slice(0, MAX_WORD)
    if (!/[\p{L}\p{N}]/u.test(tok)) continue
    if (words.length < MAX_WORDS && !words.includes(tok)) words.push(tok)
  }
  return { words, tags }
}

/**
 * An FTS5 MATCH expression for these words: each one a quoted string (inner quotes doubled) with a prefix star, all
 * of them required. A quoted string is always a phrase, never an operator, column filter or NEAR group.
 */
export function ftsQuery(words: string[]): string {
  return words.map(w => `"${w.replace(/"/g, '""')}"*`).join(' ')
}

/** The search box text for a query, tags last (what the box shows after a search). */
export const queryText = (q: Query) => [...q.words, ...q.tags.map(t => `#${t}`)].join(' ')

// ---------- cursors ----------

type Key = [number | string, string, number] // k1, created_at, id
type Cursor = { t: FeedTab; s: FeedSort; k?: Key; at?: number }

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))

export const encodeCursor = (c: Cursor) => b64(JSON.stringify(c))

const isKey = (k: unknown): k is Key =>
  Array.isArray(k) &&
  k.length === 3 &&
  ((typeof k[0] === 'number' && Number.isFinite(k[0])) || (typeof k[0] === 'string' && k[0].length <= 40)) &&
  typeof k[1] === 'string' &&
  k[1].length <= 40 &&
  Number.isSafeInteger(k[2])

/** The cursor for this tab and sort, or null (start from the top) when it's missing, broken or for another list. */
export function decodeCursor(s: string | null | undefined, tab: FeedTab, sort: FeedSort): Cursor | null {
  if (!s || s.length > 600 || !/^[A-Za-z0-9_-]+$/.test(s)) return null
  let c: any
  try {
    c = JSON.parse(unb64(s))
  } catch {
    return null
  }
  if (!c || typeof c !== 'object' || c.t !== tab || c.s !== sort) return null
  if (sort === 'hot') {
    if (!Number.isSafeInteger(c.at) || c.at <= 0 || c.at > 8.64e15) return null // a time Date can hold
    return isKey(c.k) ? { t: tab, s: sort, at: c.at, k: c.k } : null
  }
  return isKey(c.k) ? { t: tab, s: sort, k: c.k } : null
}

// ---------- the lists ----------

type Row = { id: number; k1: number | string; k2: string }

type ListSpec = { where: string; whereArgs?: unknown[]; k1: string; k1Args?: unknown[] }

/** One keyset page of a list: up to `limit` rows after `after`, best first. */
async function list(db: D1Database, spec: ListSpec, filter: { sql: string; args: unknown[] }, after: Key | undefined, limit: number): Promise<Row[]> {
  const args: unknown[] = [...(spec.k1Args ?? []), ...(spec.whereArgs ?? []), ...filter.args]
  let sql =
    `SELECT id, k1, k2 FROM (SELECT n.id, ${spec.k1} AS k1, n.created_at AS k2 FROM node n LEFT JOIN node_stats ns ON ns.node_id = n.id ` +
    'LEFT JOIN branch_status bs ON bs.node_id = n.id ' +
    `WHERE ${TOP} AND ${visibleSql('n')} AND ${spec.where}${filter.sql})`
  if (after) {
    sql += ' WHERE (k1 < ? OR (k1 = ? AND (k2 < ? OR (k2 = ? AND id < ?))))'
    args.push(after[0], after[0], after[1], after[1], after[2])
  }
  sql += ' ORDER BY k1 DESC, k2 DESC, id DESC LIMIT ?'
  args.push(limit)
  return (await db.prepare(sql).bind(...args).all<Row>()).results
}

const keyOf = (r: Row): Key => [r.k1, r.k2, r.id]

/** A shwarm's status as stored with its band (`bs`, branch_status): on track when it has none. */
const STATUS = "COALESCE(bs.current, 'on_track')"

// When a shwarm passed: when its status became passed (never changed_at, which every later post moves). created_at only
// stands in for a row with none, so the key never moves while it stays passed.
const PASSED_AT = 'COALESCE(bs.changed_at, n.created_at)'

export const TAB_SQL: Record<FeedTab, string> = { live: `${STATUS} <> 'passed'`, passed: `${STATUS} = 'passed'` }

// The counted sorts read node_stats, as the cards do (a shwarm the stats job hasn't reached yet counts its author as
// its one person). Most first; ties go newest first. new is created_at on live and PASSED_AT on passed.
const SORT_KEY: Partial<Record<FeedSort, string>> = {
  upvotes: 'COALESCE(ns.upvotes, 0)',
  people: 'COALESCE(ns.people, 1)',
  active: 'COALESCE(ns.posts_per_day, 0)',
}

/**
 * The live score brought to one moment `at` (core/stats.ts scoreNow, in SQL): the job stores each score at its own
 * updated_at, and every part of it halves each half_life_hours, so this orders rows computed at different times. A
 * dead end has no score (core/stats.ts ranks), so it sorts last.
 */
const liveSpec = (at: number, r: Ranking): ListSpec => ({
  where: TAB_SQL.live,
  k1: 'COALESCE(ns.score, 0) * pow(0.5, (julianday(?) - julianday(COALESCE(ns.updated_at, ?))) * 24.0 / ?)',
  k1Args: [new Date(at).toISOString(), new Date(at).toISOString(), r.half_life_hours],
})

// ---------- cards ----------

export type FeedCard = {
  id: number
  path: string
  kind: 'shwarm' | 'variant'
  title: string
  what: string
  doneWhen: string
  /** Its status as stored with its band (core/status.ts): the card's badge. */
  status: Status
  postedBy: string
  tags: string[]
  upvotes: number
  posts: number
  impact: number
  postsPerDay: number
  people: number
  hot: boolean
  surge: number | null // the hot badge's ratio: 24-hour upvotes over the 7-day daily average (as of the stats job)
  statusLine: string
  buildsOn: { name: string; url?: string; path?: string } | null
  at: string // the card's time: its last change, or when its status became passed or dead end
  /**
   * Its author's own approval, apart from its status (read/status.ts readAuthorApproved): "✓ author approved". As the
   * stats job last rolled it up (node_stats.author_approved), within minutes of the approval.
   */
  authorApproved: AuthorApproved | null
}

export type Feed = { tab: FeedTab; sort: FeedSort; query: Query; cards: FeedCard[]; next: string | null; paged: boolean; searchFailed: boolean }

type DetailRow = {
  id: number
  path: string
  kind: 'shwarm' | 'variant'
  title: string
  what: string
  done_when: string
  status: Status
  posted_by: string
  builds_on: string | null
  created_at: string
  changed_at: string | null
  status_at: string | null
  upvotes: number
  posts: number
  impact: number
  posts_per_day: number
  people: number
  hot: number
  surge: number | null
  status_line: string
  tags: string
  b_title: string | null
  b_path: string | null
  approved: string | null
  approved_by: string | null // the cited claimant's name as it reads now (NAME_SHOWN)
}

async function details(db: D1Database, ids: number[]): Promise<Map<number, FeedCard>> {
  const out = new Map<number, FeedCard>()
  if (!ids.length) return out
  const { results } = await db
    .prepare(
      `SELECT n.id, n.path, n.kind, n.title, n.what, n.done_when, ${STATUS} AS status, ${NAME_SHOWN('n.posted_by')} AS posted_by, n.builds_on,
              n.created_at, n.changed_at, bs.changed_at AS status_at,
              COALESCE(ns.upvotes, 0) AS upvotes, COALESCE(ns.posts, 0) AS posts, COALESCE(ns.impact, 0) AS impact,
              COALESCE(ns.posts_per_day, 0) AS posts_per_day, COALESCE(ns.people, 1) AS people, COALESCE(ns.hot, 0) AS hot,
              ns.surge, COALESCE(ns.status_line, '') AS status_line,
              (SELECT json_group_array(tag) FROM (SELECT tag FROM node_tag t WHERE t.node_id = n.id ORDER BY t.rowid)) AS tags,
              b.title AS b_title, b.path AS b_path,
              ns.author_approved AS approved,
              ${NAME_SHOWN("(CASE WHEN json_valid(ns.author_approved) THEN json_extract(ns.author_approved, '$.claim.by') END)")} AS approved_by
       FROM node n
       LEFT JOIN node_stats ns ON ns.node_id = n.id
       LEFT JOIN branch_status bs ON bs.node_id = n.id
       LEFT JOIN node b ON b.path = (CASE WHEN json_valid(n.builds_on) THEN json_extract(n.builds_on, '$.node') END) AND ${visibleSql('b')}
       WHERE n.id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(ids))
    .all<DetailRow>()

  for (const r of results) {
    let tags: string[] = []
    try {
      tags = (JSON.parse(r.tags) as unknown[]).filter((t): t is string => typeof t === 'string')
    } catch {
      // no tags
    }
    out.set(r.id, {
      id: r.id,
      path: r.path,
      kind: r.kind,
      title: r.title,
      what: r.what,
      doneWhen: r.done_when,
      status: r.status,
      postedBy: r.posted_by,
      tags: humansFirst(tags),
      upvotes: r.upvotes,
      posts: r.posts,
      impact: r.impact,
      postsPerDay: r.posts_per_day,
      people: r.people,
      hot: !!r.hot,
      surge: r.hot && r.surge ? r.surge : null,
      statusLine: r.status_line,
      buildsOn: buildsOn(r),
      at: r.status === 'passed' || r.status === 'dead_end' ? (r.status_at ?? r.created_at) : (r.changed_at ?? r.created_at),
      authorApproved: approvedOf(r.approved, r.approved_by),
    })
  }
  return out
}

/**
 * The stored approval (jobs/stats.ts: when, and the claim's post and stored name) with the claimant's name as it reads
 * now, `by` (read/names.ts NAME_SHOWN): "former member" once that account is closed, before the job rolls it up again.
 */
function approvedOf(json: string | null, by: string | null): AuthorApproved | null {
  if (!json) return null
  try {
    const a = JSON.parse(json) as { at?: unknown; claim?: { post?: unknown } | null }
    return typeof a?.at === 'string' ? { at: a.at, claim: typeof a.claim?.post === 'string' && by !== null ? { post: a.claim.post, by } : null } : null
  } catch {
    return null
  }
}

function buildsOn(r: DetailRow): FeedCard['buildsOn'] {
  if (!r.builds_on) return null
  let b: any
  try {
    b = JSON.parse(r.builds_on)
  } catch {
    return null
  }
  if (b && typeof b.node === 'string') return r.b_title && r.b_path ? { name: r.b_title, path: r.b_path } : null
  if (b && typeof b.name === 'string' && b.name) return { name: b.name, ...(typeof b.url === 'string' ? { url: b.url } : {}) }
  return null
}

// ---------- the feed ----------

export type FeedOptions = { tab?: string | null; sort?: string | null; q?: string | null; tag?: string | null; after?: string | null }

/** One page of a tab: its cards, best first, and the cursor for the next page (null on the last). */
export async function loadFeed(db: D1Database, opts: FeedOptions, now = Date.now()): Promise<Feed> {
  const { tab, sort } = feedView(opts.tab, opts.sort)
  const query = parseQuery([opts.q ?? '', opts.tag ? `#${opts.tag}` : ''].join(' '))
  const cursor = decodeCursor(opts.after, tab, sort)

  const filter = { sql: '', args: [] as unknown[] }
  for (const t of query.tags) {
    filter.sql += ' AND n.id IN (SELECT node_id FROM node_tag WHERE tag = ?)'
    filter.args.push(t)
  }
  if (query.words.length) {
    filter.sql += ' AND n.id IN (SELECT rowid FROM node_fts WHERE node_fts MATCH ?)'
    filter.args.push(ftsQuery(query.words))
  }

  const base = { tab, sort, query, paged: !!cursor }
  try {
    if (sort === 'hot') return { ...base, ...(await hot(db, filter, cursor, now)), searchFailed: false }
    const spec: ListSpec = { where: TAB_SQL[tab], k1: SORT_KEY[sort] ?? (tab === 'live' ? 'n.created_at' : PASSED_AT) }
    const rows = await list(db, spec, filter, cursor?.k, PAGE_SIZE + 1)
    const page = rows.slice(0, PAGE_SIZE)
    const cards = await details(db, page.map(r => r.id))
    const next = rows.length > PAGE_SIZE ? encodeCursor({ t: tab, s: sort, k: keyOf(page[page.length - 1]) }) : null
    return { ...base, cards: page.map(r => cards.get(r.id)).filter((c): c is FeedCard => !!c), next, searchFailed: false }
  } catch (e) {
    // A search FTS5 can't read shows as no results, never a 500. parseQuery should make this unreachable.
    if (!query.words.length) throw e
    console.error('feed search failed', { words: query.words, error: String(e) })
    return { ...base, cards: [], next: null, searchFailed: true }
  }
}

async function hot(db: D1Database, filter: { sql: string; args: unknown[] }, cursor: Cursor | null, now: number) {
  const r = rankingFrom(await readSettings(db, ['hot_floor', 'ranking']))
  // Every page of one walk through hot ranks at the same moment. A cursor older than a week starts again from now.
  const at = cursor?.at && Math.abs(now - cursor.at) < WEEK_MS ? cursor.at : now
  const rows = await list(db, liveSpec(at, r), filter, cursor?.at === at ? cursor.k : undefined, PAGE_SIZE + 1)
  const page = rows.slice(0, PAGE_SIZE)
  const next = rows.length > PAGE_SIZE ? encodeCursor({ t: 'live', s: 'hot', at, k: keyOf(page[page.length - 1]) }) : null
  const cards = await details(db, page.map(x => x.id))
  return { cards: page.map(x => cards.get(x.id)).filter((c): c is FeedCard => !!c), next }
}
