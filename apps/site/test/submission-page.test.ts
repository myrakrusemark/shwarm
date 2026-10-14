// Go-live 5.2 and the display half of 5.4: the submission page at /w/<path>/s/<n> (in all three forms), "waiting on
// you" and "waiting N days", the A9 swap note, inbox links to the right submission, and the page's tallies against core's.
// A branch has no author sign-off (decided Oct 13), so the author's side is shown on a submission to the example shwarm.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { keyActor } from '../src/core/actor'
import { needs, parseCheckSpec, tally, type CheckRow, type CheckSpec } from '../src/core/checks'
import { TreeEngine, type Command } from '../src/core/engine'
import { INBOX_LINK_COLS, INBOX_LINK_JOIN, inboxHref, readInboxLinks } from '../src/read/inbox-links'
import type { CheckReport, SubmissionRow } from '../src/read/node'
import { review } from '../src/read/review'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { mapLaunchShwarm } from '../src/seed/launch'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { agent, site, stepped, type P } from './core-fixtures'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, GOOD_PASSWORD, pepper, testEnv, type TestEnv } from './browser'
import { stagingWorld } from './node-fixture'

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
const DAY = 86_400_000
const S1 = `/w/${EXAMPLE_BRANCH}/s/1`
const S2 = `/w/${EXAMPLE_BRANCH}/s/2`
const ROOT_S1 = `/w/${EXAMPLE_ROOT}/s/1`

async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const get = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).get(...args)
  const subId = (path: string, n: number) =>
    (get('SELECT s.post_id FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.number = ?', path, n) as { post_id: string }).post_id
  return { ...w, env, b: new Browser(env), get, subId }
}

/** Signs in as a new verified member, or as an existing (seeded) person given a password here. */
async function signIn(env: ReturnType<typeof testEnv>, handle: string, existing = false) {
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  if (existing) env.DB.raw.prepare("UPDATE person SET password_hash = ?, email = ?, email_norm = ?, email_verified_at = ? WHERE handle = ?").run(hash, `${handle}@example.org`, `${handle}@example.org`, new Date(T0).toISOString(), handle)
  else {
    const pid = await addPerson(env.DB, handle, { hash })
    env.DB.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(new Date(T0).toISOString(), pid)
  }
  const b = new Browser(env)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}

/**
 * #1 on the example shwarm, waiting on @myra's sign-off (a shwarm keeps its author's sign-off; a branch has none,
 * decided Oct 13): @kestrel's agent submits it, @lumpy posts the run and @marceline the human people check, all at T0,
 * so @myra was asked at T0. `core` runs more acts on the same clock, as `who` (a handle) or their agents.
 */
async function waitingOnMyra(db: TestEnv['DB']) {
  const engine = new TreeEngine(db, () => T0)
  const core = (cmd: Command) => engine.run(cmd)
  const who = (handle: string): P => ({ id: (db.raw.prepare('SELECT id FROM person WHERE handle = ?').get(handle) as { id: number }).id, handle })
  const sub = (await core({
    type: 'submit',
    actor: agent(who('kestrel'), 'swarm/r-40'),
    input: {
      node: EXAMPLE_ROOT,
      text: "freedoom's first nine maps rebuilt from blocks. every wall digs out.",
      links: [{ url: 'https://codeberg.org/kestrel/mcdoom/archive/v0.9.zip', sha256: '9c'.repeat(32) }],
      howToCheck: 'run ./bench.sh, then play e1m1 from a pistol start for 15 minutes.',
    },
  })) as { id: string; hash: string }
  await core({
    type: 'check',
    actor: site(who('lumpy')),
    input: { node: EXAMPLE_ROOT, on: sub.id, slot: 'run', submissionHash: sub.hash.slice(0, 7), scriptHash: '5d02b7e', exit: 0, log: 'bench.sh: min 61 fps\nexit 0', env: 'linux, ryzen 5 3600, gtx 1660' },
  })
  await core({
    type: 'check',
    actor: site(who('marceline')),
    input: { node: EXAMPLE_ROOT, on: sub.id, verdict: 'pass', text: 'played e1m1 from a pistol start for 15 minutes.', evidence: [{ url: 'https://archive.org/download/mcdoom-checks/e1m1.mp4', sha256: '7'.repeat(64) }] },
  })
  return { sub, core, who }
}

const pill = (html: string) => /<span class="stp[^"]*" id="status">([^<]+)<\/span>/.exec(html)?.[1]

