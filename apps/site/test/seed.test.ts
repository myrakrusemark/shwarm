// Go-live 3.1, the seed import tool: mapping every launch shwarm, SQL quoting, the plan end to end (applied to a
// fresh database), idempotency, the guards, and production refusal.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { bookmarkBeforeFirstSeed, checkArgs, parseArgs, Refused, reset, type Wrangler } from '../../../scripts/seed-launch'
import { seededLogRow } from '../src/core/audit'
import { rollupStats } from '../src/jobs/stats'
import { parseCheckSpec } from '../src/core/checks'
import { EXAMPLE_BRANCH, EXAMPLE_PEOPLE, EXAMPLE_ROOT } from '../src/seed/example'
import { findLicenses, mapLaunchShwarm, parseBuildsOn, splitRunCommand } from '../src/seed/launch'
import { checkTarget, formatReport, planSeed, type TargetState } from '../src/seed/plan'
import { renderStatement, SENTINEL_MIN, sqlLiteral, sqlString } from '../src/seed/sql'
import { person, refused, site, World } from './core-fixtures'
import { addPerson, T0, testDb } from './d1'

const LIST: any[] = JSON.parse(readFileSync(new URL('../../../docs/launch-shwarms.json', import.meta.url), 'utf8'))
const EMPTY: TargetState = { myra: null, nodes: [], handles: [], settings: [] }
const NOW = T0

/** What scripts/seed-launch.ts reads from a target, read from a test database instead. */
function stateOf(db: any): TargetState {
  const all = (sql: string) => db.raw.prepare(sql).all().map((r: any) => ({ ...r }))
  return {
    myra: all("SELECT id, handle, status, email_verified_at, founding, established_at FROM person WHERE handle = 'myra'")[0] ?? null,
    nodes: all('SELECT path, kind, state, license, hidden, paused FROM node'),
    handles: all(`SELECT handle FROM person WHERE handle IN (${EXAMPLE_PEOPLE.map(h => `'${h}'`).join(', ')})`).map((r: any) => r.handle),
    settings: all('SELECT key, value FROM setting'),
  }
}

/** A target that looks like staging: a few accounts first, so @myra's id isn't 1, and @myra verified. */
async function stagingLike() {
  const db = testDb()
  await addPerson(db, 'early_one')
  await addPerson(db, 'early_two')
  const id = await addPerson(db, 'myra')
  db.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(new Date(T0).toISOString(), id)
  return { db, myraId: id }
}

describe('mapping the launch list', () => {
  test('all 100 map with no parse failures, and the offline dry run plans all of them', async () => {
    expect(LIST).toHaveLength(100)
    for (const e of LIST) {
      const m = mapLaunchShwarm(e)
      expect(m.notes.filter(n => n.kind === 'failed'), e.slug).toEqual([])
      expect(m.input.slug).toBe(e.slug)
      expect(m.input).not.toHaveProperty('lobby') // no lobby (decided Oct 9): the JSON's "lobby" is no longer read
      expect(m.input.kind).toBe('shwarm') // no variants (decided Oct 9)
      // A20: the light check counts are kept as written.
      const check = m.input.check as any
      expect(check.runs?.count ?? null).toBe(e.checked_by.runs?.count ?? null)
      expect(check.people?.count ?? null).toBe(e.checked_by.people?.count ?? null)
      expect(check.people?.human ?? null).toBe(e.checked_by.people?.human ?? null)
      expect(check.author).toBe(e.checked_by.author)
      expect(() => parseCheckSpec(check)).not.toThrow()
      expect(m.pinned).toContain('where this pitch comes from:')
      for (const s of e.sources) expect(m.pinned).toContain(s)
    }
    const plan = await planSeed(testDb(), LIST, EMPTY, { target: 'offline', now: NOW, example: false })
    expect(plan.report.failures).toBe(0)
    expect(plan.report.shwarms.filter(s => s.status === 'new')).toHaveLength(100)
    expect(formatReport(plan.report)).toContain('100 new, 0 already there, 0 failed')
  })

  test('snapshots of a few mapped entries', () => {
    const pick = (slug: string) => {
      const m = mapLaunchShwarm(LIST.find(e => e.slug === slug))
      return { input: m.input, pinned: m.pinned, notes: m.notes }
    }
    for (const slug of ['bot-beats-freedoom', 'minecraft-in-doom', 'mosquito-hearing-chip', 'map-sherlock-holmes', 'minecraft-in-doom-survival']) expect(pick(slug)).toMatchSnapshot(slug)
  })

  test('why_now goes in as the last paragraph of what', () => {
    const m = mapLaunchShwarm(LIST[0])
    expect(m.input.what).toBe(`${LIST[0].what}\n\nwhy now: ${LIST[0].why_now}`)
  })

  test('variants are dropped (Oct 9): a #variant entry goes in as a plain shwarm, its tag kept; an explicit variant_of says so', () => {
    const e = LIST.find(e => e.slug === 'minecraft-in-doom-survival')
    const m = mapLaunchShwarm(e)
    expect(m.input).toMatchObject({ kind: 'shwarm' })
    expect(m.input).not.toHaveProperty('variantOf')
    expect(m.input.tags).toContain('variant')
    expect(m.notes.filter(n => n.field === 'kind' || n.field === 'variant_of')).toEqual([])
    expect(mapLaunchShwarm({ ...e, variant_of: 'minecraft-in-doom' }).notes).toContainEqual({ field: 'variant_of', kind: 'dropped', text: 'variants are dropped; imported as a plain shwarm' })
  })

  test('broken entries fail with a reason', () => {
    const base = LIST[0]
    const failed = (e: unknown) => mapLaunchShwarm(e).notes.filter(n => n.kind === 'failed').map(n => n.field)
    expect(failed({ ...base, slug: 'Bad Slug' })).toEqual(['slug'])
    expect(failed({ ...base, tags: ['#not a tag'] })).toEqual(['tags'])
    expect(failed({ ...base, sources: ['ftp://x'] })).toEqual(['sources'])
    expect(failed({ ...base, checked_by: { runs: {}, people: {}, author: false } })).toEqual(['checked_by'])
    expect(failed({ ...base, checked_by: { runs: { command: 'ok "unclosed', count: 1 }, author: false } })).toEqual(['check.runs'])
    expect(failed({ ...base, done_when: '' })).toEqual(['done_when'])
  })
})

