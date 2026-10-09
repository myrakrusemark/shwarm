// Go-live 5.3, 5.5 and 5.6 on the site: the people check form on the submission page, the author's sign-off box with
// its inline password, the struck reset checks, the author-gone rule on the page, and the author's dead end and reopen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { siteActor } from '../src/core/actor'
import { TreeEngine } from '../src/core/engine'
import { EXAMPLE_BRANCH } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
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
})

const HTML = { accept: 'text/html' }
const MIN = 60_000
const BP = `/w/${EXAMPLE_BRANCH}`
const S2 = `${BP}/s/2`
const RERUN = 'https://archive.org/download/doom-blocks-checks/my-rerun.mp4 ' + '4e'.repeat(32)

async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const get = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).get(...args) as any
  const all = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).all(...args) as any[]
  const subId = (n: number) => get('SELECT s.post_id FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.number = ?', EXAMPLE_BRANCH, n).post_id as string
  const node = () => get('SELECT state, dead_end_note FROM node WHERE path = ?', EXAMPLE_BRANCH)
  return { ...w, env, get, all, subId, node }
}

/** Signs in as a new verified member (founding unless told otherwise), or as a seeded person given a password here. */
async function signIn(env: ReturnType<typeof testEnv>, handle: string, o: { existing?: boolean; founding?: boolean } = {}) {
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  if (o.existing)
    env.DB.raw
      .prepare('UPDATE person SET password_hash = ?, email = ?, email_norm = ?, email_verified_at = ? WHERE handle = ?')
      .run(hash, `${handle}@example.org`, `${handle}@example.org`, new Date(T0).toISOString(), handle)
  else {
    const pid = await addPerson(env.DB, handle, { hash })
    env.DB.raw.prepare('UPDATE person SET email_verified_at = ?, founding = ? WHERE id = ?').run(new Date(T0).toISOString(), o.founding === false ? 0 : 1, pid)
  }
  const b = new Browser(env)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}

/** POSTs a form from `page` with that page's own form token. */
async function send(b: Browser, page: string, path: string, fields: Record<string, string>) {
  const token = formTokenIn(await (await b.req(page, { headers: HTML })).text())
  return b.req(path, { form: { form_token: token, ...fields } })
}
const check = (b: Browser, fields: Record<string, string>) => send(b, S2, S2, { do: 'check', ...fields })
const signOff = (b: Browser, fields: Record<string, string>) => send(b, S2, S2, { do: 'signoff', ...fields })
const err = (html: string) => /<p class="err(?: flash)?" role="alert">([^<]+)<\/p>/.exec(html)?.[1]
const pill = (html: string) => /<span class="stp[^"]*" id="status">([^<]+)<\/span>/.exec(html)?.[1]

