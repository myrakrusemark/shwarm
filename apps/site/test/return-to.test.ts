import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toBase64url, utf8 } from '@shwarm/protocol'
import { formToken } from '../src/auth/csrf'
import { hashPassword } from '../src/auth/password'
import { openNext, signNext } from '../src/auth/request'
import { backLabel, joinHref, signInHref, withNext } from '../src/auth/return-to'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, GOOD_PASSWORD, joinForm, linkIn, mails, pepper, setSignup, testEnv, type TestEnv } from './browser'

const SECRET = 'csrf-secret-for-tests' // testEnv's
const EVIL = ['//evil.example', 'https://evil.example/', '/\\evil.example', '/.//evil.example/x', '/..//evil.example', '/%2e//evil.example', 'javascript:alert(1)', '\\\\evil.example', '/\t/evil.example']

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function shwarm(env: TestEnv, path: string, title: string, o: { hidden?: boolean; triage?: string; seeded?: boolean } = {}) {
  const author = await addPerson(env.DB, `a_${path.replace(/[^a-z0-9]/g, '_').slice(0, 20)}`)
  // A branch when the path has a slash: its parent is the node one level up, its root the first segment.
  const up = path.includes('/') ? (env.DB.raw.prepare('SELECT id, root_id FROM node WHERE path = ?').get(path.replace(/\/[^/]+$/, '')) as { id: number; root_id: number | null }) : null
  env.DB.raw
    .prepare(
      `INSERT INTO node (path, slug, kind, parent_id, root_id, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, hidden, triage, seeded, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'w', 'd', '{"author":true}', 10, 'MIT', ?, '@a', 'lobby', ?, ?, ?, ?)`,
    )
    .run(path, path.split('/').pop(), up ? 'branch' : 'shwarm', up?.id ?? null, up ? (up.root_id ?? up.id) : null, title, author, o.hidden ? 1 : 0, o.triage ?? 'clear', o.seeded ? 1 : 0, new Date(T0).toISOString())
  return author
}

/** The value of a hidden input on a page. */
const hidden = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1]

describe('signed next', () => {
  it('round-trips a same-site path for one scope only', async () => {
    const s = await signNext(SECRET, '/w/minecraft-in-doom?sort=new', 'check')
    expect(s).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
    expect(await openNext(SECRET, s, 'check')).toBe('/w/minecraft-in-doom?sort=new')
    expect(await openNext(SECRET, s, 'verified')).toBeNull()
    expect(await openNext('another-secret', s, 'check')).toBeNull()
  })

  it('refuses anything altered, forged or malformed', async () => {
    const s = await signNext(SECRET, '/w/minecraft-in-doom', 'check')
    const [p, mac] = s.split('.')
    const flip = (x: string) => (x[0] === 'A' ? 'B' : 'A') + x.slice(1)
    for (const bad of [
      `${flip(p)}.${mac}`,
      `${p}.${flip(mac)}`,
      `${toBase64url(utf8('//evil.example'))}.${mac}`,
      `${p}.`,
      p,
      '',
      `${p}.${mac}.x`,
      `!!.${mac}`,
      undefined,
      42,
      'x'.repeat(2000),
    ]) {
      expect(await openNext(SECRET, bad, 'check'), String(bad)).toBeNull()
    }
  })

  it('refuses an outside path even with a good signature (safeNext runs again)', async () => {
    for (const evil of EVIL) {
      const forged = `${toBase64url(utf8(evil))}.${await formToken(SECRET, `next:check:${evil}`)}`
      expect(await openNext(SECRET, forged, 'check'), evil).toBeNull()
    }
  })
})

