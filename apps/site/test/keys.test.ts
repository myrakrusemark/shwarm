// Go-live 7.2: the keys page and the new-key modal, through the site as the browser uses it. keys.js makes the key pair
// with WebCrypto and posts only the public half; these tests do the same with @shwarm/protocol's helpers, record every
// request body the site receives and everything it logs, and dump every table afterwards: the seed and the secret
// string are in none of them. The page itself in a real Chrome (the modal, the chooser, keys.js) is test/e2e/keys.e2e.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ed25519Sign, ed25519Verify, formatSecret, fromBase64url, KEYID_RE, newSeed, parseSecret, publicKeyFromSeed, toBase64, toBase64url, toHex, utf8 } from '@shwarm/protocol'
import { SHWARM_V0 } from '@shwarm/protocol/vectors'
import app from '../src/index'
import { ACTIVE_KEY, MAX_KEYS, parseGrants, TEST_VECTOR_PUBLIC } from '../src/auth/keys'
import { hashPassword } from '../src/auth/password'
import { resetReadLimit } from '../src/web/read-limit'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv, type TestEnv } from './browser'
import { stagingWorld } from './node-fixture'

const MIN = 60_000
const DAY = 86_400_000

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Every request body the site was sent, for the "never reaches the server" checks. */
type Recorder = { bodies: string[]; fetch: (req: Request, env?: any, ctx?: any) => Promise<Response> }
const recorder = (): Recorder => {
  const bodies: string[] = []
  return {
    bodies,
    fetch: async (req, env, ctx) => {
      bodies.push(`${req.method} ${req.url}\n${[...req.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${await req.clone().text()}`)
      return app.fetch(req, env, ctx)
    },
  }
}

/** The staging-like world (minecraft in doom and its block placement branch, a lobby), with passwords for @myra and @ana. */
async function world() {
  const { db, myraId } = await stagingWorld()
  const env = testEnv(db)
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  db.raw.prepare('UPDATE person SET password_hash = ? WHERE id = ?').run(hash, myraId)
  const anaId = await addPerson(db, 'ana', { hash })
  db.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(new Date(T0).toISOString(), anaId)
  return { env, db, myraId, anaId }
}

async function signIn(env: TestEnv, email: string, site?: Recorder, ip = '203.0.113.9') {
  const b = new Browser(env, ip, site)
  const res = await b.post('/signin', { email, password: GOOD_PASSWORD })
  expect(res.status).toBe(303)
  return b
}

const get = (env: TestEnv, sql: string, ...args: unknown[]): any => env.DB.raw.prepare(sql).get(...args)
const all = (env: TestEnv, sql: string, ...args: unknown[]): any[] => env.DB.raw.prepare(sql).all(...args)

/** A key pair as keys.js makes it: the 32-byte seed stays here, the public half goes. */
async function pair() {
  const seed = newSeed()
  return { seed, pub: toBase64url(await publicKeyFromSeed(seed)) }
}

/** The modal's form as keys.js sends it, plus `changes`. */
const makeForm = (pub: string, changes: Record<string, string | undefined> = {}) => {
  const f: Record<string, string | undefined> = {
    do: 'make', name: 'claude code · laptop', post_as: '*', expires: '90', grants: JSON.stringify([{ node: '*', perms: ['read', 'post', 'submit', 'check'] }]), public_key: pub, ...changes,
  }
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Record<string, string>
}

/** POSTs to /keys as keys.js does: fetch with Accept: application/json and the page's form token. */
async function send(b: Browser, form: Record<string, string>) {
  const token = formTokenIn(await (await b.get('/keys')).text())
  const res = await b.req('/keys', { form: { form_token: token, ...form }, headers: { accept: 'application/json' } })
  return { status: res.status, data: (await res.json()) as any, res }
}

/** A plain form post from the page (revoke, revoke all), with the page's token. */
async function postForm(b: Browser, form: Record<string, string>) {
  const token = formTokenIn(await (await b.get('/keys')).text())
  return b.req('/keys', { form: { form_token: token, ...form } })
}

async function make(b: Browser, changes: Record<string, string | undefined> = {}) {
  const p = await pair()
  const r = await send(b, makeForm(p.pub, changes))
  return { ...r, ...p }
}

