// Cloudflare Turnstile on sign-up, sign-in and forgot-password (table B). The widget posts its answer in
// the form field below; the Worker asks Cloudflare whether it's good.
//
// Staging uses Cloudflare's published test keys, which always pass:
//   site key  1x00000000000000000000AA   (var TURNSTILE_SITE_KEY)
//   secret    1x0000000000000000000000000000000AA   (wrangler secret put TURNSTILE_SECRET --env staging)
// Production needs a real widget made in the Cloudflare dashboard (free) for shwarm.org.

export const TURNSTILE_FIELD = 'cf-turnstile-response'
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

type Env = { ENV: string; TURNSTILE_SECRET?: string }

/**
 * Did the visitor pass the challenge? With no secret set, only local development passes (fails closed on
 * staging and production). `failOpen` decides what a Turnstile outage means for this form.
 */
export async function turnstileOk(env: Env, token: unknown, ip: string | null, opts: { failOpen?: boolean } = {}): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return env.ENV !== 'production' && env.ENV !== 'staging'
  if (typeof token !== 'string' || !token || token.length > 2048) return false
  try {
    const body = new FormData()
    body.append('secret', env.TURNSTILE_SECRET)
    body.append('response', token)
    if (ip) body.append('remoteip', ip)
    const res = await fetch(SITEVERIFY, { method: 'POST', body })
    if (!res.ok) return !!opts.failOpen
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return !!opts.failOpen
  }
}
