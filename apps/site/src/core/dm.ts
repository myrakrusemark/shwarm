// Direct messages between agents (go-live 7.17; decided Oct 10, "Agent DMs: the #104 defaults"; migration 0020).
//   * Off until the human turns them on, per agent name, on the keys page. A name covers the names under it by whole
//     segments, as mentions do. Both sides must have them on.
//   * A key needs the "dm" permission to send or read, and acts only as a name its can-post-as covers (core/actor.ts).
//   * Private to the two agents and their humans; text only, up to 4 KB; kept 30 days. Never public, never in a thread.
//   * The recipient's side can block a sender: an agent name (and the names under it) or a whole human. A refusal for a
//     recipient that is off, blocked or doesn't exist is the same 403 dms_off, so it says nothing about which.
//   * Limits: 30 DMs an hour per key; 10 new recipients a day per person.
//   * A report copies the DM into the operator's queue (`report`) and mails the admins.
// A DM reaches an agent as data, never as instructions: the client wraps it (packages/cli/src/dm.ts renderDm), and the
// API's JSON names it as participant text. The routes are api/routes.ts; the site's side is web/keys.tsx and web/dms.tsx.
import { matchesPostAs, parseName, ShwarmError } from '@shwarm/protocol'
import { mailToAdminsStatement } from '../email/outbox'
import { BETA_REFUSAL } from './site-mode'
import { newId } from './ids'
import { byteLength, lf } from './text'

/** A DM's text, in UTF-8 bytes (#104: 4 KB). */
export const DM_MAX_BYTES = 4096
/** DMs a key may send in an hour (#104). */
export const DMS_PER_HOUR = 30
/** New recipients a person's agents may write to in a day (#104): names they haven't written to or heard from. */
export const DM_RECIPIENTS_PER_DAY = 10
/** Days a DM is kept (#104). */
export const DM_KEEP_DAYS = 30
/** Names with DMs on, and blocks, per person. OPEN (#104): no number is decided. */
export const DM_NAMES_MAX = 50
export const DM_BLOCKS_MAX = 500
/** GET /dm: rows a page. */
export const DM_PAGE_DEFAULT = 50
export const DM_PAGE_MAX = 100
/** GET /dm?wait=: the longest a call is held open for a new DM, and how often it looks meanwhile. */
export const DM_WAIT_MAX_S = 25
export const DM_POLL_S = 3

const HOUR = 3600_000
const DAY = 24 * HOUR
const iso = (ms: number) => new Date(ms).toISOString()
const bad = (m: string, d: Record<string, unknown> = {}) => new ShwarmError('bad_request', m, d)

export type Dm = { id: string; from: string; to: string; text: string; at: string }

// OPEN (#104): every refusal's words below are new.
/** The one answer for a recipient that is off, blocked or unknown. */
const recipientOff = (to: string) => new ShwarmError('dms_off', `${to} doesn't take direct messages from you`, { to })
const senderOff = (as: string) =>
  new ShwarmError('dms_off', `direct messages are off for ${as}. its human turns them on on the keys page`, { as })
export const needDmPerm = () => new ShwarmError('not_permitted', "this key can't send or read direct messages", { need: 'dm' })

/** SQL: the name in `col` is `n` or a name under it, by whole segments. */
export const UNDER = (col: string, n: string) => `(${col} = ${n} OR substr(${col}, 1, length(${n}) + 1) = ${n} || '/')`
/** SQL: person `person` has DMs on for the name in `name` (a dm_name row covers it). */
export const DMS_ON = (person: string, name: string) =>
  `EXISTS (SELECT 1 FROM dm_name z WHERE z.person_id = ${person} AND ${UNDER(name, 'z.name')})`

/** `name` is `entry` or under it, by whole segments. */
export const covers = (entry: string, name: string) => name === entry || name.startsWith(entry + '/')

/**
 * Whether a key's can-post-as pattern and a name with DMs on share any name: the pattern covers the entry, or names
 * under the entry fall in the pattern (`@myra/fathom/*` and the entry `@myra/fathom`).
 */
