import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backup, dumpDatabase, KEEP_DAYS, pruneBackups } from '../src/jobs/backup'
import { MAIL_CRON, scheduled } from '../src/jobs'
import { stagingWorld } from './node-fixture'
import { T0, testDb } from './d1'

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

afterEach(() => vi.restoreAllMocks())

/** An R2 bucket over a Map: put, get, list (one page), delete. */
function fakeBucket(keys: string[] = []) {
  const store = new Map<string, Uint8Array>(keys.map(k => [k, new Uint8Array()]))
  const bucket = {
    store,
    async put(key: string, body: Uint8Array | string) {
      store.set(key, typeof body === 'string' ? new TextEncoder().encode(body) : body)
      return {}
    },
    async get(key: string) {
      return store.has(key) ? { text: async () => new TextDecoder().decode(store.get(key)) } : null
    },
    async list(o: { prefix?: string }) {
      return { objects: [...store.keys()].filter(k => k.startsWith(o.prefix ?? '')).sort().map(key => ({ key })), truncated: false }
    },
    async delete(k: string | string[]) {
      for (const key of [k].flat()) store.delete(key)
    },
  }
  return bucket as typeof bucket & R2Bucket
}

/** The source: the staging fixture, plus the values a dump gets wrong first. */
async function seeded() {
  const { db } = await stagingWorld()
  const run = (sql: string, ...a: unknown[]) => db.raw.prepare(sql).run(...a)
  run("INSERT INTO meta (key, value) VALUES ('odd', ?)", "it's \"quoted\";\nDELETE FROM person; -- not a comment\r\n\t✓ ünïcode 🐝")
  // quote() alone would cut this at the NUL; a BLOB in a TEXT column stays a BLOB
  run("INSERT INTO meta (key, value) VALUES ('nul', ?), ('blob', ?)", 'a\u0000b', new Uint8Array([0, 1, 255, 39]))
  run("INSERT INTO rate_bucket (bucket, tokens, updated_at) VALUES ('real', ?, ?)", 0.1 + 0.2, iso(T0))
  run("INSERT INTO rate_bucket (bucket, tokens, updated_at) VALUES ('tiny', ?, ?)", 1e-300, iso(T0))
  const node = (db.raw.prepare('SELECT id FROM node ORDER BY id LIMIT 1').get() as any).id
  // audit_event refuses deletes: the restore must still go through
  run("INSERT INTO audit_event (id, at, event, node_id, number, detail) VALUES ('e_big', ?, 'check', ?, ?, '')", iso(T0), node, 9007199254740993n)
  // an AUTOINCREMENT id used and deleted stays used
  run("INSERT INTO handle_hold (handle, created_at) VALUES ('a', ?), ('b', ?)", iso(T0), iso(T0))
  run("DELETE FROM handle_hold WHERE handle = 'b'")
  return db
}

const restore = (sql: string) => {
  const fresh = testDb()
  fresh.raw.exec('BEGIN')
  fresh.raw.exec(sql)
  fresh.raw.exec('COMMIT')
  return fresh
}

