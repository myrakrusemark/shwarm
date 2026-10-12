// Error reports to Sentry (go-live 11.3). Not Sentry's SDK: it wraps every request, and Workers Free gives a request
// 10 ms of CPU. This sends one event per error that reaches app.onError or a cron job's catch, from waitUntil, and only
// what is built below: the error's type, message and stack, the route pattern (never the path or query string), the
// method, the source, and the environment. No IP, headers, cookies, body, account id or handle. Email addresses and
// long tokens (hex, base64) in the message and stack are blanked before anything leaves.
// With SENTRY_DSN unset (tests, local dev) nothing is sent.

export type SentryEnv = { SENTRY_DSN?: string; ENV?: string }

export type ErrorReport = {
  /** 'request' (app.onError) or 'cron:<job>'. */
  source: string
  /** A route pattern such as /w/:path, or a job name. Never a filled-in path. */
  route?: string
  method?: string
}

const MAX_TEXT = 500
const MAX_FRAMES = 40

/** Blanks what could be personal or secret: email addresses, then long hex or base64-ish runs (keys, tokens, ids). */
export function scrub(text: string): string {
  return text
    .replace(/[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b[0-9a-f]{24,}\b/gi, '[hex]')
    .replace(/[A-Za-z0-9+_-]{32,}={0,2}/g, '[token]')
}

type Frame = { function?: string; filename?: string; lineno?: number; colno?: number; in_app: boolean }

/** V8 stack lines ("    at fn (file:12:3)") as Sentry frames, oldest first. Other lines are dropped. */
export function frames(stack: string): Frame[] {
  const out: Frame[] = []
  for (const line of stack.split('\n')) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line)
    if (!m) continue
    out.push({ function: m[1] ? scrub(m[1]) : undefined, filename: scrub(m[2]), lineno: Number(m[3]), colno: Number(m[4]), in_app: !m[2].includes('node_modules') })
    if (out.length >= MAX_FRAMES) break
  }
  return out.reverse()
}

/** The DSN's parts, or null when it isn't one. */
export function parseDsn(dsn: string): { key: string; url: string } | null {
  const m = /^https:\/\/([0-9a-f]+)@([a-z0-9.-]+)\/(\d+)$/.exec(dsn.trim())
  return m ? { key: m[1], url: `https://${m[2]}/api/${m[3]}/envelope/` } : null
}

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

/** The Sentry event for one error: nothing but the fields listed at the top of this file. */
export function sentryEvent(err: unknown, report: ErrorReport, env: SentryEnv, now = Date.now()) {
  const e = err instanceof Error ? err : new Error(String(err))
  const tags: Record<string, string> = { source: report.source }
  if (report.method) tags.method = report.method
  if (report.route) tags.route = report.route
  return {
    event_id: hex(crypto.getRandomValues(new Uint8Array(16))),
    timestamp: now / 1000,
    platform: 'javascript',
    level: 'error',
    environment: env.ENV ?? 'unknown',
    transaction: report.route ?? report.source,
    tags,
    exception: { values: [{ type: e.name || 'Error', value: scrub(e.message).slice(0, MAX_TEXT), stacktrace: { frames: frames(e.stack ?? '') } }] },
  }
}

/**
 * Sends one error report. Never throws and never waits on the caller: pass the promise to waitUntil. Fails quietly
 * (logged), since an error report must not make an error worse.
 */
export async function reportError(err: unknown, report: ErrorReport, env: SentryEnv): Promise<void> {
  const dsn = env.SENTRY_DSN ? parseDsn(env.SENTRY_DSN) : null
  if (!dsn) return
  try {
    const event = sentryEvent(err, report, env)
    const body = `${JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`
    const res = await fetch(dsn.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=shwarm/1` },
      body,
    })
    if (!res.ok) console.error(JSON.stringify({ at: 'sentry', status: res.status }))
  } catch (e) {
    console.error(JSON.stringify({ at: 'sentry', error: String(e) }))
  }
}