describe('splitting a run command from its description', () => {
  const split = (s: string) => {
    const r = splitRunCommand(s)
    return { command: r.command, description: r.description, failed: r.notes.some(n => n.kind === 'failed') }
  }
  test('a trailing description', () => {
    expect(split('python replay.py demos/ (replays each demo and prints the time)')).toEqual({ command: 'python replay.py demos/', description: 'replays each demo and prints the time', failed: false })
  })
  test('a description in the middle keeps the rest of the command', () => {
    expect(split('./bench.sh (plays the demo and prints fps) && ./license-scan.sh mcdoom.pk3')).toEqual({
      command: './bench.sh && ./license-scan.sh mcdoom.pk3',
      description: 'plays the demo and prints fps',
      failed: false,
    })
  })
  test('an apostrophe in the description is prose', () => {
    expect(split("./verify proof.log (checks every position's value right now)").command).toBe('./verify proof.log')
  })
  test('shell stays shell: subshells, $( ), quotes and comments are left alone', () => {
    for (const s of [
      '(cd lo && make check)',
      'make (cd sub && make) done',
      'for i in $(cat oldest100.txt); do echo $i; done',
      `python3 -c "print({k:(d[k] or 1) for k in (84, 92)})"`,
      "jq '[.[]] | last | (.fail|tonumber) + (.error|tonumber)'",
      'lake build   # or: python3 check.py passage.json (exact rationals here)',
      'make (two words)',
    ])
      expect(split(s)).toEqual({ command: s, description: undefined, failed: false })
  })
  test('broken or hidden characters fail', () => {
    expect(split('echo "unclosed').failed).toBe(true)
    expect(split('echo )').failed).toBe(true)
    expect(split('rm -rf /tmp/x ‮').failed).toBe(true)
    expect(split('a\nb').failed).toBe(true)
  })
})

