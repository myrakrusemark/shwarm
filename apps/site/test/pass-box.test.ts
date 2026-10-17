// The page side of one model for every node (decided Oct 14, "One model for every node" and "With nothing locking: build
// on any shwarm, a pass box in place of the result page, a passed tab"): a shwarm's people card and its claim forms, a
// passed claim's work in its form and in the thread ("the work", not "pinned work", since Oct 15), the pass box with its
// records, history and "since then", the author's "approve it" (in the pass box, or before any record in their own box;
// "mark it passed" until Oct 15), "✓ author approved" on the page head and the feed card, and "builds on …, as passed".
// The acts and records behind them are test/records.test.ts and test/pins.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { NOT_A_PASSED_CLAIM } from '../src/core/records'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { rollupStats } from '../src/jobs/stats'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { schemaErrors } from './contract'
import { HOUR, person, site, stepped, World, type P } from './core-fixtures'
import { T0 } from './d1'

const MID = 'minecraft-in-doom'
const BP = 'minecraft-in-doom/block-placement'
const COMMIT = '9fceb02d0ae598e95dc970b74767f19372d61af8'
const IPFS = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/mid.pk3'
const MAGNET = 'magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a&dn=mid'
const PINS = [{ repo: 'https://codeberg.org/myra/doom-blocks', commit: COMMIT }, { ipfs: IPFS }, { magnet: MAGNET }]
const EVIDENCE = 'all nine maps from a pistol start, 60 fps on the reference rig.'

