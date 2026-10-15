// Go-live 5.2: an old submission's page at /w/<path>/s/<n> (in all three forms), as history. Nothing takes submissions,
// checks or a sign-off since Oct 14 (one model for every node: a pass is a claim people back), so the rows here are
// written straight in, as migration 0032 left them, and the page has no forms. Also: inbox links to the right
// submission, and the page's tallies against core's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { needs, NO_CHECKS, tally, type CheckRow, type CheckSpec } from '../src/core/checks'
import { NO_CHECKS as NO_CHECKS_WORDS } from '../src/core/status'
import { INBOX_LINK_COLS, INBOX_LINK_JOIN, inboxHref, readInboxLinks } from '../src/read/inbox-links'
import type { CheckReport, SubmissionRow } from '../src/read/node'
import { review } from '../src/read/review'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { hashPassword } from '../src/auth/password'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { MIN, person, site, World, type P } from './core-fixtures'
import { T0 } from './d1'

const MID = 'minecraft-in-doom'
const BP = `${MID}/block-placement`
const HTML = { accept: 'text/html' }
const S1 = `/w/${MID}/s/1`
const S2 = `/w/${MID}/s/2`
const SPEC: CheckSpec = { runs: { command: './soak.sh', count: 1 }, people: { count: 1, human: true }, author: true }
const H1 = 'a1'.repeat(32)
const H2 = 'c4'.repeat(32)
const LOG = 'soak.sh: 10000 placements on chunk corners\n0 failures\nexit 0'

let w: World
let myra: P, kestrel: P, lumpy: P, marceline: P

const at = (min: number) => new Date(T0 - min * MIN).toISOString()

/**
 * The shwarm's two submissions from before Oct 14, written as migration 0032 left them: #1 superseded by #2 after
 * @marceline's failing check, with its run; #2 passed on @lumpy's run, @kestrel's people check and @myra's sign-off.
 * A run of @lumpy's on #1 that an author's fail reset is kept too.
 */