describe('builds on', () => {
  test('licenses are normalized to their ids', () => {
    const ids = (s: string) => findLicenses(s).map(f => f.id)
    expect(ids('(cc by-sa 4.0)')).toEqual(['CC-BY-SA-4.0'])
    expect(ids('(cc by 4.0 data, mit code)')).toEqual(['CC-BY-4.0', 'MIT'])
    expect(ids('(agpl-3.0)')).toEqual(['AGPL-3.0'])
    expect(ids('uzdoom (gpl, active fork)')).toEqual(['GPL-3.0'])
    expect(ids('public-domain hymn')).toEqual(['public domain'])
    expect(ids('submit and smith')).toEqual([])
    expect(ids('https://example.org/mit/thing')).toEqual([])
  })
  test('one upstream with a license becomes {name, url, license}', () => {
    expect(parseBuildsOn('GB Studio (mit) https://github.com/chrismaltby/gb-studio')).toMatchObject({
      buildsOn: { name: 'GB Studio', url: 'https://github.com/chrismaltby/gb-studio', license: 'MIT' },
      keepText: false,
    })
  })
  test('MIT code with CC BY 4.0 data is the A2 default pair', () => {
    expect(parseBuildsOn('humbugdb (cc by 4.0 data, mit code) https://zenodo.org/record/4904800').buildsOn?.license).toBe('MIT+CC-BY-4.0')
  })
  test('several upstreams: the first with a license wins, the text goes in the pinned post', () => {
    const r = parseBuildsOn('Natural Earth (public domain) https://www.naturalearthdata.com + YASS (gpl-3.0) https://github.com/joriswit/YASS')
    expect(r.buildsOn).toEqual({ name: 'YASS', url: 'https://github.com/joriswit/YASS', license: 'GPL-3.0' })
    expect(r.keepText).toBe(true)
  })
  test('a URL in brackets, and a license after the URL', () => {
    expect(parseBuildsOn("ayab (https://ayab-knitting.com) and ed hawkins' warming stripes, cc by 4.0 (https://showyourstripes.info)").buildsOn).toEqual({
      name: "ed hawkins' warming stripes",
      url: 'https://showyourstripes.info',
      license: 'CC-BY-4.0',
    })
    expect(parseBuildsOn('electricitymaps-contrib, https://github.com/electricitymaps/electricitymaps-contrib (agpl-3.0)').buildsOn?.license).toBe('AGPL-3.0')
  })
  test('no license, or public domain: no builds_on, the default license, the text kept', () => {
    for (const s of ['LaTeXML https://github.com/brucemiller/LaTeXML', 'natural earth land polygons, public domain: https://www.naturalearthdata.com/']) {
      const r = parseBuildsOn(s)
      expect(r.buildsOn).toBeNull()
      expect(r.keepText).toBe(true)
      expect(r.notes.map(n => n.kind)).toEqual(['dropped'])
    }
    expect(parseBuildsOn(null)).toEqual({ buildsOn: null, keepText: false, notes: [] })
  })
  test('an object in the JSON is taken as written', () => {
    expect(parseBuildsOn({ name: 'freedoom', url: 'https://github.com/freedoom/freedoom', license: 'BSD-3-Clause' }).buildsOn?.license).toBe('BSD-3-Clause')
    expect(parseBuildsOn({ name: 'x', license: '' } as any).notes[0].kind).toBe('failed')
  })
})

describe('SQL literals', () => {
  const raw = testDb().raw
  const roundTrip = (v: unknown) => raw.prepare(`SELECT ${sqlLiteral(v)} AS v`).get().v
  test('strings survive quotes, backslashes, unicode, newlines and NUL', () => {
    for (const s of [
      "it's",
      "''; DROP TABLE node; --",
      'back\\slash \\n not a newline',
      'naïve café 日本語 🧱 ‮ rtl ​ zwsp',
      'line one\nline two\r\nthree\ttab',
      'nul \u0000 inside',
      '\u0000',
      '',
      '?1 ? :name @x $y',
      '/* not a comment */ -- nor this',
    ]) {
      // compare bytes: Node 22's node:sqlite cuts strings at NUL when reading them back (D1 doesn't)
      expect(raw.prepare(`SELECT hex(${sqlLiteral(s)}) AS h`).get().h).toBe(Buffer.from(s, 'utf8').toString('hex').toUpperCase())
      expect(sqlLiteral(s)).not.toMatch(/[\x00-\x1f]/) // one line, always
    }
  })
  test('quotes are doubled, control characters become char()', () => {
    expect(sqlString("a'b")).toBe("'a''b'")
    expect(sqlString('a\nb')).toBe("('a' || char(10) || 'b')")
    expect(sqlString('\u0000')).toBe('(char(0))')
  })
  test('a lone surrogate is refused', () => {
    expect(() => sqlString('bad \ud800 half')).toThrow(/surrogate/)
  })
  test('numbers, booleans, null and bytes', () => {
    expect(roundTrip(42)).toBe(42)
    expect(roundTrip(-5)).toBe(-5)
    expect(roundTrip(0.25)).toBe(0.25)
    expect(roundTrip(1e-7)).toBe(1e-7)
    expect(roundTrip(true)).toBe(1)
    expect(roundTrip(null)).toBe(null)
    expect(roundTrip(undefined)).toBe(null)
    expect(sqlLiteral(12n)).toBe('12')
    expect(sqlLiteral(new Uint8Array([0, 255, 16]))).toBe("X'00ff10'")
    expect(() => sqlLiteral(NaN)).toThrow()
    expect(() => sqlLiteral(Infinity)).toThrow()
    expect(() => sqlLiteral({})).toThrow()
  })
  test('local ids become subqueries, also inside strings; an unknown one is refused', () => {
    const ids = new Map([[SENTINEL_MIN + 3, "(SELECT id FROM node WHERE path = 'x')"]])
    expect(sqlLiteral(SENTINEL_MIN + 3, ids)).toBe("(SELECT id FROM node WHERE path = 'x')")
    expect(sqlLiteral(`thread:5:${SENTINEL_MIN + 3}`, ids)).toBe("('thread:5:' || (SELECT id FROM node WHERE path = 'x'))")
    expect(sqlLiteral('a long number 12345678901234 stays', ids)).toBe("'a long number 12345678901234 stays'")
    expect(() => sqlLiteral(SENTINEL_MIN + 4, ids)).toThrow(/no stand-in/)
  })
})