describe('return-to links', () => {
  it('builds join and sign-in links that carry only same-site paths', () => {
    expect(joinHref('/w/minecraft-in-doom')).toBe('/join?next=%2Fw%2Fminecraft-in-doom')
    expect(signInHref('/w/minecraft-in-doom?sort=new#p_3')).toBe('/signin?next=%2Fw%2Fminecraft-in-doom%3Fsort%3Dnew%23p_3')
    expect(withNext('/join', undefined)).toBe('/join')
    for (const evil of EVIL) expect(joinHref(evil), evil).toBe('/join')
  })

  it('names a node by its title, else "where you were"', async () => {
    const env = testEnv()
    await shwarm(env, 'minecraft-in-doom', 'minecraft in doom')
    await shwarm(env, 'secret-thing', 'secret thing', { hidden: true })
    await shwarm(env, 'held-thing', 'held thing', { triage: 'held' })
    const checking = await shwarm(env, 'being-checked', 'being checked', { triage: 'pending' })
    await shwarm(env, 'launch-seed', 'launch seed', { triage: 'pending', seeded: true })
    await shwarm(env, 'held-thing/a-branch', 'a branch of a held thing')
    expect(await backLabel(env.DB, '/w/minecraft-in-doom')).toBe('minecraft in doom')
    expect(await backLabel(env.DB, '/w/minecraft-in-doom/?sort=new#p_1')).toBe('minecraft in doom')
    expect(await backLabel(env.DB, '/w/minecraft-in-doom/s/2')).toBe('minecraft in doom')
    expect(await backLabel(env.DB, '/w/secret-thing')).toBe('where you were')
    expect(await backLabel(env.DB, '/w/held-thing')).toBe('where you were')
    // Still being checked: only its author learns the title, as on the reading pages; a seed is public.
    expect(await backLabel(env.DB, '/w/being-checked')).toBe('where you were')
    expect(await backLabel(env.DB, '/w/being-checked', checking)).toBe('being checked')
    expect(await backLabel(env.DB, '/w/launch-seed')).toBe('launch seed')
    // A clear branch under a held shwarm stays hidden with it.
    expect(await backLabel(env.DB, '/w/held-thing/a-branch')).toBe('where you were')
    expect(await backLabel(env.DB, '/w/nope')).toBe('where you were')
    expect(await backLabel(env.DB, '/w/%E0%A4%A')).toBe('where you were')
    expect(await backLabel(env.DB, '/rules')).toBe('where you were')
  })
})

