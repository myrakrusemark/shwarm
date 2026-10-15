// Go-live 3.10: site_mode beta. Reading pages public on production, noindex on every response, sign-up open to anyone
// with an address off the allow-list waiting (decided Oct 10), "opens soon" where join, post, back and "start a shwarm" would be for anyone who isn't
// invited, core refusing their acts, and creation paused while pause_new_nodes is on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShwarmError } from '@shwarm/protocol'
import { hashPassword } from '../src/auth/password'
import { keyActor, siteActor } from '../src/core/actor'
import { TreeEngine } from '../src/core/engine'
import { actsLimited, BETA_REFUSAL, homeShowsFeed, inBeta, readingOpen, siteModeOf } from '../src/core/site-mode'
import { runInTree } from '../src/do/shwarm-tree'
import { w as words } from '../src/words'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { OPENS_SOON } from '../src/web/opens-soon'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { allow, body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, joinForm, linkIn, pepper, testEnv } from './browser'
import { addPerson, T0 } from './d1'
import { PLAIN, stagingWorld } from './node-fixture'
import { treeNamespace } from './tree'

const WAITING = words.auth.waiting

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

const HTML = { accept: 'text/html' }
const SUB = `/w/${PLAIN}/s/1` // an old submission's page (history since Oct 14), written in prod() below

/** Production in `mode`, its trees in the same mode, on a staging-like database (the running example seeded). */
async function prod(mode: 'holding' | 'beta' | 'open' = 'beta') {
  const w = await stagingWorld()
  const plain = (w.db.raw.prepare('SELECT id FROM node WHERE path = ?').get(PLAIN) as { id: number }).id
  w.db.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, links, created_at) VALUES ('p_oldsitemd1', ?, ?, '@myra', 'submission', 'eight demos.', ?, ?)").run(plain, w.myraId, JSON.stringify([{ url: 'https://codeberg.org/myra/bot/demos.zip', sha256: 'a'.repeat(64) }]), new Date(T0).toISOString())
  w.db.raw.prepare("INSERT INTO submission (post_id, node_id, number, hash, how_to_check, status) VALUES ('p_oldsitemd1', ?, 1, ?, 'replay them.', 'superseded')").run(plain, 'b'.repeat(64))
  const env = { ...testEnv(w.db), ENV: 'production', SITE_MODE: mode, TREE: treeNamespace(w.db, { ENV: 'production', SITE_MODE: mode }).ns }
  const count = (sql: string, ...args: unknown[]) => (w.db.raw.prepare(sql).get(...args) as { n: number }).n
  /** A verified account signed in on its own browser; `founding` makes it invited, `admin` the operator. */
  const signedIn = async (handle: string, o: { founding?: boolean; admin?: boolean } = {}) => {
    const pid = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
    w.db.raw
      .prepare('UPDATE person SET email_verified_at = ?, founding = ?, is_admin = ? WHERE id = ?')
      .run(new Date(T0).toISOString(), o.founding ? 1 : 0, o.admin ? 1 : 0, pid)
    const b = new Browser(env as any)
    expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
    return { b, pid }
  }
  return { ...w, env, b: new Browser(env as any), count, signedIn }
}

