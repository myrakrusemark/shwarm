// The announce box orders terms versions by their place in the bundle, not by semver. Reads the real terms.json.
import { describe, expect, it } from 'vitest'
import { announceRefusal, latestTerms, termsEntry } from '../src/core/terms'

const OCT_12 = Date.parse('2026-10-12T12:00:00Z')

describe('the real terms bundle', () => {
  it('ends at v0.2, in effect Nov 15', () => {
    expect(latestTerms()).toMatchObject({ version: '0.2', effective: '2026-11-15' })
    expect(termsEntry('0.1')).toMatchObject({ effective: '2026-10-08' })
  })
  it('takes 0.2 over 0.1, and refuses 0.2 again once it is announced', () => {
    expect(announceRefusal('0.2', '0.1', 2, OCT_12)).toBeNull()
    expect(announceRefusal('0.2', '0.2', 2, OCT_12)).toContain("v0.2 isn't newer than v0.2")
  })
})
