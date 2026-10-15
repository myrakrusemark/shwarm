// The submission hash (table B, A10): sha256 over the canonical JSON of the submission's
// { text, links }. Stored as full hex, shown as 7 characters, matched by a prefix of 7 or more.
import { canonicalize } from './jcs'
import { sha256, toHex } from './bytes'

/** A file at a link, pinned by its sha256. */
export type FileLink = { url: string; sha256: string; label?: string }
/** A repo at a full commit: an https repo, or a Radicle `rad:z…` repo (pinned work only). */
export type RepoLink = { repo: string; commit: string; path?: string; label?: string }
/** An `ipfs://<cid>[/path]` address: the CID is the content's own hash (pinned work only). */
export type IpfsLink = { ipfs: string; label?: string }
/** A `magnet:?xt=urn:btih:…` or `urn:btmh:1220…` link: the infohash is the content's own hash (pinned work only). */
export type MagnetLink = { magnet: string; label?: string }
/** A link any post, submission or check may carry: https, pinned by a sha256 or a commit. */
export type WebLink = FileLink | RepoLink
/**
 * Every link shape (#82). The self-hashing ones (ipfs, magnet, a rad: repo) are pinned work on a passed claim only
 * (decided Oct 14, "One model for every node"); each has its own key, so `'sha256' in l` never mistakes one for a repo.
 */
export type Link = WebLink | IpfsLink | MagnetLink

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
