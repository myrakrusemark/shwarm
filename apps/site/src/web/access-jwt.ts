// Checking Cloudflare Access's token on an /admin request (go-live 9.6). Access signs a JWT (RS256) into the
// Cf-Access-Jwt-Assertion header of every request it lets through; a header that is merely present proves nothing, since
// anyone can send one. So the Worker checks it itself: the signature against the team's public keys, then aud (our
// Access application), iss (our team) and the time window. No library: WebCrypto does RS256.
//
// The keys come from https://<team>.cloudflareaccess.com/cdn-cgi/access/certs and are kept in the isolate for an hour.
// Cloudflare rotates them, so a token signed with a key we don't know yet fetches them again, at most once a minute
// (a stream of made-up key ids can't turn into a stream of fetches).

const KEYS_FOR_MS = 60 * 60_000
const REFETCH_GAP_MS = 60_000
const SKEW_S = 60 // seconds of clock difference allowed on exp and nbf

type Keys = { url: string; keys: Map<string, CryptoKey>; at: number }
let cached: Keys | null = null

/** For tests: forget the fetched keys. */
export function forgetAccessKeys() {
  cached = null
}

/** The team's issuer, from ACCESS_TEAM as a bare team name or its whole cloudflareaccess.com address. */
export function accessIssuer(team: string): string {
  const name = team.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/\.cloudflareaccess\.com$/, '')
  return `https://${name}.cloudflareaccess.com`
}

async function fetchKeys(url: string, now: number): Promise<Keys | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] }
    const keys = new Map<string, CryptoKey>()
    for (const k of body.keys ?? []) {
      if (!k.kid || k.kty !== 'RSA') continue
      keys.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']))
    }
    return { url, keys, at: now }
  } catch {
    return null // a fetch or a key that fails leaves the old keys in place, and this request out
  }
}

async function keyFor(issuer: string, kid: string, now: number): Promise<CryptoKey | null> {
  const url = `${issuer}/cdn-cgi/access/certs`
  const fresh = cached?.url === url && now - cached.at < KEYS_FOR_MS
  if (fresh && cached!.keys.has(kid)) return cached!.keys.get(kid)!
  if (fresh && now - cached!.at < REFETCH_GAP_MS) return null
  const got = await fetchKeys(url, now)
  if (got) cached = got
  return cached?.url === url ? (cached.keys.get(kid) ?? null) : null
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0))

function json(part: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64url(part)))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

/**
 * Whether `token` is a good Access token for our application: signed by one of the team's keys, for audience `aud`,
 * from the team's issuer, and inside its time window. Anything wrong, or a key fetch that fails, is false.
 */
export async function accessTokenOk(token: string | undefined, o: { aud: string; team: string | undefined; now?: number }): Promise<boolean> {
  if (!token || !o.team) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [h, p, sig] = parts
  const header = json(h)
  const claims = json(p)
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') return false
  const now = o.now ?? Date.now()
  const issuer = accessIssuer(o.team)
  const key = await keyFor(issuer, header.kid, now)
  if (!key) return false
  let signed: boolean
  try {
    signed = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`))
  } catch {
    return false
  }
  if (!signed) return false
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.includes(o.aud)) return false
  if (claims.iss !== issuer) return false
  const sec = now / 1000
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S <= sec) return false
  if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf - SKEW_S > sec)) return false
  return true
}
