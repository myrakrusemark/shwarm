// Go-live 4.9: every product limit, through the site. Thread posts (a burst of 5, then 1 every 5 minutes, per thread,
// per person), 3 new shwarms and branches a day with the in-batch guard behind the count, one submission
// per person per node per day, the per-network caps on the account forms, the per-network cap on public reads (and a
// 304 that reads no D1 while this isolate knows the version, else only the node chain), and the 256 KB cap on request bodies.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { hashPassword } from '../src/auth/password'
import { NEW_NODES_PER_DAY, THREAD_BURST, THREAD_REFILL_S } from '../src/core/limits'
import { newId } from '../src/core/ids'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { READ_BURST, READ_REFILL_PER_S, resetReadLimit, takeRead } from '../src/web/read-limit'
import { forgetVersions, VERSION_MEMO_MS } from '../src/web/version-memo'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, joinForm, ORIGIN, pepper, setSignup, testEnv, type TestEnv } from './browser'
import { stagingWorld } from './node-fixture'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

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
const JSON_ = { accept: 'application/json' }
const at = (ms: number) => vi.setSystemTime(T0 + ms)

async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const q = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).get(...args)
  const count = (sql: string, ...args: unknown[]) => (q(sql, ...args) as { n: number }).n
  return { ...w, env, q, count }
}

/** A verified member signed in from `ip`. */
async function member(env: TestEnv, handle: string, ip = '203.0.113.9') {
  const pid = await addPerson(env.DB, handle, { hash: await hashPassword(GOOD_PASSWORD, pepper, 1000) })
  env.DB.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(new Date(T0).toISOString(), pid)
  const b = new Browser(env, ip)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return { b, pid }
}

/** One of the node page's forms, sent with the token from the page itself. */
async function act(b: Browser, path: string, fields: Record<string, string>) {
  const token = formTokenIn(await (await b.req(`/w/${path}`, { headers: HTML })).text())
  return b.req(`/w/${path}`, { form: { form_token: token, ...fields } })
}

const post = (b: Browser, path: string, text: string, extra: Record<string, string> = {}) => act(b, path, { do: 'post', text, ...extra })

const FILE = `https://codeberg.org/ana/doom-blocks/raw/branch/main/corner-fix.diff ${'4e'.repeat(32)}`
const submit = (b: Browser, path: string, text: string) =>
  act(b, path, { do: 'submit', text, links: FILE, how_to_check: 'load corner-repro.lmp and place 200 blocks on each corner.' })

