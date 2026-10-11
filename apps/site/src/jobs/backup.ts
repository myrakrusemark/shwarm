// The nightly backup (go-live 11.1): every base table as one SQL file of INSERTs, gzipped, in the private R2 bucket
// BACKUPS as d1/YYYY-MM-DD.sql.gz, with a manifest beside it (d1/YYYY-MM-DD.json: row counts per table, the sha256 of
// the stored file, the migrations it was taken under). Files older than KEEP_DAYS are deleted. D1 Time Travel covers
// the last 7 days on its own; this is the copy outside the database. scripts/restore-backup.mjs loads one back.
//
// The Workers Free plan allows 50 subrequests (D1 queries and R2 calls together) and 10 ms of CPU per cron run, shared
// with the minute's other jobs. So SQLite writes each row's values (quote(), which round-trips TEXT, BLOB, NULL,
// integers and reals exactly; TEXT holding a NUL goes as CAST(X'..' AS TEXT)), and one query a round reads a page of every table: one column per table (D1 allows 100
// columns, and only 5 terms in a compound SELECT, so no UNION), each a JSON array of up to PAGE rows and BUDGET bytes,
// so no value nears D1's 2 MB limit. A run is about 8 subrequests; a database too big for MAX_READS rounds fails with
// a log line rather than writing half a dump.
//
// The file restores into an empty database migrated to the same migrations. Left out: sqlite_ and _cf_ internals,
// d1_migrations (the target has its own) and the full-text index node_fts with its shadow tables (the trigger on node
// fills it again as the nodes go in). It empties each table first, children before parents, so rows the migrations
// seeded (meta, settings, the disposable domains) are replaced; audit_event refuses deletes, but deleting from an empty
// table deletes no row, so its trigger never fires. Inserts go parents first, with foreign keys deferred for the rest.
// AUTOINCREMENT counters are set back as they were, so an id that was used and deleted is never handed out again.
import { sha256, toHex } from '@shwarm/protocol'

export type BackupEnv = { DB: D1Database; BACKUPS?: R2Bucket }

export const BACKUP_HOUR_UTC = 3
export const BACKUP_MINUTE = 17 // a quiet minute: not a stats, summary or hourly-cleanup minute
export const KEEP_DAYS = 30
export const PREFIX = 'd1/'
const PAGE = 2000 // rows per table per round
const BUDGET = 300_000 // bytes of SQL values per table per round (one row more when a single row is bigger)
const PER_QUERY = 25 // tables per query, one column each: about 40 KB of SQL today, room under D1's 100 KB as tables grow
const MAX_READS = 20 // rounds per run: 40,000 rows or about 6 MB in the biggest table
const DAY = 86_400_000

type Table = { name: string; cols: string[]; pk: string[]; rowid: boolean; refs: string[] }
export type Dump = { sql: string; tables: Record<string, number>; migrations: string[] | null }
export type BackupResult = { key: string; bytes: number; rows: number; tables: number; deleted: number }

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

/** The base tables to dump, with columns, primary key and the tables their foreign keys point at. */
async function readTables(db: D1Database): Promise<{ tables: Table[]; sequence: boolean; migrations: boolean }> {
  const { results } = await db
    .prepare(
      `SELECT m.name, m.sql,
              (SELECT json_group_array(name) FROM (SELECT name FROM pragma_table_info(m.name) ORDER BY cid)) AS cols,
              (SELECT json_group_array(name) FROM (SELECT name FROM pragma_table_info(m.name) WHERE pk > 0 ORDER BY pk)) AS pk,
              (SELECT json_group_array(DISTINCT "table") FROM pragma_foreign_key_list(m.name)) AS refs
       FROM sqlite_master m WHERE m.type = 'table' AND substr(m.name, 1, 4) <> '_cf_' ORDER BY m.name`,
    )
    .all<{ name: string; sql: string | null; cols: string; pk: string; refs: string }>()
  const names = new Set(results.map(r => r.name))
  const virtual = results.filter(r => /^\s*CREATE\s+VIRTUAL\s/i.test(r.sql ?? '')).map(r => r.name)
  const tables = results
    .filter(r => !r.name.startsWith('sqlite_') && r.name !== 'd1_migrations' && !virtual.some(v => r.name === v || r.name.startsWith(`${v}_`)))
    .map(r => ({
      name: r.name,
      cols: JSON.parse(r.cols) as string[],
      pk: JSON.parse(r.pk) as string[],
      rowid: !/\bWITHOUT\s+ROWID\b/i.test(r.sql ?? ''),
      refs: JSON.parse(r.refs) as string[],
    }))
  return { tables, sequence: names.has('sqlite_sequence'), migrations: names.has('d1_migrations') }
}

