// Go-live 3.5: the public profile and the name view, on a staging-like database (the 100 launch shwarms and the
// running example from the seed plan), with the stats job run so the figures are real.
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { postsPerDay, WEEK_MS } from '../src/core/stats'
import { rollupStats } from '../src/jobs/stats'
import { oneDecimal } from '../src/read/figures'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { planSeed, type TargetState } from '../src/seed/plan'
import { ago } from '../src/render/ago'
import { lookUpName, readingOpen, SHOWN } from '../src/web/profile'
import { body, Browser, fakeFetch, GOOD_PASSWORD, pepper, testEnv, type TestEnv } from './browser'
import { addPerson, T0, testDb } from './d1'

const LIST: any[] = JSON.parse(readFileSync(new URL('../../../docs/launch-shwarms.json', import.meta.url), 'utf8'))
const NOW = T0
const iso = (ms: number) => new Date(ms).toISOString()
/** The page with each <time> tag reduced to its text (the exact time sits in its title, 3.8). */
const untime = (html: string) => html.replace(/<time datetime="[^"]+" title="[^"]+ utc">([^<]*)<\/time>/g, '$1')

type DB = ReturnType<typeof testDb>
const all = (db: DB, sql: string, ...a: unknown[]) => db.raw.prepare(sql).all(...a).map((r: any) => ({ ...r }))
const one = (db: DB, sql: string, ...a: unknown[]) => {
  const r = db.raw.prepare(sql).get(...a)
  return r && { ...r }
}

/** Staging as it is after go-live 3.1: @myra (not id 1), the 100 seeded lobbies and the running example. */
let template: string
async function buildStaging(): Promise<string> {
  const db = testDb()
  await addPerson(db, 'early_one')
  await addPerson(db, 'early_two')
  const id = await addPerson(db, 'myra')
  db.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(iso(T0 - 21 * 86_400_000), id)
  const state: TargetState = {
    myra: one(db, "SELECT id, handle, status, email_verified_at, founding, established_at FROM person WHERE handle = 'myra'"),
    nodes: [],
    handles: [],
    settings: all(db, 'SELECT key, value FROM setting'),
  }
  const plan = await planSeed(testDb(), LIST, state, { target: 'staging', now: NOW, example: true })
  expect(plan.report.failures).toBe(0)
  return plan.sql
}

/** A fresh copy of staging. `clear` stands in for Myra clearing the example's branch in triage (it's 'pending'). */
async function staging(o: { clear?: boolean; upvotes?: boolean } = {}): Promise<{ env: TestEnv; db: DB; myra: number }> {
  const db = testDb()
  await addPerson(db, 'early_one')
  await addPerson(db, 'early_two')
  const myra = await addPerson(db, 'myra')
  db.raw.prepare("UPDATE person SET email_verified_at = ?, founding = 1, created_at = ?, display_name = 'myra', about = ? WHERE id = ?").run(
    iso(T0 - 21 * 86_400_000),
    iso(T0 - 21 * 86_400_000),
    'product designer who also ships the things i make. mostly here for games and tools.',
    myra,
  )
  db.raw.exec(template)
  if (o.clear !== false) db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(EXAMPLE_BRANCH)
  if (o.upvotes !== false) {
    // Counted upvotes from the demo people (founding, so established) on posts by @myra and her agents.
    const posts = all(db, "SELECT p.id FROM post p JOIN person h ON h.id = p.person_id WHERE h.handle = 'myra' AND p.kind IN ('post', 'submission') ORDER BY p.created_at")
    const voters = all(db, "SELECT id FROM person WHERE handle IN ('finn_irl', 'kestrel', 'gunter', 'lumpy')")
    let k = 0
    for (const [i, p] of posts.entries())
      for (const v of voters.slice(0, (i % voters.length) + 1))
        db.raw.prepare('INSERT INTO upvote (post_id, person_id, counted, created_at) VALUES (?, ?, 1, ?)').run(p.id, v.id, iso(NOW - 60_000 * ++k))
    // and one on someone else's post, so the site average isn't @myra's alone
    const finnPost = one(db, "SELECT p.id FROM post p JOIN person h ON h.id = p.person_id WHERE h.handle = 'finn_irl' LIMIT 1")
    db.raw.prepare('INSERT INTO upvote (post_id, person_id, counted, created_at) VALUES (?, ?, 1, ?)').run(finnPost.id, voters[1].id, iso(NOW - 30_000))
  }
  await rollupStats(db, NOW)
  return { env: testEnv(db), db, myra }
}