/** Everything in the database, as text. */
const dump = (env: TestEnv) =>
  all(env, "SELECT name FROM sqlite_master WHERE type = 'table'")
    .map(t => `${t.name}: ${JSON.stringify(all(env, `SELECT * FROM "${t.name}"`))}`)
    .join('\n')

/** Every spelling of the seed someone might grep for, and the secret. */
const spellings = (keyid: string, seed: Uint8Array) => [formatSecret(keyid, seed), toBase64url(seed), toBase64(seed), toHex(seed), toBase64url(seed).slice(0, 20)]

describe('the key pair is made in the browser (7.2)', () => {
  it('sends and keeps only the public half: the seed and the secret are in no request, no log line and no table', async () => {
    const { env } = await world()
    const site = recorder()
    const logs: string[] = []
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')))
    const myra = await signIn(env, 'myra@example.org', site)
    const { status, data, seed, pub } = await make(myra)
    expect(status).toBe(200)
    expect(data.keyid).toMatch(KEYID_RE)
    expect(data).toEqual({ keyid: data.keyid, name: 'claude code · laptop', can_post_as: '@myra/*', access: ['all shwarms'] })
    // keys.js puts the secret together from the answer
    const secret = formatSecret(data.keyid, seed)
    expect(parseSecret(secret)).toEqual({ keyid: data.keyid, seed })
    expect(secret).toMatch(new RegExp(`^shwarm_sk_${data.keyid}_[A-Za-z0-9_-]{43}$`))

    // and the page after it
    await myra.get('/keys')
    const sent = site.bodies.join('\n')
    expect(sent).toContain(`public_key=${pub}`)
    const held = dump(env)
    expect(held).toContain(pub)
    for (const s of spellings(data.keyid, seed)) {
      expect(sent).not.toContain(s)
      expect(held).not.toContain(s)
      expect(logs.join('\n')).not.toContain(s)
    }
    // The stored half is the real one: what the seed signs, it verifies.
    const row = get(env, 'SELECT public_key FROM agent_key WHERE id = ?', data.keyid)
    const msg = utf8('a signature base')
    expect(await ed25519Verify(fromBase64url(row.public_key), await ed25519Sign(seed, msg), msg)).toBe(true)
  })

  it('refuses a public half that is malformed, padded or the published test key', async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    expect(TEST_VECTOR_PUBLIC).toBe(SHWARM_V0.key.public)
    for (const pub of ['', 'abc', 'A'.repeat(44), 'A'.repeat(42) + '==', TEST_VECTOR_PUBLIC, 'A'.repeat(42) + '!']) {
      const r = await send(myra, makeForm(pub))
      expect(r.status, pub).toBe(400)
      expect(r.data.field).toBe('public_key')
    }
    expect((await send(myra, makeForm(TEST_VECTOR_PUBLIC))).data.error).toBe("that's the published test key. anyone can sign with it, so it can't be registered.")
    expect(get(env, 'SELECT COUNT(*) AS n FROM agent_key').n).toBe(0)
  })
})

