// Go-live 9.6: the Worker checks Cloudflare Access's token on every /admin request itself, rather than only that the
// header is there. A good token (our team's key, our aud, our iss, in its time window) gets the admin in; a bad
// signature, another application's aud, another team's iss, an expired or not-yet-valid token, a made-up header or no
// header at all is the plain 404, the same as for anyone who isn't an admin. With ACCESS_AUD unset nothing changes.
// The team's keys are fetched once and kept; a key id we don't know yet fetches them again (Cloudflare rotates them),
// at most once a minute.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { accessIssuer, accessTokenOk, forgetAccessKeys } from '../src/web/access-jwt'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { T0 } from './d1'
import { Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { stagingWorld } from './node-fixture'

const AUD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const TEAM = 'shwarmteam'
const ISS = 'https://shwarmteam.cloudflareaccess.com'
const CERTS = `${ISS}/cdn-cgi/access/certs`
const HTML = { accept: 'text/html' }
const sec = (ms: number) => Math.floor(ms / 1000)

type Pair = { kid: string; keys: CryptoKeyPair }
const enc = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const encJson = (v: unknown) => enc(new TextEncoder().encode(JSON.stringify(v)))

async function pair(kid: string): Promise<Pair> {
  const keys = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  return { kid, keys }
}

/** A token as Access writes it, with whatever claims and header the case needs. */
async function token(p: Pair, claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const h = encJson({ alg: 'RS256', kid: p.kid, typ: 'JWT', ...header })
  const body = encJson({ aud: [AUD], iss: ISS, email: 'myrakrusemark@gmail.com', iat: sec(T0) - 60, nbf: sec(T0) - 60, exp: sec(T0) + 3600, ...claims })
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', p.keys.privateKey, new TextEncoder().encode(`${h}.${body}`)))
  return `${h}.${body}.${enc(sig)}`
}

/** fetch with the team's certs on top of the usual fakes; `published` is what the certs URL serves right now. */
function stubFetch(published: () => Pair[]) {
  const base = fakeFetch()
  const certs: string[] = []
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url === CERTS) {
      certs.push(url)
      const keys = await Promise.all(published().map(async p => ({ ...(await crypto.subtle.exportKey('jwk', p.keys.publicKey)), kid: p.kid, alg: 'RS256', use: 'sig' })))
      return Response.json({ keys, public_cert: { kid: published()[0]?.kid, cert: '-----BEGIN CERTIFICATE-----' } })
    }
    return base(input, init)
  }
  vi.stubGlobal('fetch', fn)
  return certs
}

let A: Pair
let B: Pair
let other: Pair // the same kid as A, a different key: a forged signature

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
  forgetVersions()
  forgetAccessKeys()
  A ??= await pair('kid-a')
  B ??= await pair('kid-b')
  other ??= await pair('kid-a')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function admin(access: { ACCESS_AUD?: string; ACCESS_TEAM?: string }) {
  const w = await stagingWorld()
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  w.db.raw.prepare('UPDATE person SET password_hash = ?, is_admin = 1 WHERE id = ?').run(hash, w.myraId)
  const env = { ...testEnv(w.db), ...access }
  const b = new Browser(env)
  expect((await b.post('/signin', { email: 'myra@example.org', password: GOOD_PASSWORD })).status).toBe(303)
  const get = (p: string, jwt?: string) => b.req(p, { headers: { ...HTML, ...(jwt === undefined ? {} : { 'cf-access-jwt-assertion': jwt }) } })
  return { w, b, env, get }
}

