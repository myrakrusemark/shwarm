// Go-live 6.3 (and the 4.4 kickoff mail): notice emails through the outbox. A mention of the bare handle is mailed at
// once to people who asked for inbox mail right away, and goes in the daily digest for everyone else. No lobby fills
// (Oct 9), and no change of status is mailed (Oct 14: the author's notice of a pass is an inbox item only). Every mail
// is written in the act's batch, honours the notice settings and the one-click unsubscribe, and goes only while what
// it's about still shows to its reader.
import { describe, expect, it } from 'vitest'
import { digestDue, DIGEST_HOUR_UTC, sweepDigests } from '../src/jobs/digest'
import { closeAccount } from '../src/auth/close'
import { sweepOutbox, TRIAGE_RECHECK_MS, TRIAGE_WAIT_MS } from '../src/jobs/mail'
import { DIGEST_ITEMS, MailRenderError, renderMail } from '../src/email/templates'
import { readUnsubToken } from '../src/email/unsubscribe'
import { agent, DAY, HOUR, MIN, person, site, World, type P } from './core-fixtures'
import { T0 } from './d1'

const SITE = 'https://shwarm.org'
const notice = (label: string) => ({ siteUrl: SITE, stream: 'notices' as const, unsubscribe: { url: `${SITE}/unsubscribe?t=x`, label } })
const lower = (s: string) => s.replace(/https:\S+/g, '')

type Row = { id: number; to_email: string; person_id: number | null; template: string; stream: string; payload: any; last_error: string | null; sent_at: string | null }
const outbox = (w: World, template?: string): Row[] =>
  w.all(`SELECT * FROM email_outbox ${template ? 'WHERE template = ?' : ''} ORDER BY id`, ...(template ? [template] : [])).map(r => ({ ...r, payload: JSON.parse(r.payload) }))
const prefs = (w: World, p: P, v: Record<string, unknown>) => w.db.raw.prepare('UPDATE person SET notice_prefs = ? WHERE id = ?').run(JSON.stringify(v), p.id)
const clear = (w: World, path: string) => w.db.raw.prepare("UPDATE node SET triage = 'clear' WHERE path = ?").run(path)

/** A sweep with a fake Resend: returns what it sent. */
async function sweep(w: World, now = w.now) {
  const sent: any[] = []
  const f = (async (_u: string, init: RequestInit) => (sent.push(JSON.parse(String(init.body))), new Response(`{"id":"re_${sent.length}"}`, { status: 200 }))) as unknown as typeof fetch
  const r = await sweepOutbox({ DB: w.db, ENV: 'production', SITE_URL: SITE, RESEND_API_KEY: 're_key', MAIL_SECRET: 'mail-secret' } as any, { now, fetch: f })
  return { ...r, mails: sent }
}

/** @myra's live shwarm (live at once, cleared by triage), with @ana and @bob around. */
async function live() {
  const w = new World()
  const myra = await person(w.db, 'myra')
  const ana = await person(w.db, 'ana')
  const bob = await person(w.db, 'bob')
  const { path } = await w.shwarm(site(myra))
  clear(w, path)
  return { w, myra, ana, bob, path }
}

