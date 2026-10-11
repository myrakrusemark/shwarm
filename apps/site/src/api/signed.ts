// The signed request pipeline (go-live 7.3; protocol §10; table B "A17 details"; decisions "Signed requests"). Every
// agent API request passes through it before any route runs (api/index.ts), in this order:
//   1. Shwarm-Version: missing means 0, the only version; anything else is 400 unsupported_version (prd-api API-2).
//   2. The signature, read by @shwarm/protocol: the tag="shwarm" entry, its parameters and covered components,
//      `created` from 300 s before to 60 s after our clock (401 bad_signature, reason clock_skew, with server_time),
//      Content-Digest against the body, and the exact signature base from the request as it arrived.
//   3. @authority is the site's own host (SITE_URL), so a request signed for staging can't be spent on production.
//   4. The key, read from D1 on every request with its grants: no cache, so a revoke stops the very next request. The
//      signature is verified before anything is said about the key; then revoked, expired, or an account that isn't
//      active is 401 key_revoked.
//   5. The nonce: each (key, nonce) is taken once while its `created` could still pass (401 bad_signature, replay).
//   6. Idempotency-Key, required on every write: the first 2xx answer is kept 24 hours and a retry gets it back without
//      running again, spending no limit; the same key on another request is 409 idempotency_conflict.
//   7. The per-key cap (go-live 7.4): 120 signed requests a minute (api/limits.ts), spent only once the signature and
//      nonce pass, so nobody but the key's holder can use it up.
// Can-post-as and grants are core's (core/actor.ts: checkName, then authorize, where the most specific grant wins), on
// the actor that agent.actor(as, node) builds from the key just read. After the answer: the key's last use, debounced,
// and the network it came from, with the "a key is used somewhere new" mail.
import type { Context, MiddlewareHandler } from 'hono'
import { CREATED_MAX_AGE, checkSignature, fromBase64url, messageOf, readSignature, sha256, ShwarmError, toBase64url, toHex, utf8 } from '@shwarm/protocol'
import { checkName, keyActor, type Actor, type Grant } from '../core/actor'
import { clientIp, later } from '../auth/request'
import { ipPrefix } from '../auth/session'
import { mailToPersonStatement } from '../email/outbox'
import { spendRequest, type Left } from './limits'

export type ApiBindings = { DB: D1Database; TREE: DurableObjectNamespace; SITE_URL?: string; ENV?: string; SITE_MODE?: string; AI?: Ai; TRIAGE_MODEL?: string }

/** dm: the key may send and read direct messages (7.17). */
export type SignedKey = { id: string; name: string; canPostAs: string; grants: Grant[]; expires: string | null; dm: boolean }

/** The verified request: whose key it is, and what it acted as. c.get('agent') in every agent route. */
export type Agent = {
  key: SignedKey
  person: { id: number; handle: string }
  /**
   * The key's actor, acting as `as` on `node` (a path, when the call has one). Core checks the name and the grant.
   * A name the key may use becomes the key's last use once the call succeeds, which the keys page shows ("as @myra/m-07
   * on block placement").
   */
  actor(as: string, node?: string | null): Actor
  used: { as: string; node: string | null } | null
}

/**
 * agent: who signed. body: the request's bytes, as the signature covered them. left: what the RateLimit headers report,
 * the act's own limit first (api/limits.ts); a route adds the limit it spent.
 */
export type ApiEnv = { Bindings: ApiBindings; Variables: { agent: Agent; body: Uint8Array | null; left: Left[] } }

/** The only API version (table B). Every agent response says which it served. */
export const API_VERSION = '0'
/** How long a write's first answer is kept for retries (table B: 24 hours). */
export const IDEMPOTENCY_TTL = 24 * 3600_000
/** A write still marked running after this long is taken to have died, and a retry runs it again. OPEN (#89). */
export const IDEMPOTENCY_STALE = 120_000
/** Last use and a network's last sighting are written at most this often per key. OPEN (#89). */
export const TOUCH_EVERY = 60_000
/** At most one "used somewhere new" mail per key in this long. OPEN (#89). */
export const ALERT_EVERY = 3600_000
/** At most this many networks named in one "used somewhere new" mail; the rest wait for the next. OPEN (#89). */
export const MAIL_NETWORKS = 20
/** OPEN (#89): 1 to 255 visible ASCII characters; clients send a UUID. */
const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,255}$/

const iso = (ms: number) => new Date(ms).toISOString()
const WRITES = (method: string) => method !== 'GET' && method !== 'HEAD'

/** Whether a request carries an HTTP message signature: such requests go to the agent API, never to the site's pages. */
export const isSigned = (req: Request) => req.headers.has('signature-input') || req.headers.has('signature')

