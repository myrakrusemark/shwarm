// Go-live 7.3: the signed request pipeline (api/signed.ts), through the site as an agent reaches it. Requests are signed
// here with @shwarm/protocol, as the CLI signs them. The refusals go through the whole site (src/index.ts sends anything
// signed to the agent API); the acts go through a probe API built the same way (agentApi) with one route that posts in
// a thread through core, since the real agent routes are 7.4's. The done-when cases: replay, stale and future
// `created`, wrong host, wrong digest, a bare `as`, a grant miss and an idempotent retry.
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newSeed, publicKeyFromSeed, signRequest, toBase64url } from '@shwarm/protocol'
import { SHWARM_V0, signedVectorRequest } from '@shwarm/protocol/vectors'
import app from '../src/index'
import { agentApi } from '../src/api'
import { ALERT_EVERY, IDEMPOTENCY_STALE, IDEMPOTENCY_TTL, isSigned, MAIL_NETWORKS, TOUCH_EVERY } from '../src/api/signed'
import type { Grant } from '../src/core/actor'
import { makeKey, revokeKey } from '../src/auth/keys'
import { runInTree } from '../src/do/shwarm-tree'
import { renderMail } from '../src/email/templates'
import { addPerson, T0 } from './d1'
import { fakeFetch, testEnv } from './browser'
import { stagingWorld } from './node-fixture'

const SITE = 'https://shwarm.org'
const BRANCH = 'minecraft-in-doom/block-placement'
const SHWARM = 'minecraft-in-doom'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// The probe: one write and one read, behind the real pipeline.
const probe = agentApi()
probe.post('/w/*', async c => {
  const node = new URL(c.req.url).pathname.slice('/w/'.length)
  const b = await c.req.json<{ as: string; text: string }>()
  const r = await runInTree<{ id: string }>(c.env.TREE, { type: 'post', actor: c.get('agent').actor(b.as, node), input: { node, text: b.text } })
  return c.json({ id: r.id }, 201)
})
probe.get('/whoami', c => c.json({ keyid: c.get('agent').key.id, handle: c.get('agent').person.handle }))

type Site = { fetch: (req: Request, env?: any, ctx?: any) => Response | Promise<Response> }

async function world(grants: Grant[] = [{ node: '*', perms: ['read', 'post', 'submit', 'check'] }], canPostAs = '@myra/*') {
  const { db, myraId } = await stagingWorld()
  const env = { ...testEnv(db), SITE_URL: SITE }
  const seed = newSeed()
  const made = await makeKey(db, myraId, { name: 'claude code · laptop', canPostAs, grants, days: 90, publicKey: toBase64url(await publicKeyFromSeed(seed)) })
  if (made === 'full') throw new Error('no key')
  const key = { keyid: made.id, seed }
  const get = (sql: string, ...args: unknown[]): any => db.raw.prepare(sql).get(...args)
  const all = (sql: string, ...args: unknown[]): any[] => db.raw.prepare(sql).all(...args)
  return { db, env, myraId, key, get, all }
}

type Send = {
  method?: string
  path: string
  body?: Record<string, unknown> | string
  idem?: string | null
  key: { keyid: string; seed: Uint8Array }
  created?: number
  nonce?: string
  /** The host the request is signed for; it goes there too unless `to` says otherwise. */
  host?: string
  to?: string
  headers?: Record<string, string>
  ip?: string
  /** Changes the request after it's signed. */
  tamper?: (r: { url: string; headers: Record<string, string>; body: string | undefined }) => void
}

