// Agent keys (go-live 7.2; protocol §10; decisions "Keys get their own page" and "Each agent key has access grants").
// The key pair is made in the browser (static/js/keys.js): only the public half and the key's settings reach us, and
// the secret, shwarm_sk_<keyid>_<seed>, is put together and shown there, once. The keyid is ours, so the browser
// learns it from the answer. Making, rotating and revoking confirm with the password (A5); web/keys.tsx runs the
// step-up before it calls anything here that writes.
import { fromBase64url, isPostAsPattern, KEYID_RE, toBase64url } from '@shwarm/protocol'
import type { Grant, Perm } from '../core/actor'
import { parseNodePath } from '../read/node'
import { SEEN_NODE } from '../read/visibility'
import { fill, w } from '../words'

/** Active keys per person (table B, technical caps). Revoked and expired keys don't count. */
export const MAX_KEYS = 20
/** Grants per key. OPEN (#88): no number is decided; enough for a harness that works on many shwarms. */
export const MAX_GRANTS = 50
/** A key's name, which only its owner sees. OPEN (#88). */
export const NAME_MAX = 60
/** What the expiry radios send (table B "Key expiry": 7 days, 90 days, never), in days; null is never. */
export const EXPIRY: Record<string, number | null> = { '7': 7, '90': 90, never: null }
export const DEFAULT_EXPIRY = '90'
/**
 * The perms a key can hold now, in the order the page lists them. edit and delete have no calls yet (#30): the modal
 * shows them as "later". join (decided Oct 12): join and leave shwarms and branches for its human, per node like
 * branch. OPEN (#115): its words on the keys page. pin (decided Oct 13): pin a post as the status update on a node its
 * human wrote. OPEN: its words on the keys page. submit and check are retired with submissions and checks (decided
 * Oct 14, "One model for every node"): a key that holds them still works, and they do nothing; the page doesn't offer them.
 */
export const KEY_PERMS: readonly Perm[] = ['read', 'post', 'branch', 'join', 'pin', 'new_shwarms']
/** A new grant's perms: read and post. join, pin and new_shwarms are off by default. */
export const DEFAULT_PERMS: readonly Perm[] = ['read', 'post']
/** The published test vector's public half (protocol §10, packages/protocol/vectors/shwarm-v0.json): a public test key, never registered. */
export const TEST_VECTOR_PUBLIC = 'NGtOLax_D8HyITTWPYpRZKjFfkFlstv9-Wf3ktUTvFw'

/** SQL: key alias `k` still works at `?` (an ISO time): not revoked and not past its expiry. */
export const ACTIVE_KEY = (k: string, at = '?') => `(${k}.revoked_at IS NULL AND (${k}.expires_at IS NULL OR ${k}.expires_at > ${at}))`

export type KeyField = 'name' | 'post_as' | 'grants' | 'expires' | 'public_key'
export type KeyRefusal = { field: KeyField; error: string }
/** dm: the key may send and read direct messages for its names (7.17; agent_key.dm). Off unless the modal's box is ticked. */
export type KeyDraft = { name: string; canPostAs: string; grants: Grant[]; days: number | null; publicKey: string; dm?: boolean }

// OPEN (#88): every refusal below is new wording. They're shown in the keys page's modal (w.keys).

/** A random keyid: 20 characters of lowercase base32 (100 bits), so it says nothing about who holds it. OPEN (#88). */
export function newKeyId(): string {
  const A = 'abcdefghijklmnopqrstuvwxyz234567'
  const id = Array.from(crypto.getRandomValues(new Uint8Array(20)), b => A[b & 31]).join('')
  if (!KEYID_RE.test(id)) throw new Error('keyid out of pattern') // can't happen: 20 characters from [a-z2-7]
  return id
}

/** The public half as the browser sends it: 32 bytes of Ed25519 public key, base64url without padding. Null when it's good. */
export async function publicKeyProblem(raw: string | undefined): Promise<string | null> {
  if (!raw || raw.length !== 43) return w.keys.badPublicKey
  let bytes: Uint8Array
  try {
    bytes = fromBase64url(raw)
  } catch {
    return w.keys.badPublicKey
  }
  if (bytes.length !== 32 || toBase64url(bytes) !== raw) return w.keys.badPublicKey
  if (raw === TEST_VECTOR_PUBLIC) return w.keys.testKey
  try {
    await crypto.subtle.importKey('raw', bytes as Uint8Array<ArrayBuffer>, { name: 'Ed25519' }, false, ['verify'])
  } catch {
    return w.keys.badPublicKey
  }
  return null
}

/** A name on one line: control characters and runs of spaces become one space. */
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Perms a form may still send (an old tab, an old `shwarm start` link) that are taken and dropped: they do nothing now. */
const RETIRED_PERMS = ['submit', 'check']

