// Go-live 9.3, the flag half (A7): "flag this shwarm" / "flag this branch" on node pages (signed in, verified, once per
// node, never your own), a mail to each admin per flag, and the pause at the third open flag from established accounts:
// the "paused for review" banner, no writes from the site or an agent key, the note in the agent text and JSON, until
// the operator unpauses it (scripts/triage.mjs unpause, triage/decide.ts unpauseStatements).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { hashPassword } from '../src/auth/password'
import { FLAG_REASONS, flagNode } from '../src/core/flags'
import { renderMail } from '../src/email/templates'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { flagsSql, toSqlScript, unpauseStatements } from '../src/triage/decide'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { keyFor, send } from './agent-client'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, mails, pepper, testEnv } from './browser'
import { stagingWorld } from './node-fixture'
import { treeNamespace } from './tree'

const HTML = { accept: 'text/html' }
const iso = (ms: number) => new Date(ms).toISOString()
const ROOT = `/w/${EXAMPLE_ROOT}`

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

async function world(o: { siteMode?: string } = {}) {
  const w = await stagingWorld()
  const env = { ...testEnv(w.db), ...(o.siteMode ? { SITE_MODE: o.siteMode, TREE: treeNamespace(w.db, { ENV: 'test', SITE_MODE: o.siteMode }).ns } : {}) }
  const raw = w.db.raw
  const q = <T = any>(sql: string, ...args: unknown[]) => raw.prepare(sql).get(...args) as T
  const all = <T = any>(sql: string, ...args: unknown[]) => raw.prepare(sql).all(...args).map((r: any) => ({ ...r })) as T[]
  raw.prepare('UPDATE person SET password_hash = ?, is_admin = 1 WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), w.myraId)
  // A second admin: every flag mails each of them once.
  const op = await addPerson(env.DB, 'op')
  raw.prepare('UPDATE person SET is_admin = 1, email_verified_at = ? WHERE id = ?').run(iso(T0), op)
  raw.prepare("UPDATE person SET is_admin = 0 WHERE handle NOT IN ('myra', 'op')").run()
  const nodeId = q<{ id: number }>('SELECT id FROM node WHERE path = ?', EXAMPLE_ROOT).id
  const flags = () => all('SELECT node_id, post_id, person_id, reason, resolved_at FROM flag ORDER BY id')
  const flagMails = () => mails(env.DB as any).filter(m => m.template === 'node_flag')
  const paused = () => q<{ paused: number }>('SELECT paused FROM node WHERE id = ?', nodeId).paused
  return { ...w, env, q, all, nodeId, flags, flagMails, paused }
}

/**
 * A signed-in browser for a new verified account. `established`: founding (counts toward the pause) or not (a new
 * account, established_at not reached yet).
 */
async function signIn(env: ReturnType<typeof testEnv>, handle: string, o: { established?: boolean; verified?: boolean } = {}) {
  const pid = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
  if (o.verified !== false) env.DB.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(iso(T0), pid)
  if (o.established !== false) env.DB.raw.prepare('UPDATE person SET founding = 1 WHERE id = ?').run(pid)
  else env.DB.raw.prepare('UPDATE person SET founding = 0, established_at = ? WHERE id = ?').run(iso(T0 + 7 * 86_400_000), pid)
  const b = new Browser(env)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return Object.assign(b, { pid })
}

const page = async (b: Browser, path = ROOT) => body(await b.req(path, { headers: HTML }))
/** The head's meta line, where the flag control is. */
const metaIn = (html: string) => {
  const i = html.indexOf('<div class="meta">')
  expect(i).toBeGreaterThan(-1)
  return html.slice(i, html.indexOf('<div class="pitch">', i))
}
async function act(b: Browser, fields: Record<string, string>, path = ROOT) {
  const token = formTokenIn(await page(b, path))
  return b.req(path, { form: { form_token: token, ...fields } })
}
const flag = (b: Browser, reason = 'spam', path = ROOT) => act(b, { do: 'flag', reason }, path)

describe('"flag this shwarm"', () => {
  it('lands, mails each admin once, and the control then says "you flagged this"', async () => {
    const { env, nodeId, flags, flagMails, paused } = await world()
    const ana = await signIn(env, 'ana')
    const meta = metaIn(await page(ana))
    expect(meta).toContain('<summary>flag this shwarm</summary>')
    expect(meta).toContain('<input type="hidden" name="do" value="flag"/>')
    for (const r of FLAG_REASONS) expect(meta).toContain(`value="${r}"`)
    expect(meta).not.toContain('value="other"')
    const res = await act(ana, { do: 'flag', reason: 'weapons' }, `${ROOT}?sort=new`)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${ROOT}?sort=new`)
    expect(flags()).toEqual([{ node_id: nodeId, post_id: null, person_id: ana.pid, reason: 'weapons', resolved_at: null }])
    expect(paused()).toBe(0)
    const sent = flagMails()
    expect(sent.map(m => m.to_email).sort()).toEqual(['myra@example.org', 'op@example.org'])
    expect(sent.every(m => m.stream === 'account')).toBe(true)
    const payload = JSON.parse(sent[0].payload)
    expect(payload).toMatchObject({ by: '@ana', reason: 'weapons', kind: 'shwarm', path: EXAMPLE_ROOT, link: ROOT, paused: 0, was_paused: 0, established: 1 })
    const mail = renderMail('node_flag', payload, { siteUrl: 'https://shwarm.org', stream: 'account' })
    expect(mail.text).toContain(`@ana flagged the shwarm ${EXAMPLE_ROOT} (<staging|production>).`)
    expect(mail.text).toContain('1 of 3 flags from established accounts so far.')
    expect(mail.text).not.toContain('unpause')
    const after = metaIn(await page(ana))
    expect(after).toContain('you flagged this')
    expect(after).not.toContain('value="flag"')
  })

  it('a second flag by the same person adds no row and no mail, and says so', async () => {
    const { env, flags, flagMails } = await world()
    const ana = await signIn(env, 'ana')
    const token = formTokenIn(await page(ana))
    expect((await ana.req(ROOT, { form: { form_token: token, do: 'flag', reason: 'spam' } })).status).toBe(303)
    const again = await ana.req(ROOT, { form: { form_token: token, do: 'flag', reason: 'copyright' } })
    expect(again.status).toBe(200)
    expect(metaIn(await body(again))).toContain('you already flagged this shwarm.')
    expect(flags()).toHaveLength(1)
    expect(flags()[0].reason).toBe('spam')
    expect(flagMails()).toHaveLength(2) // one per admin, once
    // core says the same to a direct call
    expect(await flagNode(env.DB, { by: { personId: ana.pid }, nodeId: flags()[0].node_id, path: EXAMPLE_ROOT, reason: 'illegal' })).toBe('already')
    expect(flagMails()).toHaveLength(2)
  })

  it('the author has no control on their own node, and a forged flag of it is refused', async () => {
    const { env, flags, flagMails } = await world()
    const myra = new Browser(env)
    expect((await myra.post('/signin', { email: 'myra@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    const html = await page(myra)
    expect(metaIn(html)).not.toContain('flag')
    const res = await myra.req(ROOT, { form: { form_token: formTokenIn(html), do: 'flag', reason: 'spam' } })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain("you can't flag your own shwarm.")
    expect(flags()).toEqual([])
    expect(flagMails()).toEqual([])
  })

  it('refuses a missing or unknown reason with the form open, and an unverified account', async () => {
    const { env, flags } = await world()
    const ana = await signIn(env, 'ana')
    const res = await act(ana, { do: 'flag' })
    expect(res.status).toBe(400)
    const meta = metaIn(await body(res))
    expect(meta).toContain('<details class="flag" open="">')
    expect(meta).toContain('pick what is wrong.')
    expect((await flag(ana, 'other')).status).toBe(400)
    const quiet = await signIn(env, 'quiet', { verified: false })
    const html = await page(quiet)
    expect(metaIn(html)).not.toContain('flag')
    const q = await quiet.req(ROOT, { form: { form_token: formTokenIn(html), do: 'flag', reason: 'spam' } })
    expect(q.status).toBe(400)
    expect(await body(q)).toContain('verify your email first.')
    expect(flags()).toEqual([])
  })

  it('a branch page says "flag this branch"', async () => {
    const { env, all } = await world()
    const ana = await signIn(env, 'ana')
    const path = `/w/${EXAMPLE_BRANCH}`
    expect(metaIn(await page(ana, path))).toContain('<summary>flag this branch</summary>')
    expect((await flag(ana, 'personal_info', path)).status).toBe(303)
    expect(all('SELECT n.path, f.reason FROM flag f JOIN node n ON n.id = f.node_id')).toEqual([{ path: EXAMPLE_BRANCH, reason: 'personal_info' }])
  })

  it('signed out, the control goes to sign-in, and so does a POST', async () => {
    const { env, flags } = await world()
    const out = new Browser(env)
    expect(metaIn(await page(out))).toContain(`<a class="flag-it" href="/signin?next=${encodeURIComponent(ROOT)}">flag this shwarm</a>`)
    const res = await out.req(ROOT, { form: { do: 'flag', reason: 'spam' } })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`/signin?next=${encodeURIComponent(ROOT)}`)
    expect(flags()).toEqual([])
  })

  it('refuses a form without its token (CSRF)', async () => {
    const { env, flags, flagMails } = await world()
    const ana = await signIn(env, 'ana')
    expect((await ana.req(ROOT, { form: { form_token: 'forged', do: 'flag', reason: 'spam' } })).status).toBe(403)
    expect((await ana.req(ROOT, { form: { do: 'flag', reason: 'spam' } })).status).toBe(403)
    // another site's page posting the form, with this browser's cookie
    expect((await ana.req(ROOT, { form: { form_token: formTokenIn(await page(ana)), do: 'flag', reason: 'spam' }, headers: { origin: 'https://evil.example' } })).status).toBe(403)
    expect(flags()).toEqual([])
    expect(flagMails()).toEqual([])
  })

  it('in beta, an account that is not invited may still flag', async () => {
    const { env, flags, flagMails } = await world({ siteMode: 'beta' })
    const ana = await signIn(env, 'ana', { established: false })
    // it can't post here in beta...
    const post = await act(ana, { do: 'post', text: 'hello' })
    expect(post.status).toBe(400)
    expect(await body(post)).toContain('shwarm opens soon')
    // ...but it can flag
    expect(metaIn(await page(ana))).toContain('<summary>flag this shwarm</summary>')
    expect((await flag(ana)).status).toBe(303)
    expect(flags()).toHaveLength(1)
    expect(flagMails()).toHaveLength(2)
  })
})

describe('the pause', () => {
  it("two flags from accounts not yet established and one from an established account don't pause", async () => {
    const { env, flags, flagMails, paused } = await world()
    for (const h of ['new_one', 'new_two']) expect((await flag(await signIn(env, h, { established: false }))).status).toBe(303)
    expect((await flag(await signIn(env, 'est_one'))).status).toBe(303)
    expect(flags()).toHaveLength(3)
    expect(paused()).toBe(0)
    expect(flagMails().map(m => JSON.parse(m.payload).established)).toEqual([0, 0, 0, 0, 1, 1])
    expect(await page(new Browser(env))).not.toContain('paused for review')
  })

  it('flags from accounts that become established later still count for nothing', async () => {
    const { env, paused } = await world()
    // two new accounts flag now; a week later both are established
    for (const h of ['new_one', 'new_two']) expect((await flag(await signIn(env, h, { established: false }))).status).toBe(303)
    vi.setSystemTime(T0 + 8 * 86_400_000)
    expect((await flag(await signIn(env, 'est_one'))).status).toBe(303)
    expect(paused()).toBe(0)
  })

  it('three from established accounts pause it: the banner, the mail, the agent view, and no writes from the site or a key', async () => {
    const { env, nodeId, all, flagMails, paused } = await world()
    const one = await signIn(env, 'est_one')
    const two = await signIn(env, 'est_two')
    const three = await signIn(env, 'est_three')
    // a non-established flag in between counts for nothing
    expect((await flag(await signIn(env, 'new_one', { established: false }))).status).toBe(303)
    expect((await flag(one)).status).toBe(303)
    expect((await flag(two, 'weapons')).status).toBe(303)
    expect(paused()).toBe(0)
    expect((await flag(three, 'surveillance')).status).toBe(303)
    expect(paused()).toBe(1)
    // the record, kept private (it names the flagger whose flag made the third)
    expect(all('SELECT by_person, action, node_id, reason, public FROM moderation_action')).toEqual([
      { by_person: three.pid, action: 'pause', node_id: nodeId, reason: 'flagged by 3 established accounts', public: 0 },
    ])
    // the third flag's mail says it paused, and how to unpause
    const last = flagMails().slice(-2)
    expect(last.map(m => JSON.parse(m.payload)).map(p => [p.paused, p.was_paused, p.established])).toEqual([[1, 0, 3], [1, 0, 3]])
    const mail = renderMail('node_flag', { ...JSON.parse(last[0].payload), env: 'production' }, { siteUrl: 'https://shwarm.org', stream: 'account' })
    expect(mail.subject).toMatch(/^paused for review: /)
    expect(mail.text).toContain('that makes 3 flags from established accounts, so it is paused now.')
    expect(mail.text).toContain(`node scripts/triage.mjs unpause ${EXAMPLE_ROOT} "<reason>" --env production`)
    // a fourth flag still lands and mails, as already paused, and pauses nothing again
    expect((await flag(await signIn(env, 'est_four'), 'copyright')).status).toBe(303)
    expect(JSON.parse(flagMails().at(-1)!.payload)).toMatchObject({ paused: 0, was_paused: 1, established: 4 })
    expect(all("SELECT 1 FROM moderation_action WHERE action = 'pause'")).toHaveLength(1)

    // the banner, for everyone (signed out too), and no compose box
    const out = await page(new Browser(env))
    expect(out).toContain('<p class="held paused" role="status">paused for review.')
    expect(out).toContain('<div class="to">paused for review</div>')
    expect(out).not.toContain('name="do" value="post"')
    // the agent text and JSON
    const text = await body(await new Browser(env).req(ROOT, { headers: { accept: 'text/plain' } }))
    expect(text).toContain('paused: for review.')
    expect(text).toContain('paused for review: anything sent here is refused (403 not_permitted, reason paused)')
    const json = JSON.parse(await body(await new Browser(env).req(ROOT, { headers: { accept: 'application/json' } })))
    expect(json.paused).toBe(true)

    // writes are refused: a post from the site...
    const posts = () => all('SELECT id FROM post p WHERE p.node_id = ?', nodeId).length
    const before = posts()
    const ana = await signIn(env, 'ana')
    const res = await act(ana, { do: 'post', text: 'still here?' })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain(`${EXAMPLE_ROOT} is paused.`)
    // ...and from an agent key
    const key = await keyFor(env.DB, ana.pid, { canPostAs: '@ana/*' })
    const r = await send(app, env, key, { path: ROOT, body: { as: '@ana/bot', kind: 'post', text: 'still here?' } })
    expect(r.status).toBe(403)
    expect(r.json).toMatchObject({ error: 'not_permitted', reason: 'paused' })
    expect(posts()).toBe(before)
  })

  it('two flags at once: the third pauses exactly once', async () => {
    const { env, nodeId, all, paused } = await world()
    const ps = await Promise.all(['a_one', 'a_two', 'a_three', 'a_four'].map(h => signIn(env, h)))
    const results = await Promise.all(ps.map(p => flagNode(env.DB, { by: { personId: p.pid }, nodeId, path: EXAMPLE_ROOT, reason: 'spam' })))
    expect(results.filter(r => r === 'paused')).toHaveLength(1)
    expect(results.filter(r => r === 'ok')).toHaveLength(3)
    expect(paused()).toBe(1)
    expect(all("SELECT 1 FROM moderation_action WHERE action = 'pause'")).toHaveLength(1)
  })

  it('unpause (the SQL triage.mjs runs) lifts it, resolves the flags, and lets writes in again', async () => {
    const { env, db, nodeId, all, flags, paused } = await world()
    for (const h of ['est_one', 'est_two', 'est_three']) expect((await flag(await signIn(env, h))).status).toBe(303)
    expect(paused()).toBe(1)
    // the flags queue lists it, paused
    const queue = db.raw.prepare(flagsSql()).all()
    expect(queue.map((r: any) => ({ path: r.path, paused: r.paused, open: r.open, established: r.established }))).toEqual([{ path: EXAMPLE_ROOT, paused: 1, open: 3, established: 3 }])
    // what the script sends: one file, applied whole
    const stmts = unpauseStatements({ path: EXAMPLE_ROOT, reason: 'looked: a game mod, not a weapon', at: iso(T0 + 60_000) })
    expect(toSqlScript(stmts)).toContain("'unpause'")
    db.raw.exec(toSqlScript(stmts))
    expect(paused()).toBe(0)
    expect(flags().every(f => f.resolved_at === iso(T0 + 60_000))).toBe(true)
    expect(all("SELECT action, reason, public FROM moderation_action WHERE action = 'unpause'")).toEqual([{ action: 'unpause', reason: 'looked: a game mod, not a weapon', public: 1 }])
    expect(db.raw.prepare(flagsSql()).all()).toEqual([])
    // the banner is gone (the signed-out version moved), and posting works again
    expect(await page(new Browser(env))).not.toContain('paused for review')
    const ana = await signIn(env, 'ana')
    expect((await act(ana, { do: 'post', text: 'back to work' })).status).toBe(303)
    // the count starts over: three new flags pause it again
    for (const h of ['est_four', 'est_five']) expect((await flag(await signIn(env, h))).status).toBe(303)
    expect(paused()).toBe(0)
    expect((await flag(ana)).status).toBe(303)
    expect(paused()).toBe(1)
    void nodeId
  })

  it('a typo in unpause changes nothing', async () => {
    const { db, paused } = await world()
    db.raw.prepare('UPDATE node SET paused = 1 WHERE path = ?').run(EXAMPLE_ROOT)
    db.raw.exec(toSqlScript(unpauseStatements({ path: 'no-such-node', reason: 'x' })))
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM moderation_action').get().n).toBe(0)
    expect(() => db.raw.exec(toSqlScript(unpauseStatements({ path: EXAMPLE_ROOT, reason: 'x', by: 'nobody_here' })))).toThrow()
    expect(paused()).toBe(1)
    expect(() => unpauseStatements({ path: EXAMPLE_ROOT, reason: '  ' })).toThrow('say why')
  })
})

describe('a paused shwarm that passed', () => {
  it('its result page and its submission pages say "paused for review" too, not only the thread behind them', async () => {
    const { closedWorld } = await import('./result-fixture')
    const w = await closedWorld()
    const env = testEnv(w.db)
    // flagged from the thread (?thread=1), where the control is
    for (const h of ['est_one', 'est_two', 'est_three']) expect((await flag(await signIn(env, h), 'weapons', `${ROOT}?thread=1`)).status).toBe(303)
    expect(w.db.raw.prepare('SELECT paused FROM node WHERE path = ?').get(EXAMPLE_ROOT).paused).toBe(1)
    const result = await page(new Browser(env))
    expect(result).toContain('class="done-head"') // the result page, not the thread
    expect(result).toContain('<p class="held paused" role="status">paused for review.')
    expect(await page(new Browser(env), `${ROOT}/s/1`)).toContain('<p class="held paused" role="status">paused for review.')
  })
})
