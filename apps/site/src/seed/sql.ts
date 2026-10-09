// Turns a recorded D1 statement (SQL with ? or ?N placeholders, plus its binds) into one line of plain SQL
// with every value written as a quoted literal, for `wrangler d1 execute --file` (go-live 3.1).
//
// Strings: single quotes doubled; control characters (NUL, newline, tab, CR ...) written as char(n) and joined
// with ||, so every statement stays on one line and a NUL can't end the statement early. Lone UTF-16
// surrogates are refused, because they can't be written as UTF-8 without changing the text.
//
// Ids: the seed plans against a local copy of the database, where the rows it creates get ids from a high
// "sentinel" range. Those ids mean nothing remotely, so each one is written as a subquery by path or handle
// (`(SELECT id FROM node WHERE path = '...')`), including inside strings such as rate-bucket keys.

/** Ids at or above this are local-only; every one must have a stand-in expression. */
export const SENTINEL_MIN = 8_000_000_000_000

export type IdMap = Map<number, string>

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const CONTROL = /[\x00-\x1f\x7f]/

/** 'it''s' for plain text; ('a' || char(10) || 'b') when it holds control characters. */
export function sqlString(s: string): string {
  if (LONE_SURROGATE.test(s)) throw new Error('text holds a lone surrogate; it would not survive as UTF-8')
  if (!CONTROL.test(s)) return `'${s.replaceAll("'", "''")}'`
  const parts: string[] = []
  let run = ''
  for (const ch of s) {
    if (CONTROL.test(ch)) {
      if (run) parts.push(`'${run.replaceAll("'", "''")}'`)
      run = ''
      parts.push(`char(${ch.charCodeAt(0)})`)
    } else run += ch
  }
  if (run) parts.push(`'${run.replaceAll("'", "''")}'`)
  return `(${parts.join(' || ')})`
}

/** A string that may hold sentinel ids (e.g. 'thread:5:9000000000003'): those become subqueries joined with ||. */
function stringWithIds(s: string, ids: IdMap): string {
  const parts: string[] = []
  let last = 0
  for (const m of s.matchAll(/\d{13,}/g)) {
    // Only exact runs of digits that are ids the plan handed out; any other long number (a date, a hash) stays text.
    const expr = ids.get(Number(m[0]))
    if (expr === undefined) continue
    if (m.index! > last) parts.push(sqlString(s.slice(last, m.index)))
    parts.push(expr)
    last = m.index! + m[0].length
  }
  if (!parts.length) return sqlString(s)
  if (last < s.length) parts.push(sqlString(s.slice(last)))
  return `(${parts.join(' || ')})`
}

/** One bound value as a SQL literal, the way D1 would bind it. */
export function sqlLiteral(v: unknown, ids?: IdMap): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (typeof v === 'bigint') return v < 0n ? `(${v})` : String(v)
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`can't write ${v} as SQL`)
    if (Number.isInteger(v) && v >= SENTINEL_MIN) {
      const expr = ids?.get(v)
      if (expr === undefined) throw new Error(`local id ${v} has no stand-in`)
      return expr
    }
    const s = Object.is(v, -0) ? '0' : String(v)
    return v < 0 ? `(${s})` : s // (-5): "x - -5" is fine, but "x -?" would become a -- comment
  }
  if (typeof v === 'string') return ids?.size ? stringWithIds(v, ids) : sqlString(v)
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
    return `X'${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}'`
  }
  throw new Error(`can't bind a ${typeof v} in D1`)
}

/**
 * The statement with its placeholders replaced by literals, whitespace outside literals squeezed to single spaces,
 * comments dropped, on one line and ending in ';'. Placeholders follow SQLite: ?N is bind N, a bare ? is one more
 * than the largest number used so far. Named placeholders (:a, @a, $a) aren't used by core and are refused.
 */
export function renderStatement(sql: string, args: unknown[], ids?: IdMap): string {
  let out = ''
  let i = 0
  let max = 0
  let space = false
  const emit = (s: string) => {
    if (space && out && !out.endsWith(' ')) out += ' '
    space = false
    out += s
  }
  while (i < sql.length) {
    const c = sql[i]
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      let j = i + 1
      for (;;) {
        if (j >= sql.length) throw new Error('unclosed quote in SQL')
        if (sql[j] === close) {
          if (close !== ']' && sql[j + 1] === close) j += 2
          else break
        } else j++
      }
      emit(sql.slice(i, j + 1))
      i = j + 1
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      space = true
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      if (end < 0) throw new Error('unclosed comment in SQL')
      i = end + 2
      space = true
    } else if (/\s/.test(c)) {
      i++
      space = true
    } else if (c === '?') {
      let j = i + 1
      while (j < sql.length && sql[j] >= '0' && sql[j] <= '9') j++
      const n = j > i + 1 ? Number(sql.slice(i + 1, j)) : max + 1
      if (n < 1 || n > args.length) throw new Error(`placeholder ?${n} has no bind (${args.length} given)`)
      max = Math.max(max, n)
      emit(sqlLiteral(args[n - 1], ids))
      i = j
    } else if ((c === ':' || c === '@' || c === '$') && /[A-Za-z_]/.test(sql[i + 1] ?? '')) {
      throw new Error(`named placeholder ${c}${sql[i + 1]}... isn't supported`)
    } else {
      emit(c)
      i++
    }
  }
  if (max !== args.length) throw new Error(`${args.length} binds for ${max} placeholders`)
  out = out.trim()
  return out.endsWith(';') ? out : out + ';'
}