/** Parents before children; a cycle (none today) goes on in name order, and the deferred foreign keys cover it. */
function parentsFirst(tables: Table[]): Table[] {
  const left = new Map(tables.map(t => [t.name, t]))
  const out: Table[] = []
  while (left.size) {
    const ready = [...left.values()].filter(t => t.refs.every(r => r === t.name || !left.has(r)))
    for (const t of ready.length ? ready : [...left.values()]) {
      out.push(t)
      left.delete(t.name)
    }
  }
  return out
}

/**
 * One table's next page, as one column: a JSON array of the inner page's size and its rows [i, k, values], in
 * order, up to BUDGET bytes. A rowid table goes on from the last rowid; a WITHOUT ROWID table (traffic_daily) from the
 * last primary key, as SQL values (`k`), since an offset would read a row twice when one is added between rounds.
 */
function pageColumn(t: Table, after: number | string | null, as: string): string {
  // quote() stops a TEXT value at a NUL byte, so such a value goes as its bytes, cast back to TEXT.
  const values = t.cols
    .map(ident)
    .map(c => `CASE WHEN typeof(${c}) = 'text' AND instr(${c}, char(0)) THEN 'CAST(' || quote(CAST(${c} AS BLOB)) || ' AS TEXT)' ELSE quote(${c}) END`)
    .join(` || ',' || `)
  const inner = t.rowid
    ? `SELECT rowid AS k, ${values} AS v FROM ${ident(t.name)} WHERE rowid > ${after} ORDER BY rowid LIMIT ${PAGE}`
    : `SELECT ${t.pk.map(c => `quote(${ident(c)})`).join(` || ',' || `)} AS k, ${t.pk.map((c, j) => `${ident(c)} AS p${j}`).join(', ')}, ${values} AS v FROM ${ident(t.name)}${after === null ? '' : ` WHERE (${t.pk.map(ident).join(', ')}) > (${after})`} ORDER BY ${t.pk.map(ident).join(', ')} LIMIT ${PAGE}`
  const order = t.rowid ? 'k' : t.pk.map((_, j) => `p${j}`).join(', ')
  const win = `SELECT k, v, row_number() OVER w AS i, sum(length(CAST(v AS BLOB))) OVER w AS run, count(*) OVER () AS cnt FROM (${inner}) WINDOW w AS (ORDER BY ${order} ROWS UNBOUNDED PRECEDING)`
  return `(SELECT json_array(max(cnt), json_group_array(json_array(i, k, v))) FROM (${win}) WHERE run <= ${BUDGET} OR i = 1) AS ${as}`
}