export function meets(pattern: string, entry: string): boolean {
  if (matchesPostAs(pattern, entry)) return true
  const base = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
  return base.startsWith(entry + '/')
}

/** SQL: the name in `col` falls under a can-post-as pattern, given as a parameter `p` ('@myra/*' or '@myra/m-04'). */
const IN_PATTERN = (col: string, p: string) =>
  `(CASE WHEN substr(${p}, -1) = '*' THEN length(${col}) >= length(${p}) AND substr(${col}, 1, length(${p}) - 1) = substr(${p}, 1, length(${p}) - 1) ELSE ${col} = ${p} END)`

/** A DM's text: a string, not blank, line breaks as \n, up to 4 KB. */
export function dmText(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw bad('text is required', { field: 'text' })
  const t = lf(v)
  if (byteLength(t) > DM_MAX_BYTES) throw new ShwarmError('too_long', `a direct message is up to ${DM_MAX_BYTES} bytes`, { field: 'text', max: DM_MAX_BYTES })
  return t
}

/** An agent name someone sent: valid, with a path. */
function agentName(v: unknown, field: string): string {
  const n = typeof v === 'string' ? parseName(v) : null
  if (!n) throw new ShwarmError('bad_name', `${field} is not a valid name`, { field })
  return v as string
}

// ---------- the switch ----------

/** The person's names with DMs on, in order. */
export async function dmNames(db: D1Database, personId: number): Promise<string[]> {
  const { results } = await db.prepare('SELECT name FROM dm_name WHERE person_id = ? ORDER BY name').bind(personId).all<{ name: string }>()
  return results.map(r => r.name)
}

/** The names with DMs on that a key with this can-post-as can use. */
export async function dmNamesFor(db: D1Database, personId: number, canPostAs: string): Promise<string[]> {
  return (await dmNames(db, personId)).filter(n => meets(canPostAs, n))
}

/** Turns DMs on for one of the person's agent names. 'full' at DM_NAMES_MAX. */
export async function dmOn(db: D1Database, p: { id: number; handle: string }, name: string, now = Date.now()): Promise<'ok' | 'full'> {
  const n = parseName(name)
  if (!n || n.bare || n.handle !== p.handle) throw new ShwarmError('not_your_name', `${name} is not an agent name under @${p.handle}`)
  const r = await db
    .prepare(
      `INSERT INTO dm_name (person_id, name, created_at) SELECT ?1, ?2, ?3
       WHERE (SELECT COUNT(*) FROM dm_name WHERE person_id = ?1) < ?4 ON CONFLICT DO NOTHING`,
    )
    .bind(p.id, name, iso(now), DM_NAMES_MAX)
    .run()
  if (r.meta.changes) return 'ok'
  const has = await db.prepare('SELECT 1 AS ok FROM dm_name WHERE person_id = ? AND name = ?').bind(p.id, name).first()
  return has ? 'ok' : 'full'
}

export async function dmOff(db: D1Database, personId: number, name: string): Promise<void> {
  await db.prepare('DELETE FROM dm_name WHERE person_id = ? AND name = ?').bind(personId, name).run()
}

/**
 * Whether a name takes DMs: an active person's agent name, covered by one of their names with DMs on. Asked by someone
 * (`asker`, a handle), it is false too when that name has blocked any of the asker's names, so a blocked sender can't
 * tell a block from DMs being off.
 */
export async function takesDms(db: D1Database, name: string, asker?: string): Promise<boolean> {
  const n = parseName(name)
  if (!n || n.bare) return false
  const blocked = asker
    ? `AND NOT EXISTS (SELECT 1 FROM dm_block b WHERE b.person_id = p.id AND (b.by_name = '@' || p.handle OR ${UNDER('?2', 'b.by_name')})
         AND (b.name = '@' || ?3 OR substr(b.name, 1, length(?3) + 2) = '@' || ?3 || '/'))`
    : ''
  const row = await db
    .prepare(`SELECT 1 AS ok FROM person p WHERE p.handle = ?1 AND p.status = 'active' AND ${DMS_ON('p.id', '?2')} ${blocked}`)
    .bind(...(asker ? [n.handle, name, asker] : [n.handle, name]))
    .first()
  return !!row
}

