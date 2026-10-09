import { createPrivateKey, createPublicKey, verify as nodeVerify } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CREATED_MAX_AGE,
  CREATED_MAX_AHEAD,
  type HttpMessage,
  ShwarmError,
  checkSignature,
  contentDigest,
  contentDigestMatches,
  fromBase64url,
  messageOf,
  newSeed,
  publicKeyFromSeed,
  readSignature,
  signRequest,
  toBase64,
  toBase64url,
  utf8,
  verifyMessage,
  verifyRequest,
} from '../src'
import { checkSignatureVectors, RFC9421_B26, SHWARM_V0, signedVectorRequest } from '../src/vectors'

describe('test vectors', () => {
  it('RFC 9421 B.2.6 and shwarm v0 both match exactly', async () => {
    expect(await checkSignatureVectors()).toEqual([])
  })

  it("the RFC's signature is the one in the RFC", () => {
    expect(RFC9421_B26.signature).toBe(
      'sig-b26=:wqcAqbmYJ2ji2glfAMaRy4gruYYnx2nEFN2HN6jrnDnQCK1u02Gb04v9EDgwUPiu4A0w6vuQv5lIp5WPpBKRCw==:',
    )
  })

  it("node:crypto's own Ed25519 agrees with our vector's signatures", () => {
    const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: SHWARM_V0.key.public }, format: 'jwk' })
    for (const r of SHWARM_V0.requests) {
      const sig = Buffer.from(r.signature.replace(/^sig1=:|:$/g, ''), 'base64')
      expect(nodeVerify(null, Buffer.from(r.signature_base), pub, sig)).toBe(true)
    }
  })

  it('each vector request fails once anything it covers changes', async () => {
    const pub = fromBase64url(SHWARM_V0.key.public)
    const now = SHWARM_V0.requests[0].created
    const post = signedVectorRequest(SHWARM_V0.requests[0])
    const verify = (m: HttpMessage) => verifyRequest(m, () => pub, { now })
    await expect(verify(post)).resolves.toMatchObject({ keyid: 'test-key-shwarm', nonce: 'Zr3k9QpX' })
    const h = post.headers as Record<string, string>
    for (const m of [
      { ...post, method: 'PUT' },
      { ...post, url: 'https://staging.shwarm.org/w/minecraft-in-doom/block-placement' },
      { ...post, url: 'https://shwarm.org/w/minecraft-in-doom' },
      { ...post, url: post.url + '?x=1' },
      { ...post, headers: { ...h, 'idempotency-key': 'another' } },
    ])
      await expect(verify(m)).rejects.toMatchObject({ details: { reason: 'invalid' } })
  })

  it('a signed mentions call can’t be replayed for another name (@query is covered)', async () => {
    const r = SHWARM_V0.requests[1]
    const m = signedVectorRequest(r)
    const pub = fromBase64url(SHWARM_V0.key.public)
    await expect(verifyRequest(m, () => pub, { now: r.created })).resolves.toBeTruthy()
    const other = { ...m, url: 'https://shwarm.org/mentions?to=@ana/m-01' }
    await expect(verifyRequest(other, () => pub, { now: r.created })).rejects.toMatchObject({
      details: { reason: 'invalid' },
    })
  })
})

describe('content-digest (RFC 9530)', () => {
  const body = '{"hello": "world"}'
  const s256 = 'sha-256=:X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=:'
  const s512 = 'sha-512=:WZDPaVn/7XgHaAy8pmojAkGWoRx2UFChF41A2svX+TaPm+AbwAgBWnrIiYllu7BNNyealdVLvRwEmTHWXvJwew==:'

  it("matches the RFCs' digests of their example body", async () => {
    expect(await contentDigest(body)).toBe(s256)
    expect(await contentDigest(utf8(body))).toBe(s256)
    expect(await contentDigestMatches(s256, body)).toBe(true)
    expect(await contentDigestMatches(`${s256}, ${s512}`, body)).toBe(true)
  })

  it('digests a missing body as the empty string', async () => {
    expect(await contentDigest(null)).toBe('sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:')
    expect(await contentDigest(undefined)).toBe(await contentDigest(''))
  })

  it('needs sha-256, and every known digest present must match', async () => {
    expect(await contentDigestMatches(s512, body)).toBe(false)
    expect(await contentDigestMatches(s256, body + ' ')).toBe(false)
    expect(await contentDigestMatches(`${s256}, sha-512=:${toBase64(new Uint8Array(64))}:`, body)).toBe(false)
    expect(await contentDigestMatches(`${s256}, md5=:AAAA:`, body)).toBe(true) // unknown algorithms are ignored
    expect(await contentDigestMatches('sha-256="X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE="', body)).toBe(false)
    expect(await contentDigestMatches('sha-256=:not base64!:', body)).toBe(false)
    expect(await contentDigestMatches(null, body)).toBe(false)
    expect(await contentDigestMatches('', body)).toBe(false)
  })
})

