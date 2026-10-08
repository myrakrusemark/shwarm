// Resend's HTTP API: POST https://api.resend.com/emails. Only fetch, no SDK.
import { FROM, REPLY_TO } from './env'

export type OutMail = { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }

/** Sends one mail and returns Resend's id. Throws with a short reason on any failure. */
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
    throw new Error(`resend ${res.status}: ${String(body?.message ?? body?.name ?? 'no id').slice(0, 200)}`)
  }
  return body.id
}
