// Token buckets in the Worker isolate's memory: a burst, then a steady refill, at no cost in D1. Each isolate keeps its
// own count, so a caller spread over many isolates gets more; the public read caps (web/read-limit.ts) and the agent
// API's per-key cap on reads (api/limits.ts) accept that to keep reads from writing rows.

export type Taken = { tokens: number; wait: number | null }

/** One token bucket per key, kept to `max` keys. */
export function memoryBuckets(burst: number, refillPerS: number, max = 5000) {
  const buckets = new Map<string, { tokens: number; at: number }>()
  /** Takes one: what is left after it, or the seconds to wait when there was none to take. */
  function take(key: string, now = Date.now()): Taken {
    const b = buckets.get(key)
    const tokens = b ? Math.min(burst, b.tokens + ((now - b.at) / 1000) * refillPerS) : burst
    if (tokens < 1) {
      buckets.set(key, { tokens, at: now })
      return { tokens, wait: Math.max(1, Math.ceil((1 - tokens) / refillPerS)) }
    }
    if (!b && buckets.size >= max) {
      // Drop the full buckets (nobody near the cap) first, then the oldest, so the map stays small.
      for (const [k, v] of buckets) if (v.tokens + ((now - v.at) / 1000) * refillPerS >= burst) buckets.delete(k)
      if (buckets.size >= max) buckets.delete(buckets.keys().next().value!)
    }
    buckets.delete(key) // re-insert, so map order is least recently used first
    buckets.set(key, { tokens: tokens - 1, at: now })
    return { tokens: tokens - 1, wait: null }
  }
  return { take, clear: () => buckets.clear() }
}
