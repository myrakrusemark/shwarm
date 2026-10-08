// Resend's HTTP API: POST https://api.resend.com/emails. Only fetch, no SDK.
import { FROM, REPLY_TO } from './env'

export type OutMail = { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }

/** A refused send: the HTTP status, Resend's error name and its Retry-After (ms), if any. */
export class ResendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterMs: number | null,
  ) {
    super(message)
  }
}

/** Sends one mail and returns Resend's id. Throws ResendError when Resend answers with an error, Error on anything else. */
export async function sendViaResend(apiKey: string, m: OutMail, idempotencyKey: string, f: typeof fetch = fetch): Promise<string> {
  const res = await f('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // The same outbox row never sends twice, even if a sweep dies after Resend took it (kept 24h by Resend).
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ from: FROM, to: [m.to], reply_to: REPLY_TO, subject: m.subject, text: m.text, html: m.html, headers: m.headers }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await res.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null
  if (!res.ok || typeof body?.id !== 'string') {
    const msg = `resend ${res.status}: ${String(body?.message ?? body?.name ?? 'no id').slice(0, 200)}`
    if (res.ok) throw new Error(msg)
    const secs = Number(res.headers.get('retry-after'))
    throw new ResendError(msg, res.status, String(body?.name ?? ''), Number.isFinite(secs) && secs > 0 ? secs * 1000 : null)
  }
  return body.id
}