describe('join → verify → back to the shwarm', () => {
  it('carries next through join, the verify mail and the verified page, then sign-in lands there', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    await shwarm(env, 'minecraft-in-doom', 'minecraft in doom')
    const b = new Browser(env)

    // the join page keeps next, and its "sign in" link carries it
    const joinPage = await body(await b.get('/join?next=%2Fw%2Fminecraft-in-doom'))
    expect(hidden(joinPage, 'next')).toBe('/w/minecraft-in-doom')
    expect(joinPage).toContain('href="/signin?next=%2Fw%2Fminecraft-in-doom"')

    // joining goes to check-email with the signed next
    let res = await b.post('/join', joinForm('newbie', 'newbie@example.org', { next: '/w/minecraft-in-doom' }))
    expect(res.status).toBe(303)
    const check = res.headers.get('location')!
    expect(check).toMatch(/^\/check-email\?n=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
    expect(await openNext(SECRET, new URL(check, 'https://x').searchParams.get('n'), 'check')).toBe('/w/minecraft-in-doom')

    // the verify link carries it, signed for that link's token
    const link = linkIn(env.DB, 'verify')
    const u = new URL(link, 'https://x')
    const t = u.searchParams.get('t')!
    expect(await openNext(SECRET, u.searchParams.get('n'), `verify:${t}`)).toBe('/w/minecraft-in-doom')
    expect(link).not.toContain('minecraft') // signed and encoded, not raw

    const verifyPage = await body(await b.get(link))
    expect(hidden(verifyPage, 'n')).toBe(u.searchParams.get('n'))
    res = await b.post('/verify', { t, n: u.searchParams.get('n')! })
    const verified = res.headers.get('location')!
    expect(verified).toMatch(/^\/verified\?n=/)

    // signed out after verifying: "sign in to go back to minecraft in doom"
    const page = await body(await b.get(verified))
    expect(page).toContain('<a href="/signin?next=%2Fw%2Fminecraft-in-doom">sign in</a> to go back to minecraft in doom.')

    // and signing in from there lands on the shwarm
    res = await b.post('/signin', { email: 'newbie@example.org', password: GOOD_PASSWORD, next: '/w/minecraft-in-doom' })
    expect(res.headers.get('location')).toBe('/w/minecraft-in-doom')
  })

  it('signed in when verifying: "back to <title>"', async () => {
    const env = testEnv()
    await shwarm(env, 'minecraft-in-doom', 'minecraft in doom')
    const id = await addPerson(env.DB, 'newbie', { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
    const b = new Browser(env)
    // unverified sign-in with next: check-email carries it
    let res = await b.post('/signin', { email: 'newbie@example.org', password: GOOD_PASSWORD, next: '/w/minecraft-in-doom' })
    const check = res.headers.get('location')!
    expect(check).toMatch(/^\/check-email\?n=/)
    const checkPage = await body(await b.get(check))
    const n = hidden(checkPage, 'n')!
    expect(await openNext(SECRET, n, 'check')).toBe('/w/minecraft-in-doom')

    // "send it again" puts it in the new verify link
    res = await b.post('/check-email', { n })
    expect(res.headers.get('location')).toBe(`/check-email?n=${n}&sent=1`)
    const link = linkIn(env.DB, 'verify')
    const u = new URL(link, 'https://x')
    expect(mails(env.DB).filter(m => m.person_id === id)).toHaveLength(1)

    res = await b.post('/verify', { t: u.searchParams.get('t')!, n: u.searchParams.get('n')! })
    const page = await body(await b.get(res.headers.get('location')!))
    expect(page).toContain('<a href="/w/minecraft-in-doom">back to minecraft in doom</a>')
  })

  it('without next, everything works as before', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const b = new Browser(env)
    const res = await b.post('/join', joinForm('newbie', 'newbie@example.org'))
    expect(res.headers.get('location')).toBe('/check-email')
    const link = linkIn(env.DB, 'verify')
    expect(link).toMatch(/^\/verify\?t=[A-Za-z0-9_-]{43}$/)
    const r = await b.post('/verify', { t: new URL(link, 'https://x').searchParams.get('t')! })
    expect(r.headers.get('location')).toBe('/verified')
    expect(await body(await b.get('/verified'))).toContain('<a href="/signin">sign in</a>')
  })
})

describe('open-redirect attempts', () => {
  it('drops an outside next on the join page and after joining', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    for (const [i, evil] of EVIL.entries()) {
      const b = new Browser(env, `198.51.${i}.7`) // a network each, under the sign-up throttle
      const page = await body(await b.get(`/join?next=${encodeURIComponent(evil)}`))
      expect(page, evil).not.toContain('evil.example')
      expect(page, evil).not.toContain('javascript:')
      const res = await b.post('/join', joinForm(`evil_${i}`, `evil${i}@example.org`, { next: evil }))
      expect(res.headers.get('location'), evil).toBe('/check-email')
    }
    for (const m of mails(env.DB)) expect(JSON.parse(m.payload).link).not.toContain('&n=')
  })

  it('ignores a forged, tampered or wrong-scope n on check-email, verify and verified', async () => {
    const env = testEnv()
    await setSignup(env.DB, 'open')
    const b = new Browser(env)
    await b.post('/join', joinForm('newbie', 'newbie@example.org', { next: '/w/minecraft-in-doom' }))
    const u = new URL(linkIn(env.DB, 'verify'), 'https://x')
    const t = u.searchParams.get('t')!
    const forged = `${toBase64url(utf8('//evil.example'))}.${'A'.repeat(43)}`
    const checkScoped = await signNext(SECRET, '/w/elsewhere', 'check')
    const otherToken = await signNext(SECRET, '/w/elsewhere', 'verify:not-this-token')

    // check-email shows no n for a bad one
    for (const n of [forged, otherToken, u.searchParams.get('n')!]) {
      expect(hidden(await body(await b.get(`/check-email?n=${encodeURIComponent(n)}`)), 'n'), n).toBeUndefined()
    }
    // the verify page drops an n that isn't for its token
    for (const n of [forged, checkScoped, otherToken]) {
      expect(hidden(await body(await b.get(`/verify?t=${t}&n=${encodeURIComponent(n)}`)), 'n'), n).toBeUndefined()
    }
    // verifying with a bad n lands on the plain verified page
    const res = await b.post('/verify', { t, n: checkScoped })
    expect(res.headers.get('location')).toBe('/verified')
    // the verified page ignores a bad n
    for (const n of [forged, checkScoped, otherToken]) {
      const page = await body(await b.get(`/verified?n=${encodeURIComponent(n)}`))
      expect(page, n).not.toContain('evil.example')
      expect(page, n).not.toContain('elsewhere')
      expect(page, n).not.toContain('go back to')
    }
  })

  it("a raw next on the verified page isn't trusted", async () => {
    const page = await body(await new Browser(testEnv()).get('/verified?next=%2Fw%2Fminecraft-in-doom&n=%2F%2Fevil.example'))
    expect(page).not.toContain('minecraft')
    expect(page).not.toContain('evil.example')
  })
})