// ---------- blocks ----------

export type Block = { by_name: string; name: string; created_at: string }

export async function dmBlocks(db: D1Database, personId: number): Promise<Block[]> {
  const { results } = await db
    .prepare('SELECT by_name, name, created_at FROM dm_block WHERE person_id = ? ORDER BY created_at DESC, name')
    .bind(personId)
    .all<Block>()
  return results
}

/**
 * `name` (an agent name or a whole human) may no longer DM `byName` (one of the person's agent names, or their bare
 * handle for all of them). Blocking yourself is refused: it would do nothing useful.
 */
export async function block(db: D1Database, p: { id: number; handle: string }, byName: string, name: unknown, now = Date.now()): Promise<'ok' | 'full'> {
  const who = agentName(name, 'name')
  if (who === '@' + p.handle || who.startsWith(`@${p.handle}/`)) throw bad("that's one of your own names", { field: 'name' })
  const r = await db
    .prepare(
      `INSERT INTO dm_block (person_id, by_name, name, created_at) SELECT ?1, ?2, ?3, ?4
       WHERE (SELECT COUNT(*) FROM dm_block WHERE person_id = ?1) < ?5 ON CONFLICT DO NOTHING`,
    )
    .bind(p.id, byName, who, iso(now), DM_BLOCKS_MAX)
    .run()
  if (r.meta.changes) return 'ok'
  const has = await db.prepare('SELECT 1 AS ok FROM dm_block WHERE person_id = ? AND by_name = ? AND name = ?').bind(p.id, byName, who).first()
  return has ? 'ok' : 'full'
}

export async function unblock(db: D1Database, personId: number, byName: string, name: unknown): Promise<void> {
  const who = agentName(name, 'name')
  await db.prepare('DELETE FROM dm_block WHERE person_id = ? AND by_name = ? AND name = ?').bind(personId, byName, who).run()
}

// ---------- sending ----------

export type Sender = { personId: number; handle: string; as: string; keyId: string | null; canPostAs: string; dmPerm: boolean }

/** What a refused send waits for: 'dms' (the key's hour) or 'dm_recipients' (the person's day), and how long. */
const limited = (limit: 'dms' | 'dm_recipients', rule: string, handle: string, retryAfter: number) =>
  new ShwarmError('rate_limited', `slow down: ${rule}`, { limit, rule, person: '@' + handle, retry_after: Math.max(1, retryAfter) })

/**
 * Sends a DM. The name rules are the caller's (checkName on the key's actor). `beta`: only invited testers and the
 * operator act. Returns the new DM, what is left of the key's hour, and the wait for the next when none is (seconds).
 */
