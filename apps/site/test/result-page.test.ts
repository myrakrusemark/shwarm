// Go-live 5.7: a closed shwarm's result page at /w/<path>. The pass at the hash its checks ran, with its links and release
// fields; the proof with evidence; who made it, ranked by counted upvotes with agents rolled up and only derived role tags;
// what's built on it; the milestones; its thread at ?thread=1; a passed branch's proof box; a reopened node back on the
// live template with the pass on record; and an ETag that moves with the tree.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { agent, site, stepped } from './core-fixtures'
import { T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { closedWorld, PK3, RECORDING, SOURCE } from './result-fixture'

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
const ROOT = `/w/${EXAMPLE_ROOT}`

async function world() {
  const w = await closedWorld()
  const b = new Browser(testEnv(w.db))
  const get = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).get(...args) as any
  const page = async (path = ROOT) => body(await b.req(path, { headers: HTML }))
  return { ...w, b, get, page }
}

/** The "who made it" rows: handle, role tags (a * marks a decisive one), upvotes, posts. */
function credits(html: string) {
  const table = /<table class="credit">([\s\S]*?)<\/table>/.exec(html)![1]
  return [...table.matchAll(/<tr><td class="rk">(\d*)<\/td><td>(.*?)<\/td><td class="n">([\d,]+) ▲<\/td><td class="n"><span class="imp"[^>]*>([\d,]+)<\/span><\/td><\/tr>/g)].map(m => ({
    rank: m[1],
    who: /^<a href="\/@\w+">(@\w+)<\/a>/.exec(m[2])?.[1] ?? m[2].replace(/<br\/>$/, ''),
    roles: [...m[2].matchAll(/<span class="role( key)?">([^<]+)<\/span>/g)].map(r => (r[1] ? '*' : '') + r[2]),
    upvotes: Number(m[3].replace(/,/g, '')),
    posts: Number(m[4].replace(/,/g, '')),
  }))
}

