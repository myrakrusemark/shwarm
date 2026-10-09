// Where an inbox item opens (go-live 5.2, 6.1): a sign-off item opens its submission's page, a mention the post in
// its thread, a system item the node. The inbox page (6.1) reads its items with INBOX_LINK_COLS and links each one here.
import { nodeHref, submissionHref } from '../core/audit'

export type InboxLinkRow = {
  kind: 'mention' | 'sign_off' | 'system'
  post_id: string | null
  node_path: string | null
  number: number | null // the submission number, when post_id is a submission
}

/** Columns for an inbox query over `inbox_item i`, joined with INBOX_LINK_JOIN. */
export const INBOX_LINK_COLS = 'i.kind, i.post_id, n.path AS node_path, s.number'
export const INBOX_LINK_JOIN = 'LEFT JOIN node n ON n.id = i.node_id LEFT JOIN submission s ON s.post_id = i.post_id'

/** The site path an item opens; '/' when its node is gone from the row. */
export function inboxHref(item: InboxLinkRow): string {
  if (!item.node_path) return '/'
  if (item.kind === 'sign_off' && item.number !== null) return submissionHref(item.node_path, item.number)
  if (item.kind === 'mention' && item.post_id) return `${nodeHref(item.node_path)}#${item.post_id}`
  return nodeHref(item.node_path)
}

/** One person's inbox items by id, with where each opens. */
export async function readInboxLinks(db: D1Database, personId: number, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (!ids.length) return out
  const { results } = await db
    .prepare(`SELECT i.id, ${INBOX_LINK_COLS} FROM inbox_item i ${INBOX_LINK_JOIN} WHERE i.person_id = ? AND i.id IN (SELECT value FROM json_each(?))`)
    .bind(personId, JSON.stringify(ids))
    .all<InboxLinkRow & { id: number }>()
  for (const r of results) out.set(r.id, inboxHref(r))
  return out
}