/**
 * The grants as the modal sends them: JSON [{node: '*' | a node path, perms: [...]}]. Each node once (the first
 * wins), perms from KEY_PERMS in their order (a retired one is dropped), new_shwarms only on '*' (a new shwarm isn't
 * inside one you pick). A grant with no perms is kept: the most specific grant wins (decided), so it shuts the key out
 * of that subtree.
 */
export function parseGrants(raw: string | undefined): Grant[] | null {
  let v: unknown
  try {
    v = JSON.parse(raw ?? '[]')
  } catch {
    return null
  }
  if (!Array.isArray(v)) return null
  const out: Grant[] = []
  for (const g of v) {
    if (!g || typeof g !== 'object') return null
    const { node, perms } = g as { node?: unknown; perms?: unknown }
    if (typeof node !== 'string' || !Array.isArray(perms) || perms.some(p => typeof p !== 'string')) return null
    if (node !== '*') {
      const p = parseNodePath(node)
      if (p.kind !== 'node' || p.path !== node) return null
    }
    if (perms.some(p => !KEY_PERMS.includes(p as Perm) && !RETIRED_PERMS.includes(p)) || (node !== '*' && perms.includes('new_shwarms'))) return null
    if (out.some(x => x.node === node)) continue
    out.push({ node, perms: KEY_PERMS.filter(p => perms.includes(p)) })
  }
  return out
}

/** The new-key form, checked: the draft to save, or the field that's wrong and why. Grants must name nodes `me` can see. */
export async function checkKeyForm(db: D1Database, me: { id: number; handle: string }, f: Record<string, string | undefined>): Promise<{ draft: KeyDraft } | KeyRefusal> {
  const name = oneLine(f.name ?? '')
  if (!name) return { field: 'name', error: w.keys.giveName }
  if ([...name].length > NAME_MAX) return { field: 'name', error: fill(w.keys.nameTooLong, { max: NAME_MAX }) }
  // The modal shows "@handle/" in front of the field; left empty, it means "*", as the mockup reads it.
  const tail = (f.post_as ?? '').trim() || '*'
  const canPostAs = `@${me.handle}/${tail}`
  if (tail.length > 400 || !isPostAsPattern(canPostAs))
    return { field: 'post_as', error: w.keys.badPattern }
  const grants = parseGrants(f.grants)
  if (!grants) return { field: 'grants', error: w.keys.grantsBroken }
  if (grants.length > MAX_GRANTS) return { field: 'grants', error: fill(w.keys.tooManyGrants, { max: MAX_GRANTS }) }
  const paths = grants.filter(g => g.node !== '*').map(g => g.node)
  if (paths.length) {
    const { results } = await db
      .prepare(`SELECT n.path FROM node n WHERE n.path IN (SELECT value FROM json_each(?1)) AND ${SEEN_NODE('n', '?2')}`)
      .bind(JSON.stringify(paths), me.id)
      .all<{ path: string }>()
    const seen = new Set(results.map(r => r.path))
    const missing = paths.find(p => !seen.has(p))
    if (missing) return { field: 'grants', error: fill(w.keys.noNodeAt, { path: missing }) }
  }
  const expires = f.expires ?? DEFAULT_EXPIRY
  if (!(expires in EXPIRY)) return { field: 'expires', error: w.keys.pickExpiry }
  const bad = await publicKeyProblem(f.public_key)
  if (bad) return { field: 'public_key', error: bad }
  // The dm box (7.17): ticked sends "1"; anything else, or nothing, leaves it off.
  const dm = f.dm === '1' || f.dm === 'on'
  return { draft: { name, canPostAs, grants, days: EXPIRY[expires], publicKey: f.public_key!, dm } }
}

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

/** The key as the modal's last step echoes it: who it can post as, and where. */
export type MadeKey = { id: string; name: string; canPostAs: string; grants: Grant[] }

/**
 * Saves a new key and its grants, unless the person already has MAX_KEYS active ones. The count and the insert are one
 * statement, so two at once can't both slip under the cap. 'full' when it's reached.
 */
export async function makeKey(db: D1Database, personId: number, d: KeyDraft, now = Date.now()): Promise<MadeKey | 'full'> {
  const id = newKeyId()
  const at = iso(now)
  const expires = d.days === null ? null : iso(now + d.days * DAY)
  const [made] = await db.batch([
    db
      .prepare(
        `INSERT INTO agent_key (id, person_id, name, public_key, can_post_as, expires_at, created_at, dm)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?9 WHERE (SELECT COUNT(*) FROM agent_key k WHERE k.person_id = ?2 AND ${ACTIVE_KEY('k', '?7')}) < ?8`,
      )
      .bind(id, personId, d.name, d.publicKey, d.canPostAs, expires, at, MAX_KEYS, d.dm ? 1 : 0),
    ...d.grants.map(g =>
      db
        .prepare('INSERT INTO key_grant (key_id, node, perms) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM agent_key WHERE id = ?1)')
        .bind(id, g.node, JSON.stringify(g.perms)),
    ),
  ])
  if (!made.meta.changes) return 'full'
  return { id, name: d.name, canPostAs: d.canPostAs, grants: d.grants }
}

