// One key per inbox, the same one sign-up stores in person.email_norm and signup_allow (auth/email.ts):
// lowercase, no +tag, and Gmail ignores dots. Used for suppression, the allow-list and mail caps.
// Lookups match the plain lowercased address too.
import { parseEmail } from '../auth/email'

export function emailNorm(email: string): string {
  return parseEmail(email)?.norm ?? email.trim().toLowerCase()
}

/** The keys to look an address up by: as stored (lowercased) and normalized. */
export const emailKeys = (email: string): [string, string] => [email.trim().toLowerCase(), emailNorm(email)]
