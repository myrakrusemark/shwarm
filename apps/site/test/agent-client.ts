// An agent as the CLI will be (go-live 7.7): a key made through the keys page's own code, and requests signed with
// @shwarm/protocol, sent to the whole site. For the agent API's tests (test/api.test.ts).
import { newSeed, publicKeyFromSeed, signRequest, toBase64url } from '@shwarm/protocol'
import type { Grant } from '../src/core/actor'
import { makeKey } from '../src/auth/keys'
import { addPerson, T0 } from './d1'

export type Key = { keyid: string; seed: Uint8Array }
type Site = { fetch: (req: Request, env?: any, ctx?: any) => Response | Promise<Response> }

export const ALL_PERMS: Grant['perms'] = ['read', 'post', 'submit', 'check', 'branch', 'new_shwarms']

/** A key for the person, made as the keys page makes one (only the public half reaches the server). */
export async function keyFor(db: D1Database, personId: number, o: { grants?: Grant[]; canPostAs: string; name?: string }): Promise<Key> {
  const seed = newSeed()
  const made = await makeKey(db, personId, {
    name: o.name ?? 'claude code · laptop',
    canPostAs: o.canPostAs,
    grants: o.grants ?? [{ node: '*', perms: ['read', 'post', 'submit', 'check'] }],
    days: 90,
    publicKey: toBase64url(await publicKeyFromSeed(seed)),
  })
  if (made === 'full') throw new Error('no key')
  return { keyid: made.id, seed }
}

/** A verified person whose account counts as established (founding), as people checks need. */
export async function verifiedPerson(db: D1Database & { raw: any }, handle: string): Promise<{ id: number; handle: string }> {
  const id = await addPerson(db, handle)
  db.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(new Date(T0).toISOString(), id)
  return { id, handle }
}

export type Sent = { status: number; json: any; text: string; res: Response }

/** Signs a request as the CLI does, then sends it through the site. A POST gets an Idempotency-Key unless `idem` is null. */
export async function send(
  site: Site,
  env: unknown,
  key: Key,
  o: { method?: string; path: string; body?: unknown; idem?: string | null; headers?: Record<string, string>; ctx?: unknown },
): Promise<Sent> {
  const method = o.method ?? (o.body === undefined ? 'GET' : 'POST')
  const body = o.body === undefined ? undefined : typeof o.body === 'string' ? o.body : JSON.stringify(o.body)
  const headers: Record<string, string> = { 'shwarm-version': '0', ...(body ? { 'content-type': 'application/json' } : {}), ...o.headers }
  const idem = o.idem === undefined ? (method === 'POST' ? crypto.randomUUID() : null) : o.idem
  if (idem) headers['idempotency-key'] = idem
  const url = `https://shwarm.org${o.path}`
  const sig = await signRequest({ method, url, headers, body }, key)
  const res = await site.fetch(new Request(url, { method, headers: { ...headers, ...sig, 'cf-connecting-ip': '203.0.113.9' }, body }), env, o.ctx)
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON
  }
  return { status: res.status, json, text, res }
}
