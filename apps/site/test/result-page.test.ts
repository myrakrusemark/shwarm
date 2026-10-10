// Go-live 5.7: a closed shwarm's result page at /w/<path>. The pass at the hash its checks ran, with its links and release
// fields; the proof with evidence; who made it, ranked by counted upvotes with agents rolled up and only derived role tags;
// the shwarms challenging it and the rest built on it; the key events; its thread at ?thread=1, locked; a passed branch's
// proof box; a node reopened before Oct 9 back on the live template with the pass on record; and an ETag that moves with
// the tree. A passed shwarm stays passed (decided Oct 9): nothing on it offers a repro.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { refused, site, stepped } from './core-fixtures'
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

async function world(o?: Parameters<typeof closedWorld>[0]) {
  const w = await closedWorld(o)
  const b = new Browser(testEnv(w.db))
  const get = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).get(...args) as any
  const page = async (path = ROOT) => body(await b.req(path, { headers: HTML }))
  return { ...w, b, get, page }
}

/** Block placement passes on #2 (@myra's agent), with @bmo_fan's sign-off, before the shwarm does: after, it's locked with it (OPEN #92). */
const branchPasses: NonNullable<Parameters<typeof closedWorld>[0]>['before'] = async ({ run, p, db }) => {
  const sub2 = (db.raw.prepare('SELECT s.post_id FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.number = 2').get(EXAMPLE_BRANCH) as { post_id: string }).post_id
  await run({ type: 'check', actor: stepped(p('bmo_fan')), input: { node: EXAMPLE_BRANCH, on: sub2, slot: 'author', verdict: 'pass', text: 'every corner holds.' } })
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
    expect(html).toContain('<div class="meta">started by <a href="/@myra">@myra</a> · 3 days, start to finish · builds on <a class="up" href="https://github.com/UZDoom/UZDoom" rel="nofollow ugc noopener noreferrer">uzdoom</a></div>')
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
    // a two-digit rank stays on one line: the rank cell doesn't take the table's break-anywhere
    expect(readFileSync(new URL('../static/css/result.css', import.meta.url), 'utf8')).toMatch(/table\.credit td\.rk \{[^}]*white-space: nowrap; overflow-wrap: normal;/)
  })

  it("names a passed branch's submitter, and shows a decisive tag below the cut", async () => {
    const w = await world({ before: branchPasses })
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

  it("lists what's next, and the shwarms challenging it or built on it, once they're public", async () => {
    const w = await world()
    let html = await w.page()
    expect(html).toContain(`<div class="box next"><h2 class="sunny">what's next</h2><div class="in"><a class="btn" href="/new?builds_on=minecraft-in-doom">build on this</a><p class="note">building on it starts a new shwarm that uses this result. think it doesn't really pass? build on it with the same done test.</p></div></div>`)
    expect(html).not.toContain('repro')
    expect(html).not.toContain('built on this <span>')
    expect(html).not.toContain('challenged by <span>')
    const doneWhen = w.get('SELECT done_when FROM node WHERE path = ?', EXAMPLE_ROOT).done_when
    const start = (who: string, title: string, done: string) =>
      w.run({
        type: 'createNode',
        actor: site(w.p(who)),
        input: { kind: 'shwarm', title, what: `${title}.`, doneWhen: done, check: { author: true }, tags: ['games'], buildsOn: EXAMPLE_ROOT },
      })
    await start('gunter', 'doom block-building speedruns', 'a leaderboard with 10 verified runs')
    await start('finn_irl', 'does it really hold 60 fps', doneWhen) // the same done test, word for word: a challenge
    forgetVersions()
    expect(await w.page()).not.toContain('built on this <span>') // still being checked
    w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path IN ('doom-block-building-speedruns', 'does-it-really-hold-60-fps')").run()
    forgetVersions()
    html = await w.page()
    expect(html).toContain('<h2>challenged by <span>1</span></h2><ul class="tree"><li><a href="/w/does-it-really-hold-60-fps">does it really hold 60 fps</a><span class="st live">live</span></li></ul>')
    expect(html).toContain('<h2>built on this <span>1</span></h2><ul class="tree"><li><a href="/w/doom-block-building-speedruns">doom block-building speedruns</a><span class="st live">live</span></li></ul>')
    expect(html.indexOf('challenged by')).toBeLessThan(html.indexOf('built on this <span>'))
  })

  it('shows the newest key events oldest first, each linked to its evidence, with the full log in JSON', async () => {
    const { page } = await world()
    const html = await page()
    const log = /<table class="log">([\s\S]*?)<\/table>/.exec(html)![1]
    const rows = [...log.matchAll(/<tr><td class="when">([^<]+)<\/td><td><span class="([^"]+)">([^<]+)<\/span><\/td><td class="node">([^<]+)<\/td><td class="by">(.*?)<\/td><td><a href="([^"]+)">/g)].map(m => [m[1], m[2], m[3], m[4], m[5].replace(/<[^>]+>/g, ''), m[6]])
    expect(rows).toEqual([
      ['oct 5 11:59', 'ev', 'seeded', 'minecraft in doom', '@myra', '/w/minecraft-in-doom'],
      ['oct 6 11:59', 'ev', 'branch opened', 'block placement', '@bmo_fan', '/w/minecraft-in-doom/block-placement'],
      ['oct 7 05:59', 'ev', 'submission', 'block placement', '@myra/m-04', '/w/minecraft-in-doom/block-placement/s/1'],
      ['oct 8 11:47', 'ev', 'submission', 'block placement', '@myra/m-07', '/w/minecraft-in-doom/block-placement/s/2'],
      ['oct 8 12:01', 'ev', 'submission', 'minecraft in doom', '@kestrel/swarm/r-40', '/w/minecraft-in-doom/s/1'],
      ['oct 8 12:04', 'ev ok', 'passed', 'minecraft in doom', 'submission #1', '/w/minecraft-in-doom/s/1'],
    ])
    expect(html).toContain('<span class="note">showing 6 of 14 events · filter: <b>key events</b> · <a href="/w/minecraft-in-doom/log?filter=all">all</a></span><a href="/w/minecraft-in-doom/log?filter=all">full log (json) →</a>')
    expect(html).toContain('<a href="/w/minecraft-in-doom?thread=1">read the whole thread (8 posts) →</a> · it\'s locked.')
  })

  it('keeps its thread at ?thread=1, locked: no compose box, and a forged post is refused there', async () => {
    const w = await world()
    const html = await w.page(`${ROOT}?thread=1`)
    expect(html).not.toContain('class="done-head"')
    expect(html).toContain('<a class="back" href="/w/minecraft-in-doom">← back to the result</a>')
    expect(html).toContain('<a href="?thread=1&sort=new">new</a>')
    expect(html).toContain('<div class="compose locked"><div class="to">locked</div><p>this shwarm passed, so it takes nothing new. to carry it on, <a href="/new?builds_on=minecraft-in-doom">build on it</a>.</p></div>')
    expect(html).toContain('<div class="alt"><a href="/new?builds_on=minecraft-in-doom">build on this</a></div>')
    expect(html).not.toContain('repro</a>')
    // a forged post comes back on the thread with the refusal, not on the result page
    const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
    w.db.raw.prepare("UPDATE person SET password_hash = ?, email = 'gunter@example.org', email_norm = 'gunter@example.org' WHERE handle = 'gunter'").run(hash)
    const g = new Browser(w.b.env)
    expect((await g.post('/signin', { email: 'gunter@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    const token = formTokenIn(await (await g.req(`${ROOT}?thread=1`, { headers: HTML })).text())
    const posts = w.get('SELECT COUNT(*) AS n FROM post').n
    const res = await g.req(ROOT, { form: { form_token: token, do: 'post', text: 'speedrun branch idea: build a bunker in under a minute.' } })
    expect(res.status).toBe(400)
    const again = await body(res)
    expect(again).toContain(`<p class="err flash" role="alert">${EXAMPLE_ROOT} passed. it's locked: it takes nothing new.</p>`)
    expect(again).toContain('← back to the result')
    expect(w.get('SELECT COUNT(*) AS n FROM post').n).toBe(posts)
  })

  it('tells agents it is locked and how to carry it on or challenge it, with no repro', async () => {
    const w = await world()
    const text = await (await w.b.req(`${ROOT}?format=text`)).text()
    expect(text).toContain("closed: it passed. it's locked: it takes nothing new.\nto carry it on, or to challenge the pass, start a shwarm with builds_on set to this path.\n")
    expect(text).not.toContain('repro posted here')
  })

  it('locks a branch still live under it: no compose box, sub-branch, check or reply forms, and a forged post is refused (OPEN #92)', async () => {
    const w = await world()
    const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
    w.db.raw.prepare("UPDATE person SET password_hash = ?, email = 'gunter@example.org', email_norm = 'gunter@example.org' WHERE handle = 'gunter'").run(hash)
    const g = new Browser(w.b.env)
    expect((await g.post('/signin', { email: 'gunter@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    const BRANCH = `/w/${EXAMPLE_BRANCH}`
    const html = await body(await g.req(BRANCH, { headers: HTML }))
    expect(w.get('SELECT state FROM node WHERE path = ?', EXAMPLE_BRANCH).state).toBe('live')
    expect(html).toContain(
      '<div class="compose locked"><div class="to">locked</div><p><a href="/w/minecraft-in-doom">minecraft in doom</a> passed, so this branch takes nothing new either. to carry it on, <a href="/new?builds_on=minecraft-in-doom">build on it</a>.</p></div>',
    )
    expect(html).not.toContain('<form class="compose"')
    expect(html).not.toContain('start a sub-branch')
    expect(html).not.toContain('make it a branch')
    expect(html).not.toContain('waiting on')
    // its submission in review takes no checks
    const sub = w.get("SELECT s.number FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.status = 'in_review'", EXAMPLE_BRANCH).number
    const subPage = await body(await g.req(`${BRANCH}/s/${sub}`, { headers: HTML }))
    expect(subPage).not.toContain('name="verdict"')
    expect(subPage).not.toContain('waiting on')
    // the branch form under it is refused before anything is typed
    expect(await body(await g.req(`/new?parent=${EXAMPLE_BRANCH}`, { headers: HTML }))).toContain(`${EXAMPLE_ROOT} passed. it's locked: it takes nothing new.`)
    // agents are told
    const text = await (await w.b.req(`${BRANCH}?format=text`)).text()
    expect(text).toContain(`locked: ${EXAMPLE_ROOT} passed, so this takes nothing new either.\nto carry it on, start a shwarm with builds_on set to ${EXAMPLE_ROOT}.\n`)
    // a forged post comes back with the refusal at the top
    const token = formTokenIn(html)
    const posts = w.get('SELECT COUNT(*) AS n FROM post').n
    const res = await g.req(BRANCH, { form: { form_token: token, do: 'post', text: 'one more corner case.' } })
    expect(res.status).toBe(400)
    expect(await body(res)).toContain(`<p class="err flash" role="alert">${EXAMPLE_ROOT} passed. it's locked: it takes nothing new.</p>`)
    expect(w.get('SELECT COUNT(*) AS n FROM post').n).toBe(posts)
  })

  it("a passed branch keeps the live template, with the closed pill and its proof", async () => {
    const w = await world({ before: branchPasses })
    const html = await w.page(`/w/${EXAMPLE_BRANCH}`)
    expect(html).not.toContain('class="done-head"')
    expect(html).toContain('<link rel="stylesheet" href="/css/result.css"/>')
    expect(html).toContain('<span class="st done">closed</span>')
    expect(html).toContain("<h2>proof it's done <span>submission #2 · 4 of 4 checks</span></h2>")
    expect(html).toContain('<h4><span>runs</span><span class="note">2 of 2</span></h4>')
    expect(html).toContain('<h4><span>author</span><span class="note">signed off oct 8</span></h4>')
    expect(html.indexOf('class="box proof"')).toBeLessThan(html.indexOf('class="compose locked"'))
    // a branch isn't built on: its locked box says only that it's locked
    expect(html).toContain('<p>this branch passed, so it takes nothing new.</p>')
  })

  it('a repro reopens nothing; a shwarm reopened before Oct 9 shows the live template, its pass on record', async () => {
    const w = await world()
    await refused(
      w.run({ type: 'check', actor: site(w.p('finn_irl')), input: { node: EXAMPLE_ROOT, on: w.sub.id, verdict: 'fail', repro: 'dig below y=-120: blocks place on the wrong face.' } }),
      'shwarm_closed',
    )
    expect(w.get('SELECT state FROM node WHERE path = ?', EXAMPLE_ROOT).state).toBe('closed')
    // as a repro left it before nothing reopened (decided Oct 9)
    w.db.raw.prepare("UPDATE node SET state = 'live', closed_at = NULL WHERE path = ?").run(EXAMPLE_ROOT)
    forgetVersions()
    const html = await w.page()
    expect(html).not.toContain('class="done-head"')
    expect(html).toContain('<a class="back" href="/">← back to hot</a>')
    expect(html).toMatch(/<span class="sb">submission #1<\/span>/)
    expect(html).not.toContain('class="box proof"')
    // the submission page keeps the pass, reopened by the repro, and takes no checks on it
    const sub = await w.page(`${ROOT}/s/1`)
    expect(sub).toContain('<span class="stp no" id="status">reopened</span>')
    expect(sub).not.toContain('id="check"')
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
    // the tree is locked once the shwarm passed (OPEN #92), but an upvote on a branch's post still counts
    const post = w.get("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.as_name NOT LIKE '@lumpy%' AND p.deleted_at IS NULL LIMIT 1", EXAMPLE_BRANCH).id
    await w.run({ type: 'upvote', actor: site(w.p('lumpy')), input: { node: EXAMPLE_BRANCH, post } })
    expect(w.get('SELECT last_event_id FROM node WHERE path = ?', EXAMPLE_ROOT).last_event_id).toBe(before)
    forgetVersions()
    const again = await w.b.req(ROOT, { headers: { ...HTML, 'if-none-match': etag } })
    expect(again.status).toBe(200)
    expect(again.headers.get('etag')).not.toBe(etag)
  })
})
