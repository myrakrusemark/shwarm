// Migration 0032's data steps (decided Oct 14, "One model for every node" and "With nothing locking: build on any
// shwarm, a pass box in place of the result page"): applied to a database that has every migration before it, with rows
// as they stood: a shwarm that passed on its second submission (its branch frozen under it, with a band leading), a
// shwarm marked a dead end, a live shwarm with a submission in review waiting on its author's sign-off and the mail
// for it queued, and one sent before.
import { readdirSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'

const mod = 'node:sqlite' // kept out of the Workers type set on purpose
const { DatabaseSync } = (await import(/* @vite-ignore */ mod)) as any
const dir = new URL('../migrations/', import.meta.url)
const T = '2026-10-13T12:00:00.000Z'
const CLOSED = '2026-10-09T18:00:00.000Z'
const ENDED = '2026-10-10T09:30:00.000Z'
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
const before = files.filter(f => f < '0032')
const m32 = files.find(f => f.startsWith('0032'))!

let db: any
const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args)
const all = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args).map((r: any) => ({ ...r }))
const get = (sql: string, ...args: unknown[]) => {
  const r = db.prepare(sql).get(...args)
  return r && { ...r }
}

const person = (handle: string) =>
  run(
    `INSERT INTO person (handle, email, email_norm, password_hash, terms_version, terms_accepted_at, age_confirmed_at, created_at)
     VALUES (?, ?, ?, 'pbkdf2-sha256$x', '0.1', ?, ?, ?)`,
    handle, `${handle}@example.org`, `${handle}@example.org`, T, T, T,
  ).lastInsertRowid as number
function node(path: string, author: number, parent: number | null, o: { state?: string; closed?: string; note?: string; inReview?: number } = {}) {
  return run(
    `INSERT INTO node (path, slug, kind, parent_id, root_id, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, triage, created_at, closed_at, dead_end_note, in_review)
     VALUES (?, ?, ?, ?, ?, ?, 'w', 'd', '{"author":true}', ?, 'MIT', ?, '@myra', ?, 'clear', ?, ?, ?, ?)`,
    path, path.split('/').pop(), parent ? 'branch' : 'shwarm', parent, parent, path, parent ? null : 1, author, o.state ?? 'live', T, o.closed ?? null, o.note ?? null, o.inReview ?? 0,
  ).lastInsertRowid as number
}
const LINKS = JSON.stringify([{ repo: 'https://codeberg.org/myra/doom-blocks', commit: 'e'.repeat(40) }])
function submission(id: string, nodeId: number, personId: number, number: number, status: string, decided: string | null = null, links = '[]') {
  run(`INSERT INTO post (id, node_id, person_id, as_name, kind, text, links, created_at) VALUES (?, ?, ?, '@ana', 'submission', 'done', ?, ?)`, id, nodeId, personId, links, T)
  run(`INSERT INTO submission (post_id, node_id, number, hash, how_to_check, status, decided_at) VALUES (?, ?, ?, ?, 'run it', ?, ?)`, id, nodeId, number, 'a'.repeat(64), status, decided)
}
const band = (nodeId: number, current: string, challenger: string | null, at: string) =>
  run('INSERT INTO branch_status (node_id, current, challenger, lead_hours, leading_since, changed_at, at) VALUES (?, ?, ?, 20, ?, NULL, ?)', nodeId, current, challenger, at, at)
const stats = (nodeId: number) =>
  run("INSERT INTO node_stats (node_id, impact, posts_per_day, people, hot, score, status_line, upvotes, posts, stale_at, updated_at) VALUES (?, 0, 0, 1, 0, 0, 'no submission yet.', 0, 0, NULL, ?)", nodeId, T)

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const f of before) db.exec(readFileSync(new URL(f, dir), 'utf8'))
})

