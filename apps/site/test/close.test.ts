// Go-live 6.4: download your data, and closing an account, from the account modal. Both confirm with the password; closing
// also asks for the handle typed out. A closed account's private details, sessions, inbox and links go and its keys are
// revoked; its work stays, every name under its handle shown as "former member"; a sign-off waiting on it as an author
// goes to the operator (the author-gone rule).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAccount } from '../src/auth/close'
import { ctxAt, findNode, signOffStatements } from '../src/core/context'
import { hashPassword } from '../src/auth/password'
import { sweepOutbox } from '../src/jobs/mail'
import { EXPORT_FORMAT } from '../src/read/export'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { agent, MIN, person, refused, site, stepped, World } from './core-fixtures'
import { T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv, type TestEnv } from './browser'
import { closedWorld } from './result-fixture'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 + 3_600_000)
  resetReadLimit()
  forgetVersions()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const HTML = { accept: 'text/html' }

/** Gives a seeded person a password and a verified address, and signs them in (which opens the step-up window). */
async function signIn(env: TestEnv, handle: string, ip = '203.0.113.9') {
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  env.DB.raw
    .prepare('UPDATE person SET password_hash = ?, email = ?, email_norm = ?, email_verified_at = coalesce(email_verified_at, ?) WHERE handle = ?')
    .run(hash, `${handle}@example.org`, `${handle}@example.org`, new Date(T0).toISOString(), handle)
  const b = new Browser(env, ip)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}

/** Sends one of the account modal's forms from the owner's profile, with the form token from the page. */
async function acct(b: Browser, handle: string, form: Record<string, string>) {
  const token = formTokenIn(await (await b.get(`/@${handle}?account=1`)).text())
  return b.req(`/@${handle}`, { form: { form_token: token, ...form } })
}

/** A key row, as 7.2 will make them (the table exists from 2.2). */
function addKey(env: TestEnv, handle: string) {
  const pid = env.DB.raw.prepare('SELECT id FROM person WHERE handle = ?').get(handle).id
  env.DB.raw
    .prepare("INSERT INTO agent_key (id, person_id, name, public_key, can_post_as, created_at) VALUES (?, ?, 'laptop', 'pk', ?, ?)")
    .run(`${handle}-key`, pid, `@${handle}/*`, new Date(T0).toISOString())
  env.DB.raw.prepare("INSERT INTO key_grant (key_id, node, perms) VALUES (?, '*', '[\"post\"]')").run(`${handle}-key`)
  env.DB.raw.prepare("INSERT INTO key_network (key_id, ip_prefix, first_seen, last_seen) VALUES (?, '203.0.113.0/24', ?, ?)").run(`${handle}-key`, new Date(T0).toISOString(), new Date(T0).toISOString())
}