/** The create form at `from` (/new, /new?parent=…), sent with every hidden field the page carries. */
async function create(b: Browser, from: string, fields: Record<string, string>) {
  const page = await (await b.get(from)).text()
  const hidden = Object.fromEntries([...page.matchAll(/<input type="hidden" name="(parent)" value="([^"]+)"/g)].map(m => [m[1], m[2]]))
  return b.req('/new', { form: { form_token: formTokenIn(page), ...hidden, c_author: 'on', ...fields } })
}
const newShwarm = (b: Browser, title: string) => create(b, '/new', { title, what: 'a test goal.', done_when: 'it is done.', tags: '#test', license: 'MIT' })
const newBranch = (b: Browser, title: string) => create(b, `/new?parent=${EXAMPLE_ROOT}`, { title, what: 'a part of it.', done_when: 'the part works.' })

/** Every query this database is asked (its SQL and bound values), and every write. */
function watch(env: TestEnv) {
  const seen = { sql: [] as string[], args: [] as unknown[][], writes: 0 }
  const db = env.DB as any
  const prepare = db.prepare.bind(db)
  const batch = db.batch.bind(db)
  const wrap = (st: any, i: number): any => ({ ...st, bind: (...a: unknown[]) => ((seen.args[i] = a), wrap(st.bind(...a), i)), run: () => (seen.writes++, st.run()) })
  db.prepare = (sql: string) => {
    seen.args.push([])
    return wrap(prepare(sql), seen.sql.push(sql) - 1)
  }
  db.batch = (stmts: unknown[]) => (seen.writes++, batch(stmts))
  return Object.assign(seen, { reset: () => ((seen.sql.length = 0), (seen.args.length = 0), (seen.writes = 0)) })
}

// ---------- thread posts ----------

describe('thread posts: a burst of 5, then 1 every 5 minutes, per thread, per person', () => {
  it('the 6th quick post waits 5 minutes; other threads and other people are not held up; it refills', async () => {
    const { env, count } = await world()
    const { b: ana } = await member(env, 'ana')
    for (let i = 1; i <= THREAD_BURST; i++) expect((await post(ana, EXAMPLE_ROOT, `quick ${i}`)).status, `post ${i}`).toBe(303)
    const sixth = await post(ana, EXAMPLE_ROOT, 'quick 6')
    expect(sixth.status).toBe(429)
    expect(sixth.headers.get('retry-after')).toBe(String(THREAD_REFILL_S))
    expect(await body(sixth)).toContain('slow down: you can post here again in about 5 minutes.')
    expect(count("SELECT COUNT(*) AS n FROM post WHERE text LIKE 'quick %'")).toBe(5)
    // per thread: the branch has its own bucket
    expect((await post(ana, EXAMPLE_BRANCH, 'over on the branch')).status).toBe(303)
    // per person: someone else posts here as usual
    const { b: bo } = await member(env, 'bo')
    expect((await post(bo, EXAMPLE_ROOT, 'hello from bo')).status).toBe(303)
    // one back every 5 minutes, and no more
    at(THREAD_REFILL_S * 1000)
    expect((await post(ana, EXAMPLE_ROOT, 'quick 6, later')).status).toBe(303)
    expect((await post(ana, EXAMPLE_ROOT, 'quick 7')).status).toBe(429)
    // a long quiet fills the bucket to 5, never past it
    at(THREAD_REFILL_S * 1000 + DAY)
    for (let i = 1; i <= THREAD_BURST; i++) expect((await post(ana, EXAMPLE_ROOT, `after a day ${i}`)).status).toBe(303)
    expect((await post(ana, EXAMPLE_ROOT, 'after a day 6')).status).toBe(429)
  })

  it('replies, edits and submissions spend from the same bucket; upvotes and a refused post do not', async () => {
    const { env, q } = await world()
    const { b: ana } = await member(env, 'ana')
    expect((await post(ana, EXAMPLE_BRANCH, 'first')).status).toBe(303) // 4 left
    const mine = (q("SELECT id FROM post WHERE text = 'first'") as { id: string }).id
    expect((await post(ana, EXAMPLE_BRANCH, 'a reply', { reply_to: mine })).status).toBe(303) // 3
    expect((await act(ana, EXAMPLE_BRANCH, { do: 'edit', post: mine, text: 'first, edited' })).status).toBe(303) // 2
    expect((await submit(ana, EXAMPLE_BRANCH, 'the corner fix')).status).toBe(303) // 1
    const theirs = (q("SELECT id FROM post WHERE node_id = (SELECT id FROM node WHERE path = ?) AND as_name <> '@ana' AND kind = 'post' LIMIT 1", EXAMPLE_BRANCH) as { id: string }).id
    expect((await act(ana, EXAMPLE_BRANCH, { do: 'upvote', post: theirs })).status).toBe(303) // free
    expect((await post(ana, EXAMPLE_BRANCH, '   ')).status).toBe(400) // refused before core: free
    expect((await post(ana, EXAMPLE_BRANCH, 'the last quick one')).status).toBe(303) // 0
    const res = await post(ana, EXAMPLE_BRANCH, 'one too many')
    expect(res.status).toBe(429)
    // a refused post spends nothing either: the wait is still one refill, not two
    expect(res.headers.get('retry-after')).toBe(String(THREAD_REFILL_S))
    expect((await post(ana, EXAMPLE_BRANCH, 'one too many, again')).headers.get('retry-after')).toBe(String(THREAD_REFILL_S))
  })
})

// ---------- new nodes ----------

describe('new nodes: 3 a day, shwarms and branches together (no variants since Oct 9)', () => {
  it('two shwarms and a branch use up the day; the 4th of either kind waits for the first to age out', async () => {
    const { env, count } = await world()
    const { b: ana, pid } = await member(env, 'ana')
    expect((await newShwarm(ana, 'one of three')).status).toBe(303)
    at(HOUR)
    expect((await newBranch(ana, 'two of three')).status).toBe(303)
    at(2 * HOUR)
    expect((await newShwarm(ana, 'three of three')).status).toBe(303)
    at(3 * HOUR)
    for (const res of [await newShwarm(ana, 'four'), await newBranch(ana, 'four')]) {
      expect(res.status).toBe(429)
      expect(res.headers.get('retry-after')).toBe(String((DAY - 3 * HOUR) / 1000)) // when the first one is a day old
      expect(await body(res)).toContain("that's 3 new shwarms and branches today, the most for one person.")
    }
    expect(count('SELECT COUNT(*) AS n FROM node WHERE author_id = ?', pid)).toBe(NEW_NODES_PER_DAY)
    // a rolling day: once the first is a day old there is room for one, not three
    at(DAY + 1)
    expect((await newBranch(ana, 'four, a day later')).status).toBe(303)
    const res = await newBranch(ana, 'five')
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe(String(HOUR / 1000)) // when the branch from T0 + 1 hour is a day old
  })

  it("seeded launch shwarms don't count against their author", async () => {
    const { env, count, myraId } = await world()
    env.DB.raw.prepare('UPDATE person SET password_hash = ? WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), myraId)
    expect(count('SELECT COUNT(*) AS n FROM node WHERE author_id = ? AND seeded = 1', myraId)).toBeGreaterThan(0)
    const b = new Browser(env)
    expect((await b.post('/signin', { email: 'myra@example.org', password: GOOD_PASSWORD })).status).toBe(303)
    for (let i = 1; i <= NEW_NODES_PER_DAY; i++) expect((await newBranch(b, `myra fix ${i}`)).status).toBe(303)
    expect((await newBranch(b, 'myra fix 4')).status).toBe(429)
  })

  it('the guard inside the batch holds when the count read beforehand was stale', async () => {
    // Creates in different trees don't queue behind each other, so the count read before the batch can be out of
    // date by the time the batch runs. Here that read is made to miss the day's 3 nodes once: the INSERT's own
    // guard refuses, nothing is written, and the person gets the same 429.
    const { env, count } = await world()
    const { b: ana, pid } = await member(env, 'ana')
    for (let i = 1; i <= NEW_NODES_PER_DAY; i++) expect((await newShwarm(ana, `guarded ${i}`)).status).toBe(303)
    const db = env.DB as any
    const prepare = db.prepare.bind(db)
    let stale = 1
    db.prepare = (sql: string) =>
      stale && sql.startsWith('SELECT created_at FROM node WHERE author_id = ?') ? (stale--, prepare(sql.replace('author_id = ?', 'author_id = -1 * ?'))) : prepare(sql)
    const tags = count('SELECT COUNT(*) AS n FROM node_tag')
    const seats = count('SELECT COUNT(*) AS n FROM seat')
    const res = await newShwarm(ana, 'guarded 4')
    expect(stale).toBe(0) // the stale read happened
    expect(res.status).toBe(429)
    expect(await body(res)).toContain("that's 3 new shwarms and branches today")
    expect(count('SELECT COUNT(*) AS n FROM node WHERE author_id = ?', pid)).toBe(NEW_NODES_PER_DAY)
    // the rest of the batch didn't land either: no tag, no seat
    expect(count('SELECT COUNT(*) AS n FROM node_tag')).toBe(tags)
    expect(count('SELECT COUNT(*) AS n FROM seat')).toBe(seats)
  })

  it('four creates sent at once with one left in the day: one lands', async () => {
    const { env, count } = await world()
    const { b: ana, pid } = await member(env, 'ana')
    expect((await newShwarm(ana, 'parallel one')).status).toBe(303)
    expect((await newShwarm(ana, 'parallel two')).status).toBe(303)
    const pages = await Promise.all([0, 1, 2, 3].map(() => ana.get('/new').then(r => r.text())))
    const sent = await Promise.all(
      pages.map((page, i) =>
        ana.req('/new', { form: { form_token: formTokenIn(page), c_author: 'on', title: `parallel ${i + 3}`, what: 'a test goal.', done_when: 'it is done.', tags: '#test', license: 'MIT' } }),
      ),
    )
    expect(sent.map(r => r.status).sort()).toEqual([303, 429, 429, 429])
    expect(count('SELECT COUNT(*) AS n FROM node WHERE author_id = ?', pid)).toBe(NEW_NODES_PER_DAY)
  })
})

// ---------- submissions ----------

describe('submissions: one per person per node per day', () => {
  it('a second the same day waits; another node, another person and the next day are fine', async () => {
    const { env, count } = await world()
    const { b: ana } = await member(env, 'ana')
    const subs = (path: string) => count('SELECT COUNT(*) AS n FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ?', path)
    const before = subs(EXAMPLE_BRANCH)
    expect((await submit(ana, EXAMPLE_BRANCH, 'the corner fix')).status).toBe(303)
    at(HOUR)
    const again = await submit(ana, EXAMPLE_BRANCH, 'a better corner fix')
    expect(again.status).toBe(429)
    expect(again.headers.get('retry-after')).toBe(String((DAY - HOUR) / 1000))
    expect(await body(again)).toContain('one submission per person per day here. next in about 23 hours.')
    expect(subs(EXAMPLE_BRANCH)).toBe(before + 1)
    // another node the same day
    expect((await submit(ana, EXAMPLE_ROOT, 'the whole mod')).status).toBe(303)
    // another person on the same node the same day
    const { b: bo } = await member(env, 'bo')
    expect((await submit(bo, EXAMPLE_BRANCH, "bo's corner fix")).status).toBe(303)
    // a rolling day after the first
    at(DAY + 1)
    expect((await submit(ana, EXAMPLE_BRANCH, 'a better corner fix, a day on')).status).toBe(303)
    expect(subs(EXAMPLE_BRANCH)).toBe(before + 3)
  })
})

// ---------- per-network caps on the account forms ----------

describe('per-network caps on the account forms', () => {
  // Each form: the requests one network gets in a window, the block after (seconds), how to send the nth from `ip`, and the status when let through.
  type Form = { name: string; allowed: number; block: number; send: (env: TestEnv, ip: string, n: number) => Promise<Response>; ok: number }
  const FORMS: Form[] = [
    { name: 'sign-up (5 an hour)', allowed: 5, block: 3600, ok: 303, send: (env, ip, n) => new Browser(env, ip).post('/join', joinForm(`user${n}`, `user${n}@example${n}.org`)) },
    { name: '"send it again" (10 an hour)', allowed: 10, block: 3600, ok: 303, send: (env, ip) => new Browser(env, ip).post('/check-email') },
    { name: 'forgot password (10 an hour)', allowed: 10, block: 3600, ok: 303, send: (env, ip, n) => new Browser(env, ip).post('/forgot', { email: `person${n}@example.org` }) },
    // spread over 5 addresses so the per-address limit (10) isn't what trips
    { name: 'wrong passwords at sign-in (the 20th in 15 minutes)', allowed: 19, block: 900, ok: 400, send: (env, ip, n) => new Browser(env, ip).post('/signin', { email: `person${n % 5}@example.org`, password: `guess ${n}` }) },
  ]

  for (const f of FORMS) {
    it(`${f.name}: past the cap the network waits, a neighbour on it too; other networks don't; it lifts`, async () => {
      const env = testEnv()
      await setSignup(env.DB, 'open')
      for (let n = 1; n <= f.allowed; n++) expect((await f.send(env, `198.51.100.${n}`, n)).status, `request ${n}`).toBe(f.ok)
      const over = await f.send(env, '198.51.100.200', f.allowed + 1)
      expect(over.status).toBe(429)
      expect(over.headers.get('retry-after')).toBe(String(f.block))
      expect(await body(over)).toContain('too many tries')
      expect((await f.send(env, '198.51.100.201', f.allowed + 2)).status).toBe(429)
      expect((await f.send(env, '192.0.2.1', f.allowed + 3)).status).toBe(f.ok)
      at(f.block * 1000 + 1)
      expect((await f.send(env, '198.51.100.202', f.allowed + 4)).status).toBe(f.ok)
    })
  }

  it('IPv6: one /48 is one network', async () => {
    const env = testEnv()
    for (let n = 1; n <= 10; n++) expect((await new Browser(env, `2001:db8:1:${n}::1`).post('/forgot', { email: `p${n}@example.org` })).status).toBe(303)
    expect((await new Browser(env, '2001:db8:1:ffff::9').post('/forgot', { email: 'p11@example.org' })).status).toBe(429)
    expect((await new Browser(env, '2001:db8:2::1').post('/forgot', { email: 'p12@example.org' })).status).toBe(303)
  })

  it('a wrong password at step-up counts with sign-in on the same network', async () => {
    const env = testEnv()
    const { b } = await member(env, 'myra', '203.0.113.5')
    for (let n = 1; n <= 19; n++) expect((await new Browser(env, `203.0.113.${n + 10}`).post('/signin', { email: `person${n % 5}@example.org`, password: 'guess' })).status).toBe(400)
    const res = await b.post('/step-up', { password: 'not it', next: '/' })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('900')
  })

  it('a blocked forgot form sends no mail and looks the same whether or not the address has an account', async () => {
    const env = testEnv()
    await member(env, 'myra')
    for (let n = 1; n <= 10; n++) await new Browser(env, '198.51.100.9').post('/forgot', { email: `p${n}@example.org` })
    const known = await new Browser(env, '198.51.100.9').post('/forgot', { email: 'myra@example.org' })
    const unknown = await new Browser(env, '198.51.100.9').post('/forgot', { email: 'nobody@example.org' })
    expect([known.status, unknown.status]).toEqual([429, 429])
    expect(await body(known)).toBe(await body(unknown))
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM email_outbox WHERE template = 'reset'").get().n).toBe(0)
  })
})

// ---------- public reads ----------

describe('public reads: one bucket per network', () => {
  it('node pages, the feed and profiles share it; past it, 429 with Retry-After; it refills at 2 a second', async () => {
    const { env } = await world()
    const b = new Browser(env, '203.0.113.9')
    const paths = [`/w/${EXAMPLE_ROOT}?format=json`, `/w/${EXAMPLE_BRANCH}/s/2?format=json`, '/', '/@myra']
    for (let i = 0; i < READ_BURST; i++) expect((await b.get(paths[i % paths.length])).status, `read ${i + 1}`).toBe(200)
    for (const p of paths) {
      const res = await b.get(p)
      expect(res.status, p).toBe(429)
      expect(res.headers.get('retry-after')).toBe(String(Math.ceil(1 / READ_REFILL_PER_S)))
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
    expect(await (await b.req('/', { headers: JSON_ })).json()).toMatchObject({ error: 'rate_limited', limit: 'public_reads' })
    expect(await body(await b.req('/@myra', { headers: HTML }))).toContain('too many reads from your network.')
    // a neighbour on the same /24 shares it; another network doesn't
    expect((await new Browser(env, '203.0.113.200').get('/')).status).toBe(429)
    expect((await new Browser(env, '198.51.100.7').get('/')).status).toBe(200)
    // refused reads don't dig deeper: a second later there are 2 again
    at(1000)
    expect((await b.get('/')).status).toBe(200)
    expect((await b.get('/@myra')).status).toBe(200)
    expect((await b.get('/')).status).toBe(429)
  })

  it('signed in counts too, and IPv6 groups by /48', async () => {
    const { env } = await world()
    const { b } = await member(env, 'ana', '2001:db8:7:1::5')
    for (let i = 0; i < READ_BURST; i++) takeRead('2001:db8:7:2::9')
    expect((await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML })).status).toBe(429)
    expect((await new Browser(env, '2001:db8:8::1').get('/')).status).toBe(200)
  })

  it('a refused read costs nothing in D1, with or without a cookie', async () => {
    const { env } = await world()
    const { b: signedIn } = await member(env, 'ana')
    const junk = new Browser(env)
    junk.jar.set('__Host-shwarm', 'x'.repeat(43))
    for (const b of [new Browser(env), junk, signedIn]) {
      resetReadLimit()
      for (let i = 0; i < READ_BURST; i++) takeRead(b.ip)
      const seen = watch(env)
      for (const p of [`/w/${EXAMPLE_ROOT}`, `/w/${EXAMPLE_BRANCH}/s/2`, '/', '/@myra']) {
        for (const h of [HTML, JSON_, {}]) {
          const res = await b.req(p, { headers: h })
          expect(res.status).toBe(429)
          if (h === HTML) expect(await body(res)).toContain('too many reads from your network.')
        }
      }
      expect(seen.sql).toEqual([])
      expect(seen.writes).toBe(0)
    }
  })

  it('a repeat 304 costs no D1 row reads, however long the thread; past 15 seconds, one indexed chain query and no writes', async () => {
    const { env, db } = await world()
    const b = new Browser(env)
    const seen = watch(env)
    const nodeId = (db.raw.prepare('SELECT id FROM node WHERE path = ?').get(EXAMPLE_BRANCH) as { id: number }).id
    const anyone = (db.raw.prepare("SELECT id FROM person WHERE handle = 'myra'").get() as { id: number }).id
    const queries: string[][] = []
    let t = 0
    for (const posts of [0, 200]) {
      for (let i = 0; i < posts; i++)
        db.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, links, created_at) VALUES (?, ?, ?, '@myra', 'post', ?, '[]', ?)")
          .run(newId('p'), nodeId, anyone, `post ${i}`, new Date(T0 - (i + 2) * MIN).toISOString())
      const these: string[] = []
      for (const p of [`/w/${EXAMPLE_BRANCH}`, `/w/${EXAMPLE_BRANCH}/s/2`]) {
        for (const h of [HTML, JSON_, {}]) {
          at((t += VERSION_MEMO_MS))
          const first = await b.req(p, { headers: h })
          expect(first.status).toBe(200)
          const etag = first.headers.get('etag')!
          // straight after: answered from the version this isolate just read, with nothing asked of D1
          seen.reset()
          const again = await b.req(p, { headers: { ...h, 'if-none-match': etag } })
          expect(again.status, p).toBe(304)
          expect(again.headers.get('etag')).toBe(etag)
          expect(again.headers.get('cache-control')).toBe('public, s-maxage=15')
          expect(seen.sql).toEqual([])
          expect(seen.writes).toBe(0)
          // a cookie (even a made-up one) means the session must be read first, so it goes to D1
          const junk = new Browser(env)
          junk.jar.set('__Host-shwarm', 'x'.repeat(43))
          expect((await junk.req(p, { headers: { ...h, 'if-none-match': etag } })).status).toBe(304)
          expect(seen.sql.length).toBeGreaterThan(0)
          // 15 seconds on, the version is read again: one query, on the node chain only
          at((t += VERSION_MEMO_MS))
          seen.reset()
          expect((await b.req(p, { headers: { ...h, 'if-none-match': etag } })).status, p).toBe(304)
          expect(seen.sql).toHaveLength(1)
          expect(seen.writes).toBe(0)
          these.push(seen.sql[0])
          // every table it touches is reached through an index: no table is scanned
          const plan = db.raw.prepare('EXPLAIN QUERY PLAN ' + seen.sql[0]).all(...seen.args[0]).map((r: { detail: string }) => r.detail)
          expect(plan.filter((d: string) => /^SCAN /.test(d) && !/^SCAN (json_each VIRTUAL TABLE|CONSTANT ROW|pre$|\(subquery-\d+\))/.test(d))).toEqual([])
          // and what it reads back is the chain: the branch and its shwarm
          expect(db.raw.prepare(seen.sql[0]).all(...seen.args[0])).toHaveLength(2)
          // and that read is trusted again for the next 15 seconds
          seen.reset()
          expect((await b.req(p, { headers: { ...h, 'if-none-match': etag } })).status).toBe(304)
          expect(seen.sql).toEqual([])
        }
      }
      queries.push(these)
    }
    expect(queries[1]).toEqual(queries[0]) // 200 more posts change nothing
  })
})