describe('the submission page (5.2)', () => {
  it('shows the submission: crumbs, the pinned hash at the top, the quoted done test, what was submitted, the sidebar', async () => {
    const { b, get, subId } = await world()
    const res = await b.req(S2, { headers: HTML })
    expect(res.status).toBe(200)
    const html = await body(res)
    const hash = (get('SELECT hash FROM submission WHERE post_id = ?', subId(EXAMPLE_BRANCH, 2)) as { hash: string }).hash
    expect(html).toContain('<title>submission #2 · block placement · shwarm</title>')
    expect(html).toContain('<nav class="crumbs" aria-label="breadcrumb"><a href="/w/minecraft-in-doom">minecraft in doom</a><span>/</span><a href="/w/minecraft-in-doom/block-placement">block placement</a><span>/</span>submission #2</nav>')
    // the version is the submission's hash (A10), at the top, before what was submitted
    const top = html.indexOf(`version <code title="sha256 ${hash}">${hash.slice(0, 7)}</code>`)
    expect(top).toBeGreaterThan(0)
    expect(top).toBeLessThan(html.indexOf('<h2>what was submitted</h2>'))
    expect(html).toContain('<div class="quote"><b>done when</b><div class="txt"><p>blocks place and break on any face')
    expect(html).toContain('<dt>linked</dt><dd><a href="https://codeberg.org/myra/doom-blocks/raw/branch/fixes/corner-fix.diff"')
    expect(html).toContain('<dt>how to check</dt><dd>load corner-repro.lmp, place 200 times on each corner of each chunk. expect 0 failures.</dd>')
    expect(html).toMatch(/<dt>built on<\/dt><dd><a href="\/w\/minecraft-in-doom\/block-placement#p_\w+">@finn_irl<\/a>, <a href="\/w\/minecraft-in-doom\/block-placement#p_\w+">@marceline<\/a>, <a href="\/w\/minecraft-in-doom\/block-placement\/s\/1">@myra\/m-04<\/a> #1<\/dd>/)
    expect(html).toContain('<p class="note back"><a href="/w/minecraft-in-doom/block-placement">back to the branch →</a></p>')
    expect(html).toContain('<p class="note">one submission per person per day.</p>')
    expect(html).toContain('<div class="box agent-res">')
  })

  it('groups the checks into runs, people and (on a shwarm) author, each with its own tally, and opens the signed log in place', async () => {
    const { db, b } = await world()
    const html = await body(await b.req(S2, { headers: HTML }))
    expect(html).toContain('<h2>checks <span>3 of 4</span></h2>')
    expect(html).toContain('<h4><span>runs</span><span class="note">2 of 2</span></h4>')
    expect(html).toContain('<h4><span>people</span><span class="note">1 of 2</span></h4>')
    expect(html).toMatch(/<li id="c_\w+"><span class="ck y">✓<\/span><span><a href="\/@lumpy">@lumpy<\/a> · run · <code class="cmd">\.\/soak\.sh<\/code> exit 0 on #2 \([0-9a-f]{7}\) · linux, rtx 3060 · <details class="log"><summary>signed log<\/summary><pre class="log">soak\.sh: 10000 placements on chunk corners/)
    expect(html).toContain('<li><span class="ck">○</span><span>person <span class="note">· waiting</span></span></li>')
    // a branch has no author group: nobody signs it off, its pass is its status vote (decided Oct 13)
    expect(html).not.toContain('<h4><span>author</span>')
    expect(html).not.toContain('@bmo_fan</a> · author')
    // the history, from the audit log
    expect(html).toContain('<h2>history</h2>')
    expect(html).toContain('submitted by <a href="/@myra?as=%40myra/m-07">@myra/m-07</a>')
    expect(html).toContain('checked by <a href="/@kestrel?as=%40kestrel/swarm/r-03">@kestrel/swarm/r-03</a> · pass · people')

    // A shwarm's submission has the author group too: the author, waiting, once the runs and people have passed.
    await waitingOnMyra(db)
    const root = await body(await b.req(ROOT_S1, { headers: HTML }))
    expect(root).toContain('<h2>checks <span>2 of 3</span></h2>')
    expect(root).toContain('<h4><span>runs</span><span class="note">1 of 1</span></h4>')
    expect(root).toContain('<h4><span>people</span><span class="note">1 of 1</span></h4>')
    expect(root).toContain('<h4><span>author</span><span class="note">waiting</span></h4>')
    expect(root).toContain('<a href="/@myra">@myra</a> · author <span class="note">· waiting</span>')
  })

  it('a superseded submission says by which, and keeps its checks with the repro', async () => {
    const { b } = await world()
    const html = await body(await b.req(S1, { headers: HTML }))
    expect(pill(html)).toBe('superseded')
    expect(html).toContain('superseded by <a href="/w/minecraft-in-doom/block-placement/s/2">#2</a>.')
    expect(html).toContain('<h2>checks <span>superseded by #2</span></h2>')
    expect(html).toContain('<h4><span>runs</span><span class="note">1 of 2</span></h4>')
    expect(html).toContain('<span class="ck n">✗</span><span><a href="/@marceline">@marceline</a> · corners still fail ~1 in 20.')
    expect(html).toContain('repro: stand diagonal to a chunk corner and place on the far face.')
    // nothing waits on a submission that takes no checks: no open slots, no empty author group
    expect(html).not.toContain('· waiting</span>')
    expect(html).not.toContain('<h4><span>author</span>')
  })

  it("an author's fail shows every other check struck as reset, and the submission failed", async () => {
    // on the shwarm: a branch has no sign-off to fail (decided Oct 13)
    const { db, b } = await world()
    const { sub, core, who } = await waitingOnMyra(db)
    await core({ type: 'check', actor: stepped(who('myra')), input: { node: EXAMPLE_ROOT, on: sub.id, slot: 'author', verdict: 'fail', repro: { steps: 'e1m4 drops to 40 fps at the lava pit.' } } })
    const html = await body(await b.req(ROOT_S1, { headers: HTML }))
    expect(pill(html)).toBe('failed')
    expect(html).toContain('<span class="stp no" id="status">failed</span>')
    expect(html).toContain('<h2>checks <span>reset · waiting for a new submission</span></h2>')
    expect(html).toContain('<h4><span>runs</span><span class="note">0 of 1</span></h4>')
    expect(html.match(/<li id="c_\w+" class="reset">/g)).toHaveLength(2)
    expect(html).toContain('<span class="note"> · reset</span>')
    expect(html).toContain('<h4><span>author</span><span class="note">failed</span></h4>')
  })

  it('a branch submission that passes its checks is approved, and the branch stays live (decided Oct 13)', async () => {
    const { db, b, get, subId } = await world()
    // @bmo_fan's people check is the last one #2 needs ("i'm playing it tonight for the last check")
    await new TreeEngine(db, () => T0).run({
      type: 'check',
      actor: site(get("SELECT id, handle FROM person WHERE handle = 'bmo_fan'") as P),
      input: { node: EXAMPLE_BRANCH, on: subId(EXAMPLE_BRANCH, 2), verdict: 'pass', text: 'played it tonight: 200 places on every corner, none vanished.', evidence: [{ url: 'https://archive.org/download/doom-blocks-checks/corners-tonight.mp4', sha256: '7'.repeat(64) }] },
    })
    const html = await body(await b.req(S2, { headers: HTML }))
    expect(pill(html)).toBe('approved')
    expect(html).toContain('<h2>checks <span>4 of 4 · passed its checks</span></h2>')
    expect(html).toContain('<h4><span>people</span><span class="note">2 of 2</span></h4>')
    expect(html).not.toContain('reopened')
    // nothing closed it: the branch's pass is its status vote, so it stays live and keeps taking submissions
    expect((get('SELECT state FROM node WHERE path = ?', EXAMPLE_BRANCH) as { state: string }).state).toBe('live')
  })

  it('unknown numbers and hidden submissions are 404; a taken-down node is 410; signed out it carries an ETag and answers 304', async () => {
    const { db, b, subId } = await world()
    for (const p of [`/w/${EXAMPLE_BRANCH}/s/9`, `/w/${EXAMPLE_ROOT}/s/1`]) {
      const res = await b.req(p, { headers: HTML })
      expect(res.status, p).toBe(404)
      expect(await body(res)).toContain('there is no submission #')
    }
    const first = await b.req(S2, { headers: HTML })
    const etag = first.headers.get('etag')!
    expect(etag).toMatch(/^W\/".*\.html\.s2"$/)
    expect(first.headers.get('cache-control')).toBe('public, s-maxage=15')
    expect(etag).not.toBe((await b.req(`/w/${EXAMPLE_BRANCH}`, { headers: HTML })).headers.get('etag'))
    expect((await b.req(S2, { headers: { ...HTML, 'if-none-match': etag } })).status).toBe(304)
    // signed in: never stored
    const reader = await signIn(b.env, 'reader')
    const mine = await reader.req(S2, { headers: { ...HTML, 'if-none-match': etag } })
    expect(mine.status).toBe(200)
    expect(mine.headers.get('cache-control')).toBe('private, no-store')
    // a hidden submission post is gone from the page as from the thread
    db.raw.prepare('UPDATE post SET hidden = 1 WHERE id = ?').run(subId(EXAMPLE_BRANCH, 1))
    expect((await b.req(S1, { headers: HTML })).status).toBe(404)
    // a node the operator took down: 410, in every form
    db.raw.prepare('UPDATE node SET hidden = 1 WHERE path = ?').run(EXAMPLE_BRANCH)
    for (const h of [HTML, { accept: 'application/json' }, { accept: '*/*' }]) expect((await b.req(S2, { headers: h })).status).toBe(410)
  })

  it('agents get the submission as text (quoted between markers) and as JSON', async () => {
    const { db, b, subId } = await world()
    const text = await (await b.req(`${S2}?format=text`)).text()
    const nonce = /<<<end-([0-9a-f]{8})>>>/.exec(text)![1]
    expect(text).toContain(`submission: https://shwarm.org${S2}`)
    // a branch waits only on checks: it has no sign-off (decided Oct 13)
    expect(text).toContain('status: in review · waiting on checks · 3 of 4 checks')
    expect(text).toContain(`<<<post-${nonce} id=${subId(EXAMPLE_BRANCH, 2)} author=@myra/m-07 kind=submission number=2>>>`)
    expect(text).toContain('how to check: load corner-repro.lmp')
    expect(text).toContain('  ○ open · person · waiting')
    expect(text).not.toContain('@bmo_fan · author')
    expect((await (await b.req(`${S2}?format=json`)).json<any>()).review).toMatchObject({ done: 3, total: 4, waiting_on: 'checks' })
    const json = await (await b.req(`${S1}?format=json`)).json<any>()
    expect(json).toMatchObject({ node: EXAMPLE_BRANCH, number: 1, status: 'superseded', superseded_by: 2, by: '@myra/m-04', review: { failed: true } })
    expect(json.checks.map((c: any) => [c.as, c.slot, c.verdict])).toEqual([['@lumpy', 'run', 'pass'], ['@marceline', 'people', 'fail']])
    expect(json.checks[0].log).toContain('soak.sh: 10000 placements')
    // a shwarm's submission names its author as the last check
    await waitingOnMyra(db)
    const root = await (await b.req(`${ROOT_S1}?format=text`)).text()
    expect(root).toContain('status: in review · waiting on author · 2 of 3 checks')
    expect(root).toContain('  ○ @myra · author · waiting')
    expect((await (await b.req(`${ROOT_S1}?format=json`)).json<any>()).review).toMatchObject({ done: 2, total: 3, waiting_on: 'author' })
  })
})

describe('waiting on the author (5.4)', () => {
  it('"waiting on you" only to the author, on the submission page and the node; "waiting on author" to everyone else', async () => {
    const { db, env, b } = await world()
    await waitingOnMyra(db)
    const author = await signIn(env, 'myra', true)
    const other = await signIn(env, 'reader')
    const mine = await body(await author.req(ROOT_S1, { headers: HTML }))
    expect(pill(mine)).toBe('waiting on you')
    expect(mine).toContain('<li><span><b>#1</b> · @kestrel/swarm/r-40</span><span class="stp wait">waiting on you</span></li>')
    expect(mine).toContain('<li><span class="ck">○</span><span><b>@myra</b> · you · the last check</span></li>')
    expect(await body(await author.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))).toContain('2 of 3 checks · waiting on you')
    for (const v of [other, b]) {
      const html = await body(await v.req(ROOT_S1, { headers: HTML }))
      expect(pill(html)).toBe('waiting on author')
      expect(html).not.toContain('waiting on you')
      expect(await body(await v.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))).toContain('2 of 3 checks · waiting on author</div>')
    }
  })

  it('a branch waits on no author (decided Oct 13): its author gets the check form, and everyone sees "waiting on checks"', async () => {
    const { env, b, get } = await world()
    // nobody was ever asked to sign off the branch's submissions
    expect((get("SELECT COUNT(*) AS n FROM inbox_item i JOIN node n ON n.id = i.node_id WHERE n.path = ? AND i.kind = 'sign_off'", EXAMPLE_BRANCH) as { n: number }).n).toBe(0)
    const author = await signIn(env, 'bmo_fan', true)
    for (const v of [author, b]) {
      const html = await body(await v.req(S2, { headers: HTML }))
      expect(pill(html)).toBe('in review')
      for (const s of ['waiting on', 'the last check', 'id="decide"']) expect(html).not.toContain(s)
      expect(await body(await v.req(`/w/${EXAMPLE_BRANCH}`, { headers: HTML }))).toContain('3 of 4 checks · waiting on checks</div>')
    }
    // @bmo_fan's "last check" (their pinned post) is a people check like anyone's
    expect(await body(await author.req(S2, { headers: HTML }))).toContain('<input type="hidden" name="do" value="check"/>')
  })

  it('a dead end waits on no one: its submission stays in review, but nobody is told to sign off', async () => {
    const { db, env, b } = await world()
    await waitingOnMyra(db)
    db.raw.prepare("UPDATE node SET state = 'dead_end', dead_end_note = 'stuck at 40 fps once every wall digs' WHERE path = ?").run(EXAMPLE_ROOT)
    const author = await signIn(env, 'myra', true)
    vi.setSystemTime(T0 + 3 * DAY)
    for (const v of [author, b]) {
      const html = await body(await v.req(ROOT_S1, { headers: HTML }))
      expect(pill(html)).toBe('in review')
      expect(html).not.toContain('waiting on')
      expect(html).not.toContain('waiting 3 days')
      expect(html).not.toContain('the last check')
    }
    const text = await (await b.req(`${ROOT_S1}?format=text`)).text()
    expect(text).toContain('status: in review · 2 of 3 checks')
    expect(text).toContain('this submission takes no checks now.')
    expect((await (await b.req(`${ROOT_S1}?format=json`)).json<any>()).review).toMatchObject({ done: 2, total: 3, waiting_on: null })
  })

  it('counts the days since the author was asked: "waiting 3 days"', async () => {
    const { db, b } = await world()
    await waitingOnMyra(db) // asked at T0
    vi.setSystemTime(T0 + 3 * DAY)
    const html = await body(await b.req(ROOT_S1, { headers: HTML }))
    expect(html).toContain('<h4><span>author</span><span class="note">waiting 3 days</span></h4>')
    expect(await body(await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))).toContain('2 of 3 checks · waiting on author · 3 days')
    vi.setSystemTime(T0 + DAY + 3_600_000)
    resetReadLimit() // the read cap's clock went back
    expect(await body(await b.req(ROOT_S1, { headers: HTML }))).toContain('<span class="note">waiting 1 day</span>')
  })

  it("the A9 swap: a submission from @myra's agent on @myra's shwarm says one more people check stands in", async () => {
    const { db, b, myraId } = await world()
    const myra = { id: myraId, handle: 'myra' }
    const engine = new TreeEngine(db, () => T0)
    await engine.run({
      type: 'submit',
      actor: keyActor(myra, '@myra/m-09', { id: 'myra-key', canPostAs: '@myra/*', grants: [{ node: '*', perms: ['submit'] }] }),
      input: { node: EXAMPLE_ROOT, text: 'a first playable build.', links: [{ url: 'https://codeberg.org/myra/doom-blocks/archive/v0.1.zip', sha256: '5c'.repeat(32) }], howToCheck: 'play it for 10 minutes.' },
    })
    const html = await body(await b.req(`/w/${EXAMPLE_ROOT}/s/1`, { headers: HTML }))
    expect(html).toContain("<p class=\"note swap\">the author's own work: one more people check stands in for the author's sign-off.</p>")
    expect(html).not.toContain('<h4><span>author</span>')
  })
})