describe('the result page (5.7)', () => {
  it('leads with the pass: done head, the result at its checked hash with links and release fields, the leave-shwarm note', async () => {
    const { page, get, sub } = await world()
    const html = await page()
    const n = get('SELECT license, builds_on, closed_at FROM node WHERE path = ?', EXAMPLE_ROOT)
    expect(n.closed_at).not.toBeNull()
    expect(html).toContain('<title>minecraft in doom · done · shwarm</title>')
    expect(html).toContain('<a class="back" href="/?tab=closed">← back to closed</a>')
    expect(html).toContain('<span class="donebadge">✓ done · oct 8</span><h1>minecraft in doom</h1>')
    expect(html).toContain('<div class="meta">started by <a href="/@myra">@myra</a> · lobby filled oct 5 (2/2) · 2 days, start to finish · builds on <a class="up" href="https://github.com/UZDoom/UZDoom" rel="nofollow ugc noopener noreferrer">uzdoom</a></div>')
    expect(html).toContain('<div class="passed"><b>done when · passed</b><div class="txt"><p>a downloadable uzdoom mod')
    expect(html).toContain('<div><span class="st done">closed</span></div>')
    // the result box: the submission's release name, its text, who, the hash the checks ran against, each link's pin
    expect(html).toContain('<h2 class="sunny">the result <span>submission #1, the version that passed</span></h2>')
    expect(html).toContain('<h3>minecraft in doom v1.0</h3>')
    expect(html).toContain('<div class="src">from <a href="/w/minecraft-in-doom/s/1">submission #1</a>, by <a href="/@kestrel?as=%40kestrel/swarm/r-40">@kestrel/swarm/r-40</a></div>')
    expect(html).toContain(`<dt>version</dt><dd>v1.0 · <code title="sha256 ${sub.hash}">${sub.hash.slice(0, 7)}</code> · the exact build the checks ran</dd>`)
    expect(html).toContain(`<dt>fingerprint</dt><dd>sha256 <code title="${PK3.sha256}">9c4e07b2…a71f</code> · of mcdoom-v1.pk3<br/>commit <code title="${SOURCE.commit}">e9b41d0</code> · of kestrel/mcdoom</dd>`)
    expect(html).toContain(`<dt>license</dt><dd>${n.license}, from uzdoom</dd>`)
    expect(html).toContain('<dt>how to use</dt><dd><div class="txt"><p>uzdoom -iwad freedoom2.wad -file mcdoom-v1.pk3</p></div></dd>')
    expect(html).not.toContain('kept safe') // no archive links until they have a mechanism (#64)
    expect(html).toContain(
      `<div class="dl"><a class="btn" href="${PK3.url}" rel="nofollow ugc noopener noreferrer">mcdoom-v1.pk3 on zenodo.org ↗</a><a class="btn plain" href="${SOURCE.repo}" rel="nofollow ugc noopener noreferrer">kestrel/mcdoom on codeberg.org ↗</a></div>`,
    )
    expect(html).toContain('<p class="note">these links leave shwarm. shwarm keeps the text and the links; the files live where the crew put them.</p>')
  })

  it('proves it: the standing checks grouped runs, people, author, each with its evidence and the sign-off note', async () => {
    const { page } = await world()
    const html = await page()
    expect(html).toContain("<h2>proof it's done <span>submission #1 · 3 of 3 checks</span></h2>")
    expect(html).toContain('<h4><span>runs</span><span class="note">1 of 1</span></h4>')
    expect(html).toMatch(/<a href="\/@lumpy">@lumpy<\/a> · run · <code class="cmd">[^<]+<\/code> exit 0 on #1 \([0-9a-f]{7}\) · linux, rtx 3060 · <a href="\/w\/minecraft-in-doom\/s\/1#c_\w+">signed log<\/a>/)
    expect(html).toContain('<h4><span>people</span><span class="note">1 of 1 · one human</span></h4>')
    expect(html).toContain(`<a href="/@marceline">@marceline</a> · person · played 10 minutes, dug to y=-80, built a bunker under fire. · <a href="${RECORDING.url}"`)
    expect(html).toContain('<h4><span>author</span><span class="note">signed off oct 8</span></h4>')
    expect(html).toContain("<a href=\"/@myra\">@myra</a> · author · played it for an hour with my kid. it's what we wanted.")
  })

  it('credits people ranked by counted upvotes, agents rolled up, with only role tags from recorded events', async () => {
    const { page, get } = await world()
    const rows = credits(await page())
    // @kestrel's row holds the upvotes on their agent's submission; ties go to more posts
    const expected = get(
      `SELECT '@' || p.handle AS who, SUM(x.upvotes) AS upvotes, SUM(x.posts) AS posts FROM person_node_stats x JOIN node t ON t.id = x.node_id JOIN person p ON p.id = x.person_id
       WHERE t.path IN (?, ?) AND x.posts > 0 GROUP BY x.person_id HAVING who = '@kestrel'`,
      EXAMPLE_ROOT,
      EXAMPLE_BRANCH,
    )
    expect(rows[0]).toEqual({ rank: '1', who: '@kestrel', roles: ['*submitted the passing work'], upvotes: 3, posts: expected.posts })
    expect(rows[1]).toMatchObject({ rank: '2', who: '@finn_irl', roles: ['*built on'], upvotes: 2 })
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].upvotes >= rows[i].upvotes, `${rows[i - 1].who} before ${rows[i].who}`).toBe(true)
    const roles = Object.fromEntries(rows.map(r => [r.who, r.roles]))
    expect(roles).toMatchObject({ '@myra': ['*author'], '@lumpy': ['ran a check'], '@marceline': ['ran a check'], '@gunter': [], '@bmo_fan': [] })
    // every tag comes from the fixed set: no free text
    const allowed = new Set(['*submitted the passing work', '*built on', '*author', 'ran a check'])
    for (const r of rows) for (const t of r.roles) expect(allowed.has(t), t).toBe(true)
    // agents are never rows of their own
    expect(rows.some(r => r.who.includes('/'))).toBe(false)
    const html = await page()
    expect(html).toContain('<h2>who made it <span>ranked by impact</span></h2>')
    expect(html).toContain('one row per person, their agents included. ranked by upvotes on their posts across the shwarm and its branches. yellow tags mark the decisive work.')
  })

  it("names a passed branch's submitter, and shows a decisive tag below the cut", async () => {
    const w = await world()
    // block placement passes on #2 (@myra's agent), with @bmo_fan's sign-off
    const sub2 = w.get("SELECT s.post_id FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.number = 2", EXAMPLE_BRANCH).post_id
    await w.run({ type: 'check', actor: stepped(w.p('bmo_fan')), input: { node: EXAMPLE_BRANCH, on: sub2, slot: 'author', verdict: 'pass', text: 'every corner holds.' } })
    forgetVersions()
    let rows = credits(await w.page())
    expect(rows.find(r => r.who === '@myra')!.roles).toEqual(['*author', 'block placement passed'])
    // nine busier people push everyone else below the first eight: the decisive tags still show, the rest fold into "+ N more"
    const node = w.get('SELECT id FROM node WHERE path = ?', EXAMPLE_ROOT).id
    for (let i = 1; i <= 9; i++) {
      const id = Number(w.db.raw.prepare(`INSERT INTO person (handle, email, email_norm, password_hash, terms_version, terms_accepted_at, age_confirmed_at, created_at)
        VALUES (?, ?, ?, 'x', '0.1', ?, ?, ?)`).run(`busy_${i}`, `busy${i}@example.org`, `busy${i}@example.org`, '2026-10-01', '2026-10-01', '2026-10-01').lastInsertRowid)
      w.db.raw.prepare('INSERT INTO person_node_stats (person_id, node_id, posts, upvotes, updated_at) VALUES (?, ?, 10, ?, ?)').run(id, node, 50 + i, '2026-10-08')
    }
    forgetVersions()
    rows = credits(await w.page())
    expect(rows.slice(0, 8).map(r => r.who)).toEqual(['@busy_9', '@busy_8', '@busy_7', '@busy_6', '@busy_5', '@busy_4', '@busy_3', '@busy_2'])
    expect(rows.slice(8).map(r => [r.rank, r.who])).toEqual([['10', '@kestrel'], ['11', '@finn_irl'], ['13', '@myra'], ['', '+ 5 more']])
    const more = rows[rows.length - 1]
    const shown = rows.slice(0, -1).reduce((a, r) => a + r.upvotes, 0)
    const all = w.get(`SELECT SUM(x.upvotes) AS u FROM person_node_stats x JOIN node t ON t.id = x.node_id WHERE t.path IN (?, ?) AND x.posts > 0`, EXAMPLE_ROOT, EXAMPLE_BRANCH).u
    expect(more.upvotes).toBe(all - shown)
  })

  it("lists what's next and the shwarms built on it, once they're public", async () => {
    const w = await world()
    let html = await w.page()
    expect(html).toContain(`<div class="box next"><h2 class="sunny">what's next</h2><div class="in"><a class="btn" href="/new?builds_on=minecraft-in-doom">build on this</a><a class="btn plain" href="/w/minecraft-in-doom/s/1#check">it's broken? post a repro</a><p class="note">building on it starts a new shwarm that uses this result. a repro that holds up reopens this one.</p></div></div>`)
    expect(html).not.toContain('built on this <span>')
    await w.run({
      type: 'createNode',
      actor: site(w.p('gunter')),
      input: { kind: 'shwarm', title: 'doom block-building speedruns', what: 'race to build a bunker.', doneWhen: 'a leaderboard with 10 verified runs', check: { author: true }, tags: ['games'], buildsOn: EXAMPLE_ROOT },
    })
    forgetVersions()
    expect(await w.page()).not.toContain('built on this <span>') // still being checked
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = 'doom-block-building-speedruns'").run()
    forgetVersions()
    html = await w.page()
    expect(html).toContain('<h2>built on this <span>1</span></h2><ul class="tree"><li><a href="/w/doom-block-building-speedruns">doom block-building speedruns</a><span class="st">1/10</span></li></ul>')
  })

  it('shows the newest milestones oldest first, each linked to its evidence, with the full log in JSON', async () => {
    const { page } = await world()
    const html = await page()
    const log = /<table class="log">([\s\S]*?)<\/table>/.exec(html)![1]
    const rows = [...log.matchAll(/<tr><td class="when">([^<]+)<\/td><td><span class="([^"]+)">([^<]+)<\/span><\/td><td>([^<]+)<\/td><td>(.*?)<\/td><td><a href="([^"]+)">/g)].map(m => [m[1], m[2], m[3], m[4], m[5].replace(/<[^>]+>/g, ''), m[6]])
    expect(rows).toEqual([
      ['oct 5 11:59', 'ev', 'seeded', 'minecraft in doom', '@myra', '/w/minecraft-in-doom'],
      ['oct 5 13:59', 'ev', 'lobby filled', 'minecraft in doom', '@bmo_fan', '/w/minecraft-in-doom'],
      ['oct 6 11:59', 'ev', 'branch opened', 'block placement', '@bmo_fan', '/w/minecraft-in-doom/block-placement'],
      expect.arrayContaining(['oct 8 12:04', 'ev ok', 'signed off', 'minecraft in doom', '@myra']),
      ['oct 8 12:04', 'ev ok', 'passed', 'minecraft in doom', 'submission #1', '/w/minecraft-in-doom/s/1'],
    ])
    expect(html).toContain('<span class="note">showing 5 of 15 events · filter: <b>milestones</b> · <a href="/w/minecraft-in-doom/log?filter=all">all</a></span><a href="/w/minecraft-in-doom/log?filter=all">full log (json) →</a>')
    expect(html).toContain('<a href="/w/minecraft-in-doom?thread=1">read the whole thread (8 posts) →</a> · it stays open for repros and pointers to follow-on work.')
  })

  it('keeps its thread at ?thread=1, where posts land and links stay', async () => {
    const w = await world()
    const html = await w.page(`${ROOT}?thread=1`)
    expect(html).not.toContain('class="done-head"')
    expect(html).toContain('<a class="back" href="/w/minecraft-in-doom">← back to the result</a>')
    expect(html).toContain('<a href="?thread=1&sort=new">new</a>')
    // a post from the thread view goes back to it, not to the result page
    const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
    w.db.raw.prepare("UPDATE person SET password_hash = ?, email = 'gunter@example.org', email_norm = 'gunter@example.org' WHERE handle = 'gunter'").run(hash)
    const g = new Browser(w.b.env)
    expect((await g.post('/signin', { email: 'gunter@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    const token = formTokenIn(await (await g.req(`${ROOT}?thread=1`, { headers: HTML })).text())
    const res = await g.req(ROOT, { form: { form_token: token, do: 'post', text: 'speedrun branch idea: build a bunker in under a minute.' } })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/^\/w\/minecraft-in-doom\?thread=1#p_\w+$/)
    // a refused post comes back on the thread with its draft, not on the result page
    const refused = await g.req(ROOT, { form: { form_token: token, do: 'post', text: '   ' } })
    expect(refused.status).toBe(400)
    const again = await body(refused)
    expect(again).toContain('write something first.')
    expect(again).toContain('← back to the result')
  })

  it("a passed branch keeps the live template, with the closed pill and its proof", async () => {
    const w = await world()
    const sub2 = w.get("SELECT s.post_id FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.number = 2", EXAMPLE_BRANCH).post_id
    await w.run({ type: 'check', actor: stepped(w.p('bmo_fan')), input: { node: EXAMPLE_BRANCH, on: sub2, slot: 'author', verdict: 'pass', text: 'every corner holds.' } })
    const html = await w.page(`/w/${EXAMPLE_BRANCH}`)
    expect(html).not.toContain('class="done-head"')
    expect(html).toContain('<link rel="stylesheet" href="/css/result.css"/>')
    expect(html).toContain('<span class="st done">closed</span>')
    expect(html).toContain("<h2>proof it's done <span>submission #2 · 4 of 4 checks</span></h2>")
    expect(html).toContain('<h4><span>runs</span><span class="note">2 of 2</span></h4>')
    expect(html).toContain('<h4><span>author</span><span class="note">signed off oct 8</span></h4>')
    expect(html.indexOf('class="box proof"')).toBeLessThan(html.indexOf('class="compose"'))
  })

  it('a reopened shwarm goes back to the live template, its pass on record', async () => {
    const w = await world()
    await w.run({ type: 'check', actor: site(w.p('finn_irl')), input: { node: EXAMPLE_ROOT, on: w.sub.id, verdict: 'fail', repro: 'dig below y=-120: blocks place on the wrong face.' } })
    expect(w.get('SELECT state FROM node WHERE path = ?', EXAMPLE_ROOT).state).toBe('live')
    forgetVersions()
    const html = await w.page()
    expect(html).not.toContain('class="done-head"')
    expect(html).toContain('<a class="back" href="/">← back to hot</a>')
    expect(html).toMatch(/<span class="sb">submission #1<\/span>/)
    expect(html).not.toContain('class="box proof"')
    // the submission page keeps the pass, reopened by the repro
    expect(await w.page(`${ROOT}/s/1`)).toContain('<span class="stp no" id="status">reopened</span>')
  })

  it('falls back to the live template when the passing submission is taken down', async () => {
    const w = await world()
    w.db.raw.prepare('UPDATE post SET hidden = 1 WHERE id = ?').run(w.sub.id)
    const html = await w.page()
    expect(html).not.toContain('class="done-head"')
    expect(html).toContain('<span class="st done">closed</span>')
  })

  it("a signed-out ETag moves when a branch changes, though the shwarm itself didn't", async () => {
    const w = await world()
    const first = await w.b.req(ROOT, { headers: HTML })
    const etag = first.headers.get('etag')!
    expect(etag).toMatch(/\.html\..+"$/)
    expect((await w.b.req(ROOT, { headers: { ...HTML, 'if-none-match': etag } })).status).toBe(304)
    const before = w.get('SELECT last_event_id FROM node WHERE path = ?', EXAMPLE_ROOT).last_event_id
    await w.run({ type: 'post', actor: agent(w.p('kestrel'), 'swarm/r-03'), input: { node: EXAMPLE_BRANCH, text: 'imps still clip one corner.' } })
    expect(w.get('SELECT last_event_id FROM node WHERE path = ?', EXAMPLE_ROOT).last_event_id).toBe(before)
    forgetVersions()
    const again = await w.b.req(ROOT, { headers: { ...HTML, 'if-none-match': etag } })
    expect(again.status).toBe(200)
    expect(again.headers.get('etag')).not.toBe(etag)
  })
})
