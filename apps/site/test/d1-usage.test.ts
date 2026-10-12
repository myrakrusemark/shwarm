// Go-live 11.3, the daily D1 usage line: the Worker adds up rows read and written from each D1 answer's meta
// (core/d1-usage.ts) and writes them into site_stats_daily about once a minute, on staging and production only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { FLUSH_MS, FLUSH_ROWS, flushUsage, pendingUsage, resetUsage, tallied } from '../src/core/d1-usage'
import { scheduled } from '../src/jobs'
import { ShwarmTree } from '../src/do/shwarm-tree'
import { addPerson, T0, testDb } from './d1'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetUsage()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** The test database with D1's meta filled in: rows read as the rows a read returns, rows written as changes. */
function metered() {
  const db = testDb()
  const wrap = (st: any): any => ({
    bind: (...a: unknown[]) => wrap(st.bind(...a)),
    all: async () => {
      const r = await st.all()
      return { ...r, meta: { rows_read: r.results.length, rows_written: 0 } }
    },
    run: async () => {
      const r = await st.run()
      return { ...r, meta: { ...r.meta, rows_read: 0, rows_written: r.meta.changes } }
    },
    first: (col?: string) => st.first(col), // the plain binding's; the counting one runs first() as all()
    raw: () => st.raw(),
    batchSync: () => {
      const r = st.batchSync()
      return { ...r, meta: { ...r.meta, rows_read: r.results?.length ?? 0, rows_written: r.meta.changes ?? 0 } }
    },
  })
  return Object.assign(Object.create(null), db, { prepare: (sql: string) => wrap(db.prepare(sql)) }) as D1Database & { raw: any }
}

const usageRow = (db: { raw: any }, day = '2026-10-08') =>
  db.raw.prepare('SELECT d1_rows_read AS r, d1_rows_written AS w, emails_sent AS e FROM site_stats_daily WHERE day = ?').get(day) ?? null

describe('counting', () => {
  it('adds up what each statement and batch read and wrote', async () => {
    const db = metered()
    const t = tallied(db)
    await t.prepare("INSERT INTO meta (key, value) VALUES ('a', '1'), ('b', '2')").run()
    expect(await t.prepare("SELECT key, value FROM meta WHERE key IN ('a', 'b') ORDER BY key").first()).toEqual({ key: 'a', value: '1' })
    expect(await t.prepare('SELECT value FROM meta WHERE key = ?').bind('b').first('value')).toBe('2')
    expect(await t.prepare("SELECT value FROM meta WHERE key = 'none'").first('value')).toBeNull()
    await expect(t.prepare("SELECT value FROM meta WHERE key = 'a'").first('nope')).rejects.toThrow(/D1_COLUMN_NOTFOUND/)
    const { results } = await t.prepare("SELECT key FROM meta WHERE key IN ('a', 'b')").all()
    expect(results).toHaveLength(2)
    // A batch takes statements from the counting binding, and the plain one's too.
    await t.batch([t.prepare("UPDATE meta SET value = '3' WHERE key IN ('a', 'b')"), db.prepare("SELECT key FROM meta WHERE key = 'a'")])
    // 2 written; then 2, 1, 0, 1 (the missing column's row) and 2 read; then 2 written and 1 read in the batch
    expect(pendingUsage()).toEqual({ '2026-10-08': { read: 7, written: 4 } })
  })

  it('writes the counts once a minute or once they pile up, adding to the day, and leaves the other columns alone', async () => {
    const db = metered()
    const t = tallied(db)
    db.raw.prepare("INSERT INTO site_stats_daily (day, emails_sent, computed_at) VALUES ('2026-10-08', 7, ?)").run(new Date(T0).toISOString())
    await t.prepare("SELECT key FROM meta WHERE key = 'schema'").all()
    expect(flushUsage(db, T0 + FLUSH_MS - 1)).toBeNull()
    await flushUsage(db, T0 + FLUSH_MS)
    expect(usageRow(db)).toEqual({ r: 1, w: 0, e: 7 })
    expect(pendingUsage()).toEqual({})
    expect(flushUsage(db, T0 + 10 * FLUSH_MS)).toBeNull() // nothing to write
    await t.prepare("INSERT INTO meta (key, value) VALUES ('c', '1')").run()
    await flushUsage(db, Date.now(), true)
    expect(usageRow(db)).toEqual({ r: 1, w: 1, e: 7 })
    // A burst is written at once.
    for (let i = 0; i < 3; i++) await t.prepare("SELECT key FROM meta WHERE key = 'schema'").all()
    expect(flushUsage(db, T0)).toBeNull()
    const big = { all: async () => ({ results: [], meta: { rows_read: FLUSH_ROWS, rows_written: 0 } }) }
    await tallied({ prepare: () => big } as unknown as D1Database).prepare('x').all()
    await flushUsage(db, T0)
    expect(usageRow(db)).toEqual({ r: 1 + 3 + FLUSH_ROWS, w: 1, e: 7 })
  })

  it('keeps each UTC day apart, and keeps the counts when the write fails', async () => {
    const db = metered()
    const t = tallied(db)
    vi.setSystemTime(Date.parse('2026-10-08T23:59:30Z'))
    await t.prepare("SELECT key FROM meta WHERE key = 'schema'").all()
    vi.setSystemTime(Date.parse('2026-10-09T00:00:10Z'))
    await t.prepare("INSERT INTO meta (key, value) VALUES ('d', '1')").run()
    const broken = { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error('d1 down') } } as unknown as D1Database
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await flushUsage(broken, Date.now(), true)
    expect(pendingUsage()).toEqual({ '2026-10-08': { read: 1, written: 0 }, '2026-10-09': { read: 0, written: 1 } })
    await flushUsage(db, Date.now() + FLUSH_MS)
    expect(usageRow(db, '2026-10-08')).toMatchObject({ r: 1, w: 0 })
    expect(usageRow(db, '2026-10-09')).toMatchObject({ r: 0, w: 1 })
  })
})