describe('the nightly dump (go-live 11.1)', () => {
  it('round-trips: loaded into a fresh migrated database, every table has the same rows', async () => {
    const db = await seeded()
    const dump = await dumpDatabase(db, T0)
    const fresh = restore(dump.sql)
    const rows = (d: any, sql: string) => d.raw.prepare(sql).all().map((r: any) => ({ ...r }))

    for (const [t, n] of Object.entries(dump.tables)) {
      expect(rows(db, `SELECT COUNT(*) AS n FROM "${t}"`)[0].n, t).toBe(n)
      expect(rows(fresh, `SELECT COUNT(*) AS n FROM "${t}"`)[0].n, t).toBe(n)
    }
    expect(dump.tables.node).toBeGreaterThan(2)
    expect(dump.tables.disposable_domain).toBeGreaterThan(9000) // more than one page
    for (const sql of ['SELECT * FROM node ORDER BY id', 'SELECT * FROM person ORDER BY id', 'SELECT * FROM meta ORDER BY key', 'SELECT * FROM setting ORDER BY key'])
      expect(rows(fresh, sql)).toEqual(rows(db, sql))
    const exact = (d: any, sql: string) => {
      const st = d.raw.prepare(sql)
      st.setReadBigInts(true)
      return st.all().map((r: any) => ({ ...r }))
    }
    expect(exact(fresh, 'SELECT * FROM audit_event ORDER BY id')).toEqual(exact(db, 'SELECT * FROM audit_event ORDER BY id'))
    expect(exact(fresh, "SELECT number FROM audit_event WHERE id = 'e_big'")).toEqual([{ number: 9007199254740993n }])
    expect(rows(fresh, "SELECT tokens FROM rate_bucket WHERE bucket IN ('real', 'tiny') ORDER BY bucket")).toEqual([{ tokens: 0.1 + 0.2 }, { tokens: 1e-300 }])
    const kept = "SELECT key, typeof(value) AS t, hex(value) AS h FROM meta WHERE key IN ('nul', 'blob') ORDER BY key"
    expect(rows(fresh, kept)).toEqual([{ key: 'blob', t: 'blob', h: '0001FF27' }, { key: 'nul', t: 'text', h: '610062' }])
    expect(rows(fresh, "SELECT value FROM meta WHERE key = 'odd'")[0].value).toBe("it's \"quoted\";\nDELETE FROM person; -- not a comment\r\n\t✓ ünïcode 🐝")
    // the full-text index is filled again by its trigger; the AUTOINCREMENT counter is where it was
    const word = (rows(db, 'SELECT title FROM node ORDER BY id LIMIT 1')[0].title as string).split(/\W+/).find(w => w.length > 3)
    expect(rows(fresh, `SELECT rowid FROM node_fts WHERE node_fts MATCH '${word}' ORDER BY rowid`)).toEqual(rows(db, `SELECT rowid FROM node_fts WHERE node_fts MATCH '${word}' ORDER BY rowid`))
    expect(rows(fresh, "SELECT seq FROM sqlite_sequence WHERE name = 'handle_hold'")).toEqual([{ seq: 2 }])
    expect(rows(fresh, 'PRAGMA foreign_key_check')).toEqual([])
    // and a dump of the copy is the same file
    expect((await dumpDatabase(fresh, T0)).sql).toBe(dump.sql)
  })

  it('leaves out internals, d1_migrations and the full-text index; empties children before parents and inserts parents first', async () => {
    const db = await seeded()
    db.raw.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT); INSERT INTO d1_migrations (name) VALUES ('0001_meta.sql'), ('0002_schema.sql')")
    const dump = await dumpDatabase(db, T0)
    expect(dump.migrations).toEqual(['0001_meta.sql', '0002_schema.sql'])
    const tables = Object.keys(dump.tables)
    expect(tables.filter(t => /^(sqlite_|_cf_|d1_migrations|node_fts)/.test(t))).toEqual([])
    const lines = dump.sql.split('\n')
    const at = (s: string) => lines.findIndex(l => l.startsWith(s))
    expect(at('DELETE FROM "post";')).toBeLessThan(at('DELETE FROM "node";'))
    expect(at('DELETE FROM "node";')).toBeLessThan(at('DELETE FROM "person";'))
    expect(at('INSERT INTO "person"')).toBeLessThan(at('INSERT INTO "node"'))
    expect(lines[2]).toBe('PRAGMA defer_foreign_keys = ON;')
    // into a database that isn't fresh, audit_event refuses: the restore goes into a fresh one
    const used = await seeded()
    expect(() => {
      used.raw.exec('BEGIN')
      try {
        used.raw.exec(dump.sql)
      } finally {
        used.raw.exec('ROLLBACK')
      }
    }).toThrow(/append-only/)
  })

  it('stays inside the free plan: a handful of queries, each under D1\'s 100 KB statement limit', async () => {
    const db = await seeded()
    const seen: string[] = []
    const prepare = db.prepare.bind(db)
    db.prepare = (sql: string) => (seen.push(sql), prepare(sql))
    await dumpDatabase(db, T0)
    expect(seen.length).toBeLessThanOrEqual(10)
    for (const sql of seen) expect(new TextEncoder().encode(sql).length).toBeLessThan(100_000)
  })

  it('pages big tables by bytes and a WITHOUT ROWID table by key, and loses or doubles no row', async () => {
    const db = await seeded()
    const big = 'x'.repeat(120_000) + "'" // a few rows fill a page's byte budget
    const meta = db.raw.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
    for (let i = 0; i < 12; i++) meta.run(`big${i}`, big + i)
    const traffic = db.raw.prepare("INSERT INTO traffic_daily (day, kind, referrer, country, status_class, hits) VALUES ('2026-10-10', 'page', ?, '', 2, ?)")
    for (let i = 0; i < 4500; i++) traffic.run(`r${String(i).padStart(5, '0')}.example`, i)
    const seen: string[] = []
    const prepare = db.prepare.bind(db)
    // a request between rounds adds a row before the next page: read once at most, never twice
    db.prepare = (sql: string) => (seen.push(sql), seen.length === 4 && traffic.run('a-first.example', 1), prepare(sql))
    const dump = await dumpDatabase(db, T0)
    expect(seen.length).toBeGreaterThan(4) // several rounds
    expect(dump.tables.meta).toBe(db.raw.prepare('SELECT COUNT(*) AS n FROM meta').get().n)
    expect(dump.tables.traffic_daily).toBe(4500)
    const fresh = restore(dump.sql)
    expect(fresh.raw.prepare("SELECT COUNT(*) AS n FROM meta WHERE value = ?").get(big + 11).n).toBe(1)
    expect(fresh.raw.prepare('SELECT SUM(hits) AS n FROM traffic_daily').get().n).toBe((4499 * 4500) / 2)
    expect((await dumpDatabase(fresh, T0)).sql).toBe(dump.sql)
  })
})