// ---------- request bodies ----------

describe('request bodies: 256 KB at most', () => {
  const big = 'x'.repeat(256 * 1024 + 1)

  it('a bigger body is refused with 413 before anything reads it, with or without a length', async () => {
    const { env, count } = await world()
    const { b } = await member(env, 'ana')
    const token = formTokenIn(await (await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML })).text())
    const sized = await b.req(`/w/${EXAMPLE_ROOT}`, { form: { form_token: token, do: 'post', text: big } })
    expect(sized.status).toBe(413)
    expect(await body(sized)).toContain('that was more than 256 KB, the most we take at once.')
    // streamed, with no Content-Length: counted as it arrives
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(new TextEncoder().encode(`text=${'y'.repeat(60 * 1024)}&`))
        c.close()
      },
    })
    const res = await app.fetch(
      new Request(`${ORIGIN}/signin`, { method: 'POST', body: stream, duplex: 'half', headers: { origin: ORIGIN, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '203.0.113.9' } } as RequestInit),
      env,
    )
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: 'payload_too_large' })
    expect(count("SELECT COUNT(*) AS n FROM post WHERE text LIKE 'xxxx%'")).toBe(0)
  })

  it('a post at the 20,000-character cap fits inside it, even in 4-byte characters (12 bytes each, form-encoded)', async () => {
    const { env, count } = await world()
    const { b } = await member(env, 'ana')
    expect((await post(b, EXAMPLE_ROOT, '😀'.repeat(20_000))).status).toBe(303)
    expect(count("SELECT COUNT(*) AS n FROM post WHERE text LIKE '😀😀😀%'")).toBe(1)
  })
})
