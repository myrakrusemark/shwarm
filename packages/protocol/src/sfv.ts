// RFC 8941 structured field values: just the parts HTTP message signatures need. Dictionaries
// (Signature-Input, Signature, Content-Digest), inner lists with parameters, and every bare item type
// RFC 8941 has. Strings and tokens are told apart by the Token wrapper; integers are plain numbers.
import { fromBase64, toBase64 } from './bytes'

export class Token {
  constructor(readonly value: string) {}
}
export class Decimal {
  constructor(readonly value: number) {}
}
export type BareItem = number | Decimal | string | Token | Uint8Array | boolean
export type Params = Map<string, BareItem>
export type Item = { value: BareItem; params: Params }
export type InnerList = { items: Item[]; params: Params }
export type Member = Item | InnerList
export type Dictionary = Map<string, Member>

export const isInnerList = (m: Member): m is InnerList => 'items' in m

const KEY_START = /[a-z*]/
const KEY_CHAR = /[a-z0-9_\-.*]/
const TOKEN_CHAR = /[!#$%&'*+\-.^_`|~0-9A-Za-z:/]/

class Parser {
  i = 0
  constructor(readonly s: string) {}
  fail(what: string): never {
    throw new SyntaxError(`structured field: ${what} at ${this.i}`)
  }
  peek() {
    return this.s[this.i]
  }
  sp() {
    while (this.s[this.i] === ' ') this.i++
  }
  ows() {
    while (this.s[this.i] === ' ' || this.s[this.i] === '\t') this.i++
  }
  key(): string {
    if (!KEY_START.test(this.peek() ?? '')) this.fail('bad key')
    const start = this.i
    while (this.i < this.s.length && KEY_CHAR.test(this.s[this.i])) this.i++
    return this.s.slice(start, this.i)
  }
  params(): Params {
    const p: Params = new Map()
    while (this.peek() === ';') {
      this.i++
      this.sp()
      const k = this.key()
      let v: BareItem = true
      if (this.peek() === '=') {
        this.i++
        v = this.bare()
      }
      p.set(k, v)
    }
    return p
  }
  item(): Item {
    const value = this.bare()
    return { value, params: this.params() }
  }
  member(): Member {
    return this.peek() === '(' ? this.innerList() : this.item()
  }
  innerList(): InnerList {
    this.i++ // (
    const items: Item[] = []
    for (;;) {
      this.sp()
      if (this.peek() === ')') {
        this.i++
        return { items, params: this.params() }
      }
      items.push(this.item())
      const c = this.peek()
      if (c !== ' ' && c !== ')') this.fail('bad inner list')
    }
  }
  bare(): BareItem {
    const c = this.peek()
    if (c === undefined) this.fail('missing item')
    if (c === '-' || (c >= '0' && c <= '9')) return this.number()
    if (c === '"') return this.string()
    if (c === '*' || /[A-Za-z]/.test(c)) return this.token()
    if (c === ':') return this.bytes()
    if (c === '?') return this.boolean()
    return this.fail('unknown item')
  }
  number(): number | Decimal {
    const m = /^-?(\d{1,15})(\.\d{1,3})?/.exec(this.s.slice(this.i))
    if (!m || (m[2] && m[1].length > 12)) this.fail('bad number')
    const next = this.s[this.i + m[0].length]
    if (next !== undefined && (next === '.' || (next >= '0' && next <= '9'))) this.fail('bad number')
    this.i += m[0].length
    return m[2] ? new Decimal(Number(m[0])) : Number(m[0])
  }
  string(): string {
    this.i++ // "
    let out = ''
    for (;;) {
      const c = this.s[this.i++]
      if (c === undefined) this.fail('unterminated string')
      if (c === '"') return out
      if (c === '\\') {
        const e = this.s[this.i++]
        if (e !== '"' && e !== '\\') this.fail('bad escape')
        out += e
      } else if (c < ' ' || c > '~') this.fail('bad string character')
      else out += c
    }
  }
  token(): Token {
    const start = this.i++
    while (this.i < this.s.length && TOKEN_CHAR.test(this.s[this.i])) this.i++
    return new Token(this.s.slice(start, this.i))
  }
  bytes(): Uint8Array {
    const end = this.s.indexOf(':', this.i + 1)
    if (end < 0) this.fail('unterminated byte sequence')
    let b64 = this.s.slice(this.i + 1, end)
    this.i = end + 1
    while (b64.length % 4) b64 += '=' // RFC 8941 4.2.7: don't fail when the padding is left off
    try {
      return fromBase64(b64)
    } catch {
      return this.fail('bad byte sequence')
    }
  }
  boolean(): boolean {
    const v = this.s[this.i + 1]
    if (v !== '0' && v !== '1') this.fail('bad boolean')
    this.i += 2
    return v === '1'
  }
}

/** Parses a Dictionary field value. Throws SyntaxError on anything RFC 8941 would refuse. */
export function parseDictionary(field: string): Dictionary {
  const p = new Parser(field.trim())
  const d: Dictionary = new Map()
  while (p.i < p.s.length) {
    const k = p.key()
    let m: Member
    if (p.peek() === '=') {
      p.i++
      m = p.member()
    } else m = { value: true, params: p.params() }
    d.set(k, m)
    p.ows()
    if (p.i >= p.s.length) break
    if (p.peek() !== ',') p.fail('expected ,')
    p.i++
    p.ows()
    if (p.i >= p.s.length) p.fail('trailing comma')
  }
  return d
}

export function serializeBare(v: BareItem): string {
  if (typeof v === 'boolean') return v ? '?1' : '?0'
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || Math.abs(v) > 999_999_999_999_999) throw new TypeError('bad integer')
    return String(v)
  }
  if (v instanceof Decimal) {
    const r = Math.round(v.value * 1000) / 1000
    return Number.isInteger(r) ? `${r}.0` : String(r)
  }
  if (v instanceof Token) {
    if (!/^[A-Za-z*][!#$%&'*+\-.^_`|~0-9A-Za-z:/]*$/.test(v.value)) throw new TypeError('bad token')
    return v.value
  }
  if (v instanceof Uint8Array) return `:${toBase64(v)}:`
  if (!/^[\x20-\x7e]*$/.test(v)) throw new TypeError('strings are printable ASCII')
  return `"${v.replace(/[\\"]/g, c => '\\' + c)}"`
}

export function serializeParams(p: Params): string {
  let out = ''
  for (const [k, v] of p) out += v === true ? `;${k}` : `;${k}=${serializeBare(v)}`
  return out
}

export function serializeInnerList(l: InnerList): string {
  return `(${l.items.map(it => serializeBare(it.value) + serializeParams(it.params)).join(' ')})${serializeParams(l.params)}`
}