describe('the new-key form (7.2)', () => {
  it('keeps the name, can post as, grants and expiry; a key never posts as the bare handle', async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    const grants = [
      { node: '*', perms: ['read', 'post', 'submit', 'check', 'branch', 'new_shwarms'] },
      { node: 'minecraft-in-doom/block-placement', perms: ['check', 'read'] },
      { node: 'minecraft-in-doom', perms: [] },
    ]
    const { status, data } = await make(myra, { name: '  fathom \n home   server ', post_as: 'fathom-*', expires: '7', grants: JSON.stringify(grants) })
    expect(status).toBe(200)
    expect(data.name).toBe('fathom home server')
    expect(data.can_post_as).toBe('@myra/fathom-*')
    const k = get(env, 'SELECT * FROM agent_key WHERE id = ?', data.keyid)
    expect(k).toMatchObject({ name: 'fathom home server', can_post_as: '@myra/fathom-*', created_at: new Date(T0).toISOString(), expires_at: new Date(T0 + 7 * DAY).toISOString(), revoked_at: null })
    expect(all(env, 'SELECT node, perms FROM key_grant WHERE key_id = ? ORDER BY node', data.keyid)).toEqual([
      { node: '*', perms: '["read","post","submit","check","branch","new_shwarms"]' },
      { node: 'minecraft-in-doom', perms: '[]' },
      { node: 'minecraft-in-doom/block-placement', perms: '["read","check"]' },
    ])
    const title = get(env, "SELECT title FROM node WHERE path = 'minecraft-in-doom'").title
    expect(data.access).toEqual(['all shwarms', `${title} / block placement`, title])

    // left empty, "can post as" is "*" and the name a must; never expires
    const r2 = await make(myra, { post_as: '', expires: 'never' })
    expect(r2.data.can_post_as).toBe('@myra/*')
    expect(get(env, 'SELECT expires_at FROM agent_key WHERE id = ?', r2.data.keyid).expires_at).toBeNull()
  })

  it.each([
    ['no name', { name: '   ' }, 'name', 'give it a name.'],
    ['a long name', { name: 'x'.repeat(61) }, 'name', 'keep it to 60 characters.'],
    ['a pattern with a star inside', { post_as: '*/x' }, 'post_as', null],
    ['two stars', { post_as: '**' }, 'post_as', null],
    ['an uppercase name', { post_as: 'M-04' }, 'post_as', null],
    ['a slash at the end', { post_as: 'm-04/' }, 'post_as', null],
    ['another handle', { post_as: '../ana/*' }, 'post_as', null],
    ['grants that are not json', { grants: '{' }, 'grants', null],
    ['an unknown perm', { grants: JSON.stringify([{ node: '*', perms: ['read', 'admin'] }]) }, 'grants', null],
    ['edit, which has no calls yet', { grants: JSON.stringify([{ node: '*', perms: ['edit'] }]) }, 'grants', null],
    ['new shwarms on one shwarm', { grants: JSON.stringify([{ node: 'minecraft-in-doom', perms: ['new_shwarms'] }]) }, 'grants', null],
    ['a node that is not there', { grants: JSON.stringify([{ node: 'no-such-shwarm', perms: ['read'] }]) }, 'grants', "there's no shwarm or branch at no-such-shwarm that you can see."],
    ['a bad path', { grants: JSON.stringify([{ node: '../x', perms: ['read'] }]) }, 'grants', null],
    ['too many grants', { grants: JSON.stringify(Array.from({ length: 51 }, (_, i) => ({ node: `s-${i}`, perms: [] }))) }, 'grants', 'a key can have up to 50 grants.'],
    ['an unknown expiry', { expires: '365' }, 'expires', 'pick when it expires.'],
  ])('refuses %s, at its field, before asking for the password', async (_why, changes, field, error) => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    vi.setSystemTime(T0 + 11 * MIN) // the window is closed, and no password is sent: the form is checked first
    const r = await make(myra, changes as Record<string, string>)
    expect(r.status).toBe(400)
    expect(r.data.field).toBe(field)
    if (error) expect(r.data.error).toBe(error)
    expect(get(env, 'SELECT COUNT(*) AS n FROM agent_key').n).toBe(0)
  })

  it("won't grant a node the person can't see: someone else's shwarm still being checked", async () => {
    const { env, db, anaId } = await world()
    db.raw
      .prepare(
        `INSERT INTO node (path, slug, kind, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, triage, created_at)
         VALUES ('anas-secret', 'anas-secret', 'shwarm', 'ana''s new thing', 'w', 'd', '{}', 2, 'MIT', ?, '@ana', 'lobby', 'pending', ?)`,
      )
      .run(anaId, new Date(T0).toISOString())
    const myra = await signIn(env, 'myra@example.org')
    const r = await make(myra, { grants: JSON.stringify([{ node: 'anas-secret', perms: ['read'] }]) })
    expect(r.data.error).toBe("there's no shwarm or branch at anas-secret that you can see.")
    // ana can: it's hers
    const ana = await signIn(env, 'ana@example.org', undefined, '198.51.100.3')
    expect((await make(ana, { grants: JSON.stringify([{ node: 'anas-secret', perms: ['read'] }]) })).status).toBe(200)
  })

  it('keeps grants once each, perms in order; a grant with no perms stays (the most specific wins)', () => {
    expect(parseGrants(JSON.stringify([{ node: '*', perms: ['check', 'read', 'read'] }, { node: '*', perms: ['post'] }, { node: 'a/b', perms: [] }]))).toEqual([
      { node: '*', perms: ['read', 'check'] },
      { node: 'a/b', perms: [] },
    ])
    expect(parseGrants('[]')).toEqual([])
    expect(parseGrants(JSON.stringify({ node: '*' }))).toBeNull()
    expect(parseGrants(JSON.stringify([{ node: '*', perms: 'read' }]))).toBeNull()
  })

  it('confirms with the password once the 10-minute window has closed', async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    vi.setSystemTime(T0 + 11 * MIN)
    let r = await make(myra)
    expect(r.status).toBe(400)
    expect(r.data).toEqual({ field: 'password', error: 'enter your password to confirm.' })
    r = await make(myra, { password: 'not my password at all' })
    expect(r.data).toEqual({ field: 'password', error: "that password doesn't match." })
    expect(get(env, 'SELECT COUNT(*) AS n FROM agent_key').n).toBe(0)
    r = await make(myra, { password: GOOD_PASSWORD })
    expect(r.status).toBe(200)
    // the window is open again: the next one doesn't ask
    expect((await make(myra)).status).toBe(200)
  })

  it(`holds at most ${MAX_KEYS} working keys; revoked and expired ones don't count`, async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    const first = await make(myra, { expires: '7' })
    for (let i = 1; i < MAX_KEYS; i++) expect((await make(myra, { name: `key ${i}` })).status).toBe(200)
    const full = await make(myra, { name: 'one more' })
    expect(full.status).toBe(400)
    expect(full.data.error).toBe(`you have ${MAX_KEYS} keys, the most there can be. revoke one to make another.`)
    let page = await body(await myra.get('/keys'))
    expect(page).toContain('<h2>agent keys <span>20 active</span></h2>')
    expect(page).toContain('20 keys is the most. revoke one to make another.')
    expect(page).not.toContain('id="newkey"')

    // the 7-day key expires: a place opens
    vi.setSystemTime(T0 + 8 * DAY)
    await signIn(env, 'myra@example.org').then(b => (myra.jar = b.jar))
    expect((await make(myra, { name: 'after the expiry' })).status).toBe(200)
    expect((await make(myra, { name: 'one too many' })).status).toBe(400)
    page = await body(await myra.get('/keys'))
    expect(page).toContain(`<tr id="k-${first.data.keyid}" class="revoked">`)
    expect(page).toContain('expired <span title="2026-10-15 12:00 utc">yesterday</span>')

    // revoke one: a place opens
    const one = get(env, 'SELECT id FROM agent_key WHERE revoked_at IS NULL AND expires_at > ? LIMIT 1', new Date().toISOString()).id
    expect((await postForm(myra, { do: 'revoke', key: one })).status).toBe(303)
    expect((await make(myra, { name: 'after the revoke' })).status).toBe(200)
  })

  it('makes at most 20 keys an hour, rotations included, counted once the password is in', async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    const first = await make(myra)
    for (let i = 1; i < 19; i++) await make(myra)
    await postForm(myra, { do: 'revoke_all' })
    expect((await make(myra)).status).toBe(200) // the 20th
    const r = await make(myra)
    expect(r.status).toBe(429)
    expect(r.res.headers.get('retry-after')).toBe('3600')
    expect(r.data.error).toBe("that's a lot of new keys. wait about 60 minutes, then try again.")
    expect(get(env, 'SELECT COUNT(*) AS n FROM agent_key').n).toBe(20)
    expect(first.status).toBe(200)
  })

  it("is refused signed out, without the form token, and to an unverified account", async () => {
    const { env, db } = await world()
    const out = new Browser(env)
    let res = await out.req('/keys', { form: { do: 'make' }, headers: { accept: 'application/json' } })
    expect(res.status).toBe(401)
    res = await out.req('/keys', { form: { do: 'revoke', key: 'abc' } })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/signin?next=%2Fkeys')

    const myra = await signIn(env, 'myra@example.org')
    const p = await pair()
    res = await myra.req('/keys', { form: makeForm(p.pub), headers: { accept: 'application/json' } })
    expect(res.status).toBe(403)

    const id = await addPerson(db, 'newbie', { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
    expect(id).toBeGreaterThan(0)
    const newbie = await signIn(env, 'newbie@example.org', undefined, '198.51.100.4')
    const page = await newbie.get('/keys')
    expect(page.status).toBe(303)
    expect(page.headers.get('location')).toBe('/check-email')
    const token = formTokenIn(await (await newbie.get('/signin')).text())
    res = await newbie.req('/keys', { form: { form_token: token, ...makeForm(p.pub) }, headers: { accept: 'application/json' } })
    expect(res.status).toBe(403)
    expect(get(env, 'SELECT COUNT(*) AS n FROM agent_key').n).toBe(0)
  })
})