/** Signs a request as the CLI does, then sends it. A POST gets an Idempotency-Key unless `idem` is null. */
async function signed(site: Site, env: unknown, o: Send) {
  const method = o.method ?? (o.body === undefined ? 'GET' : 'POST')
  const body = o.body === undefined ? undefined : typeof o.body === 'string' ? o.body : JSON.stringify(o.body)
  const headers: Record<string, string> = { 'shwarm-version': '0', ...(body ? { 'content-type': 'application/json' } : {}), ...o.headers }
  const idem = o.idem === undefined ? (method === 'POST' ? crypto.randomUUID() : null) : o.idem
  if (idem) headers['idempotency-key'] = idem
  const url = `https://${o.host ?? 'shwarm.org'}${o.path}`
  const sig = await signRequest({ method, url, headers, body }, o.key, { created: o.created, nonce: o.nonce })
  const r = { url: o.to ? o.to + o.path : url, headers: { ...headers, ...sig, 'cf-connecting-ip': o.ip ?? '203.0.113.9' }, body }
  o.tamper?.(r)
  const res = await site.fetch(new Request(r.url, { method, headers: r.headers, body: r.body }), env)
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON
  }
  return { status: res.status, json, text, res }
}

const now = () => Math.floor(Date.now() / 1000)
const post = (key: Send['key'], node: string, as: string, extra: Partial<Send> = {}) =>
  ({ path: `/w/${node}`, body: { as, text: 'place, break, save, reload: all work.' }, key, ...extra }) as Send

describe('every response', () => {
  it('sends Date, which agents set their clocks by: pages, signed answers and refusals alike', async () => {
    const { env, key } = await world()
    const page = await app.fetch(new Request(`${SITE}/w/${SHWARM}`, { headers: { 'cf-connecting-ip': '203.0.113.9' } }), env)
    expect(page.headers.get('date')).toBe(new Date(T0).toUTCString())
    const ok = await signed(app, env, { path: '/mentions?to=@myra/m-04', key })
    expect(ok.res.headers.get('date')).toBe(new Date(T0).toUTCString())
    const stale = await signed(app, env, { path: '/mentions', key, created: now() - 301 })
    expect(stale.res.headers.get('date')).toBe(new Date(T0).toUTCString())
  })
})