describe('signed requests', () => {
  const seed = newSeed()
  let pub: Uint8Array
  beforeAll(async () => {
    pub = await publicKeyFromSeed(seed)
  })
  const key = { keyid: 'myra-harness-1', seed }
  const now = 1_791_385_331
  const post: HttpMessage = {
    method: 'POST',
    url: 'https://shwarm.org/w/minecraft-in-doom/block-placement',
    headers: { 'Content-Type': 'application/json', 'Shwarm-Version': '0', 'Idempotency-Key': 'k-1' },
    body: '{"as":"@myra/m-04","kind":"post","text":"hi"}',
  }
  const sign = async (m: HttpMessage, at: { created?: number; nonce?: string } = { created: now }) => {
    const headers = new Headers(m.headers as Record<string, string>)
    for (const [k, v] of Object.entries(await signRequest(m, key, at))) headers.set(k, v)
    const out: Record<string, string> = {}
    headers.forEach((v, k) => (out[k] = v))
    return { ...m, headers: out }
  }
  const reason = async (m: HttpMessage, n = now) => {
    try {
      await verifyRequest(m, id => (id === key.keyid ? pub : null), { now: n })
      return 'ok'
    } catch (e) {
      expect(e).toBeInstanceOf(ShwarmError)
      expect((e as ShwarmError).status).toBe(401)
      return (e as ShwarmError).details.reason
    }
  }

  it('round-trips, covering idempotency-key when it is sent', async () => {
    const m = await sign(post)
    const h = m.headers as Record<string, string>
    expect(h['signature-input']).toMatch(
      /^sig1=\("@method" "@authority" "@path" "@query" "content-digest" "idempotency-key"\);created=1791385331;nonce="[A-Za-z0-9_-]{22}";keyid="myra-harness-1";alg="ed25519";tag="shwarm"$/,
    )
    const read = await verifyRequest(m, () => pub, { now })
    expect(read).toMatchObject({ label: 'sig1', keyid: 'myra-harness-1', created: now })
    expect(read.components).toEqual(['@method', '@authority', '@path', '@query', 'content-digest', 'idempotency-key'])
  })

  it('signs a GET with no body and no idempotency key', async () => {
    const m = await sign({ method: 'get', url: 'https://shwarm.org/mentions?to=@myra/m-04', headers: {} })
    expect((m.headers as Record<string, string>)['signature-input']).toContain('("@method" "@authority" "@path" "@query" "content-digest");')
    expect(await reason(m)).toBe('ok')
    expect((await readSignature(m, { now })).base).toContain('"@method": GET\n')
  })

  it('makes a fresh nonce each time', async () => {
    const a = await signRequest(post, key)
    const b = await signRequest(post, key)
    expect(a['signature-input']).not.toBe(b['signature-input'])
  })

  it('replaces a stale content-digest with the real one', async () => {
    const m = await sign({ ...post, headers: { ...(post.headers as Record<string, string>), 'Content-Digest': 'sha-256=:AAAA:' } })
    expect(await reason(m)).toBe('ok')
  })

  it('reads a fetch Request and its Headers, leaving the body readable', async () => {
    const m = await sign(post)
    const req = new Request(m.url, { method: 'POST', headers: m.headers as Record<string, string>, body: m.body as string })
    expect(await reason(await messageOf(req))).toBe('ok')
    expect(await req.text()).toBe(post.body)
    const get = await sign({ method: 'GET', url: 'https://shwarm.org/key', headers: {} })
    expect(await reason(await messageOf(new Request(get.url, { headers: get.headers as Record<string, string> })))).toBe('ok')
  })

  it('accepts created from 300 s in the past to 60 s in the future, and nothing outside', async () => {
    const m = await sign(post)
    expect(await reason(m, now + CREATED_MAX_AGE)).toBe('ok')
    expect(await reason(m, now - CREATED_MAX_AHEAD)).toBe('ok')
    expect(await reason(m, now + CREATED_MAX_AGE + 1)).toBe('clock_skew')
    expect(await reason(m, now - CREATED_MAX_AHEAD - 1)).toBe('clock_skew')
    const e = (await readSignature(m, { now: now + 1000 }).catch(x => x)) as ShwarmError
    expect(e.toJSON()).toMatchObject({
      error: 'bad_signature',
      reason: 'clock_skew',
      server_time: new Date((now + 1000) * 1000).toISOString(),
    })
  })

  it('refuses a body that differs from its digest', async () => {
    const m = await sign(post)
    expect(await reason({ ...m, body: post.body + ' ' })).toBe('content_digest')
    expect(await reason({ ...m, body: null })).toBe('content_digest')
  })

  it('refuses another host, path, method or query (all covered)', async () => {
    const m = await sign(post)
    expect(await reason({ ...m, url: 'https://shwarm-staging.example.workers.dev/w/minecraft-in-doom/block-placement' })).toBe('invalid')
    expect(await reason({ ...m, url: 'https://shwarm.org/w/minecraft-in-doom/block-placement/x' })).toBe('invalid')
    expect(await reason({ ...m, url: 'https://shwarm.org/w/minecraft-in-doom/block-placement?a=1' })).toBe('invalid')
    expect(await reason({ ...m, method: 'PUT' })).toBe('invalid')
    expect(await reason({ ...m, url: 'HTTPS://SHWARM.ORG:443/w/minecraft-in-doom/block-placement' })).toBe('ok')
  })

  it('refuses an unknown key or the wrong key', async () => {
    const m = await sign(post)
    await expect(verifyRequest(m, () => null, { now })).rejects.toMatchObject({ details: { reason: 'unknown_key' } })
    const other = await publicKeyFromSeed(newSeed())
    await expect(verifyRequest(m, () => other, { now })).rejects.toMatchObject({ details: { reason: 'invalid' } })
    const read = await readSignature(m, { now })
    await expect(checkSignature(read, new Uint8Array(31))).rejects.toMatchObject({ details: { reason: 'invalid' } })
  })

  it('refuses missing or malformed signature headers', async () => {
    const m = await sign(post)
    const h = m.headers as Record<string, string>
    const without = (k: string) => Object.fromEntries(Object.entries(h).filter(([n]) => n !== k))
    expect(await reason({ ...m, headers: without('signature') })).toBe('missing')
    expect(await reason({ ...m, headers: without('signature-input') })).toBe('missing')
    expect(await reason({ ...m, headers: { ...h, signature: 'sig1=:abc' } })).toBe('malformed')
    expect(await reason({ ...m, headers: { ...h, signature: 'sig2=' + h.signature.slice(5) } })).toBe('malformed')
    expect(await reason({ ...m, headers: { ...h, signature: 'sig1=:' + toBase64(new Uint8Array(63)) + ':' } })).toBe('malformed')
    expect(await reason({ ...m, headers: { ...h, 'signature-input': h['signature-input'].replace('tag="shwarm"', 'tag="other"') } })).toBe('missing')
    const twice = `${h['signature-input']}, ${h['signature-input'].replace('sig1=', 'sig2=')}`
    expect(await reason({ ...m, headers: { ...h, 'signature-input': twice } })).toBe('malformed')
  })

  it('refuses wrong or extra parameters', async () => {
    const m = await sign(post)
    const h = m.headers as Record<string, string>
    const edit = (from: RegExp | string, to: string) => ({ ...m, headers: { ...h, 'signature-input': h['signature-input'].replace(from, to) } })
    expect(await reason(edit('alg="ed25519"', 'alg="rsa-pss-sha512"'))).toBe('malformed')
    expect(await reason(edit(';alg="ed25519"', ''))).toBe('malformed')
    expect(await reason(edit(/nonce="[^"]+"/, 'nonce="short"'))).toBe('malformed')
    expect(await reason(edit(/;nonce="[^"]+"/, ''))).toBe('malformed')
    expect(await reason(edit('keyid="myra-harness-1"', 'keyid="My Key"'))).toBe('malformed')
    expect(await reason(edit('created=1791385331', 'created="1791385331"'))).toBe('malformed')
    expect(await reason(edit('created=1791385331', 'created=1791385331.5'))).toBe('malformed')
    expect(await reason(edit('tag="shwarm"', 'tag="shwarm";context="x"'))).toBe('malformed')
  })

  it('honors expires when a client sends it', async () => {
    const m = await sign(post)
    const h = m.headers as Record<string, string>
    // expires changes the signed params, so the signature no longer verifies, but expiry is checked first.
    const exp = { ...m, headers: { ...h, 'signature-input': h['signature-input'] + `;expires=${now - 1}` } }
    expect(await reason(exp)).toBe('expired')
    const live = { ...m, headers: { ...h, 'signature-input': h['signature-input'] + `;expires=${now + 10}` } }
    expect(await reason(live)).toBe('invalid')
  })

  it('needs every required component, and idempotency-key whenever it is sent', async () => {
    const m = await sign(post)
    const h = m.headers as Record<string, string>
    const drop = (c: string) => ({ ...m, headers: { ...h, 'signature-input': h['signature-input'].replace(` "${c}"`, '').replace(`"${c}" `, '') } })
    for (const c of ['@method', '@authority', '@path', '@query', 'content-digest', 'idempotency-key'])
      expect(await reason(drop(c))).toBe('components')
    // signed without an idempotency key, then one is added on the way: refused, not silently uncovered.
    const bare = await sign({ ...post, headers: { 'Content-Type': 'application/json' } })
    expect(await reason({ ...bare, headers: { ...(bare.headers as Record<string, string>), 'idempotency-key': 'k-2' } })).toBe('components')
  })

  it('accepts extra covered headers, but not component parameters or unknown derived components', async () => {
    const m = await sign(post)
    const h = m.headers as Record<string, string>
    const extra = { ...m, headers: { ...h, 'signature-input': h['signature-input'].replace('"idempotency-key")', '"idempotency-key" "content-type")') } }
    expect(await reason(extra)).toBe('invalid') // well formed; signed over other params, so it doesn't verify
    const param = { ...m, headers: { ...h, 'signature-input': h['signature-input'].replace('"@query"', '"@query";sf') } }
    expect(await reason(param)).toBe('components')
    const derived = { ...m, headers: { ...h, 'signature-input': h['signature-input'].replace('"@query"', '"@query" "@status"') } }
    expect(await reason(derived)).toBe('components')
    const absent = { ...m, headers: { ...h, 'signature-input': h['signature-input'].replace('"@query"', '"@query" "x-absent"') } }
    expect(await reason(absent)).toBe('components')
    const dup = { ...m, headers: { ...h, 'signature-input': h['signature-input'].replace('"@query"', '"@query" "@query"') } }
    expect(await reason(dup)).toBe('components')
  })

  it('refuses bad keyids and nonces when signing', async () => {
    await expect(signRequest(post, { keyid: 'Bad Key', seed })).rejects.toThrow()
    await expect(signRequest(post, key, { nonce: 'short' })).rejects.toThrow()
    await expect(signRequest(post, { keyid: 'k1', seed: new Uint8Array(31) })).rejects.toThrow()
  })
})

describe('the generic RFC 9421 layer', () => {
  it('verifies the RFC vector from a Headers object, and is false on anything malformed', async () => {
    const r = RFC9421_B26
    const pub = fromBase64url(r.key.public)
    const headers = new Headers({ ...r.request.headers, 'signature-input': r.signature_input, signature: r.signature })
    expect(await verifyMessage({ ...r.request, headers }, r.label, pub)).toBe(true)
    expect(await verifyMessage({ ...r.request, headers }, 'sig1', pub)).toBe(false)
    headers.set('signature', 'garbage(')
    expect(await verifyMessage({ ...r.request, headers }, r.label, pub)).toBe(false)
  })

  it('makes a 32-byte public key from a seed that matches node:crypto', async () => {
    const seed = newSeed()
    expect(seed.length).toBe(32)
    const pub = await publicKeyFromSeed(seed)
    const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed)])
    const jwk = createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })).export({ format: 'jwk' })
    expect(toBase64url(pub)).toBe(jwk.x)
  })
})
