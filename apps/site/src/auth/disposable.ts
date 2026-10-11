// The weekly refresh of the disposable-domain block (go-live 11.5). Migration 0004 loaded the public list
// (scripts/disposable-domains.mjs); this adds the domains it has gained since, from the same CC0 source, once a week
// from the cron handler (jobs/index.ts). Expand-only, like the migration: a domain the list drops stays blocked here
// until it's taken out by hand. It fails safe: a failed fetch, an odd answer or a list far shorter than the one we
// loaded changes nothing, and nothing here ever deletes a row.
export const DISPOSABLE_LIST =
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf'

/** A list shorter than this isn't the list (migration 0004 loaded 9,221 domains): refused whole. */
export const MIN_DOMAINS = 5000
const MAX_BYTES = 4 * 1024 * 1024 // the list is about 150 KB
const CHUNK = 1000 // domains per INSERT, as one JSON parameter (well under D1's 2 MB value limit)
const ETAG = 'disposable_etag' // meta: the list's ETag at the last refresh, so an unchanged list costs one request
// A domain: two labels or more, the characters the migration script allows. A bare TLD never matches.
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

export type RefreshResult =
  | { unchanged: true }
  | { unchanged: false; listed: number; added: number; spared: number; skipped: number }

/**
 * Fetches the list and adds the domains we don't have. A domain that a verified account's address uses (itself or as a
 * parent of it) is spared and counted, so a bad entry upstream can't lock real people out of signing up again.
 */
export async function refreshDisposable(db: D1Database, get: typeof fetch = fetch): Promise<RefreshResult> {
  const etag = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(ETAG).first<{ value: string }>()
  const res = await get(DISPOSABLE_LIST, { headers: etag ? { 'If-None-Match': etag.value } : {} })
  if (res.status === 304) return { unchanged: true }
  if (!res.ok) throw new Error(`disposable list: http ${res.status}`)
  const text = await res.text()
  if (text.length > MAX_BYTES) throw new Error(`disposable list: ${text.length} bytes, too big`)

  const domains = new Set<string>()
  let skipped = 0
  for (const line of text.split('\n')) {
    const d = line.trim().toLowerCase()
    if (!d || d.startsWith('#')) continue
    if (DOMAIN.test(d) && d.length <= 253) domains.add(d)
    else skipped++
  }
  if (domains.size < MIN_DOMAINS) throw new Error(`disposable list: only ${domains.size} domains, not refreshed`)

  // Every domain a verified address sits under: mail.example.com gives mail.example.com and example.com.
  const { results } = await db
    .prepare("SELECT DISTINCT lower(substr(email, instr(email, '@') + 1)) AS d FROM person WHERE email_verified_at IS NOT NULL")
    .all<{ d: string }>()
  const used = new Set<string>()
  for (const { d } of results) {
    const parts = d.split('.')
    for (let i = 0; i < parts.length - 1; i++) used.add(parts.slice(i).join('.'))
  }
  const keep = [...domains].filter(d => !used.has(d))

  const stmts: D1PreparedStatement[] = []
  for (let i = 0; i < keep.length; i += CHUNK)
    stmts.push(db.prepare('INSERT OR IGNORE INTO disposable_domain (domain) SELECT value FROM json_each(?)').bind(JSON.stringify(keep.slice(i, i + CHUNK))))
  const tag = res.headers.get('etag')
  stmts.push(
    tag
      ? db.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2').bind(ETAG, tag)
      : db.prepare('DELETE FROM meta WHERE key = ?').bind(ETAG),
  )
  const out = await db.batch(stmts)
  const added = out.slice(0, -1).reduce((n, r) => n + (r.meta.changes ?? 0), 0)
  return { unchanged: false, listed: domains.size, added, spared: domains.size - keep.length, skipped }
}
