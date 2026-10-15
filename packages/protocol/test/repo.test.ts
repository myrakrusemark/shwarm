// The shared repo finder (repoIn, used by the site's WHERE THE WORK LIVES and `shwarm start`) with the link shapes a
// passed claim's pinned work can carry since Oct 14: an ipfs:// address or a magnet: link names no repo; a Radicle repo
// with a full commit does (isRadRepo). The CLI's own tests (packages/cli/test/start.test.ts) cover the text forms.
import { describe, expect, it } from 'vitest'
import { isRadRepo, repoIn, type Link } from '../src'

const RID = 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5'
const IPFS: Link = { ipfs: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/mid.pk3' }
const MAGNET: Link = { magnet: 'magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a&dn=mid' }

describe('isRadRepo', () => {
  it('is a whole rad: repo id, in either spelling, and nothing else', () => {
    expect(isRadRepo(RID)).toBe(true)
    expect(isRadRepo(`rad://${RID.slice(4)}`)).toBe(true)
    for (const s of [`${RID}/src`, ` ${RID}`, 'rad:z3gq', 'rad:a3gqcJUoA1n9HaHKufZs5FCSGazv5', 'https://codeberg.org/myra/doom-blocks', `brad${RID.slice(3)}`]) expect(isRadRepo(s), s).toBe(false)
  })
})

describe('repoIn with pinned work', () => {
  it('passes over ipfs and magnet pins, which name no repo, to the next link', () => {
    expect(repoIn({ text: 'the mod, pinned', links: [IPFS, MAGNET] })).toBeNull()
    expect(repoIn({ text: 'the mod, pinned', links: [IPFS, MAGNET, { repo: 'https://codeberg.org/myra/doom-blocks', commit: 'e'.repeat(40) }] })).toEqual({
      repo: 'https://codeberg.org/myra/doom-blocks',
      kind: 'git',
    })
  })

  it('reads a Radicle repo pinned with its commit', () => {
    expect(repoIn({ text: 'the source', links: [MAGNET, { repo: RID, commit: 'f'.repeat(40) }] })).toEqual({ repo: RID, kind: 'rad' })
  })
})
