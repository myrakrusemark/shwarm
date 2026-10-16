// Migration 0034 (decided Oct 15, "a plain word typed in search also finds tags"): applied to a database that has
// every migration before it. It rebuilds node_fts with a `tags` column and fills it from every node there is, so
// existing nodes (production's and staging's) are found by their tags, not only nodes written after it.
import { readdirSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'

const mod = 'node:sqlite' // kept out of the Workers type set on purpose
const { DatabaseSync } = (await import(/* @vite-ignore */ mod)) as any
const dir = new URL('../migrations/', import.meta.url)
const T = '2026-10-14T12:00:00.000Z'
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
const before = files.filter(f => f < '0034')
const m34 = files.find(f => f.startsWith('0034'))!

let db: any
const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args)
const get = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args)
const hits = (q: string) => db.prepare('SELECT rowid FROM node_fts WHERE node_fts MATCH ? ORDER BY rowid').all(q).map((r: any) => r.rowid)

const person = (handle: string) =>
  run(
    `INSERT INTO person (handle, email, email_norm, password_hash, terms_version, terms_accepted_at, age_confirmed_at, created_at)
     VALUES (?, ?, ?, 'pbkdf2-sha256$x', '0.1', ?, ?, ?)`,
    handle, `${handle}@example.org`, `${handle}@example.org`, T, T, T,
  ).lastInsertRowid as number
const node = (path: string, title: string, author: number) =>
  run(
    `INSERT INTO node (path, slug, kind, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, triage, created_at)
     VALUES (?, ?, 'shwarm', ?, 'dig and build while imps attack', 'a gzdoom mod at 60 fps', '{"author":false}', 1, 'MIT', ?, '@myra', 'live', 'clear', ?)`,
    path, path, title, author, T,
  ).lastInsertRowid as number

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const f of before) db.exec(readFileSync(new URL(f, dir), 'utf8'))
})

describe('migration 0034 (Oct 15)', () => {
  it('fills the search index from every existing node, tags in the order they were added', () => {
    const myra = person('myra')
    const tagged = node('minecraft-in-doom', 'minecraft in doom', myra)
    for (const t of ['games', 'needs-humans', 'art']) run('INSERT INTO node_tag (node_id, tag) VALUES (?, ?)', tagged, t)
    const bare = node('measure-the-earth', 'measure the earth with sticks', myra)

    db.exec(readFileSync(new URL(m34, dir), 'utf8'))

    expect(get('SELECT tags FROM node_fts WHERE rowid = ?', tagged).tags).toBe('games needs-humans art')
    expect(get('SELECT tags FROM node_fts WHERE rowid = ?', bare).tags).toBe('')
    expect(get('SELECT count(*) AS n FROM node_fts').n).toBe(get('SELECT count(*) AS n FROM node').n)
    expect(hits('games')).toEqual([tagged])        // by a tag word
    expect(hits('humans')).toEqual([tagged])       // a dashed tag by its part
    expect(hits('minecraft')).toEqual([tagged])    // by a title word
    expect(hits('earth')).toEqual([bare])
    expect(hits('imps')).toEqual([tagged, bare])   // the pitch, as before
  })
})
