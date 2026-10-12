// The keys page's reads (go-live 7.2, mockups/keys.html): the owner's keys with their grants, and the grant chooser's
// lookups (shwarms you're in, a search, a node's branches, a pasted link). Only for the signed-in owner; titles come
// only from nodes that show to them (SEEN_NODE), so a grant on a node that's since been hidden shows its path instead.
import type { Perm } from '../core/actor'
import { ACTIVE_KEY } from '../auth/keys'
import { parseNodePath, prefixes } from './node'
import { SEEN_NODE } from './visibility'

/** One grant as the list shows it: the node ('*' or a path), each step's title from the shwarm down (null where it doesn't show), the perms. */
export type GrantRow = { node: string; titles: (string | null)[]; perms: Perm[] }

export type KeyRow = {
  id: string
  name: string
  can_post_as: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  last_used_as: string | null
  last_used_node: string | null
  /** The last-used node's own title, when it shows. */
  last_used_title: string | null
  grants: GrantRow[]
  /** the key may send and read direct messages (7.17) */
  dm: boolean
  /** revoked or past its expiry */
  ended: boolean
}

/** How long a revoked or expired key stays on the list, greyed. OPEN (#88). */
export const ENDED_SHOWN_DAYS = 30

type Raw = Omit<KeyRow, 'grants' | 'ended' | 'last_used_title' | 'dm'> & { grants: string; active: number; dm: number }

/**
 * The person's keys: every active one, then those that ended in the last ENDED_SHOWN_DAYS, newest first in each.
 * Grants in path order, '*' first.
 */
export async function readKeys(db: D1Database, personId: number, now = Date.now()): Promise<KeyRow[]> {
  const at = new Date(now).toISOString()
  const since = new Date(now - ENDED_SHOWN_DAYS * 86_400_000).toISOString()
  const { results } = await db
    .prepare(
      `SELECT k.id, k.name, k.can_post_as, k.created_at, k.expires_at, k.revoked_at, k.last_used_at, k.last_used_as, k.last_used_node, k.dm,
              ${ACTIVE_KEY('k', '?2')} AS active,
              (SELECT json_group_array(json_object('node', g.node, 'perms', json(g.perms))) FROM (SELECT * FROM key_grant WHERE key_id = k.id ORDER BY node) g) AS grants
       FROM agent_key k
       WHERE k.person_id = ?1 AND (${ACTIVE_KEY('k', '?2')} OR coalesce(k.revoked_at, k.expires_at) > ?3)
       ORDER BY active DESC, k.created_at DESC, k.id`,
    )
    .bind(personId, at, since)
    .all<Raw>()
  const keys = results.map(r => ({ ...r, grants: JSON.parse(r.grants) as { node: string; perms: Perm[] }[] }))
  // Every title the list needs, in one read: each grant's steps and each last-used node.
  const paths = new Set<string>()
  for (const k of keys) {
    for (const g of k.grants) if (g.node !== '*') prefixes(g.node).forEach(p => paths.add(p))
    if (k.last_used_node) paths.add(k.last_used_node)
  }
  const titles = await titlesOf(db, personId, [...paths])
  return keys.map(({ active, ...k }) => ({
    ...k,
    ended: !active,
    dm: k.dm === 1,
    last_used_title: k.last_used_node ? (titles.get(k.last_used_node) ?? null) : null,
    grants: k.grants.map(g => ({ node: g.node, perms: g.perms, titles: g.node === '*' ? [] : prefixes(g.node).map(p => titles.get(p) ?? null) })),
  }))
}

/** path → title, for the paths that show to the person. */
async function titlesOf(db: D1Database, personId: number, paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map()
  const { results } = await db
    .prepare(`SELECT n.path, n.title FROM node n WHERE n.path IN (SELECT value FROM json_each(?1)) AND ${SEEN_NODE('n', '?2')}`)
    .bind(JSON.stringify(paths), personId)
    .all<{ path: string; title: string }>()
  return new Map(results.map(r => [r.path, r.title]))
}