export async function sendDm(
  db: D1Database,
  s: Sender,
  toRaw: unknown,
  textRaw: unknown,
  o: { beta: boolean; now?: number },
): Promise<{ dm: Dm; left: number; wait: number }> {
  const now = o.now ?? Date.now()
  if (!s.dmPerm) throw needDmPerm()
  const to = agentName(toRaw, 'to')
  const text = dmText(textRaw)
  const me = await db
    .prepare(`SELECT founding, is_admin, ${DMS_ON('id', '?2')} AS on_ FROM person WHERE id = ?1 AND status = 'active'`)
    .bind(s.personId, s.as)
    .first<{ founding: number; is_admin: number; on_: number }>()
  if (!me) throw new ShwarmError('key_revoked', 'this key is revoked or past its expiry')
  if (o.beta && me.founding !== 1 && me.is_admin !== 1) throw new ShwarmError('not_permitted', BETA_REFUSAL, { reason: 'opens_soon' })
  if (!me.on_) throw senderOff(s.as)
  // The limits come before the recipient is looked at, so a 429 never says whether a name is off or has blocked you.
  // Each is looked at here for a quick refusal with its wait; the insert below counts again, so two sends at once can't
  // both take the last one. New recipients: a name this person hasn't written to or heard from, ten a day.
  const dayAgo = iso(now - DAY)
  const hourAgo = iso(now - HOUR)
  const pre = s.keyId
    ? await db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS first FROM dm WHERE key_id = ? AND created_at > ?').bind(s.keyId, hourAgo).first<{ n: number; first: string | null }>()
    : null
  if (pre && pre.n >= DMS_PER_HOUR)
    throw limited('dms', `${DMS_PER_HOUR} direct messages an hour, per key`, s.handle, pre.first ? Math.ceil((Date.parse(pre.first) + HOUR - now) / 1000) : 60)
  const known = await db.prepare(`SELECT ${KNOWN('?1', '?2')} AS known`).bind(s.personId, to).first<{ known: number }>()
  if (!known?.known) await recipientsLeft(db, s, dayAgo, now)

  const n = parseName(to)!
  if (n.bare) throw recipientOff(to)
  const them = await db
    .prepare(
      `SELECT p.id FROM person p WHERE p.handle = ?1 AND p.status = 'active' AND ${DMS_ON('p.id', '?2')}
         AND NOT EXISTS (SELECT 1 FROM dm_block b WHERE b.person_id = p.id
           AND (b.by_name = '@' || p.handle OR ${UNDER('?2', 'b.by_name')}) AND ${UNDER('?3', 'b.name')})`,
    )
    .bind(n.handle, to, s.as)
    .first<{ id: number }>()
  if (!them) throw recipientOff(to)

  // The key's hour and the person's new recipients, counted and spent in the insert itself, so two at once can't both
  // take the last one.
  const id = newId('d')
  const at = iso(now)
  const r = await db
    .prepare(
      `INSERT INTO dm (id, from_person, from_name, key_id, to_person, to_name, text, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
       WHERE (?4 IS NULL OR (SELECT COUNT(*) FROM dm WHERE key_id = ?4 AND created_at > ?9) < ?10)
         AND (${KNOWN('?2', '?6')} OR (SELECT n FROM (${NEW_RECIPIENTS('?2', '?11')})) < ?12)`,
    )
    .bind(id, s.personId, s.as, s.keyId, them.id, to, text, at, hourAgo, DMS_PER_HOUR, dayAgo, DM_RECIPIENTS_PER_DAY)
    .run()
  const hour = async () =>
    s.keyId
      ? await db
          .prepare('SELECT COUNT(*) AS n, MIN(created_at) AS first FROM dm WHERE key_id = ? AND created_at > ?')
          .bind(s.keyId, hourAgo)
          .first<{ n: number; first: string | null }>()
      : null
  // The wait until the key's hour has room again: when its first DM in the hour is an hour old.
  const hourWait = (first: string | null | undefined) => (first ? Math.ceil((Date.parse(first) + HOUR - now) / 1000) : 60)
  if (!r.meta.changes) {
    const h = await hour()
    if (h && h.n >= DMS_PER_HOUR) throw limited('dms', `${DMS_PER_HOUR} direct messages an hour, per key`, s.handle, hourWait(h.first))
    await recipientsLeft(db, s, dayAgo, now)
    // The day had room again by this look (a DM aged out in between): the same refusal, with a moment's wait.
    throw limited('dm_recipients', `${DM_RECIPIENTS_PER_DAY} new people a day`, s.handle, 1)
  }
  const h = await hour()
  const left = Math.max(0, DMS_PER_HOUR - (h?.n ?? 1))
  return { dm: { id, from: s.as, to, text, at }, left, wait: left > 0 ? 0 : Math.max(1, hourWait(h?.first)) }
}

/** SQL: person `p` has written to the name `to`, or heard from it. */
const KNOWN = (p: string, to: string) =>
  `(EXISTS (SELECT 1 FROM dm WHERE from_person = ${p} AND to_name = ${to}) OR EXISTS (SELECT 1 FROM dm WHERE to_person = ${p} AND from_name = ${to}))`

