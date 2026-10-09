// The schema, applied to a fresh SQLite database the way D1 runs it (foreign keys on).
import { readdirSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'

const mod = 'node:sqlite' // kept out of the Workers type set on purpose
const { DatabaseSync } = (await import(/* @vite-ignore */ mod)) as any
const dir = new URL('../migrations/', import.meta.url)
const T = '2026-10-08T12:00:00Z'

let db: any
const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args)
const get = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args)

function person(handle: string) {
  return run(
    `INSERT INTO person (handle, email, email_norm, password_hash, terms_version, terms_accepted_at, age_confirmed_at, created_at)
     VALUES (?, ?, ?, 'pbkdf2-sha256$x', '0.1', ?, ?, ?)`,
    handle, `${handle}@example.org`, `${handle}@example.org`, T, T, T,
  ).lastInsertRowid as number
}
function shwarm(path: string, author: number, extra: Record<string, unknown> = {}) {
  const row = { kind: 'shwarm', title: 'minecraft in doom', what: 'dig and build while imps attack', done_when: 'a gzdoom mod at 60 fps',
    checks: '{"author":true}', lobby_size: 2, license: 'MIT + CC-BY-4.0', state: 'lobby', ...extra }
  return run(
    `INSERT INTO node (path, slug, kind, parent_id, title, what, done_when, checks, lobby_size, license, author_id, posted_by, state, dead_end_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '@myra', ?, ?, ?)`,
    path, path.split('/').pop(), row.kind, (row as any).parent_id ?? null, row.title, row.what, row.done_when, row.checks,
    row.lobby_size, row.license, author, row.state, (row as any).dead_end_note ?? null, T,
  ).lastInsertRowid as number
}

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'))
})