/** Each grant as one line of text, for the modal's last step: "all shwarms", or "minecraft in doom / block placement". */
export async function grantLabels(db: D1Database, personId: number, grants: { node: string }[]): Promise<string[]> {
  const titles = await titlesOf(db, personId, grants.flatMap(g => (g.node === '*' ? [] : prefixes(g.node))))
  return grants.map(g => (g.node === '*' ? 'all shwarms' : prefixes(g.node).map(p => titles.get(p) ?? p.split('/').pop()!).join(' / ')))
}

// ---------- the grant chooser ----------

/** A row in the chooser: a node, its title, and how many of its branches show (the "3 ▸" that drills in). */
export type ChoiceRow = { path: string; title: string; kids: number }

const CHOICES = 20 // rows per answer. OPEN (#88).

const KIDS = `(SELECT COUNT(*) FROM node c WHERE c.parent_id = n.id AND ${SEEN_NODE('c', '?1')}) AS kids`

/**
 * The chooser's first list, before anything is typed: the shwarms the person is in, by a seat (in the shwarm or any of
 * its branches) or as the author of it or a branch in it. Newest first.
 */
export async function readYoureIn(db: D1Database, personId: number): Promise<ChoiceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT n.path, n.title, ${KIDS} FROM node n
       WHERE n.parent_id IS NULL AND ${SEEN_NODE('n', '?1')}
         AND (n.author_id = ?1
           OR EXISTS (SELECT 1 FROM seat s JOIN node m ON m.id = s.node_id WHERE s.person_id = ?1 AND s.left_at IS NULL AND (m.id = n.id OR m.root_id = n.id))
           OR EXISTS (SELECT 1 FROM node m WHERE m.root_id = n.id AND m.author_id = ?1))
       ORDER BY n.created_at DESC, n.id DESC LIMIT ${CHOICES}`,
    )
    .bind(personId)
    .all<ChoiceRow>()
  return results
}

/** Shwarms whose title holds `q` (any case), newest first. OPEN (#88): a plain substring match, not the feed's search. */
export async function searchShwarms(db: D1Database, personId: number, q: string): Promise<ChoiceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT n.path, n.title, ${KIDS} FROM node n
       WHERE n.parent_id IS NULL AND instr(lower(n.title), lower(?2)) > 0 AND ${SEEN_NODE('n', '?1')}
       ORDER BY n.created_at DESC, n.id DESC LIMIT ${CHOICES}`,
    )
    .bind(personId, q)
    .all<ChoiceRow>()
  return results
}

/** A node the person can see, found by its path or by any link into it (/w/<path>/s/3 and the like): its path, each step's title, its branch count. */
export async function resolveNode(db: D1Database, personId: number, raw: string): Promise<{ path: string; titles: string[]; kids: number } | null> {
  const p = parseNodePath(raw.replace(/^\/+|\/+$/g, ''))
  if (p.kind === 'bad') return null
  const steps = prefixes(p.path)
  const { results } = await db
    .prepare(
      `SELECT n.path, n.title, CASE WHEN n.path = ?3 THEN ${KIDS.replace(' AS kids', '')} END AS kids FROM node n
       WHERE n.path IN (SELECT value FROM json_each(?2)) AND ${SEEN_NODE('n', '?1')}`,
    )
    .bind(personId, JSON.stringify(steps), p.path)
    .all<{ path: string; title: string; kids: number | null }>()
  if (results.length !== steps.length) return null
  const by = new Map(results.map(r => [r.path, r]))
  return { path: p.path, titles: steps.map(s => by.get(s)!.title), kids: by.get(p.path)!.kids ?? 0 }
}

/** The branches right under a node, oldest first (as the node page lists them), or null when the node doesn't show. */
export async function readBranchesUnder(db: D1Database, personId: number, path: string): Promise<ChoiceRow[] | null> {
  const parent = await resolveNode(db, personId, path)
  if (!parent) return null
  const { results } = await db
    .prepare(
      `SELECT n.path, n.title, ${KIDS} FROM node n
       WHERE n.parent_id = (SELECT id FROM node WHERE path = ?2) AND ${SEEN_NODE('n', '?1')}
       ORDER BY n.created_at, n.id LIMIT 100`,
    )
    .bind(personId, parent.path)
    .all<ChoiceRow>()
  return results
}
