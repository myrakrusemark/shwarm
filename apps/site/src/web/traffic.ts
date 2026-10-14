// Server-side traffic counts (go-live 11.4, decided Oct 9: "Analytics: our own counts, a funnel first, on an admin
// page"). After each response, one row of traffic_count goes up by one: the day, what kind of answer it was, the other
// site that linked here, the country, the status class, who sent it (a person's browser, a crawler, a script or a
// signed agent) and, for people, the browser's first language (decided Oct 13). The user agent is read to pick who
// and never kept. traffic_daily holds the counts from before Oct 13, with no who or language. No IP, user agent, path,
// query or account id is kept, and no cookie is set or read for it. Only the admin page (/admin/beta) and the daily summary mail read the counts; agent
// traffic (kind 'api', and much of 'prompt' and 'json') is never shown publicly as agent counts.
//
// Cost: one UPSERT per counted request, after the answer (waitUntil), so it adds no time to the response. D1's free
// plan allows 100,000 rows written a day across the whole site, so past roughly 30,000 counted requests a day this
// should move to Workers Analytics Engine (free writes, made for exactly this), keeping the same five fields.
// A counting error never touches the response: it's caught and logged once per isolate.
import type { Context, MiddlewareHandler } from 'hono'
import { isSigned } from '../api/signed'
import { countsD1, flushUsage, tallied } from '../core/d1-usage'
import { errorFormat, type Format } from './format'

export type TrafficKind = 'page' | 'prompt' | 'json' | 'api' | 'other'
export type TrafficWho = 'person' | 'crawler' | 'script' | 'agent'
export type TrafficRow = { day: string; kind: TrafficKind; referrer: string; country: string; status_class: number; who: TrafficWho; lang: string }

// Not counted: the uptime check, mail provider hooks, and static files (Workers Assets serves those before the Worker
// runs; these catch the misses that fall through).
const SKIP = /^\/(healthz$|hooks\/|css\/|js\/|img\/|fonts\/|favicon)/
// Our own hosts: a Referer from them is moving around the site, not arriving from somewhere.
const OWN = new Set(['shwarm.org', 'www.shwarm.org'])
const BY_FORMAT: Record<Format, TrafficKind> = { html: 'page', text: 'prompt', json: 'json' }

/** The other site's host from a Referer header ('news.ycombinator.com'), or '' for none, our own, or anything odd. */
export function referrerHost(referer: string | undefined, ownHost: string): string {
  if (!referer) return ''
  try {
    const u = new URL(referer)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return ''
    const host = u.hostname.toLowerCase().replace(/\.$/, '')
    if (!host || host === ownHost || OWN.has(host) || host.length > 100) return ''
    return host
  } catch {
    return ''
  }
}

/** What kind of answer a response was: signed agent API, the page, the text prompt, JSON, or something else. */
export function trafficKind(req: Request, res: Response): TrafficKind {
  if (isSigned(req)) return 'api'
  const type = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (type === 'text/html') return 'page'
  if (type === 'text/plain') return 'prompt'
  if (type === 'application/json' || type?.endsWith('+json')) return 'json'
  if (type) return 'other'
  // No body (a 304, a redirect after a form): the form the routes would have picked for this request (web/format.ts).
  const url = new URL(req.url)
  return BY_FORMAT[errorFormat(url.pathname, url.searchParams.get('format') ?? undefined, req.headers.get('accept') ?? undefined)]
}

// A user agent that says what it is: search and AI crawlers, link previews, feed readers, monitors and headless
// browsers. Anything here is a crawler even when it also claims to be Mozilla.
const CRAWLER = /bot\b|bot\/|crawl|spider|slurp|archiver|preview|facebookexternalhit|embedly|feedfetcher|monitor|uptime|lighthouse|headless|phantom|scrapy|\+https?:\/\//i

/**
 * Who sent a request, from its headers alone (decided Oct 13; Claude's defaults). A signed call is an agent. A person
 * is a browser: a Mozilla/ user agent with no crawler words that sends Sec-Fetch-Mode, which every current browser
 * sends and few tools bother to fake. A user agent that names itself a crawler, or none at all, is a crawler. Anything
 * else (curl, a library, an agent reading unsigned) is a script. A guess, not proof: a careful bot can pass as a person.
 */