describe('rendering statements', () => {
  test('? and ?N follow SQLite numbering; quoted text and comments are left alone', () => {
    expect(renderStatement('SELECT ?, ?, ?', [1, 'a', null])).toBe("SELECT 1, 'a', NULL;")
    expect(renderStatement('SELECT ?2, ?1, ?2', ['x', 'y'])).toBe("SELECT 'y', 'x', 'y';")
    expect(renderStatement("SELECT '?', \"?\", ? -- a ? here\n FROM t /* ? */ WHERE x = ?", [1, 2])).toBe(`SELECT '?', "?", 1 FROM t WHERE x = 2;`)
    expect(renderStatement('SELECT ?1, ?', [1, 2])).toBe('SELECT 1, 2;')
  })
  test('whitespace collapses to one line', () => {
    expect(renderStatement('INSERT INTO t\n  (a, b)\n  VALUES (?, ?)', ['x\ny', 2])).toBe("INSERT INTO t (a, b) VALUES (('x' || char(10) || 'y'), 2);")
  })
  test('a negative number never makes a -- comment', () => {
    expect(renderStatement('SELECT 1 -?', [-5])).toBe('SELECT 1 -(-5);')
  })
  test('wrong bind counts and named placeholders throw', () => {
    expect(() => renderStatement('SELECT ?, ?', [1])).toThrow()
    expect(() => renderStatement('SELECT ?', [1, 2])).toThrow()
    expect(() => renderStatement('SELECT :name', [])).toThrow()
    expect(() => renderStatement("SELECT 'open", [])).toThrow()
  })
})

