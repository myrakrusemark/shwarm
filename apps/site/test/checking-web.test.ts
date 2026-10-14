// Go-live 5.3, 5.5 and 5.6 on the site: the people check form on the submission page, the author's sign-off box with
// its inline password, the struck reset checks, the author-gone rule on the page, and the author's dead end. An ended
// node is locked (decided Oct 9): no repro form, no compose box, and nothing reopens it.
// A branch has no sign-off and doesn't end (decided Oct 13): its pass is its status vote. Its submissions still take
// checks, and the last one passes the submission while the branch stays live. So the sign-off and the dead end are
// tried on the example shwarm, and a branch is locked only with the shwarm above it.
import { shortHash } from '@shwarm/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { TreeEngine, type Command } from '../src/core/engine'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, repeatedIds, testEnv } from './browser'
import { agent, site, stepped, type P } from './core-fixtures'
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
const ROOT = `/w/${EXAMPLE_ROOT}`
const R1 = `${ROOT}/s/1`
const RERUN = 'https://archive.org/download/doom-blocks-checks/my-rerun.mp4 ' + '4e'.repeat(32)
const MOD = { url: 'https://zenodo.org/records/17346201/files/mcdoom-v1.pk3', sha256: '9c'.repeat(32) }
const PLAYTHROUGH = { url: 'https://archive.org/download/mcdoom-checks/e1m1-e1m6.mp4', sha256: '7'.repeat(64) }

async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const get = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).get(...args) as any
  const all = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).all(...args) as any[]
  const subId = (n: number) => get('SELECT s.post_id FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.number = ?', EXAMPLE_BRANCH, n).post_id as string
  const node = (path = EXAMPLE_BRANCH) => get('SELECT state, dead_end_note FROM node WHERE path = ?', path)
  const p = (handle: string): P => get('SELECT id, handle FROM person WHERE handle = ?', handle)
  const run = (cmd: Command) => new TreeEngine(w.db, () => T0).run(cmd) as Promise<any>
  /**
   * #1 on the example shwarm, which keeps its author's sign-off (a branch has none since Oct 13): @kestrel's agent
   * submits it, @lumpy posts the run and, unless `people` is false, @marceline the human people check. Then it waits on @myra.
   */
  const shwarmSub = async (o: { people?: boolean } = {}): Promise<{ id: string; hash: string }> => {
    const sub = await run({
      type: 'submit',
      actor: agent(p('kestrel'), 'swarm/r-40'),
      input: { node: EXAMPLE_ROOT, text: "freedoom's first nine maps, rebuilt from blocks.", links: [MOD], howToCheck: 'run the four scripts, then play e1m1 and one later map.' },
    })
    await run({
      type: 'check',
      actor: site(p('lumpy')),
      input: { node: EXAMPLE_ROOT, on: sub.id, slot: 'run', submissionHash: sub.hash.slice(0, 7), scriptHash: '5d02b7e', exit: 0, log: 'bench.sh: min 61 fps\nexit 0', env: 'linux, ryzen 5 3600, gtx 1660' },
    })
    if (o.people !== false)
      await run({ type: 'check', actor: site(p('marceline')), input: { node: EXAMPLE_ROOT, on: sub.id, verdict: 'pass', text: 'played e1m1 and e1m6 from a pistol start.', evidence: [PLAYTHROUGH] } })
    return sub
  }
  return { ...w, env, get, all, subId, node, p, run, shwarmSub }
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
const check = (b: Browser, fields: Record<string, string>, at = S2) => send(b, at, at, { do: 'check', ...fields })
/** A sign-off is the shwarm's (a branch has none since Oct 13): on the example shwarm's #1 unless told otherwise. */
const signOff = (b: Browser, fields: Record<string, string>, at = R1) => send(b, at, at, { do: 'signoff', ...fields })
const err = (html: string) => /<p class="err(?: flash)?" role="alert">([^<]+)<\/p>/.exec(html)?.[1]
const pill = (html: string) => /<span class="stp[^"]*" id="status">([^<]+)<\/span>/.exec(html)?.[1]

