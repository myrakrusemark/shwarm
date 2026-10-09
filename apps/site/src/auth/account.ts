// The account modal's acts (go-live 6.2, PRD PROF-8): save (display name, about, links, notice settings, and an email
// change), change password, sign out everywhere. The routes are in web/profile.tsx (POST /@handle, the owner only);
// saving and the password change confirm with the password (A5), checked there before anything here runs.
//
// An email change never touches the account until the new address is proven: the new address gets a link
// (/email-change, one button, as every emailed link), the old one gets a warning at once, and the old address stays
// on the account, for sign-in and mail, until the button is pressed.
import { mailStatement } from '../email/outbox'
import { accountLink } from '../email/templates'
import { nextPrefs, NOTICE_GROUPS } from '../email/notices'
import { linkParts } from '../render/text'
import { isDisposable, parseEmail, type Email } from './email'
import { isPwned, passwordProblem } from './password'
import { cleanName, COPY, DISPLAY_NAME_MAX } from './signup'
import { consumeEmailChange, newToken } from './tokens'

export const ABOUT_MAX = 160 // PRD PROF-8
// OPEN (#84): no decided length for a profile link; the renderer links up to 2048.
export const LINK_MAX = 200
/** The modal's two links (mockups/profile.html), stored as [{label, url}] in this order. */
export const LINK_FIELDS = ['website', 'code'] as const

export const ACCOUNT_COPY = {
  about: `keep it to ${ABOUT_MAX} characters.`,
  link: "that doesn't look like a link.",
  mismatch: "the two passwords don't match.",
}

export type AccountForm = Record<string, string | undefined>
export type AccountErrors = Partial<Record<'display_name' | 'about' | 'website' | 'code' | 'email' | 'new_password' | 'new_password2' | 'confirm', string>>

type Current = { id: number; handle: string; email: string; prefs: Record<string, unknown> }
export type AccountSave = {
  displayName: string
  about: string
  links: { label: string; url: string }[]
  prefs: Record<string, unknown>
  /** The address to move to, when it differs from the account's. */
  email: Email | null
  /** The account's own address was typed back: any pending change is withdrawn. */
  cancelEmailChange: boolean
}