let w: World
let myra: P, kestrel: P, lumpy: P, ana: P

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
  ana = await person(w.db, 'ana')
  await w.shwarm(site(myra))
  await w.branch(site(myra), MID)
  w.db.raw.prepare("UPDATE node SET triage = 'clear'").run()
  await w.join(site(kestrel), MID)
  await w.join(site(lumpy), MID)
  vi.setSystemTime(w.now)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function member(p: P) {
  w.db.raw.prepare('UPDATE person SET password_hash = ? WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), p.id)
  const b = new Browser(testEnv(w.db))
  expect((await b.post('/signin', { email: `${p.handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}
const page = async (b: Browser, path = MID) => body(await b.req(`/w/${path}`, { headers: { accept: 'text/html' } }))
const part = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)))
const passBox = (html: string) => part(html, '<div class="box passbox" id="passed">', '<div class="compose')
/** The time moves on, and the next page read sees it. */
const tick = (ms: number) => {
  w.tick(ms)
  vi.setSystemTime(w.now)
  forgetVersions()
}
/** kestrel's passed claim with its pins, backed by lumpy: passed leads on track by 2, so it passes 24 hours on. */
async function passing() {
  const c = await w.post(site(kestrel), MID, EVIDENCE, { claim: 'passed', links: PINS })
  await w.run({ type: 'back', actor: site(lumpy), input: { node: MID, post: c.id, on: true } })
  return c.id as string
}
/** 25 hours on, an act saves the band, and with it the change to passed at hour 24 (core/status.ts). */
async function passed() {
  const c = await passing()
  tick(25 * HOUR)
  await w.join(site(ana), MID)
  await w.run({ type: 'status', actor: site(ana), input: { node: MID, status: 'on_track' } })
  return c
}

describe("a shwarm's status, as a branch's (decided Oct 14)", () => {
  it('the head and the people card show its badge; no "checked by", submit form or result page; build on is offered', async () => {
    const html = await page(new Browser(testEnv(w.db)))
    expect(part(html, '<div class="state">', '</section>')).toContain('<button type="button" class="st vs on-track" aria-expanded="false" aria-controls="vb-head"')
    expect(part(html, '<div class="box people" id="people">', '</div><div class="in">')).toContain('<h2 class="sunny">on this shwarm</h2><div class="vote-badge">')
    expect(html).toContain(`<div class="alt"><a href="/new?builds_on=${MID}">build on this shwarm</a></div>`)
    for (const gone of ['<h3>checked by</h3>', 'submit work against the done test', 'live · day', '/css/result.css', 'class="box proof"', 'class="compose locked"']) expect(html).not.toContain(gone)
    // the retired result page's address is the page itself
    const thread = await body(await new Browser(testEnv(w.db)).req(`/w/${MID}?thread=1`, { headers: { accept: 'text/html' } }))
    expect(thread).toContain(`<link rel="canonical" href="https://shwarm.org/w/${MID}"/>`)
    expect(thread).not.toContain('back to result')
  })

  it("joined: how's it going?, and claim forms that ask about the shwarm", async () => {
    const html = await page(await member(kestrel))
    expect(html).toContain(`<p class="note"><b>how's it going?</b></p>`)
    expect(html).toContain('<label for="cl-blocked">what is this shwarm waiting on?</label>')
    expect(html).toContain('<label for="cl-passed">what shows this shwarm passes its done test?</label>')
    // not joined: the count, and why there's no button
    const c = await w.post(site(kestrel), MID, 'the corner case is back.', { claim: 'blocked' })
    expect(await page(await member(ana))).toContain(`<span class="up" title="join this shwarm to back its claims">1 backer</span>`)
    expect(c.id).toMatch(/^p_/)
  })
})

describe('the work on a passed claim (decided Oct 14; "the work" since Oct 15)', () => {
  it('only the passed claim form takes pins, one per line, with the hint', async () => {
    const html = await page(await member(kestrel))
    const f = part(html, '<form id="claim-passed"', '</form>')
    expect(f).toContain('<label for="cl-passed-pins">the work <span class="note">· optional</span></label>')
    expect(f).toContain('<span class="note" id="cl-passed-pins-n">one per line</span>')
    // no format fine print in the form (decided Oct 15): no path steps, no magnet keys
    expect(f).not.toMatch(/\.\.|btih|xt=|optional path/)
    expect(f).toContain('<textarea id="cl-passed-pins" class="pins" name="links" rows="2" aria-describedby="cl-passed-pins-n cl-passed-pins-h"')
    expect(f).toContain("link the exact version: a repo and its commit, a file and its sha256, an ipfs:// address or a magnet: link. if this is code or files, link them here. a pass without them can't be checked later.")
    expect(f).not.toContain('pinned work')
    expect(part(html, '<form id="claim-blocked"', '</form>')).not.toContain('name="links"')
    expect(part(html, '<form id="claim-dead_end"', '</form>')).not.toContain('name="links"')
  })

  it('posted from the form: "the work:" in the thread, the self-hashing ones as code to copy', async () => {
    const b = await member(kestrel)
    const links = `https://codeberg.org/myra/doom-blocks ${COMMIT}\n${IPFS}\n\n${MAGNET}\n`
    const r = await b.req(`/w/${MID}`, { form: { form_token: formTokenIn(await page(b)), do: 'claim', status: 'passed', text: EVIDENCE, links } })
    expect(r.status).toBe(303)
    const id = r.headers.get('location')!.split('#')[1]
    expect(JSON.parse(w.get('SELECT links FROM post WHERE id = ?', id).links)).toEqual(PINS)
    const post = part(await page(new Browser(testEnv(w.db))), `<div class="c" id="${id}">`, '<div class="acts">')
    expect(post).toContain('<div class="how pins"><b>the work:</b><ul><li><a href="https://codeberg.org/myra/doom-blocks" rel="nofollow ugc noopener noreferrer">myra/doom-blocks ↗</a> <span class="note">(codeberg.org, commit 9fceb02)</span></li>')
    expect(post).toContain(`<li><code class="pin">${IPFS}</code></li>`)
    expect(post).toContain(`<li><code class="pin">${MAGNET}</code></li>`)
    expect(post).not.toContain('<a href="ipfs:') // nothing is fetched, no gateway
  })

  it('a passed claim with none says so; a blocked claim\'s links show as any post\'s', async () => {
    const none = await w.post(site(kestrel), MID, EVIDENCE, { claim: 'passed' })
    const blocked = await w.post(site(lumpy), MID, 'corners fail again.', { claim: 'blocked', links: [{ url: 'https://archive.org/download/x/repro.lmp', sha256: '3b'.repeat(32) }] })
    const html = await page(new Browser(testEnv(w.db)))
    expect(part(html, `<div class="c" id="${none.id}">`, '<div class="acts">')).toContain('<p class="note pins">no work linked</p>')
    const b = part(html, `<div class="c" id="${blocked.id}">`, '</div></div>')
    expect(b).not.toContain('no work linked')
    expect(b).not.toContain('the work:')
    expect(b).toContain('linked: <a href="https://archive.org/download/x/repro.lmp"')
  })

  it("a refused pin opens the form again with the words, the pins and core's reason", async () => {
    const b = await member(kestrel)
    const r = await b.req(`/w/${MID}`, { form: { form_token: formTokenIn(await page(b)), do: 'claim', status: 'passed', text: EVIDENCE, links: 'https://codeberg.org/myra/doom-blocks/fix.diff' } })
    expect(r.status).toBe(400)
    const f = part(await body(r), '<form id="claim-passed"', '</form>')
    expect(f).toContain('class="claim-act open"')
    expect(f).toContain(`>${EVIDENCE}</textarea>`)
    expect(f).toContain('placeholder="https://codeberg.org/you/project 9fceb02d0ae598e95dc970b74767f19372d61af8">https://codeberg.org/myra/doom-blocks/fix.diff</textarea>')
    expect(f).toMatch(/<p class="err" role="alert">links\[0\][^<]*\.<\/p>/)
    expect(w.get("SELECT COUNT(*) AS n FROM post WHERE claim = 'passed'").n).toBe(0)
  })
})

describe('the pass box (decided Oct 14, in place of the result page)', () => {
  it('none until there is a record', async () => {
    await passing()
    expect(await page(new Browser(testEnv(w.db)))).not.toContain('class="box passbox"')
  })

  it("its people's pass: when, the claim, its backers then and its work; the status history, folded", async () => {
    const c = await passed()
    const html = await page(new Browser(testEnv(w.db)))
    const box = passBox(html)
    expect(box).toContain('<h2>passed</h2>')
    expect(box).toContain(
      `<li class="crowd"><div>passed as of <span title="${new Date(T0 + 24 * HOUR).toISOString().slice(0, 10)} ${new Date(T0 + 24 * HOUR).toISOString().slice(11, 16)} utc">`,
    )
    expect(box).toContain(` · <a href="#${c}">@kestrel's passed claim</a> · backed by 2</div><div class="how pins"><b>the work:</b>`)
    expect(box).toContain(`<code class="pin">${IPFS}</code>`)
    expect(box).toMatch(/<details class="hist"><summary>status history<\/summary><ol><li>on track → <a href="#p_\w+">passed<\/a> · <span title="[^"]+">[a-z]{3} \d+ \d\d:\d\d<\/span> · 2 to 0<\/li><\/ol><\/details>/)
    expect(box).not.toContain('since then')
    // signed out, and for anyone but the author: no approve form
    expect(box).not.toContain('approve it')
    expect(passBox(await page(await member(kestrel)))).not.toContain('approve it')
    // the badge says passed
    expect(part(html, '<div class="state">', '</section>')).toContain('class="st vs passed"')
  })

  it('once the status moves on: "since then: blocked (…)", the old record kept', async () => {
    await passed()
    const b = await w.post(site(ana), MID, 'corners fail again since the renderer patch.', { claim: 'blocked' })
    for (const p of [kestrel, lumpy]) await w.run({ type: 'back', actor: site(p), input: { node: MID, post: b.id, on: true } })
    tick(24 * HOUR)
    await w.run({ type: 'status', actor: site(myra), input: { node: MID, status: 'on_track' } })
    const box = passBox(await page(new Browser(testEnv(w.db))))
    expect(box).toContain('<li class="crowd">')
    expect(box).toMatch(/<p><b>since then: blocked \(<span title="[^"]+">[a-z]{3} \d+ \d\d:\d\d<\/span>\)<\/b><\/p>/)
    expect(box).toMatch(new RegExp(`<li>passed → <a href="#${b.id}">blocked</a>`))
  })

  it('an author\'s mark on a shwarm that isn\'t passed: "now: on track", not "since then"', async () => {
    const c = await passing() // leading, not passed yet
    await w.run({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: c } })
    const box = passBox(await page(new Browser(testEnv(w.db))))
    expect(box).toContain('<h2>passed</h2>')
    expect(box).toContain('<p><b>now: on track</b></p>')
    expect(box).not.toContain('since then')
  })

  it('a pass that fell back, then an author\'s mark: the box still says what the status is now', async () => {
    await passed()
    const b = await w.post(site(ana), MID, 'corners fail again since the renderer patch.', { claim: 'blocked' })
    for (const p of [kestrel, lumpy]) await w.run({ type: 'back', actor: site(p), input: { node: MID, post: b.id, on: true } })
    tick(24 * HOUR)
    await w.run({ type: 'status', actor: site(myra), input: { node: MID, status: 'on_track' } }) // writes passed → blocked
    tick(HOUR)
    const d = await w.post(site(myra), MID, 'it holds on my machine.', { claim: 'passed' })
    await w.run({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: d.id } })
    const box = passBox(await page(new Browser(testEnv(w.db))))
    expect(box).toContain('<p><b>now: blocked</b></p>')
  })

  it('a branch that passed has its box too, with no mark', async () => {
    await w.join(site(kestrel), BP)
    await w.join(site(lumpy), BP)
    const c = await w.post(site(kestrel), BP, 'all four corners hold.', { claim: 'passed' })
    await w.run({ type: 'back', actor: site(lumpy), input: { node: BP, post: c.id, on: true } })
    tick(25 * HOUR)
    await w.run({ type: 'status', actor: site(kestrel), input: { node: BP, status: 'on_track' } })
    const box = passBox(await page(await member(myra), BP))
    expect(box).toContain(`<a href="#${c.id}">@kestrel's passed claim</a> · backed by 2</div><p class="note pins">no work linked</p>`)
    expect(box).not.toContain('approve it')
  })

  it('from before Oct 14 (migration 0032): the passed submission, or the dead end and its note', async () => {
    const n = w.node(MID)
    const note = await w.post(site(myra), MID, "uzdoom's menus can't nest.")
    w.db.raw.prepare("UPDATE post SET kind = 'dead_end' WHERE id = ?").run(note.id)
    const sub = await w.post(site(kestrel), MID, 'the old passing work.')
    w.db.raw.prepare("UPDATE post SET kind = 'submission' WHERE id = ?").run(sub.id)
    w.db.raw
      .prepare("INSERT INTO submission (post_id, node_id, number, hash, how_to_check, status) VALUES (?, ?, 2, ?, 'run it.', 'passed')")
      .run(sub.id, n.id, 'a1'.repeat(32))
    const ins = w.db.raw.prepare(
      'INSERT INTO pass_record (id, node_id, kind, status, at, submission_id, note_post_id, backers, pins, by_name, person_id) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
    )
    ins.run('r_old1', n.id, 'author', 'passed', '2026-10-09T21:47:00.000Z', sub.id, null, JSON.stringify([{ url: 'https://zenodo.org/x/mid.pk3', sha256: '9c'.repeat(32) }]), '@myra', myra.id)
    ins.run('r_old2', n.id, 'author', 'dead_end', '2026-10-10T08:00:00.000Z', null, note.id, '[]', '@myra', myra.id)
    const box = passBox(await page(new Browser(testEnv(w.db))))
    expect(box).toContain('<h2>dead end</h2>')
    expect(box).toContain(`<li class="author"><div>dead end <span title="2026-10-10 08:00 utc">oct 10 08:00</span> · <a href="#${note.id}">uzdoom's menus can't nest.</a></div></li>`)
    expect(box).toContain(`<li class="author"><div>passed <span title="2026-10-09 21:47 utc">oct 9 21:47</span> · <a href="/w/${MID}/s/2">submission #2</a></div><div class="how pins">`)
  })
})

describe('"approve it" (decided Oct 14 as "mark it passed", worded as approving Oct 15): the author\'s own record', () => {
  it('before any record: the author\'s box in the sidebar, once a passed claim exists; nobody else sees it', async () => {
    const b = await member(myra)
    expect(await page(b)).not.toContain('id="owner"')
    const c = await passing()
    const html = await page(b)
    const box = part(html, '<div class="box owner" id="owner">', '<div class="box people"')
    expect(box).toContain('<h2 class="sunny">your shwarm <span>only you see this box</span></h2>')
    expect(box).toContain('<details class="passmark" open=""><summary>approve it</summary>')
    expect(box).toMatch(new RegExp(`<option value="${c}" selected="">@kestrel's claim · 2 backers · [a-z]{3} \\d+ \\d\\d:\\d\\d · all nine maps from a pistol start, 60 fps on the reference…</option>`))
    expect(box).toContain("your own approval, beside its people's pass. it doesn't change the status or lock anything. confirms with your password.")
    expect(box).toContain('<button class="btn plain" type="submit">approve</button>')
    expect(box).not.toMatch(/mark it passed|mark passed/)
    expect(await page(await member(kestrel))).not.toContain('id="owner"')
  })

  it('in the pass box once there is a record: approving writes "@myra approved", and the form folds', async () => {
    const c = await passed()
    const b = await member(myra)
    let box = passBox(await page(b))
    expect(box).toContain('<div class="in owner"><details class="passmark" open=""><summary>approve it</summary>')
    // signed in just now: the password was entered within 10 minutes, so it isn't asked again
    expect(box).not.toContain('type="password"')
    const r = await b.req(`/w/${MID}`, { form: { form_token: formTokenIn(await page(b)), do: 'mark_passed', post: c } })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(`/w/${MID}#passed`)
    box = passBox(await page(b))
    expect(box).toMatch(new RegExp(`<li class="author"><div><b><a href="/@myra">@myra</a></b> approved · <span title="[^"]+">[a-z]{3} \\d+ \\d\\d:\\d\\d</span> · <a href="#${c}">citing @kestrel's claim</a></div><div class="how pins">`))
    expect(part(box, '<ul class="records">', '</ul>')).not.toContain('says passed')
    expect(box).toContain('<details class="passmark"><summary>approve it</summary>')
  })

  it('a refused mark shows in its form with the pick kept; the password is asked once the window closed', async () => {
    const c = await passed()
    const b = await member(myra)
    const r = await b.req(`/w/${MID}`, { form: { form_token: formTokenIn(await page(b)), do: 'mark_passed', post: 'p_nosuchpost1' } })
    expect(r.status).toBe(400)
    const box = passBox(await body(r))
    expect(box).toContain('<details class="passmark" open="">')
    expect(box).toContain(`<p class="err" role="alert">${NOT_A_PASSED_CLAIM}.</p>`)
    tick(11 * 60_000)
    expect(passBox(await page(b))).toContain('<label class="pw" for="m-pw">password <input id="m-pw" type="password" name="password"')
    await w.run({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: c } })
  })
})

