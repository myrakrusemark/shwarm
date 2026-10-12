// The opening mail (go-live 13.3). Someone who joined while sign-up was allow-list only, from an address off the list,
// has a signup_wait row (0018, auth/signup.ts) and was told "we'll email you when it opens" (decided Oct 10). This is
// that one mail: "shwarm is open, sign in and find a shwarm to join". Nothing sends it by itself. An admin sends it from
// the opening box on /admin/switches, with a required reason, once the site is open: the 'signup' switch is 'open' and
// the deploy's SITE_MODE is 'open'. One batch queues a mail to every active, verified account on signup_wait with no
// mailed_at (OPENING_PER_DAY a day through staggered send_after, like the terms notice), sets those rows' mailed_at,
// and writes one public 'setting' row (key 'opening_mail', the count queued). Each statement holds only while sign-up
// is open, and the mail and the log row only while someone still waits, so a form sent twice at once mails once.
// An account that verifies after the send is still waiting, and the box offers the mail again for those few.
// OPEN (#114): the builder's defaults for the opening mail, everything in this file among them.
import type { SiteMode } from './site-mode'
import { NOTICE_PER_DAY } from './terms'

/** Opening mails a day: the terms notice's share of Resend's 100 a day, so verify, reset and sign-off mail still go. */
export const OPENING_PER_DAY = NOTICE_PER_DAY

/** The mail's payload: where to sign in and the feed. Paths; the sender adds SITE_URL. */
export const OPENING_PAYLOAD = { link: '/signin', feed: '/' }

// Who gets it: on signup_wait with no mailed_at, and active and verified now. Alias w for signup_wait.
const WAITING = `w.mailed_at IS NULL AND w.person_id IN (SELECT id FROM person WHERE status = 'active' AND email_verified_at IS NOT NULL)`
// Sign-up open, read as the batch reaches each statement (the setting holds JSON: "open").
const SIGNUP_OPEN = `EXISTS (SELECT 1 FROM setting WHERE key = 'signup' AND value = '"open"')`

/** How many accounts sending the opening mail now would reach. */
export async function openingCount(db: D1Database): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM signup_wait w WHERE ${WAITING}`).first<{ n: number }>()
  return r?.n ?? 0
}

/** Days of mailing `people` accounts takes at OPENING_PER_DAY. */
export const openingDays = (people: number) => Math.max(1, Math.ceil(people / OPENING_PER_DAY))

/**
 * Why sending the opening mail now would be refused, or null when it may go: sign-up must be open to anyone, the site
 * mode open, and someone still waiting. OPEN (#114): new wording.
 */
export function openingRefusal(signup: unknown, mode: SiteMode, people: number): string | null {
  if (signup !== 'open') return "sign-up is still allow-list only. it goes once sign-up is open to anyone, so it can't go out before shwarm opens."
  if (mode !== 'open') return `the site is in ${mode} mode. it goes once the site mode is open.`
  if (people < 1) return 'nobody is waiting for it.'
  return null
}

/**
 * The mails, one per waiting account, OPENING_PER_DAY a day. Put it first in the batch, before openingMarkStatement:
 * the rows it reads are the ones still unmarked as it runs, so a second batch right behind finds none.
 */
export function openingMailStatement(db: D1Database, now: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO email_outbox (to_email, person_id, template, stream, payload, created_at, send_after)
       SELECT lower(p.email), p.id, 'opening_notice', 'account', json_set(?1, '$.handle', p.handle), ?2,
              strftime('%Y-%m-%dT%H:%M:%fZ', ?2, '+' || CAST((ROW_NUMBER() OVER (ORDER BY p.id) - 1) / ?3 AS INTEGER) || ' days')
       FROM signup_wait w JOIN person p ON p.id = w.person_id
       WHERE ${WAITING} AND ${SIGNUP_OPEN}`,
    )
    .bind(JSON.stringify(OPENING_PAYLOAD), now, OPENING_PER_DAY)
}

/** Marks the same rows mailed, as they are queued. Last in the batch. */
export function openingMarkStatement(db: D1Database, now: string): D1PreparedStatement {
  return db.prepare(`UPDATE signup_wait AS w SET mailed_at = ? WHERE ${WAITING} AND ${SIGNUP_OPEN}`).bind(now)
}

/** The condition that guards the public log row the same way (modLog's `when`): sign-up open and someone unmarked. */
export const stillWaiting = () => ({ sql: `${SIGNUP_OPEN} AND EXISTS (SELECT 1 FROM signup_wait w WHERE ${WAITING})`, args: [] as unknown[] })
