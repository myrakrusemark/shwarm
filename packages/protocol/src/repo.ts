// The shared repo a pinned status update names (#128): a git repo URL or a Radicle id. The site names it in the
// briefing's WHERE THE WORK LIVES, and `shwarm start` clones it, so both read a post the same way.
import type { Link } from './hash'

export type SharedRepo = { repo: string; kind: 'git' | 'rad' }

/** Forges whose links name a repo by its first two path segments (gitlab's groups nest, up to its /-/ pages). */
const FORGES = new Set(['github.com', 'codeberg.org', 'gitlab.com'])
/** A Radicle repo id: rad: and a base58 id starting with z. rad://z… is read as the same. */
const RAD = /\brad:(?:\/\/)?(z[1-9A-HJ-NP-Za-km-z]{20,})/

/** A whole string that is a Radicle repo id (rad:z…, or rad://z…): a repo a pin may name with a full commit. */
export const isRadRepo = (s: string) => /^rad:(?:\/\/)?z[1-9A-HJ-NP-Za-km-z]{20,}$/.test(s)

/** The repo an https URL names: on a forge, owner/repo (never a page inside it); anywhere else, a URL ending in .git. */
export function gitRepo(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  const host = u.hostname.replace(/^www\./, '')
  const parts = u.pathname.split('/').filter(Boolean)
  if (FORGES.has(host)) {
    const end = host !== 'gitlab.com' ? 2 : parts.includes('-') ? parts.indexOf('-') : parts.length
    return parts.length >= 2 && end >= 2 ? `https://${host}/${parts.slice(0, end).join('/')}` : null
  }
  const path = u.pathname.replace(/\/+$/, '')
  return path.endsWith('.git') ? u.origin + path : null
}

/**
 * The shared repo a post names: the first git repo URL or Radicle id in its text, in reading order, else the first
 * among its links (a repo link is a repo wherever it's hosted).
 */
export function repoIn(post: { text?: string | null; links?: readonly Link[] | null }): SharedRepo | null {
  const found = (s: string, repoLink = false): SharedRepo | null => {
    const git = gitRepo(s) ?? (repoLink && /^https:\/\//.test(s) ? s : null)
    if (git) return { repo: git, kind: 'git' }
    const rad = RAD.exec(s)
    return rad ? { repo: `rad:${rad[1]}`, kind: 'rad' } : null
  }
  for (const m of (post.text ?? '').matchAll(/https:\/\/[^\s<>"'`]+|\brad:(?:\/\/)?z[1-9A-HJ-NP-Za-km-z]{20,}/g)) {
    const r = found(m[0].replace(/[.,;:!?)\]}*_]+$/, ''))
    if (r) return r
  }
  for (const l of post.links ?? []) {
    const r = 'repo' in l ? found(l.repo, true) : 'url' in l ? found(l.url) : null // an ipfs or magnet pin names no repo
    if (r) return r
  }
  return null
}