describe('reading the signature', () => {
  it('verifies the published vector through the site, so the signature base is exactly the one documented', async () => {
    const { db, env, myraId, all } = await world()
    db.raw
      .prepare("INSERT INTO agent_key (id, person_id, name, public_key, can_post_as, created_at) VALUES (?, ?, 'vector', ?, '@myra/*', ?)")
      .run(SHWARM_V0.key.keyid, myraId, SHWARM_V0.key.public, new Date(T0).toISOString())
    db.raw.prepare("INSERT INTO key_grant (key_id, node, perms) VALUES (?, '*', '[\"read\",\"post\"]')").run(SHWARM_V0.key.keyid)
    const send = (site: Site, i: number) => {
      const r = SHWARM_V0.requests[i]
      vi.setSystemTime(r.created * 1000)
      const m = signedVectorRequest(r)
      return site.fetch(new Request(m.url, { method: m.method, headers: m.headers as Record<string, string>, body: (m.body as string) || undefined }), env)
    }
    const res = await send(probe, 0)
    expect(res.status).toBe(201)
    const id = ((await res.json()) as any).id
    expect(all('SELECT as_name, key_id, text FROM post WHERE id = ?', id)).toEqual([
      { as_name: '@myra/m-04', key_id: 'test-key-shwarm', text: 'block placement works on e1m1: place, break, save, reload.' },
    ])
    // The GET verifies too; the site has no /mentions route until 7.4, so it gets as far as not found.
    const get = await send(app, 1)
    expect(get.status).toBe(404)
    expect(await get.json()).toMatchObject({ error: 'not_found' })
  })

  it('refuses a replay: the same signed request twice', async () => {
    const { env, key } = await world()
    const first = await signed(app, env, { path: '/mentions?to=@myra/m-04', key, nonce: 'once-only-1' })
    expect(first.status).toBe(404)
    const again = await signed(app, env, { path: '/mentions?to=@myra/m-04', key, nonce: 'once-only-1' })
    expect(again.status).toBe(401)
    expect(again.json).toMatchObject({ error: 'bad_signature', reason: 'replay' })
    // the same nonce on another request is a replay too, and a write's nonce is taken before its Idempotency-Key is read
    const write = await signed(probe, env, { ...post(key, BRANCH, '@myra/m-04'), nonce: 'once-only-1' })
    expect(write.json).toMatchObject({ error: 'bad_signature', reason: 'replay' })
  })

  it('refuses a stale created and a future one with clock_skew and the server time, and takes the edges', async () => {
    const { env, key } = await world()
    for (const created of [now() - 301, now() + 61]) {
      const r = await signed(app, env, { path: '/mentions', key, created })
      expect(r.status, String(created - now())).toBe(401)
      expect(r.json).toEqual({
        error: 'bad_signature',
        message: "created must be within 300 s before and 60 s after the server's clock",
        reason: 'clock_skew',
        server_time: new Date(T0).toISOString(),
      })
    }
    for (const created of [now() - 300, now() + 60]) expect((await signed(app, env, { path: '/mentions', key, created })).status).toBe(404)
  })

  it('refuses a request signed for another host, whether it is sent here or there', async () => {
    const { env, key } = await world()
    const staging = 'shwarm-staging.myrakrusemark.workers.dev'
    const moved = await signed(app, env, { path: '/mentions', key, host: staging, to: SITE })
    expect(moved.status).toBe(401)
    expect(moved.json).toMatchObject({ error: 'bad_signature', reason: 'invalid' })
    // signed for the host it reached, but that host isn't the site
    const there = await signed(app, env, { path: '/mentions', key, host: staging })
    expect(there.status).toBe(401)
    expect(there.json).toMatchObject({ error: 'bad_signature', reason: 'wrong_host', message: 'signed requests go to shwarm.org' })
  })

  it('refuses a body that does not match its Content-Digest, and a digest swapped to match it', async () => {
    const { env, key, all } = await world()
    const changed = await signed(probe, env, { ...post(key, BRANCH, '@myra/m-04'), tamper: r => void (r.body = r.body!.replace('all work', 'most work')) })
    expect(changed.status).toBe(401)
    expect(changed.json).toMatchObject({ error: 'bad_signature', reason: 'content_digest' })
    const swapped = await signed(probe, env, {
      ...post(key, BRANCH, '@myra/m-04'),
      tamper: r => {
        r.body = JSON.stringify({ as: '@myra/m-04', text: 'something else' })
        r.headers['content-digest'] = `sha-256=:${createHash('sha256').update(r.body).digest('base64')}:`
      },
    })
    expect(swapped.json).toMatchObject({ error: 'bad_signature', reason: 'invalid' })
    expect(all('SELECT id FROM post WHERE key_id = ?', key.keyid)).toEqual([])
  })

  it('refuses half a signature, and never hands a signed request to the site', async () => {
    const { env, key } = await world()
    const half = await app.fetch(new Request(`${SITE}/w/${SHWARM}`, { headers: { signature: 'sig1=:AAAA:' } }), env)
    expect(half.status).toBe(401)
    expect(await half.json()).toMatchObject({ error: 'bad_signature', reason: 'missing' })
    // a good signature on a site form's address gets the agent API's answer, not the form
    const form = await signed(app, env, { path: '/keys', body: 'do=revoke_all', headers: { 'content-type': 'application/x-www-form-urlencoded' }, key })
    expect(form.status).toBe(404)
    expect(form.json).toMatchObject({ error: 'not_found' })
    expect(isSigned(new Request(SITE, { headers: { 'signature-input': 'x' } }))).toBe(true)
    expect(isSigned(new Request(SITE))).toBe(false)
  })

  it('answers Shwarm-Version 0, takes a missing header as 0, and refuses any other version', async () => {
    const { env, key } = await world()
    const ok = await signed(probe, env, { path: '/whoami', key, headers: { 'shwarm-version': '0' } })
    expect(ok.status).toBe(200)
    expect(ok.res.headers.get('shwarm-version')).toBe('0')
    expect(ok.res.headers.get('cache-control')).toBe('no-store')
    const r1 = await signed(probe, env, { path: '/whoami', key, headers: { 'shwarm-version': '1' } })
    expect(r1.status).toBe(400)
    expect(r1.json).toMatchObject({ error: 'unsupported_version', supported: ['0'] })
    expect(r1.res.headers.get('shwarm-version')).toBe('0')
    const none = new Request(`${SITE}/whoami`)
    const sig = await signRequest({ method: 'GET', url: none.url, headers: {} }, key)
    expect((await probe.fetch(new Request(none.url, { headers: sig }), { ...env })).status).toBe(200)
  })
})

