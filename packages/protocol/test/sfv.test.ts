import { describe, expect, it } from 'vitest'
import { sfv } from '../src'

const { Decimal, Token, isInnerList, parseDictionary, serializeBare, serializeInnerList } = sfv

describe('structured fields (RFC 8941)', () => {
  it('parses a Signature-Input dictionary and serializes it back the same', () => {
    const field = 'sig1=("@method" "@path" "content-digest");created=1618884473;keyid="k\\"1";ok;n=-12;d=1.5;t=foo/bar'
    const m = parseDictionary(field).get('sig1')!
    expect(isInnerList(m)).toBe(true)
    if (!isInnerList(m)) return
    expect(m.items.map(i => i.value)).toEqual(['@method', '@path', 'content-digest'])
    expect(m.params.get('created')).toBe(1618884473)
    expect(m.params.get('keyid')).toBe('k"1')
    expect(m.params.get('ok')).toBe(true)
    expect(m.params.get('n')).toBe(-12)
    expect(m.params.get('d')).toBeInstanceOf(Decimal)
    expect((m.params.get('t') as InstanceType<typeof Token>).value).toBe('foo/bar')
    expect('sig1=' + serializeInnerList(m)).toBe(field)
  })

  it('parses byte sequences, padded or not, and several members with spacing', () => {
    const d = parseDictionary(' a=:AQID:,  b=:AQI:\t, c ')
    expect(Array.from((d.get('a') as any).value)).toEqual([1, 2, 3])
    expect(Array.from((d.get('b') as any).value)).toEqual([1, 2])
    expect((d.get('c') as any).value).toBe(true)
    expect(serializeBare(new Uint8Array([1, 2]))).toBe(':AQI=:')
  })

  it('lets a later duplicate key win, as RFC 8941 says', () => {
    expect((parseDictionary('a=1, a=2').get('a') as any).value).toBe(2)
  })

  it('refuses what RFC 8941 refuses', () => {
    for (const bad of [
      'a=1,',
      'A=1',
      'a=1 b=2',
      'a="unterminated',
      'a="bad \\n escape"',
      'a=1234567890123456',
      'a=1234567890123.5',
      'a=1.2345',
      'a=1.',
      'a=:@@:',
      'a=:AQID',
      'a=?2',
      'a=(1 2',
      'a=(1"x")',
      'a=@1659578233',
      'a="é"',
    ])
      expect(() => parseDictionary(bad), bad).toThrow(SyntaxError)
  })

  it('serializes only what it can represent', () => {
    expect(serializeBare('a "q" \\')).toBe('"a \\"q\\" \\\\"')
    expect(serializeBare(false)).toBe('?0')
    expect(serializeBare(new Decimal(2))).toBe('2.0')
    expect(() => serializeBare('é')).toThrow()
    expect(() => serializeBare(1.5)).toThrow()
    expect(() => serializeBare(new Token('1x'))).toThrow()
  })
})