describe('the mode switch', () => {
  it('reads holding, beta and open; anything else is holding', () => {
    expect(siteModeOf({ SITE_MODE: 'beta' })).toBe('beta')
    expect(siteModeOf({ SITE_MODE: 'open' })).toBe('open')
    expect(siteModeOf({ SITE_MODE: 'holding' })).toBe('holding')
    expect(siteModeOf({ SITE_MODE: 'Beta' })).toBe('holding')
    expect(siteModeOf({})).toBe('holding')
    expect(inBeta({ SITE_MODE: 'beta' })).toBe(true)
    expect(inBeta({ SITE_MODE: 'open' })).toBe(false)
  })

  it('production reads and shows the feed in beta and open, not in holding or an unknown mode', () => {
    for (const [mode, open] of [['beta', true], ['open', true], ['holding', false], ['typo', false], [undefined, false]] as const) {
      expect(readingOpen({ ENV: 'production', SITE_MODE: mode })).toBe(open)
      expect(homeShowsFeed({ ENV: 'production', SITE_MODE: mode })).toBe(open)
    }
    // staging and tests always read and show the feed, whatever the mode says
    expect(readingOpen({ ENV: 'staging', SITE_MODE: 'holding' })).toBe(true)
    expect(homeShowsFeed({ ENV: 'staging', SITE_MODE: 'holding' })).toBe(true)
    expect(homeShowsFeed({ ENV: 'local', SITE_MODE: 'beta' })).toBe(false)
  })

  it('production and staging both say which mode they run in wrangler.jsonc', async () => {
    const { readFileSync } = await import('node:fs')
    const raw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    const modes = [...raw.matchAll(/"SITE_MODE": "([a-z]+)"/g)].map(m => m[1])
    expect(modes).toHaveLength(2)
    for (const m of modes) expect(['holding', 'beta', 'open']).toContain(m)
  })
})

describe('beta on production: the reading pages are public', () => {
  it('home is the feed, and shwarm, branch, submission and profile pages read, signed out', async () => {
    const { b } = await prod('beta')
    const home = await body(await b.get('/'))
    expect(home).toContain('class="sort"')
    expect(home).toContain('minecraft in doom')
    for (const p of [`/w/${EXAMPLE_ROOT}`, `/w/${EXAMPLE_BRANCH}`, SUB, '/@myra']) expect((await b.req(p, { headers: HTML })).status).toBe(200)
    expect((await b.req(`/w/${EXAMPLE_ROOT}`, { headers: { accept: 'application/json' } })).status).toBe(200)
  })

  it('holding still shows the holding page and keeps the reading pages closed', async () => {
    const { b } = await prod('holding')
    expect(await body(await b.get('/'))).not.toContain('class="sort"')
    expect((await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML })).status).toBe(404)
  })
})

describe('noindex on every response until open', () => {
  const paths = ['/', `/w/${EXAMPLE_ROOT}`, `/w/${EXAMPLE_ROOT}?format=json`, SUB, '/@myra', '/rules', '/new', '/signin', '/join', '/healthz', '/no-such-page', '/w/no/such/node', '/.well-known/security.txt']

  it('beta: pages, errors, redirects, health and the agent API all send X-Robots-Tag: noindex', async () => {
    const { b } = await prod('beta')
    for (const p of paths) expect([p, (await b.get(p)).headers.get('x-robots-tag')]).toEqual([p, 'noindex'])
    const post = await b.req(`/w/${EXAMPLE_ROOT}`, { method: 'POST' }) // no session: off to sign-in
    expect(post.headers.get('x-robots-tag')).toBe('noindex')
    const api = await b.req('/shwarms', { method: 'POST', headers: { signature: 'sig1=:AAAA:', 'signature-input': 'sig1=();keyid="x"' } })
    expect(api.headers.get('x-robots-tag')).toBe('noindex')
  })

  it('holding sends it too; open sends none', async () => {
    const held = await prod('holding')
    for (const p of ['/', '/rules', '/healthz', '/no-such-page']) expect((await held.b.get(p)).headers.get('x-robots-tag')).toBe('noindex')
    const open = await prod('open')
    // the reading pages; account pages (sign-in, join, keys, admin, mail links) stay noindex in every mode
    const reading = ['/', `/w/${EXAMPLE_ROOT}`, `/w/${EXAMPLE_ROOT}?format=json`, SUB, '/@myra', '/rules', '/healthz']
    for (const p of reading) expect([p, (await open.b.get(p)).headers.get('x-robots-tag')]).toEqual([p, null])
  })

  it('static files get it from static/_headers, which the Worker never sees', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(new URL('../static/_headers', import.meta.url), 'utf8')).toMatch(/^\/\*\n {2}X-Robots-Tag: noindex\n/)
  })
})