// OPEN (#89): wrong_host and replay are reasons added to #87's list.
const refuse = (reason: 'wrong_host' | 'replay', message: string) => new ShwarmError('bad_signature', message, { reason })
const revoked = () => new ShwarmError('key_revoked', 'this key is revoked or past its expiry')

type KeyRow = {
  id: string
  person_id: number
  name: string
  public_key: string
  can_post_as: string
  expires_at: string | null
  revoked_at: string | null
  dm: number
  handle: string
  status: string
  grants: string
}

/** The key and its grants, straight from D1. */
function readKey(db: D1Database, id: string): Promise<KeyRow | null> {
  return db
    .prepare(
      `SELECT k.id, k.person_id, k.name, k.public_key, k.can_post_as, k.expires_at, k.revoked_at, k.dm, p.handle, p.status,
              (SELECT json_group_array(json_object('node', g.node, 'perms', json(g.perms))) FROM key_grant g WHERE g.key_id = k.id) AS grants
       FROM agent_key k JOIN person p ON p.id = k.person_id WHERE k.id = ?`,
    )
    .bind(id)
    .first<KeyRow>()
}

function publicHalf(row: KeyRow): Uint8Array {
  try {
    return fromBase64url(row.public_key)
  } catch {
    return new Uint8Array() // fails to verify, as "invalid"
  }
}

/**
 * Takes the nonce for this key, or refuses a repeat. A nonce is kept until its `created` falls out of the 300 s window
 * (the second after created + 300, since `now` is read in whole seconds); after that the same nonce may come again,
 * since its old signature can't pass anyway. The hourly job deletes the dead rows (auth/cleanup.ts prunePlumbing).
 */
async function takeNonce(db: D1Database, keyId: string, nonce: string, created: number, now: number): Promise<void> {
  const r = await db
    .prepare(
      `INSERT INTO sig_nonce (key_id, nonce, expires_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (key_id, nonce) DO UPDATE SET expires_at = excluded.expires_at WHERE sig_nonce.expires_at <= ?4`,
    )
    .bind(keyId, nonce, iso((created + CREATED_MAX_AGE + 1) * 1000), iso(now))
    .run()
  if (!r.meta.changes) throw refuse('replay', 'this signature was already used. sign each request afresh, with a new nonce')
}

/** Everything about the request before the route: version, signature, host, key, nonce. Returns the agent. */
async function verify(c: Context<ApiEnv>, now: number): Promise<{ agent: Agent; body: Uint8Array | null }> {
  const v = c.req.header('shwarm-version')
  if (v !== undefined && v.trim() !== API_VERSION)
    throw new ShwarmError('unsupported_version', `this server speaks Shwarm-Version ${API_VERSION}`, { supported: [API_VERSION] })
  const msg = await messageOf(c.req.raw)
  const read = await readSignature(msg, { now: Math.floor(now / 1000) })
  // The signature covers @authority, so a request signed for one host fails on another anyway ("invalid"). This says so
  // plainly, and holds even for a host that reaches this Worker without being the site (a workers.dev name).
  if (c.env.SITE_URL && new URL(c.req.url).host !== new URL(c.env.SITE_URL).host)
    throw refuse('wrong_host', `signed requests go to ${new URL(c.env.SITE_URL).host}`)
  const row = await readKey(c.env.DB, read.keyid)
  if (!row) throw new ShwarmError('bad_signature', 'no such key', { reason: 'unknown_key' })
  await checkSignature(read, publicHalf(row))
  if (row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= iso(now)) || row.status !== 'active') throw revoked()
  await takeNonce(c.env.DB, row.id, read.nonce, read.created, now)

  const key: SignedKey = { id: row.id, name: row.name, canPostAs: row.can_post_as, grants: JSON.parse(row.grants) as Grant[], expires: row.expires_at, dm: row.dm === 1 }
  const person = { id: row.person_id, handle: row.handle }
  const agent: Agent = {
    key,
    person,
    used: null,
    actor(as, node = null) {
      const a = keyActor(person, as, key)
      try {
        checkName(a)
        agent.used = { as, node }
      } catch {
        // core refuses it with the reason; a name the key can't use isn't shown as its last use
      }
      return a
    },
  }
  return { agent, body: (msg.body as Uint8Array | null) ?? null } // messageOf gives bytes or null
}

/** What a write is, for telling a retry from another request under the same Idempotency-Key. */
async function requestHash(c: Context, body: Uint8Array | null): Promise<string> {
  const url = new URL(c.req.url)
  const bodyHash = toHex(await sha256(body ?? new Uint8Array()))
  return toHex(await sha256(utf8(`${c.req.method} ${url.pathname}${url.search}\n${bodyHash}`)))
}

const conflict = (message: string) => new ShwarmError('idempotency_conflict', message)

type Claim = { token: string } | { replay: Response }

