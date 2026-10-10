// Go-live 6.1: the owner's inbox on their profile. Nobody else sees it or acts on it; reading an item lowers the
// "for you" count; mark read, unread and all read; the inline reply (as the bare handle, a reply in the thread, paced
// by that thread's limit); sign-off items with their live pill; system items; "waiting on you" on working on and created.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { THREAD_BURST } from '../src/core/limits'
import { INBOX_SHOWN, unreadCount } from '../src/read/inbox'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { addPerson, T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
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
const INBOX_HEAD = '<h2 id="addressed">inbox <span>only you see this</span></h2>'

async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const get = (sql: string, ...args: unknown[]): any => w.db.raw.prepare(sql).get(...args)
  const all = (sql: string, ...args: unknown[]): any[] => w.db.raw.prepare(sql).all(...args).map((r: any) => ({ ...r }))
  return { ...w, env, get, all }
}

/** Signs in as a new verified member, or as an existing (seeded) person given a password here. */
async function signIn(env: ReturnType<typeof testEnv>, handle: string, existing = false) {
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  if (existing)
    env.DB.raw.prepare('UPDATE person SET password_hash = ?, email = ?, email_norm = ?, email_verified_at = ? WHERE handle = ?').run(hash, `${handle}@example.org`, `${handle}@example.org`, new Date(T0).toISOString(), handle)
  else {
    const pid = await addPerson(env.DB, handle, { hash })
    env.DB.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(new Date(T0).toISOString(), pid)
  }
  const b = new Browser(env)
  expect((await b.post('/signin', { email: `${handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}

/** Posts in a thread from the node page's compose box, the way the browser would. */
async function post(b: Browser, path: string, text: string) {
  const token = formTokenIn(await (await b.req(`/w/${path}`, { headers: HTML })).text())
  const res = await b.req(`/w/${path}`, { form: { form_token: token, do: 'post', text } })
  expect(res.status).toBe(303)
}

/** Sends one of the inbox's forms from the owner's profile, with the token from the page. */
async function inboxAct(b: Browser, handle: string, fields: Record<string, string>, at = `/@${handle}`) {
  const token = formTokenIn(await (await b.get(at)).text())
  return b.req(at, { form: { form_token: token, ...fields } })
}

/** The strip's "for you" count as shown (0 when no number shows). */
const forYou = (html: string) => Number(/for you(?:<span class="n">(\d+)<\/span>)?<\/a>/.exec(html)?.[1] ?? 0)
/** One inbox item's markup, by its id. */
const itemOf = (html: string, id: number) => {
  const i = html.indexOf(`id="i${id}"`)
  if (i < 0) return null
  const end = html.indexOf('<div class="c', i + 1)
  return html.slice(i, end < 0 ? html.indexOf('</div></aside>', i) : end)
}

describe('the inbox is private (6.1)', () => {
  it("another person can't see @myra's inbox, and reading an item lowers the count", async () => {
    const { env, get, myraId } = await world()
    const ana = await signIn(env, 'ana')
    await post(ana, EXAMPLE_ROOT, '@myra could you look at my shot list for the demo video before i record?')
    const item = get("SELECT id, read_at FROM inbox_item WHERE person_id = ? AND kind = 'mention' ORDER BY id DESC LIMIT 1", myraId)
    expect(item.read_at).toBeNull()

    const myra = await signIn(env, 'myra', true)
    const before = await unreadCount(env.DB, myraId)
    expect(before).toBeGreaterThan(0)
    const mine = await body(await myra.get('/@myra'))
    expect(mine).toContain(INBOX_HEAD)
    expect(mine).toContain(`<span id="newcount">${before} new</span>`)
    expect(forYou(mine)).toBe(before)
    const entry = itemOf(mine, item.id)!
    expect(entry).toContain('<b><a href="/@ana">@ana</a></b><span class="newb">new</span>')
    expect(entry).toContain('<a class="to" href="/@myra">@myra</a> could you look at my shot list')
    expect(entry).toMatch(/<a href="\/w\/minecraft-in-doom#p_[a-z0-9]+">see thread<\/a>/)
    expect(entry).toContain('<button type="submit">mark read</button>')
    expect(entry).toContain('placeholder="reply as @myra…"')
    expect(entry).toContain(`${THREAD_BURST} quick replies left, then 1 every 5 min`)

    // Not to @ana, not signed out, not to an agent's JSON or text asks of the profile.
    for (const b of [ana, new Browser(env)]) {
      const html = await body(await b.get('/@myra'))
      expect(html).toContain('<h1 class="path">@myra</h1>')
      for (const s of [INBOX_HEAD, 'id="addressed"', 'shot list', 'mark read', 'reply as @myra', 'class="abar"']) expect(html).not.toContain(s)
    }
    // @ana can't act on it: no reading, unreading, replying or clearing @myra's inbox.
    const anaToken = formTokenIn(await (await ana.get('/@ana')).text())
    const forms: Record<string, string>[] = [{ do: 'read', item: String(item.id) }, { do: 'all_read', upto: '999999' }, { do: 'reply', item: String(item.id), text: 'as myra?' }]
    for (const form of forms) {
      const res = await ana.req('/@myra', { form: { form_token: anaToken, ...form } })
      expect(res.status).toBe(403)
    }
    expect(get('SELECT read_at FROM inbox_item WHERE id = ?', item.id).read_at).toBeNull()
    expect(get("SELECT COUNT(*) AS n FROM post WHERE text = 'as myra?'").n).toBe(0)
    // Signed out, the form goes to sign-in and back.
    const out = await new Browser(env).req('/@myra', { form: { do: 'read', item: String(item.id) } })
    expect(out.status).toBe(303)
    expect(out.headers.get('location')).toBe('/signin?next=%2F%40myra')

    // Reading it lowers the count, in the inbox and in the strip on every page.
    const res = await inboxAct(myra, 'myra', { do: 'read', item: String(item.id) })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`/@myra#i${item.id}`)
    expect(await unreadCount(env.DB, myraId)).toBe(before - 1)
    const after = await body(await myra.get('/@myra'))
    expect(forYou(after)).toBe(before - 1)
    expect(forYou(await body(await myra.get('/rules')))).toBe(before - 1)
    expect(itemOf(after, item.id)).not.toContain('class="newb"')
    expect(itemOf(after, item.id)).toContain('<button type="submit">mark unread</button>')
    expect(after).toMatch(new RegExp(`<div class="c" id="i${item.id}">`))
    // a second click on "mark read" changes nothing; "mark unread" puts it back
    await inboxAct(myra, 'myra', { do: 'read', item: String(item.id) })
    expect(await unreadCount(env.DB, myraId)).toBe(before - 1)
    await inboxAct(myra, 'myra', { do: 'unread', item: String(item.id) })
    expect(await unreadCount(env.DB, myraId)).toBe(before)
    expect(itemOf(await body(await myra.get('/@myra')), item.id)).toContain('<span class="newb">new</span>')
  })

  it('mark all read stops at the newest item the page showed', async () => {
    const { env, get, myraId } = await world()
    const ana = await signIn(env, 'ana')
    await post(ana, EXAMPLE_ROOT, '@myra first')
    const myra = await signIn(env, 'myra', true)
    const page = await (await myra.get('/@myra')).text()
    const upto = /name="upto" value="(\d+)"/.exec(page)![1]
    // an item that lands after the page was drawn
    await post(ana, EXAMPLE_ROOT, '@myra second, after the page')
    const late = get("SELECT id FROM inbox_item WHERE person_id = ? ORDER BY id DESC LIMIT 1", myraId).id
    expect(late).toBeGreaterThan(Number(upto))
    const res = await myra.req('/@myra', { form: { form_token: formTokenIn(page), do: 'all_read', upto } })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/@myra#addressed')
    expect(await unreadCount(env.DB, myraId)).toBe(1)
    expect(get('SELECT read_at FROM inbox_item WHERE id = ?', late).read_at).toBeNull()
    await inboxAct(myra, 'myra', { do: 'read', item: String(late) })
    const html = await body(await myra.get('/@myra'))
    expect(html).toContain('<span id="newcount">all read</span>')
    expect(html).not.toContain('mark all read')
    expect(forYou(html)).toBe(0)
  })

  it("an item shows, and counts, only while what it points at shows to its owner", async () => {
    const { env, get, all, myraId } = await world()
    const ana = await signIn(env, 'ana')
    await post(ana, EXAMPLE_ROOT, '@myra a post that gets hidden')
    await post(ana, EXAMPLE_BRANCH, '@myra a post on a branch that gets held')
    const myra = await signIn(env, 'myra', true)
    const items = all("SELECT i.id, i.post_id FROM inbox_item i WHERE i.person_id = ? AND i.kind = 'mention' ORDER BY i.id DESC LIMIT 2", myraId)
    const start = await unreadCount(env.DB, myraId)
    let html = await body(await myra.get('/@myra'))
    for (const i of items) expect(itemOf(html, i.id)).not.toBeNull()

    // A hidden post, a deleted one, and a node held by triage (not hers) take their items off the list and the count.
    env.DB.raw.prepare("UPDATE post SET hidden = 1 WHERE text = '@myra a post that gets hidden'").run()
    env.DB.raw.prepare("UPDATE node SET triage = 'held' WHERE path = ?").run(EXAMPLE_BRANCH)
    html = await body(await myra.get('/@myra'))
    for (const i of items) expect(itemOf(html, i.id)).toBeNull()
    expect(await unreadCount(env.DB, myraId)).toBe(start - 2)
    expect(forYou(html)).toBe(start - 2)
    // and a reply to a mention that doesn't show is refused
    const res = await inboxAct(myra, 'myra', { do: 'reply', item: String(items[0].id), text: 'hello?' })
    expect(res.status).toBe(404)
    // "mark all read" leaves them alone: if they show again, they're still new
    await inboxAct(myra, 'myra', { do: 'all_read', upto: String(items[0].id) })
    for (const i of items) expect(get('SELECT read_at FROM inbox_item WHERE id = ?', i.id).read_at).toBeNull()
    env.DB.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(EXAMPLE_BRANCH)
    expect(itemOf(await body(await myra.get('/@myra')), items[0].id)).toContain('<span class="newb">new</span>') // the branch's
    expect(itemOf(await body(await myra.get('/@myra')), items[1].id)).toBeNull() // the hidden post's
  })

  it('reads the database a fixed few times, however many items', async () => {
    const { env, myraId } = await world()
    const node = env.DB.raw.prepare('SELECT id FROM node WHERE path = ?').get(EXAMPLE_ROOT).id
    const myra = await signIn(env, 'myra', true)
    const mention = (i: number) => {
      env.DB.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES (?, ?, ?, '@myra', 'post', ?, ?)").run(`p_inb${i}xx`, node, myraId, `@myra note ${i}`, new Date(T0 - i * 1000).toISOString())
      env.DB.raw.prepare("INSERT INTO inbox_item (person_id, kind, node_id, post_id, created_at) VALUES (?, 'mention', ?, ?, ?)").run(myraId, node, `p_inb${i}xx`, new Date(T0 - i * 1000).toISOString())
    }
    mention(0)
    const count = async () => {
      const seen: string[] = []
      const prepare = env.DB.prepare.bind(env.DB)
      env.DB.prepare = ((sql: string) => (seen.push(sql), prepare(sql))) as typeof env.DB.prepare
      await myra.get('/@myra')
      env.DB.prepare = prepare
      return seen.length
    }
    const few = await count()
    for (let i = 1; i < 40; i++) mention(i)
    expect(await count()).toBe(few)
    const html = await body(await myra.get('/@myra'))
    expect(html.match(/<div class="c( new)?( signoff)?" id="i\d+">/g)).toHaveLength(INBOX_SHOWN)
    expect(html).toContain('<a href="/@myra?all=1#addressed">show all</a>')
    expect((await body(await myra.get('/@myra?all=1'))).match(/<div class="c( new)?( signoff)?" id="i\d+">/g)!.length).toBeGreaterThanOrEqual(40)
  })
})

describe('the inline reply (6.1)', () => {
  async function mentioned() {
    const w = await world()
    const ana = await signIn(w.env, 'ana')
    await post(ana, EXAMPLE_ROOT, '@myra could you look at my shot list?')
    const item = w.get("SELECT id, post_id FROM inbox_item WHERE person_id = ? AND kind = 'mention' ORDER BY id DESC LIMIT 1", w.myraId)
    const myra = await signIn(w.env, 'myra', true)
    return { ...w, ana, myra, item }
  }

  it('posts as @myra, as a reply in the thread, lands on it, and reads the item', async () => {
    const { env, get, myra, item, myraId } = await mentioned()
    const res = await inboxAct(myra, 'myra', { do: 'reply', item: String(item.id), text: 'yes, send it over.' })
    expect(res.status).toBe(303)
    const reply = get("SELECT id, as_name, reply_to, node_id FROM post WHERE text = 'yes, send it over.'")
    expect(reply).toMatchObject({ as_name: '@myra', reply_to: item.post_id })
    expect(res.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}#${reply.id}`)
    expect(get('SELECT read_at FROM inbox_item WHERE id = ?', item.id).read_at).not.toBeNull()
    // it shows under the post it answers
    const thread = await body(await myra.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))
    expect(thread).toContain(`<div class="c r" id="${reply.id}">`)
    // a double click posts once and goes to the first
    const again = await inboxAct(myra, 'myra', { do: 'reply', item: String(item.id), text: 'yes, send it over.' })
    expect(again.headers.get('location')).toBe(`/w/${EXAMPLE_ROOT}#${reply.id}`)
    expect(get("SELECT COUNT(*) AS n FROM post WHERE text = 'yes, send it over.'").n).toBe(1)
    // the reply spent one of the thread's quick posts, so the next reply box says so
    await inboxAct(myra, 'myra', { do: 'unread', item: String(item.id) })
    expect(itemOf(await body(await myra.get('/@myra')), item.id)).toContain(`${THREAD_BURST - 1} quick replies left, then 1 every 5 min`)
    expect(await unreadCount(env.DB, myraId)).toBeGreaterThan(0)
  })

  it('the same words to two different mentions are two replies, not a double click', async () => {
    const { env, get, all, myra, item } = await mentioned()
    const bo = await signIn(env, 'bo')
    await post(bo, EXAMPLE_ROOT, '@myra question two?')
    const second = get("SELECT id, post_id FROM inbox_item WHERE kind = 'mention' AND id > ? ORDER BY id DESC LIMIT 1", item.id)
    const first = await inboxAct(myra, 'myra', { do: 'reply', item: String(item.id), text: 'yes.' })
    const next = await inboxAct(myra, 'myra', { do: 'reply', item: String(second.id), text: 'yes.' })
    const replies = all("SELECT id, reply_to FROM post WHERE text = 'yes.'")
    expect(replies.map((r: any) => r.reply_to).sort()).toEqual([item.post_id, second.post_id].sort())
    const to = (r: Response) => r.headers.get('location')!.split('#')[1]
    expect(to(first)).toBe(replies.find((r: any) => r.reply_to === item.post_id).id)
    expect(to(next)).toBe(replies.find((r: any) => r.reply_to === second.post_id).id)
  })

  it('an empty reply and the thread limit come back under the item, with the draft kept', async () => {
    const { env, myra, item, myraId, get } = await mentioned()
    const empty = await inboxAct(myra, 'myra', { do: 'reply', item: String(item.id), text: '   ' })
    expect(empty.status).toBe(400)
    const e = itemOf(await body(empty), item.id)!
    expect(e).toContain('<details class="rep" open="">')
    expect(e).toContain('<p class="err" role="alert">write something first.</p>')

    const node = get('SELECT id FROM node WHERE path = ?', EXAMPLE_ROOT).id
    env.DB.raw.prepare('INSERT OR REPLACE INTO rate_bucket (bucket, tokens, updated_at) VALUES (?, 0, ?)').run(`thread:${myraId}:${node}`, new Date(T0).toISOString())
    const slow = await inboxAct(myra, 'myra', { do: 'reply', item: String(item.id), text: 'one too many' })
    expect(slow.status).toBe(429)
    expect(Number(slow.headers.get('retry-after'))).toBeGreaterThan(0)
    const s = itemOf(await body(slow), item.id)!
    expect(s).toContain('slow down: you can post here again in')
    expect(s).toContain('>one too many</textarea>')
    expect(s).toContain('next post in 5 min')
    expect(get("SELECT COUNT(*) AS n FROM post WHERE text = 'one too many'").n).toBe(0)
    expect(get('SELECT read_at FROM inbox_item WHERE id = ?', item.id).read_at).toBeNull()
  })

  it('only mentions take a reply, and only your own', async () => {
    const { env, myra, get, myraId } = await mentioned()
    const other = await addPerson(env.DB, 'zed')
    const node = get('SELECT id FROM node WHERE path = ?', EXAMPLE_ROOT).id
    const theirs = Number(env.DB.raw.prepare("INSERT INTO inbox_item (person_id, kind, node_id, text, created_at) VALUES (?, 'system', ?, 'x', ?)").run(other, node, new Date(T0).toISOString()).lastInsertRowid)
    const system = Number(env.DB.raw.prepare("INSERT INTO inbox_item (person_id, kind, node_id, text, created_at) VALUES (?, 'system', ?, 'minecraft in doom passed on #4.', ?)").run(myraId, node, new Date(T0).toISOString()).lastInsertRowid)
    for (const id of [theirs, system, 0]) expect((await inboxAct(myra, 'myra', { do: 'reply', item: String(id), text: 'hi' })).status, String(id)).toBe(404)
    // marking someone else's item does nothing to it
    await inboxAct(myra, 'myra', { do: 'read', item: String(theirs) })
    expect(get('SELECT read_at FROM inbox_item WHERE id = ?', theirs).read_at).toBeNull()
    // a system item: core's words, "open" to the node, no reply
    const html = await body(await myra.get('/@myra'))
    const sys = itemOf(html, system)!
    expect(sys).toContain('<div class="txt">minecraft in doom passed on #4.</div>')
    expect(sys).toContain(`<a href="/w/${EXAMPLE_ROOT}">open</a>`)
    expect(sys).not.toContain('reply')
    expect((await inboxAct(myra, 'myra', { do: 'nothing' })).status).toBe(400)
  })

  it('an ended thread, or one under an ended shwarm, is locked: no reply box (decided Oct 9)', async () => {
    const { env, ana, myra, item, get } = await mentioned()
    await post(ana, EXAMPLE_BRANCH, '@myra one on the branch too')
    const onBranch = get("SELECT id FROM inbox_item WHERE kind = 'mention' AND id > ? ORDER BY id DESC LIMIT 1", item.id)
    const before = await body(await myra.get('/@myra'))
    for (const id of [item.id, onBranch.id]) expect(itemOf(before, id)).toContain('value="reply"')
    for (const state of ['closed', 'dead_end']) {
      env.DB.raw.prepare("UPDATE node SET state = ?, dead_end_note = 'x' WHERE path = ?").run(state, EXAMPLE_ROOT)
      const html = await body(await myra.get('/@myra'))
      for (const id of [item.id, onBranch.id]) {
        const e = itemOf(html, id)!
        expect(e, `${state} ${id}`).toContain('see thread')
        expect(e, `${state} ${id}`).not.toContain('value="reply"')
        expect(e, `${state} ${id}`).not.toContain('<textarea')
      }
    }
    // a reply sent anyway (a stale page) is refused, and nothing is written
    const res = await inboxAct(myra, 'myra', { do: 'reply', item: String(onBranch.id), text: 'late reply' })
    expect(res.status).toBe(400)
    expect(itemOf(await body(res), onBranch.id)).toContain(`${EXAMPLE_ROOT} is a dead end. it's locked: it takes nothing new.`)
    expect(get("SELECT COUNT(*) AS n FROM post WHERE text = 'late reply'").n).toBe(0)
  })
})

