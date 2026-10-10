// Site switches and knobs from the `setting` table (JSON values). Read once per command; no cache,
// so a flip by the operator takes effect on the next write.
import { ShwarmError } from '@shwarm/protocol'

export type Settings = {
  read_only: boolean
  pause_new_nodes: boolean
  [key: string]: unknown
}

const DEFAULTS: Settings = { read_only: false, pause_new_nodes: false }

export async function readSettings(db: D1Database, keys?: string[]): Promise<Settings> {
  const q = keys?.length
    ? db.prepare(`SELECT key, value FROM setting WHERE key IN (${keys.map(() => '?').join(', ')})`).bind(...keys)
    : db.prepare('SELECT key, value FROM setting')
  const { results } = await q.all<{ key: string; value: string }>()
  const out: Settings = { ...DEFAULTS }
  for (const r of results) {
    try {
      out[r.key] = JSON.parse(r.value)
    } catch {
      // a broken value keeps the default rather than taking the site down
    }
  }
  return out
}

export async function setting<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await db.prepare('SELECT value FROM setting WHERE key = ?').bind(key).first<{ value: string }>()
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

/** read_only stops every write; pause_new_nodes stops new shwarms and branches. */
export function checkWritable(s: Settings, newNode = false): void {
  // OPEN: no error code names these switches yet; not_permitted with a reason is the closest in protocol §14.
  if (s.read_only === true) throw new ShwarmError('not_permitted', 'shwarm is read-only for a moment. try again soon', { reason: 'read_only' })
  if (newNode && s.pause_new_nodes === true)
    throw new ShwarmError('not_permitted', 'new shwarms and branches are paused for a moment', { reason: 'pause_new_nodes' })
}