export function trafficWho(req: Request): TrafficWho {
  if (isSigned(req)) return 'agent'
  const ua = req.headers.get('user-agent') ?? ''
  if (!ua.trim() || CRAWLER.test(ua)) return 'crawler'
  if (/^Mozilla\//.test(ua) && req.headers.get('sec-fetch-mode')) return 'person'
  return 'script'
}

/** The first language an Accept-Language header lists, as its two or three letters ('ja' from 'ja-JP,en;q=0.8'). */
export function firstLanguage(header: string | null): string {
  const m = /^\s*([a-z]{2,3})(?:[-_][a-z0-9-]*)?\s*(?:[;,]|$)/i.exec(header ?? '')
  return m ? m[1].toLowerCase() : ''
}

/** The row a request and its response add to, or null when it isn't counted. */
export function trafficRow(req: Request, res: Response, now = Date.now()): TrafficRow | null {
  const url = new URL(req.url)
  if (req.method === 'OPTIONS' || SKIP.test(url.pathname)) return null
  const cf = (req as Request & { cf?: { country?: unknown } }).cf
  const country = typeof cf?.country === 'string' && /^[A-Z0-9]{2}$/.test(cf.country) ? cf.country : ''
  const who = trafficWho(req)
  return {
    day: new Date(now).toISOString().slice(0, 10),
    kind: trafficKind(req, res),
    referrer: referrerHost(req.headers.get('referer') ?? undefined, url.hostname.toLowerCase()),
    country,
    status_class: Math.min(5, Math.max(1, Math.floor(res.status / 100))),
    who,
    lang: who === 'person' ? firstLanguage(req.headers.get('accept-language')) : '',
  }
}

export function countStatement(db: D1Database, r: TrafficRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO traffic_count (day, kind, referrer, country, status_class, who, lang, hits) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (day, kind, referrer, country, status_class, who, lang) DO UPDATE SET hits = hits + 1`,
    )
    .bind(r.day, r.kind, r.referrer, r.country, r.status_class, r.who, r.lang)
}

// 5xx answers by 10-minute bucket (go-live 11.3), for the watchdog's "errors in the last hour" (jobs/watch.ts):
// traffic_daily is by day only. A counter row in auth_throttle per bucket, 'watch:5xx:2026-10-11T14:3' (14:30–14:39
// UTC), written only when an answer is a 5xx, so a healthy site writes none. pruneThrottle (auth/cleanup.ts) drops the
// rows a day after their bucket began. A bucket stops counting at ERROR_BUCKET_CAP, so a run of errors (an outage, or
// someone hitting a broken route) writes at most that many rows a bucket, 144 buckets a day, on D1's free write quota;
// the watchdog's limit is far below it, so a capped count still alerts (it reads as "at least").
export const ERROR_BUCKET = 'watch:5xx:'
export const ERROR_BUCKET_CAP = 50
export const errorBucket = (ms: number) => ERROR_BUCKET + new Date(ms).toISOString().slice(0, 15)

export function errorCountStatement(db: D1Database, now = Date.now()): D1PreparedStatement {
  const start = Math.floor(now / 600_000) * 600_000
  return db
    .prepare('INSERT INTO auth_throttle (scope, count, window_start) VALUES (?, 1, ?) ON CONFLICT (scope) DO UPDATE SET count = count + 1 WHERE auth_throttle.count < ?')
    .bind(errorBucket(now), new Date(start).toISOString(), ERROR_BUCKET_CAP)
}

// Resend send errors by hour (go-live 11.3), for the watchdog's error rate (jobs/watch.ts): one counter row per hour in
// auth_throttle, 'watch:resend:2026-10-11T14', bumped by the outbox sweep (jobs/mail.ts) each time a call to Resend
// fails, refusals and rate limits included. Written only on an error; pruned a day after the hour began, like the 5xx
// rows. The sweep makes at most 20 calls a minute, so a bucket can't run away; the cap is a backstop.
export const RESEND_BUCKET = 'watch:resend:'
export const RESEND_BUCKET_CAP = 2_000
export const resendBucket = (ms: number) => RESEND_BUCKET + new Date(ms).toISOString().slice(0, 13)

export function resendErrorStatement(db: D1Database, now = Date.now()): D1PreparedStatement {
  const start = Math.floor(now / 3_600_000) * 3_600_000
  return db
    .prepare('INSERT INTO auth_throttle (scope, count, window_start) VALUES (?, 1, ?) ON CONFLICT (scope) DO UPDATE SET count = count + 1 WHERE auth_throttle.count < ?')
    .bind(resendBucket(now), new Date(start).toISOString(), RESEND_BUCKET_CAP)
}

let logged = false
const quietly = (e: unknown) => {
  if (logged) return
  logged = true
  console.error('traffic count failed', e)
}

/**
 * The middleware. Counts on staging and production only, so tests and local runs keep their exact query counts.
 * Mounted first in index.ts, so it sees every answer, refusals and error pages included.
 */
export function countTraffic(): MiddlewareHandler<{ Bindings: { DB: D1Database; ENV: string } }> {
  return async (c, next) => {
    await next()
    if (c.env?.ENV !== 'staging' && c.env?.ENV !== 'production') return
    try {
      const row = trafficRow(c.req.raw, c.res)
      if (!row) return
      const db = c.env.DB
      const work = (row.status_class === 5 ? db.batch([countStatement(db, row), errorCountStatement(db)]) : countStatement(db, row).run()).catch(quietly)
      const ctx = executionCtx(c)
      if (ctx) ctx.waitUntil(work)
      else await work
    } catch (e) {
      quietly(e)
    }
  }
}

/**
 * D1 usage (go-live 11.3, core/d1-usage.ts): on staging and production, every query after this middleware counts the
 * rows it read and wrote, and the isolate's counts are written about once a minute, after the answer. Mounted before
 * countTraffic in index.ts, so the traffic count's own write counts too.
 */
export function countD1(): MiddlewareHandler<{ Bindings: { DB: D1Database; ENV: string } }> {
  return async (c, next) => {
    if (countsD1(c.env)) {
      const flush = flushUsage(c.env.DB)
      if (flush) {
        const ctx = executionCtx(c)
        if (ctx) ctx.waitUntil(flush)
        else await flush
      }
      c.env = { ...c.env, DB: tallied(c.env.DB) }
    }
    await next()
  }
}

function executionCtx(c: Context): { waitUntil(p: Promise<unknown>): void } | undefined {
  try {
    return c.executionCtx
  } catch {
    return undefined // no ExecutionContext (tests): count inline
  }
}

/** For tests: the next failure is logged again. */
export const resetTrafficLog = () => {
  logged = false
}
