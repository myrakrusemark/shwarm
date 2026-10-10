// Go-live 9.4, the switches: /admin/switches flips read-only, pause new nodes and sign-up, each with a required reason,
// writes one public moderation_action row in the same batch, and the flip takes effect on the next act. A plain 404 for
// anyone who isn't an admin. The site mode is shown, not flipped.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { siteActor } from '../src/core/actor'
import { parseSwitchReason } from '../src/core/switches'
import { runInTree } from '../src/do/shwarm-tree'
import { EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, joinForm, pepper, testEnv } from './browser'
import { addPerson, T0 } from './d1'
import { stagingWorld } from './node-fixture'

const MIN = 60_000

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
  forgetVersions()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** The staging-like world, @myra an admin; `signedIn` gives a browser signed in (password just entered). */
async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  w.db.raw.prepare('UPDATE person SET is_admin = 1, password_hash = ? WHERE id = ?').run(hash, w.myraId)
  const signedIn = async (handle: string) => {
    if (handle !== 'myra') {
      const id = await addPerson(env.DB, handle, { hash })
      w.db.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(new Date(T0).toISOString(), id)
    }
    const b = new Browser(env)
    expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
    return b
  }
  const settingOf = (key: string) => JSON.parse(w.db.raw.prepare('SELECT value FROM setting WHERE key = ?').get(key).value)
  const rows = () => w.db.raw.prepare('SELECT by_person, action, node_id, post_id, person_id, reason, public FROM moderation_action ORDER BY id').all()
  return { ...w, env, signedIn, settingOf, rows }
}

/** POSTs the switch form with this page's token. */
async function flip(b: Browser, key: string, value: string, reason: string) {
  const token = formTokenIn(await (await b.get('/admin/switches')).text())
  return b.req('/admin/switches', { form: { form_token: token, key, value, reason } })
}

