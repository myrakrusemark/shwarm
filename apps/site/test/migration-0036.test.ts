// Migration 0036 (decided Oct 17, "No badge until someone votes"): applied to a database that has every migration
// before it, as D1 runs it: in one transaction, with foreign keys on. It rebuilds branch_status and status_change so a
// status can be NULL (no status yet; a node's first change has no "from"), keeps every row, the append-only triggers
// and the pass records that point at the history, and takes the status off every node that was on track only by
// default (never changed).
import { readdirSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'

const mod = 'node:sqlite' // kept out of the Workers type set on purpose
const { DatabaseSync } = (await import(/* @vite-ignore */ mod)) as any
const dir = new URL('../migrations/', import.meta.url)
const T = '2026-10-14T12:00:00.000Z'
const LATER = '2026-10-15T12:00:00.000Z'
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
const before = files.filter(f => f < '0036')
const m36 = readFileSync(new URL(files.find(f => f.startsWith('0036'))!, dir), 'utf8')

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
const band = (nodeId: number, current: string, changedAt: string | null, challenger: string | null = null, leadHours = 0) =>
  run('INSERT INTO branch_status (node_id, current, challenger, lead_hours, leading_since, changed_at, at) VALUES (?, ?, ?, ?, NULL, ?, ?)', nodeId, current, challenger, leadHours, changedAt, T)
const migrate = () => {
  db.exec('BEGIN')
  db.exec(m36)
  db.exec('COMMIT')
}

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const f of before) db.exec(readFileSync(new URL(f, dir), 'utf8'))
})

describe('migration 0036 (Oct 17)', () => {
  it('takes the status off a node that was on track only by default, and keeps every other band as it was', () => {
    const myra = person('myra')
    const fresh = node('fresh', myra) // on track since it opened, a challenger gathering
    const back = node('back-on-track', myra) // on track again after a change
    const passed = node('passed', myra)
    band(fresh, 'on_track', null, 'blocked', 12)
    band(back, 'on_track', LATER)
    band(passed, 'passed', LATER)
    migrate()
    expect(all('SELECT node_id, current, challenger, lead_hours, changed_at, at FROM branch_status ORDER BY node_id')).toEqual([
      { node_id: fresh, current: null, challenger: 'blocked', lead_hours: 12, changed_at: null, at: T },
      { node_id: back, current: 'on_track', challenger: null, lead_hours: 0, changed_at: LATER, at: T },
      { node_id: passed, current: 'passed', challenger: null, lead_hours: 0, changed_at: LATER, at: T },
    ])
    expect(() => run("INSERT INTO branch_status (node_id, current, at) VALUES (?, 'lost', ?)", node('x', myra), T)).toThrow(/CHECK/)
  })

  it('keeps the history and the pass records that cite it; a first change has no "from"; the history stays append-only', () => {
    const myra = person('myra')
    const n = node('passed', myra)
    run("INSERT INTO status_change (id, node_id, at, from_status, to_status, claim_id, backers, against, written_at, written_by) VALUES ('h_old', ?, ?, 'on_track', 'passed', NULL, 3, 0, ?, 'act')", n, LATER, LATER)
    run("INSERT INTO pass_record (id, node_id, kind, status, at, change_id, claim_id, backers) VALUES ('r_old', ?, 'crowd', 'passed', ?, 'h_old', NULL, 3)", n, LATER)
    migrate()
    expect(all('SELECT id, from_status, to_status, backers FROM status_change')).toEqual([{ id: 'h_old', from_status: 'on_track', to_status: 'passed', backers: 3 }])
    expect(all('SELECT id, change_id FROM pass_record')).toEqual([{ id: 'r_old', change_id: 'h_old' }])
    expect(all('PRAGMA foreign_key_check')).toEqual([])
    run("INSERT INTO status_change (id, node_id, at, from_status, to_status, claim_id, backers, against, written_at, written_by) VALUES ('h_first', ?, ?, NULL, 'on_track', NULL, 1, 0, ?, 'act')", n, T, T)
    expect(() => run("UPDATE status_change SET backers = 9 WHERE id = 'h_old'")).toThrow(/append-only/)
    expect(() => run("DELETE FROM status_change WHERE id = 'h_old'")).toThrow(/append-only/)
    expect(() => run("INSERT INTO pass_record (id, node_id, kind, status, at, change_id, backers) VALUES ('r_bad', ?, 'crowd', 'passed', ?, 'h_none', 0)", n, T)).toThrow(/FOREIGN KEY/)
  })
})
