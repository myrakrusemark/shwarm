// The private inbox (go-live 6.1, PRD PROF-5, spec "The inbox is private"): one person's items for their own profile,
// the "for you" count in the strip, and the owner's read marks. Read only for the signed-in owner (web/profile.tsx,
// web/viewer.tsx); nobody else's session ever reaches these queries.
//
// An item shows while what it points at shows to its owner: its node (SEEN_NODE: open to everyone, or their own node
// still being checked) and, for one that names a post (a mention, a pass notice, an old sign-off), its post (not hidden
// or deleted). Sign-off items are history: nothing asks for a sign-off since Oct 14 ("One model for every node"), and
// migration 0032 marked the waiting ones done. The list, the count and
// "mark all read" use the same rule, so marking every item shown read takes the count to nothing.
import { INBOX_LINK_COLS, INBOX_LINK_JOIN, inboxHref } from './inbox-links'
import { NAME_SHOWN } from './names'
import { SEEN_NODE } from './visibility'

/** FROM and WHERE for one person's shown items; the person's id is bound as ?1. */
const SHOWN = `FROM inbox_item i ${INBOX_LINK_JOIN} LEFT JOIN post p ON p.id = i.post_id
  WHERE i.person_id = ?1 AND (i.node_id IS NULL OR (n.id IS NOT NULL AND ${SEEN_NODE('n', '?1')}))
    AND (i.post_id IS NULL OR (p.id IS NOT NULL AND p.hidden = 0 AND p.deleted_at IS NULL))`

/** The strip counts unread items up to this many and shows "99+" past 99. */
export const UNREAD_CAP = 100

/** Unread shown items, counted up to UNREAD_CAP: the strip's "for you N" and the inbox's "N new". */
export async function unreadCount(db: D1Database, personId: number): Promise<number> {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 ${SHOWN} AND i.read_at IS NULL LIMIT ${UNREAD_CAP})`).bind(personId).first<number>('n')) ?? 0
}

/**
 * kind 'system' is a notice from the site: a node's news, or (with a post) the pass notice, "<shwarm> passed: its
 * people back @ana's passed claim. mark it passed too?", which goes to the shwarm's author (core/status.ts
 * flipStatements) and opens the pass box (inbox-links.ts); its words are written as it shows, with the claimant's name
 * as it reads now (`as_name`). kind 'sign_off' is an old sign-off item, read as history.
 */
export type InboxItem = {
  id: number
  kind: 'mention' | 'sign_off' | 'system'
  href: string // where it opens (inbox-links.ts)
  text: string // a system item's words; a sign-off's as core wrote them
  created_at: string
  read: boolean
  done: boolean // a pass notice the author has answered with their own mark (core/records.ts)
  node_id: number | null
  path: string | null
  title: string | null // the node's title now
  as_name: string | null // who wrote the mention or the claim, or the submission
  post_id: string | null
  post_text: string | null // a mention's post
  number: number | null // a sign-off's submission
  status: 'in_review' | 'passed' | 'failed' | 'superseded' | null // a sign-off's submission, as it ended
}

/** Items the inbox shows before "show all". */
export const INBOX_SHOWN = 25

/**
 * One person's inbox, newest first: INBOX_SHOWN items, or up to `max` with "show all". `more` when there are others
 * past those; `upto` is the newest item's id, which "mark all read" stops at, so an item that arrives after the page
 * was drawn stays new.
 */
export async function readInbox(db: D1Database, personId: number, o: { all: boolean; max: number }): Promise<{ items: InboxItem[]; more: boolean; upto: number }> {
  const limit = o.all ? o.max : INBOX_SHOWN
  const { results } = await db
    .prepare(
      `SELECT i.id, ${INBOX_LINK_COLS}, i.text, i.created_at, i.read_at, i.done_at, i.node_id, n.title,
              ${NAME_SHOWN('p.as_name')} AS as_name, p.text AS post_text, s.status
       ${SHOWN}
       ORDER BY i.created_at DESC, i.id DESC LIMIT ?2`,
    )
    .bind(personId, limit + 1)
    .all<{
      id: number
      kind: InboxItem['kind']
      post_id: string | null
      node_path: string | null
      number: number | null
      text: string
      created_at: string
      read_at: string | null
      done_at: string | null
      node_id: number | null
      title: string | null
      as_name: string | null
      post_text: string | null
      status: InboxItem['status']
    }>()
  const items = results.slice(0, limit).map(
    (r): InboxItem => ({
      id: r.id,
      kind: r.kind,
      href: inboxHref(r),
      text: r.text,
      created_at: r.created_at,
      read: r.read_at !== null,
      done: r.done_at !== null,
      node_id: r.node_id,
      path: r.node_path,
      title: r.title,
      as_name: r.as_name,
      post_id: r.post_id,
      post_text: r.kind === 'mention' ? r.post_text : null,
      number: r.number,
      status: r.status,
    }),
  )
  return { items, more: results.length > limit, upto: items.reduce((m, i) => Math.max(m, i.id), 0) }
}

/** The mention an inline reply answers: one of this person's shown mention items, with its post's thread. */
export async function readReplyTarget(db: D1Database, personId: number, itemId: number): Promise<{ post_id: string; node_id: number; path: string; kind: string } | null> {
  return db
    .prepare(`SELECT p.id AS post_id, n.id AS node_id, n.path, n.kind ${SHOWN} AND i.id = ?2 AND i.kind = 'mention'`)
    .bind(personId, itemId)
    .first()
}

// ---------- the owner's read marks ----------

/** Mark one of this person's items read (keeping when it was first read) or unread. Anyone else's item is untouched. */
export async function markRead(db: D1Database, personId: number, itemId: number, read: boolean, at: string): Promise<void> {
  await db
    .prepare(read ? 'UPDATE inbox_item SET read_at = COALESCE(read_at, ?3) WHERE id = ?2 AND person_id = ?1' : 'UPDATE inbox_item SET read_at = NULL WHERE id = ?2 AND person_id = ?1')
    .bind(personId, itemId, ...(read ? [at] : []))
    .run()
}

/** "mark all read": every unread shown item up to `upto`, the newest one on the page the person saw. */
export async function markAllRead(db: D1Database, personId: number, upto: number, at: string): Promise<void> {
  await db
    .prepare(`UPDATE inbox_item SET read_at = ?2 WHERE person_id = ?1 AND read_at IS NULL AND id <= ?3 AND id IN (SELECT i.id ${SHOWN})`)
    .bind(personId, at, upto)
    .run()
}
