// Go-live 7.17: the site's side of direct messages, through the site as the browser uses it. The keys page's
// "direct messages" box (turning names on and off, blocks), the new-key modal's dm box, and /dms (reading, report,
// block sender). The API's side is test/api.test.ts and core/dm.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newSeed, publicKeyFromSeed, toBase64url } from '@shwarm/protocol'
import { hashPassword } from '../src/auth/password'
import { DM_NAMES_MAX, sendDm, type Sender } from '../src/core/dm'
import { resetReadLimit } from '../src/web/read-limit'
import { dmNameOf } from '../src/web/keys'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, mails, pepper, testEnv, type TestEnv } from './browser'
import { stagingWorld } from './node-fixture'

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

/** The staging-like world, with passwords for @myra (founding) and @ana (verified, not founding). */
async function world() {
  const { db, myraId } = await stagingWorld()
  const env = testEnv(db)
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  db.raw.prepare('UPDATE person SET password_hash = ? WHERE id = ?').run(hash, myraId)
  const anaId = await addPerson(db, 'ana', { hash })
  db.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(new Date(T0).toISOString(), anaId)
  return { env, db, myraId, anaId }
}

async function signIn(env: TestEnv, email: string, ip = '203.0.113.9') {
  const b = new Browser(env, ip)
  const res = await b.post('/signin', { email, password: GOOD_PASSWORD })
  expect(res.status).toBe(303)
  return b
}

const get = (env: TestEnv, sql: string, ...args: unknown[]): any => env.DB.raw.prepare(sql).get(...args)
const all = (env: TestEnv, sql: string, ...args: unknown[]): any[] => env.DB.raw.prepare(sql).all(...args)

/** A plain form post from a page, with that page's token. */
async function postFrom(b: Browser, pagePath: string, action: string, form: Record<string, string>) {
  const token = formTokenIn(await (await b.get(pagePath)).text())
  return b.req(action, { form: { form_token: token, ...form } })
}
const keysForm = (b: Browser, form: Record<string, string>) => postFrom(b, '/keys', '/keys', form)
const dmsForm = (b: Browser, form: Record<string, string>) => postFrom(b, '/dms', '/dms', form)

/** POSTs the new-key modal's form as keys.js does. */
async function makeKey(b: Browser, extra: Record<string, string> = {}) {
  const pub = toBase64url(await publicKeyFromSeed(newSeed()))
  const token = formTokenIn(await (await b.get('/keys')).text())
  const form = { form_token: token, do: 'make', name: 'laptop', post_as: '*', expires: '90', grants: JSON.stringify([{ node: '*', perms: ['read'] }]), public_key: pub, ...extra }
  const res = await b.req('/keys', { form, headers: { accept: 'application/json' } })
  return { status: res.status, data: (await res.json()) as any }
}

const sender = (personId: number, handle: string, as: string): Sender => ({ personId, handle, as, keyId: null, canPostAs: `@${handle}/*`, dmPerm: true })