describe('the plan end to end', () => {
  test('applied to a staging-like database: 100 seeded shwarms, live at once (plus the example), @myra working on each, pinned sources', async () => {
    const { db, myraId } = await stagingLike()
    const copy = testDb()
    const plan = await planSeed(copy, LIST, stateOf(db), { target: 'staging', now: NOW, example: true })
    expect(plan.report.failures).toBe(0)
    expect(plan.report.example.status).toBe('new')
    expect(plan.newPaths).toHaveLength(101)
    db.raw.exec(plan.sql)

    const nodes = db.raw.prepare("SELECT n.*, s.person_id AS seat1 FROM node n LEFT JOIN seat s ON s.node_id = n.id AND s.number = 1 WHERE n.kind <> 'branch'").all()
    expect(nodes).toHaveLength(100)
    for (const n of nodes) {
      expect(n.seeded, n.path).toBe(1)
      expect(n.seat1, n.path).toBe(myraId)
      expect(n.author_id).toBe(myraId)
      expect(n.posted_by).toBe('@myra')
      expect(n.state, n.path).toBe('live') // no lobby (decided Oct 9)
      expect(n.live_at, n.path).toBe(n.created_at)
      const pin = db.raw.prepare('SELECT * FROM post WHERE id = ?').get(n.pinned_post_id)
      expect(pin.person_id).toBe(myraId)
      expect(pin.as_name).toBe('@myra')
      expect(pin.text.split('\n')[0]).toBe('where this pitch comes from:')
      expect(seededLogRow(n)?.detail).toBe('seeded by @myra at launch') // A18
    }
    expect(db.raw.prepare("SELECT kind, variant_of_id FROM node WHERE path = 'minecraft-in-doom-survival'").get()).toMatchObject({ kind: 'shwarm', variant_of_id: null })
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_event WHERE event = 'lobby_filled'").get().n).toBe(0)
    // The text went in exactly as core wrote it on the copy: compare the rows that matter, ids aside.
    const rows = (d: any, sql: string) => d.raw.prepare(sql).all().map((r: any) => JSON.stringify(r))
    const nodeSql = "SELECT path, title, what, done_when, checks, license, builds_on, state, posted_by, created_at, live_at, pinned_post_id, last_event_id, in_review, seeded FROM node WHERE path NOT LIKE ':%' AND hidden = 0 ORDER BY path"
    expect(rows(db, nodeSql)).toEqual(rows(copy, nodeSql))
    for (const sql of [
      'SELECT id, as_name, key_id, kind, text, links, reply_to, created_at FROM post ORDER BY id',
      'SELECT post_id, number, hash, how_to_check, status, superseded_by, author_swap FROM submission ORDER BY post_id',
      'SELECT id, post_id, slot, verdict, evidence, repro, submission_hash, exit_code, log_inline, machine FROM check_report ORDER BY id',
      'SELECT id, at, event, by_name, submission_id, number, detail FROM audit_event ORDER BY id',
      'SELECT n.path, t.tag FROM node_tag t JOIN node n ON n.id = t.node_id ORDER BY 1, 2',
      'SELECT m.post_id, m.to_name, p.handle FROM mention m JOIN person p ON p.id = m.to_person ORDER BY 1, 2',
    ])
      expect(rows(db, sql), sql).toEqual(rows(copy, sql))
  })

  test('the running example matches the mockups: live branch, #2 in review with 3 of 4 checks, author pin', async () => {
    const { db } = await stagingLike()
    const plan = await planSeed(testDb(), LIST, stateOf(db), { target: 'staging', now: NOW, example: true })
    db.raw.exec(plan.sql)
    const b = db.raw.prepare('SELECT n.*, p.handle AS author FROM node n JOIN person p ON p.id = n.author_id WHERE path = ?').get(EXAMPLE_BRANCH)
    expect(b).toMatchObject({ kind: 'branch', state: 'live', in_review: 1, license: 'GPL-3.0', author: 'bmo_fan', seeded: 0 })
    const subs = db.raw.prepare('SELECT number, status FROM submission WHERE node_id = ? ORDER BY number').all(b.id).map((r: any) => ({ ...r }))
    expect(subs).toEqual([{ number: 1, status: 'superseded' }, { number: 2, status: 'in_review' }])
    const two = db.raw.prepare('SELECT post_id FROM submission WHERE node_id = ? AND number = 2').get(b.id).post_id
    expect(db.raw.prepare("SELECT count(*) AS n FROM check_report WHERE submission_id = ? AND verdict = 'pass'").get(two).n).toBe(3)
    expect(db.raw.prepare('SELECT text FROM post WHERE id = ?').get(b.pinned_post_id).text).toMatch(/^where we are:/)
    const bmo = db.raw.prepare("SELECT id FROM person WHERE handle = 'bmo_fan'").get().id
    expect(db.raw.prepare("SELECT count(*) AS n FROM inbox_item WHERE person_id = ? AND kind = 'sign_off'").get(bmo).n).toBe(1)
    // Demo accounts can't sign in.
    for (const h of EXAMPLE_PEOPLE) expect(db.raw.prepare('SELECT password_hash FROM person WHERE handle = ?').get(h).password_hash).toMatch(/^!/)
  })

  test("the seed's pinned sources post is never a status line: seeded shwarms say where they are from recorded state (table B #40, A18)", async () => {
    const { db } = await stagingLike()
    db.raw.exec((await planSeed(testDb(), LIST, stateOf(db), { target: 'staging', now: NOW, example: true })).sql)
    // A seed post without the heading (only a builds-on line) is still the seed's: it went in with the node.
    db.raw.prepare("UPDATE post SET text = 'builds on: gzdoom' WHERE id = (SELECT pinned_post_id FROM node WHERE path = 'bot-beats-freedoom')").run()
    await rollupStats(db, NOW + 60_000)
    const rows = db.raw
      .prepare('SELECT n.path, n.state, s.status_line, p.text AS pinned FROM node n JOIN node_stats s ON s.node_id = n.id LEFT JOIN post p ON p.id = n.pinned_post_id WHERE n.seeded = 1')
      .all()
      .map((r: any) => ({ ...r }))
    expect(rows.length).toBeGreaterThan(90)
    for (const r of rows) {
      expect(r.status_line, r.path).not.toMatch(/where this pitch comes from|^builds on:/)
      if (r.path !== EXAMPLE_ROOT && r.pinned) expect(r.status_line, r.path).toBe('no submission yet.')
    }
    expect(rows.find((r: any) => r.path === 'bot-beats-freedoom')).toMatchObject({ pinned: 'builds on: gzdoom', status_line: 'no submission yet.' })
    // The running example's branch keeps its author's pinned post.
    expect(db.raw.prepare('SELECT s.status_line FROM node_stats s JOIN node n ON n.id = s.node_id WHERE n.path = ?').get(EXAMPLE_BRANCH).status_line).toMatch(/^where we are:/)
  })

  test('rerunning skips every slug already there and plans nothing', async () => {
    const { db } = await stagingLike()
    db.raw.exec((await planSeed(testDb(), LIST, stateOf(db), { target: 'staging', now: NOW, example: true })).sql)
    const again = await planSeed(testDb(), LIST, stateOf(db), { target: 'staging', now: NOW + 60_000, example: true })
    expect(again.report.failures).toBe(0)
    expect(again.report.shwarms.every(s => s.status === 'exists')).toBe(true)
    expect(again.report.example.status).toBe('exists')
    expect(again.newPaths).toEqual([])
    expect(formatReport(again.report)).toContain('0 new, 100 already there')
  })

  test('a partial import, then the rest', async () => {
    const { db } = await stagingLike()
    const first = await planSeed(testDb(), LIST, stateOf(db), { target: 'staging', now: NOW, example: false, only: ['bot-beats-freedoom', 'kart-race-on-the-moon'] })
    db.raw.exec(first.sql)
    const rest = await planSeed(testDb(), LIST, stateOf(db), { target: 'staging', now: NOW, example: false })
    expect(rest.report.shwarms.filter(s => s.status === 'exists').map(s => s.slug)).toEqual(['bot-beats-freedoom', 'kart-race-on-the-moon'])
    db.raw.exec(rest.sql)
    expect(db.raw.prepare('SELECT count(*) AS n FROM node WHERE seeded = 1').get().n).toBe(100)
  })

  test('the guards stop a stale file at its first statement', async () => {
    const { db } = await stagingLike()
    const plan = await planSeed(testDb(), LIST, stateOf(db), { target: 'staging', now: NOW, example: true })
    db.raw.exec(plan.sql)
    const count = () => db.raw.prepare('SELECT (SELECT count(*) FROM node) + (SELECT count(*) FROM post) + (SELECT count(*) FROM person) AS n').get().n
    const before = count()
    expect(() => db.raw.exec(plan.sql)).toThrow(/NOT NULL constraint failed: meta.value/)
    expect(count()).toBe(before)
    // @myra changed (a different id): stopped too.
    const other = testDb()
    await addPerson(other, 'myra')
    other.raw.prepare("UPDATE person SET email_verified_at = 'x'").run()
    expect(() => other.raw.exec(plan.sql)).toThrow(/NOT NULL constraint failed: meta.value/)
    expect(other.raw.prepare('SELECT count(*) AS n FROM node').get().n).toBe(0)
  })

  test('staging without a verified @myra is refused; offline makes a local one', async () => {
    const noMyra = await planSeed(testDb(), LIST, EMPTY, { target: 'staging', now: NOW, example: false })
    expect(noMyra.report.problems[0]).toMatch(/no @myra account on staging/)
    expect(noMyra.sql).toBe('')
    const unverified = await planSeed(testDb(), LIST, { ...EMPTY, myra: { id: 3, handle: 'myra', status: 'active', email_verified_at: null, founding: 0, established_at: null } }, { target: 'staging', now: NOW, example: false })
    expect(unverified.report.problems[0]).toMatch(/verified/)
    const db = testDb()
    db.raw.exec((await planSeed(testDb(), LIST, EMPTY, { target: 'offline', now: NOW, example: false })).sql)
    expect(db.raw.prepare("SELECT password_hash FROM person WHERE handle = 'myra'").get().password_hash).toMatch(/^!/)
  })

  test('read_only on the target stops the plan; pause_new_nodes does not (go-live 3.10)', async () => {
    const { db } = await stagingLike()
    db.raw.prepare("UPDATE setting SET value = 'true' WHERE key = 'pause_new_nodes'").run()
    expect((await planSeed(testDb(), LIST, stateOf(db), { target: 'staging', now: NOW, example: false })).report.failures).toBe(0)
    db.raw.prepare("UPDATE setting SET value = 'true' WHERE key = 'read_only'").run()
    const ro = await planSeed(testDb(), LIST, stateOf(db), { target: 'staging', now: NOW, example: false })
    expect(ro.report.failures).toBe(100)
    expect(ro.sql).toBe('')
  })
})

