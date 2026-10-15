// The rows an upvote writes or takes back (core/posts.ts upvote), shared with backing a claim (core/status.ts): backing
// someone else's claim is an upvote on it, so impact still counts it (decided Oct 14).
import { isEstablished, type Ctx, type PersonRow } from './context'

/** Week-old accounts with an upvoted post are established (A6, spec "Identity and trust"). OPEN (#78): the week is proposed. */
export const ESTABLISHED_AGE_MS = 7 * 86_400_000

/** The upvoted post as these statements need it: its poster, and whether their account is founding and how old. */
export type Upvoted = { id: string; person_id: number; person_founding: number; person_created_at: string }

/**
 * Give or take back `voter`'s upvote on post `p`. A6: it counts toward tallies, impact and ranking (`counted`) only when
 * the voter is established at the time. Any upvote, counted or not, gives the poster "an upvoted post": once their
 * account is a week old they are established. established_at holds that moment, so isEstablished reads it with no job.
 * OPEN (#78): taking the only upvote back before the poster's week is up takes the date away again; once it has passed,
 * it stays. Giving one that's there already changes nothing.
 */
export function upvoteStatements(ctx: Ctx, voter: PersonRow, p: Upvoted, up: boolean): D1PreparedStatement[] {
  if (up) {
    const counted = isEstablished(voter, ctx.now)
    return [
      ctx.db
        .prepare('INSERT INTO upvote (post_id, person_id, counted, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (post_id, person_id) DO NOTHING')
        .bind(p.id, voter.id, counted ? 1 : 0, ctx.at),
      // Always sent, never skipped on a date read before: a take-back in another tree's queue may clear it before this
      // batch runs. The guard in the SQL makes setting it atomic with the insert; created_at never changes.
      ...(p.person_founding !== 1
        ? [
            ctx.db
              .prepare('UPDATE person SET established_at = ? WHERE id = ? AND founding = 0 AND established_at IS NULL')
              .bind(new Date(Math.max(Date.parse(p.person_created_at) + ESTABLISHED_AGE_MS, ctx.now)).toISOString(), p.person_id),
          ]
        : []),
    ]
  }
  return [
    ctx.db.prepare('DELETE FROM upvote WHERE post_id = ? AND person_id = ?').bind(p.id, voter.id),
    // After the delete, in the same batch: no upvoted post left and the week not yet up, so not established after all.
    ctx.db
      .prepare(
        `UPDATE person SET established_at = NULL WHERE id = ?1 AND founding = 0 AND established_at > ?2
         AND NOT EXISTS (SELECT 1 FROM post x JOIN upvote u ON u.post_id = x.id WHERE x.person_id = ?1)`,
      )
      .bind(p.person_id, ctx.at),
  ]
}
