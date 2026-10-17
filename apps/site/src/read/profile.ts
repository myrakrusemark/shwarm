// Reads for the public profile and the name view (go-live 3.5, PRD §6.8). All SQL for /@handle lives here.
// Never reads email, password, notice settings or anything else private: the person query names its columns.
//
// A page is at most four queries (the person, then working on, created and the head figures at once), plus the
// name view's posts. Each is indexed by person: post_person, seat_person, node_author_created and the
// person_node_stats key. The site average sums node_stats over open nodes (one row per node).
import { WEEK_MS, impact } from '../core/stats'
import type { Claim, Status } from '../core/status'
import { figuresOf, type Figures } from './figures'
import { PUBLIC_NODE } from './visibility'

export type NodeKind = 'shwarm' | 'branch' | 'variant'

/** The public face of an account. */
export type Person = {
  id: number
  handle: string
  display_name: string
  about: string
  links: string // JSON [{label, url}]
  status: 'active' | 'suspended' | 'closed'
  verified: number // 1 once the email is verified; unverified accounts have no public page
  created_at: string
}

export async function findPerson(db: D1Database, handle: string): Promise<Person | null> {
  return db
    .prepare('SELECT id, handle, display_name, about, links, status, email_verified_at IS NOT NULL AS verified, created_at FROM person WHERE handle = ?')
    .bind(handle)
    .first<Person>()
}

/** Profile links as stored ([{label, url}]), keeping only well-formed string pairs. */
export function linksOf(json: string): { label: string; url: string }[] {
  let v: unknown
  try {
    v = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(v)) return []
  return v
    .filter((l): l is { label?: unknown; url: unknown } => !!l && typeof l === 'object' && typeof (l as { url?: unknown }).url === 'string')
    .map(l => ({ label: typeof l.label === 'string' ? l.label : '', url: l.url as string }))
    .filter(l => l.url.trim() !== '')
    .slice(0, 5) // OPEN: the account modal has two (website, code); no cap is decided
}

/** `status`: its status as stored with its band (core/status.ts), the row's badge. */
type NodeBits = { id: number; path: string; kind: NodeKind; title: string; status: Status | null; up_title: string | null }

export type WorkingRow = NodeBits & { last_post: string | null; joined_at: string | null; figures: Figures | null }
export type CreatedRow = NodeBits & { done_when: string; triage: string; public: number }
export type Head = { workingOn: number; workingMore: boolean; postsThisWeek: number; perPost: number | null; siteAvg: number | null }

export type Profile = { working: WorkingRow[]; created: CreatedRow[]; createdMore: boolean; head: Head }

/** Rows a list reads at most; the page shows fewer unless asked for all (OPEN: no paging is mocked). */
export const LIST_MAX = 500

// A branch's parent's title, only while that node is public (A7, A8): a branch of a hidden or held node reads plain
// "branch". (Variants are dropped, decided Oct 9: one made before reads as a shwarm, with no original.)
const UP = 'LEFT JOIN node up ON up.id = n.parent_id'
const UP_TITLE = `CASE WHEN ${PUBLIC_NODE('up')} THEN up.title END AS up_title`
/** A node's status as stored with its band: NULL while it has none. */
const STATUS = '(SELECT b.current FROM branch_status b WHERE b.node_id = n.id) AS status'

/**
 * Working on, created and the head figures.
 * Working on: open nodes where the person counts among the node's people (table B #44, core/stats people()): they
 * joined it (said they're working on it), posted there (themselves or by agent) in the last 7 days, or authored it.
 * A node drops off a week after their last post unless they joined it or wrote it. The row still shows their last post, however old.
 * Created: nodes they authored; the owner also sees their own nodes that are still being checked, held or blocked.
 */