const get = (env: TestEnv, path: string) => new Browser(env).get(path)

/** The impact mark in a working-on row for this node title: [q, shown posts per day, tooltip]. */
function rowMark(html: string, title: string): { title: string; text: string; q: string } | null {
  const row = html.split('<tr>').find(r => r.includes(`>${title}</a>`))
  const m = row && /<span class="imp" style="--q:([\d.]+)" title="([^"]+)">([^<]+)<\/span>/.exec(row)
  return m ? { q: m[1], title: m[2], text: m[3] } : null
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  template = await buildStaging()
  vi.useRealTimers()
}, 60_000)
beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('/@myra', () => {
  it('renders the head, the three figures, working on and created, as in the mockup', async () => {
    const { env } = await staging()
    const res = await get(env, '/@myra?all=1') // the example's rows sit below the 100 seeded ones (their pinned posts are newer)
    expect(res.status).toBe(200)
    const html = await body(res)
    expect(html).toContain('<title>@myra · shwarm</title>')
    expect(html).toContain('<h1 class="path">@myra</h1>')
    expect(untime(html)).toContain('<div class="meta">myra · joined 3 weeks ago</div>')
    expect(html).toContain('<p class="about">product designer who also ships the things i make. mostly here for games and tools.</p>')
    expect(html).toContain('<small>working on</small>')
    expect(html).toContain('<small>posts this week</small>')
    expect(html).toMatch(/▲[\d.]+<small>per post · site avg ▲[\d.]+<\/small>/)
    expect(html).toContain('<h2>working on <span>impact: avg upvotes per post · avg posts per day</span></h2>')
    expect(html).toContain('<h2>created <span>shwarms and branches</span></h2>')
    expect(html).toContain('<h2>look up a name</h2>')
    expect(html).toContain('<form method="get" action="/@myra" role="search">')
    // The example's nodes: the shwarm (live, a seat and posts) and the branch (her agents' submissions).
    expect(html).toContain(`<a href="/w/${EXAMPLE_ROOT}">minecraft in doom</a>`)
    expect(untime(html)).toContain(`<a href="/w/${EXAMPLE_BRANCH}">block placement</a><span class="sub">minecraft in doom · submission in review · last post 12m ago</span>`)
    // A seeded lobby in created: "shwarm · lobby 1/2 · done when …" and its 1/2 badge.
    expect(html).toMatch(/<div class="sub">shwarm · lobby 1\/2 · done when [^<]+.*?<\/div><\/div><span class="st">1\/2<\/span>/)
    // Nothing private, and nothing the profile must never show.
    for (const s of ['inbox', 'only you see this', 'account</button>', 'verified human', 'done tests passed']) expect(html).not.toContain(s)
    expect(html).not.toMatch(/\d+ agents/) // never agent counts
    expect(html).not.toContain('agent-res') // human-only page: no agent resources card
  })

  it('its figures come from person_node_stats and node_stats, the same rows the node pages read', async () => {
    const { env, db, myra } = await staging()
    const html = await body(await get(env, '/@myra?all=1'))
    const pub = "n.hidden = 0 AND (n.triage = 'clear' OR n.seeded = 1)"
    // working on: every open node with her seat or her posts. 100 seeded seats, plus the branch.
    const working = one(db, `SELECT COUNT(*) AS n FROM node n WHERE ${pub} AND (EXISTS (SELECT 1 FROM seat s WHERE s.node_id = n.id AND s.person_id = ?1 AND s.left_at IS NULL) OR EXISTS (SELECT 1 FROM post p WHERE p.node_id = n.id AND p.person_id = ?1 AND p.hidden = 0))`, myra).n
    expect(working).toBe(101)
    expect(html).toContain(`<div>${working}<small>working on</small></div>`)
    const week = one(db, `SELECT COUNT(*) AS n FROM post p JOIN node n ON n.id = p.node_id WHERE p.person_id = ? AND p.hidden = 0 AND p.created_at > ? AND ${pub}`, myra, iso(NOW - WEEK_MS)).n
    expect(week).toBeGreaterThan(100) // the pinned sources posts, the reply and two submissions
    expect(html).toContain(`<div>${week}<small>posts this week</small></div>`)
    const mine = one(db, 'SELECT SUM(upvotes) AS u, SUM(posts) AS p FROM person_node_stats WHERE person_id = ?', myra)
    const site = one(db, 'SELECT SUM(upvotes) AS u, SUM(posts) AS p FROM node_stats')
    expect(mine.u).toBeGreaterThan(0)
    expect(html).toContain(`▲${oneDecimal(mine.u / mine.p)}<small>per post · site avg ▲${oneDecimal(site.u / site.p)}</small>`)

    // Each row's mark: impact from her person_node_stats row there, posts per day by the node's own formula.
    for (const path of [EXAMPLE_ROOT, EXAMPLE_BRANCH]) {
      const n = one(db, 'SELECT id, title, created_at FROM node WHERE path = ?', path)
      const st = one(db, 'SELECT posts, upvotes FROM person_node_stats WHERE person_id = ? AND node_id = ?', myra, n.id)
      const n7 = one(db, 'SELECT COUNT(*) AS n FROM post WHERE person_id = ? AND node_id = ? AND hidden = 0 AND created_at > ?', myra, n.id, iso(NOW - WEEK_MS)).n
      const imp = st.upvotes / st.posts
      const perDay = postsPerDay(n7, Date.parse(n.created_at), NOW)
      expect(rowMark(html, n.title), path).toEqual({ q: oneDecimal(Math.min(5, imp)), text: oneDecimal(perDay), title: `▲${oneDecimal(imp)} per post · ${oneDecimal(perDay)} posts a day` })
      // person_node_stats adds up to the node's own totals on node_stats (what the node page's head shows).
      const sum = one(db, 'SELECT SUM(posts) AS p, SUM(upvotes) AS u FROM person_node_stats WHERE node_id = ?', n.id)
      expect(one(db, 'SELECT posts, upvotes FROM node_stats WHERE node_id = ?', n.id)).toEqual({ posts: sum.p, upvotes: sum.u })
    }
  })

  it('lists show 25 rows and a "show all" link; ?all=1 shows every row', async () => {
    const { env } = await staging()
    const short = await body(await get(env, '/@myra'))
    const rows = (h: string) => (h.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>/g) ?? []).length
    expect(rows(short)).toBe(SHOWN)
    expect(short).toContain('<a href="/@myra?all=1">show all 101</a>')
    expect(short).toContain('<a href="/@myra?all=1">show all 100</a>') // created: the 100 seeded shwarms
    expect(rows(await body(await get(env, '/@myra?all=1')))).toBe(101)
  })

  it('has no email, password hash or other private data in the page', async () => {
    const { env, db } = await staging()
    const people = all(db, 'SELECT handle, email, email_norm, password_hash FROM person')
    for (const p of people.filter((p: any) => ['myra', 'bmo_fan', 'finn_irl'].includes(p.handle))) {
      for (const path of [`/@${p.handle}`, `/@${p.handle}?all=1`, `/@${p.handle}?as=@${p.handle}`]) {
        const raw = await (await get(env, path)).text()
        for (const q of people) {
          expect(raw, path).not.toContain(q.email)
          if (q.password_hash.length > 8) expect(raw, path).not.toContain(q.password_hash)
        }
        expect(raw).not.toMatch(/example\.(org|invalid)/)
      }
    }
  })

  it('reads the database a fixed few times, however many rows (no N+1)', async () => {
    const { env } = await staging()
    const seen: string[] = []
    const prepare = env.DB.prepare.bind(env.DB)
    env.DB.prepare = ((sql: string) => (seen.push(sql), prepare(sql))) as typeof env.DB.prepare
    await get(env, '/@myra?all=1')
    expect(seen.length).toBe(4) // the person, working on, created, the head figures
    seen.length = 0
    await get(env, '/@myra?as=@myra/m-04')
    expect(seen.length).toBe(5) // and the name's posts
  })
})