describe('production', () => {
  const args = (s: string, tty = true) => {
    const a = parseArgs(s.split(' ').filter(Boolean))
    checkArgs(a, tty)
    return a
  }
  test('refused without --allow-production and named slugs; never --replace, --yes or the example', () => {
    expect(() => args('--target production')).toThrow(Refused)
    expect(() => args('--target production --slugs a,b')).toThrow(/allow-production/)
    expect(() => args('--target production --allow-production')).toThrow(/name their slugs/)
    expect(() => args('--target production --allow-production --slugs a --replace')).toThrow(/never runs on production/)
    expect(() => args('--target production --allow-production --slugs a --yes')).toThrow(/--yes/)
    expect(() => args('--target staging --allow-production')).toThrow(/only with --target production/)
    expect(args('--target production --allow-production --slugs a,b')).toMatchObject({ target: 'production', slugs: ['a', 'b'], example: false })
  })
  test('with no terminal, production is refused: wrangler would apply without asking', () => {
    expect(() => args('--target production --allow-production --slugs a', false)).toThrow(/only from a terminal/)
    expect(args('--target production --allow-production --slugs a --dry-run', false)).toMatchObject({ dryRun: true })
    expect(args('--target staging', false)).toMatchObject({ target: 'staging' })
  })
  test('other argument mistakes', () => {
    expect(() => args('')).toThrow(/say where/)
    expect(() => args('--target prod')).toThrow(/local, staging or production/)
    expect(() => args('--offline --target staging')).toThrow()
    expect(() => args('--target staging --replace --dry-run')).toThrow()
    expect(() => args('--bogus')).toThrow(/unknown option/)
    expect(args('--offline')).toMatchObject({ offline: true, dryRun: true })
  })
  test('the plan itself refuses production without slugs, or with the example', async () => {
    expect(() => checkTarget({ target: 'production', now: NOW, example: false })).toThrow()
    expect(() => checkTarget({ target: 'production', now: NOW, example: true, only: ['x'] })).toThrow()
    await expect(planSeed(testDb(), LIST, EMPTY, { target: 'production', now: NOW, example: false })).rejects.toThrow()
  })
  test('an approved slug goes in alone; an unknown slug is a problem', async () => {
    const { db } = await stagingLike()
    const plan = await planSeed(testDb(), LIST, stateOf(db), { target: 'production', now: NOW, example: false, only: ['bot-beats-freedoom'] })
    expect(plan.newPaths).toEqual(['bot-beats-freedoom'])
    db.raw.exec(plan.sql)
    expect(db.raw.prepare('SELECT count(*) AS n FROM node').get().n).toBe(1)
    expect(db.raw.prepare("SELECT count(*) AS n FROM person WHERE handle = 'bmo_fan'").get().n).toBe(0)
    const unknown = await planSeed(testDb(), LIST, stateOf(db), { target: 'production', now: NOW, example: false, only: ['no-such-shwarm'] })
    expect(unknown.report.problems).toEqual(['no-such-shwarm is not in the launch list'])
  })
})