describe('"opens soon" for anyone who isn\'t invited', () => {
  async function expectOpensSoon(b: Browser, signedOut: boolean) {
    const root = await body(await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))
    expect(root).toContain(`<div class="to">${OPENS_SOON.post}</div>`)
    expect(root).toContain(OPENS_SOON.why)
    expect(root).toContain(OPENS_SOON.join)
    expect(root).toContain(OPENS_SOON.branch)
    expect(root).not.toContain('<form class="compose"')
    expect(root).not.toContain('name="do" value="join"')
    expect(root).not.toContain('class="up-act"')
    expect(root).not.toContain('+ start a branch')
    expect(root.includes('invited? <a href="/signin')).toBe(signedOut)
    // an old submission's page reads, with nothing to act on (decided Oct 14)
    const sub = await body(await b.req(SUB, { headers: HTML }))
    expect(sub).toContain('eight demos.')
    expect(sub).not.toContain('name="do"')
    for (const p of ['/new', `/new?parent=${EXAMPLE_ROOT}`, `/new?builds_on=${EXAMPLE_ROOT}`]) {
      const res = await b.get(p)
      expect(res.status).toBe(200)
      const h = await body(res)
      expect(h).toContain(`<h1 class="title" id="heading">${OPENS_SOON.newTitle}</h1>`)
      expect(h).toContain(OPENS_SOON.newText)
      expect(h).not.toContain('<form method="post" action="/new"')
    }
  }

  it('signed out: every page reads, no act is offered, and sign-in stays for the invited', async () => {
    const { b } = await prod('beta')
    await expectOpensSoon(b, true)
    const head = await body(await b.get('/'))
    expect(head).toContain('href="/signin"') // the invited still sign in
    expect(head).toContain('href="/join"') // and sign up with their invited address
  })

  it('signed in but not invited: the same, and core refuses what they send anyway', async () => {
    const { b, count, pid } = await prod('beta').then(async w => ({ ...w, ...(await w.signedIn('stray')) }))
    await expectOpensSoon(b, false)
    const posts = count('SELECT count(*) AS n FROM post')
    const token = formTokenIn(await body(await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))) // the sign-out form's
    const posted = await b.req(`/w/${EXAMPLE_ROOT}`, { form: { form_token: token, do: 'post', text: 'hello from outside the beta' } })
    expect(posted.status).toBe(400)
    expect(await body(posted)).toContain(BETA_REFUSAL) // core's refusal, shown under "posting opens soon"
    const joined = await b.req(`/w/${EXAMPLE_ROOT}`, { form: { form_token: token, do: 'join' } })
    expect(joined.status).toBe(400)
    expect(await body(joined)).toContain(BETA_REFUSAL)
    expect(count('SELECT count(*) AS n FROM post')).toBe(posts)
    expect(count('SELECT count(*) AS n FROM seat WHERE person_id = ?', pid)).toBe(0)
    const made = await b.req('/new', { form: { form_token: token, title: 'outside', what: 'a test goal.', done_when: 'it is done.', tags: '#test', license: 'MIT' } })
    expect(made.status).toBe(403)
    expect(await body(made)).toContain(OPENS_SOON.newText)
    expect(count("SELECT count(*) AS n FROM node WHERE title = 'outside'")).toBe(0)
  })

  it('invited (founding) and the operator act as usual', async () => {
    const w = await prod('beta')
    for (const [handle, o] of [['tester', { founding: true }], ['operator', { admin: true }]] as const) {
      const { b, pid } = await w.signedIn(handle, o)
      const root = await body(await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))
      expect(root).toContain('<form class="compose"')
      expect(root).toContain('name="do" value="join"')
      expect(root).toContain('+ start a branch')
      expect(root).not.toContain(OPENS_SOON.why)
      expect(await body(await b.get('/new'))).toContain('<form method="post" action="/new"')
      const token = formTokenIn(root)
      await b.req(`/w/${EXAMPLE_ROOT}`, { form: { form_token: token, do: 'post', text: `hello from @${handle}` } })
      expect(w.count('SELECT count(*) AS n FROM post WHERE person_id = ?', pid)).toBe(1)
    }
  })

  it('open: nobody sees "opens soon"', async () => {
    const { b } = await prod('open')
    const root = await body(await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))
    expect(root).not.toContain(OPENS_SOON.why)
    expect(root).toContain('to post here')
    expect((await b.get('/new')).status).toBe(303) // signed out: sign in first, as before
  })
})