describe('inbox links (5.2)', () => {
  it("the author's sign-off item opens the right submission's page", async () => {
    const { db, env, myraId } = await world()
    await waitingOnMyra(db) // a shwarm's: a branch has no sign-off (decided Oct 13)
    const author = await signIn(env, 'myra', true)
    const item = db.raw.prepare(`SELECT i.id, ${INBOX_LINK_COLS} FROM inbox_item i ${INBOX_LINK_JOIN} WHERE i.person_id = ? AND i.kind = 'sign_off'`).get(myraId) as any
    expect(inboxHref(item)).toBe(ROOT_S1)
    expect((await readInboxLinks(db, myraId, [item.id])).get(item.id)).toBe(ROOT_S1)
    expect(await body(await author.req(inboxHref(item), { headers: HTML }))).toContain('<h1>submission #1</h1>')
    // someone else's items aren't read
    expect((await readInboxLinks(db, myraId + 100, [item.id])).size).toBe(0)
  })

  it('mentions open the post, system items the node', () => {
    expect(inboxHref({ kind: 'mention', post_id: 'p_abcdefgh', node_path: EXAMPLE_BRANCH, number: null })).toBe(`/w/${EXAMPLE_BRANCH}#p_abcdefgh`)
    expect(inboxHref({ kind: 'system', post_id: null, node_path: EXAMPLE_ROOT, number: null })).toBe(`/w/${EXAMPLE_ROOT}`)
    expect(inboxHref({ kind: 'sign_off', post_id: 'p_abcdefgh', node_path: null, number: 2 })).toBe('/')
  })
})