describe('core additions for the seed', () => {
  test('runs.description is kept beside the command', () => {
    expect(parseCheckSpec({ runs: { command: './a.sh', count: 1, description: ' plays it ' } })).toEqual({ runs: { command: './a.sh', count: 1, description: 'plays it' }, author: false })
    expect(() => parseCheckSpec({ runs: { command: './a.sh', description: 5 } })).toThrow()
  })
  test('only the seed sets a slug', async () => {
    const w = new World()
    const myra = await person(w.db, 'myra')
    await refused(w.run({ type: 'createNode', actor: site(myra), input: { kind: 'shwarm', slug: 'x', title: 't', what: 'w', doneWhen: 'd', check: { author: true }, tags: ['a'] } }), 'bad_request')
    const seed = { ...site(myra), via: 'seed' as const }
    const input = { kind: 'shwarm' as const, slug: 'short-name', title: 'a much longer title', what: 'w', doneWhen: 'd', check: { author: true }, tags: ['a'] }
    expect((await w.run({ type: 'createNode', actor: seed, input })).path).toBe('short-name')
    await refused(w.run({ type: 'createNode', actor: seed, input }), 'bad_request')
    await refused(w.run({ type: 'createNode', actor: seed, input: { ...input, slug: 'Not OK' } }), 'bad_request')
  })
  test('only the author pins, as the bare handle', async () => {
    const w = new World()
    const myra = await person(w.db, 'myra')
    const finn = await person(w.db, 'finn_irl')
    await w.shwarm(site(myra))
    await refused(w.post(site(finn), 'minecraft-in-doom', 'mine now', { pin: true }), 'not_permitted')
    const p = await w.post(site(myra), 'minecraft-in-doom', 'where we are: nothing yet.', { pin: true })
    expect(w.node('minecraft-in-doom').pinned_post_id).toBe(p.id)
    const q = await w.post(site(myra), 'minecraft-in-doom', 'where we are: renderer done.', { pin: true })
    expect(w.node('minecraft-in-doom').pinned_post_id).toBe(q.id)
  })
})

