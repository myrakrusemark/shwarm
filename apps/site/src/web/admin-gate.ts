// The gate in front of every /admin page and form (go-live 9.4). Three layers:
//   1. Cloudflare Access, when it is set up (ACCESS_AUD and ACCESS_TEAM in the env): the request must carry Access's
//      signed header (Cf-Access-Jwt-Assertion), and the Worker checks it (go-live 9.6, web/access-jwt.ts): the
//      signature against the team's keys, our application's aud, our team's iss, not expired. Access asks for the
//      emailed code before the request reaches us; checking the token here means a request that went around Access,
//      or carries a made-up header, gets nowhere. ACCESS_AUD without ACCESS_TEAM lets no one in.
//   2. A signed-in, verified session of an active admin. Anyone else gets the plain 404, so the address isn't
//      advertised.
//   3. The password step-up (A5) for every page and act: an admin act changes other people's accounts and content.
// Every admin act writes a moderation_action row (core/moderation.ts); this file only decides who gets in.
import type { Context } from 'hono'
import { sessionOf } from '../auth/request'
import type { Session } from '../auth/session'
import { requireStepUp } from '../auth/stepup'
import { accessTokenOk } from './access-jwt'
import { sendError } from './errors'

export type AdminEnv = { DB: D1Database; ACCESS_AUD?: string; ACCESS_TEAM?: string }

/** Whether the person is an active admin. */
export async function isAdmin(db: D1Database, personId: number): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok FROM person WHERE id = ? AND is_admin = 1 AND status = 'active'").bind(personId).first()
  return !!row
}

/**
 * The admin's session, or the Response to send instead: 404 for anyone who isn't an admin (signed out included), a
 * redirect to the step-up page for an admin whose password window is closed. `stepUp: false` only for read-only pages
 * that show nothing private (none yet).
 */
export async function adminGate<E extends { Bindings: AdminEnv }>(c: Context<E>, o: { stepUp?: boolean } = {}): Promise<{ session: Session } | { stop: Response }> {
  c.header('X-Robots-Tag', 'noindex')
  c.header('Cache-Control', 'private, no-store')
  const aud = c.env.ACCESS_AUD
  if (aud && !(await accessTokenOk(c.req.header('cf-access-jwt-assertion'), { aud, team: c.env.ACCESS_TEAM }))) return { stop: await sendError(c, { status: 404 }) }
  const s = await sessionOf(c)
  if (!s || !s.verified || !(await isAdmin(c.env.DB, s.personId))) return { stop: await sendError(c, { status: 404 }) }
  if (o.stepUp !== false) {
    const stop = await requireStepUp(c, { next: new URL(c.req.url).pathname + new URL(c.req.url).search })
    if (stop) return { stop }
  }
  return { session: s }
}