describe('the key', () => {
  it('is read on every request: unknown, revoked between two requests, expired, or its account closed', async () => {
    const { db, env, key, myraId } = await world()
    const unknown = await signed(probe, env, { path: '/whoami', key: { ...key, keyid: 'abcdefghijklmnopqrst' } })
    expect(unknown.status).toBe(401)
    expect(unknown.json).toMatchObject({ error: 'bad_signature', reason: 'unknown_key' })

    expect((await signed(probe, env, { path: '/whoami', key })).json).toEqual({ keyid: key.keyid, handle: 'myra' })
    expect(await revokeKey(db, myraId, key.keyid)).toBe(true)
    const after = await signed(probe, env, { path: '/whoami', key })
    expect(after.status).toBe(401)
    expect(after.json).toEqual({ error: 'key_revoked', message: 'this key is revoked or past its expiry' })
    // only the key's holder learns it's revoked: a signature that doesn't verify says only that
    const forged = await signed(probe, env, { path: '/whoami', key: { keyid: key.keyid, seed: newSeed() } })
    expect(forged.json).toMatchObject({ error: 'bad_signature', reason: 'invalid' })

    const w2 = await world()
    w2.db.raw.prepare('UPDATE agent_key SET expires_at = ? WHERE id = ?').run(new Date(T0).toISOString(), w2.key.keyid)
    expect((await signed(probe, w2.env, { path: '/whoami', key: w2.key })).json).toMatchObject({ error: 'key_revoked' })

    const w3 = await world()
    w3.db.raw.prepare("UPDATE person SET status = 'suspended' WHERE id = ?").run(w3.myraId)
    expect((await signed(probe, w3.env, { path: '/whoami', key: w3.key })).json).toMatchObject({ error: 'key_revoked' })
  })
})

describe('can post as and grants', () => {
  it('refuses a bare as, another handle, and a name outside can post as', async () => {
    const { env, key, all } = await world(undefined, '@myra/m-*')
    const bare = await signed(probe, env, post(key, BRANCH, '@myra'))
    expect(bare.status).toBe(403)
    expect(bare.json).toMatchObject({ error: 'bare_handle_needs_human' })
    const other = await signed(probe, env, post(key, BRANCH, '@ana/m-04'))
    expect(other.status).toBe(403)
    expect(other.json).toMatchObject({ error: 'not_your_name' })
    const outside = await signed(probe, env, post(key, BRANCH, '@myra/fathom'))
    expect(outside.status).toBe(403)
    expect(outside.json).toMatchObject({ error: 'not_permitted', need: 'can_post_as', as: '@myra/fathom' })
    expect(all('SELECT id FROM post WHERE key_id = ?', key.keyid)).toEqual([])
    expect((await signed(probe, env, post(key, BRANCH, '@myra/m-04'))).status).toBe(201)
  })

  it('refuses a grant miss, and the most specific grant wins', async () => {
    const only = await world([{ node: BRANCH, perms: ['read', 'post'] }])
    const miss = await signed(probe, only.env, post(only.key, SHWARM, '@myra/m-04'))
    expect(miss.status).toBe(403)
    expect(miss.json).toMatchObject({ error: 'not_permitted', need: 'post', node: SHWARM })
    expect((await signed(probe, only.env, post(only.key, BRANCH, '@myra/m-04'))).status).toBe(201)

    // all shwarms may post, but the branch's own grant reads only: the branch's wins there
    const { env, key } = await world([
      { node: '*', perms: ['read', 'post'] },
      { node: BRANCH, perms: ['read'] },
    ])
    expect((await signed(probe, env, post(key, SHWARM, '@myra/m-04'))).status).toBe(201)
    const shut = await signed(probe, env, post(key, BRANCH, '@myra/m-04'))
    expect(shut.status).toBe(403)
    expect(shut.json).toMatchObject({ error: 'not_permitted', need: 'post', node: BRANCH })
  })
})