describe('review fixes (go-live 3.1)', () => {
  const failedFields = (e: unknown) => mapLaunchShwarm(e).notes.filter(n => n.kind === 'failed').map(n => n.field)

  test('a launch entry that was a variant goes in alone, as a plain shwarm, whatever its old original is doing', async () => {
    const { db } = await stagingLike()
    db.raw.exec((await planSeed(testDb(), LIST, stateOf(db), { target: 'production', now: NOW, example: false, only: ['minecraft-in-doom'] })).sql)
    db.raw.prepare("UPDATE node SET state = 'closed', hidden = 1 WHERE path = 'minecraft-in-doom'").run()
    const plan = await planSeed(testDb(), LIST, stateOf(db), { target: 'production', now: NOW, example: false, only: ['minecraft-in-doom-survival'] })
    expect(plan.report.failures).toBe(0)
    expect(plan.newPaths).toEqual(['minecraft-in-doom-survival'])
    db.raw.exec(plan.sql)
    expect(db.raw.prepare("SELECT kind, state, variant_of_id, seeded FROM node WHERE path = 'minecraft-in-doom-survival'").get()).toMatchObject({ kind: 'shwarm', state: 'live', variant_of_id: null, seeded: 1 })
  })

  test('non-commercial, no-derivatives and unknown licenses fail; they are never read as an open one', () => {
    const failed = (v: any) => parseBuildsOn(v).notes.some(n => n.kind === 'failed')
    for (const s of ['some dataset (cc by-nc 4.0) https://example.org/d', 'x (cc by-nc-sa 4.0) https://example.org/d', 'x (cc by-nd) https://example.org/d', 'x, non-commercial use only https://example.org/d'])
    {
      expect(parseBuildsOn(s).buildsOn, s).toBeNull()
      expect(failed(s), s).toBe(true)
    }
    for (const s of ['lib (mpl-2.0) https://example.org/l', 'lib (eupl) https://example.org/l', 'font (ofl) https://example.org/f', 'lib (mit, mpl-2.0) https://example.org/l'])
      expect(failed(s), s).toBe(true)
    for (const license of ['CC-BY-NC-4.0', 'proprietary', 'none', 'MPL-2.0', 'gpl']) expect(failed({ name: 'x', license }), license).toBe(true)
    expect(parseBuildsOn({ name: 'x', license: 'mit' })).toMatchObject({ buildsOn: { license: 'MIT' }, notes: [{ kind: 'normalized' }] })
    expect(parseBuildsOn({ name: 'x', license: 'GPL-2.0' }).notes.map(n => n.kind)).toEqual(['warning'])
    expect(parseBuildsOn({ name: 'x', license: 'GPL-3.0' }).notes).toEqual([])
  })

  test('malformed or unknown fields are reported, never dropped quietly', () => {
    const base = LIST[0]
    const people = (p: any) => failedFields({ ...base, checked_by: { ...base.checked_by, people: p } })
    expect(people({ human: true, instructions: 'watch two replays' })).toEqual(['check.people'])
    expect(people({ count: 2, human: 'true' })).toEqual(['check.people'])
    expect(people({ count: 2, human: 1 })).toEqual(['check.people'])
    expect(failedFields({ ...base, checked_by: { runs: { description: 'plays the demo' }, author: true } })).toEqual(['check.runs'])
    expect(failedFields({ ...base, checked_by: { author: 'yes' } })).toEqual(['check.author'])
    expect(failedFields({ ...base, license: 'GPL-3.0' })).toEqual(['license'])
    const warned = mapLaunchShwarm({ ...base, variantof: 'minecraft-in-doom', 'why now': 'x', checked_by: { ...base.checked_by, peeple: {} } }).notes.filter(n => n.kind === 'warning' && n.text.startsWith('ignored'))
    expect(warned.map(n => n.text)).toEqual([expect.stringContaining('variantof'), expect.stringContaining('why now'), expect.stringContaining('peeple')])
  })

  test('brackets after a command that runs another stay in the command, as a subshell', () => {
    for (const s of ['time (python bench.py --runs 10)', 'nice -n 10 (make check all)', 'FOO=1 timeout 60 (python a.py b c)', 'make && time (python bench.py now)']) {
      const r = splitRunCommand(s)
      expect(r.command, s).toBe(s)
      expect(r.description).toBeUndefined()
      expect(r.notes.map(n => n.kind)).toEqual(['warning'])
    }
    expect(splitRunCommand('./bench.sh (plays the demo and prints fps)').description).toBe('plays the demo and prints fps')
  })

  /** A stand-in for wrangler: answers the seeded-count query, records every call. */
  const fakeWrangler = (seeded: () => number) => {
    const calls: string[] = []
    const w: Wrangler = args => {
      calls.push(args.slice(0, 3).join(' '))
      if (args.includes('--command')) return JSON.stringify([{ results: [{ n: seeded() }] }])
      if (args[1] === 'time-travel' && args[2] === 'info') return JSON.stringify({ bookmark: 'bm-now' })
      return ''
    }
    return { w, calls }
  }
  const stateFile = () => join(mkdtempSync(join(tmpdir(), 'seed-state-')), 'seed-state.json')

  test('a bookmark is saved only while staging holds no seeded node', () => {
    const quiet = console.log
    console.log = () => {}
    try {
      const seeded = stateFile()
      bookmarkBeforeFirstSeed(fakeWrangler(() => 3).w, seeded)
      expect(existsSync(seeded)).toBe(false)
      const fresh = stateFile()
      bookmarkBeforeFirstSeed(fakeWrangler(() => 0).w, fresh)
      expect(JSON.parse(readFileSync(fresh, 'utf8')).staging.bookmark).toBe('bm-now')
    } finally {
      console.log = quiet
    }
  })

  test('--replace on staging applies the migrations again after the restore, and stops if the restore was declined', () => {
    const quiet = console.log
    console.log = () => {}
    try {
      const file = stateFile()
      writeFileSync(file, JSON.stringify({ staging: { bookmark: 'bm-1', at: '2026-10-01T00:00:00Z' } }))
      const ok = fakeWrangler(() => 0)
      reset('staging', ok.w, file)
      expect(ok.calls).toEqual(['d1 time-travel restore', 'd1 execute DB', 'd1 migrations apply'])
      const declined = fakeWrangler(() => 100)
      expect(() => reset('staging', declined.w, file)).toThrow(/did not happen/)
      expect(declined.calls).not.toContain('d1 migrations apply')
    } finally {
      console.log = quiet
    }
  })
})