describe('/admin/switches', () => {
  it('is a plain 404 for anyone but an admin, signed out included, and takes no flip from them', async () => {
    const w = await world()
    const out = new Browser(w.env)
    expect((await out.get('/admin/switches')).status).toBe(404)
    const kestrel = await w.signedIn('tester_one')
    expect((await kestrel.get('/admin/switches')).status).toBe(404)
    const token = formTokenIn(await (await kestrel.get('/signin')).text())
    const res = await kestrel.req('/admin/switches', { form: { form_token: token, key: 'read_only', value: 'true', reason: 'x' } })
    expect(res.status).toBe(404)
    expect(w.settingOf('read_only')).toBe(false)
    expect(w.rows()).toEqual([])
  })

  it('shows each switch, the site mode and how to change it, and asks for the password again after 10 minutes', async () => {
    const w = await world()
    const b = await w.signedIn('myra')
    const res = await b.get('/admin/switches')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const h = await body(res)
    for (const s of ['read-only <span>· off', 'pause new shwarms and branches <span>· off', 'sign-up <span>· allow-list only', 'site mode <span>· holding'])
      expect(h).toContain(s)
    expect(h).toContain('npx wrangler deploy --env production')
    expect(h).toContain('confirms with your password.')
    expect(h).toContain('<nav class="adminnav"')
    vi.setSystemTime(T0 + 11 * MIN)
    const late = await b.get('/admin/switches')
    expect(late.status).toBe(303)
    expect(late.headers.get('location')).toBe('/step-up?next=%2Fadmin%2Fswitches')
  })

  it('read-only: the flip needs a reason, writes the setting and one public row, and refuses the next post', async () => {
    const w = await world()
    const b = await w.signedIn('myra')
    const actor = siteActor({ id: w.myraId, handle: 'myra' })
    await expect(runInTree(w.env.TREE, { type: 'post', actor, input: { node: EXAMPLE_ROOT, text: 'before' } })).resolves.toBeTruthy()

    // no reason: refused, nothing changes
    let res = await flip(b, 'read_only', 'true', '   ')
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('give a reason. it shows in the public log.')
    expect(w.settingOf('read_only')).toBe(false)
    expect(w.rows()).toEqual([])

    res = await flip(b, 'read_only', 'true', 'moving the database')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/switches?done=read_only#read_only')
    expect(w.settingOf('read_only')).toBe(true)
    expect(w.rows()).toEqual([{ by_person: w.myraId, action: 'setting', node_id: null, post_id: null, person_id: null, reason: 'read_only=true: moving the database', public: 1 }])
    expect(parseSwitchReason(w.rows()[0].reason)).toEqual({ key: 'read_only', value: true, reason: 'moving the database' })
    expect(await body(await b.get('/admin/switches?done=read_only'))).toContain("read-only is now on. it's in the public log.")

    await expect(runInTree(w.env.TREE, { type: 'post', actor, input: { node: EXAMPLE_ROOT, text: 'during' } })).rejects.toMatchObject({
      code: 'not_permitted',
      details: { reason: 'read_only' },
    })

    // the same value again changes nothing and logs nothing
    res = await flip(b, 'read_only', 'true', 'again')
    expect(res.headers.get('location')).toBe('/admin/switches?same=read_only#read_only')
    expect(w.rows()).toHaveLength(1)

    // and back off: the post goes through again
    expect((await flip(b, 'read_only', 'false', 'done moving')).status).toBe(303)
    expect(w.settingOf('read_only')).toBe(false)
    expect(w.rows().map((r: any) => r.reason)).toEqual(['read_only=true: moving the database', 'read_only=false: done moving'])
    await expect(runInTree(w.env.TREE, { type: 'post', actor, input: { node: EXAMPLE_ROOT, text: 'after' } })).resolves.toBeTruthy()
  })

  it('pause new nodes: refuses the next branch, posts still go', async () => {
    const w = await world()
    const b = await w.signedIn('myra')
    expect((await flip(b, 'pause_new_nodes', 'true', 'triage is down')).status).toBe(303)
    expect(w.settingOf('pause_new_nodes')).toBe(true)
    expect(w.rows()).toMatchObject([{ action: 'setting', reason: 'pause_new_nodes=true: triage is down', public: 1 }])
    const actor = siteActor({ id: w.myraId, handle: 'myra' })
    const input = { kind: 'branch', parent: EXAMPLE_ROOT, title: 'sky box', what: 'a sky that moves.', doneWhen: 'the sky scrolls at 60 fps.', check: { author: true } }
    await expect(runInTree(w.env.TREE, { type: 'createNode', actor, input } as any)).rejects.toMatchObject({ code: 'not_permitted', details: { reason: 'pause_new_nodes' } })
    await expect(runInTree(w.env.TREE, { type: 'post', actor, input: { node: EXAMPLE_ROOT, text: 'still here' } })).resolves.toBeTruthy()
    expect(await body(await b.get('/new'))).toContain('new shwarms and branches are paused for a moment.')
  })

  it('sign-up: open tells an address off the allow-list it is in; allow-list only tells it to wait', async () => {
    const w = await world()
    const b = await w.signedIn('myra')
    const join = async (handle: string) => (await new Browser(w.env, `192.0.2.${handle.length}`).post('/join', joinForm(handle, `${handle}@example.org`))).headers.get('location')
    expect(await join('stranger')).toBe('/check-email?w=1')

    expect((await flip(b, 'signup', 'open', 'opening day')).status).toBe(303)
    expect(w.settingOf('signup')).toBe('open')
    expect(w.rows()).toMatchObject([{ action: 'setting', reason: 'signup="open": opening day', public: 1 }])
    expect(await join('newcomer')).toBe('/check-email')
    expect(await body(await b.get('/admin/switches'))).toContain('sign-up <span>· open to anyone')

    expect((await flip(b, 'signup', 'allow_list', 'too many at once')).status).toBe(303)
    expect(w.settingOf('signup')).toBe('allow_list')
    expect(await join('latecomer')).toBe('/check-email?w=1')
  })

  it('refuses an expired form token, an unknown switch and a value it does not take', async () => {
    const w = await world()
    const b = await w.signedIn('myra')
    expect((await b.req('/admin/switches', { form: { form_token: 'nope', key: 'read_only', value: 'true', reason: 'x' } })).status).toBe(403)
    expect((await flip(b, 'site_mode', '"open"', 'x')).status).toBe(400)
    expect((await flip(b, 'stats_on', 'true', 'x')).status).toBe(400)
    expect((await flip(b, 'signup', 'maybe', 'x')).status).toBe(400)
    expect((await flip(b, 'read_only', 'x'.repeat(10), 'y'.repeat(501))).status).toBe(400)
    expect(w.settingOf('read_only')).toBe(false)
    expect(w.rows()).toEqual([])
  })

  it('makes a missing setting row', async () => {
    const w = await world()
    w.db.raw.prepare("DELETE FROM setting WHERE key = 'pause_new_nodes'").run()
    const b = await w.signedIn('myra')
    expect(await body(await b.get('/admin/switches'))).toContain('pause new shwarms and branches <span>· off')
    expect((await flip(b, 'pause_new_nodes', 'true', 'x')).status).toBe(303)
    expect(w.settingOf('pause_new_nodes')).toBe(true)
  })
})