describe('the backup job', () => {
  it('writes the gzipped dump and its manifest, and deletes backups more than 30 days old', async () => {
    const db = await seeded()
    const now = Date.parse('2026-11-20T03:17:00Z')
    const bucket = fakeBucket(['d1/2026-10-20.sql.gz', 'd1/2026-10-20.json', 'd1/2026-10-21.sql.gz', 'd1/2026-10-21.json', 'd1/2026-11-19.sql.gz', 'd1/2026-11-19.json', 'other/keep.txt'])
    const r = await backup({ DB: db, BACKUPS: bucket }, now)
    expect(r).toMatchObject({ key: 'd1/2026-11-20.sql.gz', deleted: 2 })
    expect([...bucket.store.keys()].sort()).toEqual([
      'd1/2026-10-21.json',
      'd1/2026-10-21.sql.gz',
      'd1/2026-11-19.json',
      'd1/2026-11-19.sql.gz',
      'd1/2026-11-20.json',
      'd1/2026-11-20.sql.gz',
      'other/keep.txt',
    ])
    const body = bucket.store.get('d1/2026-11-20.sql.gz')!
    const manifest = JSON.parse(new TextDecoder().decode(bucket.store.get('d1/2026-11-20.json')))
    expect(manifest).toMatchObject({ format: 1, key: 'd1/2026-11-20.sql.gz', gzip: true, bytes: body.length, taken_at: iso(now) })
    expect(manifest.sha256).toBe(createHash('sha256').update(body).digest('hex'))
    const sql = gunzipSync(body).toString('utf8')
    expect(manifest.sql_bytes).toBe(Buffer.byteLength(sql))
    expect(manifest.tables).toEqual((await dumpDatabase(db, now)).tables)
    const fresh = restore(sql)
    expect(fresh.raw.prepare('SELECT COUNT(*) AS n FROM node').get().n).toBe(manifest.tables.node)
  })

  it(`keeps ${KEEP_DAYS} days by the date in the key`, async () => {
    const now = Date.parse('2026-11-20T03:17:00Z')
    const days = Array.from({ length: 40 }, (_, i) => new Date(now - i * DAY).toISOString().slice(0, 10))
    const bucket = fakeBucket(days.flatMap(d => [`d1/${d}.sql.gz`, `d1/${d}.json`]))
    expect(await pruneBackups(bucket, now)).toBe(2 * 9)
    expect([...bucket.store.keys()].sort()[0]).toBe(`d1/${days[KEEP_DAYS]}.json`)
    expect(await pruneBackups(bucket, now)).toBe(0)
  })

  it('is a no-op with a log line where there is no BACKUPS binding, and runs from the cron at 03:17 UTC', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const db = testDb()
    expect(await backup({ DB: db })).toBeNull()
    expect(log).toHaveBeenCalledWith('backup', JSON.stringify({ skipped: 'no BACKUPS binding' }))

    const cron = async (at: string, BACKUPS?: R2Bucket) => {
      const waits: Promise<unknown>[] = []
      await scheduled({ scheduledTime: Date.parse(at), cron: MAIL_CRON, noRetry() {} } as ScheduledController, { DB: db, ENV: 'test', SITE_URL: 'https://shwarm.org', BACKUPS }, {
        waitUntil: (p: Promise<unknown>) => void waits.push(p),
        passThroughOnException() {},
      } as unknown as ExecutionContext)
      await Promise.all(waits)
    }
    const bucket = fakeBucket()
    await cron('2026-11-20T03:16:00Z', bucket)
    expect(bucket.store.size).toBe(0)
    await cron('2026-11-20T03:17:00Z', bucket)
    expect([...bucket.store.keys()].sort()).toEqual(['d1/2026-11-20.json', 'd1/2026-11-20.sql.gz'])
    log.mockClear()
    await cron('2026-11-21T03:17:00Z') // no binding: logged, nothing thrown
    expect(log).toHaveBeenCalledWith('backup', JSON.stringify({ skipped: 'no BACKUPS binding' }))
  })
})
