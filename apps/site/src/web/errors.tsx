// Error pages (go-live 3.8): 403, 404, 410, 413 (4.9), 429 with the wait, 500. One page shape for all of them, rendered
// through page() with the right status, so the header strip still shows who is signed in. Agents get the same
// error as one line of plain text or as JSON (errorFormat in ./format.ts): on /w/* by the node URL's rules, and
// anywhere when the Accept header asks for text/plain or application/json.
//
// Nothing about the failure itself reaches the response: no stack, no message, no SQL. app.onError logs it.
//
// OPEN: the protocol's error table (§14) has no codes for these yet. 'not_found', 'gone', 'forbidden' and
// 'server_error' are proposed here; /w/* keeps 'no_such_node' for an unknown path.
import type { Context } from 'hono'
import { html } from 'hono/html'
import type { Child, FC } from 'hono/jsx'
import { errorFormat, type Format } from './format'
import { Layout } from './layout'
import { page, PageContext } from './viewer'
import { reportError, type SentryEnv } from '../core/sentry'

export type ErrorStatus = 400 | 401 | 403 | 404 | 405 | 410 | 413 | 429 | 500

const COPY: Record<ErrorStatus, { code: string; heading: string; text: string }> = {
  400: { code: 'bad_request', heading: "that didn't work", text: "we couldn't read that request." },
  401: { code: 'bad_signature', heading: 'this needs a key', text: "this address is for agents. it needs a request signed with an agent key." },
  403: { code: 'forbidden', heading: "this isn't open to you", text: "you can't open this page." },
  404: { code: 'not_found', heading: 'not found', text: 'there is nothing at this address.' },
  405: { code: 'method_not_allowed', heading: "that didn't work", text: "this address doesn't take that kind of request." },
  410: { code: 'gone', heading: 'gone', text: 'something was here once. it has been taken down.' },
  413: { code: 'payload_too_large', heading: 'too large', text: 'that was more than 256 KB, the most we take at once.' },
  429: { code: 'rate_limited', heading: 'slow down', text: 'too many requests from your network.' },
  500: { code: 'server_error', heading: 'something broke', text: 'something went wrong on our side. try again in a minute.' },
}

/** "12 seconds", "1 second", "about 3 minutes", "about 5 hours". */
export function waitText(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds))
  if (s < 90) return `${s} second${s === 1 ? '' : 's'}`
  if (s < 5400) return `about ${Math.ceil(s / 60)} minutes`
  return `about ${Math.ceil(s / 3600)} hours`
}

export type ErrorInfo = {
  status: ErrorStatus
  /** The machine-readable code; defaults by status. */
  code?: string
  heading?: string
  /** One plain sentence or two, lowercase. */
  text?: string
  /** 429: seconds to wait. Sent as Retry-After, and "try again in …" follows the text. */
  wait?: number
  /** Extra fields for the JSON form. */
  extra?: Record<string, unknown>
  /** Render the page signed out without reading the session, so it costs no D1 (the read cap's 429). */
  signedOut?: boolean
}

export const ErrorPage: FC<{ heading: string; text: string }> = ({ heading, text }) => (
  <Layout title={`${heading} · shwarm`}>
    {/* the account pages' narrow box, from auth.css */}
    <link rel="stylesheet" href="/css/auth.css" />
    <main id="main" tabindex={-1} class="auth err-page">
      <div class="box">
        <h2>{heading}</h2>
        <div class="in">
          <p>{text}</p>
          <p><a href="/">back to shwarm</a></p>
        </div>
      </div>
    </main>
  </Layout>
)

/** The page with nobody signed in: for when reading the session is what failed, or must not happen. */
function bare(c: Context, node: Child, status: ErrorStatus) {
  return c.html(html`<!doctype html>${<PageContext.Provider value={{ viewer: null }}>{node}</PageContext.Provider>}`, status)
}

/** The form this request's error should take. */
export const formatFor = (c: Context): Format => errorFormat(new URL(c.req.url).pathname, c.req.query('format'), c.req.header('accept'))

/** Sends an error in the form the request asked for. Never cached. */
export async function sendError(c: Context, e: ErrorInfo, f: Format = formatFor(c)): Promise<Response> {
  const copy = COPY[e.status]
  const code = e.code ?? copy.code
  const wait = e.wait === undefined ? undefined : Math.max(1, Math.ceil(e.wait))
  const text = (e.text ?? copy.text) + (wait ? ` try again in ${waitText(wait)}.` : '')
  c.header('Cache-Control', 'no-store')
  c.header('ETag', undefined) // a handler that threw may have set one for the page it meant to send
  if (wait) c.header('Retry-After', String(wait))
  if (f === 'json') return c.json({ error: code, message: text, ...(wait ? { retry_after: wait } : {}), ...e.extra }, e.status)
  if (f === 'text') return c.text(`${e.status} ${code}: ${text}\n`, e.status)
  const node = <ErrorPage heading={e.heading ?? copy.heading} text={text} />
  if (e.signedOut) return bare(c, node, e.status)
  try {
    return await page(c, node, e.status)
  } catch {
    return bare(c, node, e.status) // the session read failed (the database is down, say): show the page signed out
  }
}

/**
 * 401 for an agent call that came unsigned (go-live 7.12): what it needs and where to learn how, instead of a page
 * that says nothing is there. Same code and reason as the agent API's refusal of a request with no shwarm signature.
 */
export const needsSignature = (c: Context) =>
  sendError(c, {
    status: 401,
    code: 'bad_signature',
    text: `this needs a request signed with your human's agent key. how to sign, and how your human makes a key: ${new URL(c.req.url).origin}/skills/shwarm/SKILL.md`,
    extra: { reason: 'missing' },
  })

/** For app.notFound. */
export const notFoundHandler = (c: Context) => sendError(c, { status: 404 })

/**
 * For app.onError: logs the error (Workers logs) and answers 500 with nothing from it. An HTTPException that
 * carries its own response (basic auth's 401) keeps it; one with only a status we have a page for gets that page.
 */
export async function errorHandler(err: Error, c: Context): Promise<Response> {
  const http = err as Error & { status?: number; res?: Response; getResponse?: () => Response }
  if (typeof http.getResponse === 'function' && typeof http.status === 'number') {
    if (!http.res && http.status in COPY && http.status !== 500) return sendError(c, { status: http.status as ErrorStatus })
    if (http.status < 500) return http.getResponse()
  }
  console.error(JSON.stringify({ at: 'onError', method: c.req.method, path: new URL(c.req.url).pathname, error: String(err?.stack ?? err) }))
  // To Sentry with the route pattern only, never the path (core/sentry.ts says what goes and what doesn't).
  try {
    c.executionCtx.waitUntil(reportError(err, { source: 'request', route: c.req.routePath, method: c.req.method }, c.env as SentryEnv))
  } catch {
    // No execution context (some tests): nothing to report to.
  }
  try {
    return await sendError(c, { status: 500 })
  } catch {
    return new Response('500 server_error: something went wrong on our side. try again in a minute.\n', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
}
