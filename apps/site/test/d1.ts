// A small D1 stand-in over node:sqlite for tests: prepare().bind().first/all/run, batch, exec.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mod = 'node:sqlite'
const { DatabaseSync } = (await import(/* @vite-ignore */ mod)) as any

// Migrations run once into a template file shared by all test runs (keyed by the migrations' content);
// each testDb() opens a fresh copy, then unlinks it (the open handle keeps the data). The disposable-domain
// list alone is 9,221 inserts, too slow to repeat for every race run.
let template: string | undefined
let copies = 0
function migratedTemplate(): string {
  if (template) return template
  const dir = new URL('../migrations/', import.meta.url)
  const sql = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(new URL(f, dir), 'utf8'))
  const path = join(tmpdir(), `shwarm-test-${createHash('sha256').update(sql.join('\n')).digest('hex').slice(0, 12)}.sqlite`)
  if (!existsSync(path)) {
    const tmp = `${path}.${process.pid}.${Date.now()}`
    const db = new DatabaseSync(tmp)
    for (const s of sql) db.exec(s)
    db.close()
    renameSync(tmp, path) // atomic, so parallel test workers never see a half-built template
  }
  return (template = path)
}

export function testDb(): D1Database & { raw: any } {
  const path = `${migratedTemplate()}.${process.pid}.${copies++}`
  copyFileSync(template!, path)
  const raw = new DatabaseSync(path)
  rmSync(path) // the open handle keeps the data; nothing is left behind
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = MEMORY; PRAGMA synchronous = OFF')
  const runSync = (sql: string, args: unknown[]) => {
    const r = raw.prepare(sql).run(...args)
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) }, results: [] }
  }
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async (col?: string) => {
      const r = raw.prepare(sql).get(...args)
      return r === undefined ? null : col ? r[col] : { ...r }
    },
    all: async () => ({ results: raw.prepare(sql).all(...args).map((r: any) => ({ ...r })), success: true, meta: {} }),
    run: async () => runSync(sql, args),
    runSync: () => runSync(sql, args),
    // In a batch, D1 returns a read's rows too.
    batchSync: () =>
      /^\s*SELECT\b/i.test(sql) ? { success: true, meta: { changes: 0 }, results: raw.prepare(sql).all(...args).map((r: any) => ({ ...r })) } : runSync(sql, args),
    raw: async () => raw.prepare(sql).all(...args).map((r: any) => Object.values(r)),
  })
  return {
    raw,
    prepare: (sql: string) => stmt(sql),
    // Like D1, a batch is one transaction that nothing else interleaves with: no await inside it.
    batch: async (stmts: any[]) => {
      raw.exec('BEGIN')
      try {
        const out = []
        for (const s of stmts) out.push(s.batchSync())
        raw.exec('COMMIT')
        return out
      } catch (e) {
        raw.exec('ROLLBACK')
        throw e
      }
    },
    exec: async (sql: string) => (raw.exec(sql), { count: 1, duration: 0 }),
  } as any
}

export const T0 = Date.parse('2026-10-08T12:00:00Z')

export async function addPerson(db: D1Database, handle: string, extra: { hash?: string; status?: string } = {}) {
  const t = new Date(T0).toISOString()
  const r = await db
    .prepare(
      `INSERT INTO person (handle, email, email_norm, password_hash, status, terms_version, terms_accepted_at, age_confirmed_at, created_at)
       VALUES (?, ?, ?, ?, ?, '0.1', ?, ?, ?)`,
    )
    .bind(handle, `${handle}@example.org`, `${handle}@example.org`, extra.hash ?? 'x', extra.status ?? 'active', t, t, t)
    .run()
  return r.meta.last_row_id as number
}