describe('migration 0032 (Oct 14)', () => {
  it('turns every pass and dead end into a status and an author record, unlocks the trees, and retires the review', () => {
    const myra = person('myra')
    const ana = person('ana')
    const mid = node('mid', myra, null, { state: 'closed', closed: CLOSED })
    const bp = node('mid/bp', myra, mid) // live under the passed shwarm: locked with it, its band frozen then
    band(bp, 'on_track', 'blocked', '2026-10-09T17:00:00.000Z')
    submission('p_midsub001', mid, ana, 1, 'failed', '2026-10-08T10:00:00.000Z')
    submission('p_midsub002', mid, ana, 2, 'passed', CLOSED, LINKS)
    const warp = node('warp', myra, null, { state: 'dead_end', closed: ENDED, note: 'the metric has no solution here' })
    run(`INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_warpdead1', ?, ?, '@myra', 'dead_end', 'the metric has no solution here', ?)`, warp, myra, ENDED)
    const live = node('live', myra, null, { inReview: 1 })
    submission('p_livesub01', live, ana, 1, 'in_review')
    run("INSERT INTO inbox_item (person_id, kind, node_id, post_id, text, created_at) VALUES (?, 'sign_off', ?, 'p_livesub01', '#1 on live is ready for your sign-off.', ?)", myra, live, T)
    run("INSERT INTO email_outbox (to_email, person_id, template, stream, payload, created_at, send_after) VALUES ('myra@example.org', ?, 'sign_off_ready', 'notices', '{}', ?, ?)", myra, T, T)
    run("INSERT INTO email_outbox (to_email, person_id, template, stream, payload, created_at, send_after, sent_at) VALUES ('myra@example.org', ?, 'sign_off_ready', 'notices', '{}', ?, ?, ?)", myra, T, T, T)
    for (const n of [mid, bp, warp, live]) stats(n)

    db.exec(readFileSync(new URL(m32, dir), 'utf8'))

    // nothing locks: every node is live, and keeps its history
    expect(all('SELECT path, state, closed_at, dead_end_note FROM node ORDER BY id')).toEqual([
      { path: 'mid', state: 'live', closed_at: CLOSED, dead_end_note: null },
      { path: 'mid/bp', state: 'live', closed_at: null, dead_end_note: null },
      { path: 'warp', state: 'live', closed_at: ENDED, dead_end_note: 'the metric has no solution here' },
      { path: 'live', state: 'live', closed_at: null, dead_end_note: null },
    ])
    // the pass and the dead end are their status now, as of when they happened
    const bands = Object.fromEntries(all('SELECT node_id, current, challenger, lead_hours, leading_since, changed_at, at FROM branch_status').map((b: any) => [b.node_id, b]))
    expect(bands[mid]).toMatchObject({ current: 'passed', challenger: null, lead_hours: 0, leading_since: null, changed_at: CLOSED })
    expect(bands[warp]).toMatchObject({ current: 'dead_end', changed_at: ENDED })
    // the frozen band starts again from now: no credit for the locked days
    expect(bands[bp]).toMatchObject({ current: 'on_track', challenger: null, lead_hours: 0, leading_since: null })
    for (const n of [mid, warp, bp]) expect(bands[n].at > T).toBe(true)
    expect(bands[live]).toBeUndefined()
    // a record of the author's for each, with the passed submission's links as its pins, or the dead-end note
    expect(all('SELECT node_id, kind, status, at, change_id, claim_id, submission_id, note_post_id, backers, pins, by_name, person_id FROM pass_record ORDER BY node_id')).toEqual([
      { node_id: mid, kind: 'author', status: 'passed', at: CLOSED, change_id: null, claim_id: null, submission_id: 'p_midsub002', note_post_id: null, backers: 0, pins: LINKS, by_name: '@myra', person_id: myra },
      { node_id: warp, kind: 'author', status: 'dead_end', at: ENDED, change_id: null, claim_id: null, submission_id: null, note_post_id: 'p_warpdead1', backers: 0, pins: '[]', by_name: '@myra', person_id: myra },
    ])
    expect(all('SELECT id FROM pass_record').every((r: any) => /^r_[0-9a-f]{10}$/.test(r.id))).toBe(true)
    // and a dated line in each history, from the status it had
    expect(all('SELECT node_id, at, from_status, to_status, claim_id, backers, against, written_by FROM status_change ORDER BY node_id')).toEqual([
      { node_id: mid, at: CLOSED, from_status: 'on_track', to_status: 'passed', claim_id: null, backers: 0, against: 0, written_by: 'migration' },
      { node_id: warp, at: ENDED, from_status: 'on_track', to_status: 'dead_end', claim_id: null, backers: 0, against: 0, written_by: 'migration' },
    ])
    expect(all('SELECT id FROM status_change').every((r: any) => /^h_[0-9a-f]{10}$/.test(r.id))).toBe(true)
    // nothing is in review, no sign-off waits, and the queued sign-off mail is gone (the sent one stays on record)
    expect(all('SELECT post_id, status, superseded_by FROM submission ORDER BY post_id')).toEqual([
      { post_id: 'p_livesub01', status: 'superseded', superseded_by: null },
      { post_id: 'p_midsub001', status: 'failed', superseded_by: null },
      { post_id: 'p_midsub002', status: 'passed', superseded_by: null },
    ])
    expect(get('SELECT COUNT(*) AS n FROM node WHERE in_review <> 0').n).toBe(0)
    expect(get("SELECT done_at FROM inbox_item WHERE kind = 'sign_off'").done_at).not.toBeNull()
    expect(all("SELECT sent_at FROM email_outbox WHERE template = 'sign_off_ready'")).toEqual([{ sent_at: T }])
    // every node is rolled up again by the next stats runs
    expect(all('SELECT stale_at FROM node_stats').every((r: any) => r.stale_at > T)).toBe(true)
  })

  it('keeps a status the band already had, with no line for a change that never happened', () => {
    const myra = person('myra')
    const mid = node('mid', myra, null)
    const bp = node('mid/bp', myra, mid, { state: 'closed', closed: CLOSED })
    band(bp, 'passed', null, CLOSED)
    db.exec(readFileSync(new URL(m32, dir), 'utf8'))
    expect(get('SELECT current, changed_at FROM branch_status WHERE node_id = ?', bp)).toEqual({ current: 'passed', changed_at: CLOSED })
    expect(all('SELECT * FROM status_change')).toEqual([])
    expect(get('SELECT kind, status FROM pass_record WHERE node_id = ?', bp)).toEqual({ kind: 'author', status: 'passed' })
  })

  it('adds the history and the records: the history is append-only, one line per moment, and a record names real rows', () => {
    db.exec(readFileSync(new URL(m32, dir), 'utf8'))
    const myra = person('myra')
    const mid = node('mid', myra, null)
    run(`INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at, claim) VALUES ('p_claim0001', ?, ?, '@myra', 'post', 'soak.sh: 0 failures', ?, 'passed')`, mid, myra, T)
    const line = (id: string, at: string, to = 'passed') =>
      run("INSERT INTO status_change (id, node_id, at, from_status, to_status, claim_id, backers, against, written_at, written_by) VALUES (?, ?, ?, 'on_track', ?, 'p_claim0001', 3, 1, ?, 'job')", id, mid, at, to, T)
    line('h_aaaaaaaaaa', T)
    expect(() => line('h_bbbbbbbbbb', T)).toThrow(/UNIQUE/) // the act and the job write the same change once
    expect(() => line('h_cccccccccc', '2026-10-13T13:00:00.000Z', 'stale')).toThrow(/CHECK/)
    expect(() => run("UPDATE status_change SET backers = 9 WHERE id = 'h_aaaaaaaaaa'")).toThrow(/append-only/)
    expect(() => run("DELETE FROM status_change WHERE id = 'h_aaaaaaaaaa'")).toThrow(/append-only/)
    const record = (id: string, kind: string, o: { change?: string | null; claim?: string; at?: string } = {}) =>
      run(
        "INSERT INTO pass_record (id, node_id, kind, status, at, change_id, claim_id, backers, pins) VALUES (?, ?, ?, 'passed', ?, ?, ?, 3, '[]')",
        id, mid, kind, o.at ?? T, o.change ?? null, o.claim ?? 'p_claim0001',
      )
    record('r_aaaaaaaaaa', 'crowd', { change: 'h_aaaaaaaaaa' })
    record('r_bbbbbbbbbb', 'author') // the author's mark at the same moment is a record of its own
    expect(() => record('r_cccccccccc', 'crowd', { change: 'h_aaaaaaaaaa' })).toThrow(/UNIQUE/)
    expect(() => run("INSERT INTO pass_record (id, node_id, kind, status, at) VALUES ('r_dddddddddd', ?, 'author', 'blocked', ?)", mid, T)).toThrow(/CHECK/)
    expect(() => record('r_eeeeeeeeee', 'author', { claim: 'p_nothing01', at: '2026-10-13T14:00:00.000Z' })).toThrow(/FOREIGN KEY/)
    expect(get("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'pass_record_node'")).toEqual({ name: 'pass_record_node' })
  })
})
