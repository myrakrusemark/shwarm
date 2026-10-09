// The daily digest of mentions (go-live 6.3). Whoever takes inbox mail as a daily digest (the account modal's default)
// gets one mail a day with the mentions of their bare handle that came in over the day before it and are still unread
// and shown in their inbox, instead of one mail each (those who chose "right away" get core's mention mail instead).
// The minute cron runs the sweep: from the day's digest time on, it takes a few people a minute until everyone due has
// theirs. person.digest_at holds the digest time each person last got (or was passed over for), so a sweep that runs
// twice, or two that overlap, send one digest a day: the mail row and the mark go in one batch, and the row is written
// only while the mark is still behind.
// OPEN (#85): one fixed time for everyone (no time zones are kept), the window is the day before it, and a mention
// read on the site before then isn't mailed.
import { inboxEverySql, noticeOnSql } from '../email/notices'
import { mailWhenStatement } from '../email/outbox'
import { DIGEST_ITEMS } from '../email/templates'
import { nodeHref } from '../core/audit'
import { NAME_SHOWN } from '../read/names'
import { SEEN_NODE } from '../read/visibility'

export const DIGEST_HOUR_UTC = 15 // OPEN (#85): 15:00 UTC, morning in the Americas and evening in Europe
export const DIGEST_BATCH = 25 // people per sweep; each is two reads and one batch
const DAY = 86_400_000

const iso = (ms: number) => new Date(ms).toISOString()

/** The digest time a sweep at `now` works toward: today's once it has passed, else yesterday's. */
export function digestDue(now: number): number {
  const today = Math.floor(now / DAY) * DAY + DIGEST_HOUR_UTC * 3_600_000
  return now >= today ? today : today - DAY
}

type Due = { id: number; handle: string; email: string }
type Item = { by: string; title: string; path: string; post_id: string; text: string; total: number }

export async function sweepDigests(db: D1Database, now = Date.now()): Promise<{ sent: number; passed: number }> {
  const due = iso(digestDue(now))
  const from = iso(digestDue(now) - DAY)
  // People due a digest with at least one unread mention in the window (on the inbox_mention_created index).
  const { results: people } = await db
    .prepare(
      `SELECT p.id, p.handle, p.email FROM person p
       WHERE p.id IN (SELECT i.person_id FROM inbox_item i WHERE i.kind = 'mention' AND i.created_at > ?2 AND i.created_at <= ?1 AND i.read_at IS NULL)
         AND p.status = 'active' AND p.email_verified_at IS NOT NULL AND (p.digest_at IS NULL OR p.digest_at < ?1)
         AND ${noticeOnSql('p', 'mention')} AND ${inboxEverySql('p', 'digest')}
       ORDER BY p.id LIMIT ?3`,
    )
    .bind(due, from, DIGEST_BATCH)
    .all<Due>()
  const out = { sent: 0, passed: 0 }
  for (const p of people) {
    // The mentions as their inbox shows them (read/inbox.ts): the node open to them, the post not hidden or deleted.
    const { results: items } = await db
      .prepare(
        `SELECT ${NAME_SHOWN('po.as_name')} AS by, n.title, n.path, po.id AS post_id, po.text, COUNT(*) OVER () AS total
         FROM inbox_item i JOIN node n ON n.id = i.node_id JOIN post po ON po.id = i.post_id
         WHERE i.person_id = ?1 AND i.kind = 'mention' AND i.read_at IS NULL AND i.created_at > ?2 AND i.created_at <= ?3
           AND po.hidden = 0 AND po.deleted_at IS NULL AND ${SEEN_NODE('n', '?1')}
         ORDER BY i.created_at, i.id LIMIT ?4`,
      )
      .bind(p.id, from, due, DIGEST_ITEMS)
      .all<Item>()
    const mark = db.prepare('UPDATE person SET digest_at = ?1 WHERE id = ?2 AND (digest_at IS NULL OR digest_at < ?1)').bind(due, p.id)
    if (!items.length) {
      await mark.run()
      out.passed++
      continue
    }
    const payload = {
      notice: 'mention',
      handle: p.handle,
      items: items.map(i => ({ by: i.by, title: i.title, link: `${nodeHref(i.path)}#${i.post_id}`, text: [...i.text].slice(0, 400).join('') })),
      more: items[0].total - items.length,
    }
    const when = 'EXISTS (SELECT 1 FROM person WHERE id = ? AND (digest_at IS NULL OR digest_at < ?))'
    await db.batch([mailWhenStatement(db, { to: p.email, personId: p.id, template: 'digest', stream: 'notices', payload }, when, [p.id, due], iso(now)), mark])
    out.sent++
  }
  return out
}