describe('the people check form (5.3)', () => {
  it("records a pass with its evidence and lands on the check; a branch's last check passes it, and the branch stays live", async () => {
    const { env, get, all, subId, node } = await world()
    const reader = await signIn(env, 'reader')
    const page = await body(await reader.req(S2, { headers: HTML }))
    expect(page).toContain('<div class="box checkform" id="check"><h2>check it <span>one check per person, never on their own work.</span></h2>')
    const res = await check(reader, { verdict: 'pass', text: 'placed 200 times on each corner, 0 failures.', links: RERUN })
    expect(res.status).toBe(303)
    const row = all("SELECT c.id, c.slot, c.verdict, c.evidence, p.text, p.as_name FROM check_report c JOIN post p ON p.id = c.post_id WHERE p.as_name = '@reader'")[0]
    expect(res.headers.get('location')).toBe(`${S2}#${row.id}`)
    expect(row).toMatchObject({ slot: 'people', verdict: 'pass', text: 'placed 200 times on each corner, 0 failures.' })
    expect(JSON.parse(row.evidence)).toEqual([{ url: 'https://archive.org/download/doom-blocks-checks/my-rerun.mp4', sha256: '4e'.repeat(32) }])
    // #2's last check: a branch has no sign-off (decided Oct 13), so #2 passes on its checks and the branch stays live,
    // its pass being its status vote. Nobody is asked to sign off, and no pass notice or mail goes out.
    const sub = get('SELECT status, hash FROM submission WHERE post_id = ?', subId(2))
    expect(sub.status).toBe('passed')
    expect(node().state).toBe('live')
    expect(get("SELECT detail FROM audit_event WHERE event = 'passed'").detail).toBe(`#2 (${shortHash(sub.hash)}) passed its checks`)
    expect(all('SELECT kind, text FROM inbox_item')).toEqual([])
    expect(all('SELECT template FROM email_outbox')).toEqual([])
    // a passed submission takes no more checks: no form, a second click lands on the first check, a late one is refused
    const after = await body(await reader.req(S2, { headers: HTML }))
    expect(after).not.toContain('id="check"')
    expect(after).not.toContain('id="decide"')
    expect((await check(reader, { verdict: 'pass', text: 'again', links: RERUN })).headers.get('location')).toBe(`${S2}#${row.id}`)
    const late = await check(await signIn(env, 'latecomer'), { verdict: 'pass', text: 'me too', links: RERUN })
    expect(late.status).toBe(400)
    expect(err(await body(late))).toBe('#2 passed. its checks are on record.')
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
    // before posting, the submitter is told why there's no form, and so is a slot holder
    expect(await body(await cases[1][0].req(S2, { headers: HTML }))).toContain("<p class=\"note\">you can't check it: it's from your agent.</p>")
    expect(await body(await cases[0][0].req(S2, { headers: HTML }))).toContain('<p class="note">you have a check on it already.</p>')
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

describe('a passed shwarm is locked (decided Oct 9), and the branches under it', () => {
  it('shows no repro link, check form or compose box, and refuses a forged check or post', async () => {
    const { env, node, all, p, run, shwarmSub } = await world()
    // only a shwarm passes and locks (decided Oct 13): #1, signed off by @myra
    const sub = await shwarmSub()
    await run({ type: 'check', actor: stepped(p('myra')), input: { node: EXAMPLE_ROOT, on: sub.id, slot: 'author', verdict: 'pass', text: 'played it for an hour.' } })
    expect(node(EXAMPLE_ROOT).state).toBe('closed')
    const reader = await signIn(env, 'reader')
    // its thread, behind the result page (5.7)
    const thread = await body(await reader.req(`${ROOT}?thread=1`, { headers: HTML }))
    expect(thread).toContain('<div class="compose locked"><div class="to">locked</div><p>this shwarm passed, so it takes nothing new. to carry it on, <a href="/new?builds_on=minecraft-in-doom">build on it</a>.</p></div>')
    expect(thread).not.toContain('value="post"')
    expect(thread).not.toContain('make it a branch')
    const page = await body(await reader.req(R1, { headers: HTML }))
    expect(page).not.toContain('id="check"')
    expect(pill(page)).toBe('approved')
    // the branch is locked with it, though it never ended itself; its #2 takes no more checks
    const branch = await body(await reader.req(BP, { headers: HTML }))
    expect(branch).not.toContain('post a repro')
    expect(branch).toContain('<div class="compose locked"><div class="to">locked</div><p><a href="/w/minecraft-in-doom">minecraft in doom</a> passed, so this branch takes nothing new either. to carry it on, <a href="/new?builds_on=minecraft-in-doom">build on it</a>.</p></div>')
    expect(branch).not.toContain('value="post"')
    expect(branch).not.toContain('make it a branch')
    expect(await body(await reader.req(S2, { headers: HTML }))).not.toContain('id="check"')
    const locked = `${EXAMPLE_ROOT} passed. it's locked: it takes nothing new.`
    const checks = all('SELECT id FROM check_report').length
    for (const at of [R1, S2]) {
      const res = await check(reader, { verdict: 'fail', text: 'e1m4 drops to 41 fps on the reference rig.' }, at)
      expect(res.status, at).toBe(400)
      expect(err(await body(res)), at).toBe(locked)
    }
    expect(all('SELECT id FROM check_report').length).toBe(checks)
    for (const [from, at] of [[`${ROOT}?thread=1`, ROOT], [BP, BP]]) {
      const res = await send(reader, from, at, { do: 'post', text: 'is it really done?' })
      expect(res.status, at).toBe(400)
      expect(err(await body(res)), at).toBe(locked)
    }
    expect(node(EXAMPLE_ROOT).state).toBe('closed')
    expect(node().state).toBe('live')
  })
})

// The sign-off is a shwarm's (a branch has none since Oct 13): the example shwarm's #1, waiting on @myra (world().shwarmSub).
describe("the author's sign-off (5.5)", () => {
  it('asks for the password inline once the window is closed: a wrong one keeps the draft, the right one passes', async () => {
    const { env, node, shwarmSub } = await world()
    await shwarmSub()
    const author = await signIn(env, 'myra', { existing: true })
    let html = await body(await author.req(R1, { headers: HTML }))
    expect(html).toContain('<h2 class="sunny">your sign-off <span>only you see this</span></h2>')
    expect(html).toContain("everything else passed. it's your call whether this meets the done test.")
    expect(html).not.toContain('type="password"') // signed in just now: the window is open
    expect(html).not.toContain('id="check"') // the author's check is the sign-off
    vi.setSystemTime(T0 + 11 * MIN)
    html = await body(await author.req(R1, { headers: HTML }))
    expect(html).toContain('<label class="pw" for="pw-pass">password <input id="pw-pass" type="password" name="password" autocomplete="current-password" required="" maxlength="1024"/></label>')
    expect(html).toContain('<label class="pw" for="pw-fail">') // pass and fail each ask on their own field
    expect(repeatedIds(html)).toEqual([])
    expect(html).toContain('passing closes minecraft in doom as done. confirms with your password.')
    let res = await signOff(author, { verdict: 'pass', text: 'played it for an hour with my kid.', password: 'not my password' })
    expect(res.status).toBe(400)
    html = await body(res)
    expect(err(html)).toBe("that password doesn't match.")
    expect(html).toContain('<input type="radio" name="pick" id="pick-pass" class="pick" checked=""/>')
    expect(html).toContain('>played it for an hour with my kid.</textarea>')
    expect(node(EXAMPLE_ROOT).state).toBe('live')
    expect(err(await body(await signOff(author, { verdict: 'pass', text: 'x' })))).toBe('enter your password to confirm.')
    res = await signOff(author, { verdict: 'pass', text: 'played it for an hour with my kid.', password: GOOD_PASSWORD })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${R1}#checks`)
    expect(node(EXAMPLE_ROOT).state).toBe('closed')
    html = await body(await author.req(R1, { headers: HTML }))
    expect(pill(html)).toBe('approved')
    expect(html).toContain('<h2>checks <span>3 of 3 · minecraft in doom is done</span></h2>')
    expect(html).not.toContain('id="decide"')
  })

  it('a fail strikes every earlier check as reset', async () => {
    const { env, all, shwarmSub } = await world()
    await shwarmSub()
    const author = await signIn(env, 'myra', { existing: true })
    const res = await signOff(author, { verdict: 'fail', text: 'e1m4 drops to 41 fps on the reference rig.' })
    expect(res.status).toBe(303)
    // #1's run and people check; the branch's checks are its own and stand
    expect(all('SELECT COUNT(*) AS n FROM check_report WHERE reset_at IS NOT NULL')[0].n).toBe(2)
    const html = await body(await author.req(R1, { headers: HTML }))
    expect(pill(html)).toBe('failed')
    expect(html).toContain('<h2>checks <span>reset · waiting for a new submission</span></h2>')
    expect(html.match(/<li id="c_\w+" class="reset">/g)).toHaveLength(2)
    expect(html).toContain('failed by you')
    expect(html).toContain('repro: e1m4 drops to 41 fps on the reference rig.')
  })

  it("refuses a forged people check from the author, and anyone else's sign-off", async () => {
    const { env, shwarmSub } = await world()
    await shwarmSub()
    const author = await signIn(env, 'myra', { existing: true })
    let res = await check(author, { verdict: 'pass', text: 'fine', links: RERUN }, R1)
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe('your check here is the sign-off, on the submission page.')
    const reader = await signIn(env, 'reader')
    expect((await body(await reader.req(R1, { headers: HTML })))).not.toContain('id="decide"')
    res = await signOff(reader, { verdict: 'pass', text: 'ok' })
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe('only the author signs off.')
  })

  it('a branch has none (decided Oct 13): its author gets no box and checks like anyone, and a forged sign-off is refused', async () => {
    const { env, get, all, subId, node } = await world()
    const author = await signIn(env, 'bmo_fan', { existing: true })
    const html = await body(await author.req(S2, { headers: HTML }))
    expect(html).not.toContain('id="decide"')
    expect(html).not.toContain('<h4><span>author</span>') // no author row waits among #2's checks
    expect(pill(html)).toBe('in review') // not "waiting on you": #2 waits on one more people check
    expect(html).toContain('<div class="box checkform" id="check">')
    let res = await signOff(author, { verdict: 'pass', text: 'played it tonight, every corner holds.' }, S2)
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe('a branch has no sign-off. its pass is its status vote.')
    // the last people check, as @bmo_fan's pinned post says: #2 passes, and the branch stays live
    res = await check(author, { verdict: 'pass', text: 'played it tonight, every corner holds.', links: RERUN })
    expect(res.status).toBe(303)
    expect(all("SELECT c.slot FROM check_report c JOIN person p ON p.id = c.person_id WHERE p.handle = 'bmo_fan'").map(r => r.slot)).toEqual(['people'])
    expect(get('SELECT status FROM submission WHERE post_id = ?', subId(2)).status).toBe('passed')
    expect(node().state).toBe('live')
  })

  it('author gone: the operator gets the box, and the page says who signed off', async () => {
    const { env, db, node, shwarmSub } = await world()
    await shwarmSub()
    db.raw.prepare("UPDATE person SET status = 'suspended' WHERE handle = 'myra'").run()
    const reader = await signIn(env, 'reader')
    expect(await body(await reader.req(R1, { headers: HTML }))).not.toContain('id="decide"')
    const ops = await signIn(env, 'ops')
    db.raw.prepare("UPDATE person SET is_admin = 1 WHERE handle = 'ops'").run()
    let html = await body(await ops.req(R1, { headers: HTML }))
    expect(html).toContain("<p class=\"note\">its author's account is gone, so you sign off as the operator.</p>")
    expect(pill(html)).toBe('waiting on you')
    const res = await signOff(ops, { verdict: 'pass', text: 'ran the benchmark myself.' })
    expect(res.status).toBe(303)
    expect(node(EXAMPLE_ROOT).state).toBe('closed')
    html = await body(await reader.req(R1, { headers: HTML }))
    expect(html).toContain('<span class="note"> · author gone, signed off by the operator</span>')
  })

  it('author gone: the operator gets no people check before their turn, and a sign-off after a check is no double click', async () => {
    const { env, db, all, shwarmSub } = await world()
    await shwarmSub({ people: false }) // #1 still needs its people check
    db.raw.prepare("UPDATE person SET status = 'suspended' WHERE handle = 'myra'").run()
    const ops = await signIn(env, 'ops')
    db.raw.prepare("UPDATE person SET is_admin = 1 WHERE handle = 'ops'").run()
    let html = await body(await ops.req(R1, { headers: HTML }))
    expect(html).not.toContain('id="check"') // a people check would take the slot the sign-off needs
    expect(html).not.toContain('id="decide"')
    // a forged people check from the operator is taken (core allows it), and a sign-off right after is refused, not a repeat
    expect((await check(ops, { verdict: 'pass', text: 'played e1m1 from a pistol start.', links: RERUN }, R1)).status).toBe(303)
    const res = await signOff(ops, { verdict: 'pass', text: 'ran the benchmark myself.' })
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe('@ops already has a check on #1. one slot per person.')
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

// Only a shwarm ends (decided Oct 13): the dead end is the example shwarm's. A branch's crew votes dead_end on its status.
describe('dead end (5.6)', () => {
  it('only the author gets the box; a dead end needs a note and the password', async () => {
    const { env, node } = await world()
    const reader = await signIn(env, 'reader')
    expect(await body(await reader.req(ROOT, { headers: HTML }))).not.toContain('id="owner"')
    const author = await signIn(env, 'myra', { existing: true })
    expect(await body(await author.req(ROOT, { headers: HTML }))).toContain('<h2 class="sunny">your shwarm <span>only you see this</span></h2>')
    let res = await send(author, ROOT, ROOT, { do: 'dead_end', note: '  ' })
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe('say why it stops here, so nobody repeats it.')
    vi.setSystemTime(T0 + 11 * MIN)
    res = await send(author, ROOT, ROOT, { do: 'dead_end', note: 'gzdoom caps dynamic geometry.', password: 'wrong' })
    expect(res.status).toBe(400)
    const html = await body(res)
    expect(err(html)).toBe("that password doesn't match.")
    expect(html).toContain('>gzdoom caps dynamic geometry.</textarea>')
    expect(node(EXAMPLE_ROOT).state).toBe('live')
    res = await send(author, ROOT, ROOT, { do: 'dead_end', note: 'gzdoom caps dynamic geometry.', password: GOOD_PASSWORD })
    expect(res.status).toBe(303)
    expect(node(EXAMPLE_ROOT)).toEqual({ state: 'dead_end', dead_end_note: 'gzdoom caps dynamic geometry.' })
    // a dead end is locked: the author's box and the compose box are gone, and nothing offers to reopen it
    const ended = await body(await author.req(ROOT, { headers: HTML }))
    expect(ended).not.toContain('id="owner"')
    expect(ended).not.toContain('reopen')
    expect(ended).toContain('<div class="compose locked"><div class="to">locked</div><p>this shwarm is a dead end, so it takes nothing new. to carry it on, <a href="/new?builds_on=minecraft-in-doom">build on it</a>.</p></div>')
  })

  it("a branch doesn't end (decided Oct 13): its author gets no box, and a forged dead end is refused", async () => {
    const { env, node } = await world()
    const author = await signIn(env, 'bmo_fan', { existing: true })
    const page = await body(await author.req(BP, { headers: HTML }))
    expect(page).not.toContain('id="owner"')
    expect(page).toContain('name="status" value="dead_end"') // the vote instead
    const res = await send(author, BP, BP, { do: 'dead_end', note: 'gzdoom caps dynamic geometry.' })
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe("a branch doesn't lock. vote dead_end on its status instead.")
    expect(node()).toEqual({ state: 'live', dead_end_note: null })
  })

  it('a dead end is locked, and its branches with it: a forged post or edit is refused, and there is no reopen', async () => {
    const { env, node, get, p, run } = await world()
    const myra = p('myra')
    const own = get("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.person_id = ? AND p.kind = 'post' LIMIT 1", EXAMPLE_ROOT, myra.id).id
    await run({ type: 'deadEnd', actor: stepped(myra), input: { node: EXAMPLE_ROOT, note: 'stuck on chunk seams' } })
    const author = await signIn(env, 'myra', { existing: true })
    const page = await body(await author.req(ROOT, { headers: HTML }))
    expect(page).not.toContain('value="edit"')
    expect(page).not.toContain('value="delete"')
    let res = await send(author, ROOT, ROOT, { do: 'reopen' })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain('that form asked for nothing we know.')
    const locked = `${EXAMPLE_ROOT} is a dead end. it's locked: it takes nothing new.`
    res = await send(author, ROOT, ROOT, { do: 'edit', post: own, text: 'never mind' })
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe(locked)
    res = await send(author, ROOT, ROOT, { do: 'post', text: 'one more idea', pin: '1' })
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe(locked)
    expect(node(EXAMPLE_ROOT).state).toBe('dead_end')
    // the branch under it never ended, but takes nothing new either
    expect(await body(await author.req(BP, { headers: HTML }))).toContain('<div class="compose locked"><div class="to">locked</div><p><a href="/w/minecraft-in-doom">minecraft in doom</a> is a dead end, so this branch takes nothing new either.')
    res = await send(author, BP, BP, { do: 'post', text: 'one more idea' })
    expect(res.status).toBe(400)
    expect(err(await body(res))).toBe(locked)
    expect(node().state).toBe('live')
  })
})