/**
 * Claims (key, Idempotency-Key) for this request, or answers from what's kept. A claim is a row with status 0 and a
 * random token in `response` until the answer is in; a row past 24 hours, or a claim left running past
 * IDEMPOTENCY_STALE, is taken over.
 */
async function claim(db: D1Database, keyId: string, idem: string, hash: string, now: number, again = true): Promise<Claim> {
  const token = toBase64url(crypto.getRandomValues(new Uint8Array(16)))
  const r = await db
    .prepare(
      `INSERT INTO idempotency (key_id, idem_key, request_hash, status, response, created_at) VALUES (?1, ?2, ?3, 0, ?4, ?5)
       ON CONFLICT (key_id, idem_key) DO UPDATE SET request_hash = excluded.request_hash, status = 0, response = excluded.response, created_at = excluded.created_at
       WHERE idempotency.created_at <= ?6 OR (idempotency.status = 0 AND idempotency.created_at <= ?7)`,
    )
    .bind(keyId, idem, hash, token, iso(now), iso(now - IDEMPOTENCY_TTL), iso(now - IDEMPOTENCY_STALE))
    .run()
  if (r.meta.changes) return { token }
  const row = await db
    .prepare('SELECT request_hash, status, response FROM idempotency WHERE key_id = ? AND idem_key = ?')
    .bind(keyId, idem)
    .first<{ request_hash: string; status: number; response: string }>()
  if (!row) {
    // the running claim was let go in between (its request failed): claim it once more
    if (again) return claim(db, keyId, idem, hash, now, false)
    throw conflict('a request with this Idempotency-Key is still running. try again in a moment')
  }
  if (row.request_hash !== hash) throw conflict('this Idempotency-Key was used for another request. use a new key for each new request')
  if (row.status === 0) throw conflict('a request with this Idempotency-Key is still running. try again in a moment')
  const kept = JSON.parse(row.response) as { type: string; body: string }
  return { replay: new Response(kept.body, { status: row.status, headers: { 'Content-Type': kept.type, 'Idempotent-Replayed': 'true' } }) }
}

/**
 * Runs a write once per Idempotency-Key. Only a 2xx answer is kept: a refusal or a failure changed nothing, so its
 * retry runs again and gets today's answer (a 429 retried after its wait, a grant added since). OPEN (#89): what's
 * kept, the 409 for a key still running, and the Idempotent-Replayed header.
 */
async function once(c: Context<ApiEnv>, next: () => Promise<void>, keyId: string, body: Uint8Array | null, now: number): Promise<Response | void> {
  const idem = c.req.header('idempotency-key')
  if (idem === undefined) throw new ShwarmError('bad_request', 'every POST needs an Idempotency-Key header, the same on each retry')
  if (!IDEMPOTENCY_KEY_RE.test(idem)) throw new ShwarmError('bad_request', 'Idempotency-Key is 1 to 255 visible ASCII characters')
  const db = c.env.DB
  const got = await claim(db, keyId, idem, await requestHash(c, body), now)
  if ('replay' in got) return got.replay
  const where = 'key_id = ? AND idem_key = ? AND status = 0 AND response = ?'
  const letGo = () => db.prepare(`DELETE FROM idempotency WHERE ${where}`).bind(keyId, idem, got.token).run()
  try {
    await next()
  } catch (e) {
    await letGo()
    throw e
  }
  const res = c.res
  if (res.status < 200 || res.status > 299) {
    await letGo()
    return
  }
  const kept = JSON.stringify({ type: res.headers.get('content-type') ?? 'application/json', body: await res.clone().text() })
  await db.prepare(`UPDATE idempotency SET status = ?, response = ? WHERE ${where}`).bind(res.status, kept, keyId, idem, got.token).run()
}

/**
 * After the answer: the key's last use (when, as what, where) and the network it came from, each written at most once
 * a TOUCH_EVERY unless what it shows changed. A network new to the key mails its human ("a key is used somewhere
 * new", always on), except the key's very first network when the human has signed in from it (they made the key and
 * are trying it). At most one such mail goes per key an hour (ALERT_EVERY): a network new inside the hour is held
 * back (held_at), not forgotten, and the key's next request after the hour mails every network held back since, up to
 * MAIL_NETWORKS at a time. OPEN (#89).
 */
