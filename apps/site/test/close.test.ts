// Go-live 6.4: download your data, and closing an account, from the account modal. Both confirm with the password; closing
// also asks for the handle typed out. A closed account's private details, sessions, inbox and links go and its keys are
// revoked; its work stays, every name under its handle shown as "former member". Nobody stands in for an author who's
// gone (decided Oct 14): the crowd's pass is enough.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAccount } from '../src/auth/close'
import { hashPassword } from '../src/auth/password'
import { sweepOutbox } from '../src/jobs/mail'
import { EXPORT_FORMAT } from '../src/read/export'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { agent, MIN, person, refused, site, World } from './core-fixtures'
import { T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv, type TestEnv } from './browser'
import { passedWorld, READ_AT } from './pass-fixture'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(READ_AT)
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
    const w = await passedWorld()
    const env = testEnv(w.db)
    const get = (sql: string, ...args: unknown[]): any => w.db.raw.prepare(sql).get(...args)
    // @kestrel: the old submission #1 (by an agent), an agent's rerun and branch work, and backs on both; @finn_irl: the
    // heads-up, an agent's old people check, the branch's blocked claim and a back on the shwarm's passed claim
    const kestrel = await signIn(env, 'kestrel')
    addKey(env, 'kestrel')
    const kid = get("SELECT id FROM person WHERE handle = 'kestrel'").id
    // a shwarm of kestrel's own, for its page's "started by"
    const own = await w.run<{ path: string }>({ type: 'createNode', actor: site(w.p('kestrel')), input: { kind: 'shwarm', title: 'doom speedruns', what: 'a speedrun category for the mod.', doneWhen: 'a leaderboard with ten verified runs.', tags: ['games'] } })
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(own.path)
    await w.run({ type: 'post', actor: agent(w.p('kestrel'), 'bot'), input: { node: own.path, text: 'agent here' } })

    const pages = ['/w/minecraft-in-doom', '/w/minecraft-in-doom/s/1', `/w/${EXAMPLE_ROOT}/people`, `/w/${EXAMPLE_BRANCH}`, `/w/${EXAMPLE_BRANCH}/people`, '/?tab=new', `/w/${own.path}`]
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
    // the old submission in the thread, and the agent's people check on it
    expect(result).toContain('<div class="c subm" id="p_oldmidsub1"><div class="who"><b>former member</b><span class="sb x">submission #1</span>')
    expect(result).toContain('<li id="c_oldmidchk1"><span class="ck y">✓</span><span>former member · person · played e1m1')
    expect(await read(`/w/${own.path}`)).toContain('started by former member') // the feed's live card names no one
    // the author's tag stays off their agent's posts: "former member" no longer tells the two apart
    const ownPage = await read(`/w/${own.path}`)
    expect(ownPage).toContain('agent here')
    expect(ownPage).toContain('<b>former member</b> · <span')
    expect(ownPage).not.toContain('<b>former member</b> · author')
    expect(await read(`/w/${EXAMPLE_ROOT}?format=text`)).toContain('author="former member" kind=submission')
    expect(await read(`/w/${EXAMPLE_ROOT}/log?filter=all`)).toContain('"by":"former member"')
    // the work itself stays: the submission, its hash and links, the thread posts
    expect(await read('/w/minecraft-in-doom/s/1')).toContain('mcdoom-v0.9.pk3')
    // and so does the claim, its backing gone with the account (status-vote.test.ts has the band)
    const branch = await read(`/w/${EXAMPLE_BRANCH}`)
    expect(branch).toContain('<b>former member</b><span class="ct blocked">says blocked</span>')
    expect(branch).toContain('▲ 0 backers')

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

  it("asks for the password when the window has closed; stops working on others' shwarms (decided Oct 9: no lobby)", async () => {
    const w = await passedWorld()
    const env = testEnv(w.db)
    const get = (sql: string, ...args: unknown[]): any => w.db.raw.prepare(sql).get(...args)
    const b = await signIn(env, 'gunter')
    const gid = get("SELECT id FROM person WHERE handle = 'gunter'").id
    // gunter joined someone else's shwarm, and started one of their own
    const lobby = await w.run<{ path: string }>({ type: 'createNode', actor: site(w.p('lumpy')), input: { kind: 'shwarm', title: 'doom co-op', what: 'two players dig together.', doneWhen: 'two players build one bunker over the network.', tags: ['games'] } })
    await w.run({ type: 'join', actor: site(w.p('gunter')), input: { node: lobby.path } })
    const mine = await w.run<{ path: string }>({ type: 'createNode', actor: site(w.p('gunter')), input: { kind: 'shwarm', title: 'doom music', what: 'a soundtrack.', doneWhen: 'ten tracks under an open license.', tags: ['music'] } })
    vi.setSystemTime(READ_AT + 11 * MIN)
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
    expect(seat(mine.path).left_at).toBeNull() // their own shwarm keeps its author's join
  })

  it("an admin closing their own account loses the admin flag; their shwarm stays, and its people still pass it", async () => {
    const w = new World()
    const myra = await person(w.db, 'myra')
    const [ana, kes, lumpy] = [await person(w.db, 'ana'), await person(w.db, 'kes'), await person(w.db, 'lumpy')]
    w.db.raw.prepare('UPDATE person SET is_admin = 1 WHERE id = ?').run(myra.id)
    const { path } = await w.shwarm(site(myra))
    for (const p of [ana, kes, lumpy]) await w.join(site(p), path)
    const c = await w.post(site(ana), path, 'all nine maps play through.', { claim: 'passed' })
    await w.run({ type: 'back', actor: site(kes), input: { node: path, post: c.id, on: true } })
    await closeAccount(w.db, myra.id, w.now)
    expect(w.get('SELECT is_admin FROM person WHERE id = ?', myra.id).is_admin).toBe(0)
    // nobody stands in for an author who's gone (decided Oct 14): the crowd's pass is enough, and no notice goes to anyone
    w.tick(2 * 24 * 3_600_000)
    await w.run({ type: 'status', actor: site(lumpy), input: { node: path, status: 'on_track' } })
    expect(w.all('SELECT kind, claim_id FROM pass_record')).toEqual([{ kind: 'crowd', claim_id: c.id }])
    expect(w.all("SELECT person_id FROM inbox_item WHERE kind = 'system'")).toEqual([])
  })
})

