// RENDER_VERSION (web/node-routes.tsx) is in every signed-out ETag, and nothing else in one moves on a deploy: change
// what a page or its JSON shows for an unchanged tree without bumping it, and a browser or cache that revalidates gets a
// 304 and keeps the old page until the tree's next event. This pins a fingerprint of the signed-out renderings of a
// shwarm that passed (its page with the pass box, its JSON and text, its branch's page with a claim, the log both ways)
// to the version. When it fails, the rendering changed: bump RENDER_VERSION with a note, then put the new fingerprint here.
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RENDER_VERSION } from '../src/web/node-routes'
import { WORDS_VERSION } from '../src/words'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { body, Browser, fakeFetch, testEnv } from './browser'
import { HOUR, person, site, stepped, World } from './core-fixtures'

const MID = 'minecraft-in-doom'
const BP = `${MID}/block-placement`

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  resetReadLimit()
  forgetVersions()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const PAGES: [string, string][] = [
  [`/w/${MID}`, 'text/html'],
  [`/w/${MID}`, 'application/json'],
  [`/w/${MID}`, 'text/plain'],
  [`/w/${BP}`, 'text/html'],
  [`/w/${MID}/log`, 'application/json'],
  [`/w/${MID}/log?filter=all`, 'application/json'],
]

/**
 * kestrel's passed claim on the shwarm, with its pinned work, backed by lumpy: it passes a day on, an act writes the
 * change, and the author marks it passed too. On the branch, a blocked claim.
 */
async function passedWorld() {
  const w = new World()
  const [myra, kestrel, lumpy, ana] = [await person(w.db, 'myra'), await person(w.db, 'kestrel'), await person(w.db, 'lumpy'), await person(w.db, 'ana')]
  await w.shwarm(site(myra))
  await w.branch(site(myra), MID)
  w.db.raw.prepare("UPDATE node SET triage = 'clear'").run()
  for (const p of [kestrel, lumpy]) await w.join(site(p), MID)
  const links = [{ repo: 'https://codeberg.org/kestrel/doom-blocks', commit: '9fceb02d0ae598e95dc970b74767f19372d61af8' }, { ipfs: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/mid.pk3' }]
  const c = await w.post(site(kestrel), MID, 'all nine maps from a pistol start, 60 fps on the reference rig.', { claim: 'passed', links })
  await w.run({ type: 'back', actor: site(lumpy), input: { node: MID, post: c.id, on: true } })
  w.tick(25 * HOUR)
  await w.join(site(ana), MID)
  await w.run({ type: 'status', actor: site(ana), input: { node: MID, status: 'on_track' } })
  await w.run({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: c.id } })
  await w.join(site(kestrel), BP)
  await w.post(site(kestrel), BP, "P_CheckSight still answers for the old block after a break.", { claim: 'blocked' })
  vi.setSystemTime(w.now + HOUR)
  return w
}

/** Random ids (core/ids.ts) and what's derived from them, numbered by first appearance so two runs read the same. */
function stable(s: string): string {
  const seen = new Map<string, string>()
  const as = (kind: string) => (m: string) => {
    if (!seen.has(m)) seen.set(m, `${kind}${seen.size}`)
    return seen.get(m)!
  }
  // An id after %23 (an encoded #, as in a post's /report?url= link) has no word boundary before it.
  return s.replace(/(?:\b|(?<=%23))[pcevhr]_[a-z0-9]{8,32}\b/g, as('id')).replace(/\b[0-9a-f]{40,64}\b/g, as('hex')).replace(/\b[0-9a-f]{7,8}\b/g, as('short'))
}

async function fingerprint() {
  const w = await passedWorld()
  const b = new Browser(testEnv(w.db))
  const h = createHash('sha256')
  for (const [path, accept] of PAGES) {
    const res = await b.req(path, { headers: { accept } })
    expect(res.status, path).toBe(200)
    h.update(`${path} ${accept}\n${stable(await body(res))}\n`)
  }
  return h.digest('hex').slice(0, 16)
}

describe('RENDER_VERSION', () => {
  it('moves with the signed-out rendering', async () => {
    const first = await fingerprint()
    forgetVersions()
    resetReadLimit()
    expect(await fingerprint(), 'the fingerprint is not stable across runs').toBe(first)
    // A changed word moves WORDS_VERSION, which is in the ETag already: update it and the fingerprint here, no bump.
    expect({ RENDER_VERSION, WORDS_VERSION, fingerprint: first }, 'the signed-out rendering changed: bump RENDER_VERSION (web/node-routes.tsx), unless WORDS_VERSION moved too, then update this fingerprint').toEqual({
      RENDER_VERSION: '28',
      WORDS_VERSION: 'bngnmt',
      fingerprint: '10b71688b06d6827', // also moves when passedWorld above changes (no bump then: the code renders the same)
    })
  })
})