/** The whole database as restorable SQL, read in pages. */
export async function dumpDatabase(db: D1Database, now = Date.now()): Promise<Dump> {
  const { tables, sequence, migrations } = await readTables(db)
  const ordered = parentsFirst(tables)
  const rows = ordered.map(() => [] as string[])
  const after: (number | string | null)[] = ordered.map(t => (t.rowid ? Number.MIN_SAFE_INTEGER : null))
  let open = ordered.map((_, i) => i)
  for (let round = 0; open.length; round++) {
    if (round === MAX_READS) throw new Error(`a table is bigger than ${MAX_READS} pages; too big for one run`)
    const more: number[] = []
    for (let q = 0; q < open.length; q += PER_QUERY) {
      const part = open.slice(q, q + PER_QUERY)
      const row = await db.prepare(`SELECT ${part.map(i => pageColumn(ordered[i], after[i], `c${i}`)).join(',\n')}`).first<Record<string, string>>()
      for (const i of part) {
        const [size, page] = JSON.parse(row![`c${i}`]) as [number | null, [number, number | string, string][]]
        page.sort((a, b) => a[0] - b[0])
        for (const [, , v] of page) rows[i].push(v)
        if (page.length) after[i] = page[page.length - 1][1]
        // more to read: the page was full, or the byte budget cut it short
        if (size === PAGE || page.length < (size ?? 0)) more.push(i)
      }
    }
    open = more
  }
  const seq = sequence ? (await db.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all<{ name: string; seq: number }>()).results : []
  const applied = migrations ? (await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{ name: string }>()).results.map(r => r.name) : null

  const total = rows.reduce((n, r) => n + r.length, 0)
  const lines = [
    `-- shwarm d1 backup, taken ${new Date(now).toISOString()}: ${ordered.length} tables, ${total} rows.`,
    '-- Restore into a fresh database migrated to the same migrations, with scripts/restore-backup.mjs.',
    'PRAGMA defer_foreign_keys = ON;',
    ...[...ordered].reverse().map(t => `DELETE FROM ${ident(t.name)};`),
  ]
  ordered.forEach((t, i) => {
    const head = `INSERT INTO ${ident(t.name)} (${t.cols.map(ident).join(', ')}) VALUES (`
    for (const v of rows[i]) lines.push(`${head}${v});`)
  })
  const dumped = new Set(ordered.map(t => t.name))
  for (const s of seq) {
    if (!dumped.has(s.name)) continue
    lines.push(`DELETE FROM sqlite_sequence WHERE name = ${lit(s.name)};`, `INSERT INTO sqlite_sequence (name, seq) VALUES (${lit(s.name)}, ${Number(s.seq)});`)
  }
  return { sql: lines.join('\n') + '\n', tables: Object.fromEntries(ordered.map((t, i) => [t.name, rows[i].length])), migrations: applied }
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Deletes backups (dump and manifest) from more than KEEP_DAYS days before `now`'s day, by the date in the key. */
export async function pruneBackups(bucket: R2Bucket, now = Date.now()): Promise<number> {
  const cutoff = dayOf(now - KEEP_DAYS * DAY)
  const old: string[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: PREFIX, cursor })
    for (const o of page.objects) {
      const day = /^d1\/(\d{4}-\d{2}-\d{2})\./.exec(o.key)?.[1]
      if (day && day < cutoff) old.push(o.key)
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  for (let i = 0; i < old.length; i += 1000) await bucket.delete(old.slice(i, i + 1000))
  return old.length
}

/** Tonight's backup and the retention sweep. Null, with a log line, where there's no bucket (tests, wrangler dev). */
export async function backup(env: BackupEnv, now = Date.now()): Promise<BackupResult | null> {
  if (!env.BACKUPS) {
    console.log('backup', JSON.stringify({ skipped: 'no BACKUPS binding' }))
    return null
  }
  const dump = await dumpDatabase(env.DB, now)
  const plain = new TextEncoder().encode(dump.sql)
  const packed = await gzip(plain)
  const body = packed ?? plain
  const day = dayOf(now)
  const key = `${PREFIX}${day}.sql${packed ? '.gz' : ''}`
  const manifest = {
    format: 1,
    key,
    taken_at: new Date(now).toISOString(),
    gzip: packed !== null,
    bytes: body.length,
    sql_bytes: plain.length,
    sha256: toHex(await sha256(body)),
    migrations: dump.migrations,
    tables: dump.tables,
  }
  // The dump first: a manifest names only a file that's there.
  await env.BACKUPS.put(key, body, { httpMetadata: { contentType: packed ? 'application/gzip' : 'application/sql' } })
  await env.BACKUPS.put(`${PREFIX}${day}.json`, JSON.stringify(manifest, null, 2), { httpMetadata: { contentType: 'application/json' } })
  const deleted = await pruneBackups(env.BACKUPS, now)
  const rows = Object.values(dump.tables).reduce((n, r) => n + r, 0)
  return { key, bytes: body.length, rows, tables: Object.keys(dump.tables).length, deleted }
}