describe('core refuses acts by anyone who isn\'t invited during the beta', () => {
  it('a beta engine refuses a verified non-founding account, takes a founding one and the launch import', async () => {
    const { db } = await stagingWorld()
    const id = (h: string) => db.raw.prepare('SELECT id FROM person WHERE handle = ?').get(h).id as number
    const stray = await addPerson(db, 'stray')
    db.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(new Date(T0).toISOString(), stray)
    const beta = new TreeEngine(db, () => T0, { beta: true })
    const post = (pid: number, handle: string, via: 'site' | 'seed' = 'site') =>
      beta.run({ type: 'post', actor: { ...siteActor({ id: pid, handle }), via }, input: { node: EXAMPLE_ROOT, text: `hi from ${handle}` } })
    const e = await post(stray, 'stray').catch(x => x)
    expect(e).toBeInstanceOf(ShwarmError)
    expect(e).toMatchObject({ code: 'not_permitted', details: { reason: 'opens_soon' } })
    await expect(post(id('myra'), 'myra')).resolves.toBeTruthy() // founding
    await expect(post(stray, 'stray', 'seed')).resolves.toBeTruthy() // the launch import is never refused
    // an agent key of theirs is refused the same way
    const key = keyActor({ id: stray, handle: 'stray' }, '@stray/bot', { id: 'k_test', canPostAs: '@stray/*', grants: [{ node: '*', perms: ['post'] }] })
    await expect(beta.run({ type: 'post', actor: key, input: { node: EXAMPLE_ROOT, text: 'from a key' } })).rejects.toMatchObject({ code: 'not_permitted', details: { reason: 'opens_soon' } })
    // outside the beta the same account acts
    await expect(new TreeEngine(db, () => T0).run({ type: 'post', actor: siteActor({ id: stray, handle: 'stray' }), input: { node: EXAMPLE_ROOT, text: 'later' } })).resolves.toBeTruthy()
  })
})