describe('closing an account (6.4)', () => {
  it("a closed test account's posts show as a former member everywhere, and its keys fail", async () => {
    const w = await closedWorld()
    const env = testEnv(w.db)
    const get = (sql: string, ...args: unknown[]): any => w.db.raw.prepare(sql).get(...args)
    // @kestrel: the passing submission (by an agent), branch work; @finn_irl: built on, an agent's run report on the branch
    const kestrel = await signIn(env, 'kestrel')
    addKey(env, 'kestrel')
    const kid = get("SELECT id FROM person WHERE handle = 'kestrel'").id
    // a shwarm of kestrel's own, for the feed's "started by"
    const own = await w.run<{ path: string }>({ type: 'createNode', actor: site(w.p('kestrel')), input: { kind: 'shwarm', title: 'doom speedruns', what: 'a speedrun category for the mod.', doneWhen: 'a leaderboard with ten verified runs.', check: { author: true }, tags: ['games'], lobby: 2 } })
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(own.path)
    await w.run({ type: 'post', actor: agent(w.p('kestrel'), 'bot'), input: { node: own.path, text: 'agent here' } })

    const pages = ['/w/minecraft-in-doom', '/w/minecraft-in-doom?thread=1', '/w/minecraft-in-doom/s/1', `/w/${EXAMPLE_BRANCH}`, `/w/${EXAMPLE_BRANCH}/s/1`, `/w/${EXAMPLE_BRANCH}/s/2`, '/?tab=new', `/w/${own.path}`]
    const machine = [`/w/${EXAMPLE_ROOT}?format=text`, `/w/${EXAMPLE_ROOT}?format=json`, `/w/${EXAMPLE_ROOT}/log?filter=all`, `/w/${EXAMPLE_BRANCH}?format=text`, `/w/${EXAMPLE_BRANCH}?format=json`, `/w/${EXAMPLE_BRANCH}/log?filter=all`]
    const reader = new Browser(env, '198.51.100.7')
    const read = async (path: string) => body(await reader.req(path, path.includes('format=') || path.includes('/log') ? {} : { headers: HTML }))
    // before: both handles show
    const before = (await Promise.all([...pages, ...machine].map(read))).join('\n')
    expect(before).toContain('@kestrel')
    expect(before).toContain('@finn_irl')

    // the modal: the handle typed wrong is refused at its field, nothing changes
    let res = await acct(kestrel, 'kestrel', { do: 'close', confirm: 'kestrl' })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('type kestrel to confirm.')
    expect(get('SELECT status FROM person WHERE id = ?', kid).status).toBe('active')
    res = await acct(kestrel, 'kestrel', { do: 'close', confirm: '@Kestrel' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/@kestrel')
    expect(kestrel.jar.has('__Host-shwarm')).toBe(false)
    expect(await closeAccount(w.db, kid)).toBeNull() // closing again does nothing
    await closeAccount(w.db, get("SELECT id FROM person WHERE handle = 'finn_irl'").id)

    // the profile is a tombstone; sign-in with the old address fails
    const tomb = await kestrel.req('/@kestrel', { headers: HTML })
    expect(tomb.status).toBe(410)
    expect(await body(tomb)).toContain('this account was closed. what it posted stays in the threads.')
    const again = new Browser(env, '198.51.100.40')
    await again.post('/signin', { email: 'kestrel@example.org', password: GOOD_PASSWORD })
    expect(again.jar.has('__Host-shwarm')).toBe(false)

    // every page and agent view: no @kestrel or @finn_irl, "former member" in their place
    forgetVersions()
    for (const path of [...pages, ...machine]) {
      const r = await reader.req(path, path.includes('format=') || path.includes('/log') ? {} : { headers: HTML })
      expect(r.status, path).toBe(200)
      const text = await body(r)
      expect(text, path).not.toMatch(/@kestrel|@finn_irl/)
    }
    const result = await read('/w/minecraft-in-doom')
    expect(result).toContain('<div class="src">from <a href="/w/minecraft-in-doom/s/1">submission #1</a>, by former member</div>')
    expect(await read('/?tab=new')).toContain('started by former member')
    // the author's tag stays off their agent's posts: "former member" no longer tells the two apart
    const ownPage = await read(`/w/${own.path}?thread=1`)
    expect(ownPage).toContain('agent here')
    expect(ownPage).toContain('<b>former member</b> · <span')
    expect(ownPage).not.toContain('<b>former member</b> · author')
    expect(await read(`/w/${EXAMPLE_ROOT}?format=text`)).toContain('author="former member" kind=submission')
    expect(await read(`/w/${EXAMPLE_ROOT}/log?filter=all`)).toContain('"by":"former member"')
    // the work itself stays: the submission, its hash and links, the thread posts
    expect(await read('/w/minecraft-in-doom/s/1')).toContain('mcdoom-v1.pk3')

    // the data: private details gone, sessions and inbox gone, keys revoked, the closing mail to the old address
    const p = get('SELECT * FROM person WHERE id = ?', kid)
    expect(p).toMatchObject({ status: 'closed', email: '', email_norm: `closed:${kid}`, password_hash: 'closed', display_name: '', about: '', links: '[]', notice_prefs: '{}', is_admin: 0 })
    expect(p.closed_at).toBeTruthy()
    expect(p.handle).toBe('kestrel') // kept, so nobody else can take it
    for (const t of ['session', 'email_token', 'inbox_item']) expect(get(`SELECT COUNT(*) AS n FROM ${t} WHERE person_id = ?`, kid).n, t).toBe(0)
    expect(get('SELECT COUNT(*) AS n FROM mention WHERE to_person = ?', kid).n).toBe(0)
    expect(get("SELECT revoked_at FROM agent_key WHERE id = 'kestrel-key'").revoked_at).toBeTruthy()
    expect(get("SELECT COUNT(*) AS n FROM key_network WHERE key_id = 'kestrel-key'").n).toBe(0)
    const mail = w.db.raw.prepare('SELECT to_email, template, stream FROM email_outbox WHERE person_id = ?').all(kid).map((r: any) => ({ ...r }))
    expect(mail).toEqual([{ to_email: 'kestrel@example.org', template: 'account_closed', stream: 'security' }])
    // once the sweep has sent it, that row lets go of the address and the account too
    const sent: string[] = []
    const resend = (async (_u: string, init: RequestInit) => (sent.push(JSON.parse(String(init.body)).to[0]), new Response('{"id":"re_1"}', { status: 200 }))) as unknown as typeof fetch
    await sweepOutbox({ DB: w.db, ENV: 'production', SITE_URL: 'https://shwarm.org', RESEND_API_KEY: 're_key', MAIL_SECRET: 'mail-secret' } as any, { now: Date.now(), fetch: resend })
    expect(sent).toContain('kestrel@example.org')
    expect(get('SELECT COUNT(*) AS n FROM email_outbox WHERE person_id = ?', kid).n).toBe(0)
    expect(get("SELECT COUNT(*) AS n FROM email_outbox WHERE to_email = 'kestrel@example.org'").n).toBe(0)
    expect(get("SELECT to_email, person_id, provider_id FROM email_outbox WHERE template = 'account_closed' AND json_extract(payload, '$.handle') = 'kestrel'")).toEqual({ to_email: '', person_id: null, provider_id: 're_1' })
    // posts, submissions and checks stay under the account
    expect(get('SELECT COUNT(*) AS n FROM post WHERE person_id = ?', kid).n).toBeGreaterThan(0)
    // its keys fail: an agent acting under the closed account is refused before anything is written
    await refused(w.run({ type: 'post', actor: agent(w.p('kestrel'), 'swarm/r-40'), input: { node: EXAMPLE_ROOT, text: 'still here?' } }), 'not_permitted', { reason: 'closed' })
    // the address is free to sign up again
    expect(get("SELECT COUNT(*) AS n FROM person WHERE email_norm = 'kestrel@example.org'").n).toBe(0)
  })

  it('asks for the password when the window has closed; gives up a seat in a lobby that is filling', async () => {
    const w = await closedWorld()
    const env = testEnv(w.db)
    const get = (sql: string, ...args: unknown[]): any => w.db.raw.prepare(sql).get(...args)
    const b = await signIn(env, 'gunter')
    const gid = get("SELECT id FROM person WHERE handle = 'gunter'").id
    // gunter sits in someone else's lobby, and in one of their own
    const lobby = await w.run<{ path: string }>({ type: 'createNode', actor: site(w.p('lumpy')), input: { kind: 'shwarm', title: 'doom co-op', what: 'two players dig together.', doneWhen: 'two players build one bunker over the network.', check: { author: true }, tags: ['games'], lobby: 4 } })
    await w.run({ type: 'join', actor: site(w.p('gunter')), input: { node: lobby.path } })
    const mine = await w.run<{ path: string }>({ type: 'createNode', actor: site(w.p('gunter')), input: { kind: 'shwarm', title: 'doom music', what: 'a soundtrack.', doneWhen: 'ten tracks under an open license.', check: { author: true }, tags: ['music'], lobby: 4 } })
    vi.setSystemTime(T0 + 3_600_000 + 11 * MIN)
    let res = await acct(b, 'gunter', { do: 'close', confirm: 'gunter' })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('enter your password to confirm.')
    res = await acct(b, 'gunter', { do: 'close', confirm: 'gunter', password: 'wrong password here' })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain("that password doesn't match.")
    expect(get('SELECT status FROM person WHERE id = ?', gid).status).toBe('active')
    res = await acct(b, 'gunter', { do: 'close', confirm: 'gunter', password: GOOD_PASSWORD })
    expect(res.status).toBe(303)
    expect(get('SELECT status FROM person WHERE id = ?', gid).status).toBe('closed')
    const seat = (path: string) => get('SELECT s.left_at FROM seat s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.person_id = ?', path, gid)
    expect(seat(lobby.path).left_at).toBeTruthy()
    expect(seat(mine.path).left_at).toBeNull() // their own lobby keeps its author's seat
  })

  it("an author's waiting sign-off goes to the operator, who can sign it off", async () => {
    const w = new World()
    const myra = await person(w.db, 'myra')
    const ops = await person(w.db, 'ops')
    const ana = await person(w.db, 'ana')
    w.db.raw.prepare('UPDATE person SET is_admin = 1 WHERE id = ?').run(ops.id)
    const { path } = await w.shwarm(site(myra), { lobby: 1 })
    const sub = await w.submit(site(ana), path)
    expect(w.all("SELECT person_id FROM inbox_item WHERE kind = 'sign_off'").map(r => r.person_id)).toEqual([myra.id])
    await closeAccount(w.db, myra.id, w.now)
    const items = w.all("SELECT person_id, post_id, text FROM inbox_item WHERE kind = 'sign_off'")
    expect(items).toEqual([{ person_id: ops.id, post_id: sub.id, text: '#1 on minecraft in doom is ready for sign-off. its author is gone, so the operator signs off.' }])
    const mail = w.all("SELECT person_id, payload FROM email_outbox WHERE template = 'sign_off_ready'").map(r => ({ ...r, payload: JSON.parse(r.payload) }))
    expect(mail.at(-1)).toMatchObject({ person_id: ops.id, payload: { author_gone: true, author: 'myra', handle: 'ops', number: 1 } })
    const r = await w.signOff(stepped(ops), path, sub.id, 'pass')
    expect(r).toMatchObject({ submission_state: 'passed', node_state: 'closed' })
    expect(w.events(path, 'signed_off')[0].detail).toContain('author gone, signed off by the operator')
  })

  it('a sign-off that turns ready as the author closes reaches the operator, whichever batch lands first', async () => {
    const w = new World()
    const myra = await person(w.db, 'myra')
    const ops = await person(w.db, 'ops')
    const ana = await person(w.db, 'ana')
    w.db.raw.prepare('UPDATE person SET is_admin = 1 WHERE id = ?').run(ops.id)
    const { path } = await w.shwarm(site(myra), { lobby: 1 })
    const sub = await w.submit(site(ana), path)
    const signOffs = () => w.all("SELECT person_id, post_id FROM inbox_item WHERE kind = 'sign_off'")
    const mailed = () => w.all("SELECT person_id, payload FROM email_outbox WHERE template = 'sign_off_ready'").map(r => ({ person_id: r.person_id, ...JSON.parse(r.payload) }))
    const item = w.get("SELECT * FROM inbox_item WHERE kind = 'sign_off'")
    const notYet = () => w.db.raw.exec("DELETE FROM inbox_item WHERE kind = 'sign_off'; DELETE FROM email_outbox WHERE template = 'sign_off_ready'")

    // The check's batch first: it commits the author's item after closeAccount has looked, before its batch runs.
    notYet()
    const batch = w.db.batch.bind(w.db)
    const spy = vi.spyOn(w.db, 'batch').mockImplementationOnce(async stmts => {
      w.db.raw.prepare('INSERT INTO inbox_item (person_id, kind, node_id, post_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(item.person_id, item.kind, item.node_id, item.post_id, item.text, item.created_at)
      return batch(stmts)
    })
    await closeAccount(w.db, myra.id, w.now)
    spy.mockRestore()
    expect(signOffs()).toEqual([{ person_id: ops.id, post_id: sub.id }])
    expect(mailed()).toEqual([expect.objectContaining({ person_id: ops.id, author: 'myra', author_gone: true, number: 1, link: `/w/${path}/s/1` })])

    // The close first: the check loaded the node while the author was active, and its batch lands after.
    notYet()
    w.db.raw.prepare("UPDATE person SET status = 'active' WHERE id = ?").run(myra.id)
    const stale = await findNode(ctxAt(w.db, w.now), path)
    w.db.raw.prepare("UPDATE person SET status = 'closed' WHERE id = ?").run(myra.id)
    expect(stale?.author_status).toBe('active')
    await w.db.batch(signOffStatements(ctxAt(w.db, w.now), stale!, { postId: sub.id, number: 1 }, true))
    expect(signOffs()).toEqual([{ person_id: ops.id, post_id: sub.id }])
    expect(mailed()).toEqual([expect.objectContaining({ person_id: ops.id, author: 'myra', author_gone: true, only: true, title: 'minecraft in doom' })])
  })

  it('an admin closing their own account hands nothing to themselves', async () => {
    const w = new World()
    const myra = await person(w.db, 'myra')
    const ana = await person(w.db, 'ana')
    w.db.raw.prepare('UPDATE person SET is_admin = 1 WHERE id = ?').run(myra.id)
    const { path } = await w.shwarm(site(myra), { lobby: 1 })
    await w.submit(site(ana), path)
    await closeAccount(w.db, myra.id, w.now)
    expect(w.all("SELECT person_id FROM inbox_item WHERE kind = 'sign_off'")).toEqual([])
    expect(w.get('SELECT is_admin FROM person WHERE id = ?', myra.id).is_admin).toBe(0)
  })
})

describe('download your data (6.4)', () => {
  it("everything held about you as one JSON file, behind the password, never another's and never a secret", async () => {
    const w = await closedWorld()
    const env = testEnv(w.db)
    const b = await signIn(env, 'marceline')
    addKey(env, 'marceline')
    const res = await acct(b, 'marceline', { do: 'export' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="shwarm-marceline-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const raw = await res.text()
    const data = JSON.parse(raw)
    expect(data.format).toBe(EXPORT_FORMAT)
    expect(data.account).toMatchObject({ handle: 'marceline', email: 'marceline@example.org', notice_prefs: {} })
    expect(data.sessions.length).toBe(1)
    expect(data.keys).toEqual([expect.objectContaining({ id: 'marceline-key', grants: [{ node: '*', perms: ['post'] }], networks: [expect.objectContaining({ ip_prefix: '203.0.113.0/24' })] })])
    expect(data.posts.length).toBeGreaterThan(0)
    expect(data.posts.every((p: any) => p.as_name.startsWith('@marceline'))).toBe(true)
    expect(data.checks.some((c: any) => c.verdict === 'pass' && Array.isArray(c.evidence))).toBe(true)
    for (const k of ['nodes', 'pitch_edits', 'seats', 'post_edits', 'submissions', 'upvotes', 'inbox', 'mail', 'flags', 'reports']) expect(Array.isArray(data[k]), k).toBe(true)
    // no password hash, session id, token, or mail body
    expect(raw).not.toMatch(/pbkdf2|password_hash|"payload"|"id": "[0-9a-f]{64}"/)
    expect(raw).not.toContain('@kestrel') // only their own rows

    // past the window it asks for the password, in the modal
    vi.setSystemTime(T0 + 3_600_000 + 11 * MIN)
    const asked = await acct(b, 'marceline', { do: 'export' })
    expect(asked.status).toBe(400)
    expect(await body(asked)).toContain('enter your password to confirm.')
    expect((await acct(b, 'marceline', { do: 'export', password: GOOD_PASSWORD })).status).toBe(200)
    // five an hour
    for (let i = 0; i < 3; i++) expect((await acct(b, 'marceline', { do: 'export' })).status).toBe(200)
    const slow = await acct(b, 'marceline', { do: 'export' })
    expect(slow.status).toBe(429)
    expect(await body(slow)).toContain("that's a lot of downloads.")
    // nobody else's: another session posting to marceline's profile is refused
    const other = await signIn(env, 'lumpy', '198.51.100.9')
    const token = formTokenIn(await (await other.get('/@lumpy')).text())
    expect((await other.req('/@marceline', { form: { form_token: token, do: 'export' } })).status).toBe(403)
  })

  it('the modal shows the section to its owner', async () => {
    const w = await closedWorld()
    const env = testEnv(w.db)
    const b = await signIn(env, 'marceline')
    const html = await body(await b.get('/@marceline?account=1'))
    expect(html).toContain('<h3>your data</h3>')
    expect(html).toContain('<button class="btn plain" type="submit">download your data</button>')
    expect(html).toContain('<summary class="btn plain">close your account</summary>')
    expect(html).toContain('type marceline to confirm')
    expect(html).toContain('<button class="btn" type="submit">close my account</button>')
  })
})
