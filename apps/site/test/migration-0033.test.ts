// Migration 0033 (decided Oct 15, "a passed node's claim is pinned to the top of its thread", and #138's status-change
// notices): applied to a database that has every migration before it. It adds who pinned a post (NULL: the author,
// by hand; 'site') and a status-change notice's new status, and pins the claim the latest crowd pass cites on every
// node that is passed now, unless it's pinned already, a reply or gone.
import { readdirSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'

const mod = 'node:sqlite' // kept out of the Workers type set on purpose
const { DatabaseSync } = (await import(/* @vite-ignore */ mod)) as any
const dir = new URL('../migrations/', import.meta.url)
const T = '2026-10-14T12:00:00.000Z'
const PASSED = '2026-10-14T20:00:00.000Z'
const LATER = '2026-10-15T02:00:00.000Z'
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
const before = files.filter(f => f < '0033')
const m33 = files.find(f => f.startsWith('0033'))!

let db: any
const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args)
const all = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args).map((r: any) => ({ ...r }))

const person = (handle: string) =>
  run(
    `INSERT INTO person (handle, email, email_norm, password_hash, terms_version, terms_accepted_at, age_confirmed_at, created_at)
     VALUES (?, ?, ?, 'pbkdf2-sha256$x', '0.1', ?, ?, ?)`,
    handle, `${handle}@example.org`, `${handle}@example.org`, T, T, T,
  ).lastInsertRowid as number
const node = (path: string, author: number) =>
  run(
    `INSERT INTO node (path, slug, kind, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, triage, created_at)
     VALUES (?, ?, 'shwarm', ?, 'w', 'd', '{"author":false}', 1, 'MIT', ?, '@myra', 'live', 'clear', ?)`,
    path, path, path, author, T,
  ).lastInsertRowid as number
function claim(id: string, nodeId: number, by: number, o: { claim?: string; pinned?: string; reply?: string; hidden?: number; deleted?: string } = {}) {
  run(
    `INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at, claim, pinned_at, reply_to, hidden, deleted_at)
     VALUES (?, ?, ?, '@ana', 'post', 'it works', ?, ?, ?, ?, ?, ?)`,
    id, nodeId, by, T, o.claim ?? 'passed', o.pinned ?? null, o.reply ?? null, o.hidden ?? 0, o.deleted ?? null,
  )
}
const band = (nodeId: number, current: string) =>
  run('INSERT INTO branch_status (node_id, current, challenger, lead_hours, leading_since, changed_at, at) VALUES (?, ?, NULL, 0, NULL, ?, ?)', nodeId, current, PASSED, PASSED)
let n = 0
function pass(nodeId: number, claimId: string | null, at = PASSED, kind = 'crowd') {
  const h = `h_m33${++n}`
  run("INSERT INTO status_change (id, node_id, at, from_status, to_status, claim_id, backers, against, written_at, written_by) VALUES (?, ?, ?, 'on_track', 'passed', ?, 3, 0, ?, 'act')", h, nodeId, at, claimId, at)
  run('INSERT INTO pass_record (id, node_id, kind, status, at, change_id, claim_id, backers) VALUES (?, ?, ?, ?, ?, ?, ?, 3)', `r_m33${n}`, nodeId, kind, 'passed', at, kind === 'crowd' ? h : null, claimId)
}
const stats = (nodeId: number) =>
  run("INSERT INTO node_stats (node_id, impact, posts_per_day, people, hot, score, status_line, upvotes, posts, stale_at, updated_at) VALUES (?, 0, 0, 1, 0, 0, '', 0, 0, NULL, ?)", nodeId, T)

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const f of before) db.exec(readFileSync(new URL(f, dir), 'utf8'))
})

describe('migration 0033 (Oct 15)', () => {
  it("pins the claim the latest crowd pass cites on a passed node, as the site's pin, and nothing else", () => {
    const myra = person('myra')
    const ana = person('ana')
    const doom = node('doom', myra) // passed twice: the newer pass's claim is pinned
    claim('p_doomold01', doom, ana)
    claim('p_doomnew01', doom, ana)
    pass(doom, 'p_doomold01')
    pass(doom, 'p_doomnew01', LATER)
    band(doom, 'passed')
    const hand = node('hand', myra) // its claim was pinned by its author already: it stays theirs
    claim('p_handclm01', hand, ana, { pinned: T })
    pass(hand, 'p_handclm01')
    band(hand, 'passed')
    const moved = node('moved', myra) // passed, then blocked: not passed now, so nothing is pinned
    claim('p_movedcl01', moved, ana)
    pass(moved, 'p_movedcl01')
    band(moved, 'blocked')
    const gone = node('gone', myra) // the cited claim was deleted
    claim('p_goneclm01', gone, ana, { deleted: LATER })
    pass(gone, 'p_goneclm01')
    band(gone, 'passed')
    const authorOnly = node('author-only', myra) // passed by the author's own mark alone (a record migrated in 0032)
    claim('p_authclm01', authorOnly, ana)
    pass(authorOnly, 'p_authclm01', PASSED, 'author')
    band(authorOnly, 'passed')
    for (const x of [doom, hand, moved, gone, authorOnly]) stats(x)

    db.exec(readFileSync(new URL(m33, dir), 'utf8'))

    expect(all('SELECT id, pinned_at, pinned_by FROM post ORDER BY id')).toEqual([
      { id: 'p_authclm01', pinned_at: null, pinned_by: null },
      { id: 'p_doomnew01', pinned_at: LATER, pinned_by: 'site' },
      { id: 'p_doomold01', pinned_at: null, pinned_by: null },
      { id: 'p_goneclm01', pinned_at: null, pinned_by: null },
      { id: 'p_handclm01', pinned_at: T, pinned_by: null },
      { id: 'p_movedcl01', pinned_at: null, pinned_by: null },
    ])
    // the node whose pin changed has its status line rolled up again, and the approved one its card
    expect(all('SELECT node_id FROM node_stats WHERE stale_at IS NOT NULL ORDER BY node_id')).toEqual([{ node_id: doom }, { node_id: authorOnly }])
    expect(all('SELECT DISTINCT author_approved FROM node_stats')).toEqual([{ author_approved: null }])
  })

  it("adds the columns, expand only: who pinned takes only 'site', a notice's status only a status", () => {
    const myra = person('myra')
    const doom = node('doom', myra)
    claim('p_doomclm01', doom, myra)
    run("INSERT INTO inbox_item (person_id, kind, node_id, text, created_at) VALUES (?, 'system', ?, 'old news', ?)", myra, doom, T)
    db.exec(readFileSync(new URL(m33, dir), 'utf8'))
    expect(all('SELECT text, status_to FROM inbox_item')).toEqual([{ text: 'old news', status_to: null }])
    expect(() => run("UPDATE post SET pinned_by = 'myra'")).toThrow()
    expect(() => run("UPDATE inbox_item SET status_to = 'closed'")).toThrow()
    run("UPDATE inbox_item SET status_to = 'dead_end'")
    run("UPDATE post SET pinned_by = 'site', pinned_at = ?", T)
    // nothing dropped or renamed
    expect(all('SELECT COUNT(*) AS n FROM post')[0].n).toBe(1)
    for (const t of ['pinned_at', 'claim', 'reply_to']) expect(all('SELECT name FROM pragma_table_info(?)', 'post').map((c: any) => c.name)).toContain(t)
    expect(all('SELECT name FROM pragma_table_info(?)', 'inbox_item').map((c: any) => c.name)).toEqual(['id', 'person_id', 'kind', 'node_id', 'post_id', 'text', 'created_at', 'read_at', 'done_at', 'status_to'])
  })
})