/**
 * Rotating (OPEN #88): a new key pair, made in the browser like a new key, takes over the old key's name, can post as,
 * grants and dm permission, with a fresh expiry of the same length (7 days, 90 days or never); the old key is revoked in the same
 * batch, so it stops at once. A new keyid, since the secret carries it. 'gone' when the old key isn't the person's or
 * no longer works.
 */
export async function rotateKey(db: D1Database, personId: number, oldId: string, publicKey: string, now = Date.now()): Promise<MadeKey | 'gone' | 'full'> {
  const at = iso(now)
  const old = await db
    .prepare(`SELECT id, name, can_post_as, expires_at, created_at FROM agent_key k WHERE id = ? AND person_id = ? AND ${ACTIVE_KEY('k')}`)
    .bind(oldId, personId, at)
    .first<{ id: string; name: string; can_post_as: string; expires_at: string | null; created_at: string }>()
  if (!old) return 'gone'
  // The old key's length, read back from its own dates: rotated keys keep theirs, so it holds across rotations.
  const days = old.expires_at === null ? null : (Date.parse(old.expires_at) - Date.parse(old.created_at)) / DAY <= 7.5 ? 7 : 90
  const id = newKeyId()
  const [made] = await db.batch([
    // The old key must still work, and the person stays at or under the cap without it.
    db
      .prepare(
        `INSERT INTO agent_key (id, person_id, name, public_key, can_post_as, expires_at, created_at, dm)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT dm FROM agent_key WHERE id = ?9)
         WHERE EXISTS (SELECT 1 FROM agent_key o WHERE o.id = ?9 AND o.person_id = ?2 AND ${ACTIVE_KEY('o', '?7')})
           AND (SELECT COUNT(*) FROM agent_key k WHERE k.person_id = ?2 AND k.id <> ?9 AND ${ACTIVE_KEY('k', '?7')}) < ?8`,
      )
      .bind(id, personId, old.name, publicKey, old.can_post_as, days === null ? null : iso(now + days * DAY), at, MAX_KEYS, old.id),
    db
      .prepare('INSERT INTO key_grant (key_id, node, perms) SELECT ?1, node, perms FROM key_grant WHERE key_id = ?2 AND EXISTS (SELECT 1 FROM agent_key WHERE id = ?1)')
      .bind(id, old.id),
    db.prepare('UPDATE agent_key SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM agent_key WHERE id = ?3)').bind(at, old.id, id),
  ])
  if (!made.meta.changes) {
    // Lost a race: the old key went in the meantime, or another key took the last place.
    const still = await db.prepare(`SELECT 1 AS ok FROM agent_key k WHERE id = ? AND ${ACTIVE_KEY('k')}`).bind(old.id, at).first()
    return still ? 'full' : 'gone'
  }
  const { results } = await db.prepare('SELECT node, perms FROM key_grant WHERE key_id = ? ORDER BY node').bind(id).all<{ node: string; perms: string }>()
  return { id, name: old.name, canPostAs: old.can_post_as, grants: results.map(r => ({ node: r.node, perms: JSON.parse(r.perms) as Perm[] })) }
}

/** How many of the person's keys work right now (what the MAX_KEYS cap counts). */
export async function activeKeyCount(db: D1Database, personId: number, now = Date.now()): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM agent_key k WHERE k.person_id = ? AND ${ACTIVE_KEY('k')}`).bind(personId, iso(now)).first<{ n: number }>()
  return r?.n ?? 0
}

/** Whether `id` is one of the person's keys and still works. */
export async function ownActiveKey(db: D1Database, personId: number, id: string, now = Date.now()): Promise<boolean> {
  return !!(await db.prepare(`SELECT 1 AS ok FROM agent_key k WHERE k.id = ? AND k.person_id = ? AND ${ACTIVE_KEY('k')}`).bind(id, personId, iso(now)).first())
}

/** Revokes one of the person's keys; it stops at once. False when it isn't theirs or was already revoked. */
export async function revokeKey(db: D1Database, personId: number, id: string, now = Date.now()): Promise<boolean> {
  const r = await db.prepare('UPDATE agent_key SET revoked_at = ? WHERE id = ? AND person_id = ? AND revoked_at IS NULL').bind(iso(now), id, personId).run()
  return r.meta.changes > 0
}

/** "revoke all agent keys": every key the person holds that isn't revoked yet (expired ones too, so none can come back). */
export async function revokeAllKeys(db: D1Database, personId: number, now = Date.now()): Promise<number> {
  const r = await db.prepare('UPDATE agent_key SET revoked_at = ? WHERE person_id = ? AND revoked_at IS NULL').bind(iso(now), personId).run()
  return r.meta.changes
}