describe('the people check form (5.3)', () => {
  it('records a pass with its evidence and lands on the check', async () => {
    const { env, all, subId } = await world()
    const reader = await signIn(env, 'reader')
    const page = await body(await reader.req(S2, { headers: HTML }))
    expect(page).toContain('<div class="box checkform" id="check"><h2>check it <span>one check per person, never on their own work.</span></h2>')
    const res = await check(reader, { verdict: 'pass', text: 'placed 200 times on each corner, 0 failures.', links: RERUN })
    expect(res.status).toBe(303)
    const row = all("SELECT c.id, c.slot, c.verdict, c.evidence, p.text, p.as_name FROM check_report c JOIN post p ON p.id = c.post_id WHERE p.as_name = '@reader'")[0]
    expect(res.headers.get('location')).toBe(`${S2}#${row.id}`)
    expect(row).toMatchObject({ slot: 'people', verdict: 'pass', text: 'placed 200 times on each corner, 0 failures.' })
    expect(JSON.parse(row.evidence)).toEqual([{ url: 'https://archive.org/download/doom-blocks-checks/my-rerun.mp4', sha256: '4e'.repeat(32) }])
    expect(all('SELECT status FROM submission WHERE post_id = ?', subId(2))[0].status).toBe('in_review') // the author still signs off
    // a slot holder isn't offered the form again, and a second click lands on the first check
    const after = await body(await reader.req(S2, { headers: HTML }))
    expect(after).toContain('<p class="note">you have a check on it already.</p>')
    expect((await check(reader, { verdict: 'pass', text: 'again', links: RERUN })).headers.get('location')).toBe(`${S2}#${row.id}`)
  })

  it('says inline what a pass or a fail is missing, keeping the draft', async () => {
    const { env } = await world()
    const reader = await signIn(env, 'reader')
    let res = await check(reader, { verdict: 'pass', text: 'looks good to me' })
    expect(res.status).toBe(400)
    let html = await body(res)
    expect(err(html)).toBe('a pass needs evidence: a log or links to a rerun or recording.')
    expect(html).toContain('<textarea id="k-text" name="text" rows="3" maxlength="20000">looks good to me</textarea>')
    expect(html).toContain('<input type="radio" name="verdict" value="pass" required="" checked=""/>')
    res = await check(reader, { verdict: 'fail', text: '', links: RERUN })
    html = await body(res)
    expect(res.status).toBe(400)
    expect(err(html)).toBe('a fail needs a repro: steps that show it failing.')
    expect(html).toContain(RERUN)
    expect(err(await body(await check(reader, { text: 'no verdict' })))).toBe('pick pass or fail.')
  })

  it('shows slot_taken, own_work and not_established at the form, with the draft kept', async () => {
    const { env } = await world()
    const cases: [Browser, string][] = [
      [await signIn(env, 'lumpy', { existing: true }), '@lumpy already has a check on #2. one slot per person.'],
      [await signIn(env, 'myra', { existing: true }), '#2 is work posted under @myra.'],
      [await signIn(env, 'newcomer', { founding: false }), 'people checks count from established accounts. yours is new.'],
    ]
    for (const [b, says] of cases) {
      const res = await check(b, { verdict: 'pass', text: `my draft ${says.length}`, links: RERUN })
      expect(res.status, says).toBe(400)
      const html = await body(res)
      expect(err(html), says).toBe(says)
      expect(html).toContain(`>my draft ${says.length}</textarea>`)
    }
    // before posting, the submitter is told why there's no form
    expect(await body(await cases[1][0].req(S2, { headers: HTML }))).toContain("<p class=\"note\">you can't check it: it's from your agent.</p>")
  })

  it('signed out, the box says to sign in; the waiting rows say who is still needed', async () => {
    const { env } = await world()
    const html = await body(await new Browser(env).req(S2, { headers: HTML }))
    expect(html).toContain('<p class="note"><a href="/signin?next=%2Fw%2Fminecraft-in-doom%2Fblock-placement%2Fs%2F2">sign in</a> to check it. agents send run reports with a key.</p>')
    expect(html).not.toContain('name="do" value="check"')
  })

  it('opens a run\'s signed log in place, with the check script and the machine', async () => {
    const { env } = await world()
    const html = await body(await new Browser(env).req(S2, { headers: HTML }))
    expect(html).toContain('<span class="note logmeta">check script <code>5d02b7e</code> · ran on linux, rtx 3060</span></details>')
    expect(html).toContain('<script src="/js/submission.js" defer=""></script>')
  })
})

describe('a closed node takes only a repro (A25, A11)', () => {
  it('refuses a pass on the passing submission; a repro reopens the node', async () => {
    const { db, env, node, subId, get } = await world()
    const bmo = get("SELECT id, handle FROM person WHERE handle = 'bmo_fan'")
    await new TreeEngine(db, () => T0).run({ type: 'check', actor: siteActor(bmo, { steppedUp: true }), input: { node: EXAMPLE_BRANCH, on: subId(2), slot: 'author', verdict: 'pass', text: 'played it tonight' } })
    expect(node().state).toBe('closed')
    // the node page points at the repro form
    expect(await body(await new Browser(env).req(BP, { headers: HTML }))).toContain(`<div class="alt"><a href="${S2}#check">it's broken? post a repro</a></div>`)
    const reader = await signIn(env, 'reader')
    const page = await body(await reader.req(S2, { headers: HTML }))
    expect(page).toContain("<h2>it's broken? post a repro <span>")
    expect(page).toContain('<input type="hidden" name="verdict" value="fail"/>')
    let res = await check(reader, { verdict: 'pass', text: 'still works', links: RERUN })
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe(`${EXAMPLE_BRANCH} passed on #2. it takes only a repro on #2, which reopens it.`)
    res = await check(reader, { verdict: 'fail', text: 'place on a corner at y=-200: the block vanishes.' })
    expect(res.status).toBe(303)
    expect(node().state).toBe('live')
    // the repro shows once: its text is its steps
    const html = await body(await reader.req(S2, { headers: HTML }))
    expect(html).toContain('<a href="/@reader">@reader</a> · place on a corner at y=-200: the block vanishes.</span>')
    // the pass stays on record, but the page no longer says the node is done
    expect(pill(html)).toBe('reopened')
    expect(html).toContain('<h2>checks <span>4 of 4 · passed · reopened by a repro</span></h2>')
    expect(html).not.toContain('block placement is done')
    expect(html).not.toContain('id="check"')
  })
})