describe('Idempotency-Key', () => {
  it('answers a retry from the first answer, without posting twice', async () => {
    const { env, key, all } = await world()
    const first = await signed(probe, env, post(key, BRANCH, '@myra/m-04', { idem: 'retry-1' }))
    expect(first.status).toBe(201)
    expect(first.res.headers.get('idempotent-replayed')).toBeNull()
    vi.setSystemTime(T0 + 5_000)
    // a retry signs afresh (new nonce, new created) with the same key and body
    const retry = await signed(probe, env, post(key, BRANCH, '@myra/m-04', { idem: 'retry-1' }))
    expect(retry.status).toBe(201)
    expect(retry.json).toEqual(first.json)
    expect(retry.res.headers.get('idempotent-replayed')).toBe('true')
    expect(retry.res.headers.get('content-type')).toMatch(/^application\/json/)
    expect(all('SELECT id FROM post WHERE key_id = ?', key.keyid)).toEqual([{ id: first.json.id }])

    const other = await signed(probe, env, { ...post(key, BRANCH, '@myra/m-04', { idem: 'retry-1' }), body: { as: '@myra/m-04', text: 'another post' } })
    expect(other.status).toBe(409)
    expect(other.json).toMatchObject({ error: 'idempotency_conflict' })
    const elsewhere = await signed(probe, env, post(key, SHWARM, '@myra/m-04', { idem: 'retry-1' }))
    expect(elsewhere.json).toMatchObject({ error: 'idempotency_conflict' })

    // kept 24 hours; after that the same key runs again
    vi.setSystemTime(T0 + IDEMPOTENCY_TTL + 1_000)
    const late = await signed(probe, env, post(key, BRANCH, '@myra/m-04', { idem: 'retry-1' }))
    expect(late.status).toBe(201)
    expect(late.json.id).not.toBe(first.json.id)
  })

  it('needs a key on every POST, keeps no refusal, and waits for one still running', async () => {
    const { db, env, key, all } = await world([{ node: BRANCH, perms: ['read'] }])
    const none = await signed(probe, env, post(key, BRANCH, '@myra/m-04', { idem: null }))
    expect(none.status).toBe(400)
    expect(none.json).toMatchObject({ error: 'bad_request', message: 'every POST needs an Idempotency-Key header, the same on each retry' })
    const long = await signed(probe, env, post(key, BRANCH, '@myra/m-04', { idem: 'x'.repeat(256) }))
    expect(long.json).toMatchObject({ error: 'bad_request' })

    // a refusal changed nothing, so it isn't kept: once the human adds post, the same retry goes through
    expect((await signed(probe, env, post(key, BRANCH, '@myra/m-04', { idem: 'grant-later' }))).status).toBe(403)
    expect(all('SELECT * FROM idempotency')).toEqual([])
    db.raw.prepare('UPDATE key_grant SET perms = \'["read","post"]\' WHERE key_id = ?').run(key.keyid)
    expect((await signed(probe, env, post(key, BRANCH, '@myra/m-04', { idem: 'grant-later' }))).status).toBe(201)

    // one with the same key still running: 409 until it's done, or until it's taken to have died
    const first = await signed(probe, env, post(key, BRANCH, '@myra/m-04', { idem: 'running' }))
    expect(first.status).toBe(201)
    db.raw.prepare("UPDATE idempotency SET status = 0, response = 'someone-else' WHERE idem_key = 'running'").run()
    const busy = await signed(probe, env, post(key, BRANCH, '@myra/m-04', { idem: 'running' }))
    expect(busy.status).toBe(409)
    expect(busy.json).toMatchObject({ error: 'idempotency_conflict', message: 'a request with this Idempotency-Key is still running. try again in a moment' })
    vi.setSystemTime(T0 + IDEMPOTENCY_STALE + 1_000)
    expect((await signed(probe, env, post(key, BRANCH, '@myra/m-04', { idem: 'running' }))).status).toBe(201)
  })
})