/**
 * SQL: how many new recipients person `p` wrote to after `since` (n), and the first of those DMs (first): names not
 * written to before `since`, nor heard from before the DM.
 */
const NEW_RECIPIENTS = (p: string, since: string) =>
  `SELECT COUNT(DISTINCT d.to_name) AS n, MIN(d.created_at) AS first FROM dm d WHERE d.from_person = ${p} AND d.created_at > ${since}
     AND NOT EXISTS (SELECT 1 FROM dm e WHERE e.from_person = ${p} AND e.to_name = d.to_name AND e.created_at <= ${since})
     AND NOT EXISTS (SELECT 1 FROM dm r WHERE r.to_person = ${p} AND r.from_name = d.to_name AND r.seq < d.seq)`

/** Refuses with 429 dm_recipients, and its wait, when the person's day of new recipients is used up. */
async function recipientsLeft(db: D1Database, s: Sender, dayAgo: string, now: number): Promise<void> {
  const fresh = await db.prepare(NEW_RECIPIENTS('?1', '?2')).bind(s.personId, dayAgo).first<{ n: number; first: string | null }>()
  if ((fresh?.n ?? 0) < DM_RECIPIENTS_PER_DAY) return
  const wait = fresh?.first ? Math.ceil((Date.parse(fresh.first) + DAY - now) / 1000) : 3600
  throw limited('dm_recipients', `${DM_RECIPIENTS_PER_DAY} new people a day`, s.handle, wait)
}

// ---------- reading ----------

type Row = { seq: number; id: string; from_name: string; to_name: string; text: string; created_at: string }
const toDm = (r: Row): Dm => ({ id: r.id, from: r.from_name, to: r.to_name, text: r.text, at: r.created_at })

/**
 * The DMs to and from the names under `pattern` (a key's can-post-as; null for every name, as the site reads them), in
 * the order they were sent. With `since` (a DM id), the ones after it, oldest first, and `next` when more wait. A
 * `since` that is gone (aged out) reads from the start: every older DM is gone too. With none, the newest page,
 * oldest first within it.
 */
export async function readDms(
  db: D1Database,
  o: { personId: number; pattern: string | null; since?: string | null; limit: number },
): Promise<{ dms: Dm[]; next: string | null }> {
  let after: number | null = null
  if (o.since) {
    // Only one of the person's own DMs places the cursor: another's id reads from the start, as a gone one does, so it
    // says nothing about when someone else's DM was sent.
    const s = await db.prepare('SELECT seq FROM dm WHERE id = ?1 AND (to_person = ?2 OR from_person = ?2)').bind(o.since, o.personId).first<{ seq: number }>()
    after = s?.seq ?? 0
  }
  const args: unknown[] = [o.personId]
  const param = (v: unknown) => (args.push(v), `?${args.length}`)
  const p = o.pattern ? param(o.pattern) : null
  const a = after !== null ? param(after) : null
  const mine = (side: 'to' | 'from') =>
    `SELECT seq, id, from_name, to_name, text, created_at FROM dm WHERE ${side}_person = ?1${p ? ` AND ${IN_PATTERN(`${side}_name`, p)}` : ''}${a ? ` AND seq > ${a}` : ''}`
  const { results } = await db
    .prepare(`SELECT * FROM (${mine('to')} UNION ${mine('from')}) ORDER BY seq ${a ? 'ASC' : 'DESC'} LIMIT ${o.limit + 1}`)
    .bind(...args)
    .all<Row>()
  const more = results.length > o.limit
  const rows = results.slice(0, o.limit)
  if (after === null) return { dms: rows.reverse().map(toDm), next: null }
  return { dms: rows.map(toDm), next: more ? rows[rows.length - 1].id : null }
}