describe("the author's sign-off (5.5)", () => {
  it('asks for the password inline once the window is closed: a wrong one keeps the draft, the right one passes', async () => {
    const { env, node } = await world()
    const author = await signIn(env, 'bmo_fan', { existing: true })
    let html = await body(await author.req(S2, { headers: HTML }))
    expect(html).toContain('<h2 class="sunny">your sign-off <span>only you see this</span></h2>')
    expect(html).toContain("everything else passed. it's your call whether this meets the done test.")
    expect(html).not.toContain('type="password"') // signed in just now: the window is open
    expect(html).not.toContain('id="check"') // the author's check is the sign-off
    vi.setSystemTime(T0 + 11 * MIN)
    html = await body(await author.req(S2, { headers: HTML }))
    expect(html).toContain('<label class="pw" for="pw-pass">password <input id="pw-pass" type="password" name="password" autocomplete="current-password" required="" maxlength="1024"/></label>')
    expect(html).toContain('passing closes block placement as done. confirms with your password.')
    let res = await signOff(author, { verdict: 'pass', text: 'played it tonight, every corner holds.', password: 'not my password' })
    expect(res.status).toBe(400)
    html = await body(res)
    expect(err(html)).toBe("that password doesn't match.")
    expect(html).toContain('<input type="radio" name="pick" id="pick-pass" class="pick" checked=""/>')
    expect(html).toContain('>played it tonight, every corner holds.</textarea>')
    expect(node().state).toBe('live')
    expect(err(await body(await signOff(author, { verdict: 'pass', text: 'x' })))).toBe('enter your password to confirm.')
    res = await signOff(author, { verdict: 'pass', text: 'played it tonight, every corner holds.', password: GOOD_PASSWORD })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${S2}#checks`)
    expect(node().state).toBe('closed')
    html = await body(await author.req(S2, { headers: HTML }))
    expect(pill(html)).toBe('approved')
    expect(html).toContain('<h2>checks <span>4 of 4 · block placement is done</span></h2>')
    expect(html).not.toContain('id="decide"')
  })

  it('a fail strikes every earlier check as reset', async () => {
    const { env, all } = await world()
    const author = await signIn(env, 'bmo_fan', { existing: true })
    const res = await signOff(author, { verdict: 'fail', text: 'at y=-120 corners still fail 1 in 50.' })
    expect(res.status).toBe(303)
    expect(all('SELECT COUNT(*) AS n FROM check_report WHERE reset_at IS NOT NULL')[0].n).toBeGreaterThanOrEqual(3)
    const html = await body(await author.req(S2, { headers: HTML }))
    expect(pill(html)).toBe('failed')
    expect(html).toContain('<h2>checks <span>reset · waiting for a new submission</span></h2>')
    expect(html.match(/<li id="c_\w+" class="reset">/g)).toHaveLength(3)
    expect(html).toContain('failed by you')
    expect(html).toContain('repro: at y=-120 corners still fail 1 in 50.')
  })

  it("refuses a forged people check from the author, and anyone else's sign-off", async () => {
    const { env } = await world()
    const author = await signIn(env, 'bmo_fan', { existing: true })
    let res = await check(author, { verdict: 'pass', text: 'fine', links: RERUN })
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe('your check here is the sign-off, on the submission page.')
    const reader = await signIn(env, 'reader')
    expect((await body(await reader.req(S2, { headers: HTML })))).not.toContain('id="decide"')
    res = await signOff(reader, { verdict: 'pass', text: 'ok' })
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe('only the author signs off.')
  })

  it('author gone: the operator gets the box, and the page says who signed off', async () => {
    const { env, db, node } = await world()
    db.raw.prepare("UPDATE person SET status = 'suspended' WHERE handle = 'bmo_fan'").run()
    const reader = await signIn(env, 'reader')
    expect(await body(await reader.req(S2, { headers: HTML }))).not.toContain('id="decide"')
    const ops = await signIn(env, 'ops')
    db.raw.prepare("UPDATE person SET is_admin = 1 WHERE handle = 'ops'").run()
    let html = await body(await ops.req(S2, { headers: HTML }))
    expect(html).toContain("<p class=\"note\">its author's account is gone, so you sign off as the operator.</p>")
    expect(pill(html)).toBe('waiting on you')
    const res = await signOff(ops, { verdict: 'pass', text: 'ran the soak test myself.' })
    expect(res.status).toBe(303)
    expect(node().state).toBe('closed')
    html = await body(await reader.req(S2, { headers: HTML }))
    expect(html).toContain('<span class="note"> · author gone, signed off by the operator</span>')
  })

  it('author gone: the operator gets no people check before their turn, and a sign-off after a check is no double click', async () => {
    const { env, db, all } = await world()
    db.raw.prepare("UPDATE person SET status = 'suspended' WHERE handle = 'bmo_fan'").run()
    // #2 still needs its people check
    db.raw.prepare("DELETE FROM check_report WHERE person_id = (SELECT id FROM person WHERE handle = 'kestrel')").run()
    const ops = await signIn(env, 'ops')
    db.raw.prepare("UPDATE person SET is_admin = 1 WHERE handle = 'ops'").run()
    let html = await body(await ops.req(S2, { headers: HTML }))
    expect(html).not.toContain('id="check"') // a people check would take the slot the sign-off needs
    expect(html).not.toContain('id="decide"')
    // a forged people check from the operator is taken (core allows it), and a sign-off right after is refused, not a repeat
    expect((await check(ops, { verdict: 'pass', text: 'placed 200 times on each corner.', links: RERUN })).status).toBe(303)
    const res = await signOff(ops, { verdict: 'pass', text: 'ran the soak test myself.' })
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe('@ops already has a check on #2. one slot per person.')
    expect(all("SELECT COUNT(*) AS n FROM check_report WHERE slot = 'author'")[0].n).toBe(0)
  })
})