/** A typed link as stored: "example.com" gets https://; only an http(s) address the pages would link is kept. */
export function cleanLink(raw: string | undefined): { url: string | null } | { error: string } {
  const s = (raw ?? '').trim()
  if (!s) return { url: null }
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`
  if (s.length > LINK_MAX || /\s/.test(s) || !linkParts(url) || !new URL(url).hostname.includes('.')) return { error: ACCOUNT_COPY.link }
  return { url }
}

/** Checks the save form. Returns what to store, or the errors to show at each field (the draft is kept by the caller). */
export async function checkAccount(db: D1Database, f: AccountForm, cur: Current): Promise<{ save: AccountSave } | { errors: AccountErrors }> {
  const errors: AccountErrors = {}
  // OPEN (#84): a display name changes any time here; ID-4 calls it "real name or persistent pseudonym".
  const displayName = cleanName(f.display_name ?? '')
  if ([...displayName].length > DISPLAY_NAME_MAX) errors.display_name = COPY.displayName
  const about = cleanName(f.about ?? '')
  if ([...about].length > ABOUT_MAX) errors.about = ACCOUNT_COPY.about
  const links: AccountSave['links'] = []
  for (const label of LINK_FIELDS) {
    const l = cleanLink(f[label])
    if ('error' in l) errors[label] = l.error
    else if (l.url) links.push({ label, url: l.url })
  }
  let email: Email | null = null
  const typed = (f.email ?? '').trim().toLowerCase()
  const same = f.email !== undefined && typed === cur.email.toLowerCase()
  if (f.email !== undefined && !same) {
    email = parseEmail(typed)
    if (!email) errors.email = COPY.email
    else if (await isDisposable(db, email.domain)) errors.email = COPY.disposable
  }
  if (Object.keys(errors).length) return { errors }
  const ticked = Object.fromEntries(NOTICE_GROUPS.map(g => [g.key, f[`n_${g.key}`] === '1']))
  return { save: { displayName, about, links, prefs: nextPrefs(cur.prefs, ticked, f.inbox_every), email, cancelEmailChange: same } }
}

/**
 * Stores a checked save as one batch. With an email change: any earlier change link stops working, a new one goes to
 * the new address, and the old address is warned. An address that already has another account gets no link, but
 * everything else happens the same, so the modal never shows whether an address has an account. With the account's
 * own address in the field, any pending change is withdrawn: its link stops working and the pending note goes.
 * OPEN (#84): the beta allow-list isn't checked on a change, and founding stays as it was. The field shows the
 * current address, so any save that leaves it alone also withdraws a pending change (builder's default).
 */
export async function saveAccount(db: D1Database, cur: Current, s: AccountSave, nowMs = Date.now()): Promise<void> {
  const now = new Date(nowMs).toISOString()
  const stmts = [
    db
      .prepare('UPDATE person SET display_name = ?, about = ?, links = ?, notice_prefs = ? WHERE id = ?')
      .bind(s.displayName, s.about, JSON.stringify(s.links), JSON.stringify(s.prefs), cur.id),
  ]
  if (s.cancelEmailChange) {
    stmts.push(db.prepare("UPDATE email_token SET used_at = ? WHERE person_id = ? AND purpose = 'email_change' AND used_at IS NULL").bind(now, cur.id))
  }
  if (s.email) {
    const taken = await db.prepare('SELECT 1 AS hit FROM person WHERE email_norm = ? AND id != ?').bind(s.email.norm, cur.id).first()
    const { token, stmt } = await newToken(db, cur.id, 'email_change', nowMs, s.email.email)
    stmts.push(
      db.prepare("UPDATE email_token SET used_at = ? WHERE person_id = ? AND purpose = 'email_change' AND used_at IS NULL").bind(now, cur.id),
      stmt,
      mailStatement(db, { to: cur.email, template: 'email_change_old', stream: 'security', personId: cur.id, payload: { handle: cur.handle } }, now),
    )
    if (!taken) {
      stmts.push(
        mailStatement(db, { to: s.email.email, template: 'email_change_new', stream: 'account', personId: cur.id, payload: { handle: cur.handle, link: accountLink('email-change', token) } }, now),
      )
    }
  }
  await db.batch(stmts)
}

export type EmailChanged = { kind: 'done'; handle: string } | { kind: 'expired' } | { kind: 'taken' }

/**
 * After the button on /email-change: the token is used up, and the account moves to the new address, which is now
 * verified (the click proves it). Every other change link and every reset link sent to the old address stops working.
 * Sessions stay: changing the address was already confirmed with the password.
 */
export async function applyEmailChange(db: D1Database, token: unknown, nowMs = Date.now()): Promise<EmailChanged> {
  const now = new Date(nowMs).toISOString()
  const t = await consumeEmailChange(db, token, nowMs)
  const e = t && parseEmail(t.newEmail)
  if (!t || !e) return { kind: 'expired' }
  const p = await db.prepare('SELECT handle FROM person WHERE id = ?').bind(t.personId).first<{ handle: string }>()
  if (!p) return { kind: 'expired' }
  // Someone else took the address while the link waited (they joined with it, or moved to it first).
  const taken = await db.prepare('SELECT 1 AS hit FROM person WHERE email_norm = ? AND id != ?').bind(e.norm, t.personId).first()
  if (taken) return { kind: 'taken' }
  try {
    await db.batch([
      db.prepare('UPDATE person SET email = ?, email_norm = ?, email_verified_at = ? WHERE id = ?').bind(e.email, e.norm, now, t.personId),
      db.prepare("UPDATE email_token SET used_at = ? WHERE person_id = ? AND purpose IN ('email_change', 'reset') AND used_at IS NULL").bind(now, t.personId),
    ])
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) return { kind: 'taken' } // the same race, a moment later
    throw err
  }
  return { kind: 'done', handle: p.handle }
}

/**
 * "change password": the new one, typed twice, checked like a reset (its length, the two match, not in a breach).
 * Checked before the step-up, so a bad one doesn't spend the password. Then auth/signin.ts setPassword ends every other
 * session and sends the "password changed" mail; this browser stays signed in.
 */
export async function checkNewPassword(f: AccountForm): Promise<AccountErrors | null> {
  const password = f.new_password ?? ''
  const problem = passwordProblem(password)
  if (problem) return { new_password: problem === 'too_short' ? COPY.tooShort : COPY.tooLong }
  if (password !== f.new_password2) return { new_password2: ACCOUNT_COPY.mismatch }
  if (await isPwned(password)) return { new_password: COPY.pwned }
  return null
}
