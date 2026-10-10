// The client library (go-live 7.7): signing that the protocol's own verifier accepts, idempotency keys kept across
// retries, retries only on network errors and short 429s, typed errors, the clock warning, and the staging password
// sent to the server only.
import { describe, expect, it } from 'vitest'
import { formatSecret, messageOf, newSeed, publicKeyFromSeed, verifyRequest } from '@shwarm/protocol'
import { ApiError, AuthError, NetworkError, ShwarmClient, parseRateLimit } from '../src'

const SERVER = 'https://shwarm.org'

async function aKey() {
  const seed = newSeed()
  return { keyid: 'k7m2q9x4ab', seed, pub: await publicKeyFromSeed(seed), secret: formatSecret('k7m2q9x4ab', seed) }
}

type Seen = { req: Request; nonce?: string; idem: string | null; auth: string | null }

/** A server that verifies every signed request with the protocol's verifier, then answers from `answers` in turn. */
function server(pub: Uint8Array | null, answers: (Response | Error | (() => Response))[], date = () => new Date().toUTCString()) {
  const seen: Seen[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    const s: Seen = { req: req.clone(), idem: req.headers.get('idempotency-key'), auth: req.headers.get('authorization') }
    if (req.headers.has('signature') && pub) {
      const read = await verifyRequest(await messageOf(req), () => pub)
      s.nonce = read.nonce
    }
    seen.push(s)
    const next = answers.shift()
    if (next instanceof Error) throw next
    const res = typeof next === 'function' ? next() : (next ?? Response.json({ ok: true }))
    const h = new Headers(res.headers)
    if (!h.has('date')) h.set('date', date())
    return new Response(res.body, { status: res.status, headers: h })
  }
  return { fetch: fetch as typeof globalThis.fetch, seen }
}

const noSleep = async () => {}

describe('signing', () => {
  it('signs every call with the key, and the protocol verifier accepts it: a GET and a POST with its body', async () => {
    const k = await aKey()
    const s = server(k.pub, [Response.json({ keyid: k.keyid }), Response.json({ id: 'p_1' }, { status: 201 })])
    const c = new ShwarmClient({ server: SERVER, key: k.secret, fetch: s.fetch })
    await c.getKey()
    const a = await c.post('minecraft-in-doom/block-placement', { as: '@myra/m-04', text: 'hello' })
    expect(a.status).toBe(201)
    expect(s.seen.map(x => [x.req.method, new URL(x.req.url).pathname])).toEqual([
      ['GET', '/key'],
      ['POST', '/w/minecraft-in-doom/block-placement'],
    ])
    expect(s.seen.every(x => x.nonce)).toBe(true)
    expect(await s.seen[1].req.json()).toEqual({ kind: 'post', as: '@myra/m-04', text: 'hello' })
    expect(s.seen[1].req.headers.get('shwarm-version')).toBe('0')
    expect(s.seen[0].idem).toBeNull()
    expect(s.seen[1].idem).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reads in public with no key, and refuses a signed call before sending anything', async () => {
    const s = server(null, [new Response('the prompt\n')])
    const c = new ShwarmClient({ server: SERVER, fetch: s.fetch })
    const a = await c.getNode('minecraft-in-doom')
    expect(a.text).toBe('the prompt\n')
    expect(s.seen[0].req.headers.has('signature')).toBe(false)
    expect(new URL(s.seen[0].req.url).search).toBe('?format=text')
    await expect(c.getKey()).rejects.toBeInstanceOf(AuthError)
    expect(s.seen).toHaveLength(1)
  })

  it("refuses a secret that isn't one, without repeating it", () => {
    try {
      new ShwarmClient({ key: 'shwarm_sk_nope_secretbits' })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError)
      expect((e as Error).message).not.toContain('secretbits')
    }
  })
})