describe('the templates (6.3, 4.4)', () => {
  it('a mention: who, where, the post quoted line by line, and its link', () => {
    const m = renderMail('mention', { notice: 'mention', handle: 'bob', by: '@ana/m-04', title: 'minecraft in doom', link: '/w/minecraft-in-doom#p_1', text: 'look at this\n> not a quote of ours', cut: false }, notice('mention'))
    expect(m.subject).toBe('@ana/m-04 mentioned you on minecraft in doom')
    expect(m.text).toContain('hi @bob,\n\n@ana/m-04 mentioned you on minecraft in doom:\n\n@ana/m-04 wrote:\n> look at this\n> > not a quote of ours\n\nreply in its thread:')
    expect(m.text).toContain(`${SITE}/w/minecraft-in-doom#p_1`)
    expect(m.text).toContain('you get this because mention mails are on. turn them off here:')
    expect(renderMail('mention', { by: '@ana', title: 't', link: '/w/t#p_1', text: 'x', cut: true }, notice('mention')).text).toContain('the post goes on. read it all and reply in its thread:')
    // names and titles can't carry headers or markup; links stay on the site
    const bad = renderMail('mention', { by: 'ana\r\nBcc: x@evil.example', title: 'doom\r\nBcc: y <img src=x>', link: '/w/t#p_1', text: '<script>' }, notice('mention'))
    expect(bad.subject).toBe('someone mentioned you on doom Bcc: y <img src=x>')
    expect(bad.html).not.toMatch(/<img|<script/)
    expect(() => renderMail('mention', { by: '@ana', title: 't', link: 'https://evil.example/x', text: 'x' }, notice('mention'))).toThrow(MailRenderError)
    expect(() => renderMail('mention', { by: '@ana', title: 't', link: '/w/t' }, notice('mention'))).toThrow(MailRenderError)
  })

  it('the digest: each mention with its link, "and N more" past the cap, the inbox link', () => {
    const items = [
      { by: '@ana', title: 'minecraft in doom', link: '/w/minecraft-in-doom#p_1', text: 'first' },
      { by: 'former member', title: 'block placement', link: '/w/minecraft-in-doom/block-placement#p_2', text: 'x'.repeat(500) },
    ]
    const m = renderMail('digest', { notice: 'mention', handle: 'bob', items, more: 3 }, notice('mention'))
    expect(m.subject).toBe('you were mentioned 5 times on shwarm')
    expect(m.text).toContain('you were mentioned 5 times since your last digest:')
    expect(m.text).toContain('@ana on minecraft in doom:\n\n@ana wrote:\n> first')
    expect(m.text).toContain('former member on block placement:')
    expect(m.text).toContain('x'.repeat(300) + ' …')
    expect(m.text).not.toContain('x'.repeat(301))
    expect(m.text).toContain(`and 3 more in your inbox:\n\n${SITE}/@bob#addressed`)
    expect(m.text).toContain('this digest comes once a day. you can get each mention right away instead, in your account.')
    const one = renderMail('digest', { handle: 'bob', items: items.slice(0, 1), more: 0 }, notice('mention'))
    expect(one.subject).toBe('you were mentioned on shwarm')
    expect(one.text).toContain('you were mentioned once since your last digest:')
    expect(one.text).not.toContain('more in your inbox')
    expect(() => renderMail('digest', { handle: 'bob', items: [] }, notice('mention'))).toThrow(MailRenderError)
  })

  it('the kickoff, reopened and passes-or-fails mails are gone (Oct 9; Oct 15, #138)', () => {
    expect(() => renderMail('kickoff', { handle: 'bob', title: 'minecraft in doom', link: '/w/minecraft-in-doom', seats: 2 }, notice('kickoff'))).toThrow(MailRenderError)
    for (const event of ['passed', 'failed', 'reopened'])
      expect(() => renderMail('node_news', { handle: 'bob', title: 'minecraft in doom', link: '/w/minecraft-in-doom/s/2', event, number: 2 }, notice('pass_fail'))).toThrow(MailRenderError)
  })

  it('the closing mail is security mail with no link', () => {
    const m = renderMail('account_closed', { handle: 'bob' }, { siteUrl: SITE, stream: 'security' })
    expect(m.subject).toBe('your shwarm account is closed')
    expect(m.text).toContain('shown as by a former member.')
    expect(m.text).not.toMatch(/https:\/\/shwarm\.org\/\S/)
    expect(m.text).not.toContain('turn them off')
  })
})

