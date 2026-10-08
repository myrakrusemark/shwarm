import { describe, expect, it } from 'vitest'
import { canonicalize } from '../src'

describe('canonical JSON (RFC 8785)', () => {
  it('matches the RFC example', () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    )
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    )
  })

  it('sorts keys by UTF-16 code units (RFC 3.2.3)', () => {
    const input = { '€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One', '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis' }
    // Compare strings: JSON.parse would reorder the integer-like key "1" to the front.
    const order = ['\r', '1', '\u0080', '\u00f6', '\u20ac', '\ud83d\ude00', '\ufb33']
    expect(canonicalize(input)).toBe('{' + order.map(k => JSON.stringify(k) + ':' + JSON.stringify((input as any)[k])).join(',') + '}')
  })

  it('has no whitespace and nests', () => {
    expect(canonicalize({ b: [1, { d: 2, c: 'x' }], a: null })).toBe('{"a":null,"b":[1,{"c":"x","d":2}]}')
  })

  it('writes -0 as 0 and refuses non-finite numbers', () => {
    expect(canonicalize(-0)).toBe('0')
    expect(() => canonicalize(NaN)).toThrow()
    expect(() => canonicalize(Infinity)).toThrow()
  })

  it('drops undefined members and refuses functions', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(() => canonicalize(() => 1)).toThrow()
  })
})