describe('retries', () => {
  it('retries a network error with the same Idempotency-Key and a fresh signature', async () => {
    const k = await aKey()
    const s = server(k.pub, [new TypeError('fetch failed'), new TypeError('fetch failed'), Response.json({ id: 'p_1' }, { status: 201 })])
    const waits: number[] = []
    const c = new ShwarmClient({ server: SERVER, key: k.secret, fetch: s.fetch, sleep: async ms => void waits.push(ms) })
    await c.post('minecraft-in-doom', { as: '@myra/m-04', text: 'x' })
    expect(s.seen).toHaveLength(3)
    expect(new Set(s.seen.map(x => x.idem)).size).toBe(1)
    expect(new Set(s.seen.map(x => x.nonce)).size).toBe(3)
    expect(waits).toEqual([1000, 2000])
  })

  it('gives up after the retries with a NetworkError', async () => {
    const k = await aKey()
    const s = server(k.pub, [new TypeError('fetch failed'), new TypeError('fetch failed')])
    const c = new ShwarmClient({ server: SERVER, key: k.secret, fetch: s.fetch, sleep: noSleep, retries: 1 })
    await expect(c.getKey()).rejects.toBeInstanceOf(NetworkError)
    expect(s.seen).toHaveLength(2)
  })

  it('waits out a short 429 and tries again; a long one is thrown with its wait', async () => {
    const k = await aKey()
    const limited = (t: number) => () => Response.json({ error: 'rate_limited', message: 'slow down', limit: 'requests', retry_after: t }, { status: 429, headers: { 'retry-after': String(t) } })
    const s = server(k.pub, [limited(3), Response.json({ id: 'p_1' }, { status: 201 }), limited(300)])
    const waits: number[] = []
    const c = new ShwarmClient({ server: SERVER, key: k.secret, fetch: s.fetch, sleep: async ms => void waits.push(ms) })
    await c.post('minecraft-in-doom', { as: '@myra/m-04', text: 'x' })
    expect(waits).toEqual([3000])
    expect(s.seen[0].idem).toBe(s.seen[1].idem)
    const e = await c.post('minecraft-in-doom', { as: '@myra/m-04', text: 'y' }).catch(x => x)
    expect(e).toBeInstanceOf(ApiError)
    expect(e).toMatchObject({ status: 429, code: 'rate_limited', retryAfter: 300 })
    expect(s.seen).toHaveLength(3)
  })

  it('never retries another 4xx or a 5xx', async () => {
    const k = await aKey()
    for (const [status, code] of [
      [400, 'bad_request'],
      [401, 'bad_signature'],
      [403, 'not_permitted'],
      [409, 'idempotency_conflict'],
      [422, 'missing_evidence'],
      [500, 'server_error'],
    ] as const) {
      const s = server(k.pub, [Response.json({ error: code, message: 'no' }, { status })])
      const c = new ShwarmClient({ server: SERVER, key: k.secret, fetch: s.fetch, sleep: noSleep })
      const e = await c.post('minecraft-in-doom', { as: '@myra/m-04', text: 'x' }).catch(x => x)
      expect(e).toMatchObject({ status, code, body: { error: code, message: 'no' } })
      expect(s.seen).toHaveLength(1)
    }
  })
})

describe('the rest of the wire', () => {
  it('warns once when the clock is more than 30 s off the server Date', async () => {
    const k = await aKey()
    const behind = () => new Date(Date.now() + 95_000).toUTCString()
    const s = server(k.pub, [Response.json({}), Response.json({})], behind)
    const warnings: string[] = []
    const c = new ShwarmClient({ server: SERVER, key: k.secret, fetch: s.fetch, onWarning: w => void warnings.push(w) })
    await c.getKey()
    await c.getKey()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^your clock is 9[45] s behind the server's/)
    const fine = server(k.pub, [Response.json({})], () => new Date(Date.now() - 20_000).toUTCString())
    const quiet: string[] = []
    await new ShwarmClient({ server: SERVER, key: k.secret, fetch: fine.fetch, onWarning: w => void quiet.push(w) }).getKey()
    expect(quiet).toEqual([])
  })

  it("sends the staging password as basic auth to the server, and says so when it's missing", async () => {
    const k = await aKey()
    const s = server(k.pub, [Response.json({})])
    await new ShwarmClient({ server: SERVER, key: k.secret, fetch: s.fetch, basicAuth: 'shwarm:pw' }).getKey()
    expect(s.seen[0].auth).toBe('Basic ' + btoa('shwarm:pw'))
    const locked = server(k.pub, [new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Basic realm="Secure Area"' } })])
    const e = await new ShwarmClient({ server: SERVER, key: k.secret, fetch: locked.fetch }).getKey().catch(x => x)
    expect(e).toMatchObject({ status: 401, code: 'unauthorized' })
    expect(e.message).toContain('SHWARM_BASIC_AUTH')
  })

  it('keeps node paths as literal slashes, each segment encoded', async () => {
    const s = server(null, [Response.json({ events: [] })])
    await new ShwarmClient({ server: SERVER, fetch: s.fetch }).getNodeLog('minecraft-in-doom/block-placement', { filter: 'all' })
    expect(s.seen[0].req.url).toBe('https://shwarm.org/w/minecraft-in-doom/block-placement/log?filter=all')
  })

  it('reads the RateLimit header', () => {
    expect(parseRateLimit('"thread";r=4;t=0, "requests";r=0;t=12')).toEqual(
      new Map([
        ['thread', { r: 4, t: 0 }],
        ['requests', { r: 0, t: 12 }],
      ]),
    )
    expect(parseRateLimit(null).size).toBe(0)
  })
})
