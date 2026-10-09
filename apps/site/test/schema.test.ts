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

  it("keeps a post's deletion time and a node's triage round (0008)", () => {
    const cols = (t: string) => db.prepare(`PRAGMA table_info(${t})`).all().map((r: any) => r.name)
    expect(cols('post')).toContain('deleted_at')
    expect(cols('node')).toContain('triage_since')
    const myra = person('myra')
    const n = shwarm('minecraft-in-doom', myra)
    expect(get('SELECT triage_since FROM node WHERE id = ?', n).triage_since).toBeNull()
    // a tombstone keeps its row with no text
    run("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_d', ?, ?, '@myra', 'post', 'oops', ?)", n, myra, T)
    run("UPDATE post SET text = '', links = '[]', deleted_at = ? WHERE id = 'p_d'", T)
    expect(get("SELECT text, deleted_at FROM post WHERE id = 'p_d'")).toEqual({ text: '', deleted_at: T })
  })

  it("notes whether a re-pitched version was public when it was replaced (0009)", () => {
    const myra = person('myra')
    const n = shwarm('minecraft-in-doom', myra)
    run("INSERT INTO node_edit (node_id, by_name, title, what, edited_at) VALUES (?, '@myra', 'old', 'old what', ?)", n, T)
    run("INSERT INTO node_edit (node_id, by_name, title, what, edited_at, was_public) VALUES (?, '@myra', 'older', 'older what', ?, 1)", n, T)
    expect(db.prepare('SELECT title, was_public FROM node_edit ORDER BY id').all()).toEqual([{ title: 'old', was_public: 0 }, { title: 'older', was_public: 1 }])
  })

  it("finds the shwarms built on one by an index (0010)", () => {
    const myra = person('myra')
    shwarm('minecraft-in-doom', myra, { state: 'closed' })
    const n = shwarm('doom-speedruns', myra)
    run(`UPDATE node SET builds_on = '{"node":"minecraft-in-doom"}' WHERE id = ?`, n)
    const q = "SELECT path FROM node WHERE json_extract(builds_on, '$.node') = 'minecraft-in-doom'"
    expect(db.prepare(q).all().map((r: any) => r.path)).toEqual(['doom-speedruns'])
    expect(db.prepare(`EXPLAIN QUERY PLAN ${q}`).all().map((r: any) => r.detail).join(' ')).toContain('node_builds_on_node')
  })

  it("keeps when the password was last changed, empty until then (0011)", () => {
    const myra = person('myra')
    expect(get('SELECT password_changed_at FROM person WHERE id = ?', myra).password_changed_at).toBeNull()
    run('UPDATE person SET password_changed_at = ? WHERE id = ?', T, myra)
    expect(get('SELECT password_changed_at FROM person WHERE id = ?', myra).password_changed_at).toBe(T)
  })

  it("keeps how far the last mention digest went, and finds mentions and mail rows by index (0012)", () => {
    const myra = person('myra')
    expect(get('SELECT digest_at FROM person WHERE id = ?', myra).digest_at).toBeNull()
    run('UPDATE person SET digest_at = ? WHERE id = ?', T, myra)
    expect(get('SELECT digest_at FROM person WHERE id = ?', myra).digest_at).toBe(T)
    const plan = (q: string) => db.prepare(`EXPLAIN QUERY PLAN ${q}`).all().map((r: any) => r.detail).join(' ')
    expect(plan(`SELECT id FROM inbox_item WHERE kind = 'mention' AND created_at > '${T}'`)).toContain('inbox_mention_created')
    expect(plan('SELECT id FROM email_outbox WHERE person_id = 1')).toContain('email_outbox_person')
  })

  it("keeps the name and node of a key's last use, empty until the signed request pipeline writes them (0013)", () => {
    const myra = person('myra')
    run("INSERT INTO agent_key (id, person_id, name, public_key, can_post_as, created_at) VALUES ('k1', ?, 'laptop', 'pk', '@myra/*', ?)", myra, T)
    expect(get("SELECT last_used_as, last_used_node FROM agent_key WHERE id = 'k1'")).toEqual({ last_used_as: null, last_used_node: null })
    run("UPDATE agent_key SET last_used_at = ?, last_used_as = '@myra/m-07', last_used_node = 'minecraft-in-doom/block-placement' WHERE id = 'k1'", T)
    expect(get("SELECT last_used_as FROM agent_key WHERE id = 'k1'").last_used_as).toBe('@myra/m-07')
  })

  it('keeps when a key network was mailed about, empty for one that was only recorded (0014)', () => {
    const myra = person('myra')
    run("INSERT INTO agent_key (id, person_id, name, public_key, can_post_as, created_at) VALUES ('k1', ?, 'laptop', 'pk', '@myra/*', ?)", myra, T)
    run("INSERT INTO key_network (key_id, ip_prefix, first_seen, last_seen) VALUES ('k1', '198.51.100.0/24', ?, ?)", T, T)
    expect(get("SELECT alerted_at FROM key_network WHERE key_id = 'k1'").alerted_at).toBeNull()
    run("UPDATE key_network SET alerted_at = ? WHERE key_id = 'k1'", T)
    expect(get("SELECT alerted_at FROM key_network WHERE key_id = 'k1'").alerted_at).toBe(T)
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
