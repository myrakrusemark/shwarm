// The submission hash (table B, A10): sha256 over the canonical JSON of the submission's
// { text, links }. Stored as full hex, shown as 7 characters, matched by a prefix of 7 or more.
import { canonicalize } from './jcs'
import { sha256, toHex } from './bytes'

export type Link =
  | { url: string; sha256: string; label?: string }
  | { repo: string; commit: string; path?: string; label?: string }

export type SubmissionContent = { text: string; links?: Link[] }

export const SHORT_HASH = 7

/** links default to [] so a submission with no links hashes the same however it was sent. */
export async function submissionHash(s: SubmissionContent): Promise<string> {
  return toHex(await sha256(canonicalize({ text: s.text, links: s.links ?? [] })))
}

export const shortHash = (hex: string) => hex.slice(0, SHORT_HASH)

/** Does a reported hash (or prefix) name this submission? Case-insensitive; at least 7 hex characters. */
export function hashMatches(full: string, reported: string): boolean {
  const r = reported.toLowerCase()
  return /^[0-9a-f]{7,64}$/.test(r) && full.toLowerCase().startsWith(r)
}
