// Account lookup and the acts on an account, for /admin/people (go-live 9.4; web/admin-accounts.tsx is the page).
// Lookup is by handle or by email: an address with no account still shows its allow-list entry, its suppression row and
// the mail sent to it, so an invite can be added before anyone signs up. Every act needs a reason and writes exactly one
// moderation_action row (core/moderation.ts modLog) in the same D1 batch as the act.
//   public rows:  suspend, unsuspend (A7: every action is logged publicly)
//   private rows: resend verify, mark verified, unsuppress, end sessions, the allow-list, founding (acts on an account's
//                 private details; OPEN (#107): which rows are private is a builder's default)
// A batch starts with a once-row in auth_throttle named by the form it came from (`once`, a random value each form
// carries), so a double click, or the same page sent twice, does the act and writes its row once. The hourly prune drops
// these rows a day later (auth/cleanup.ts).
import { toBase64url } from '@shwarm/protocol'
import { markVerifiedStatements } from '../auth/signin'
import { verifyMail } from '../auth/signup'
import { newToken } from '../auth/tokens'
import { emailKeys, emailNorm } from '../email/norm'
import { mailStatement } from '../email/outbox'
import { ctxAt, moderatedStatement } from './context'
import { modLog, type ModAction } from './moderation'
import { ESTABLISHED_AGE_MS } from './upvotes'

// ---------- lookup ----------

export type AccountRow = {
  id: number
  handle: string
  display_name: string
  email: string
  email_norm: string
  status: 'active' | 'suspended' | 'closed'
  email_verified_at: string | null
  founding: number
  established_at: string | null
  is_admin: number
  created_at: string
  closed_at: string | null
}
const ACCOUNT_COLS = 'id, handle, display_name, email, email_norm, status, email_verified_at, founding, established_at, is_admin, created_at, closed_at'

/** What a lookup found: an account (with its address, if it still has one), or an address with no account. */
export type Target = { person: AccountRow | null; email: string | null }

/** Whether the lookup text is an address (has an @ after its first character); "@myra" and "myra" are handles. */
const isEmail = (q: string) => q.indexOf('@') > 0

/** The account or address `q` names, or null when it names neither (a handle nobody has, or text that is neither). */
export async function findTarget(db: D1Database, raw: string | undefined): Promise<Target | null> {
  const q = (raw ?? '').trim()
  if (!q || q.length > 254) return null
  if (isEmail(q)) {
    const [plain, norm] = emailKeys(q)
    const person = await db
      .prepare(`SELECT ${ACCOUNT_COLS} FROM person WHERE email_norm IN (?1, ?2) OR lower(email) = ?1 ORDER BY status = 'active' DESC, id LIMIT 1`)
      .bind(plain, norm)
      .first<AccountRow>()
    return { person, email: person?.email || plain }
  }
  const handle = q.replace(/^@/, '').toLowerCase()
  if (!/^[a-z0-9_]{2,32}$/.test(handle)) return null
  const person = await db.prepare(`SELECT ${ACCOUNT_COLS} FROM person WHERE handle = ?`).bind(handle).first<AccountRow>()
  // A closed account has no address left (auth/close.ts).
  return person ? { person, email: person.email || null } : null
}

/** One row of the mail sent to an address, newest first, and where it stands (the sender's row states, jobs/mail.ts). */
export type OutboxRow = {
  id: number
  template: string
  stream: string
  created_at: string
  attempts: number
  sent_at: string | null
  last_error: string | null
  state: 'sent' | 'not sent' | 'failed' | 'retrying' | 'waiting'
}

export type SessionRow = { created_at: string; last_seen_at: string; browser: string | null }
export type KeyRow = { id: string; name: string; can_post_as: string; last_used_at: string | null; expires_at: string | null; revoked_at: string | null; created_at: string }
export type FlagRow = { path: string | null; post_id: string | null; reason: string; created_at: string; resolved_at: string | null }
export type ReportRow = { id: number; path: string | null; post_id: string | null; url: string | null; kind: string; reason: string | null; created_at: string; resolved_at: string | null }
export type ModRow = { action: string; reason: string; public: number; created_at: string; by: string | null }

export type AccountView = {
  target: Target
  outbox: OutboxRow[]
  suppression: { reason: string; created_at: string } | null
  allow: { email_norm: string; note: string; added_at: string; used_at: string | null } | null
  waiting: boolean // joined from off the allow-list and waits for shwarm to open (signup_wait)
  sessions: SessionRow[]
  keys: KeyRow[]
  flags: FlagRow[]
  reports: ReportRow[]
  history: ModRow[] // admin acts on this account, newest first
}

export const OUTBOX_SHOWN = 20
const LIST_SHOWN = 20