export async function readProfile(db: D1Database, personId: number, o: { owner: boolean; now: number }): Promise<Profile> {
  const weekAgo = new Date(o.now - WEEK_MS).toISOString()
  const [working, created, head] = await Promise.all([
    db
      .prepare(
        `WITH mine AS (SELECT node_id, MAX(created_at) AS last_post, SUM(created_at > ?2) AS n7 FROM post WHERE person_id = ?1 AND hidden = 0 GROUP BY node_id),
              seats AS (SELECT node_id, joined_at FROM seat WHERE person_id = ?1 AND left_at IS NULL),
              ids AS (SELECT node_id FROM mine WHERE n7 > 0 UNION SELECT node_id FROM seats UNION SELECT id FROM node WHERE author_id = ?1)
         SELECT n.id, n.path, n.kind, n.title, ${STATUS}, n.created_at, ${UP_TITLE},
                m.last_post, COALESCE(m.n7, 0) AS n7, s.joined_at, st.posts, st.upvotes
         FROM ids JOIN node n ON n.id = ids.node_id ${UP}
         LEFT JOIN mine m ON m.node_id = n.id
         LEFT JOIN seats s ON s.node_id = n.id
         LEFT JOIN person_node_stats st ON st.person_id = ?1 AND st.node_id = n.id
         WHERE ${PUBLIC_NODE('n')}
         ORDER BY COALESCE(m.last_post, s.joined_at, n.created_at) DESC, n.id DESC LIMIT ?3`,
      )
      .bind(personId, weekAgo, LIST_MAX + 1)
      .all<NodeBits & { created_at: string; last_post: string | null; n7: number; joined_at: string | null; posts: number | null; upvotes: number | null }>(),
    db
      .prepare(
        `SELECT n.id, n.path, n.kind, n.title, n.done_when, ${STATUS}, n.triage, ${UP_TITLE},
                ${PUBLIC_NODE('n')} AS public
         FROM node n ${UP}
         WHERE n.author_id = ?1 AND n.hidden = 0 AND (?2 OR ${PUBLIC_NODE('n')})
         ORDER BY n.created_at DESC, n.id DESC LIMIT ?3`,
      )
      .bind(personId, o.owner ? 1 : 0, LIST_MAX + 1)
      .all<CreatedRow>(),
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM post p JOIN node n ON n.id = p.node_id WHERE p.person_id = ?1 AND p.hidden = 0 AND p.created_at > ?2 AND ${PUBLIC_NODE('n')}) AS week,
           (SELECT COALESCE(SUM(st.upvotes), 0) FROM person_node_stats st JOIN node n ON n.id = st.node_id WHERE st.person_id = ?1 AND ${PUBLIC_NODE('n')}) AS ups,
           (SELECT COALESCE(SUM(st.posts), 0) FROM person_node_stats st JOIN node n ON n.id = st.node_id WHERE st.person_id = ?1 AND ${PUBLIC_NODE('n')}) AS posts,
           (SELECT COALESCE(SUM(ns.upvotes), 0) FROM node_stats ns JOIN node n ON n.id = ns.node_id WHERE ${PUBLIC_NODE('n')}) AS site_ups,
           (SELECT COALESCE(SUM(ns.posts), 0) FROM node_stats ns JOIN node n ON n.id = ns.node_id WHERE ${PUBLIC_NODE('n')}) AS site_posts`,
      )
      .bind(personId, weekAgo)
      .first<{ week: number; ups: number; posts: number; site_ups: number; site_posts: number }>(),
  ])
  const w = working.results
  const rows: WorkingRow[] = w.slice(0, LIST_MAX).map(({ created_at, n7, posts, upvotes, ...r }) => ({
    ...r,
    // No figures until the stats job has counted their posts here (a join alone, or posts in the last few minutes).
    figures: posts ? figuresOf({ posts, upvotes: upvotes ?? 0, posts7: n7, nodeCreatedAt: created_at }, o.now) : null,
  }))
  const h = head ?? { week: 0, ups: 0, posts: 0, site_ups: 0, site_posts: 0 }
  return {
    working: rows,
    created: created.results.slice(0, LIST_MAX),
    createdMore: created.results.length > LIST_MAX,
    head: {
      workingOn: rows.length,
      workingMore: w.length > LIST_MAX,
      postsThisWeek: h.week,
      perPost: h.posts > 0 ? impact(h.ups, h.posts) : null,
      siteAvg: h.site_posts > 0 ? impact(h.site_ups, h.site_posts) : null,
    },
  }
}

// ---------- the name view ----------

export type NamePost = {
  id: string
  kind: 'post' | 'submission' | 'check' | 'repro' | 'dead_end'
  text: string
  created_at: string
  reply_to: string | null
  path: string
  title: string
  number: number | null // a submission's number
  verdict: 'pass' | 'fail' | null // a check's verdict
  on_number: number | null // the submission a check is on
  claim: Claim | null // a claim's status (decided Oct 14)
  links: string // JSON: on a passed claim, its pinned work
}

export const NAME_PAGE = 25

/** "2026-10-08T12:00:00.000Z~p_abc": the paging cursor after a post. */
export const cursorOf = (p: { created_at: string; id: string }) => `${p.created_at}~${p.id}`
function parseCursor(s: string | undefined | null): [string, string] | null {
  const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z)~(p_[A-Za-z0-9_-]{1,64})$/.exec(s ?? '')
  return m ? [m[1], m[2]] : null
}

/**
 * One name's own posts, newest first: posts it made, not posts that mention it (PRD PROF-6). A post its poster deleted
 * isn't listed; its tombstone stays in its thread.
 * OPEN: the exact name only; @myra/fathom-lead doesn't include @myra/fathom-lead/scout. (Mentions match a name and
 * everything under it; posts aren't decided.)
 */
export async function readNamePosts(db: D1Database, personId: number, name: string, before?: string | null): Promise<{ posts: NamePost[]; next: string | null }> {
  const c = parseCursor(before)
  const { results } = await db
    .prepare(
      `SELECT p.id, p.kind, p.text, p.created_at, p.reply_to, n.path, n.title, s.number, cr.verdict, os.number AS on_number, p.claim, p.links
       FROM post p JOIN node n ON n.id = p.node_id
       LEFT JOIN submission s ON s.post_id = p.id
       LEFT JOIN check_report cr ON cr.post_id = p.id
       LEFT JOIN submission os ON os.post_id = cr.submission_id
       WHERE p.person_id = ?1 AND p.as_name = ?2 AND p.hidden = 0 AND p.deleted_at IS NULL AND ${PUBLIC_NODE('n')}
         AND (?3 IS NULL OR (p.created_at, p.id) < (?3, ?4))
       ORDER BY p.created_at DESC, p.id DESC LIMIT ?5`,
    )
    .bind(personId, name, c?.[0] ?? null, c?.[1] ?? null, NAME_PAGE + 1)
    .all<NamePost>()
  const posts = results.slice(0, NAME_PAGE)
  return { posts, next: results.length > NAME_PAGE ? cursorOf(posts[posts.length - 1]) : null }
}