describe('the dm permission in the new-key modal (7.17)', () => {
  it('is off by default, stored when ticked, shown on the row, and kept on rotate', async () => {
    const { env } = await world()
    const myra = await signIn(env, 'myra@example.org')
    const html = await body(await myra.get('/keys'))
    expect(html).toMatch(/<input type="checkbox" id="kdm" name="dm" value="1"[^>]*>/)
    expect(html).not.toMatch(/id="kdm"[^>]*checked/)

    const off = await makeKey(myra, { name: 'plain' })
    expect(off.status).toBe(200)
    expect(get(env, 'SELECT dm FROM agent_key WHERE id = ?', off.data.keyid).dm).toBe(0)
    const on = await makeKey(myra, { name: 'messenger', dm: '1' })
    expect(on.status).toBe(200)
    expect(get(env, 'SELECT dm FROM agent_key WHERE id = ?', on.data.keyid).dm).toBe(1)
    // keys.js sends "0" when the box is clear
    const zero = await makeKey(myra, { name: 'zero', dm: '0' })
    expect(get(env, 'SELECT dm FROM agent_key WHERE id = ?', zero.data.keyid).dm).toBe(0)

    const page = await body(await myra.get('/keys'))
    const row = (id: string) => page.slice(page.indexOf(`id="k-${id}"`), page.indexOf('</tr>', page.indexOf(`id="k-${id}"`)))
    expect(row(on.data.keyid)).toContain('direct messages')
    expect(row(off.data.keyid)).not.toContain('direct messages')

    const pub = toBase64url(await publicKeyFromSeed(newSeed()))
    const token = formTokenIn(await (await myra.get('/keys')).text())
    const res = await myra.req('/keys', { form: { form_token: token, do: 'rotate', key: on.data.keyid, public_key: pub }, headers: { accept: 'application/json' } })
    expect(res.status).toBe(200)
    const rotated = ((await res.json()) as any).keyid
    expect(get(env, 'SELECT dm FROM agent_key WHERE id = ?', rotated).dm).toBe(1)
    const pub2 = toBase64url(await publicKeyFromSeed(newSeed()))
    const r2 = await myra.req('/keys', { form: { form_token: token, do: 'rotate', key: off.data.keyid, public_key: pub2 }, headers: { accept: 'application/json' } })
    expect(get(env, 'SELECT dm FROM agent_key WHERE id = ?', ((await r2.json()) as any).keyid).dm).toBe(0)
  })
})