describe('builds on (decided Oct 14: any shwarm, as of its latest pass)', () => {
  it('"builds on minecraft in doom, as passed <date>", the date linking its pass box; plain before any pass', async () => {
    await w.shwarm(site(ana), { title: 'before the pass', buildsOn: MID })
    await passed()
    await w.shwarm(site(ana), { title: 'survival', buildsOn: MID })
    w.db.raw.prepare("UPDATE node SET triage = 'clear'").run()
    const day = new Date(T0 + 24 * HOUR)
    const after = part(await page(new Browser(testEnv(w.db)), 'survival'), '<div class="builds">', '</div>')
    expect(after).toBe(
      `<div class="builds">builds on <a class="up" href="/w/${MID}"><b>minecraft in doom</b>/w/${MID}</a>, as passed <a href="/w/${MID}#passed" title="${day.toISOString().slice(0, 10)} ${day.toISOString().slice(11, 16)} utc">oct ${day.getUTCDate()}</a>`,
    )
    const before = part(await page(new Browser(testEnv(w.db)), 'before-the-pass'), '<div class="builds">', '</div>')
    // no license carries over (decided Oct 15): the line names only what it builds on
    expect(before).toBe(`<div class="builds">builds on <a class="up" href="/w/${MID}"><b>minecraft in doom</b>/w/${MID}</a>`)
  })
})

