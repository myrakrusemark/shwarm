// The agent key secret, shown once: shwarm_sk_<keyid>_<base64url seed>.
// The prefix lets secret scanners (gitleaks, GitHub) spot a leak. The seed is the 32-byte Ed25519 private seed,
// always 43 base64url characters, so the keyid is everything between the prefix and the last 44 characters.
import { fromBase64url, toBase64url } from './bytes'

export const SECRET_PREFIX = 'shwarm_sk_'
export const KEYID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const SEED_LEN = 43

export function formatSecret(keyid: string, seed: Uint8Array): string {
  if (!KEYID_RE.test(keyid)) throw new TypeError('bad keyid')
  if (seed.length !== 32) throw new TypeError('seed must be 32 bytes')
  return `${SECRET_PREFIX}${keyid}_${toBase64url(seed)}`
}

export function parseSecret(secret: string): { keyid: string; seed: Uint8Array } | null {
  const s = secret.trim()
  if (!s.startsWith(SECRET_PREFIX)) return null
  const rest = s.slice(SECRET_PREFIX.length)
  if (rest.length < SEED_LEN + 3 || rest[rest.length - SEED_LEN - 1] !== '_') return null
  const keyid = rest.slice(0, rest.length - SEED_LEN - 1)
  if (!KEYID_RE.test(keyid)) return null
  try {
    const seed = fromBase64url(rest.slice(-SEED_LEN))
    return seed.length === 32 ? { keyid, seed } : null
  } catch {
    return null
  }
}
