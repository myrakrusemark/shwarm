// The public tombstone for a node the operator hid (decided Oct 8: hiding always leaves a public tombstone).
// A hidden node, or a branch under one, answers 410 instead of 404, says it was taken down, and gives the
// operator's public reason when the hide was logged as public. Its title and text never show.
//
// OPEN: the tombstone's wording, and whether the reason shows here or only in the moderation log (8.5).
import { prefixes } from './node'

export type Tombstone = {
  /** True when the requested node itself was hidden; false when a node above it was. */
  self: boolean
  kind: 'shwarm' | 'branch' | 'variant'
  reason: string | null
}

/** Null unless a node exists at `path` and it, or a node above it, is hidden. */
export async function readTombstone(db: D1Database, path: string): Promise<Tombstone | null> {
  const row = await db
    .prepare(
      `SELECT h.path, t.kind,
              (SELECT m.reason FROM moderation_action m WHERE m.node_id = h.id AND m.action = 'hide' AND m.public = 1
                ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS reason
       FROM node t JOIN node h ON h.path IN (SELECT value FROM json_each(?)) AND h.hidden = 1
       WHERE t.path = ?
       ORDER BY length(h.path) LIMIT 1`,
    )
    .bind(JSON.stringify(prefixes(path)), path)
    .first<{ path: string; kind: Tombstone['kind']; reason: string | null }>()
  if (!row) return null
  return { self: row.path === path, kind: row.kind, reason: row.reason?.trim() || null }
}