function stateOf(r: { sent_at: string | null; last_error: string | null; attempts: number; provider_id: string | null }): OutboxRow['state'] {
  if (r.provider_id) return 'sent'
  if (r.sent_at) return r.last_error?.startsWith('skipped') ? 'not sent' : 'failed'
  return r.attempts > 0 ? 'retrying' : 'waiting'
}

/** Everything the page shows about an account or an address. Never a session id or a token. */
export async function accountView(db: D1Database, t: Target): Promise<AccountView> {
  const p = t.person
  const keys = t.email ? emailKeys(t.email) : null
  const none = Promise.resolve({ results: [] as never[] })
  const [outbox, suppression, allow, waiting, sessions, akeys, flags, reports, history] = await Promise.all([
    keys || p
      ? db
          .prepare(
            `SELECT id, template, stream, created_at, attempts, sent_at, last_error, provider_id FROM email_outbox
             WHERE person_id = ?1 OR (?2 IS NOT NULL AND to_email IN (?2, ?3)) ORDER BY id DESC LIMIT ${OUTBOX_SHOWN}`,
          )
          .bind(p?.id ?? null, keys?.[0] ?? null, keys?.[1] ?? null)
          .all<Omit<OutboxRow, 'state'> & { provider_id: string | null }>()
      : none,
    keys ? db.prepare('SELECT reason, created_at FROM email_suppression WHERE email_norm IN (?, ?) LIMIT 1').bind(...keys).first<{ reason: string; created_at: string }>() : null,
    keys
      ? db.prepare('SELECT email_norm, note, added_at, used_at FROM signup_allow WHERE email_norm IN (?, ?) LIMIT 1').bind(...keys).first<AccountView['allow'] & object>()
      : null,
    p ? db.prepare('SELECT 1 AS ok FROM signup_wait WHERE person_id = ? AND mailed_at IS NULL').bind(p.id).first() : null,
    p ? db.prepare('SELECT created_at, last_seen_at, browser FROM session WHERE person_id = ? ORDER BY last_seen_at DESC').bind(p.id).all<SessionRow>() : none,
    p
      ? db
          .prepare(`SELECT id, name, can_post_as, last_used_at, expires_at, revoked_at, created_at FROM agent_key WHERE person_id = ? ORDER BY created_at DESC LIMIT ${LIST_SHOWN}`)
          .bind(p.id)
          .all<KeyRow>()
      : none,
    p
      ? db
          .prepare(
            `SELECT n.path, f.post_id, f.reason, f.created_at, f.resolved_at FROM flag f LEFT JOIN node n ON n.id = f.node_id
             WHERE f.person_id = ? ORDER BY f.created_at DESC LIMIT ${LIST_SHOWN}`,
          )
          .bind(p.id)
          .all<FlagRow>()
      : none,
    p
      ? db
          .prepare(
            `SELECT r.id, n.path, r.post_id, r.url, r.kind, r.reason, r.created_at, r.resolved_at FROM report r LEFT JOIN node n ON n.id = r.node_id
             WHERE r.person_id = ? ORDER BY r.created_at DESC LIMIT ${LIST_SHOWN}`,
          )
          .bind(p.id)
          .all<ReportRow>()
      : none,
    p
      ? db
          .prepare(
            `SELECT m.action, m.reason, m.public, m.created_at, b.handle AS by FROM moderation_action m LEFT JOIN person b ON b.id = m.by_person
             WHERE m.person_id = ? ORDER BY m.id DESC LIMIT ${LIST_SHOWN}`,
          )
          .bind(p.id)
          .all<ModRow>()
      : none,
  ])
  return {
    target: t,
    outbox: outbox.results.map(({ provider_id, ...r }) => ({ ...r, state: stateOf({ ...r, provider_id }) })),
    suppression: suppression ?? null,
    allow: allow ?? null,
    waiting: !!waiting,
    sessions: sessions.results,
    keys: akeys.results,
    flags: flags.results,
    reports: reports.results,
    history: history.results,
  }
}

// ---------- acts ----------

export const ACCOUNT_ACTS = [
  'resend_verify',
  'mark_verified',
  'unsuppress',
  'end_sessions',
  'allow_add',
  'allow_remove',
  'founding',
  'unfounding',
  'suspend',
  'unsuspend',
] as const satisfies readonly ModAction[]
export type AccountAct = (typeof ACCOUNT_ACTS)[number]
export const isAccountAct = (v: unknown): v is AccountAct => typeof v === 'string' && (ACCOUNT_ACTS as readonly string[]).includes(v)

