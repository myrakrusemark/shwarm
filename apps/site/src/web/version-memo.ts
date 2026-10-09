// The last signed-out ETag this isolate worked out for each node view, so a repeat read with If-None-Match can be
// answered 304 with no D1 read (go-live 4.9). An entry is trusted for 15 seconds after D1 gave it, the same window
// `s-maxage=15` already lets a shared cache keep the whole page; past that the next 304 reads the node chain again.
// A write handled by this isolate forgets every entry once it's done.
//
// OPEN (proposed, open #80): a new post or a takedown made through another isolate (or straight in D1) can answer
// 304 here for up to 15 seconds to a reader who already has the page. VERSION_MEMO_MS = 0 turns this off and makes
// every 304 one indexed chain query again.
export const VERSION_MEMO_MS = 15_000 // as long as s-maxage
const MAX_KEYS = 5000

const memo = new Map<string, { etag: string; at: number }>()

/** The ETag D1 gave this view less than 15 seconds ago, or null. */
export function knownVersion(key: string, now = Date.now()): string | null {
  const m = memo.get(key)
  if (!m) return null
  if (now - m.at < VERSION_MEMO_MS) return m.etag
  memo.delete(key)
  return null
}

/** Notes the ETag just read from D1 for this view. */
export function noteVersion(key: string, etag: string, now = Date.now()): void {
  if (VERSION_MEMO_MS <= 0) return
  memo.delete(key) // re-insert, so map order is oldest first
  if (memo.size >= MAX_KEYS) memo.delete(memo.keys().next().value!)
  memo.set(key, { etag, at: now })
}

/** After a write in this isolate, and for tests. */
export function forgetVersions(): void {
  memo.clear()
}