describe('"✓ author approved" beside the badge (decided Oct 15)', () => {
  const head = (html: string) => part(html, '<div class="state">', '</section>')
  const when = (at: string) => `${['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][new Date(at).getUTCMonth()]} ${new Date(at).getUTCDate()} ${at.slice(11, 16)}`

  it('on the page head and the feed card, apart from the badge, with when and the claim; whatever the status is now', async () => {
    const c = await passed()
    const anon = new Browser(testEnv(w.db))
    expect(await page(anon)).not.toContain('class="approved"') // the people's pass alone shows no mark
    tick(HOUR)
    const mark = await w.run<{ id: string; at: string }>({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: c } })
    const mine = `<a class="approved" href="#passed" title="the author approved on ${when(mark.at)}, citing @kestrel's claim">✓ author approved</a>`
    const h = head(await page(anon))
    // a separate mark after the badge, inside the badges row: the badge itself still says only the people's status
    expect(h).toMatch(new RegExp(`^<div class="state"><div class="badges"><div class="vote-badge"><button type="button" class="st vs passed"[^>]*>passed</button>[\\s\\S]*?</div></div></div>${mine.replace(/[.?*+()[\]\\/]/g, '\\$&')}</div>`))
    // the feed card, once the stats job rolled it up: under the badge, linked to the pass box
    await rollupStats(w.db, w.now)
    forgetVersions()
    const feed = await body(await anon.req('/?tab=passed', { headers: { accept: 'text/html' } }))
    const card = part(feed, `<a class="title" href="/w/${MID}">`, '</li>')
    expect(card).toContain(`<div class="right"><span class="st vs passed">passed</span><a class="approved" href="/w/${MID}#passed" title="the author approved on ${when(mark.at)}, citing @kestrel's claim">✓ author approved</a></div>`)
    // the two are not the same: once the people's status moves on, the mark stays and the badge changes
    const b = await w.post(site(ana), MID, 'corners fail again since the renderer patch.', { claim: 'blocked' })
    for (const p of [kestrel, lumpy, ana]) await w.run({ type: 'back', actor: site(p), input: { node: MID, post: b.id, on: true } })
    tick(25 * HOUR)
    await w.run({ type: 'status', actor: site(myra), input: { node: MID, status: 'on_track' } })
    const later = head(await page(anon))
    expect(later).toContain('class="st vs blocked"')
    expect(later).toContain('>✓ author approved</a>')
    // a branch has no author's approval
    expect(head(await page(anon, BP))).not.toContain('class="approved"')
  })

  it('once the cited claim is gone, the title says only when', async () => {
    const c = await passed()
    const mark = await w.run<{ id: string; at: string }>({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: c } })
    w.db.raw.prepare('UPDATE post SET deleted_at = ? WHERE id = ?').run(new Date(w.now).toISOString(), c)
    forgetVersions()
    expect(head(await page(new Browser(testEnv(w.db))))).toContain(`<a class="approved" href="#passed" title="the author approved on ${when(mark.at)}">✓ author approved</a>`)
  })
})

