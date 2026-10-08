import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashMatches, shortHash, submissionHash } from '../src'

const nodeSha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

describe('submission hash', () => {
  const sub = {
    text: 'block placement works: place, break, save, reload.',
    links: [{ url: 'https://codeberg.org/myra/mid/archive/v1.tar.gz', sha256: 'ab'.repeat(32) }],
  }

  it('is sha256 over the canonical JSON of {text, links}', async () => {
    const expected = nodeSha(
      '{"links":[{"sha256":"' + 'ab'.repeat(32) + '","url":"https://codeberg.org/myra/mid/archive/v1.tar.gz"}],' +
        '"text":"block placement works: place, break, save, reload."}',
    )
    expect(await submissionHash(sub)).toBe(expected)
  })

  it("doesn't depend on key order or extra fields", async () => {
    const reordered = { links: [{ sha256: 'ab'.repeat(32), url: sub.links[0].url }], text: sub.text }
    expect(await submissionHash(reordered)).toBe(await submissionHash(sub))
    expect(await submissionHash({ ...sub, how_to_check: 'run it' } as any)).toBe(await submissionHash(sub))
  })

  it('treats missing links as an empty list', async () => {
    expect(await submissionHash({ text: 'x' })).toBe(await submissionHash({ text: 'x', links: [] }))
    expect(await submissionHash({ text: 'x' })).toBe(nodeSha('{"links":[],"text":"x"}'))
  })

  it('changes when the text, a link or link order changes', async () => {
    const h = await submissionHash(sub)
    expect(await submissionHash({ ...sub, text: sub.text + ' ' })).not.toBe(h)
    const two = [...sub.links, { repo: 'https://codeberg.org/myra/mid', commit: 'c0ffee1' }]
    expect(await submissionHash({ text: sub.text, links: two })).not.toBe(
      await submissionHash({ text: sub.text, links: [...two].reverse() }),
    )
  })

  it('hashes non-ASCII text as UTF-8', async () => {
    expect(await submissionHash({ text: 'café ✓ 🧱' })).toBe(nodeSha('{"links":[],"text":"café ✓ 🧱"}'))
  })

  it('shows 7 characters and matches prefixes of 7 or more', async () => {
    const h = await submissionHash(sub)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(shortHash(h)).toBe(h.slice(0, 7))
    expect(hashMatches(h, h.slice(0, 7))).toBe(true)
    expect(hashMatches(h, h.slice(0, 12).toUpperCase())).toBe(true)
    expect(hashMatches(h, h)).toBe(true)
    expect(hashMatches(h, h.slice(0, 6))).toBe(false)
    expect(hashMatches(h, '0000000')).toBe(h.startsWith('0000000'))
    expect(hashMatches(h, h.slice(0, 7) + 'z')).toBe(false)
    expect(hashMatches(h, h + '0')).toBe(false)
  })
})
