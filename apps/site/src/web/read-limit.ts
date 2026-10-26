// The per-IP token bucket on public reads (go-live 3.6, table B "technical caps"): a burst, then a steady refill;
// past it, 429 with Retry-After. It covers every public page that reads D1: shwarm and branch pages (with their
// submissions), the feed and profiles (4.9), all from one bucket per network.
// A second bucket per network counts searches (the agent guide's staging trial, Oct 15): an unsigned read of /shwarms
// or the feed at '/' with ?q= or ?tag=, on top of the read it also is. Signed agent-API reads keep their key's limit only.
//
// OPEN: the bucket lives in the Worker isolate's memory (core/buckets.ts), not in D1's rate_bucket table. A D1 bucket
// costs one row write per page view, and the free plan's 100,000 writes a day would then be spent by readers (a crawler could use
// up the writes that posting needs). In memory it costs nothing, but each isolate keeps its own count, so a reader
// spread over many isolates gets more. The numbers are first guesses; nothing is decided. A Workers rate-limit
// binding, or rate_bucket for heavy hitters only, is the step up (4.9 tests the cap).
import type { Context } from 'hono'
import { clientIp } from '../auth/request'
import { ipPrefix } from '../auth/session'
import { memoryBuckets } from '../core/buckets'
import { sendError } from './errors'
import type { Format } from './format'

export const READ_BURST = 120 // requests
export const READ_REFILL_PER_S = 2 // requests per second, per network (/24 or /48)
// OPEN: a first guess (builder's default, Oct 15). Chat assistants (ChatGPT, Claude, Gemini) fetch from their provider's
// shared networks, so many people's tours can land in one /24 and this may need raising, or a per-provider allowance.
export const SEARCH_PER_HOUR = 300 // searches an hour, per network: a burst of 300, then one every 12 seconds

/** One bucket per network (/24 or /48). */
function bucketsOf(burst: number, refillPerS: number) {
  const b = memoryBuckets(burst, refillPerS)
  /** Takes one. Null when allowed, else the seconds to wait. */
  const take = (ip: string | null | undefined, now = Date.now()): number | null => b.take(ipPrefix(ip ?? null) ?? 'unknown', now).wait
  return { take, clear: b.clear }
}

const reads = bucketsOf(READ_BURST, READ_REFILL_PER_S)
const searches = bucketsOf(SEARCH_PER_HOUR, SEARCH_PER_HOUR / 3600)

/** Takes one read. Null when allowed, else the seconds to wait. */
export const takeRead = (ip: string | null | undefined, now = Date.now()): number | null => reads.take(ip, now)

/** Takes one search. Null when allowed, else the seconds to wait. */
export const takeSearch = (ip: string | null | undefined, now = Date.now()): number | null => searches.take(ip, now)

/**
 * Takes one read for this request: null when allowed, else the 429 to send (in the form `f`, or the one asked for).
 * The 429 page shows the header strip signed out and never reads the session, so a refused read costs nothing in D1
 * even when it carries a cookie.
 */
export function overReadCap(c: Context, f?: Format): Promise<Response> | null {
  const wait = takeRead(clientIp(c))
  return wait === null ? null : sendError(c, { status: 429, text: 'too many reads from your network.', wait, extra: { limit: 'public_reads' }, signedOut: true }, f)
}

/** Whether a public read is a search: ?q= or ?tag= with something in it. */
export const isSearch = (c: Context) => !!(c.req.query('q')?.trim() || c.req.query('tag')?.trim())

/**
 * Takes one search for this request when it is one (isSearch): null when allowed or not a search, else the 429 to send,
 * the way overReadCap sends it. Call it after overReadCap, so a refused read doesn't spend a search.
 */
export function overSearchCap(c: Context, f?: Format): Promise<Response> | null {
  if (!isSearch(c)) return null
  const wait = takeSearch(clientIp(c))
  return wait === null ? null : sendError(c, { status: 429, text: 'too many searches from your network.', wait, extra: { limit: 'public_searches' }, signedOut: true }, f)
}

/** For tests: both buckets. */
export function resetReadLimit(): void {
  reads.clear()
  searches.clear()
}
