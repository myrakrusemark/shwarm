// Go-live 9.4, the review's findings: an admin act writes exactly one moderation_action row even when its form is sent
// twice (a double click sends both before either lands), a stale "remove this link" form never takes a different link,
// and a suspension moves the site-wide moderation version (a suspended account leaves the agent view's DM list).
import { describe, expect, it } from 'vitest'
import { accountAct, newOnce } from '../src/core/admin-accounts'
import { actOnNode, actOnPost, AdminError, resolveReport } from '../src/core/admin-content'
import { EXAMPLE_BRANCH } from '../src/seed/example'
import { addPerson, T0 } from './d1'
import { stagingWorld } from './node-fixture'

const iso = (ms: number) => new Date(ms).toISOString()
const POST = 'p_adminonce01'
const ONE = { url: 'https://codeberg.org/ana/one', sha256: 'a'.repeat(64) }
const TWO = { url: 'https://bad.example/two', sha256: 'b'.repeat(64) }

async function world() {
  const w = await stagingWorld()
  const raw = w.db.raw
  raw.prepare('UPDATE person SET is_admin = 1 WHERE id = ?').run(w.myraId)
  const ana = await addPerson(w.db, 'ana')
  raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(iso(T0), ana)
  const branch = (raw.prepare('SELECT id FROM node WHERE path = ?').get(EXAMPLE_BRANCH) as { id: number }).id
  raw
    .prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, links, created_at) VALUES (?, ?, ?, '@ana', 'post', 'look', ?, ?)")
    .run(POST, branch, ana, JSON.stringify([ONE, TWO]), iso(T0 - 60_000))
  raw.prepare("INSERT INTO report (post_id, url, person_id, kind, reason, text, created_at) VALUES (?, 'x', ?, 'abuse', 'spam', 'ad', ?)").run(POST, ana, iso(T0))
  const report = (raw.prepare('SELECT id FROM report').get() as { id: number }).id
  const rows = (action: string) => (raw.prepare('SELECT COUNT(*) AS n FROM moderation_action WHERE action = ?').get(action) as { n: number }).n
  const by = { personId: w.myraId, handle: 'myra' }
  return { ...w, raw, ana, branch, report, rows, by }
}

/** Both sends of one form, the second read before the first lands; the refusals a late one may get are fine. */
const twice = (f: () => Promise<unknown>) => Promise.allSettled([f(), f()])

describe('a form sent twice at once writes one row', () => {
  it('hiding a node', async () => {
    const w = await world()
    await twice(() => actOnNode(w.db, w.by, EXAMPLE_BRANCH, 'hide', { reason: 'spam' }, T0))
    expect(w.rows('hide')).toBe(1)
  })

  it('hiding a post', async () => {
    const w = await world()
    await twice(() => actOnPost(w.db, w.by, POST, 'hide', { reason: 'spam' }, T0))
    expect(w.rows('hide')).toBe(1)
  })

  it('removing a link', async () => {
    const w = await world()
    await twice(() => actOnPost(w.db, w.by, POST, 'remove_link', { link: '0', was: JSON.stringify(ONE), reason: 'malware' }, T0))
    expect(w.rows('remove_link')).toBe(1)
  })

  it('clearing triage', async () => {
    const w = await world()
    w.raw.prepare("UPDATE node SET triage = 'held' WHERE id = ?").run(w.branch)
    const r = await twice(() => actOnNode(w.db, w.by, EXAMPLE_BRANCH, 'clear', { reason: 'fine' }, T0))
    expect(w.rows('clear_triage')).toBe(1)
    expect((w.raw.prepare("SELECT COUNT(*) AS n FROM triage_decision WHERE model = 'myra'").get() as { n: number }).n).toBe(1)
    // The late one is told, not thrown at.
    for (const x of r) if (x.status === 'rejected') expect(x.reason).toBeInstanceOf(AdminError)
  })

  it('resolving a report', async () => {
    const w = await world()
    await twice(() => resolveReport(w.db, w.by, w.report, { reason: 'handled' }, T0))
    expect(w.rows('resolve_report')).toBe(1)
  })

  it('resolving flags', async () => {
    const w = await world()
    w.raw.prepare('INSERT INTO flag (node_id, post_id, person_id, reason, created_at) VALUES (?, NULL, ?, ?, ?)').run(w.branch, w.ana, 'spam', iso(T0))
    await twice(() => actOnNode(w.db, w.by, EXAMPLE_BRANCH, 'resolve_flags', { flag: 'all', reason: 'fine' }, T0))
    expect(w.rows('resolve_flag')).toBe(1)
  })
})

describe('remove a link', () => {
  it('a stale form (sent again after the first landed) never takes the next link', async () => {
    const w = await world()
    const form = { link: '0', was: JSON.stringify(ONE), reason: 'malware' }
    await actOnPost(w.db, w.by, POST, 'remove_link', form, T0)
    await expect(actOnPost(w.db, w.by, POST, 'remove_link', form, T0 + 1000)).rejects.toBeInstanceOf(AdminError)
    expect(JSON.parse((w.raw.prepare('SELECT links FROM post WHERE id = ?').get(POST) as { links: string }).links)).toEqual([TWO])
    expect(w.rows('remove_link')).toBe(1)
  })

  it('needs the link it was shown', async () => {
    const w = await world()
    await expect(actOnPost(w.db, w.by, POST, 'remove_link', { link: '0', reason: 'malware' }, T0)).rejects.toBeInstanceOf(AdminError)
    expect(w.rows('remove_link')).toBe(0)
  })
})

describe('suspend', () => {
  it('moves the site-wide moderation version, as closing an account does, and so does lifting it', async () => {
    const w = await world()
    const moderated = () => (w.raw.prepare("SELECT value FROM setting WHERE key = 'moderated_at'").get() as { value: string } | undefined)?.value ?? null
    const before = moderated()
    const base = { by: w.myraId, personId: w.ana, reason: 'spam', origin: 'https://example.org' }
    expect(await accountAct(w.db, { ...base, act: 'suspend', once: newOnce(), now: T0 })).toEqual({ ok: true })
    const mid = moderated()
    expect(mid).not.toBe(before)
    expect(await accountAct(w.db, { ...base, act: 'unsuspend', once: newOnce(), now: T0 + 1000 })).toEqual({ ok: true })
    expect(moderated()).not.toBe(mid)
  })
})
