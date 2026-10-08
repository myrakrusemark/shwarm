// Password hashing. Decided Oct 8: stay on Workers Free, so PBKDF2-SHA256 through WebCrypto now,
// argon2id after a move to Workers Paid. Each stored hash names its algorithm and settings, so the switch
// is a setting plus a rehash at the next sign-in (verifyPassword says when).
//
// Stored form: pbkdf2-sha256$i=<iterations>$<salt b64url>$<hash b64url>
// The password is first keyed with HMAC-SHA256 under PASSWORD_PEPPER (a Worker secret), so a copy of the
// database alone isn't enough to start guessing.
import { fromBase64url, toBase64url, utf8 } from '@shwarm/protocol'

// Cloudflare's WebCrypto refuses more than 100,000 PBKDF2 iterations. Measured Oct 8 on Workers Free:
// 15–40 ms CPU per hash, and 80 of 80 requests (40 at once) went through.
export const PBKDF2_ITERATIONS = 100_000
export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 128

const ALGO = 'pbkdf2-sha256'

async function peppered(password: string, pepper: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', fromBase64url(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(password.normalize('NFKC'))))
}

async function pbkdf2(input: Uint8Array, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', input, 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256))
}

export async function hashPassword(password: string, pepper: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(await peppered(password, pepper), salt, iterations)
  return `${ALGO}$i=${iterations}$${toBase64url(salt)}$${toBase64url(hash)}`
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export type Verified = { ok: boolean; needsRehash: boolean }

export async function verifyPassword(password: string, stored: string, pepper: string): Promise<Verified> {
  const m = /^pbkdf2-sha256\$i=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(stored)
  if (!m) return { ok: false, needsRehash: false }
  const iterations = Number(m[1])
  const got = await pbkdf2(await peppered(password, pepper), fromBase64url(m[2]), iterations)
  const ok = sameBytes(got, fromBase64url(m[3]))
  return { ok, needsRehash: ok && iterations !== PBKDF2_ITERATIONS }
}

/** Length rules only; the breached-password check (Have I Been Pwned) runs at sign-up. */
export function passwordProblem(password: string): 'too_short' | 'too_long' | null {
  const n = [...password].length
  if (n < PASSWORD_MIN) return 'too_short'
  if (n > PASSWORD_MAX) return 'too_long'
  return null
}

/** Have I Been Pwned range check: only the first 5 hex characters of the SHA-1 leave the Worker. */
export async function isPwned(password: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const sha1 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', utf8(password))), b => b.toString(16).padStart(2, '0'))
    .join('').toUpperCase()
  const res = await fetcher(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } })
  if (!res.ok) return false // fail open: an outage shouldn't block sign-up; the length rule still holds
  const suffix = sha1.slice(5)
  return (await res.text()).split('\n').some(line => {
    const [s, count] = line.trim().split(':')
    return s === suffix && Number(count) > 0
  })
}
