// Monitoring inside the Worker (go-live 11.3): what /healthz reports past "the Worker runs and reads D1", and the
// watchdog that mails the admins when something has gone wrong for long enough. Zero spend: D1 reads, one ping to the
// tree's Durable Object, and mail through the outbox like any other admin mail. Uptime checks and phone pages are
// outside the Worker (the checker reads /healthz).
//
// No Cloudflare Queues here, so the "dead-letter queue" is the outbox rows the sweep gave up on (jobs/mail.ts: sent_at
// set, provider_id NULL, last_error 'failed: …').
//
// OPEN: every threshold below is the builder's default for the beta, and the words of the alert mail are new.
import { mailToAdminsStatement } from '../email/outbox'
import { SEED } from '../read/beta'
import { errorBucket, resendBucket } from '../web/traffic'

export const OUTBOX_LATE_S = 5 * 60 // a due mail unsent this long, or a failing one written this long ago
export const HOLD_LATE_S = 15 * 60 // a triage hold waiting on the operator this long
export const SIGNUPS_PER_HOUR = 20 // more sign-ups than this in the last hour
export const ERRORS_PER_HOUR = 10 // more 5xx answers than this in the last hour (10-minute buckets, web/traffic.ts)
export const BOUNCES_PER_DAY = 3 // more bounce or complaint suppressions than this in the last day
// Resend send errors (jobs/mail.ts, web/traffic.ts resendBucket) over the last RESEND_WINDOW_MS: more than
// RESEND_ERROR_RATE of the calls made (errors plus mail sent), and at least RESEND_MIN_ERRORS of them, so one failure in
// a quiet day's three mails doesn't page. A day, because the beta sends tens of mails a day, not hundreds an hour.
export const RESEND_ERROR_RATE = 0.02
export const RESEND_MIN_ERRORS = 3
export const RESEND_WINDOW_MS = 24 * 3_600_000
export const ALERT_EVERY_MS = 3_600_000 // each kind of alert at most once an hour
// A hold that sits overnight would alert every hour and spend the day's cap before a worse alert came; triage already
// mailed when it held the node, so its reminder comes every 12 hours.
export const HOLD_ALERT_EVERY_MS = 12 * 3_600_000
// The error rate is over a day, so it stays over for up to a day after a burst: it too reminds every 12 hours.
export const RESEND_ALERT_EVERY_MS = 12 * 3_600_000
export const MAILS_PER_DAY = 6 // watchdog mails a UTC day, all kinds together (Resend free: 100 sends a day, all mail)
export const TREE_PING_MS = 2_000 // a tree that hasn't answered by then counts as down
export const WATCH_MINUTE = 3 // the watchdog runs at minutes 3, 8, 13, …: apart from the stats run at 0, 5, 10, …

const HOUR = 3_600_000
const DAY = 86_400_000
const MARK = 'watchdog' // meta row: { sent: { kind: iso }, day, mails }

export type OutboxHealth = { due: number; oldest_due_s: number | null; failing: number; oldest_failing_s: number | null; given_up_1h: number; given_up_24h: number }
export type TriageHealth = { held: number; oldest_held_s: number | null }
export type Health = { outbox: OutboxHealth; triage: TriageHealth }
export type Facts = Health & { signups_1h: number; errors_1h: number; bounces_24h: number; resend_errors_24h: number; sent_24h: number; mark: string | null }
export type TreePing = { ok: boolean; ms: number }

