// A D1 wrapper for the seed plan: reads go straight to the database underneath; every batch is run there too
// (so the next command sees it) and its statements are kept, SQL and binds, to be written out as a .sql file.
// A write outside a batch throws, so nothing core writes can slip past the recording.

export type Recorded = { sql: string; args: unknown[] }

const READ = /^\s*(SELECT|WITH)\b/i

class Stmt {
  constructor(
    readonly sql: string,
    readonly args: unknown[],
    readonly inner: D1PreparedStatement,
  ) {}
  bind(...args: unknown[]) {
    return new Stmt(this.sql, args, this.inner.bind(...args))
  }
  private read() {
    if (!READ.test(this.sql)) throw new Error(`seed: a write outside a batch would not be recorded: ${this.sql.slice(0, 60)}`)
  }
  first(col?: string) {
    this.read()
    return col === undefined ? this.inner.first() : this.inner.first(col)
  }
  all() {
    this.read()
    return this.inner.all()
  }
  raw() {
    this.read()
    return this.inner.raw()
  }
  run() {
    this.read()
    return this.inner.run()
  }
}

export type RecordingDb = D1Database & {
  /** Every batch committed since the last take(), oldest first. */
  take(): Recorded[][]
}

export function recordingDb(inner: D1Database): RecordingDb {
  let batches: Recorded[][] = []
  const db = {
    prepare: (sql: string) => new Stmt(sql, [], inner.prepare(sql)),
    batch: async (stmts: unknown[]) => {
      const mine = stmts.map(s => {
        if (!(s instanceof Stmt)) throw new Error('seed: a batch statement was not prepared through the recorder')
        return s
      })
      const res = await inner.batch(mine.map(s => s.inner))
      batches.push(mine.map(s => ({ sql: s.sql, args: s.args })))
      return res
    },
    exec: async () => {
      throw new Error('seed: exec is not recorded')
    },
    dump: async () => {
      throw new Error('seed: dump is not supported')
    },
    withSession: () => {
      throw new Error('seed: sessions are not supported')
    },
    take: () => {
      const out = batches
      batches = []
      return out
    },
  }
  return db as unknown as RecordingDb
}