describe('last use and networks', () => {
  const lastUse = (w: Awaited<ReturnType<typeof world>>) => w.get('SELECT last_used_at, last_used_as, last_used_node FROM agent_key WHERE id = ?', w.key.keyid)
  const at = (ms: number) => new Date(ms).toISOString()

  it('records when, as what and where, at most once a minute unless that changes', async () => {
    const w = await world()
    expect(lastUse(w)).toEqual({ last_used_at: null, last_used_as: null, last_used_node: null })
    await signed(probe, w.env, post(w.key, BRANCH, '@myra/m-04'))
    expect(lastUse(w)).toEqual({ last_used_at: at(T0), last_used_as: '@myra/m-04', last_used_node: BRANCH })
    vi.setSystemTime(T0 + 30_000)
    await signed(probe, w.env, post(w.key, BRANCH, '@myra/m-04'))
    await signed(probe, w.env, { path: '/whoami', key: w.key })
    expect(lastUse(w).last_used_at).toBe(at(T0))
    vi.setSystemTime(T0 + 40_000)
    await signed(probe, w.env, post(w.key, SHWARM, '@myra/m-07'))
    expect(lastUse(w)).toEqual({ last_used_at: at(T0 + 40_000), last_used_as: '@myra/m-07', last_used_node: SHWARM })
    // a call with no name keeps what it last acted as
    vi.setSystemTime(T0 + 40_000 + TOUCH_EVERY)
    await signed(probe, w.env, { path: '/whoami', key: w.key })
    expect(lastUse(w)).toEqual({ last_used_at: at(T0 + 40_000 + TOUCH_EVERY), last_used_as: '@myra/m-07', last_used_node: SHWARM })
    // a name the key can't use isn't shown as its last use
    vi.setSystemTime(T0 + 50_000 + 2 * TOUCH_EVERY)
    await signed(probe, w.env, post(w.key, BRANCH, '@myra'))
    expect(lastUse(w).last_used_as).toBe('@myra/m-07')
  })

  it("doesn't show a node the key was refused on as its last use", async () => {
    const w = await world([{ node: BRANCH, perms: ['read', 'post'] }])
    expect((await signed(probe, w.env, post(w.key, BRANCH, '@myra/m-04'))).status).toBe(201)
    vi.setSystemTime(T0 + 2 * TOUCH_EVERY)
    const miss = await signed(probe, w.env, post(w.key, SHWARM, '@myra/m-07'))
    expect(miss.status).toBe(403)
    expect(miss.json).toMatchObject({ error: 'not_permitted' })
    // the refused call still counts as a use, but not as acting on minecraft in doom
    expect(lastUse(w)).toEqual({ last_used_at: at(T0 + 2 * TOUCH_EVERY), last_used_as: '@myra/m-04', last_used_node: BRANCH })
  })

  it('records each network and mails the human when the key is used somewhere new, at most once an hour', async () => {
    const w = await world()
    const mails = () => w.all("SELECT to_email, stream, payload FROM email_outbox WHERE template = 'key_new_network' ORDER BY id")
    const nets = () => w.all('SELECT ip_prefix, first_seen, last_seen, alerted_at, held_at FROM key_network WHERE key_id = ? ORDER BY first_seen, ip_prefix', w.key.keyid)

    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '198.51.100.7' })
    expect(mails()).toEqual([
      {
        to_email: 'myra@example.org',
        stream: 'security',
        payload: JSON.stringify({ key: 'claude code · laptop', network: '198.51.100.0/24', at: at(T0), link: '/keys', handle: 'myra' }),
      },
    ])
    expect(nets()).toEqual([{ ip_prefix: '198.51.100.0/24', first_seen: at(T0), last_seen: at(T0), alerted_at: at(T0), held_at: null }])

    // the same network again: no mail; its last sighting at most once a minute
    vi.setSystemTime(T0 + 30_000)
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '198.51.100.99' })
    expect(nets()[0].last_seen).toBe(at(T0))
    vi.setSystemTime(T0 + TOUCH_EVERY + 1_000)
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '198.51.100.99' })
    expect(nets()[0].last_seen).toBe(at(T0 + TOUCH_EVERY + 1_000))
    expect(mails()).toHaveLength(1)

    // another new network within the hour is recorded and held back, not mailed yet
    vi.setSystemTime(T0 + 10 * 60_000)
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '2001:db8:5:1::7' })
    const t10 = at(T0 + 10 * 60_000)
    expect(nets()[1]).toEqual({ ip_prefix: '2001:db8:5::/48', first_seen: t10, last_seen: t10, alerted_at: null, held_at: t10 })
    expect(mails()).toHaveLength(1)

    // an hour after the last mail, the next new network mails, naming the one held back too, from its first sighting
    vi.setSystemTime(T0 + ALERT_EVERY + 1_000)
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '192.0.2.44' })
    expect(mails()).toHaveLength(2)
    expect(JSON.parse(mails()[1].payload)).toEqual({ key: 'claude code · laptop', networks: ['2001:db8:5::/48', '192.0.2.0/24'], at: t10, link: '/keys', handle: 'myra' })
    expect(nets().map(n => [n.ip_prefix, n.alerted_at, n.held_at])).toEqual([
      ['198.51.100.0/24', at(T0), null],
      ['2001:db8:5::/48', at(T0 + ALERT_EVERY + 1_000), null],
      ['192.0.2.0/24', at(T0 + ALERT_EVERY + 1_000), null],
    ])
  })

  it('mails a network held back by the pace once the hour is up, whichever network the next request comes from', async () => {
    const w = await world()
    const mails = () => w.all("SELECT payload FROM email_outbox WHERE template = 'key_new_network' ORDER BY id").map(m => JSON.parse(m.payload))
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '198.51.100.7' })
    // a stolen copy, used within the hour of the owner's own mail: held back
    vi.setSystemTime(T0 + 10 * 60_000)
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '192.0.2.44' })
    expect(mails()).toHaveLength(1)
    // still inside the hour: the thief's network again, and the owner's, send nothing yet
    vi.setSystemTime(T0 + 50 * 60_000)
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '192.0.2.44' })
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '198.51.100.7' })
    expect(mails()).toHaveLength(1)
    // after the hour, the owner's next request from their own network mails it, once
    vi.setSystemTime(T0 + ALERT_EVERY + 1_000)
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '198.51.100.7' })
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '192.0.2.44' })
    expect(mails()).toHaveLength(2)
    expect(mails()[1]).toMatchObject({ network: '192.0.2.0/24', at: at(T0 + 10 * 60_000) })
    expect(renderMail('key_new_network', mails()[1], { siteUrl: SITE, stream: 'security' }).text).toContain(
      `signed a request from a network it hasn't used before: 192.0.2.0/24, at 2026-10-08 12:10 utc.`,
    )

    // the same from the held network itself, used again hours later
    const w2 = await world()
    vi.setSystemTime(T0)
    await signed(probe, w2.env, { path: '/whoami', key: w2.key, ip: '198.51.100.7' })
    vi.setSystemTime(T0 + 10 * 60_000)
    await signed(probe, w2.env, { path: '/whoami', key: w2.key, ip: '192.0.2.44' })
    vi.setSystemTime(T0 + 5 * ALERT_EVERY)
    await signed(probe, w2.env, { path: '/whoami', key: w2.key, ip: '192.0.2.44' })
    expect(w2.all("SELECT payload FROM email_outbox WHERE template = 'key_new_network' ORDER BY id").map(m => JSON.parse(m.payload).network)).toEqual([
      '198.51.100.0/24',
      '192.0.2.0/24',
    ])
  })

  it(`names at most ${MAIL_NETWORKS} networks in a mail, and the rest in the next`, async () => {
    const w = await world()
    const mails = () => w.all("SELECT payload FROM email_outbox WHERE template = 'key_new_network' ORDER BY id").map(m => JSON.parse(m.payload))
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '198.51.100.7' })
    for (let i = 1; i <= MAIL_NETWORKS + 2; i++) {
      vi.setSystemTime(T0 + i * 1_000)
      await signed(probe, w.env, { path: '/whoami', key: w.key, ip: `10.0.${i}.1` })
    }
    expect(mails()).toHaveLength(1)
    vi.setSystemTime(T0 + ALERT_EVERY + 1_000)
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '198.51.100.7' })
    expect(mails()[1].networks).toEqual(Array.from({ length: MAIL_NETWORKS }, (_, i) => `10.0.${i + 1}.0/24`))
    expect(renderMail('key_new_network', mails()[1], { siteUrl: SITE, stream: 'security' }).text).toContain(
      `signed requests from ${MAIL_NETWORKS} networks it hasn't used before: 10.0.1.0/24, 10.0.2.0/24,`,
    )
    vi.setSystemTime(T0 + 2 * ALERT_EVERY + 2_000)
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '198.51.100.7' })
    expect(mails()[2].networks).toEqual([`10.0.${MAIL_NETWORKS + 1}.0/24`, `10.0.${MAIL_NETWORKS + 2}.0/24`])
    expect(w.all('SELECT ip_prefix FROM key_network WHERE held_at IS NOT NULL')).toEqual([])
  })

  it("doesn't mail for a key's first network when the human signed in from it, and does for the next", async () => {
    const w = await world()
    const t = new Date(T0).toISOString()
    w.db.raw
      .prepare("INSERT INTO session (id, person_id, created_at, last_seen_at, expires_at, ip_prefix) VALUES ('s1', ?, ?, ?, ?, '203.0.113.0/24')")
      .run(w.myraId, t, t, new Date(T0 + 86_400_000).toISOString())
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '203.0.113.20' })
    expect(w.all('SELECT ip_prefix FROM key_network')).toEqual([{ ip_prefix: '203.0.113.0/24' }])
    expect(w.all("SELECT id FROM email_outbox WHERE template = 'key_new_network'")).toEqual([])
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '198.51.100.7' })
    expect(w.all("SELECT id FROM email_outbox WHERE template = 'key_new_network'")).toHaveLength(1)
    // nothing is owed for the first network, so it never mails later either
    expect(w.all('SELECT ip_prefix FROM key_network WHERE held_at IS NOT NULL')).toEqual([])
    vi.setSystemTime(T0 + 2 * ALERT_EVERY)
    await signed(probe, w.env, { path: '/whoami', key: w.key, ip: '203.0.113.20' })
    expect(w.all("SELECT id FROM email_outbox WHERE template = 'key_new_network'")).toHaveLength(1)
    vi.setSystemTime(T0)
    // another person signing in from a network doesn't make it familiar to this key
    const w2 = await world()
    w2.db.raw.prepare("INSERT INTO session (id, person_id, created_at, last_seen_at, expires_at, ip_prefix) VALUES ('s2', ?, ?, ?, ?, '192.0.2.0/24')").run(await addPerson(w2.db, 'ana'), t, t, t)
    await signed(probe, w2.env, { path: '/whoami', key: w2.key, ip: '192.0.2.5' })
    expect(w2.all("SELECT id FROM email_outbox WHERE template = 'key_new_network'")).toHaveLength(1)
  })

  it('renders the mail with the key, the network and a link to the keys page', () => {
    const m = renderMail(
      'key_new_network',
      { handle: 'myra', key: 'claude code · laptop', network: '198.51.100.0/24', at: new Date(T0).toISOString(), link: '/keys' },
      { siteUrl: SITE, stream: 'security' },
    )
    expect(m.subject).toBe('your agent key was used somewhere new')
    expect(m.text).toContain('hi @myra,')
    expect(m.text).toContain(`your agent key "claude code · laptop" signed a request from a network it hasn't used before: 198.51.100.0/24, at 2026-10-08 12:00 utc.`)
    expect(m.text).toContain(`${SITE}/keys`)
    expect(m.text).not.toContain('turn them off') // security mail: always on, no unsubscribe
    expect(() => renderMail('key_new_network', { key: 'k', network: '<b>', at: 'x', link: '/keys' }, { siteUrl: SITE, stream: 'security' })).toThrow()
  })
})
