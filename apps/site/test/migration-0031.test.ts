// Migration 0031's data steps (decided Oct 14, "A branch's status: on track by vote, the rest by claims people back" and
// "Only people on a branch vote on its status"): applied to a database that has every migration before it, with rows
// as they stood: votes of every status, from people on the branch, people who left it and people who never joined, and a
// branch and a shwarm each with a submission in review (the branch's becomes superseded; the shwarm's stays).
import { readdirSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'

const mod = 'node:sqlite' // kept out of the Workers type set on purpose
const { DatabaseSync } = (await import(/* @vite-ignore */ mod)) as any
const dir = new URL('../migrations/', import.meta.url)
const T = '2026-10-13T12:00:00.000Z'
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
const before = files.filter(f => f < '0031')
const m31 = files.find(f => f.startsWith('0031'))!

let db: any
const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args)
const all = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args).map((r: any) => ({ ...r }))
const get = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args)

const person = (handle: string) =>
  run(
    `INSERT INTO person (handle, email, email_norm, password_hash, terms_version, terms_accepted_at, age_confirmed_at, created_at)
     VALUES (?, ?, ?, 'pbkdf2-sha256$x', '0.1', ?, ?, ?)`,
    handle, `${handle}@example.org`, `${handle}@example.org`, T, T, T,
  ).lastInsertRowid as number
function node(path: string, kind: 'shwarm' | 'branch', author: number, parent: number | null) {
  return run(
    `INSERT INTO node (path, slug, kind, parent_id, root_id, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, triage, created_at, in_review)
     VALUES (?, ?, ?, ?, ?, ?, 'w', 'd', '{"people":{"count":1,"human":false},"author":false}', ?, 'MIT', ?, '@myra', 'live', 'clear', ?, 1)`,
    path, path.split('/').pop(), kind, parent, parent, path, kind === 'shwarm' ? 1 : null, author, T,
  ).lastInsertRowid as number
}
const seat = (nodeId: number, personId: number, number: number, left: string | null = null, through: number | null = null) =>
  run('INSERT INTO seat (node_id, person_id, number, joined_at, left_at, through_id) VALUES (?, ?, ?, ?, ?, ?)', nodeId, personId, number, T, left, through)
function submission(id: string, nodeId: number, personId: number, number: number, status: string) {
  run(`INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES (?, ?, ?, '@x', 'submission', 'done', ?)`, id, nodeId, personId, T)
  run(`INSERT INTO submission (post_id, node_id, number, hash, how_to_check, status) VALUES (?, ?, ?, ?, 'run it', ?)`, id, nodeId, number, 'a'.repeat(64), status)
}
const vote = (nodeId: number, personId: number, status: string) =>
  run('INSERT INTO status_vote (node_id, person_id, status, as_name, at) VALUES (?, ?, ?, ?, ?)', nodeId, personId, status, '@x', T)

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const f of before) db.exec(readFileSync(new URL(f, dir), 'utf8'))
})

describe('migration 0031 (Oct 14)', () => {
  it('keeps on-track votes from people on the branch, and drops the rest; no branch is in review', () => {
    const myra = person('myra')
    const ana = person('ana')
    const finn = person('finn')
    const lumpy = person('lumpy')
    const kit = person('kit')
    const root = node('mid', 'shwarm', myra, null)
    const bp = node('mid/bp', 'branch', myra, root)
    const edges = node('mid/bp/edges', 'branch', myra, bp)
    seat(bp, ana, 1) // joined
    seat(bp, finn, 2) // joined
    seat(bp, lumpy, 3, T) // left
    seat(bp, kit, 4, null, edges) // counted here through a sub-branch
    vote(bp, ana, 'on_track')
    vote(bp, finn, 'blocked') // no evidence: goes
    vote(bp, lumpy, 'on_track') // left the branch: goes
    vote(bp, myra, 'on_track') // never joined: goes
    vote(bp, kit, 'on_track') // through a sub-branch: joined
    vote(edges, ana, 'passed') // goes
    submission('p_bpsub0001', bp, finn, 1, 'failed') // history as it was
    submission('p_bpsub0002', bp, finn, 2, 'in_review') // history now: superseded, with no later submission
    submission('p_midsub001', root, ana, 1, 'in_review') // a shwarm keeps its review

    db.exec(readFileSync(new URL(m31, dir), 'utf8'))

    expect(all('SELECT node_id, person_id, status, claim_id FROM status_vote ORDER BY person_id')).toEqual([
      { node_id: bp, person_id: ana, status: 'on_track', claim_id: null },
      { node_id: bp, person_id: kit, status: 'on_track', claim_id: null },
    ])
    expect(get('SELECT in_review FROM node WHERE id = ?', bp).in_review).toBe(0)
    expect(get('SELECT in_review FROM node WHERE id = ?', root).in_review).toBe(1) // a shwarm keeps its review
    expect(all('SELECT post_id, status, superseded_by FROM submission ORDER BY post_id')).toEqual([
      { post_id: 'p_bpsub0001', status: 'failed', superseded_by: null },
      { post_id: 'p_bpsub0002', status: 'superseded', superseded_by: null },
      { post_id: 'p_midsub001', status: 'in_review', superseded_by: null },
    ])
    expect(all('SELECT * FROM branch_status')).toEqual([]) // every branch starts on track, nothing gathered
  })

  it('adds the claim marker on posts, the claim a backing points at, and the band', () => {
    db.exec(readFileSync(new URL(m31, dir), 'utf8'))
    const myra = person('myra')
    const root = node('mid', 'shwarm', myra, null)
    const bp = node('mid/bp', 'branch', myra, root)
    const post = (id: string, claim: string | null) =>
      run(`INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at, claim) VALUES (?, ?, ?, '@myra', 'post', 'evidence', ?, ?)`, id, bp, myra, T, claim)
    post('p_claim0001', 'passed')
    post('p_plain0001', null)
    expect(() => post('p_claim0002', 'on_track')).toThrow(/CHECK/) // on track is a vote, never a claim
    run('INSERT INTO status_vote (node_id, person_id, status, claim_id, as_name, at) VALUES (?, ?, ?, ?, ?, ?)', bp, myra, 'passed', 'p_claim0001', '@myra', T)
    expect(() => run('UPDATE status_vote SET claim_id = ?', 'p_nothing01')).toThrow(/FOREIGN KEY/)
    run(`INSERT INTO branch_status (node_id, current, challenger, lead_hours, leading_since, changed_at, at) VALUES (?, 'passed', 'on_track', 0, NULL, ?, ?)`, bp, T, T)
    expect(get('SELECT current, lead_hours FROM branch_status WHERE node_id = ?', bp)).toEqual({ current: 'passed', lead_hours: 0 })
    expect(() => run(`UPDATE branch_status SET current = 'mixed'`)).toThrow(/CHECK/)
    expect(() => run(`UPDATE branch_status SET challenger = 'stale'`)).toThrow(/CHECK/)
    expect(get("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'post_claim'")).toEqual({ name: 'post_claim' })
    expect(get("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'status_vote_claim'")).toEqual({ name: 'status_vote_claim' })
  })
})