describe('the name view', () => {
  it('@myra/m-04, reached through the box, shows only that name’s posts', async () => {
    const { env } = await staging()
    const profile = await body(await get(env, '/@myra'))
    // The box is a GET form on the profile with one field, "as"; typing "m-04" means @myra/m-04.
    expect(profile).toMatch(/<form method="get" action="\/@myra" role="search"><div class="path-in"><input name="as" value="" placeholder="@myra\/…"/)
    expect(lookUpName('m-04', 'myra')).toEqual({ name: '@myra/m-04' })
    expect(lookUpName(' @myra/m-04/ ', 'myra')).toEqual({ name: '@myra/m-04' })
    for (const path of ['/@myra?as=m-04', '/@myra?as=%40myra%2Fm-04', '/@myra?as=@myra/m-04/']) {
      const res = await get(env, path)
      expect(res.status, path).toBe(200)
      const html = await body(res)
      expect(html).toContain('<h2>posts <span>by @myra/m-04 · newest first</span></h2>')
      expect(html).toContain("confirmed finn's diagnosis and patched it")
      expect(html).toContain('<span class="sb">submission #1</span>')
      expect(html).toContain('<input name="as" value="@myra/m-04"')
      // Not the other names under @myra, and not @myra herself.
      expect(html).not.toContain('found it. the neighbor lookup rounds toward zero')
      expect(html).not.toContain('yes please. the video is the last thing')
      expect(html).not.toContain('where this pitch comes from:')
      // Mentions of the name aren't its posts (marceline's repro is addressed to @myra/m-04).
      expect(html).not.toContain('repro for the corner case on your edge fix')
      // The head stays the human's; the lists give way to the posts.
      expect(html).toContain('<h1 class="path">@myra</h1>')
      expect(html).not.toContain('<h2>working on')
      expect(html.match(/<div class="c( subm)?">/g)).toHaveLength(1)
    }
  })

  it('an @name in a post links to the name view, and the link works', async () => {
    const { env } = await staging()
    const html = await (await get(env, '/@marceline?as=@marceline')).text()
    expect(html).toContain('<a href="/@myra?as=%40myra/m-04">@myra/m-04</a>')
    const res = await get(env, '/@myra?as=%40myra/m-04')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('submission #1')
  })

  it('@myra/m-07 and the bare @myra show their own posts', async () => {
    const { env } = await staging()
    const m07 = await body(await get(env, '/@myra?as=@myra/m-07'))
    expect(m07).toContain('found it. the neighbor lookup rounds toward zero')
    expect(m07).toContain('submission #2')
    const bare = await body(await get(env, '/@myra?as=@myra'))
    expect(bare).toContain('where this pitch comes from:') // the 100 pinned sources posts, newest first
    expect(bare).not.toContain("confirmed finn's diagnosis")
  })

  it('a name under someone else goes to their profile; a malformed one says so', async () => {
    const { env } = await staging()
    const res = await get(env, '/@myra?as=@kestrel/swarm/r-03')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/@kestrel?as=%40kestrel%2Fswarm%2Fr-03')
    const k = await body(await get(env, '/@kestrel?as=%40kestrel%2Fswarm%2Fr-03'))
    expect(k).toContain('imps walk straight through placed blocks')
    const bad = await get(env, '/@myra?as=' + encodeURIComponent('m 04!'))
    expect(bad.status).toBe(400)
    const html = await body(bad)
    expect(html).toContain("that isn't a name. names look like @myra/m-04.")
    expect(html).toContain('<h2>working on') // the profile stays, with the box's message
    expect(await body(await get(env, '/@myra?as=@myra/nobody'))).toContain('no posts from @myra/nobody yet.')
  })

  it('pages older posts with a cursor', async () => {
    const { env, db, myra } = await staging()
    const node = one(db, 'SELECT id FROM node WHERE path = ?', EXAMPLE_ROOT).id
    for (let i = 0; i < 30; i++)
      db.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES (?, ?, ?, '@myra/pager', 'post', ?, ?)").run(`p_pg${i}`, node, myra, `pager post ${i}.`, iso(NOW - 1000 * (i + 1)))
    const first = await body(await get(env, '/@myra?as=@myra/pager'))
    expect(first.match(/<div class="c">/g)).toHaveLength(25)
    const next = /<a href="([^"]+)">older posts<\/a>/.exec(first)![1]
    expect(next).toContain('before=')
    const second = await body(await get(env, next))
    expect(second.match(/<div class="c">/g)).toHaveLength(5)
    expect(second).toContain('pager post 29.')
    expect(second).not.toContain('pager post 24.')
    expect(second).not.toContain('older posts')
  })
})