async function history() {
  const db = w.db.raw
  const n = w.node(MID)
  db.prepare('UPDATE node SET checks = ? WHERE id = ?').run(JSON.stringify(SPEC), n.id)
  const post = db.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, links, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
  post.run('p_oldsub0001', n.id, myra.id, '@myra/m-04', 'submission', "confirmed finn's diagnosis and patched it: edges place.", JSON.stringify([{ url: 'https://codeberg.org/myra/doom-blocks/raw/edge-fix.diff', sha256: '1c'.repeat(32) }]), at(300))
  post.run('p_oldsub0002', n.id, kestrel.id, '@kestrel/swarm/r-40', 'submission', 'the neighbor lookup rounded toward zero. two-line fix on top of #1.', JSON.stringify([{ repo: 'https://codeberg.org/kestrel/doom-blocks', commit: '9fceb02d0ae598e95dc970b74767f19372d61af8' }]), at(100))
  const sub = db.prepare('INSERT INTO submission (post_id, node_id, number, hash, how_to_check, status, superseded_by, author_swap, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)')
  sub.run('p_oldsub0002', n.id, 2, H2, 'load corner-repro.lmp, place 200 times on each corner. expect 0 failures.', 'passed', null, at(20))
  sub.run('p_oldsub0001', n.id, 1, H1, 'place 200 times on each chunk edge.', 'superseded', 'p_oldsub0002', null)
  const check = (id: string, subId: string, p: P, as: string, slot: string, verdict: string, text: string, o: { hash?: string; repro?: string; evidence?: string; reset?: string; min: number }) => {
    post.run(`p_${id}`, n.id, p.id, as, 'check', text, '[]', at(o.min))
    db.prepare(
      `INSERT INTO check_report (id, post_id, submission_id, person_id, slot, verdict, evidence, repro, submission_hash, script_hash, exit_code, log_inline, machine, reset_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(`c_${id}`, `p_${id}`, subId, p.id, slot, verdict, o.evidence ?? null, o.repro ?? null, slot === 'run' ? o.hash : null, slot === 'run' ? '5d02b7e' : null, slot === 'run' ? 0 : null, slot === 'run' ? LOG : null, slot === 'run' ? 'linux, rtx 3060' : null, o.reset ?? null, at(o.min))
  }
  check('oldchk0001', 'p_oldsub0001', lumpy, '@lumpy', 'run', 'pass', '', { hash: H1, min: 290, reset: at(200) })
  check('oldchk0002', 'p_oldsub0001', marceline, '@marceline', 'people', 'fail', 'corners still fail ~1 in 20.', { min: 280, repro: JSON.stringify({ steps: 'stand diagonal to a chunk corner and place on the far face.' }) })
  check('oldchk0003', 'p_oldsub0002', lumpy, '@lumpy', 'run', 'pass', '', { hash: H2, min: 90 })
  check('oldchk0004', 'p_oldsub0002', kestrel, '@kestrel', 'people', 'pass', 'ran the repro 200× per corner, 0 failures.', { min: 60, evidence: JSON.stringify([{ url: 'https://archive.org/download/x/corner-rerun.log', sha256: '2d'.repeat(32), label: 'rerun log' }]) })
  check('oldchk0005', 'p_oldsub0002', myra, '@myra', 'author', 'pass', 'played it for an hour.', { min: 20 })
  const event = db.prepare('INSERT INTO audit_event (id, at, event, node_id, by_name, submission_id, number, detail, evidence, milestone) VALUES (?, ?, ?, ?, ?, ?, 2, ?, ?, 1)')
  event.run('e_oldsub0002', at(100), 'submission', n.id, '@kestrel/swarm/r-40', 'p_oldsub0002', '#2 (c4c4c4c)', S2)
  event.run('e_oldchk0003', at(90), 'check', n.id, '@lumpy', 'p_oldsub0002', 'pass · run · exit 0 on #2 (c4c4c4c) · linux, rtx 3060', S2)
  event.run('e_oldpass002', at(20), 'passed', n.id, null, 'p_oldsub0002', '#2 (c4c4c4c) passed', S2)
}

beforeEach(async () => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  resetReadLimit()
  forgetVersions()
  w = new World()
  myra = await person(w.db, 'myra')
  kestrel = await person(w.db, 'kestrel')
  lumpy = await person(w.db, 'lumpy')
  marceline = await person(w.db, 'marceline')
  await w.shwarm(site(myra))
  await w.branch(site(myra), MID)
  w.db.raw.prepare("UPDATE node SET triage = 'clear'").run()
  await history()
  vi.setSystemTime(w.now)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const browser = () => new Browser(testEnv(w.db))
async function member(p: P) {
  w.db.raw.prepare('UPDATE person SET password_hash = ? WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), p.id)
  const b = browser()
  expect((await b.post('/signin', { email: `${p.handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}
const pill = (html: string) => /<span class="stp[^"]*" id="status">([^<]+)<\/span>/.exec(html)?.[1]

describe('an old submission\'s page (5.2): history, no forms', () => {
  it('shows the submission: crumbs, the pinned hash at the top, the quoted done test, what was submitted, the sidebar', async () => {
    const html = await body(await browser().req(S2, { headers: HTML }))
    expect(html).toContain('<title>submission #2 · minecraft in doom · shwarm</title>')
    expect(html).toContain(`<nav class="crumbs" aria-label="breadcrumb"><a href="/w/${MID}">minecraft in doom</a><span>/</span>submission #2</nav>`)
    const top = html.indexOf(`version <code title="sha256 ${H2}">${H2.slice(0, 7)}</code>`)
    expect(top).toBeGreaterThan(0)
    expect(top).toBeLessThan(html.indexOf('<h2>what was submitted</h2>'))
    expect(html).toContain('<div class="quote"><b>done when</b><div class="txt"><p>a downloadable uzdoom mod rebuilds freedoom phase 1 maps')
    expect(html).toContain('<dt>linked</dt><dd><a href="https://codeberg.org/kestrel/doom-blocks"')
    expect(html).toContain('<dt>how to check</dt><dd>load corner-repro.lmp, place 200 times on each corner. expect 0 failures.</dd>')
    // the sidebar: the node, and every submission with its pill as it ended; no "checked by" (retired Oct 14)
    expect(html).not.toContain('checked by</b>')
    expect(html).toContain('<li><span><b>#2</b> · @kestrel/swarm/r-40</span><span class="stp ok">passed</span></li>')
    expect(html).toContain(`<li><span><a href="${S1}"><b>#1</b></a> · @myra/m-04</span><span class="stp">superseded</span></li>`)
    expect(html).toContain(`<p class="note back"><a href="/w/${MID}">back to the shwarm →</a></p>`)
    expect(html).toContain('<div class="box agent-res">')
    // no forms: nothing is checked or signed off now
    for (const gone of ['id="check"', 'id="decide"', 'name="do"', 'one submission per person', 'waiting on', 'your sign-off']) expect(html, gone).not.toContain(gone)
  })

  it('a passed one: "passed" on its pill and its checks, grouped with their tallies, the signed log in place; never "reopened"', async () => {
    // every node is live since Oct 14: an old pass doesn't read as reopened
    expect(w.node(MID).state).toBe('live')
    const html = await body(await (await member(myra)).req(S2, { headers: HTML }))
    expect(pill(html)).toBe('passed')
    expect(html).toContain('<h2>checks <span>3 of 3 · passed</span></h2>')
    expect(html).toContain('<h4><span>runs</span><span class="note">1 of 1</span></h4>')
    expect(html).toContain('<h4><span>people</span><span class="note">1 of 1</span></h4>')
    expect(html).toContain('<h4><span>author</span><span class="note">passed</span></h4>')
    expect(html).toMatch(/<li id="c_oldchk0003"><span class="ck y">✓<\/span><span><a href="\/@lumpy">@lumpy<\/a> · run · <code class="cmd">\.\/soak\.sh<\/code> exit 0 on #2 \(c4c4c4c\) · linux, rtx 3060 · <details class="log"><summary>signed log<\/summary><pre class="log">soak\.sh: 10000 placements on chunk corners/)
    expect(html).toContain('ran the repro 200× per corner, 0 failures. · <a href="https://archive.org/download/x/corner-rerun.log"')
    expect(html).not.toContain('reopened')
    expect(html).not.toContain('<span class="ck">○</span>') // nothing waits
    // the history, from the audit log
    expect(html).toContain('<h2>history</h2>')
    expect(html).toContain('submitted by <a href="/@kestrel?as=%40kestrel/swarm/r-40">@kestrel/swarm/r-40</a>')
    expect(html).toContain('checked by <a href="/@lumpy">@lumpy</a> · pass · run')
  })

  it('a superseded one says by which, and keeps its checks with the repro and the reset run struck', async () => {
    const html = await body(await browser().req(S1, { headers: HTML }))
    expect(pill(html)).toBe('superseded')
    expect(html).toContain(`superseded by <a href="${S2}">#2</a>.`)
    expect(html).toContain('<h2>checks <span>superseded by #2</span></h2>')
    expect(html).toContain('<span class="ck n">✗</span><span><a href="/@marceline">@marceline</a> · corners still fail ~1 in 20.')
    expect(html).toContain('how to make it fail: stand diagonal to a chunk corner and place on the far face.')
    expect(html).toContain('<li id="c_oldchk0001" class="reset">')
    expect(html).toContain(`<span class="note"> · no longer counts: the author's fail reset the checks</span>`)
    expect(html).not.toContain('<h4><span>author</span>')
  })

  it('one left in review when submissions retired says superseded, naming no later one (migration 0032)', async () => {
    w.db.raw.prepare("UPDATE submission SET superseded_by = NULL WHERE post_id = 'p_oldsub0001'").run()
    const html = await body(await browser().req(S1, { headers: HTML }))
    expect(pill(html)).toBe('superseded')
    expect(html).toContain('<h2>checks <span>superseded</span></h2>')
    expect(html).not.toContain('#?')
    expect(html).not.toContain('superseded by')
  })

  it('a check row link keeps its real host on screen, whatever its label claims', async () => {
    const fake = { url: 'https://evil.example/fix.diff', sha256: 'a'.repeat(64), label: 'codeberg.org/bmo_fan/corner-fix.diff' }
    w.db.raw.prepare("UPDATE check_report SET evidence = ? WHERE id = 'c_oldchk0004'").run(JSON.stringify([fake]))
    for (const path of [`/w/${MID}`, S2]) {
      const html = await body(await browser().req(path, { headers: HTML }))
      expect(html, path).toContain('<a href="https://evil.example/fix.diff" rel="nofollow ugc noopener noreferrer" title="sha256 aaaa…">codeberg.org/bmo_fan/corner-fix.diff ↗</a> <span class="note">(evil.example)</span>')
    }
  })

  it('in the thread: the old submission with its links, how it was checked and its checks; nothing to check it with', async () => {
    const html = await body(await browser().req(`/w/${MID}`, { headers: HTML }))
    const two = html.slice(html.indexOf('<div class="c subm" id="p_oldsub0002">'), html.indexOf('</div></div></div>', html.indexOf('id="p_oldsub0002"')))
    expect(two).toContain('<span class="sb">submission #2</span>')
    expect(two).toContain('<div class="h"><b>passed</b><span>3 of 3 checks</span></div>')
    expect(two).toContain('<div class="how"><b>how to check</b> load corner-repro.lmp')
    for (const gone of ['open submission', "can't check", '· waiting']) expect(two, gone).not.toContain(gone)
  })

  it("a form posted from an old page is refused with why; nothing is written", async () => {
    const b = await member(kestrel)
    const token = formTokenIn(await body(await b.req(`/w/${MID}`, { headers: HTML })))
    for (const f of [{ do: 'check', verdict: 'pass', text: 'ok' }, { do: 'signoff', verdict: 'pass', text: '' }]) {
      const res = await b.req(S2, { form: { form_token: token, ...f } })
      expect(res.status).toBe(400)
      expect(await body(res)).toContain(`${NO_CHECKS_WORDS}.`)
    }
    expect(w.get('SELECT COUNT(*) AS n FROM check_report').n).toBe(5)
  })

  it('unknown numbers and hidden submissions are 404; a taken-down node is 410; signed out it carries an ETag and answers 304', async () => {
    const b = browser()
    for (const p of [`/w/${MID}/s/9`, `/w/${BP}/s/1`]) {
      const res = await b.req(p, { headers: HTML })
      expect(res.status, p).toBe(404)
      expect(await body(res)).toContain('there is no submission #')
    }
    const first = await b.req(S2, { headers: HTML })
    const etag = first.headers.get('etag')!
    expect(etag).toMatch(/^W\/".*\.html\.s2"$/)
    expect(first.headers.get('cache-control')).toBe('public, s-maxage=15')
    expect(etag).not.toBe((await b.req(`/w/${MID}`, { headers: HTML })).headers.get('etag'))
    expect((await b.req(S2, { headers: { ...HTML, 'if-none-match': etag } })).status).toBe(304)
    // signed in: never stored
    const mine = await (await member(lumpy)).req(S2, { headers: { ...HTML, 'if-none-match': etag } })
    expect(mine.status).toBe(200)
    expect(mine.headers.get('cache-control')).toBe('private, no-store')
    // a hidden submission post is gone from the page as from the thread
    w.db.raw.prepare("UPDATE post SET hidden = 1 WHERE id = 'p_oldsub0001'").run()
    expect((await b.req(S1, { headers: HTML })).status).toBe(404)
    // a node the operator took down: 410, in every form
    w.db.raw.prepare('UPDATE node SET hidden = 1 WHERE path = ?').run(MID)
    for (const h of [HTML, { accept: 'application/json' }, { accept: '*/*' }]) expect((await b.req(S2, { headers: h })).status).toBe(410)
  })

  it('agents get it as text and as JSON', async () => {
    const b = browser()
    const text = await (await b.req(`${S2}?format=text`)).text()
    expect(text).toContain(`submission: https://shwarm.org${S2}`)
    expect(text).toContain('how to check: load corner-repro.lmp')
    const json = await (await b.req(`${S1}?format=json`)).json<any>()
    expect(json).toMatchObject({ node: MID, number: 1, status: 'superseded', superseded_by: 2, by: '@myra/m-04' })
  })
})

describe('inbox links (5.2)', () => {
  it('an old sign-off item opens its submission\'s page, and shows there as history', async () => {
    const n = w.node(MID)
    w.db.raw.prepare("INSERT INTO inbox_item (person_id, kind, node_id, post_id, text, created_at, done_at) VALUES (?, 'sign_off', ?, 'p_oldsub0002', '', ?, ?)").run(myra.id, n.id, at(40), at(20))
    const item = w.db.raw.prepare(`SELECT i.id, ${INBOX_LINK_COLS} FROM inbox_item i ${INBOX_LINK_JOIN} WHERE i.person_id = ? AND i.kind = 'sign_off'`).get(myra.id) as any
    expect(inboxHref(item)).toBe(S2)
    expect((await readInboxLinks(w.db, myra.id, [item.id])).get(item.id)).toBe(S2)
    const b = await member(myra)
    const inbox = await body(await b.req('/@myra', { headers: HTML }))
    expect(inbox).toContain(`<div class="who"><span class="stp ok">passed</span>`)
    expect(inbox).toContain(`<a href="${S2}"><b>minecraft in doom · submission #2</b></a> by @kestrel/swarm/r-40<div class="acts">`)
    for (const gone of ['needs your sign-off', 'waiting on you', 'sign off as the operator']) expect(inbox).not.toContain(gone)
    expect(await body(await b.req(inboxHref(item), { headers: HTML }))).toContain('<h1>submission #2</h1>')
    // someone else's items aren't read
    expect((await readInboxLinks(w.db, myra.id + 100, [item.id])).size).toBe(0)
  })

  it('mentions open the post, system items the node (or its pass box), an old sign-off with no node home', () => {
    expect(inboxHref({ kind: 'mention', post_id: 'p_abcdefgh', node_path: BP, number: null })).toBe(`/w/${BP}#p_abcdefgh`)
    expect(inboxHref({ kind: 'system', post_id: null, node_path: MID, number: null })).toBe(`/w/${MID}`)
    expect(inboxHref({ kind: 'system', post_id: 'p_abcdefgh', node_path: MID, number: null })).toBe(`/w/${MID}#passed`)
    expect(inboxHref({ kind: 'sign_off', post_id: 'p_abcdefgh', node_path: null, number: 2 })).toBe('/')
  })
})

describe('the page tallies are core tallies', () => {
  const MIXES: CheckSpec[] = [
    { author: true },
    { runs: { command: './t.sh', count: 2 }, author: true },
    { people: { count: 2, human: true }, author: true },
    { runs: { command: './t.sh', count: 1 }, people: { count: 1, human: false }, author: true },
    { runs: { command: './t.sh', count: 2 }, people: { count: 2, human: true }, author: false },
    NO_CHECKS,
  ]
  const sub = (swap: boolean): SubmissionRow => ({ post_id: 'p_s', number: 1, hash: '0'.repeat(64), how_to_check: '', status: 'in_review', author_swap: swap ? 1 : 0, superseded_number: null, as_name: '@x/a', person_id: 9, created_at: '', ready_at: null })
  const report = (r: CheckRow, i: number): CheckReport => ({
    id: `c_${i}`, post_id: `p_${i}`, submission_id: 'p_s', slot: r.slot, verdict: r.verdict, evidence: null, repro: null, submission_hash: null,
    exit_code: r.slot === 'run' ? 0 : null, log_inline: 0, log_link: null, machine: null, created_at: '', as_name: r.human ? `@h${i}` : `@h${i}/a`, text: '', human: r.human ? 1 : 0,
  })

  it('agree on every mix the old shwarms had: each partial set of checks, with and without a standing fail, with and without the A9 swap', () => {
    let cases = 0
    for (const spec of MIXES) {
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
                  if (!fail) expect(r.done === r.total, what).toBe(t.passed)
                  if (!fail && need.author && !t.author) expect(r.done === r.total - 1, what).toBe(t.othersDone)
                }
      }
    }
    expect(cases).toBeGreaterThan(50)
  })
})