/** Acts the public log shows; the rest are private rows. */
export const PUBLIC_ACTS: ReadonlySet<AccountAct> = new Set(['suspend', 'unsuspend'])
/** Acts on an address, which work with no account behind it. */
const ADDRESS_ACTS: ReadonlySet<AccountAct> = new Set(['unsuppress', 'allow_add', 'allow_remove'])

/** The once-value a form carries (base64url, 16 to 64 characters). */
export const ONCE_RE = /^[A-Za-z0-9_-]{16,64}$/
export const newOnce = () => toBase64url(crypto.getRandomValues(new Uint8Array(18)))

export type ActInput = {
  by: number // the admin
  act: AccountAct
  personId?: number | null
  email?: string | null // for acts on an address with no account
  reason: string // already checked with modReason
  once: string
  origin: string // for the verify link
  now?: number
}

// OPEN (#107): new wording, every refusal below.
export type ActResult = { ok: true } | { refused: string }
const no = (refused: string): ActResult => ({ refused })

export async function accountAct(db: D1Database, inp: ActInput): Promise<ActResult> {
  const ctx = ctxAt(db, inp.now ?? Date.now())
  const at = ctx.at
  if (!ONCE_RE.test(inp.once)) return no('this form expired. reload the page and try again.')
  const p = inp.personId ? await db.prepare(`SELECT ${ACCOUNT_COLS} FROM person WHERE id = ?`).bind(inp.personId).first<AccountRow>() : null
  if (inp.personId && !p) return no('there is no such account.')
  // The address an address act works on: the account's own, or the one looked up.
  const address = p ? p.email || null : inp.email?.trim().toLowerCase() || null
  if (ADDRESS_ACTS.has(inp.act)) {
    if (!address || !isEmail(address)) return no(p ? `@${p.handle} has no email address left.` : 'look up an account first.')
  } else if (!p) return no('look up an account first.')
  const log = (personId = p?.id ?? null) =>
    modLog(db, { by: inp.by, action: inp.act, personId, reason: inp.reason, public: PUBLIC_ACTS.has(inp.act), at })
  let stmts: D1PreparedStatement[]

  switch (inp.act) {
    case 'resend_verify': {
      if (!p) return no('look up an account first.')
      if (p.email_verified_at) return no(`@${p.handle} has a verified email already.`)
      if (p.status !== 'active') return no(`@${p.handle} is ${p.status}, so a verify link wouldn't work.`)
      const { token, stmt } = await newToken(db, p.id, 'verify', ctx.now)
      // As "send it again" on the check-email page (auth/signup.ts resendVerify): the new link replaces the older ones.
      // No throttles: the sender's caps on account mail still hold (jobs/mail.ts).
      stmts = [
        db.prepare("UPDATE email_token SET used_at = ? WHERE person_id = ? AND purpose = 'verify' AND used_at IS NULL").bind(at, p.id),
        stmt,
        verifyMail(db, p, token, inp.origin, at),
        log(),
      ]
      break
    }
    case 'mark_verified': {
      if (!p) return no('look up an account first.')
      if (p.email_verified_at) return no(`@${p.handle} has a verified email already.`)
      if (p.status === 'closed') return no(`@${p.handle} is closed.`)
      const made = await markVerifiedStatements(db, p.id, inp.origin, { now: ctx.now })
      if (!made) return no(`@${p.handle} has a verified email already.`)
      stmts = [...made, log()]
      break
    }
    case 'unsuppress': {
      const keys = emailKeys(address!)
      const row = await db.prepare('SELECT 1 AS ok FROM email_suppression WHERE email_norm IN (?, ?)').bind(...keys).first()
      if (!row) return no("that address isn't on the suppression list.")
      stmts = [db.prepare('DELETE FROM email_suppression WHERE email_norm IN (?, ?)').bind(...keys), log(p?.id ?? (await ownerOf(db, address!)))]
      break
    }
    case 'end_sessions': {
      if (!p) return no('look up an account first.')
      const n = await db.prepare('SELECT COUNT(*) AS n FROM session WHERE person_id = ?').bind(p.id).first<{ n: number }>()
      if (!n?.n) return no(`@${p.handle} isn't signed in anywhere.`)
      // As "sign out everywhere" (auth/session.ts endAllSessions): a pending email change dies with the sessions.
      stmts = [
        db.prepare('DELETE FROM session WHERE person_id = ?').bind(p.id),
        db.prepare("UPDATE email_token SET used_at = ? WHERE person_id = ? AND purpose = 'email_change' AND used_at IS NULL").bind(at, p.id),
        log(),
      ]
      break
    }
    case 'allow_add': {
      const norm = emailNorm(address!)
      const keys = emailKeys(address!)
      if (await db.prepare('SELECT 1 AS ok FROM signup_allow WHERE email_norm IN (?, ?)').bind(...keys).first()) return no('that address is on the allow-list already.')
      // The note says who invited them (migrations/0002); the reason says it.
      stmts = [db.prepare('INSERT INTO signup_allow (email_norm, note, added_at) VALUES (?, ?, ?)').bind(norm, inp.reason, at), log(p?.id ?? (await ownerOf(db, address!)))]
      break
    }
    case 'allow_remove': {
      const keys = emailKeys(address!)
      if (!(await db.prepare('SELECT 1 AS ok FROM signup_allow WHERE email_norm IN (?, ?)').bind(...keys).first())) return no("that address isn't on the allow-list.")
      stmts = [db.prepare('DELETE FROM signup_allow WHERE email_norm IN (?, ?)').bind(...keys), log(p?.id ?? (await ownerOf(db, address!)))]
      break
    }
    case 'founding': {
      if (!p) return no('look up an account first.')
      if (p.founding) return no(`@${p.handle} is founding already.`)
      if (p.status === 'closed') return no(`@${p.handle} is closed.`)
      // As an allow-listed address that verifies (auth/signin.ts markVerified): founding and established (A6).
      stmts = [db.prepare('UPDATE person SET founding = 1, established_at = COALESCE(established_at, ?) WHERE id = ? AND founding = 0').bind(at, p.id), log()]
      break
    }
    case 'unfounding': {
      if (!p) return no('look up an account first.')
      if (!p.founding) return no(`@${p.handle} isn't founding.`)
      // Established again only the way everyone else is (core/posts.ts upvote): an upvoted post and a week since joining.
      // OPEN (#107): a builder's default.
      stmts = [
        db
          .prepare(
            `UPDATE person SET founding = 0, established_at = CASE
               WHEN EXISTS (SELECT 1 FROM post x JOIN upvote u ON u.post_id = x.id WHERE x.person_id = ?1)
               THEN max(?2, strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+' || ?3 || ' seconds')) ELSE NULL END
             WHERE id = ?1 AND founding = 1`,
          )
          .bind(p.id, at, ESTABLISHED_AGE_MS / 1000),
        log(),
      ]
      break
    }
    case 'suspend': {
      if (!p) return no('look up an account first.')
      if (p.id === inp.by) return no("you can't suspend yourself.")
      if (p.status !== 'active') return no(`@${p.handle} is ${p.status} already.`)
      stmts = [
        db.prepare("UPDATE person SET status = 'suspended' WHERE id = ? AND status = 'active'").bind(p.id),
        db.prepare('DELETE FROM session WHERE person_id = ?').bind(p.id),
        // Emailed links stop working now, and don't come back with an unsuspend.
        db.prepare('UPDATE email_token SET used_at = ? WHERE person_id = ? AND used_at IS NULL').bind(at, p.id),
        db.prepare('UPDATE agent_key SET revoked_at = ? WHERE person_id = ? AND revoked_at IS NULL').bind(at, p.id),
        ...(p.email
          ? [mailStatement(db, { to: p.email, template: 'account_suspended', stream: 'security', personId: p.id, payload: { handle: p.handle, reason: inp.reason } }, at)]
          : []),
        log(),
        // Their DMs leave every agent view's list (read/node.ts readContributors: active accounts only), so every
        // signed-out version moves, as closing an account does (auth/close.ts).
        moderatedStatement(ctx),
      ]
      break
    }
    case 'unsuspend': {
      if (!p) return no('look up an account first.')
      if (p.status !== 'suspended') return no(`@${p.handle} isn't suspended.`)
      // Keys stay revoked: they make new ones. OPEN (#107): no mail says they're back.
      stmts = [db.prepare("UPDATE person SET status = 'active' WHERE id = ? AND status = 'suspended'").bind(p.id), log(), moderatedStatement(ctx)]
      break
    }
  }

  try {
    await db.batch([db.prepare('INSERT INTO auth_throttle (scope, count, window_start) VALUES (?, 0, ?)').bind(`admin:once:${inp.once}`, at), ...stmts])
  } catch (e) {
    if (/UNIQUE|PRIMARY KEY/i.test(String((e as Error)?.message ?? e)) && /auth_throttle/.test(String((e as Error)?.message ?? e))) return no('that form was sent already. reload the page to see where things stand.')
    throw e
  }
  return { ok: true }
}

/** The account an address belongs to, for the log row of an act on the address. */
async function ownerOf(db: D1Database, address: string): Promise<number | null> {
  const [plain, norm] = emailKeys(address)
  const r = await db.prepare('SELECT id FROM person WHERE email_norm IN (?1, ?2) OR lower(email) = ?1 LIMIT 1').bind(plain, norm).first<{ id: number }>()
  return r?.id ?? null
}