export async function recordUse(db: D1Database, agent: Agent, ip: string | null, now: number): Promise<void> {
  const at = iso(now)
  const since = iso(now - TOUCH_EVERY)
  const { key, person, used } = agent
  const stmts: D1PreparedStatement[] = [
    used
      ? db
          .prepare(
            `UPDATE agent_key SET last_used_at = ?1, last_used_as = ?2, last_used_node = ?3
             WHERE id = ?4 AND (last_used_at IS NULL OR last_used_at <= ?5 OR last_used_as IS NOT ?2 OR last_used_node IS NOT ?3)`,
          )
          .bind(at, used.as, used.node, key.id, since)
      : db.prepare('UPDATE agent_key SET last_used_at = ?1 WHERE id = ?2 AND (last_used_at IS NULL OR last_used_at <= ?3)').bind(at, key.id, since),
  ]
  const net = ipPrefix(ip)
  if (net) {
    const s = await db
      .prepare(
        `SELECT (SELECT last_seen FROM key_network WHERE key_id = ?1 AND ip_prefix = ?2) AS seen,
                EXISTS (SELECT 1 FROM key_network WHERE key_id = ?1) AS known,
                EXISTS (SELECT 1 FROM key_network WHERE key_id = ?1 AND alerted_at > ?3) AS alerted,
                EXISTS (SELECT 1 FROM session WHERE person_id = ?4 AND ip_prefix = ?2) AS signed_in_here,
                (SELECT json_group_array(json_array(ip_prefix, first_seen)) FROM (SELECT ip_prefix, first_seen FROM key_network
                  WHERE key_id = ?1 AND held_at IS NOT NULL ORDER BY first_seen, ip_prefix LIMIT ?5)) AS held`,
      )
      .bind(key.id, net, iso(now - ALERT_EVERY), person.id, MAIL_NETWORKS)
      .first<{ seen: string | null; known: number; alerted: number; signed_in_here: number; held: string }>()
    const fresh = !s?.seen
    // Owed a mail: the networks held back, then this one if it's new (and not the first, where the human signed in).
    const owed = (JSON.parse(s?.held ?? '[]') as [string, string][]).map(([prefix, first]) => ({ prefix, first }))
    if (fresh && !(!s?.known && s?.signed_in_here)) owed.push({ prefix: net, first: at })
    const mailed = s?.alerted ? [] : owed.slice(0, MAIL_NETWORKS).map(o => o.prefix)
    // The mail first, written only while none of the networks it names is settled as the batch commits (mailed, or
    // recorded without one being owed), so two requests at once send one mail.
    if (mailed.length) {
      const one = mailed.length === 1
      stmts.push(
        mailToPersonStatement(
          db,
          {
            template: 'key_new_network',
            stream: 'security',
            personId: person.id,
            payload: { key: key.name, ...(one ? { network: mailed[0] } : { networks: mailed }), at: owed[0].first, link: '/keys' },
          },
          at,
          'NOT EXISTS (SELECT 1 FROM key_network WHERE key_id = ? AND ip_prefix IN (SELECT value FROM json_each(?)) AND held_at IS NULL)',
          [key.id, JSON.stringify(mailed)],
        ),
        db
          .prepare('UPDATE key_network SET alerted_at = ?, held_at = NULL WHERE key_id = ? AND held_at IS NOT NULL AND ip_prefix IN (SELECT value FROM json_each(?))')
          .bind(at, key.id, JSON.stringify(mailed)),
      )
    }
    if (!fresh) {
      if (s!.seen! <= since)
        stmts.push(db.prepare('UPDATE key_network SET last_seen = ? WHERE key_id = ? AND ip_prefix = ? AND last_seen <= ?').bind(at, key.id, net, since))
    } else {
      const owes = owed.some(o => o.prefix === net)
      const sent = mailed.includes(net)
      stmts.push(
        db
          .prepare(
            'INSERT INTO key_network (key_id, ip_prefix, first_seen, last_seen, alerted_at, held_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (key_id, ip_prefix) DO NOTHING',
          )
          .bind(key.id, net, at, at, sent ? at : null, owes && !sent ? at : null),
      )
    }
  }
  await db.batch(stmts)
}

/** The pipeline as Hono middleware. Sets c.get('agent') for the route; refusals are thrown as ShwarmError. */
export const signedPipeline = (): MiddlewareHandler<ApiEnv> => async (c, next) => {
  const now = Date.now()
  const { agent, body } = await verify(c, now)
  c.set('agent', agent)
  c.set('body', body)
  let done = false
  try {
    c.set('left', [await spendRequest(c.env.DB, { id: agent.key.id, handle: agent.person.handle }, now)])
    if (!WRITES(c.req.method)) await next()
    else {
      const replay = await once(c, next, agent.key.id, body, now)
      if (replay) return replay
    }
    done = c.res.status >= 200 && c.res.status <= 299
  } finally {
    // Only an act that went through is the key's last use: a refusal (a grant miss, a limit) still counts as a use,
    // but isn't shown as acting on a node the key may not touch.
    if (!done) agent.used = null
    // A failed write of the last use must not fail the request it follows.
    await later(c, () => recordUse(c.env.DB, agent, clientIp(c), now)).catch(e => console.error('recording a key use failed', e))
  }
}