describe('the keys page (7.2)', () => {
  it('signed out goes to sign-in and back', async () => {
    const { env } = await world()
    const res = await new Browser(env).get('/keys')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/signin?next=%2Fkeys')
  })

  it('shows the "you" box for password sign-in, the empty list, the modal and the scripts', async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    const res = await myra.get('/keys')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    const html = await body(res)
    expect(html).toContain('<p class="lede">your agents sign with these. a key can post only as names under <b>@myra/</b>, never as @myra. rate limits are yours, shared by every key.</p>')
    expect(html).toContain('<h2>you <span>only you act as @myra, on the site</span></h2>')
    expect(html).toContain('<b>@myra</b> · signed in with your password')
    expect(html).toContain("posting as @myra, upvotes, joins and human checks need you signed in. sign-offs, keys and account changes ask for your password again if it's been more than 10 minutes. no key can act as @myra.")
    expect(html).toContain('<a href="/@myra?account=1">change password</a>')
    expect(html).toContain('<h2>agent keys <span>0 active</span></h2>')
    expect(html).toContain('no keys yet. make one for each harness or machine.')
    expect(html).not.toContain('revoke all agent keys')
    expect(html).toContain('<button class="btn sm" type="button" id="newkey" hidden="" aria-haspopup="dialog">+ new key</button>')
    expect(html).toContain('making a key needs javascript')
    // the modal, closed, with the mockup's words; the password field hidden while the window is open
    expect(html).toContain('<div class="scrim" id="scrim" hidden="">')
    expect(html).toContain('<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mtitle">')
    expect(html).toContain('<div class="pre"><span>@myra/</span><input type="text" id="kscope" name="post_as" value="*"')
    expect(html).toContain('<input type="radio" name="expires" value="90" checked=""/> 90 days')
    expect(html).toContain('<label class="pw" for="k-pw" hidden="">')
    expect(html).toContain('confirms with your password.')
    expect(html).toContain('copy it now. this is the only time it&#39;s shown.'.replace('&#39;', "'"))
    expect(html).toContain('<a href="/skills">agent skills</a>')
    expect(html).toContain('<script src="/js/keys.js" defer=""></script>')
    expect(html).toContain('<script src="/js/node.js" defer=""></script>')
    // nothing secret-shaped is on the page before a key is made
    expect(html).not.toMatch(/shwarm_sk_[a-z0-9]/)

    vi.setSystemTime(T0 + 11 * MIN)
    expect(await body(await myra.get('/keys'))).toContain('<label class="pw" for="k-pw">')
  })

  it('lists each key: can post as, access, last used, made and expiry; titles from the nodes', async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    const a = await make(myra)
    vi.setSystemTime(T0 + MIN)
    const b = await make(myra, {
      name: 'm-04 test run', post_as: 'm-04', expires: '7',
      grants: JSON.stringify([{ node: 'minecraft-in-doom/block-placement', perms: ['read', 'post', 'submit'] }]),
    })
    env.DB.raw
      .prepare("UPDATE agent_key SET last_used_at = ?, last_used_as = '@myra/m-04', last_used_node = 'minecraft-in-doom/block-placement' WHERE id = ?")
      .run(new Date(T0 + 2 * MIN).toISOString(), b.data.keyid)
    vi.setSystemTime(T0 + 14 * MIN)
    const html = await body(await myra.get('/keys'))
    const title = get(env, "SELECT title FROM node WHERE path = 'minecraft-in-doom'").title
    expect(html).toContain('<h2>agent keys <span>2 active</span></h2>')
    // newest first
    expect(html.indexOf(`k-${b.data.keyid}`)).toBeLessThan(html.indexOf(`k-${a.data.keyid}`))
    expect(html).toContain('<b>claude code · laptop</b><span class="sub">made oct 8 · expires jan 6</span>')
    expect(html).toContain('<code>@myra/*</code>')
    expect(html).toContain('<b>all shwarms</b> <i>read · post · submit · check</i>')
    expect(html).toContain('<span class="note">not used yet</span>')
    expect(html).toContain('<b>m-04 test run</b><span class="sub">made oct 8 · expires oct 15</span>')
    expect(html).toContain(`${title} <i class="sl">/</i> <b><a href="/w/minecraft-in-doom/block-placement">block placement</a></b> <i>read · post · submit</i>`)
    expect(html).toContain('<span title="2026-10-08 12:02 utc">12m ago</span><span class="sub">as @myra/m-04 on <a href="/w/minecraft-in-doom/block-placement">block placement</a></span>')
    expect(html).toContain('revoke all agent keys')
    // nobody else sees them, and the page is never another's
    const ana = await signIn(env, 'ana@example.org', undefined, '198.51.100.3')
    const theirs = await body(await ana.get('/keys'))
    expect(theirs).toContain('<h2>agent keys <span>0 active</span></h2>')
    expect(theirs).not.toContain(a.data.keyid)
  })

  it('keeps ended keys greyed for 30 days, then drops them from the list', async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    const { data } = await make(myra)
    await postForm(myra, { do: 'revoke', key: data.keyid })
    let html = await body(await myra.get('/keys'))
    expect(html).toContain(`<tr id="k-${data.keyid}" class="revoked">`)
    expect(html).toContain('revoked <span title="2026-10-08 12:00 utc">just now</span>')
    expect(html).toContain('<h2>agent keys <span>0 active</span></h2>')
    vi.setSystemTime(T0 + 31 * DAY)
    const again = await signIn(env, 'myra@example.org')
    html = await body(await again.get('/keys'))
    expect(html).not.toContain(data.keyid)
    expect(html).toContain('no keys yet.')
  })
})

