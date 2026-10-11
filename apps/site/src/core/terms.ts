// Terms versions (go-live 10.2). One version number covers the terms and the privacy notice. The versions, their
// effective dates and what changed come from scripts/pages/content.py TERMS_VERSIONS through export-site.py
// (content/terms.json), so they change only by deploy; the /terms changelog is made from the same list. The
// 'terms_version' setting says which bundled version is announced: raising it (the box on /admin/switches) mails every
// active, verified account and puts a banner on their signed-in pages until they press "i accept v<n>"
// (web/terms-accept.tsx). Each acceptance is a terms_acceptance row (0025). Agents and keys are unaffected: only the
// person accepts, on the site.
// OPEN (#110): the builder's defaults for terms changes, everything in this file among them.
import versions from '../content/terms.json'
import { setting } from './settings'

export type TermsVersion = { version: string; effective: string; changes: string[] }

/** Every bundled version, oldest first. */
export const TERMS_VERSIONS = versions as TermsVersion[]

/** How long before its effective date a version has to be announced. 30 days (Myra, Oct 11). */
export const NOTICE_DAYS = 30
/** Notice mails a day: half of Resend's 100 a day, so verify, reset and sign-off mail still go. */
export const NOTICE_PER_DAY = 50

const DAY = 86_400_000

/** The bundled entry for a version, or null when this deploy doesn't have it. */
export const termsEntry = (v: unknown): TermsVersion | null => TERMS_VERSIONS.find(x => x.version === v) ?? null

/** The newest bundled version. */
export const latestTerms = (): TermsVersion => TERMS_VERSIONS[TERMS_VERSIONS.length - 1]

/** The announced version: the 'terms_version' setting, '0' when it is missing or unreadable. */
export async function currentTermsVersion(db: D1Database): Promise<string> {
  const v = await setting<unknown>(db, 'terms_version', '0')
  return typeof v === 'string' ? v : '0'
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** '2026-11-15' (or a full ISO time) → 'nov 15, 2026', in UTC, as content.py terms_date writes it. */
export function termsDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/** Days of mailing a notice to `people` accounts takes at NOTICE_PER_DAY. */
export const mailingDays = (people: number) => Math.max(1, Math.ceil(people / NOTICE_PER_DAY))

/**
 * Why announcing `version` now would be refused, or null when it may go: it must be bundled, come after the announced
 * version in bundle order, and take effect at least the notice period plus the mailing days from now.
 * OPEN (#110): new wording.
 */
export function announceRefusal(version: string, current: string, people: number, now = Date.now()): string | null {
  const at = TERMS_VERSIONS.findIndex(x => x.version === version)
  if (at < 0) return `v${version} isn't in this deploy. add it to TERMS_VERSIONS in scripts/pages/content.py, export and deploy.`
  const was = TERMS_VERSIONS.findIndex(x => x.version === current)
  if (at <= was) return `v${version} isn't newer than v${current}, the version people have now.`
  const days = NOTICE_DAYS + mailingDays(people) - 1
  const effective = Date.parse(`${TERMS_VERSIONS[at].effective}T00:00:00Z`)
  if (!(effective - now >= days * DAY))
    return `v${version} takes effect on ${termsDate(TERMS_VERSIONS[at].effective)}, less than ${days} days away. move its date in scripts/pages/content.py, export and deploy.`
  return null
}

/** The notice mail's payload, copied from the bundle when it is queued, so a later deploy can't change a retried mail. */
export const noticePayload = (t: TermsVersion) => ({ version: t.version, effective: t.effective, changes: t.changes, link: '/terms#changelog' })

// Who gets the notice: active, verified accounts not already on the version. Unverified accounts see the banner if they
// sign in; people who sign up after the announcement accept the new version then.
const NOTICED = "status = 'active' AND email_verified_at IS NOT NULL AND terms_version IS NOT ?"

/** How many accounts announcing `version` would mail. */
export async function noticeCount(db: D1Database, version: string): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM person WHERE ${NOTICED}`).bind(version).first<{ n: number }>()
  return r?.n ?? 0
}

/**
 * The notice mails for announcing `t`, one per account, NOTICE_PER_DAY a day through staggered send_after (no cron job
 * of its own). Made only while the setting isn't `t` yet: put it before the setting's upsert in the same batch, so a
 * form sent twice at once mails once.
 */
export function noticeStatement(db: D1Database, t: TermsVersion, now: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO email_outbox (to_email, person_id, template, stream, payload, created_at, send_after)
       SELECT lower(email), id, 'terms_notice', 'account', json_set(?1, '$.handle', handle), ?2,
              strftime('%Y-%m-%dT%H:%M:%fZ', ?2, '+' || CAST((ROW_NUMBER() OVER (ORDER BY id) - 1) / ?3 AS INTEGER) || ' days')
       FROM person
       WHERE ${NOTICED.replace('?', '?4')} AND NOT EXISTS (SELECT 1 FROM setting WHERE key = 'terms_version' AND value = json_quote(?4))`,
    )
    .bind(JSON.stringify(noticePayload(t)), now, NOTICE_PER_DAY, t.version)
}

/** The condition that guards the announcement's other rows the same way (modLog's `when`). */
export const notAnnounced = (version: string) => ({ sql: "NOT EXISTS (SELECT 1 FROM setting WHERE key = 'terms_version' AND value = json_quote(?))", args: [version] })