describe('sign-off items and "waiting on you" (6.1, PROF-9)', () => {
  it("@bmo_fan's sign-off item has a live pill, opens the submission, and the node says waiting on you", async () => {
    const { env, get } = await world()
    const bmo = await signIn(env, 'bmo_fan', true)
    const pid = get("SELECT id FROM person WHERE handle = 'bmo_fan'").id
    const item = get("SELECT id, post_id FROM inbox_item WHERE person_id = ? AND kind = 'sign_off'", pid)
    const S2 = `/w/${EXAMPLE_BRANCH}/s/2`
    let html = await body(await bmo.get('/@bmo_fan'))
    let entry = itemOf(html, item.id)!
    expect(html).toContain(`<div class="c new signoff" id="i${item.id}">`)
    expect(entry).toContain('<span class="stp wait">waiting on you</span><span class="newb">new</span>')
    expect(entry).toContain(`<a href="${S2}"><b>block placement · submission #2</b></a> by @myra/m-07 passed its other checks and needs your sign-off.`)
    expect(entry).toContain(`<a href="${S2}">open</a>`)
    for (const s of ['>pass<', '>fail<', 'sign off as']) expect(entry).not.toContain(s) // the author decides only on the submission page
    expect(html).toMatch(/>block placement<\/a><div class="sub">branch of minecraft in doom · done when [^<]+<\/div><\/div><span class="st live">waiting on you<\/span>/)
    expect(html).toMatch(/>block placement<\/a><span class="sub">minecraft in doom · waiting on you · last post/)
    expect((await bmo.req(S2, { headers: HTML })).status).toBe(200)
    // nobody else sees "waiting on you" on bmo's profile
    for (const b of [new Browser(env), await signIn(env, 'ana')]) expect(await body(await b.get('/@bmo_fan'))).not.toContain('waiting on you')

    // The pill follows the submission: approved on a pass, failed on a fail; the node stops waiting.
    env.DB.raw.prepare("UPDATE submission SET status = 'passed' WHERE post_id = ?").run(item.post_id)
    env.DB.raw.prepare("UPDATE node SET state = 'closed', in_review = 0 WHERE path = ?").run(EXAMPLE_BRANCH)
    env.DB.raw.prepare('UPDATE inbox_item SET done_at = ? WHERE id = ?').run(new Date(T0).toISOString(), item.id)
    html = await body(await bmo.get('/@bmo_fan'))
    expect(itemOf(html, item.id)).toContain('<span class="stp ok">approved</span>')
    expect(html).not.toContain('waiting on you')
    env.DB.raw.prepare("UPDATE submission SET status = 'failed' WHERE post_id = ?").run(item.post_id)
    env.DB.raw.prepare("UPDATE node SET state = 'live' WHERE path = ?").run(EXAMPLE_BRANCH)
    expect(itemOf(await body(await bmo.get('/@bmo_fan')), item.id)).toContain('<span class="stp no">failed</span>')
    // reading it lowers bmo's count
    const n = await unreadCount(env.DB, pid)
    await inboxAct(bmo, 'bmo_fan', { do: 'read', item: String(item.id) })
    expect(await unreadCount(env.DB, pid)).toBe(n - 1)
  })

  it('an author-only sign-off and the operator\'s say what is true for them', async () => {
    const { env, get, myraId } = await world()
    const pid = get("SELECT id FROM person WHERE handle = 'bmo_fan'").id
    const item = get("SELECT id, node_id, post_id FROM inbox_item WHERE person_id = ? AND kind = 'sign_off'", pid)
    // the author is the only check: nothing else passed before them
    env.DB.raw.prepare(`UPDATE node SET checks = '{"author":true}' WHERE id = ?`).run(item.node_id)
    const bmo = await signIn(env, 'bmo_fan', true)
    expect(itemOf(await body(await bmo.get('/@bmo_fan')), item.id)).toContain('</b></a> by @myra/m-07 needs your sign-off.')
    // author gone: the operator's own item for the same submission
    const op = Number(
      env.DB.raw.prepare("INSERT INTO inbox_item (person_id, kind, node_id, post_id, text, created_at) VALUES (?, 'sign_off', ?, ?, '', ?)").run(myraId, item.node_id, item.post_id, new Date(T0).toISOString()).lastInsertRowid,
    )
    env.DB.raw.prepare("UPDATE person SET status = 'suspended' WHERE id = ?").run(pid)
    env.DB.raw.prepare('UPDATE person SET is_admin = 1 WHERE id = ?').run(myraId)
    const myra = await signIn(env, 'myra', true)
    let html = await body(await myra.get('/@myra'))
    let entry = itemOf(html, op)!
    expect(entry).toContain("by @myra/m-07 needs a sign-off. its author's account is gone, so you sign off as the operator.")
    expect(entry).toContain('<span class="stp wait">waiting on you</span>')
    expect(html).toMatch(/>block placement<\/a><span class="sub">minecraft in doom · waiting on you · last post/)

    // The author is back before signing: the sign-off is theirs again (core and the submission page refuse the operator),
    // so the operator's item and rows stop saying it waits on them.
    env.DB.raw.prepare("UPDATE person SET status = 'active' WHERE id = ?").run(pid)
    html = await body(await myra.get('/@myra'))
    entry = itemOf(html, op)!
    expect(entry).toContain('<span class="stp wait">waiting on author</span>')
    expect(entry).toContain("by @myra/m-07 needs its author's sign-off.")
    expect(entry).not.toContain('operator')
    expect(html).not.toContain('waiting on you')
    // the same while the author is still gone but the item's owner is no longer an admin
    env.DB.raw.prepare("UPDATE person SET status = 'closed' WHERE id = ?").run(pid)
    env.DB.raw.prepare('UPDATE person SET is_admin = 0 WHERE id = ?').run(myraId)
    html = await body(await myra.get('/@myra'))
    expect(itemOf(html, op)).toContain('<span class="stp wait">waiting on author</span>')
    expect(html).not.toContain('waiting on you')
  })
})