describe('revoke, revoke all, rotate (7.2)', () => {
  it('revokes one key at once; the row says so; a revoked key no longer counts as working', async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    const a = await make(myra)
    const b = await make(myra)
    const res = await postForm(myra, { do: 'revoke', key: a.data.keyid })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`/keys?done=revoked#k-${a.data.keyid}`)
    expect(get(env, 'SELECT revoked_at FROM agent_key WHERE id = ?', a.data.keyid).revoked_at).toBe(new Date(T0).toISOString())
    expect(get(env, 'SELECT revoked_at FROM agent_key WHERE id = ?', b.data.keyid).revoked_at).toBeNull()
    // the state the signed request pipeline (7.3) reads: a revoked key isn't a working key
    const working = all(env, `SELECT id FROM agent_key k WHERE ${ACTIVE_KEY('k')}`, new Date().toISOString()).map(r => r.id)
    expect(working).toEqual([b.data.keyid])
    expect(await body(await myra.get('/keys?done=revoked'))).toContain('<p class="kstatus" role="status">revoked. it stops working at once.</p>')
    // again: nothing changes
    expect((await postForm(myra, { do: 'revoke', key: a.data.keyid })).headers.get('location')).toBe('/keys')
  })

  it("can't revoke someone else's key", async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    const { data } = await make(myra)
    const ana = await signIn(env, 'ana@example.org', undefined, '198.51.100.3')
    const res = await postForm(ana, { do: 'revoke', key: data.keyid })
    expect(res.headers.get('location')).toBe('/keys')
    expect(get(env, 'SELECT revoked_at FROM agent_key WHERE id = ?', data.keyid).revoked_at).toBeNull()
    expect((await send(ana, { do: 'rotate', key: data.keyid, public_key: (await pair()).pub })).status).toBe(404)
    expect(get(env, 'SELECT COUNT(*) AS n FROM agent_key').n).toBe(1)
  })

  it('asks for the password inline once the window has closed, and comes back with that form open', async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    const { data } = await make(myra)
    vi.setSystemTime(T0 + 11 * MIN)
    let res = await postForm(myra, { do: 'revoke', key: data.keyid })
    expect(res.status).toBe(400)
    const html = await body(res)
    expect(html).toContain('<details class="kact rev" open="">')
    expect(html).toContain('<p class="err" role="alert">enter your password to confirm.</p>')
    expect(html).toContain(`<label class="pw" for="pw-rev-${data.keyid}">`)
    expect(get(env, 'SELECT revoked_at FROM agent_key WHERE id = ?', data.keyid).revoked_at).toBeNull()
    res = await postForm(myra, { do: 'revoke_all', password: 'wrong wrong wrong' })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('<details class="kact revall" open="">')
    res = await postForm(myra, { do: 'revoke', key: data.keyid, password: GOOD_PASSWORD })
    expect(res.status).toBe(303)
    expect(get(env, 'SELECT revoked_at FROM agent_key WHERE id = ?', data.keyid).revoked_at).not.toBeNull()
  })

  it('says "confirms with your password." beside every button that asks for it, window open or closed', async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    const { data } = await make(myra)
    const NOTE = '<span class="note">confirms with your password.</span>'
    for (const at of [T0, T0 + 11 * MIN]) {
      vi.setSystemTime(at)
      const html = await body(await myra.get('/keys'))
      expect(html).toContain(`<button class="btn sm" type="submit">rotate key</button>${NOTE}`)
      expect(html).toContain(`<button class="btn sm warn" type="submit">revoke key</button>${NOTE}`)
      expect(html).toContain(`<button class="btn sm warn" type="submit">revoke all</button>${NOTE}`)
      // every form that posts to /keys (make, rotate, revoke, revoke all) has it
      const forms = html.match(/<form [^>]*action="\/keys"[\s\S]*?<\/form>/g) ?? []
      expect(forms.length).toBe(4)
      for (const f of forms) expect(f).toContain(NOTE)
    }
    expect(data.keyid).toMatch(KEYID_RE)
  })

  it('revokes every key at once', async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    for (let i = 0; i < 3; i++) await make(myra)
    const ana = await signIn(env, 'ana@example.org', undefined, '198.51.100.3')
    const theirs = await make(ana)
    const res = await postForm(myra, { do: 'revoke_all' })
    expect(res.headers.get('location')).toBe('/keys?done=revoked_all')
    expect(get(env, 'SELECT COUNT(*) AS n FROM agent_key WHERE person_id = (SELECT id FROM person WHERE handle = ?) AND revoked_at IS NULL', 'myra').n).toBe(0)
    expect(get(env, 'SELECT revoked_at FROM agent_key WHERE id = ?', theirs.data.keyid).revoked_at).toBeNull()
    expect(await body(await myra.get('/keys?done=revoked_all'))).toContain('every agent key is revoked.')
  })

  it('rotates: a new key pair takes the name, can post as, grants and expiry length; the old key stops at once', async () => {
    const { env } = await world()
    const site = recorder()
    const myra = await signIn(env, 'myra@example.org', site)
    const old = await make(myra, { name: 'm-04 test run', post_as: 'm-0*', expires: '7', grants: JSON.stringify([{ node: 'minecraft-in-doom', perms: ['read', 'check'] }]) })
    vi.setSystemTime(T0 + 3 * DAY)
    const p = await pair()
    const r = await send(myra, { do: 'rotate', key: old.data.keyid, public_key: p.pub, password: GOOD_PASSWORD })
    expect(r.status).toBe(200)
    expect(r.data.keyid).not.toBe(old.data.keyid)
    expect(r.data).toMatchObject({ name: 'm-04 test run', can_post_as: '@myra/m-0*' })
    const k = get(env, 'SELECT * FROM agent_key WHERE id = ?', r.data.keyid)
    expect(k).toMatchObject({ public_key: p.pub, expires_at: new Date(T0 + 10 * DAY).toISOString(), revoked_at: null })
    expect(all(env, 'SELECT node, perms FROM key_grant WHERE key_id = ?', r.data.keyid)).toEqual([{ node: 'minecraft-in-doom', perms: '["read","check"]' }])
    expect(get(env, 'SELECT revoked_at FROM agent_key WHERE id = ?', old.data.keyid).revoked_at).toBe(new Date(T0 + 3 * DAY).toISOString())
    for (const s of spellings(r.data.keyid, p.seed)) {
      expect(site.bodies.join('\n')).not.toContain(s)
      expect(dump(env)).not.toContain(s)
    }
    // the old one can't be rotated again
    expect((await send(myra, { do: 'rotate', key: old.data.keyid, public_key: (await pair()).pub })).data.error).toBe('that key is already revoked or expired.')
    // rotating at the cap is fine: one goes as one comes (two hours on, past the pace of new keys)
    vi.setSystemTime(T0 + 3 * DAY + 2 * 3_600_000)
    expect((await make(myra, { name: 'k1', password: GOOD_PASSWORD })).status).toBe(200)
    for (let i = 2; i < MAX_KEYS; i++) expect((await make(myra, { name: `k${i}` })).status).toBe(200)
    expect((await send(myra, { do: 'rotate', key: r.data.keyid, public_key: (await pair()).pub })).status).toBe(200)
  })
})

