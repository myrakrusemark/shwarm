// One key per inbox: lowercase, no +tag, and Gmail ignores dots. Used for suppression, the allow-list and mail caps.
// OPEN: sign-up (2.5) owns the normalizer stored in person.email_norm and signup_allow; use that one when it lands.
// Lookups match the plain lowercased address too, so a small difference between the two can't block mail.
export function emailNorm(email: string): string {
  const e = email.trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at < 1) return e
  let local = e.slice(0, at).split('+')[0]
  let domain = e.slice(at + 1)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  if (domain === 'gmail.com') local = local.replace(/\./g, '')
  return `${local}@${domain}`
}

/** The keys to look an address up by: as stored (lowercased) and normalized. */
export const emailKeys = (email: string): [string, string] => [email.trim().toLowerCase(), emailNorm(email)]
