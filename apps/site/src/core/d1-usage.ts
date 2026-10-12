// D1 rows read and written, counted by the Worker itself (go-live 11.3: "a daily admin line with yesterday's D1 rows
// read and written"). D1 reports usage to the dashboard and Cloudflare's GraphQL analytics, which a Worker could read
// only with an API token; instead every D1 answer's meta (rows_read, rows_written) is added up as it comes back.
//
// tallied(db) wraps the DB binding for one request, cron run or tree command; the counts go into one total per isolate
// and per UTC day, and flushUsage writes that total into site_stats_daily (d1_rows_read, d1_rows_written) with one
// UPSERT, at the start of an invocation, once the oldest unwritten count is FLUSH_MS old or the total passes
// FLUSH_ROWS. So the cost is at most one row written a minute per busy isolate, and nothing on the request's path.
//
// What it misses, so the numbers run a little under the dashboard's: the counts an isolate holds when it's evicted
// (under a minute's worth, usually less), raw() reads (no meta: one count in the outbox sweep), and the flush's own
// write. first() is run as all(), which is what D1 does underneath anyway (the whole result comes back, then row 0).
// Only staging and production count (countsD1), so tests and local runs keep their exact queries.

export const FLUSH_MS = 60_000
export const FLUSH_ROWS = 50_000

type Count = { read: number; written: number }
const pending = new Map<string, Count>() // by UTC day
let oldest = 0 // when the oldest unwritten count came in, 0 for none
let rows = 0
let logged = false

/** Whether this environment counts its D1 usage: staging and production. */
export const countsD1 = (env: { ENV?: string } | undefined) => env?.ENV === 'staging' || env?.ENV === 'production'

function add(meta: Partial<D1Meta> | undefined, now = Date.now()) {
  const read = Number(meta?.rows_read) || 0
  const written = Number(meta?.rows_written) || 0
  if (read <= 0 && written <= 0) return
  const day = new Date(now).toISOString().slice(0, 10)
  const c = pending.get(day) ?? { read: 0, written: 0 }
  c.read += Math.max(0, read)
  c.written += Math.max(0, written)
  pending.set(day, c)
  if (!oldest) oldest = now
  rows += Math.max(0, read) + Math.max(0, written)
}

class Counted {
  constructor(readonly inner: D1PreparedStatement) {}
  bind(...values: unknown[]) {
    return new Counted(this.inner.bind(...values))
  }
  async all<T>() {
    const r = await this.inner.all<T>()
    add(r.meta)
    return r
  }
  async run<T>() {
    const r = await this.inner.run<T>()
    add(r.meta)
    return r
  }
  async first<T>(col?: string): Promise<T | null> {
    const r = await this.all<Record<string, unknown>>()
    const row = r.results?.[0]
    if (col === undefined) return (row ?? null) as T | null
    if (row && !(col in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${col})`)
    return (row?.[col] ?? null) as T | null
  }
  raw<T>(opts?: { columnNames?: boolean }) {
    return opts?.columnNames ? this.inner.raw<T>({ columnNames: true }) : this.inner.raw<T>()
  }
}

const unwrap = (s: D1PreparedStatement) => (s instanceof Counted ? s.inner : s) as D1PreparedStatement

/** The binding, counting what each statement and batch read and wrote. Statements from it batch only through it. */
export function tallied(db: D1Database): D1Database {
  return {
    prepare: (sql: string) => new Counted(db.prepare(sql)) as unknown as D1PreparedStatement,
    batch: async <T>(stmts: D1PreparedStatement[]) => {
      const out = await db.batch<T>(stmts.map(unwrap))
      for (const r of out) add(r.meta)
      return out
    },
    exec: (sql: string) => db.exec(sql),
    dump: () => db.dump(),
    withSession: (c?: string) => db.withSession(c as never),
  } as unknown as D1Database
}

/**
 * Writes the isolate's counts when they're due (FLUSH_MS or FLUSH_ROWS), through the plain binding. Returns the write
 * to hand to waitUntil, or null when nothing is due. A failed write puts the counts back for the next try.
 */
export function flushUsage(db: D1Database, now = Date.now(), force = false): Promise<void> | null {
  if (!pending.size || (!force && now - oldest < FLUSH_MS && rows < FLUSH_ROWS)) return null
  const take = [...pending]
  pending.clear()
  oldest = 0
  rows = 0
  const stmts = take.map(([day, c]) =>
    db
      .prepare(
        `INSERT INTO site_stats_daily (day, d1_rows_read, d1_rows_written) VALUES (?, ?, ?)
         ON CONFLICT (day) DO UPDATE SET d1_rows_read = d1_rows_read + excluded.d1_rows_read, d1_rows_written = d1_rows_written + excluded.d1_rows_written`,
      )
      .bind(day, c.read, c.written),
  )
  return db.batch(stmts).then(
    () => {},
    e => {
      for (const [day, c] of take) {
        const p = pending.get(day) ?? { read: 0, written: 0 }
        pending.set(day, { read: p.read + c.read, written: p.written + c.written })
        rows += c.read + c.written
      }
      if (!oldest) oldest = now
      if (!logged) {
        logged = true
        console.error('d1 usage count failed', e)
      }
    },
  )
}

/** For tests: what this isolate holds, and a way to forget it. */
export const pendingUsage = () => Object.fromEntries([...pending].map(([d, c]) => [d, { ...c }]))
export function resetUsage() {
  pending.clear()
  oldest = 0
  rows = 0
  logged = false
}