const iso = (ms: number) => new Date(ms).toISOString()
const ageS = (at: string | null | undefined, now: number) => {
  const t = at ? Date.parse(at) : NaN
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** The health check's statements: the outbox, given-up mail and triage holds. Each an index range (migration 0026). */
function healthStatements(db: D1Database, now: number): D1PreparedStatement[] {
  return [
    // Unsent rows (index email_outbox_due). Due: its time has come. Failing: an attempt failed and it waits to try again
    // ('waiting: …' is a notice held for triage on purpose, not a failure). A revoked Resend key shows here, not as due.
    db
      .prepare(
        `SELECT COALESCE(SUM(send_after <= ?1), 0) AS due, MIN(CASE WHEN send_after <= ?1 THEN send_after END) AS oldest_due,
                COALESCE(SUM(last_error IS NOT NULL AND last_error NOT LIKE 'waiting:%'), 0) AS failing,
                MIN(CASE WHEN last_error IS NOT NULL AND last_error NOT LIKE 'waiting:%' THEN created_at END) AS oldest_failing
         FROM email_outbox WHERE sent_at IS NULL`,
      )
      .bind(iso(now)),
    // Given up (index email_outbox_unsent_done).
    db
      .prepare(
        `SELECT COALESCE(SUM(sent_at >= ?1), 0) AS hour, COUNT(*) AS day FROM email_outbox
         WHERE provider_id IS NULL AND sent_at >= ?2 AND last_error LIKE 'failed:%'`,
      )
      .bind(iso(now - HOUR), iso(now - DAY)),
    // Held nodes (index node_held). Held since its last triage decision, or since its round began when none was written
    // (triage off, or out of time): at most 10 minutes after the round began (triage/run.ts HOLD_AFTER_MS).
    db.prepare(
      `SELECT COUNT(*) AS n, MIN(held_at) AS oldest FROM (
         SELECT max(COALESCE(n.triage_since, n.created_at), COALESCE((SELECT MAX(d.created_at) FROM triage_decision d WHERE d.node_id = n.id), '')) AS held_at
         FROM node n WHERE n.triage = 'held')`,
    ),
  ]
}

/** The watchdog's extra statements: sign-ups, 5xx answers and bounces, and its own mark. */
function watchStatements(db: D1Database, now: number): D1PreparedStatement[] {
  return [
    db.prepare(`SELECT COUNT(*) AS n FROM person p WHERE p.created_at >= ? AND NOT ${SEED('p')}`).bind(iso(now - HOUR)),
    // Six 10-minute buckets: the current one and the five before it.
    db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM auth_throttle WHERE scope >= ? AND scope <= ?').bind(errorBucket(now - 50 * 60_000), errorBucket(now)),
    db.prepare("SELECT COUNT(*) AS n FROM email_suppression WHERE created_at >= ? AND reason IN ('bounce', 'complaint')").bind(iso(now - DAY)),
    // Resend errors by hour, the current one and the 23 before it; mail sent in the same day (index email_outbox_sent).
    db
      .prepare(
        `SELECT (SELECT COALESCE(SUM(count), 0) FROM auth_throttle WHERE scope >= ?1 AND scope <= ?2) AS errors,
                (SELECT COUNT(*) FROM email_outbox WHERE provider_id IS NOT NULL AND sent_at >= ?3) AS sent`,
      )
      .bind(resendBucket(now - RESEND_WINDOW_MS + HOUR), resendBucket(now), iso(now - RESEND_WINDOW_MS)),
    db.prepare('SELECT value FROM meta WHERE key = ?').bind(MARK),
  ]
}

type Row = Record<string, unknown>
const first = (r: D1Result | undefined): Row => ((r?.results ?? [])[0] as Row | undefined) ?? {}

function healthOf(rs: D1Result[], now: number): Health {
  const [o, g, t] = rs.map(first)
  return {
    outbox: {
      due: num(o.due),
      oldest_due_s: ageS(o.oldest_due as string | null, now),
      failing: num(o.failing),
      oldest_failing_s: ageS(o.oldest_failing as string | null, now),
      given_up_1h: num(g.hour),
      given_up_24h: num(g.day),
    },
    triage: { held: num(t.n), oldest_held_s: ageS(t.oldest as string | null, now) },
  }
}

/** What /healthz shows: one D1 batch. Counts and ages only, never an address, handle or path. */
export async function readHealth(db: D1Database, now = Date.now()): Promise<Health> {
  return healthOf(await db.batch(healthStatements(db, now)), now)
}

/** What the watchdog reads: the health facts and its own, in one D1 batch. */
export async function readFacts(db: D1Database, now = Date.now()): Promise<Facts> {
  const rs = await db.batch([...healthStatements(db, now), ...watchStatements(db, now)])
  const [s, e, b, r, m] = rs.slice(3).map(first)
  return {
    ...healthOf(rs, now),
    signups_1h: num(s.n),
    errors_1h: num(e.n),
    bounces_24h: num(b.n),
    resend_errors_24h: num(r.errors),
    sent_24h: num(r.sent),
    mark: typeof m.value === 'string' ? m.value : null,
  }
}

/**
 * A ping to a ShwarmTree (do/shwarm-tree.ts GET /ping), on its own name so it never waits behind a real tree's queue.
 * Time-boxed: a tree that doesn't answer within TREE_PING_MS is reported down, and the health check doesn't wait on it.
 */
export async function pingTree(ns: DurableObjectNamespace | undefined, timeoutMs = TREE_PING_MS): Promise<TreePing | null> {
  if (!ns) return null
  const start = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<false>(resolve => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    const ask = (async () => {
      const res = await ns.get(ns.idFromName(':healthz')).fetch('https://tree.internal/ping')
      const body = await res.json<{ ok?: boolean }>().catch(() => null)
      return res.ok && body?.ok === true
    })()
    const ok = await Promise.race([ask.catch(() => false), late])
    return { ok, ms: Date.now() - start }
  } finally {
    clearTimeout(timer)
  }
}

// /healthz is public, so its extra fields (one D1 batch and one Durable Object request, both on free daily quotas) are
// kept per isolate for HEALTH_CACHE_MS: an uptime checker or someone hammering the URL costs at most one read of each per
// isolate per window. Only a settled result is kept, never a pending promise, since Workers can't share one request's
// I/O with another. The schema read in index.ts still runs on every hit, so the 200/500 answer stays live.
export const HEALTH_CACHE_MS = 30_000
export type HealthExtras = { h: Health | null; tree: TreePing | null }
let extras: { at: number; value: HealthExtras } | null = null

export async function healthExtras(env: { DB: D1Database; TREE?: DurableObjectNamespace }, now = Date.now()): Promise<HealthExtras> {
  if (extras && now >= extras.at && now - extras.at < HEALTH_CACHE_MS) return extras.value
  const [h, tree] = await Promise.all([
    readHealth(env.DB, now).catch(err => {
      console.error(JSON.stringify({ at: 'healthz', part: 'checks', error: String((err as Error)?.message ?? err) }))
      return null
    }),
    pingTree(env.TREE).catch(() => ({ ok: false, ms: 0 })),
  ])
  extras = { at: now, value: { h, tree } }
  return extras.value
}

/** For tests: forget the kept /healthz fields. */
export const clearHealthCache = () => {
  extras = null
}

/**
 * Words an uptime checker can look for in /healthz (a keyword check), since the status stays 200 while the site serves.
 * The same limits as the watchdog's, for what /healthz shows.
 */
export function attention(h: Health | null, tree: TreePing | null): string[] {
  if (!h) return ['checks_failed', ...(tree && !tree.ok ? ['tree_down'] : [])]
  const out: string[] = []
  if (outboxLate(h)) out.push('outbox_late')
  if (h.outbox.given_up_1h > 0) out.push('outbox_given_up')
  if ((h.triage.oldest_held_s ?? 0) > HOLD_LATE_S) out.push('triage_hold_late')
  if (tree && !tree.ok) out.push('tree_down')
  return out
}

const outboxLate = (h: Health) => (h.outbox.oldest_due_s ?? 0) > OUTBOX_LATE_S || (h.outbox.oldest_failing_s ?? 0) > OUTBOX_LATE_S

// ---------- the watchdog ----------

export type AlertKind = 'outbox_late' | 'outbox_given_up' | 'triage_hold_late' | 'signups' | 'errors' | 'bounces' | 'resend_errors'
export type Alert = { kind: AlertKind; [k: string]: number | string }

const mins = (s: number | null) => Math.round((s ?? 0) / 60)

/** The alerts the facts call for, before the throttle. */
export function alertsFrom(f: Facts): Alert[] {
  const out: Alert[] = []
  if (outboxLate(f))
    out.push({
      kind: 'outbox_late',
      due: f.outbox.due,
      oldest_due_min: mins(f.outbox.oldest_due_s),
      failing: f.outbox.failing,
      oldest_failing_min: mins(f.outbox.oldest_failing_s),
    })
  if (f.outbox.given_up_1h > 0) out.push({ kind: 'outbox_given_up', n: f.outbox.given_up_1h })
  // Triage mails the admins as it holds a node (triage/run.ts), so this is only about the wait.
  if ((f.triage.oldest_held_s ?? 0) > HOLD_LATE_S) out.push({ kind: 'triage_hold_late', n: f.triage.held, oldest_min: mins(f.triage.oldest_held_s) })
  if (f.signups_1h > SIGNUPS_PER_HOUR) out.push({ kind: 'signups', n: f.signups_1h, limit: SIGNUPS_PER_HOUR })
  if (f.errors_1h > ERRORS_PER_HOUR) out.push({ kind: 'errors', n: f.errors_1h, limit: ERRORS_PER_HOUR })
  if (f.bounces_24h > BOUNCES_PER_DAY) out.push({ kind: 'bounces', n: f.bounces_24h, limit: BOUNCES_PER_DAY })
  const calls = f.resend_errors_24h + f.sent_24h
  if (f.resend_errors_24h >= RESEND_MIN_ERRORS && f.resend_errors_24h > RESEND_ERROR_RATE * calls)
    out.push({ kind: 'resend_errors', n: f.resend_errors_24h, calls, percent: Math.round((100 * f.resend_errors_24h) / calls), limit: Math.round(RESEND_ERROR_RATE * 100) })
  return out
}

type Mark = { sent: Partial<Record<AlertKind, string>>; day: string; mails: number }

function parseMark(s: string | null): Mark {
  try {
    const v = JSON.parse(s ?? '')
    if (v && typeof v === 'object' && v.sent && typeof v.sent === 'object')
      return { sent: v.sent, day: typeof v.day === 'string' ? v.day : '', mails: Number.isSafeInteger(v.mails) ? v.mails : 0 }
  } catch {
    // no mark yet, or a broken one: start over
  }
  return { sent: {}, day: '', mails: 0 }
}

export type WatchResult = { firing: AlertKind[]; sent: AlertKind[]; capped: boolean }

/**
 * One watchdog run: reads the facts, and queues one mail to every active admin (mailToAdminsStatement) naming each
 * alert that fires and hasn't gone in the last hour, unless MAILS_PER_DAY went today. The mail goes on the next
 * minute's sweep. meta.watchdog holds when each kind last went and today's count; the mail rows are written only while
 * that mark is still the one this run read, so two runs that overlap send one mail.
 * A mail the outbox can't send (a revoked key, a used-up quota) can't carry its own alert: /healthz says outbox_late.
 */
export async function watchdog(env: { DB: D1Database; ENV?: string }, now = Date.now()): Promise<WatchResult> {
  const db = env.DB
  const f = await readFacts(db, now)
  const firing = alertsFrom(f)
  const mark = parseMark(f.mark)
  const fresh = firing.filter(a => {
    const last = Date.parse(mark.sent[a.kind] ?? '')
    const every = a.kind === 'triage_hold_late' ? HOLD_ALERT_EVERY_MS : a.kind === 'resend_errors' ? RESEND_ALERT_EVERY_MS : ALERT_EVERY_MS
    return !(Number.isFinite(last) && now - last < every)
  })
  const result: WatchResult = { firing: firing.map(a => a.kind), sent: [], capped: false }
  if (!fresh.length) return result
  const at = iso(now)
  const today = at.slice(0, 10)
  const mails = mark.day === today ? mark.mails : 0
  if (mails >= MAILS_PER_DAY) {
    console.warn('watchdog', JSON.stringify({ capped: fresh.map(a => a.kind) }))
    return { ...result, capped: true }
  }
  const next: Mark = { sent: { ...mark.sent }, day: today, mails: mails + 1 }
  for (const a of fresh) next.sent[a.kind] = at
  const before = f.mark ?? ''
  await db.batch([
    mailToAdminsStatement(db, { template: 'watchdog_alert', stream: 'account', payload: { alerts: fresh, link: '/admin' } }, at, {
      rows: `SELECT ? AS env WHERE COALESCE((SELECT value FROM meta WHERE key = '${MARK}'), '') = ?`,
      args: [env.ENV ?? '', before],
      set: `'$.env', x.env`,
    }),
    db
      .prepare(`INSERT INTO meta (key, value) VALUES ('${MARK}', ?1) ON CONFLICT (key) DO UPDATE SET value = ?1 WHERE meta.value = ?2`)
      .bind(JSON.stringify(next), before),
  ])
  return { ...result, sent: fresh.map(a => a.kind) }
}