describe('the page tallies are core tallies', () => {
  const LIST: any[] = JSON.parse(readFileSync(new URL('../../../docs/launch-shwarms.json', import.meta.url), 'utf8'))
  const mixes = new Map<string, CheckSpec>()
  for (const e of LIST) {
    const spec = parseCheckSpec(mapLaunchShwarm(e).input.check)
    mixes.set(JSON.stringify({ ...spec, runs: spec.runs?.count, people: spec.people && { count: spec.people.count, human: spec.people.human } }), spec)
  }
  const sub = (swap: boolean): SubmissionRow => ({ post_id: 'p_s', number: 1, hash: '0'.repeat(64), how_to_check: '', status: 'in_review', author_swap: swap ? 1 : 0, superseded_number: null, as_name: '@x/a', person_id: 9, created_at: '', ready_at: null })
  const report = (r: CheckRow, i: number): CheckReport => ({
    id: `c_${i}`, post_id: `p_${i}`, submission_id: 'p_s', slot: r.slot, verdict: r.verdict, evidence: null, repro: null, submission_hash: null,
    exit_code: r.slot === 'run' ? 0 : null, log_inline: 0, log_link: null, machine: null, created_at: '', as_name: r.human ? `@h${i}` : `@h${i}/a`, text: '', human: r.human ? 1 : 0,
  })

  it('agree on every launch mix: each partial set of checks, with and without a standing fail, with and without the A9 swap', () => {
    expect(mixes.size).toBeGreaterThanOrEqual(4)
    let cases = 0
    for (const spec of mixes.values()) {
      for (const swap of spec.author ? [false, true] : [false]) {
        const need = needs(spec, swap)
        for (let runs = 0; runs <= need.runs + 1; runs++)
          for (let people = 0; people <= need.people + 1; people++)
            for (const humans of people ? [0, 1] : [0])
              for (const author of need.author ? [false, true] : [false])
                for (const fail of [false, true]) {
                  const rows: CheckRow[] = [
                    ...Array.from({ length: runs }, (): CheckRow => ({ slot: 'run', verdict: 'pass', human: false })),
                    ...Array.from({ length: people }, (_, i): CheckRow => ({ slot: 'people', verdict: 'pass', human: i < humans })),
                    ...(author ? [{ slot: 'author', verdict: 'pass', human: true } as CheckRow] : []),
                    ...(fail ? [{ slot: 'people', verdict: 'fail', human: true } as CheckRow] : []),
                  ]
                  const t = tally(need, rows)
                  const r = review(spec, '@myra', sub(swap), rows.map(report))
                  const what = JSON.stringify({ spec, swap, runs, people, humans, author, fail })
                  cases++
                  expect(r.failed, what).toBe(t.repro)
                  expect(r.waitingOn, what).toBe(t.repro ? null : t.othersDone ? (need.author && !t.author ? 'author' : null) : 'checks')
                  // "n of m" reaches m exactly when core would pass it (a standing fail aside), and m - 1 when only the author is left
                  if (!fail) expect(r.done === r.total, what).toBe(t.passed)
                  if (!fail && need.author && !t.author) expect(r.done === r.total - 1, what).toBe(t.othersDone)
                }
      }
    }
    expect(cases).toBeGreaterThan(50)
  })
})
