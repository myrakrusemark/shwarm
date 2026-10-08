// A small D1 stand-in over node:sqlite for tests: prepare().bind().first/all/run, batch, exec.
import { readdirSync, readFileSync } from 'node:fs'

const mod = 'node:sqlite'
const { DatabaseSync } = (await import(/* @vite-ignore */ mod)) as any

export function testDb(): D1Database & { raw: any } {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(f, dir), 'utf8'))
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
        for (const s of stmts) out.push(s.runSync())
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