describe('the Access token on /admin (go-live 9.6)', () => {
  it('a good token gets the admin in; a bad signature, wrong aud or iss, expired, not yet valid, made up or missing is the plain 404', async () => {
    const certs = stubFetch(() => [A, B])
    const { get } = await admin({ ACCESS_AUD: AUD, ACCESS_TEAM: TEAM })
    for (const p of ['/admin', '/admin/analytics', '/admin/switches']) expect((await get(p, await token(A))).status, p).toBe(200)
    expect((await get('/admin', await token(B))).status).toBe(200) // either published key
    expect((await get('/admin', await token(A, { aud: AUD }))).status).toBe(200) // aud as a plain string too
    expect((await get('/admin', await token(A, { exp: sec(T0) - 10 }))).status).toBe(200) // inside the clock skew
    const bad: [string, string | undefined][] = [
      ['no header', undefined],
      ['empty header', ''],
      ['made up', 'yes'],
      ['bad signature', await token(other)],
      ['tampered claims', (await token(A)).replace(/^([^.]+)\.[^.]+/, (_, h) => `${h}.${encJson({ aud: [AUD], iss: ISS, exp: sec(T0) + 99_999 })}`)],
      ['wrong aud', await token(A, { aud: ['another-application'] })],
      ['no aud', await token(A, { aud: undefined })],
      ['wrong iss', await token(A, { iss: 'https://someoneelse.cloudflareaccess.com' })],
      ['expired', await token(A, { exp: sec(T0) - 3600 })],
      ['no exp', await token(A, { exp: undefined })],
      ['not yet valid', await token(A, { nbf: sec(T0) + 3600 })],
      ['alg none', (await token(A, {}, { alg: 'none' })).replace(/[^.]+$/, '')],
      ['HS256', await token(A, {}, { alg: 'HS256' })],
      ['unknown kid', await token(A, {}, { kid: 'kid-nobody' })],
    ]
    for (const [why, jwt] of bad)
      for (const p of ['/admin', '/admin/analytics']) {
        const r = await get(p, jwt)
        expect(r.status, `${why} ${p}`).toBe(404)
        expect(await r.text(), `${why} ${p}`).toContain('there is nothing at this address.')
      }
    expect(certs.length).toBe(1) // fetched once, and the unknown kid fell inside the minute's gap
  })

  it('a form needs the token too: no header, no act', async () => {
    stubFetch(() => [A])
    const { b, w } = await admin({ ACCESS_AUD: AUD, ACCESS_TEAM: TEAM })
    const form_token = formTokenIn(await (await b.get('/signin')).text())
    const r = await b.req('/admin/switches', { form: { form_token, key: 'read_only', value: 'true', reason: 'x' } })
    expect(r.status).toBe(404)
    expect(w.db.raw.prepare('SELECT COUNT(*) AS k FROM moderation_action').get()).toEqual({ k: 0 })
  })

  it('ACCESS_AUD without ACCESS_TEAM lets no one in, a good token included', async () => {
    const certs = stubFetch(() => [A])
    const { get } = await admin({ ACCESS_AUD: AUD })
    expect((await get('/admin', await token(A))).status).toBe(404)
    expect(certs.length).toBe(0)
  })

  it('with ACCESS_AUD unset, nothing changes: no header needed, no keys fetched', async () => {
    const certs = stubFetch(() => [A])
    const { get } = await admin({})
    expect((await get('/admin')).status).toBe(200)
    expect((await get('/admin/analytics')).status).toBe(200)
    expect(certs.length).toBe(0)
  })

  it('a rotated key: an unknown kid fetches the keys again, at most once a minute', async () => {
    let published = [A]
    const certs = stubFetch(() => published)
    const { get } = await admin({ ACCESS_AUD: AUD, ACCESS_TEAM: TEAM })
    expect((await get('/admin', await token(A))).status).toBe(200)
    published = [B]
    // inside the minute the new kid isn't fetched yet
    expect((await get('/admin', await token(B))).status).toBe(404)
    expect(certs.length).toBe(1)
    vi.setSystemTime(T0 + 61_000)
    expect((await get('/admin', await token(B))).status).toBe(200)
    expect(certs.length).toBe(2)
    // the kept keys are used without a fetch
    expect((await get('/admin', await token(B))).status).toBe(200)
    expect(certs.length).toBe(2)
  })

  it('a failed key fetch is a 404, and the next request tries again', async () => {
    let up = false
    const base = fakeFetch()
    const keys = async () => ({ keys: [{ ...(await crypto.subtle.exportKey('jwk', A.keys.publicKey)), kid: A.kid }] })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === CERTS) return up ? Response.json(await keys()) : new Response('down', { status: 503 })
      return base(input, init)
    })
    const { get } = await admin({ ACCESS_AUD: AUD, ACCESS_TEAM: TEAM })
    expect((await get('/admin', await token(A))).status).toBe(404)
    up = true
    expect((await get('/admin', await token(A))).status).toBe(200)
  })

  it('takes ACCESS_TEAM as the bare team name or its whole address', async () => {
    for (const t of ['shwarmteam', 'shwarmteam.cloudflareaccess.com', 'https://shwarmteam.cloudflareaccess.com/']) expect(accessIssuer(t)).toBe(ISS)
    stubFetch(() => [A])
    expect(await accessTokenOk(await token(A), { aud: AUD, team: 'https://shwarmteam.cloudflareaccess.com', now: T0 })).toBe(true)
    expect(await accessTokenOk(await token(A), { aud: AUD, team: 'otherteam', now: T0 })).toBe(false)
  })
})
