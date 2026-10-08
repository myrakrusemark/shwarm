// RFC 8785 JSON Canonicalization Scheme. Keys sorted by UTF-16 code units, no whitespace,
// numbers and strings as ECMAScript JSON.stringify writes them.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('JCS: number must be finite')
      return JSON.stringify(value)
    case 'string':
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
      const obj = value as Record<string, unknown>
      const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort()
      return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}'
    }
    default:
      throw new TypeError(`JCS: can't encode ${typeof value}`)
  }
}
