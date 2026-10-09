// The per-IP token bucket on public reads (go-live 3.6, table B "technical caps"): a burst, then a steady refill;
// past it, 429 with Retry-After.
//
// OPEN: the bucket lives in the Worker isolate's memory, not in D1's rate_bucket table. A D1 bucket costs one row
// write per page view, and the free plan's 100,000 writes a day would then be spent by readers (a crawler could use
// up the writes that posting needs). In memory it costs nothing, but each isolate keeps its own count, so a reader
// spread over many isolates gets more. The numbers are first guesses; nothing is decided. A Workers rate-limit
// binding, or rate_bucket for heavy hitters only, is the step up (4.9 tests the cap).
import { ipPrefix } from '../auth/session'

export const READ_BURST = 120 // requests
export const READ_REFILL_PER_S = 2 // requests per second, per network (/24 or /48)
const MAX_KEYS = 5000

type Bucket = { tokens: number; at: number }
const buckets = new Map<string, Bucket>()

/** Takes one read. Null when allowed, else the seconds to wait. */
export function takeRead(ip: string | null | undefined, now = Date.now()): number | null {
  const key = ipPrefix(ip ?? null) ?? 'unknown'
  const b = buckets.get(key)
  const tokens = b ? Math.min(READ_BURST, b.tokens + ((now - b.at) / 1000) * READ_REFILL_PER_S) : READ_BURST
  if (tokens < 1) {
    buckets.set(key, { tokens, at: now })
    return Math.max(1, Math.ceil((1 - tokens) / READ_REFILL_PER_S))
  }
  if (!b && buckets.size >= MAX_KEYS) {
    // Drop the full buckets (nobody near the cap) first, then the oldest, so the map stays small.
    for (const [k, v] of buckets) if (v.tokens + ((now - v.at) / 1000) * READ_REFILL_PER_S >= READ_BURST) buckets.delete(k)
    if (buckets.size >= MAX_KEYS) buckets.delete(buckets.keys().next().value!)
  }
  buckets.delete(key) // re-insert, so map order is least recently used first
  buckets.set(key, { tokens: tokens - 1, at: now })
  return null
}

/** For tests. */
export function resetReadLimit(): void {
  buckets.clear()
}
