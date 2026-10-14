// RENDER_VERSION (web/node-routes.tsx) is in every signed-out ETag, and nothing else in one moves on a deploy: change
// what a page or its JSON shows for an unchanged tree without bumping it, and a browser or cache that revalidates gets a
// 304 and keeps the old page until the tree's next event. This pins a fingerprint of the signed-out renderings of the
// closed world (the result page, its JSON and text, the live branch page, the log both ways) to the version. When it
// fails, the rendering changed: bump RENDER_VERSION with a note, then put the new fingerprint here.
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { RENDER_VERSION } from '../src/web/node-routes'
import { WORDS_VERSION } from '../src/words'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { T0 } from './d1'
import { body, Browser, fakeFetch, testEnv } from './browser'
import { closedWorld } from './result-fixture'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 + 3_600_000)
  resetReadLimit()
  forgetVersions()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const PAGES: [string, string][] = [
  [`/w/${EXAMPLE_ROOT}`, 'text/html'],
  [`/w/${EXAMPLE_ROOT}`, 'application/json'],
  [`/w/${EXAMPLE_ROOT}`, 'text/plain'],
  [`/w/${EXAMPLE_BRANCH}`, 'text/html'],
  [`/w/${EXAMPLE_ROOT}/log`, 'application/json'],
  [`/w/${EXAMPLE_ROOT}/log?filter=all`, 'application/json'],
]

/** Random ids (core/ids.ts) and what's derived from them, numbered by first appearance so two runs read the same. */
function stable(s: string): string {
  const seen = new Map<string, string>()
  const as = (kind: string) => (m: string) => {
    if (!seen.has(m)) seen.set(m, `${kind}${seen.size}`)
    return seen.get(m)!
  }
  // An id after %23 (an encoded #, as in a post's /report?url= link) has no word boundary before it.
  return s.replace(/(?:\b|(?<=%23))[pcev]_[a-z0-9]{8,32}\b/g, as('id')).replace(/\b[0-9a-f]{40,64}\b/g, as('hex')).replace(/\b[0-9a-f]{7,8}\b/g, as('short'))
}

async function fingerprint() {
  const w = await closedWorld()
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
      RENDER_VERSION: '23',
      WORDS_VERSION: '2r0z9a',
      fingerprint: 'f2dadd93b8fa8826', // also moves when the seeded launch entries in docs/launch-shwarms.json, the running example (seed/example.ts) or test/result-fixture.ts change (no bump then: the code renders the same)
    })
  })
})