describe('anyone may join while sign-up is invite-only (decided Oct 10); only the invited act', () => {
  /** Joins from `ip`, presses the verify button, signs in; returns the browser and the account's id. */
  async function joinAndVerify(env: any, handle: string, email: string, ip: string) {
    const b = new Browser(env, ip)
    const res = await b.post('/join', joinForm(handle, email))
    expect(res.status).toBe(303)
    const page = await body(await b.get(res.headers.get('location')!))
    const html = await body(await b.get(linkIn(env.DB, 'verify')))
    await b.req('/verify', { form: { form_token: formTokenIn(html), t: /name="t" value="([^"]+)"/.exec(html)![1] } })
    expect((await b.post('/signin', { email, password: GOOD_PASSWORD })).status).toBe(303)
    const pid = (env.DB.raw.prepare('SELECT id FROM person WHERE handle = ?').get(handle) as { id: number }).id
    return { b, pid, page }
  }

  it('beta: a stranger gets an account and the waiting words, reads, and is refused when they post', async () => {
    const { env, count } = await prod('beta')
    expect(count("SELECT count(*) AS n FROM setting WHERE key = 'signup' AND value = '\"allow_list\"'")).toBe(1)
    const { b, pid, page } = await joinAndVerify(env, 'outsider', 'outsider@example.net', '198.51.100.20')
    expect(page).toContain(WAITING)
    expect(count('SELECT count(*) AS n FROM person WHERE id = ? AND email_verified_at IS NOT NULL AND founding = 0', pid)).toBe(1)
    expect(count('SELECT count(*) AS n FROM signup_wait WHERE person_id = ? AND mailed_at IS NULL', pid)).toBe(1)
    const root = await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML })
    expect(root.status).toBe(200)
    const html = await body(root)
    expect(html).toContain(OPENS_SOON.why)
    const posts = count('SELECT count(*) AS n FROM post')
    const posted = await b.req(`/w/${EXAMPLE_ROOT}`, { form: { form_token: formTokenIn(html), do: 'post', text: 'hello from the waiting list' } })
    expect(posted.status).toBe(400)
    expect(await body(posted)).toContain(BETA_REFUSAL)
    expect(count('SELECT count(*) AS n FROM post')).toBe(posts)
    // an invited address joins as before: the usual page, founding, acting
    await allow(env.DB, 'friend@example.net')
    const friend = await joinAndVerify(env, 'friend', 'friend@example.net', '203.0.113.20')
    expect(friend.page).not.toContain(WAITING)
    expect(friend.page).toContain('we sent a link to your email address.')
    expect(count('SELECT count(*) AS n FROM person WHERE id = ? AND founding = 1', friend.pid)).toBe(1)
    expect(count('SELECT count(*) AS n FROM signup_wait WHERE person_id = ?', friend.pid)).toBe(0)
    const fh = await body(await friend.b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))
    await friend.b.req(`/w/${EXAMPLE_ROOT}`, { form: { form_token: formTokenIn(fh), do: 'post', text: 'hello from an invited tester' } })
    expect(count('SELECT count(*) AS n FROM post WHERE person_id = ?', friend.pid)).toBe(1)
  })

  it('production in holding: core refuses a stranger\'s acts too, and /new says it opens soon', async () => {
    const w = await prod('holding')
    const { b, pid } = await joinAndVerify(w.env, 'outsider', 'outsider@example.net', '198.51.100.30')
    const e = await runInTree(w.env.TREE, { type: 'post', actor: siteActor({ id: pid, handle: 'outsider' }), input: { node: EXAMPLE_ROOT, text: 'hi' } }).catch(x => x)
    expect(e).toMatchObject({ code: 'not_permitted', details: { reason: 'opens_soon' } })
    await expect(runInTree(w.env.TREE, { type: 'post', actor: siteActor({ id: w.myraId, handle: 'myra' }), input: { node: EXAMPLE_ROOT, text: 'hi' } })).resolves.toBeTruthy()
    expect(await body(await b.get('/new'))).toContain(OPENS_SOON.newText)
    // staging and tests in holding still let every verified account act (staging mails only invited addresses)
    expect(actsLimited({ ENV: 'staging', SITE_MODE: 'holding' })).toBe(false)
    expect(actsLimited({ ENV: 'production', SITE_MODE: 'open' })).toBe(false)
  })
})

describe('creation paused (pause_new_nodes)', () => {
  it('the form says so before it is filled, and nothing is made', async () => {
    const w = await prod('beta')
    w.db.raw.prepare("UPDATE setting SET value = 'true' WHERE key = 'pause_new_nodes'").run()
    const { b } = await w.signedIn('tester', { founding: true })
    for (const p of ['/new', `/new?parent=${EXAMPLE_ROOT}`]) {
      const h = await body(await b.get(p))
      expect(h).toContain('starting new shwarms and branches is paused for now.')
      expect(h).not.toContain('<form method="post" action="/new"')
    }
    // posting still works
    const root = await body(await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))
    expect(root).toContain('<form class="compose"')
  })
})
