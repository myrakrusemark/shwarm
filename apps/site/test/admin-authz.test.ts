// Go-live 9.4 and 9.5 through one lens, who can reach what: every admin page and form (GET, HEAD, POST, with and without
// a trailing slash) is a plain 404 that changes nothing for anyone but a verified, active admin, which means signed out,
// a member, an admin whose email isn't verified and a suspended admin. An admin whose password window closed is sent
// to step up. A form without its token, or from another site, changes nothing. What people wrote shows as text, never as
// markup. The public log never names a node the public was never shown: its address doesn't answer anyone else (a
// plain 404, read/tombstone.ts), so the log doesn't confirm it either.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { EXAMPLE_BRANCH } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { PLAIN, stagingWorld } from './node-fixture'

const iso = (ms: number) => new Date(ms).toISOString()
const HTML = { accept: 'text/html' }
const POST_ID = 'p_authzpost01'

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

async function world(o: { clearBranch?: boolean } = {}) {
  const w = await stagingWorld(o)
  const env = testEnv(w.db)
  const raw = w.db.raw
  const q = <T = any>(sql: string, ...args: unknown[]) => raw.prepare(sql).get(...args) as T
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  raw.prepare('UPDATE person SET is_admin = 0').run()
  raw.prepare('UPDATE person SET password_hash = ?, is_admin = 1 WHERE id = ?').run(hash, w.myraId)
  const person = async (handle: string, admin = false) => {
    const id = await addPerson(env.DB, handle, { hash })
    raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1, is_admin = ? WHERE id = ?').run(iso(T0), admin ? 1 : 0, id)
    return id
  }
  const ana = await person('ana')
  const op = await person('op', true) // a second admin, to be made unverified or suspended
  const branch = q<{ id: number }>('SELECT id FROM node WHERE path = ?', EXAMPLE_BRANCH).id
  raw
    .prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, links, created_at) VALUES (?, ?, ?, '@ana', 'post', 'look', ?, ?)")
    .run(POST_ID, branch, ana, JSON.stringify([{ url: 'https://codeberg.org/ana/one', sha256: 'a'.repeat(64) }]), iso(T0 - 60_000))
  raw
    .prepare("INSERT INTO report (node_id, post_id, url, person_id, kind, reason, text, contact, created_at) VALUES (?, ?, ?, ?, 'abuse', 'spam', ?, ?, ?)")
    .run(branch, POST_ID, `/w/${EXAMPLE_BRANCH}#${POST_ID}`, ana, '<script>alert(1)</script> and <img src=x onerror=alert(2)>', '"><svg onload=alert(3)>', iso(T0 - 50_000))
  const count = () => q<{ k: number }>('SELECT COUNT(*) AS k FROM moderation_action').k
  const state = () =>
    JSON.stringify([
      raw.prepare('SELECT id, hidden, triage, paused FROM node ORDER BY id').all(),
      raw.prepare('SELECT id, hidden, links FROM post ORDER BY id').all(),
      raw.prepare('SELECT id, status, founding FROM person ORDER BY id').all(),
      raw.prepare('SELECT id, resolved_at FROM report ORDER BY id').all(),
      raw.prepare('SELECT key, value FROM setting ORDER BY key').all(),
    ])
  return { ...w, env, raw, q, ana, op, branch, count, state }
}

async function signIn(env: ReturnType<typeof testEnv>, handle: string) {
  const b = new Browser(env)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}

const node = `/admin/node?path=${encodeURIComponent(EXAMPLE_BRANCH)}`
const post = `/admin/post?id=${POST_ID}`
const PAGES = ['/admin', '/admin/', node, post, '/admin/report?id=1', '/admin/people?q=ana', '/admin/people/', '/admin/switches', '/admin/switches/', '/admin/beta']
/** One harmful form for each act endpoint, as an admin's page would send it (minus the token). */
const FORMS: [string, Record<string, string>][] = [
  [node, { do: 'hide', reason: 'x' }],
  [post, { do: 'remove_link', link: '0', reason: 'x' }],
  ['/admin/report?id=1', { do: 'resolve', reason: 'x' }],
  ['/admin/people?q=ana', { do: 'suspend', person: '0', once: 'once-0123456789abcdef', reason: 'x' }],
  ['/admin/switches', { key: 'read_only', value: 'true', reason: 'x' }],
]

