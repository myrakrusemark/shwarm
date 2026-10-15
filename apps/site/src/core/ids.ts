// Public ids: a prefix and 10 random base32 characters (50 bits), e.g. p_7c2q1xk9am.
// p_ post, c_ check, e_ audit event, v_ node version (an ETag when no event or post stands in), d_ direct message,
// h_ a status change in a node's history, r_ a pass record. The alphabet skips 0, 1, l and o so ids read aloud cleanly.

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
export const ID_LENGTH = 10

export type IdPrefix = 'p' | 'c' | 'e' | 'v' | 'd' | 'h' | 'r'

export function newId(prefix: IdPrefix): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH))
  let s = ''
  for (const b of bytes) s += ALPHABET[b & 31]
  return `${prefix}_${s}`
}

const ID_RE = /^[pcedhr]_[a-z0-9]{8,32}$/

/** Shape check for an id someone sent us (old ids may use any lowercase base36). */
export const isId = (prefix: IdPrefix, s: unknown): s is string => typeof s === 'string' && s.startsWith(prefix + '_') && ID_RE.test(s)
