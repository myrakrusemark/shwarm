import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { toBase64url } from '@shwarm/protocol'
import { hashPassword, isPwned, passwordProblem, PBKDF2_ITERATIONS, verifyPassword } from '../src/auth/password'
import { browserSummary, createSession, endAllSessions, endSession, ipPrefix, readSession, sessionCookie, sessionId } from '../src/auth/session'
import { formToken, formTokenOk, originGuard, sameOrigin } from '../src/auth/csrf'
import { addPerson, T0, testDb } from './d1'

const pepper = toBase64url(new Uint8Array(32).fill(9))
const DAY = 86_400_000

describe('passwords', () => {
  it('hashes to a self-describing string and verifies', async () => {
    const h = await hashPassword('correct horse battery', pepper, 1000)
    expect(h).toMatch(/^pbkdf2-sha256\$i=1000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/)
    expect((await verifyPassword('correct horse battery', h, pepper)).ok).toBe(true)
    expect((await verifyPassword('correct horse batterz', h, pepper)).ok).toBe(false)
  })

  it('salts every hash', async () => {
    expect(await hashPassword('same password', pepper, 1000)).not.toBe(await hashPassword('same password', pepper, 1000))
  })

  it('needs the pepper: the same password and hash fail under another pepper', async () => {
    const h = await hashPassword('correct horse battery', pepper, 1000)
    expect((await verifyPassword('correct horse battery', h, toBase64url(new Uint8Array(32).fill(1)))).ok).toBe(false)
  })

  it('asks for a rehash when the settings changed, only after a correct password', async () => {
    const old = await hashPassword('correct horse battery', pepper, 1000)
    expect(await verifyPassword('correct horse battery', old, pepper)).toEqual({ ok: true, needsRehash: true })
    expect(await verifyPassword('wrong password!', old, pepper)).toEqual({ ok: false, needsRehash: false })
    const cur = await hashPassword('correct horse battery', pepper)
    expect(cur).toContain(`i=${PBKDF2_ITERATIONS}$`)
    expect(await verifyPassword('correct horse battery', cur, pepper)).toEqual({ ok: true, needsRehash: false })
  })

  it("doesn't verify unknown formats (e.g. a future argon2id hash read by old code)", async () => {
    expect((await verifyPassword('x', '$argon2id$v=19$m=19456,t=2,p=1$abc$def', pepper)).ok).toBe(false)
    expect((await verifyPassword('x', '', pepper)).ok).toBe(false)
  })

  it('treats composed and decomposed accents as the same password', async () => {
    const h = await hashPassword('café au lait!', pepper, 1000)
    expect((await verifyPassword('café au lait!', h, pepper)).ok).toBe(true)
  })

  it('checks length in characters, 10 to 128', () => {
    expect(passwordProblem('123456789')).toBe('too_short')
    expect(passwordProblem('1234567890')).toBeNull()
    expect(passwordProblem('🧱'.repeat(10))).toBeNull()
    expect(passwordProblem('a'.repeat(129))).toBe('too_long')
  })

  it('asks Have I Been Pwned with only a 5-character prefix', async () => {
    let asked = ''
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const fake = (async (url: string) => {
      asked = url
      return new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n')
    }) as unknown as typeof fetch
    expect(await isPwned('password', fake)).toBe(true)
    expect(asked).toBe('https://api.pwnedpasswords.com/range/5BAA6')
    expect(await isPwned('a much longer passphrase', fake)).toBe(false)
    const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch
    expect(await isPwned('password', down)).toBe(false)
  })
})

describe('sessions', () => {
  it('stores only the hash of the token and reads it back', async () => {
    const db = testDb()
    const me = await addPerson(db, 'myra')
    const token = await createSession(db, me, { ip: '203.0.113.9', ua: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0' }, T0)
    const row = db.raw.prepare('SELECT * FROM session').get()
    expect(row.id).toBe(await sessionId(token))
    expect(row.id).not.toContain(token)
    expect(row.ip_prefix).toBe('203.0.113.0/24')
    expect(row.browser).toBe('firefox · linux')
    expect((await readSession(db, token, T0 + 1000))?.personId).toBe(me)
  })

  it('slides the expiry and drops expired sessions', async () => {
    const db = testDb()
    const me = await addPerson(db, 'myra')
    const token = await createSession(db, me, {}, T0)
    expect(await readSession(db, token, T0 + 29 * DAY)).not.toBeNull() // touched: now good until day 59
    expect(await readSession(db, token, T0 + 58 * DAY)).not.toBeNull()
    expect(await readSession(db, token, T0 + 89 * DAY)).toBeNull()
  })

  it('refuses unknown tokens, suspended people, sign-out and reset', async () => {
    const db = testDb()
    const me = await addPerson(db, 'myra')
    const bad = await addPerson(db, 'spam_bot', { status: 'suspended' })
    expect(await readSession(db, 'nope', T0)).toBeNull()
    expect(await readSession(db, undefined, T0)).toBeNull()
    expect(await readSession(db, await createSession(db, bad, {}, T0), T0)).toBeNull()
    const a = await createSession(db, me, {}, T0)
    const b = await createSession(db, me, {}, T0)
    await endSession(db, a)
    expect(await readSession(db, a, T0)).toBeNull()
    expect(await readSession(db, b, T0)).not.toBeNull()
    await endAllSessions(db, me)
    expect(await readSession(db, b, T0)).toBeNull()
  })

  it('sets a __Host- cookie that scripts and other sites cannot use', () => {
    const c = sessionCookie('tok')
    expect(c).toMatch(/^__Host-shwarm=tok; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/)
    expect(c).not.toContain('Domain=')
  })

  it('keeps only coarse network and browser details', () => {
    expect(ipPrefix('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::/48')
    expect(ipPrefix(null)).toBeNull()
    expect(browserSummary('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Safari/605.1')).toBe('safari · ios')
  })
})

describe('cross-site protection', () => {
  const app = new Hono()
  app.use('*', originGuard())
  app.get('/', c => c.text('read'))
  app.post('/w/minecraft-in-doom', c => c.text('posted'))
  const post = (headers: Record<string, string>) => app.request('https://shwarm.org/w/minecraft-in-doom', { method: 'POST', headers })

  it('refuses a cross-origin form post', async () => {
    expect((await post({ origin: 'https://evil.example' })).status).toBe(403)
    expect((await post({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })).status).toBe(403)
    expect((await post({ 'sec-fetch-site': 'same-site' })).status).toBe(403) // a sibling subdomain is not us
  })

  it('refuses a write with no origin information at all', async () => {
    expect((await post({})).status).toBe(403)
  })

  it('allows same-origin writes and all reads', async () => {
    expect((await post({ origin: 'https://shwarm.org' })).status).toBe(200)
    expect((await post({ 'sec-fetch-site': 'same-origin' })).status).toBe(200)
    expect((await app.request('https://shwarm.org/', { headers: { origin: 'https://evil.example' } })).status).toBe(200)
    expect(sameOrigin(new Request('https://shwarm.org/x', { method: 'HEAD' }))).toBe(true)
  })

  it('binds form tokens to the session', async () => {
    const t = await formToken('secret', 'session-a')
    expect(await formTokenOk('secret', 'session-a', t)).toBe(true)
    expect(await formTokenOk('secret', 'session-b', t)).toBe(false)
    expect(await formTokenOk('other-secret', 'session-a', t)).toBe(false)
    expect(await formTokenOk('secret', 'session-a', undefined)).toBe(false)
    expect(await formTokenOk('secret', 'session-a', t.slice(1))).toBe(false)
  })
})