describe('schema', () => {
  it('has every table from the data model', () => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r: any) => r.name)
    for (const t of ['person', 'session', 'email_token', 'node', 'node_tag', 'node_fts', 'node_edit', 'seat', 'post', 'post_edit',
      'mention', 'upvote', 'submission', 'built_on', 'check_report', 'inbox_item', 'agent_key', 'key_grant', 'key_network',
      'sig_nonce', 'idempotency', 'rate_bucket', 'auth_throttle', 'audit_event', 'flag', 'report', 'triage_decision',
      'moderation_action', 'node_stats', 'person_node_stats', 'site_stats_daily', 'setting', 'signup_allow', 'email_outbox',
      'email_suppression', 'disposable_domain']) expect(names, t).toContain(t)
  })

  it('seeds the settings closed: holding, allow-list sign-up', () => {
    expect(JSON.parse(get("SELECT value FROM setting WHERE key = 'site_mode'").value)).toBe('holding')
    expect(JSON.parse(get("SELECT value FROM setting WHERE key = 'signup'").value)).toBe('allow_list')
  })

  it('refuses updating or deleting an audit event', () => {
    const myra = person('myra')
    const n = shwarm('minecraft-in-doom', myra)
    run("INSERT INTO audit_event (id, at, event, node_id, by_name) VALUES ('e_1', ?, 'lobby_filled', ?, '@myra')", T, n)
    expect(() => run("UPDATE audit_event SET detail = 'edited' WHERE id = 'e_1'")).toThrow(/append-only/)
    expect(() => run("DELETE FROM audit_event WHERE id = 'e_1'")).toThrow(/append-only/)
    expect(get("SELECT detail FROM audit_event WHERE id = 'e_1'").detail).toBe('')
  })

  it('keeps the search index in step with nodes', () => {
    const myra = person('myra')
    const n = shwarm('minecraft-in-doom', myra)
    const hits = (q: string) => db.prepare('SELECT rowid FROM node_fts WHERE node_fts MATCH ?').all(q).map((r: any) => r.rowid)
    expect(hits('imps')).toEqual([n])
    run("UPDATE node SET what = 'dig and build while cacodemons attack' WHERE id = ?", n)
    expect(hits('imps')).toEqual([])
    expect(hits('cacodemons')).toEqual([n])
  })

  it('holds node shape rules', () => {
    const myra = person('myra')
    const root = shwarm('minecraft-in-doom', myra)
    expect(() => shwarm('x', myra, { lobby_size: null })).toThrow()                        // a shwarm needs a lobby size
    expect(() => shwarm('y', myra, { kind: 'branch' })).toThrow()                          // a branch needs a parent
    expect(() => shwarm('z', myra, { done_when: '' })).toThrow()                           // exactly one done test
    expect(() => shwarm('w', myra, { state: 'dead_end' })).toThrow()                       // dead end needs a note
    expect(() => shwarm('v', myra, { state: 'in_review' })).toThrow()                      // in review is a label, not a state
    expect(shwarm('minecraft-in-doom/block-placement', myra, { kind: 'branch', parent_id: root, lobby_size: null, state: 'live' })).toBeGreaterThan(0)
    expect(() => shwarm('minecraft-in-doom', myra)).toThrow()                              // paths are unique
  })

  it('gives each person one check slot per submission, until an author fail resets it', () => {
    const myra = person('myra'), kestrel = person('kestrel'), bmo = person('bmo_fan')
    const n = shwarm('minecraft-in-doom', myra, { state: 'live' })
    run("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_s', ?, ?, '@bmo_fan/a', 'submission', 'v1', ?)", n, bmo, T)
    run("INSERT INTO submission (post_id, node_id, number, hash, how_to_check) VALUES ('p_s', ?, 1, ?, 'run soak.sh')", n, 'a'.repeat(64))
    const check = (id: string, slot: string, extra = '') => {
      run(`INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_${id}', ?, ?, '@kestrel/swarm/r-03', 'check', 'ok', ?)`, n, kestrel, T)
      run(`INSERT INTO check_report (id, post_id, submission_id, person_id, slot, verdict, evidence, submission_hash, exit_code, created_at${extra ? ', ' + extra.split('=')[0] : ''})
           VALUES ('c_${id}', 'p_${id}', 'p_s', ?, ?, 'pass', 'log', ?, 0, ?${extra ? ", '" + extra.split('=')[1] + "'" : ''})`, kestrel, slot, 'a'.repeat(64), T)
    }
    check('1', 'run')
    expect(() => check('2', 'people')).toThrow(/UNIQUE/)                                    // a run *or* a people check
    run("UPDATE check_report SET reset_at = ? WHERE id = 'c_1'", T)
    expect(() => check('3', 'people')).not.toThrow()                                       // after a reset, a new slot
  })

  it('refuses a fail without a repro, and a run without its hash and exit code', () => {
    const myra = person('myra'), k = person('kestrel')
    const n = shwarm('minecraft-in-doom', myra, { state: 'live' })
    run("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_s', ?, ?, '@myra/a', 'submission', 'v1', ?)", n, myra, T)
    run("INSERT INTO submission (post_id, node_id, number, hash, how_to_check) VALUES ('p_s', ?, 1, ?, 'x')", n, 'b'.repeat(64))
    run("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_c', ?, ?, '@kestrel', 'check', 'no', ?)", n, k, T)
    expect(() => run("INSERT INTO check_report (id, post_id, submission_id, person_id, slot, verdict, created_at) VALUES ('c_1', 'p_c', 'p_s', ?, 'people', 'fail', ?)", k, T)).toThrow()
    expect(() => run("INSERT INTO check_report (id, post_id, submission_id, person_id, slot, verdict, created_at) VALUES ('c_1', 'p_c', 'p_s', ?, 'run', 'pass', ?)", k, T)).toThrow()
    expect(() => run("INSERT INTO check_report (id, post_id, submission_id, person_id, slot, verdict, log_inline, submission_hash, exit_code, created_at) VALUES ('c_1', 'p_c', 'p_s', ?, 'run', 'pass', ?, 'h', 0, ?)", k, 'x'.repeat(65537), T)).toThrow()
  })

  it('keeps a note on built_on and the release fields on a submission (0007)', () => {
    const cols = (t: string) => db.prepare(`PRAGMA table_info(${t})`).all().map((r: any) => r.name)
    expect(cols('built_on')).toContain('note')
    expect(cols('submission')).toEqual(expect.arrayContaining(['release_title', 'release_version', 'release_how_to_use']))
    const myra = person('myra')
    const n = shwarm('minecraft-in-doom', myra, { state: 'live' })
    run("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_f', ?, ?, '@myra', 'post', 'root cause here', ?)", n, myra, T)
    run("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_s', ?, ?, '@myra/a', 'submission', 'v1', ?)", n, myra, T)
    run(
      `INSERT INTO submission (post_id, node_id, number, hash, how_to_check, release_title, release_version, release_how_to_use)
       VALUES ('p_s', ?, 1, ?, 'x', 'minecraft in doom v1.0', 'e9b41d0', 'gzdoom -iwad freedoom2.wad -file mid-v1.pk3')`,
      n, 'c'.repeat(64),
    )
    run("INSERT INTO built_on (submission_id, post_id, note) VALUES ('p_s', 'p_f', 'root cause')")
    expect(get('SELECT note FROM built_on').note).toBe('root cause')
    expect(get('SELECT release_how_to_use FROM submission').release_how_to_use).toBe('gzdoom -iwad freedoom2.wad -file mid-v1.pk3')
  })

  it('never stores a bare handle as a key pattern', () => {
    const myra = person('myra')
    const key = (pattern: string) => run("INSERT INTO agent_key (id, person_id, name, public_key, can_post_as, created_at) VALUES ('k1', ?, 'laptop', 'pk', ?, ?)", myra, pattern, T)
    expect(() => key('@myra')).toThrow()
    expect(() => key('@myra/*')).not.toThrow()
  })

  it('refuses handles outside the pattern', () => {
    expect(() => person('Myra')).toThrow()
    expect(() => person('m')).toThrow()
    expect(() => person('my-ra')).toThrow()
  })
})
