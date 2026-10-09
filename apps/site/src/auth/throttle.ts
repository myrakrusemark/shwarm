// Throttles for sign-up, sign-in and step-up, kept in auth_throttle. Each scope counts events in a window;
// the event that reaches `tripAt` blocks the scope for a while, then it starts over. Nothing locks for good.
const MIN = 60_000
const HOUR = 60 * MIN

export type Limit = { tripAt: number; windowMs: number; blockMs: number }

// OPEN: the numbers are first guesses for a small beta; each is one line to change.
export const LIMITS = {
  /** wrong passwords from one network (/24 or /48), sign-in and step-up together: the 20th is slowed */
  authIp: { tripAt: 20, windowMs: 15 * MIN, blockMs: 15 * MIN },
  /** wrong passwords for one address, whether or not it has an account (so a block reveals nothing) */
  authAddr: { tripAt: 10, windowMs: 15 * MIN, blockMs: 15 * MIN },
  /** sign-up attempts from one network: 5 an hour */
  signupIp: { tripAt: 6, windowMs: HOUR, blockMs: HOUR },
  /** sign-up attempts at one email domain: 30 an hour */
  signupDomain: { tripAt: 31, windowMs: HOUR, blockMs: HOUR },
  /** "send it again" for one pending account: 3 an hour */
  resendPerson: { tripAt: 4, windowMs: HOUR, blockMs: HOUR },
  /** "send it again" from one network: 10 an hour */
  resendIp: { tripAt: 11, windowMs: HOUR, blockMs: HOUR },
  /** "forgot password" from one network: 10 an hour, like "send it again" (4.9; OPEN: not in table B, #80) */
  forgotIp: { tripAt: 11, windowMs: HOUR, blockMs: HOUR },
  /** email changes saved by one account: 3 an hour, since each mails an address the account picks (6.2; OPEN #84) */
  emailChangePerson: { tripAt: 4, windowMs: HOUR, blockMs: HOUR },
  /** "download your data" by one account: 5 an hour, since each reads everything it holds (6.4; OPEN #86) */
  exportPerson: { tripAt: 6, windowMs: HOUR, blockMs: HOUR },
  /** keys made or rotated by one account: 20 an hour, so the 20-key cap can't be churned through (7.2; OPEN #88) */
  keyMakePerson: { tripAt: 21, windowMs: HOUR, blockMs: HOUR },
} satisfies Record<string, Limit>

const iso = (ms: number) => new Date(ms).toISOString()

type Row = { count: number; window_start: string; blocked_until: string | null }

/** Seconds until this scope may try again; 0 when it isn't blocked. */
export async function blockedFor(db: D1Database, scope: string, now = Date.now()): Promise<number> {
  const row = await db.prepare('SELECT blocked_until FROM auth_throttle WHERE scope = ?').bind(scope).first<{ blocked_until: string | null }>()
  const until = row?.blocked_until ? Date.parse(row.blocked_until) : 0
  return until > now ? Math.ceil((until - now) / 1000) : 0
}

/** Count one event. Returns the seconds to wait if this scope is (now) blocked, else 0. */
export async function bump(db: D1Database, scope: string, limit: Limit, now = Date.now()): Promise<number> {
  const row = await db.prepare('SELECT count, window_start, blocked_until FROM auth_throttle WHERE scope = ?').bind(scope).first<Row>()
  const until = row?.blocked_until ? Date.parse(row.blocked_until) : 0
  if (until > now) return Math.ceil((until - now) / 1000)
  const fresh = !row || until > 0 || now - Date.parse(row.window_start) >= limit.windowMs
  const count = fresh ? 1 : row.count + 1
  const start = fresh ? iso(now) : row.window_start
  const blocked = count >= limit.tripAt ? iso(now + limit.blockMs) : null
  await db
    .prepare(
      `INSERT INTO auth_throttle (scope, count, window_start, blocked_until) VALUES (?, ?, ?, ?)
       ON CONFLICT (scope) DO UPDATE SET count = excluded.count, window_start = excluded.window_start, blocked_until = excluded.blocked_until`,
    )
    .bind(scope, count, start, blocked)
    .run()
  return blocked ? Math.ceil(limit.blockMs / 1000) : 0
}

/** Events counted in this scope's current window (or while it's blocked); 0 when it's clean. */
export async function recentCount(db: D1Database, scope: string, limit: Limit, now = Date.now()): Promise<number> {
  const row = await db.prepare('SELECT count, window_start, blocked_until FROM auth_throttle WHERE scope = ?').bind(scope).first<Row>()
  if (!row) return 0
  if (row.blocked_until && Date.parse(row.blocked_until) > now) return row.count
  return now - Date.parse(row.window_start) < limit.windowMs ? row.count : 0
}

/** Records that something happened now in this scope, without counting toward a limit. */
export async function stamp(db: D1Database, scope: string, now = Date.now()) {
  await db
    .prepare(
      `INSERT INTO auth_throttle (scope, count, window_start, blocked_until) VALUES (?, 0, ?, NULL)
       ON CONFLICT (scope) DO UPDATE SET count = 0, window_start = excluded.window_start, blocked_until = NULL`,
    )
    .bind(scope, iso(now))
    .run()
}

export async function clearThrottle(db: D1Database, scope: string) {
  await db.prepare('DELETE FROM auth_throttle WHERE scope = ?').bind(scope).run()
}