describe('mentions (6.3)', () => {
  it('right away only for those who asked; the digest crowd, agent names and yourself get no mail of their own', async () => {
    const { w, myra, ana, bob, path } = await live()
    prefs(w, bob, { inbox_every: 'now' })
    await w.post(site(ana), path, '@bob and @myra, have a look. @bob/m-04 too. @nobody_here as well.')
    await w.post(site(bob), path, 'noted, @bob.') // naming yourself as the bare handle
    const rows = outbox(w, 'mention')
    expect(rows).toHaveLength(1) // bob (right away), not myra (the digest, the default)
    expect(rows[0]).toMatchObject({ to_email: 'bob@example.org', person_id: bob.id, stream: 'notices' })
    const post = w.get("SELECT id FROM post WHERE as_name = '@ana'").id
    expect(rows[0].payload).toEqual({
      notice: 'mention', handle: 'bob', by: '@ana', title: 'minecraft in doom', path, post, link: `/w/${path}#${post}`,
      text: '@bob and @myra, have a look. @bob/m-04 too. @nobody_here as well.', cut: false,
    })
    // both still get the inbox item, as before
    expect(w.all("SELECT person_id FROM inbox_item WHERE kind = 'mention' ORDER BY person_id").map(r => r.person_id)).toEqual([myra.id, bob.id])
    // mentions turned off: no mail, even right away
    prefs(w, bob, { inbox_every: 'now', mention: false })
    await w.post(site(ana), path, '@bob again')
    expect(outbox(w, 'mention')).toHaveLength(1)
    void myra
  })

  it('a long post is quoted up to 1000 characters; a claim mails its mentions too', async () => {
    const { w, ana, bob, path } = await live()
    prefs(w, bob, { inbox_every: 'now' })
    await w.post(agent(ana), path, '@bob ' + 'é'.repeat(1200))
    const [m] = outbox(w, 'mention')
    expect(m.payload.by).toBe('@ana/m-04')
    expect([...m.payload.text]).toHaveLength(1000)
    expect(m.payload.cut).toBe(true)
    await w.join(site(ana), path)
    await w.post(site(ana), path, '@bob, this fails on corner 3', { claim: 'blocked' })
    expect(outbox(w, 'mention').map(r => r.payload.text)).toEqual(['@bob ' + 'é'.repeat(995), '@bob, this fails on corner 3'])
  })

  it('the sweep sends it, and skips it once the post is deleted or the node no longer shows to them', async () => {
    const { w, ana, bob, path } = await live()
    prefs(w, bob, { inbox_every: 'now' })
    await w.post(site(ana), path, '@bob one')
    let r = await sweep(w)
    expect(r).toMatchObject({ sent: 1, skipped: 0 })
    expect(r.mails[0]).toMatchObject({ to: ['bob@example.org'], subject: '@ana mentioned you on minecraft in doom' })
    expect(r.mails[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    const token = /unsubscribe\?t=([^>]+)>/.exec(r.mails[0].headers['List-Unsubscribe'])![1]
    expect(await readUnsubToken('mail-secret', token, w.now)).toEqual({ personId: bob.id, type: 'mention' })

    const { id } = await w.post(site(ana), path, '@bob two')
    await w.run({ type: 'deletePost', actor: site(ana), input: { node: path, post: id } })
    w.tick(MIN)
    expect(await sweep(w)).toMatchObject({ sent: 0, skipped: 1 })
    await w.post(site(ana), path, '@bob three')
    w.db.raw.prepare("UPDATE node SET triage = 'blocked' WHERE path = ?").run(path)
    w.tick(MIN)
    expect(await sweep(w)).toMatchObject({ sent: 0, skipped: 1 })
    expect(outbox(w, 'mention').slice(1).map(m => m.last_error)).toEqual(['skipped: its post is gone', "skipped: its node doesn't show to them"])
  })

  it('names a mentioner whose account closed before it went as a former member', async () => {
    const { w, ana, bob, path } = await live()
    prefs(w, bob, { inbox_every: 'now' })
    await w.post(agent(ana), path, '@bob from the agent')
    await w.post(site(ana), path, '@bob from ana')
    await closeAccount(w.db, ana.id, w.now)
    w.tick(MIN)
    const notices = (await sweep(w)).mails.filter(m => m.subject !== 'your shwarm account is closed')
    expect(notices.map(m => m.subject)).toEqual(['former member mentioned you on minecraft in doom', 'former member mentioned you on minecraft in doom'])
    expect(notices.map(m => m.text).join('\n')).not.toMatch(/@ana/)
  })

  it('waits while its node is still being checked, and goes once triage clears it', async () => {
    const w = new World()
    const ana = await person(w.db, 'ana')
    const bob = await person(w.db, 'bob')
    prefs(w, bob, { inbox_every: 'now' })
    const { path } = await w.shwarm(site(ana)) // 'pending': only ana sees it
    await w.post(site(ana), path, '@bob look at this')
    w.tick(MIN)
    expect(await sweep(w)).toMatchObject({ sent: 0, skipped: 0, retrying: 1 })
    const [row] = w.all("SELECT attempts, sent_at, send_after, last_error FROM email_outbox WHERE template = 'mention'")
    expect(row).toMatchObject({ attempts: 0, sent_at: null, last_error: 'waiting: its node is still being checked', send_after: new Date(w.now + TRIAGE_RECHECK_MS).toISOString() })
    w.db.raw.prepare("UPDATE node SET triage = 'held' WHERE path = ?").run(path) // held for Myra: still not gone
    w.tick(TRIAGE_RECHECK_MS)
    expect(await sweep(w)).toMatchObject({ sent: 0, skipped: 0, retrying: 1 })
    clear(w, path)
    w.tick(TRIAGE_RECHECK_MS)
    const r = await sweep(w)
    expect(r).toMatchObject({ sent: 1, skipped: 0 })
    expect(r.mails[0]).toMatchObject({ to: ['bob@example.org'], subject: '@ana mentioned you on minecraft in doom' })

    // one that waits past TRIAGE_WAIT_MS is skipped
    w.db.raw.prepare("UPDATE node SET triage = 'held' WHERE path = ?").run(path)
    await w.post(site(ana), path, '@bob again')
    w.tick(TRIAGE_WAIT_MS)
    expect(await sweep(w)).toMatchObject({ sent: 0, skipped: 1 })
    expect(outbox(w, 'mention')[1].last_error).toBe("skipped: its node doesn't show to them")
  })
})

describe('the daily digest (6.3)', () => {
  it('once a day at the digest time: the unread mentions of the day before, not those read, deleted or hidden', async () => {
    const { w, ana, bob, myra, path } = await live()
    // T0 is 12:00 UTC; the digest time is 15:00 UTC.
    expect(DIGEST_HOUR_UTC).toBe(15)
    expect(new Date(digestDue(T0)).toISOString()).toBe('2026-10-07T15:00:00.000Z')
    expect(new Date(digestDue(T0 + 3 * HOUR)).toISOString()).toBe('2026-10-08T15:00:00.000Z')
    await w.post(site(ana), path, '@bob first')
    w.tick(MIN)
    const read = await w.post(site(ana), path, '@bob read on the site')
    w.db.raw.prepare('UPDATE inbox_item SET read_at = ? WHERE post_id = ?').run(new Date(w.now).toISOString(), read.id)
    w.tick(MIN)
    const gone = await w.post(site(ana), path, '@bob deleted')
    await w.run({ type: 'deletePost', actor: site(ana), input: { node: path, post: gone.id } })
    w.tick(MIN)
    await w.post(site(myra), path, '@bob second, from the author')
    // before the digest time: yesterday's window, which holds none of these
    expect(await sweepDigests(w.db, w.now)).toEqual({ sent: 0, passed: 0 })
    const at = T0 + 3 * HOUR + MIN
    expect(await sweepDigests(w.db, at)).toEqual({ sent: 1, passed: 0 })
    expect(await sweepDigests(w.db, at + MIN)).toEqual({ sent: 0, passed: 0 }) // once a day
    const [d] = outbox(w, 'digest')
    expect(d).toMatchObject({ to_email: 'bob@example.org', person_id: bob.id, stream: 'notices' })
    expect(d.payload.notice).toBe('mention')
    expect(d.payload.more).toBe(0)
    expect(d.payload.items.map((i: any) => [i.by, i.text])).toEqual([['@ana', '@bob first'], ['@myra', '@bob second, from the author']])
    expect(d.payload.items[0].link).toMatch(new RegExp(`^/w/${path}#p_\\w+$`))
    expect(w.get('SELECT digest_at FROM person WHERE id = ?', bob.id).digest_at).toBe('2026-10-08T15:00:00.000Z')
    const r = await sweep(w, at + MIN)
    expect(r.mails.map(m => m.subject)).toEqual(['you were mentioned 2 times on shwarm'])
    // a mention after the digest time waits for tomorrow's
    w.now = at + HOUR
    await w.post(site(ana), path, '@bob tomorrow')
    expect(await sweepDigests(w.db, at + 2 * HOUR)).toEqual({ sent: 0, passed: 0 })
    expect(await sweepDigests(w.db, at + DAY)).toEqual({ sent: 1, passed: 0 })
    expect(outbox(w, 'digest')[1].payload.items.map((i: any) => i.text)).toEqual(['@bob tomorrow'])
  })

  it('skips those who take mentions right away or turned them off; caps the items; passes over a node gone from view', async () => {
    const { w, ana, bob, myra, path } = await live()
    const cy = await person(w.db, 'cy')
    prefs(w, bob, { inbox_every: 'now' })
    prefs(w, cy, { mention: false })
    for (let i = 0; i < DIGEST_ITEMS + 2; i++) {
      await w.post(site(ana), path, `@myra @bob @cy number ${i}`)
      w.tick(5 * MIN) // the thread's posting pace
    }
    const at = T0 + 3 * HOUR + MIN
    expect(await sweepDigests(w.db, at)).toEqual({ sent: 1, passed: 0 })
    const [d] = outbox(w, 'digest')
    expect(d.person_id).toBe(myra.id)
    expect(d.payload.items).toHaveLength(DIGEST_ITEMS)
    expect(d.payload.more).toBe(2)
    // a held node's mentions don't show in the inbox, so they aren't mailed; the person is passed over for the day
    const w2 = await live()
    await w2.w.post(site(w2.ana), w2.path, '@bob look')
    w2.w.db.raw.prepare("UPDATE node SET triage = 'held' WHERE path = ?").run(w2.path)
    expect(await sweepDigests(w2.w.db, at)).toEqual({ sent: 0, passed: 1 })
    expect(await sweepDigests(w2.w.db, at + MIN)).toEqual({ sent: 0, passed: 0 })
    void bob
  })
})

describe('no kickoff (decided Oct 9), and no mail on a change of status (Oct 14)', () => {
  it('starting and joining a shwarm mail no one', async () => {
    const w = new World()
    const myra = await person(w.db, 'myra')
    const ana = await person(w.db, 'ana')
    const { path } = await w.shwarm(site(myra))
    await w.join(site(ana), path)
    await w.join(site(await person(w.db, 'cy')), path)
    expect(w.all('SELECT template FROM email_outbox')).toEqual([])
    expect(w.all('SELECT 1 FROM inbox_item')).toEqual([])
  })

  it('a change of status mails no one, an old pass and fail setting or not; the author gets the approve notice, the people who joined a status notice (Oct 14, Oct 15)', async () => {
    const { w, myra, ana, bob, path } = await live()
    for (const p of [myra, ana, bob]) prefs(w, p, { pass_fail: true, inbox_every: 'now' })
    await w.join(site(ana), path)
    await w.join(site(bob), path)
    const c = await w.post(site(ana), path, 'all nine maps play through from a pistol start.', { claim: 'passed' })
    await w.run({ type: 'back', actor: site(bob), input: { node: path, post: c.id, on: true } })
    w.tick(DAY)
    await w.run({ type: 'status', actor: site(myra), input: { node: path, status: 'on_track' } }) // saves the change to passed
    expect(w.all('SELECT to_status FROM status_change')).toEqual([{ to_status: 'passed' }])
    expect(w.all("SELECT person_id, status_to FROM inbox_item WHERE kind = 'system' ORDER BY id")).toEqual([
      { person_id: myra.id, status_to: null },
      { person_id: ana.id, status_to: 'passed' },
      { person_id: bob.id, status_to: 'passed' },
    ])
    expect(outbox(w)).toEqual([])
  })
})