describe('download your data (6.4)', () => {
  it("everything held about you as one JSON file, behind the password, never another's and never a secret", async () => {
    const w = await passedWorld()
    const env = testEnv(w.db)
    const b = await signIn(env, 'finn_irl')
    addKey(env, 'finn_irl')
    const res = await acct(b, 'finn_irl', { do: 'export' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="shwarm-finn_irl-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const raw = await res.text()
    const data = JSON.parse(raw)
    expect(data.format).toBe(EXPORT_FORMAT)
    expect(data.account).toMatchObject({ handle: 'finn_irl', email: 'finn_irl@example.org', notice_prefs: {} })
    expect(data.sessions.length).toBe(1)
    expect(data.keys).toEqual([expect.objectContaining({ id: 'finn_irl-key', grants: [{ node: '*', perms: ['post'] }], networks: [expect.objectContaining({ ip_prefix: '203.0.113.0/24' })] })])
    expect(data.posts.length).toBeGreaterThan(0)
    expect(data.posts.every((p: any) => p.as_name.startsWith('@finn_irl'))).toBe(true)
    expect(data.checks.some((c: any) => c.verdict === 'pass' && Array.isArray(c.evidence))).toBe(true) // the people check from before Oct 14
    expect(data.status_votes).toEqual([
      expect.objectContaining({ path: EXAMPLE_BRANCH, status: 'blocked', as_name: '@finn_irl' }),
      expect.objectContaining({ path: EXAMPLE_ROOT, status: 'passed', claim: w.claim, as_name: '@finn_irl' }),
    ])
    expect(data.pass_marks).toEqual([])
    for (const k of ['nodes', 'pitch_edits', 'seats', 'post_edits', 'submissions', 'upvotes', 'inbox', 'mail', 'flags', 'reports']) expect(Array.isArray(data[k]), k).toBe(true)
    // no password hash, session id, token, or mail body
    expect(raw).not.toMatch(/pbkdf2|password_hash|"payload"|"id": "[0-9a-f]{64}"/)
    expect(raw).not.toContain('@kestrel') // only their own rows
    for (const k of ['terms_acceptances', 'dms', 'dm_names', 'dm_blocks', 'donations']) expect(data[k], k).toEqual([])
    expect(data.invite).toBeNull()
    expect(data.pending_email_change).toBeNull()
    // the author's own mark is hers to download, with a copy of the claim's pinned work
    const mine = JSON.parse(await (await acct(await signIn(env, 'myra', '198.51.100.20'), 'myra', { do: 'export' })).text())
    expect(mine.pass_marks).toEqual([{ id: w.mark, path: EXAMPLE_ROOT, status: 'passed', at: expect.any(String), claim: w.claim, submission: null, backers: 6, pins: expect.arrayContaining([expect.objectContaining({ commit: '9fceb02d0ae598e95dc970b74767f19372d61af8' })]) }])
  })

  it('also holds the terms versions accepted, agent DMs both ways, DM switches and blocks, donations, the invite and a pending email change', async () => {
    const w = await passedWorld()
    const env = testEnv(w.db)
    const b = await signIn(env, 'marceline')
    const run = (sql: string, ...a: unknown[]) => env.DB.raw.prepare(sql).run(...a)
    const id = (h: string) => env.DB.raw.prepare('SELECT id FROM person WHERE handle = ?').get(h).id
    const [me, lumpy] = [id('marceline'), id('lumpy')]
    const at = (m: number) => new Date(READ_AT + m * MIN).toISOString()
    run("INSERT INTO terms_acceptance (person_id, version, accepted_at, how) VALUES (?, '0.1', ?, 'signup')", me, at(0))
    run("INSERT INTO terms_acceptance (person_id, version, accepted_at, how) VALUES (?, '0.1', ?, 'signup')", lumpy, at(0))
    const dm = (dmId: string, from: number, fromName: string, to: number, toName: string, text: string, reported: string | null) =>
      run('INSERT INTO dm (id, from_person, from_name, key_id, to_person, to_name, text, created_at, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', dmId, from, fromName, 'k1', to, toName, text, at(1), reported)
    dm('d_aaaaaaaa', me, '@marceline/scout', lumpy, '@lumpy/bot', 'hi from scout', at(2))
    dm('d_bbbbbbbb', lumpy, '@lumpy/bot', me, '@marceline/scout', 'hi back', at(3))
    dm('d_cccccccc', lumpy, '@lumpy/bot', lumpy, '@lumpy/other', 'not hers', null)
    run('INSERT INTO dm_name (person_id, name, created_at) VALUES (?, ?, ?)', me, '@marceline/scout', at(0))
    run('INSERT INTO dm_name (person_id, name, created_at) VALUES (?, ?, ?)', lumpy, '@lumpy/bot', at(0))
    run('INSERT INTO dm_block (person_id, by_name, name, created_at) VALUES (?, ?, ?, ?)', me, '@marceline', '@spammer', at(0))
    const gift = (stripe: string, handle: string | null, note: string) =>
      run("INSERT INTO donation (stripe_id, kind, amount_cents, currency, note, handle, public, created_at) VALUES (?, 'once', 500, 'usd', ?, ?, 1, ?)", stripe, note, handle, at(4))
    gift('cs_test_mine', 'marceline', 'keep going')
    gift('cs_test_lumpy', 'lumpy', 'from lumpy')
    gift('cs_test_anon', null, 'anonymous')
    run("INSERT INTO signup_allow (email_norm, note, added_at) VALUES ('marceline@example.org', 'invited by myra', ?)", at(0))
    run("INSERT INTO signup_allow (email_norm, note, added_at) VALUES ('lumpy@example.org', 'invited by bmo', ?)", at(0))
    run("INSERT INTO email_token (id, person_id, purpose, new_email, created_at, expires_at) VALUES ('t-old', ?, 'email_change', 'old@example.org', ?, ?)", me, at(-120), at(-60))
    run("INSERT INTO email_token (id, person_id, purpose, new_email, created_at, expires_at) VALUES ('t-new', ?, 'email_change', 'new@example.org', ?, ?)", me, at(0), at(24 * 60))

    const res = await acct(b, 'marceline', { do: 'export' })
    expect(res.status).toBe(200)
    const raw = await res.text()
    const data = JSON.parse(raw)
    expect(data.terms_acceptances).toEqual([{ version: '0.1', accepted_at: at(0), how: 'signup' }])
    expect(data.dms).toEqual([
      { id: 'd_aaaaaaaa', from_name: '@marceline/scout', to_name: '@lumpy/bot', text: 'hi from scout', created_at: at(1), reported_at: null }, // lumpy's report isn't shown to her
      { id: 'd_bbbbbbbb', from_name: '@lumpy/bot', to_name: '@marceline/scout', text: 'hi back', created_at: at(1), reported_at: at(3) },
    ])
    expect(data.dm_names).toEqual([{ name: '@marceline/scout', created_at: at(0) }])
    expect(data.dm_blocks).toEqual([{ by_name: '@marceline', name: '@spammer', created_at: at(0) }])
    expect(data.donations).toEqual([{ kind: 'once', amount_cents: 500, currency: 'usd', note: 'keep going', handle: 'marceline', public: 1, created_at: at(4) }])
    expect(data.invite).toEqual({ address: 'marceline@example.org', note: 'invited by myra', added_at: at(0), used_at: null })
    expect(data.pending_email_change).toEqual({ new_email: 'new@example.org', created_at: at(0), expires_at: at(24 * 60) })
    // no Stripe ids, token ids or anyone else's rows
    expect(raw).not.toMatch(/cs_test|t-new|t-old|old@example\.org|not hers|from lumpy|invited by bmo|k1"/)
  })

  it('past the window it asks for the password; five an hour; nobody else', async () => {
    const w = await passedWorld()
    const env = testEnv(w.db)
    const b = await signIn(env, 'marceline')
    expect((await acct(b, 'marceline', { do: 'export' })).status).toBe(200)

    // past the window it asks for the password, in the modal
    vi.setSystemTime(READ_AT + 11 * MIN)
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
    const w = await passedWorld()
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