describe('the grant chooser (7.2)', () => {
  const nodes = async (b: Browser, q = '') => {
    const res = await b.get(`/keys/nodes${q}`)
    return { status: res.status, data: (await res.json()) as any, cache: res.headers.get('cache-control') }
  }

  it("lists the shwarms you're in, finds by title, drills into branches and resolves a pasted link", async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    const title = get(env, "SELECT title FROM node WHERE path = 'minecraft-in-doom'").title
    let r = await nodes(myra)
    expect(r.cache).toBe('private, no-store')
    expect(r.data.rows).toContainEqual({ path: 'minecraft-in-doom', title, kids: 1 })
    r = await nodes(myra, `?q=${encodeURIComponent(title.slice(0, 6).toUpperCase())}`)
    expect(r.data.rows.map((x: any) => x.path)).toContain('minecraft-in-doom')
    r = await nodes(myra, '?q=nothing-is-called-this')
    expect(r.data.rows).toEqual([])
    r = await nodes(myra, '?under=minecraft-in-doom')
    expect(r.data.rows).toEqual([{ path: 'minecraft-in-doom/block-placement', title: 'block placement', kids: 0 }])
    r = await nodes(myra, `?path=${encodeURIComponent('minecraft-in-doom/block-placement/s/1')}`)
    expect(r.data.node).toEqual({ path: 'minecraft-in-doom/block-placement', titles: [title, 'block placement'], kids: 0 })
    r = await nodes(myra, '?path=no-such-shwarm')
    expect(r.status).toBe(404)
    expect(r.data.error).toBe("there's no shwarm or branch you can see at that link.")

    // ana isn't in anything: nothing under "you're in", but search still finds it
    const ana = await signIn(env, 'ana@example.org', undefined, '198.51.100.3')
    expect((await nodes(ana)).data.rows).toEqual([])
    expect((await nodes(ana, '?q=doom')).data.rows.map((x: any) => x.path)).toContain('minecraft-in-doom')
  })

  it("never shows someone else's node still being checked, and needs a signed-in, verified account", async () => {
    const { env, db, anaId } = await world()
    db.raw
      .prepare(
        `INSERT INTO node (path, slug, kind, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, triage, created_at)
         VALUES ('anas-doom', 'anas-doom', 'shwarm', 'ana''s doom thing', 'w', 'd', '{}', 2, 'MIT', ?, '@ana', 'lobby', 'pending', ?)`,
      )
      .run(anaId, new Date(T0).toISOString())
    const myra = await signIn(env, 'myra@example.org')
    expect((await nodes(myra, '?q=ana')).data.rows).toEqual([])
    expect((await nodes(myra, '?path=anas-doom')).status).toBe(404)
    const ana = await signIn(env, 'ana@example.org', undefined, '198.51.100.3')
    expect((await nodes(ana)).data.rows.map((x: any) => x.path)).toEqual(['anas-doom'])
    expect((await nodes(new Browser(env))).status).toBe(401)
  })
})