describe('the direct messages box on the keys page (7.17)', () => {
  it('turns a name on and off, with no password, and lists it', async () => {
    const { env, myraId } = await world()
    const myra = await signIn(env, 'myra@example.org')
    let html = await body(await myra.get('/keys'))
    expect(html).toContain('id="dms"')
    expect(html).toContain('off for every name.')
    expect(html).toContain('href="/dms"')

    // Past the 10-minute window: no password asked.
    vi.setSystemTime(T0 + 60 * 60_000)
    let res = await keysForm(myra, { do: 'dm_on', name: 'fathom' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/keys?done=dm_on#dms')
    // the full name works too
    res = await keysForm(myra, { do: 'dm_on', name: '@myra/scout/a1' })
    expect(res.status).toBe(303)
    expect(all(env, 'SELECT name FROM dm_name WHERE person_id = ? ORDER BY name', myraId).map(r => r.name)).toEqual(['@myra/fathom', '@myra/scout/a1'])
    html = await body(await myra.get('/keys?done=dm_on'))
    expect(html).toContain('direct messages are on for that name.')
    expect(html).toContain('<code>@myra/fathom</code>')
    expect(html).toContain('on for 2 names')

    res = await keysForm(myra, { do: 'dm_off', name: '@myra/fathom' })
    expect(res.headers.get('location')).toBe('/keys?done=dm_off#dms')
    expect(all(env, 'SELECT name FROM dm_name WHERE person_id = ?', myraId).map(r => r.name)).toEqual(['@myra/scout/a1'])
  })

  it('refuses a bad name on the page, and stops at the most names', async () => {
    const { env, myraId } = await world()
    const myra = await signIn(env, 'myra@example.org')
    for (const bad of ['', 'fa thom', 'fathom/*', '@ana/fathom', '<b>x</b>']) {
      const res = await keysForm(myra, { do: 'dm_on', name: bad })
      expect(res.status).toBe(400)
      const html = await body(res)
      expect(html).toContain("that isn't an agent name")
      expect(html).not.toContain('<b>x</b>')
    }
    expect(get(env, 'SELECT COUNT(*) AS n FROM dm_name').n).toBe(0)
    expect(dmNameOf('myra', '@myra/fathom')).toBe('@myra/fathom')
    expect(dmNameOf('myra', '@myra')).toBe(null)

    const t = new Date(T0).toISOString()
    for (let i = 0; i < DM_NAMES_MAX; i++) env.DB.raw.prepare('INSERT INTO dm_name (person_id, name, created_at) VALUES (?, ?, ?)').run(myraId, `@myra/n${i}`, t)
    expect(await body(await myra.get('/keys'))).toContain(`${DM_NAMES_MAX} names is the most`)
    const res = await keysForm(myra, { do: 'dm_on', name: 'one-more' })
    expect(res.status).toBe(400)
    expect(get(env, 'SELECT COUNT(*) AS n FROM dm_name WHERE person_id = ?', myraId).n).toBe(DM_NAMES_MAX)
  })

  it('in the beta, someone not invited sees the box but cannot turn a name on', async () => {
    const { env } = await world()
    env.SITE_MODE = 'beta'
    const ana = await signIn(env, 'ana@example.org')
    const html = await body(await ana.get('/keys'))
    expect(html).toContain('turning on direct messages opens soon.')
    expect(html).not.toContain('name="do" value="dm_on"')
    const res = await keysForm(ana, { do: 'dm_on', name: 'bot' })
    expect(res.status).toBe(403)
    expect(get(env, 'SELECT COUNT(*) AS n FROM dm_name').n).toBe(0)
    // a member can
    const myra = await signIn(env, 'myra@example.org', '198.51.100.7')
    expect((await keysForm(myra, { do: 'dm_on', name: 'bot' })).status).toBe(303)
  })

  it('is refused signed out and without the form token', async () => {
    const { env } = await world()
    const out = new Browser(env)
    const res = await out.req('/keys', { form: { do: 'dm_on', name: 'x' } })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/signin?next=%2Fkeys')
    const myra = await signIn(env, 'myra@example.org')
    expect((await myra.req('/keys', { form: { do: 'dm_on', name: 'x' } })).status).toBe(403)
    expect(get(env, 'SELECT COUNT(*) AS n FROM dm_name').n).toBe(0)
  })
})

describe('/dms (7.17)', () => {
  async function talking() {
    const w = await world()
    const t = new Date(T0).toISOString()
    for (const [id, name] of [[w.myraId, '@myra/fathom'], [w.anaId, '@ana/bot']] as const)
      w.env.DB.raw.prepare('INSERT INTO dm_name (person_id, name, created_at) VALUES (?, ?, ?)').run(id, name, t)
    const inbound = await sendDm(w.db, sender(w.anaId, 'ana', '@ana/bot'), '@myra/fathom', 'hi <script>alert(1)</script>\nsecond line', { beta: false })
    const outbound = await sendDm(w.db, sender(w.myraId, 'myra', '@myra/fathom'), '@ana/bot', 'hello back', { beta: false })
    return { ...w, inbound: inbound.dm, outbound: outbound.dm }
  }

  it('signed out goes to sign-in and back', async () => {
    const { env } = await world()
    const res = await new Browser(env).get('/dms')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/signin?next=%2Fdms')
  })

  it('lists the DMs newest first, as plain text, never cached or indexed; report and block only on ones to you', async () => {
    const { env, inbound, outbound } = await talking()
    const myra = await signIn(env, 'myra@example.org')
    const res = await myra.get('/dms')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('x-robots-tag')).toContain('noindex')
    const raw = await res.text()
    expect(raw).not.toContain('<script>alert(1)</script>')
    expect(raw).toContain('&lt;script&gt;')
    expect(raw.indexOf(`id="d-${outbound.id}"`)).toBeLessThan(raw.indexOf(`id="d-${inbound.id}"`))
    const item = (id: string) => raw.slice(raw.indexOf(`id="d-${id}"`), raw.indexOf('</li>', raw.indexOf(`id="d-${id}"`)))
    expect(item(inbound.id)).toContain('value="report"')
    expect(item(inbound.id)).toContain('block sender')
    expect(item(outbound.id)).not.toContain('value="report"')
    // ana sees the same two, from her side
    const ana = await signIn(env, 'ana@example.org', '198.51.100.8')
    const hers = await body(await ana.get('/dms'))
    expect(hers).toContain('hello back')
    expect(hers).toContain('second line')
  })

  it('pages 50 at a time with an older link', async () => {
    const { env, db, myraId, anaId } = await talking()
    for (let i = 0; i < 50; i++) {
      vi.setSystemTime(T0 + (i + 1) * 1000)
      await sendDm(db, sender(anaId, 'ana', '@ana/bot'), '@myra/fathom', `note ${i}`, { beta: false })
    }
    expect(myraId).toBeGreaterThan(0)
    const myra = await signIn(env, 'myra@example.org')
    const first = await body(await myra.get('/dms'))
    expect(first).toContain('note 49')
    expect(first).not.toContain('hello back')
    const older = /href="\/dms\?before=(d_[a-z0-9]+)"/.exec(first)
    expect(older).not.toBeNull()
    const second = await body(await myra.get(`/dms?before=${older![1]}`))
    expect(second).toContain('hello back')
    expect(second).not.toContain('note 49')
  })

  it('reports a DM to the operator and blocks its sender for every name', async () => {
    const { env, db, myraId, anaId, inbound, outbound } = await talking()
    const op = await addPerson(env.DB, 'op')
    env.DB.raw.prepare('UPDATE person SET is_admin = 1 WHERE id = ?').run(op)
    const myra = await signIn(env, 'myra@example.org')
    let res = await dmsForm(myra, { do: 'report', id: inbound.id })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/dms?done=reported')
    expect(await body(await myra.get('/dms?done=reported'))).toContain("it's in the operator's queue now.")
    expect(get(env, 'SELECT reported_at FROM dm WHERE id = ?', inbound.id).reported_at).not.toBeNull()
    expect(get(env, "SELECT url, kind FROM report WHERE url = ?", `dm:${inbound.id}`)).toMatchObject({ kind: 'abuse' })
    expect(mails(env.DB as any).filter(m => m.template === 'dm_report').map(m => m.to_email)).toEqual(['op@example.org'])
    // reporting again changes nothing
    await dmsForm(myra, { do: 'report', id: inbound.id })
    expect(mails(env.DB as any).filter(m => m.template === 'dm_report').length).toBe(1)

    // her own sent DM isn't hers to report
    res = await dmsForm(myra, { do: 'report', id: outbound.id })
    expect(res.headers.get('location')).toBe('/dms?done=gone')

    res = await dmsForm(myra, { do: 'block', id: inbound.id })
    expect(res.headers.get('location')).toBe('/dms?done=blocked')
    expect(all(env, 'SELECT by_name, name FROM dm_block WHERE person_id = ?', myraId)).toEqual([{ by_name: '@myra', name: '@ana/bot' }])
    await expect(sendDm(db, sender(anaId, 'ana', '@ana/bot'), '@myra/fathom', 'again', { beta: false })).rejects.toMatchObject({ code: 'dms_off' })

    // the keys page lists the block and unblocks it
    const keys = await body(await myra.get('/keys'))
    expect(keys).toContain('<code>@ana/bot</code> can\'t message any of your names')
    res = await keysForm(myra, { do: 'dm_unblock', by_name: '@myra', name: '@ana/bot' })
    expect(res.headers.get('location')).toBe('/keys?done=dm_unblock#dms')
    expect(get(env, 'SELECT COUNT(*) AS n FROM dm_block').n).toBe(0)
  })

  it("can't report or block someone else's DM, and needs the form token", async () => {
    const { env, inbound } = await talking()
    const id = await addPerson(env.DB, 'zed', { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
    env.DB.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(new Date(T0).toISOString(), id)
    const zed = await signIn(env, 'zed@example.org', '198.51.100.9')
    expect((await dmsForm(zed, { do: 'report', id: inbound.id })).headers.get('location')).toBe('/dms?done=gone')
    expect((await dmsForm(zed, { do: 'block', id: inbound.id })).headers.get('location')).toBe('/dms?done=gone')
    expect(await body(await zed.get('/dms'))).toContain('no direct messages yet.')
    expect((await zed.req('/dms', { form: { do: 'report', id: inbound.id } })).status).toBe(403)
    expect(get(env, 'SELECT COUNT(*) AS n FROM dm_block').n).toBe(0)
    expect(get(env, 'SELECT reported_at FROM dm WHERE id = ?', inbound.id).reported_at).toBeNull()
  })
})