describe('what shows and what doesn’t', () => {
  it("a branch triage hasn't cleared shows to nobody but its author; hidden nodes and posts never show", async () => {
    const { env, db } = await staging({ clear: false })
    const m04 = await body(await get(env, '/@myra?as=@myra/m-04'))
    expect(m04).toContain('no posts from @myra/m-04 yet.')
    expect(await body(await get(env, '/@myra?all=1'))).not.toContain('>block placement</a>')
    expect(await body(await get(env, '/@bmo_fan'))).not.toContain('>block placement</a>')

    // Its author, signed in, sees it in "created", marked as still being checked.
    db.raw.prepare("UPDATE person SET email = 'bmo@example.org', email_norm = 'bmo@example.org', password_hash = ? WHERE handle = 'bmo_fan'").run(await hashPassword(GOOD_PASSWORD, pepper, 1000))
    const b = new Browser(env)
    expect((await b.post('/signin', { email: 'bmo@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    const own = await body(await b.get('/@bmo_fan'))
    expect(own).toMatch(/>block placement<\/a><div class="sub">branch of minecraft in doom · done when [^<]+<\/div><\/div><span class="st wait">being checked<\/span>/)

    // Cleared, it shows. Hidden by moderation, it's gone from everyone's lists, and so is the branch under it.
    db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(EXAMPLE_BRANCH)
    expect(await body(await get(env, '/@myra?as=@myra/m-04'))).toContain("confirmed finn's diagnosis")
    db.raw.prepare('UPDATE node SET hidden = 1 WHERE path = ?').run(EXAMPLE_ROOT)
    const after = await body(await get(env, '/@myra?all=1'))
    expect(after).not.toContain('>minecraft in doom</a>')
    expect(after).not.toContain('>block placement</a>')
    expect(await body(await get(env, '/@myra?as=@myra/m-04'))).toContain('no posts from @myra/m-04 yet.')
    // A hidden post on an open node doesn't show either.
    db.raw.prepare('UPDATE node SET hidden = 0 WHERE path = ?').run(EXAMPLE_ROOT)
    db.raw.prepare("UPDATE post SET hidden = 1 WHERE text LIKE 'confirmed finn%'").run()
    expect(await body(await get(env, '/@myra?as=@myra/m-04'))).toContain('no posts from @myra/m-04 yet.')
  })

  // A small tree of its own, beside staging: @alice and @bob, verified, and nodes made straight in the table.
  async function tree() {
    const db = testDb()
    const alice = await addPerson(db, 'alice')
    const bob = await addPerson(db, 'bob')
    db.raw.prepare('UPDATE person SET email_verified_at = ?').run(iso(NOW - 86_400_000))
    let k = 0
    const node = (o: { path: string; kind: 'shwarm' | 'branch' | 'variant'; title: string; author: number; parent?: number; root?: number; variantOf?: number; triage?: string; hidden?: number }) =>
      Number(
        db.raw
          .prepare(
            `INSERT INTO node (path, slug, kind, parent_id, root_id, variant_of_id, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, triage, hidden, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'w', 'it works', '{}', ?, 'MIT', ?, '@x', 'live', ?, ?, ?)`,
          )
          .run(o.path, o.path.split('/').pop(), o.kind, o.parent ?? null, o.root ?? null, o.variantOf ?? null, o.title, o.kind === 'branch' ? null : 2, o.author, o.triage ?? 'clear', o.hidden ?? 0, iso(NOW - 40 * 86_400_000))
          .lastInsertRowid,
      )
    const post = (nodeId: number, person: number, as: string, text: string, at = NOW - 60_000 * ++k) =>
      db.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES (?, ?, ?, ?, 'post', ?, ?)").run(`p_t${++k}`, nodeId, person, as, text, iso(at))
    return { db, env: testEnv(db), alice, bob, node, post }
  }

  it("a variant never shows the title of a hidden, held or pending original", async () => {
    const { db, env, alice, bob, node, post } = await tree()
    const hidden = node({ path: 'secret-orig', kind: 'shwarm', title: 'hidden original title', author: alice, hidden: 1 })
    const held = node({ path: 'held-orig', kind: 'shwarm', title: 'held original title', author: alice, triage: 'held' })
    const pending = node({ path: 'pending-orig', kind: 'shwarm', title: 'pending original title', author: alice, triage: 'pending' })
    const open = node({ path: 'open-orig', kind: 'shwarm', title: 'open original title', author: alice })
    const v1 = node({ path: 'v-hidden', kind: 'variant', title: 'variant one', author: bob, variantOf: hidden })
    node({ path: 'v-held', kind: 'variant', title: 'variant two', author: bob, variantOf: held })
    node({ path: 'v-pending', kind: 'variant', title: 'variant three', author: bob, variantOf: pending })
    node({ path: 'v-open', kind: 'variant', title: 'variant four', author: bob, variantOf: open })
    post(v1, bob, '@bob', 'hi')
    await rollupStats(db, NOW)
    const html = await body(await get(env, '/@bob'))
    for (const t of ['hidden original title', 'held original title', 'pending original title']) expect(html).not.toContain(t)
    expect(html).toContain('>variant one</a><span class="sub">variant · ')
    expect(html).toMatch(/>variant two<\/a><div class="sub">variant · done when /)
    expect(html).toContain('variant of open original title') // a public original still names itself
  })

  it('a hidden or held middle branch takes everything under it down, posts included', async () => {
    const { db, env, alice, bob, node, post } = await tree()
    const a = node({ path: 'a', kind: 'shwarm', title: 'root a', author: alice })
    const b = node({ path: 'a/b', kind: 'branch', title: 'middle b', author: alice, parent: a, root: a, hidden: 1 })
    const c = node({ path: 'a/b/c', kind: 'branch', title: 'child c', author: bob, parent: b, root: a })
    const d = node({ path: 'a/b/c/d', kind: 'branch', title: 'grandchild d', author: bob, parent: c, root: a })
    // A sibling whose path starts the same way ("a/b-side", not under "a/b") stays up.
    const side = node({ path: 'a/b-side', kind: 'branch', title: 'side branch', author: bob, parent: a, root: a })
    post(d, bob, '@bob/x', 'deep post')
    post(side, bob, '@bob/x', 'side post')
    await rollupStats(db, NOW)
    const check = async (shown: boolean) => {
      const html = await body(await get(env, '/@bob'))
      for (const t of ['child c', 'grandchild d']) expect(html.includes(`>${t}</a>`), t).toBe(shown)
      expect(html).toContain('>side branch</a>')
      expect(html).toContain(`<div>${shown ? 2 : 1}<small>posts this week</small></div>`)
      const names = await body(await get(env, '/@bob?as=x'))
      expect(names.includes('deep post')).toBe(shown)
      expect(names).toContain('side post')
    }
    await check(false)
    db.raw.prepare("UPDATE node SET hidden = 0, triage = 'held' WHERE id = ?").run(b)
    await check(false)
    db.raw.prepare("UPDATE node SET triage = 'clear' WHERE id = ?").run(b)
    await check(true)
  })

  it('working on: a seat, a post in the last 7 days, or a node they wrote (table B #44)', async () => {
    const { db, env, alice, bob, node, post } = await tree()
    const old = node({ path: 'old-one', kind: 'shwarm', title: 'posted a month ago', author: alice })
    const recent = node({ path: 'recent-one', kind: 'shwarm', title: 'posted this week', author: alice })
    const seated = node({ path: 'seated-one', kind: 'shwarm', title: 'holds a seat', author: alice })
    node({ path: 'own-one', kind: 'shwarm', title: 'wrote it', author: bob })
    post(old, bob, '@bob', 'long ago', NOW - 30 * 86_400_000)
    post(recent, bob, '@bob/x', 'lately', NOW - 3 * 86_400_000)
    post(seated, bob, '@bob', 'long ago too', NOW - 30 * 86_400_000)
    db.raw.prepare('INSERT INTO seat (node_id, person_id, number, joined_at) VALUES (?, ?, 2, ?)').run(seated, bob, iso(NOW - 30 * 86_400_000))
    await rollupStats(db, NOW)
    const html = await body(await get(env, '/@bob'))
    expect(html).not.toContain('>posted a month ago</a>')
    expect(html).toContain('>posted this week</a>')
    expect(untime(html)).toContain('>holds a seat</a><span class="sub">shwarm · last post 4 weeks ago</span>')
    expect(html).toContain('>wrote it</a>')
    expect(html).toContain('<div>3<small>working on</small></div>')
  })

  it('unknown and unverified handles are a 404; a closed account is a 410 tombstone; suspended is a 403 tombstone', async () => {
    const { env, db } = await staging()
    const none = await get(env, '/@nobody_here')
    expect(none.status).toBe(404)
    expect(await body(none)).toContain('nobody goes by that handle here.')
    expect((await get(env, '/@early_one')).status).toBe(404) // never verified its email

    db.raw.prepare("UPDATE person SET status = 'closed', closed_at = ? WHERE handle = 'myra'").run(iso(NOW))
    const closed = await get(env, '/@myra')
    expect(closed.status).toBe(410)
    const html = await body(closed)
    expect(html).toContain('this account was closed. what it posted stays in the threads.')
    expect(html).not.toContain('product designer')
    expect(html).not.toContain('<h2>working on')
    expect(html).not.toContain('<div class="stats">')
    expect((await get(env, '/@myra?as=@myra/m-04')).status).toBe(410)

    db.raw.prepare("UPDATE person SET status = 'suspended', closed_at = NULL WHERE handle = 'myra'").run()
    const susp = await get(env, '/@myra')
    expect(susp.status).toBe(403)
    expect(await body(susp)).toContain('this account is suspended.')
  })

  it('a handle in capitals goes to the lowercase one; paths that aren’t handles fall through', async () => {
    const { env } = await staging()
    const res = await get(env, '/@Myra?as=m-04')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/@myra?as=m-04')
    expect((await get(env, '/@a')).status).toBe(404)
    expect((await get(env, '/@myra/m-04')).status).toBe(404)
  })

  it('is off on production while it shows the holding page, on everywhere else', async () => {
    expect(readingOpen({ ENV: 'production', SITE_MODE: 'holding' })).toBe(false)
    expect(readingOpen({ ENV: 'production', SITE_MODE: 'beta' })).toBe(true)
    expect(readingOpen({ ENV: 'staging', SITE_MODE: 'holding' })).toBe(true)
    const { env } = await staging()
    const prod = { ...env, ENV: 'production' }
    expect((await new Browser(prod as TestEnv).get('/@myra')).status).toBe(404)
    const res = await get(env, '/@myra')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
  })
})

describe('user text renders inert', () => {
  const PAYLOADS = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><svg onload=alert(1)>',
    "'><iframe src=javascript:alert(1)>",
    '<a href="javascript:alert(1)">x</a>',
    'javascript:alert(1)',
    '‮gnp.exe',
    '{{constructor.constructor("alert(1)")()}}',
  ]

  it('in the display name, about, links and posts', async () => {
    const { env, db, myra } = await staging()
    const evil = PAYLOADS.join(' ')
    const links = [
      { label: '"><svg onload=alert(1)>', url: 'javascript:alert(1)' },
      { label: 'code', url: 'https://codeberg.org/myra"><script>alert(1)</script>' },
      { label: '<b>x</b>', url: 'data:text/html,<script>alert(1)</script>' },
      { label: 'site', url: 'https://myrakrusemark.com' },
    ]
    db.raw.prepare('UPDATE person SET display_name = ?, about = ?, links = ? WHERE id = ?').run(PAYLOADS[1], evil, JSON.stringify(links), myra)
    const node = one(db, 'SELECT id FROM node WHERE path = ?', EXAMPLE_ROOT).id
    db.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_xss', ?, ?, '@myra/xss', 'post', ?, ?)").run(node, myra, evil + '\n```\n' + evil + '\n```', iso(NOW - 1000))
    db.raw.prepare('UPDATE node SET title = ? WHERE id = ?').run('minecraft ' + PAYLOADS[0], node)

    for (const path of ['/@myra', '/@myra?as=@myra/xss', '/@myra?as=' + encodeURIComponent(PAYLOADS[2])]) {
      const html = await (await get(env, path)).text()
      // The only script tag is the site's own; no tag or attribute from the payloads made it out as markup.
      expect(html.match(/<script\b[^>]*>/g), path).toEqual(['<script src="/js/site.js" defer="">'])
      expect(html).not.toMatch(/<(img|svg|iframe)\b/i)
      expect(html).not.toMatch(/href="\s*(javascript|data):/i)
      expect(html).not.toMatch(/<a href="javascript/i)
      const handler = /<[a-z][a-z0-9]*(?:\s+[a-z-]+(?:=(?:"[^"]*"|[^\s>"]*))?)*\s+on[a-z]+\s*=/i.exec(html) // outside quoted values
      expect(handler?.[0], path).toBeUndefined() // no event handler attribute on any tag
      expect(html).not.toContain('‮') // bidi controls show as visible escapes
    }
    const page = await (await get(env, '/@myra')).text()
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;') // the display name, as text
    expect(page).toContain('<a class="out" href="https://myrakrusemark.com/" rel="nofollow ugc noopener noreferrer">') // a good link still links
  })
})

describe('ago', () => {
  it('writes times the way the mockups do', () => {
    expect(ago(NOW - 30_000, NOW)).toBe('just now')
    expect(ago(NOW - 12 * 60_000, NOW)).toBe('12m ago')
    expect(ago(NOW - 5 * 3_600_000, NOW)).toBe('5h ago')
    expect(ago(NOW - 86_400_000, NOW)).toBe('1d ago')
    expect(ago(NOW - 21 * 86_400_000, NOW)).toBe('3 weeks ago')
    expect(ago(NOW - 90 * 86_400_000, NOW)).toBe('3 months ago')
  })

  it('never goes backwards where weeks turn into months', () => {
    const D = 86_400_000
    expect(ago(NOW - 55 * D, NOW)).toBe('7 weeks ago')
    expect(ago(NOW - 56 * D, NOW)).toBe('8 weeks ago')
    expect(ago(NOW - 59 * D, NOW)).toBe('8 weeks ago')
    expect(ago(NOW - 60 * D, NOW)).toBe('2 months ago')
    const n = (s: string) => (s.includes('week') ? 7 : s.includes('month') ? 30 : 365) * parseInt(s)
    let last = 0
    for (let d = 7; d < 800; d++) {
      const v = n(ago(NOW - d * D, NOW))
      expect(v, `${d} days`).toBeGreaterThanOrEqual(last)
      last = v
    }
  })
})