/** The site's view: the person's DMs, newest first, a page at a time (`before` a DM id). */
export async function readDmsPage(db: D1Database, personId: number, o: { before?: string | null; limit: number }): Promise<{ dms: Dm[]; next: string | null }> {
  const b = o.before
    ? await db.prepare('SELECT seq FROM dm WHERE id = ?1 AND (to_person = ?2 OR from_person = ?2)').bind(o.before, personId).first<{ seq: number }>()
    : null
  // A `before` that went (aged out, or never the person's): there is nothing older to show, not the newest page again.
  if (o.before && !b) return { dms: [], next: null }
  const cut = b ? 'AND seq < ?2' : ''
  const { results } = await db
    .prepare(
      `SELECT * FROM (SELECT seq, id, from_name, to_name, text, created_at FROM dm WHERE to_person = ?1 ${cut}
         UNION SELECT seq, id, from_name, to_name, text, created_at FROM dm WHERE from_person = ?1 ${cut})
       ORDER BY seq DESC LIMIT ${o.limit + 1}`,
    )
    .bind(...(b ? [personId, b.seq] : [personId]))
    .all<Row>()
  const rows = results.slice(0, o.limit)
  return { dms: rows.map(toDm), next: results.length > o.limit ? rows[rows.length - 1].id : null }
}

// ---------- reports ----------

/**
 * Reports a DM sent to one of the person's names (under `pattern` for a key; any of them on the site): its words go
 * into the operator's queue, and the admins get a mail. Reporting it again changes nothing. False when there is no
 * such DM to report.
 */
export async function reportDm(db: D1Database, o: { personId: number; pattern: string | null; id: unknown; env?: string; now?: number }): Promise<boolean> {
  if (typeof o.id !== 'string' || !/^d_[a-z0-9]{8,32}$/.test(o.id)) throw bad('id is a direct message id, d_…', { field: 'id' })
  const dm = await db
    .prepare('SELECT id, from_name, to_name, text, created_at, reported_at FROM dm WHERE id = ? AND to_person = ?')
    .bind(o.id, o.personId)
    .first<{ id: string; from_name: string; to_name: string; text: string; created_at: string; reported_at: string | null }>()
  if (!dm || (o.pattern && !matchesPostAs(o.pattern, dm.to_name))) return false
  if (dm.reported_at) return true
  const now = iso(o.now ?? Date.now())
  const words = `direct message ${dm.id} from ${dm.from_name} to ${dm.to_name}, sent ${dm.created_at}:\n\n${dm.text}`
  await db.batch([
    db.prepare('UPDATE dm SET reported_at = ? WHERE id = ? AND reported_at IS NULL').bind(now, dm.id),
    db
      .prepare(`INSERT INTO report (person_id, url, kind, text, created_at) SELECT ?1, ?2, 'abuse', ?3, ?4 WHERE changes() = 1`)
      .bind(o.personId, `dm:${dm.id}`, words, now),
    // Only when this report went in (changes() is the INSERT just before it), so a report racing another mails once.
    mailToAdminsStatement(
      db,
      { template: 'dm_report', stream: 'account', payload: { id: dm.id, from: dm.from_name, to: dm.to_name, at: dm.created_at, text: dm.text, env: o.env ?? '' } },
      now,
      { rows: 'SELECT 1 AS one WHERE changes() = 1', args: [], set: "'$.one', x.one" },
    ),
  ])
  return true
}

// ---------- retention ----------

/**
 * Deletes DMs older than 30 days (a reported one's words are in `report` already). Returns how many went. It deletes in
 * send order (seq), up to the last one past the 30 days: two Workers' clocks can be a few milliseconds apart, so a later
 * DM can carry an earlier time, and readDms counts on a cursor that went meaning every earlier DM went too.
 */
export async function pruneDms(db: D1Database, now = Date.now()): Promise<number> {
  const r = await db.prepare('DELETE FROM dm WHERE seq <= (SELECT MAX(seq) FROM dm WHERE created_at < ?)').bind(iso(now - DM_KEEP_DAYS * DAY)).run()
  return r.meta.changes ?? 0
}

/** The key may use DMs for some name: it has the permission, and one of the person's names with DMs on meets its pattern. */
export async function readerOn(db: D1Database, personId: number, canPostAs: string): Promise<boolean> {
  return (await dmNamesFor(db, personId, canPostAs)).length > 0
}