describe('submission.js', () => {
  it('a mangled #fragment still leaves every form sending once', async () => {
    const { readFileSync } = await import('node:fs')
    const { runInNewContext } = await import('node:vm')
    const src = readFileSync(new URL('../static/js/submission.js', import.meta.url), 'utf8')
    const listeners: Record<string, (e: { preventDefault(): void }) => void> = {}
    const form = { dataset: {} as Record<string, string>, addEventListener: (t: string, fn: any) => (listeners[t] = fn), querySelector: () => null }
    const document = { getElementById: () => null, querySelectorAll: () => [form] }
    runInNewContext(src, { location: { hash: '#%E0' }, document, addEventListener: () => {} })
    let stopped = 0
    listeners.submit({ preventDefault: () => stopped++ })
    listeners.submit({ preventDefault: () => stopped++ })
    expect(stopped).toBe(1)
  })
})

describe('dead end and reopen (5.6)', () => {
  it('only the author gets the box; a dead end needs a note and the password', async () => {
    const { env, node } = await world()
    const reader = await signIn(env, 'reader')
    expect(await body(await reader.req(BP, { headers: HTML }))).not.toContain('id="owner"')
    const author = await signIn(env, 'bmo_fan', { existing: true })
    expect(await body(await author.req(BP, { headers: HTML }))).toContain('<h2 class="sunny">your branch <span>only you see this</span></h2>')
    let res = await send(author, BP, BP, { do: 'dead_end', note: '  ' })
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe('say why it stops here, so nobody repeats it.')
    vi.setSystemTime(T0 + 11 * MIN)
    res = await send(author, BP, BP, { do: 'dead_end', note: 'gzdoom caps dynamic geometry.', password: 'wrong' })
    expect(res.status).toBe(400)
    const html = await body(res)
    expect(err(html)).toBe("that password doesn't match.")
    expect(html).toContain('>gzdoom caps dynamic geometry.</textarea>')
    expect(node().state).toBe('live')
    res = await send(author, BP, BP, { do: 'dead_end', note: 'gzdoom caps dynamic geometry.', password: GOOD_PASSWORD })
    expect(res.status).toBe(303)
    expect(node()).toEqual({ state: 'dead_end', dead_end_note: 'gzdoom caps dynamic geometry.' })
    // the window is open now: reopening doesn't ask again
    expect(await body(await author.req(BP, { headers: HTML }))).toContain('<input type="hidden" name="do" value="reopen"/>')
  })

  it('reopen works only for the author', async () => {
    const { env, db, node, get } = await world()
    const bmo = get("SELECT id, handle FROM person WHERE handle = 'bmo_fan'")
    await new TreeEngine(db, () => T0).run({ type: 'deadEnd', actor: siteActor(bmo, { steppedUp: true }), input: { node: EXAMPLE_BRANCH, note: 'stuck on chunk seams' } })
    const reader = await signIn(env, 'reader')
    let res = await send(reader, BP, BP, { do: 'reopen' })
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe('only the author reopens a dead end.')
    expect(node().state).toBe('dead_end')
    const author = await signIn(env, 'bmo_fan', { existing: true })
    res = await send(author, BP, BP, { do: 'reopen' })
    expect(res.status).toBe(303)
    expect(node().state).toBe('live')
  })
})
