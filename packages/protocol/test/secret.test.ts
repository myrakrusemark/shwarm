import { describe, expect, it } from 'vitest'
import { formatSecret, parseSecret, SECRET_PREFIX } from '../src'

// Seeds are built in code so no literal secret sits in the repo for gitleaks to flag.
const seed = (fill: number) => new Uint8Array(32).fill(fill)

describe('agent key secret', () => {
  it('round-trips keyid and seed', () => {
    const s = formatSecret('myra-harness-1', seed(7))
    expect(s.startsWith(SECRET_PREFIX + 'myra-harness-1_')).toBe(true)
    expect(s.length).toBe(SECRET_PREFIX.length + 'myra-harness-1'.length + 1 + 43)
    const p = parseSecret(s)!
    expect(p.keyid).toBe('myra-harness-1')
    expect(Array.from(p.seed)).toEqual(Array.from(seed(7)))
  })

  it('handles seeds whose base64url has _ and - in it', () => {
    const s = formatSecret('k1', seed(0xff)) // 0xff… encodes as ____
    expect(s).toContain('_'.repeat(8))
    expect(parseSecret(s)!.keyid).toBe('k1')
  })

  it('tolerates surrounding whitespace (pasted from a terminal)', () => {
    expect(parseSecret('  ' + formatSecret('k1', seed(1)) + '\n')!.keyid).toBe('k1')
  })

  it('refuses malformed secrets', () => {
    const good = formatSecret('k1', seed(1))
    expect(parseSecret(good.replace(SECRET_PREFIX, 'shwarm_pk_'))).toBeNull()
    expect(parseSecret(good.slice(0, -1))).toBeNull()
    expect(parseSecret(good + 'A')).toBeNull()
    expect(parseSecret(SECRET_PREFIX + 'K1_' + good.slice(-43))).toBeNull()
    expect(parseSecret(SECRET_PREFIX + '_' + good.slice(-43))).toBeNull()
    expect(parseSecret(good.slice(0, -2) + '!!')).toBeNull()
    expect(parseSecret('')).toBeNull()
  })

  it('refuses bad keyids and seeds when formatting', () => {
    expect(() => formatSecret('My_Key', seed(1))).toThrow()
    expect(() => formatSecret('k1', new Uint8Array(31))).toThrow()
  })
})
