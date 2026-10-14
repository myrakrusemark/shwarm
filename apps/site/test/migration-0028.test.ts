// Migration 0028's data steps (decided Oct 13): the author sign-off is removed from branches, not hidden. Applied to a
// database that has every migration before it, with rows as they stood: a branch whose checks name its author, its
// author's own submission (the A9 swap) and an open sign-off notice, next to a shwarm whose sign-off stays.
import { readdirSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'

const mod = 'node:sqlite' // kept out of the Workers type set on purpose
const { DatabaseSync } = (await import(/* @vite-ignore */ mod)) as any
const dir = new URL('../migrations/', import.meta.url)
const T = '2026-10-08T12:00:00.000Z'
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
const before = files.filter(f => f < '0028')
const m28 = files.find(f => f.startsWith('0028'))!

let db: any
const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args)
const get = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args)

function node(path: string, kind: 'shwarm' | 'branch', checks: string, author: number, parent: number | null, root: number | null) {
  return run(
    // lobby_size: a shwarm row still needs one (an old constraint); no lobby since Oct 9.
    `INSERT INTO node (path, slug, kind, parent_id, root_id, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, triage, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'w', 'd', ?, ?, 'MIT', ?, '@myra', 'live', 'clear', ?)`,
    path, path.split('/').pop(), kind, parent, root, path, checks, kind === 'shwarm' ? 1 : null, author, T,
  ).lastInsertRowid as number
}
function submission(id: string, nodeId: number, person: number, swap: 0 | 1) {
  run(`INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES (?, ?, ?, '@myra/m-04', 'submission', 'the fix', ?)`, id, nodeId, person, T)
  run(`INSERT INTO submission (post_id, node_id, number, hash, how_to_check, author_swap) VALUES (?, ?, 1, ?, 'run it', ?)`, id, nodeId, 'a'.repeat(64), swap)
}
const signOff = (person: number, nodeId: number, post: string) =>
  run(`INSERT INTO inbox_item (person_id, kind, node_id, post_id, text, created_at) VALUES (?, 'sign_off', ?, ?, 'needs your sign-off.', ?)`, person, nodeId, post, T)

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const f of before) db.exec(readFileSync(new URL(f, dir), 'utf8'))
})

describe('migration 0028 (Oct 13)', () => {
  it("strips the author check from every branch, ends their sign-off notices and swaps; a shwarm's stay", () => {
    const myra = run(
      `INSERT INTO person (handle, email, email_norm, password_hash, terms_version, terms_accepted_at, age_confirmed_at, created_at)
       VALUES ('myra', 'myra@example.org', 'myra@example.org', 'pbkdf2-sha256$x', '0.1', ?, ?, ?)`,
      T, T, T,
    ).lastInsertRowid as number
    const root = node('mid', 'shwarm', '{"author":true,"runs":{"command":"./x","count":1}}', myra, null, null)
    const onlyAuthor = node('mid/bp', 'branch', '{"author":true}', myra, root, root)
    const withPeople = node('mid/art', 'branch', '{"people":{"count":2,"human":false},"author":true}', myra, root, root)
    const without = node('mid/inv', 'branch', '{"runs":{"command":"./y","count":2},"author":false}', myra, root, root)
    submission('p_branchwork1', onlyAuthor, myra, 1)
    submission('p_shwarmwork1', root, myra, 1)
    signOff(myra, onlyAuthor, 'p_branchwork1')
    signOff(myra, root, 'p_shwarmwork1')

    db.exec(readFileSync(new URL(m28, dir), 'utf8'))

    const checks = (id: number) => JSON.parse(get('SELECT checks FROM node WHERE id = ?', id).checks)
    expect(checks(onlyAuthor)).toEqual({ author: false })
    expect(checks(withPeople)).toEqual({ people: { count: 2, human: false }, author: false })
    expect(checks(without)).toEqual({ runs: { command: './y', count: 2 }, author: false })
    expect(checks(root)).toEqual({ author: true, runs: { command: './x', count: 1 } }) // a shwarm keeps its sign-off
    expect(get('SELECT author_swap FROM submission WHERE post_id = ?', 'p_branchwork1').author_swap).toBe(0)
    expect(get('SELECT author_swap FROM submission WHERE post_id = ?', 'p_shwarmwork1').author_swap).toBe(1)
    expect(get('SELECT done_at FROM inbox_item WHERE node_id = ?', onlyAuthor).done_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    expect(get('SELECT done_at FROM inbox_item WHERE node_id = ?', root).done_at).toBeNull()
    // and the vote table it adds
    expect(get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'status_vote'")).toEqual({ name: 'status_vote' })
  })
})