describe('where it counts', () => {
  const env = (db: D1Database, ENV: string) => ({ DB: db, ENV, SITE_MODE: 'holding', PASSWORD_PEPPER: 'p', CSRF_SECRET: 'c' })

  it('every request on staging and production, the traffic count included; nothing in tests', async () => {
    const db = metered()
    await app.request('/healthz', {}, env(db, 'test'))
    expect(pendingUsage()).toEqual({})
    await app.request('/rules', {}, env(db, 'production'))
    const after = pendingUsage()['2026-10-08']
    expect(after.written).toBeGreaterThanOrEqual(1) // the traffic count's row
    // A request a minute later writes what the isolate holds first.
    vi.setSystemTime(T0 + FLUSH_MS)
    await app.request('/rules', {}, env(db, 'production'))
    expect(usageRow(db)).toMatchObject({ r: after.read, w: after.written })
  })

  it('every cron run, and every tree command', async () => {
    const db = metered()
    const waits: Promise<unknown>[] = []
    await scheduled({ scheduledTime: T0 + 7 * 60_000, cron: '* * * * *' } as ScheduledController, { DB: db, ENV: 'production' } as any, {
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
    } as any)
    await Promise.allSettled(waits)
    const cron = pendingUsage()['2026-10-08']
    expect(cron.read).toBeGreaterThan(0)
    const me = await addPerson(db, 'myra')
    resetUsage()
    const leave = () =>
      new Request('https://tree.internal/run', {
        method: 'POST',
        body: JSON.stringify({ type: 'leave', actor: { personId: me, handle: 'myra', as: '@myra', via: 'site' }, input: { node: 'no-such-shwarm' } }),
      })
    const quiet = await new ShwarmTree({} as DurableObjectState, { DB: metered(), ENV: 'test' }).fetch(leave())
    expect(quiet.status).not.toBe(500) // refused (no such person or shwarm), after reading D1
    expect(pendingUsage()).toEqual({})
    await new ShwarmTree({} as DurableObjectState, { DB: db, ENV: 'staging' }).fetch(leave())
    expect(pendingUsage()['2026-10-08'].read).toBeGreaterThan(0)
  })
})