describe("the author's own approval in the JSON (decided Oct 15)", () => {
  it('author_approved on the Node JSON and the list of shwarms, apart from the status; the passed claim pinned first in posts', async () => {
    const c = await passed()
    const b = new Browser(testEnv(w.db))
    const json = async (path: string) => {
      forgetVersions()
      return (await (await b.req(path, { headers: { accept: 'application/json' } })).json()) as any
    }
    let j = await json(`/w/${MID}`)
    expect(j.author_approved).toBeNull()
    // the site pinned the claim its people passed it on: the first post, pinned
    expect(j.posts[0]).toMatchObject({ id: c, pinned: true, claim: 'passed' })
    tick(HOUR)
    const mark = await w.run<{ id: string; at: string }>({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: c } })
    j = await json(`/w/${MID}`)
    expect(j.author_approved).toEqual({ at: mark.at, claim: { post: c, by: '@kestrel' } })
    expect(schemaErrors('Node', j)).toEqual([])
    expect((await json(`/w/${BP}`)).author_approved).toBeNull()
    // the feed reads it as the stats job rolled it up
    await rollupStats(w.db, w.now)
    const list = await json('/shwarms?tab=passed&format=json')
    expect(list.shwarms.find((x: any) => x.path === MID).author_approved).toEqual({ at: mark.at, claim: { post: c, by: '@kestrel' } })
    expect(schemaErrors('ShwarmList', list)).toEqual([])
  })
})