describe('the admin console: who gets in', () => {
  it('signed out, a member, an unverified admin and a suspended admin get a plain 404 on every page, method and form, and change nothing', async () => {
    const w = await world()
    const ana = await signIn(w.env, 'ana')
    const unverified = await signIn(w.env, 'op')
    w.raw.prepare('UPDATE person SET email_verified_at = NULL WHERE id = ?').run(w.op)
    const suspended = await signIn(w.env, 'op')
    // The suspended admin signed in while active; suspending ends their sessions, but a session that somehow lived on
    // still gets nothing (auth/session.ts reads only active accounts, the gate only active admins).
    w.raw.prepare("UPDATE person SET status = 'suspended', email_verified_at = ? WHERE id = ?").run(iso(T0), w.op)
    const before = w.state()
    for (const [who, b] of [['signed out', new Browser(w.env)], ['member', ana], ['unverified admin', unverified], ['suspended admin', suspended]] as const) {
      for (const p of PAGES)
        for (const method of ['GET', 'HEAD']) {
          const r = await b.req(p, { method, headers: HTML })
          expect(r.status, `${who} ${method} ${p}`).toBe(404)
        }
      for (const [p, f] of FORMS) {
        const token = formTokenIn(await (await b.get('/signin')).text())
        const r = await b.req(p, { form: { form_token: token, ...f, ...(f.person ? { person: String(w.op) } : {}) } })
        expect(r.status, `${who} POST ${p}`).toBe(404)
      }
    }
    expect(w.count()).toBe(0)
    expect(w.state()).toBe(before)
  })

  it('an admin past the step-up: a form with no token, a token from another session, or a post from another site changes nothing', async () => {
    const w = await world()
    const before = w.state()
    const myra = await signIn(w.env, 'myra')
    const other = await signIn(w.env, 'ana')
    const theirs = formTokenIn(await (await other.get('/signin')).text())
    for (const [p, f] of FORMS) {
      const fields = { ...f, ...(f.person ? { person: String(w.ana) } : {}) }
      expect((await myra.req(p, { form: fields })).status, `no token ${p}`).toBe(403)
      expect((await myra.req(p, { form: { form_token: theirs, ...fields } })).status, `their token ${p}`).toBe(403)
      const good = formTokenIn(await (await myra.get(p)).text())
      const cross = await myra.req(p, { form: { form_token: good, ...fields }, headers: { origin: 'https://evil.example' } })
      expect(cross.status, `cross-site ${p}`).toBeGreaterThanOrEqual(400)
    }
    expect(w.count()).toBe(0)
    expect(w.state()).toBe(before)
  })

  it('an admin whose password window closed is sent to step up from every page and form, and nothing changes', async () => {
    const w = await world()
    const before = w.state()
    const myra = await signIn(w.env, 'myra')
    const tokens = new Map<string, string>()
    for (const [p] of FORMS) tokens.set(p, formTokenIn(await (await myra.get(p)).text()))
    w.raw.prepare('UPDATE session SET step_up_until = NULL').run()
    for (const p of PAGES.filter(p => !p.endsWith('/') && p !== '/admin/beta')) {
      const r = await myra.req(p, { headers: HTML })
      expect(r.status, p).toBe(303)
      expect(r.headers.get('location'), p).toMatch(/^\/step-up\?next=%2Fadmin/)
    }
    for (const [p, f] of FORMS) {
      const r = await myra.req(p, { form: { form_token: tokens.get(p)!, ...f, ...(f.person ? { person: String(w.ana) } : {}) } })
      expect(r.status, p).toBe(303)
      expect(r.headers.get('location'), p).toMatch(/^\/step-up\?next=/)
    }
    expect(w.count()).toBe(0)
    expect(w.state()).toBe(before)
  })

  it('what a reporter wrote shows as text on the queue and the report page, never as markup', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    for (const p of ['/admin', '/admin/report?id=1', post]) {
      const html = await (await myra.get(p)).text()
      expect(html, p).not.toContain('<script>alert(1)')
      expect(html, p).not.toContain('<img src=x')
      expect(html, p).not.toContain('<svg onload')
      expect(html, p).toContain('&lt;script&gt;alert(1)')
    }
  })
})

describe('the public log and nodes the public never saw', () => {
  /** A block, a hide of the node and a hide of a post in it, all on a node that never cleared triage. */
  async function actOnHeld(w: Awaited<ReturnType<typeof world>>, path: string) {
    const myra = await signIn(w.env, 'myra')
    const page = `/admin/node?path=${encodeURIComponent(path)}`
    const send = async (p: string, f: Record<string, string>) => {
      const token = formTokenIn(await (await myra.get(p)).text())
      expect((await myra.req(p, { form: { form_token: token, ...f } })).status, `${p} ${f.do}`).toBe(303)
    }
    await send(page, { do: 'block', category: 'spam', reason: 'a link farm' })
    await send(page, { do: 'hide', reason: 'still a link farm' })
    return myra
  }

  it('a held shwarm the operator blocks and hides shows on the log without its address', async () => {
    const w = await world()
    w.raw.prepare("UPDATE node SET triage = 'held', seeded = 0 WHERE path = ?").run(PLAIN)
    // Its address answers nobody but its author: a plain 404, not a tombstone.
    expect((await new Browser(w.env).req(`/w/${PLAIN}`, { headers: HTML })).status).toBe(404)
    await actOnHeld(w, PLAIN)
    expect(w.q("SELECT COUNT(*) AS k FROM moderation_action WHERE public = 1").k).toBe(2)
    const reader = new Browser(w.env)
    for (const f of ['', '?format=json', '?format=text']) {
      const text = await body(await reader.req(`/moderation${f}`, { headers: HTML }))
      expect(text, f).not.toContain(PLAIN)
      expect(text, f).toContain('a link farm') // the row is there, only the address isn't
    }
  })

  it('a post hidden in a branch still waiting on triage shows on the log without the branch address', async () => {
    const w = await world({ clearBranch: false })
    const myra = await signIn(w.env, 'myra')
    const token = formTokenIn(await (await myra.get(post)).text())
    expect((await myra.req(post, { form: { form_token: token, do: 'hide', reason: 'spam in a thread' } })).status).toBe(303)
    const reader = new Browser(w.env)
    for (const f of ['', '?format=json', '?format=text']) {
      const text = await body(await reader.req(`/moderation${f}`, { headers: HTML }))
      expect(text, f).toContain('spam in a thread')
      expect(text, f).not.toContain(EXAMPLE_BRANCH)
    }
  })

  it('a shwarm that was public keeps its address on the log once taken down', async () => {
    const w = await world()
    const myra = await signIn(w.env, 'myra')
    const page = `/admin/node?path=${encodeURIComponent(PLAIN)}`
    const token = formTokenIn(await (await myra.get(page)).text())
    expect((await myra.req(page, { form: { form_token: token, do: 'hide', reason: 'spam' } })).status).toBe(303)
    expect((await new Browser(w.env).req(`/w/${PLAIN}`, { headers: HTML })).status).toBe(410)
    const text = await body(await new Browser(w.env).req('/moderation?format=text'))
    expect(text).toContain(`${PLAIN} (taken down). spam`)
  })
})
