// Email addresses at sign-up: shape check, the normalized form that stops one inbox holding two accounts,
// and the disposable-domain block (table disposable_domain, seeded by migration 0003).

export type Email = { email: string; norm: string; domain: string }

const SHAPE = /^[^\s@<>()[\]\\,;:"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/
const GMAIL = new Set(['gmail.com', 'googlemail.com'])

/** Lowercased address plus email_norm: "+tag" dropped everywhere, dots dropped at Gmail. Null if it doesn't look like an address. */
export function parseEmail(input: unknown): Email | null {
  if (typeof input !== 'string') return null
  const email = input.trim().toLowerCase()
  if (email.length > 254 || !SHAPE.test(email)) return null
  const at = email.lastIndexOf('@')
  let local = email.slice(0, at)
  let domain = email.slice(at + 1)
  if (local.length > 64) return null
  local = local.split('+')[0]
  if (GMAIL.has(domain)) {
    local = local.replace(/\./g, '')
    domain = 'gmail.com'
  }
  if (!local) return null
  return { email, norm: `${local}@${domain}`, domain: email.slice(at + 1) }
}

/** True if the domain, or any parent of it (mail.example.com → example.com), is on the blocklist. */
export async function isDisposable(db: D1Database, domain: string): Promise<boolean> {
  const parts = domain.split('.')
  const candidates: string[] = []
  for (let i = 0; i < parts.length - 1 && candidates.length < 6; i++) candidates.push(parts.slice(i).join('.'))
  const row = await db
    .prepare(`SELECT 1 AS hit FROM disposable_domain WHERE domain IN (${candidates.map(() => '?').join(', ')}) LIMIT 1`)
    .bind(...candidates)
    .first()
  return row !== null
}
