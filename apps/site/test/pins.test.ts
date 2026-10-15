// Pinned work (decided Oct 14, "One model for every node"; Myra: "if it's a project contianing code or assets then those
// should be posted in the pass vote"): a passed claim's links are its pins, which may also be an ipfs:// address, a
// magnet link or a rad: repo at a full commit, since each carries its own hash. Everything else keeps https links
// pinned by a sha256 or a commit. core/text.ts parsePins and parseLinks, the claim's act, the API, the site's form.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { hashPassword } from '../src/auth/password'
import { parseLinks, parsePins } from '../src/core/text'
import { loadStatus } from '../src/read/status'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { pinsFromForm } from '../src/web/node-routes'
import { ALL_PERMS, keyFor, send } from './agent-client'
import { Browser, fakeFetch, formTokenIn, body, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { person, refused, site, World, type P } from './core-fixtures'
import { T0 } from './d1'

const CID0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' // base58: `new URL` would lowercase it
const CID1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const BTIH = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a'
const BTMH = '1220' + 'ab'.repeat(32)
const RAD = 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5'
const COMMIT = 'e'.repeat(40)
const UNPINNED = 'links[0] needs a sha256 (a file) or a commit (a repo)'

describe('parsePins (decided Oct 14)', () => {
  it('takes what parseLinks takes, and the addresses that carry their own hash', () => {
    const web = [
      { url: 'https://codeberg.org/myra/doom-blocks/raw/branch/main/mid.pk3', sha256: '3f'.repeat(32) },
      { repo: 'https://codeberg.org/myra/doom-blocks', commit: COMMIT, path: 'src/blocks.zs', label: 'the mod' },
    ]
    expect(parsePins(web)).toEqual(web)
    expect(
      parsePins([
        { ipfs: `ipfs://${CID0}` },
        { ipfs: `ipfs://${CID1}/maps/e1m1.wad`, label: 'e1m1' },
        { url: `ipfs://${CID1}` }, // the same, spelled as a url
        { magnet: `magnet:?xt=urn:btih:${BTIH}&dn=mid.pk3` },
        { magnet: `magnet:?dn=mid&xt=urn:btih:${'A'.repeat(32)}` },
        { url: `magnet:?xt=urn:btmh:${BTMH}` },
        { repo: RAD, commit: COMMIT },
        { url: RAD, commit: COMMIT },
      ]),
    ).toEqual([
      { ipfs: `ipfs://${CID0}` },
      { ipfs: `ipfs://${CID1}/maps/e1m1.wad`, label: 'e1m1' },
      { ipfs: `ipfs://${CID1}` },
      { magnet: `magnet:?xt=urn:btih:${BTIH}&dn=mid.pk3` },
      { magnet: `magnet:?dn=mid&xt=urn:btih:${'A'.repeat(32)}` },
      { magnet: `magnet:?xt=urn:btmh:${BTMH}` },
      { repo: RAD, commit: COMMIT },
      { repo: RAD, commit: COMMIT },
    ])
  })

  it('refuses anything that can change under the link, in the words the submission form used', () => {
    for (const l of [
      { url: 'ipns://k51qzi5uqu5dlvj2baxnqndepeb86cbk3ng7n3i46uzyxzyqj2xjonzllnv0v8' }, // a name, not content
      { url: `https://ipfs.io/ipfs/${CID0}` }, // a gateway: https with no sha256
      { url: 'magnet:?dn=mid.pk3' }, // no exact topic
      { url: RAD }, // a bare rad id: its refs move
      { url: 'https://codeberg.org/myra/doom-blocks' },
    ])
      expect(() => parsePins([l])).toThrow(UNPINNED)
    expect(() => parsePins([{ ipfs: 'ipfs://not-a-cid' }])).toThrow('links[0].ipfs is not an ipfs://<cid> address, with no . or .. in its path')
    expect(() => parsePins([{ ipfs: `ipfs://${CID0.toLowerCase()}` }])).toThrow(/ipfs:\/\/<cid>/) // a CIDv0 lowercased is no CID
    expect(() => parsePins([{ magnet: 'magnet:?xt=urn:sha1:abc' }])).toThrow('links[0].magnet needs xt=urn:btih:<hash> or xt=urn:btmh:<hash>, and takes only xt, dn, tr, ws and xl')
    // a path that climbs out of the cid lands on whatever a gateway finds there (an ipns name can be repointed)
    const IPNS = 'k51qzi5uqu5dlvj2baxnqndepeb86cbk3ng7n3i46uzyxzyqj2xjonzllnv0v8'
    for (const path of [`/../../ipns/${IPNS}`, `/maps/../../ipns/${IPNS}`, '/./mid.pk3', `/%2e%2e/%2E%2E/ipns/${IPNS}`, `/.%2e/ipns/${IPNS}`, `/x%2f..%2f..%2fipns/${IPNS}`, '/..'])
      expect(() => parsePins([{ ipfs: `ipfs://${CID0}${path}` }]), path).toThrow(/ipfs:\/\/<cid> address/)
    expect(parsePins([{ ipfs: `ipfs://${CID0}/maps/e1..m1.wad` }])).toEqual([{ ipfs: `ipfs://${CID0}/maps/e1..m1.wad` }]) // dots inside a name are fine
    // a magnet carries hashes only: a mutable source (BEP 46) or any other pointer past them is refused
    for (const m of [
      `magnet:?xt=urn:btih:${BTIH}&xs=urn:btpk:${'a'.repeat(64)}&s=${'b'.repeat(64)}`,
      `magnet:?xt=urn:btih:${BTIH}&as=https://example.org/mid.pk3`,
      `magnet:?xt=urn:btih:${BTIH}&xt=urn:btpk:${'a'.repeat(64)}`,
      `magnet:?xt=urn:btih:${BTIH}&x.pe=1.2.3.4:6881`,
    ])
      expect(() => parsePins([{ magnet: m }]), m).toThrow(/takes only xt, dn, tr, ws and xl/)
    const hybrid = `magnet:?xt=urn:btih:${BTIH}&xt=urn:btmh:${BTMH}&dn=mid&tr=udp%3A%2F%2Ftracker.example%3A1337&ws=https%3A%2F%2Fexample.org%2Fmid&xl=1024`
    expect(parsePins([{ magnet: hybrid }])).toEqual([{ magnet: hybrid }])
    expect(() => parsePins([{ magnet: `magnet:?xt=urn:btih:${BTIH} ` }])).toThrow(/magnet needs/)
    expect(() => parsePins([{ ipfs: `ipfs://${CID0}`, url: 'https://x.org' }])).toThrow('links[0] is one link, not several')
    expect(() => parsePins([{ repo: RAD, commit: 'abc1234' }])).toThrow('links[0].commit must be a full commit id')
    expect(() => parsePins([{ ipfs: `ipfs://${CID0}`, size: 3 }])).toThrow('links[0] has unknown fields: size')
  })

  it('parseLinks keeps https only: no ipfs, magnet or rad there', () => {
    expect(() => parseLinks([{ url: `ipfs://${CID0}` }])).toThrow(UNPINNED)
    expect(() => parseLinks([{ ipfs: `ipfs://${CID0}` }])).toThrow('links[0] has unknown fields: ipfs')
    expect(() => parseLinks([{ magnet: `magnet:?xt=urn:btih:${BTIH}` }])).toThrow('links[0] has unknown fields: magnet')
    expect(() => parseLinks([{ repo: RAD, commit: COMMIT }])).toThrow('links[0].repo is not a web address')
  })
})

describe('pinned work on a passed claim', () => {
  let w: World
  let myra: P, kestrel: P
  const MID = 'minecraft-in-doom'
  beforeEach(async () => {
    w = new World()
    myra = await person(w.db, 'myra')
    kestrel = await person(w.db, 'kestrel')
    await w.shwarm(site(myra))
    await w.join(site(kestrel), MID)
    w.db.raw.prepare("UPDATE node SET triage = 'clear'").run()
  })
  const claim = (status: string, links: unknown, by = kestrel) => w.run({ type: 'post', actor: site(by), input: { node: MID, text: 'all nine maps from a pistol start.', claim: status, links } })

  it('are the claim\'s links, as the briefing and the page read them; any other post keeps https links', async () => {
    const pins = [{ repo: RAD, commit: COMMIT }, { ipfs: `ipfs://${CID0}` }, { magnet: `magnet:?xt=urn:btih:${BTIH}` }]
    const c = await claim('passed', pins)
    expect(JSON.parse(w.get('SELECT links FROM post WHERE id = ?', c.id).links)).toEqual(pins)
    const s = await loadStatus(w.db, w.node(MID), null, w.now)
    expect(s.claims).toEqual([expect.objectContaining({ post: c.id, status: 'passed', pins })])
    // a passed claim with none says so by having none
    const d = await claim('passed', undefined, myra)
    expect((await loadStatus(w.db, w.node(MID), null, w.now)).claims.find(x => x.post === d.id)!.pins).toEqual([])
    // a blocked claim and a plain post keep the https rule; a refused claim posts nothing
    expect((await refused(claim('blocked', [{ ipfs: `ipfs://${CID0}` }]), 'bad_request')).message).toBe('links[0] has unknown fields: ipfs')
    await refused(w.post(site(kestrel), MID, 'see this', { links: [{ url: `ipfs://${CID0}` }] }), 'bad_request')
    // an unpinned pin is refused in the submission form's words
    expect((await refused(claim('passed', [{ url: 'https://codeberg.org/k/x' }]), 'bad_request')).message).toBe(UNPINNED)
    expect(w.get("SELECT COUNT(*) AS n FROM post WHERE claim IS NOT NULL").n).toBe(2)
  })

  describe('through the API and the site', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', fakeFetch())
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(T0)
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      resetReadLimit()
      forgetVersions()
    })
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('an agent pins its human\'s work on a passed claim with `links`', async () => {
      const env = testEnv(w.db)
      const key = await keyFor(w.db, kestrel.id, { canPostAs: '@kestrel/*', grants: [{ node: '*', perms: ALL_PERMS }] })
      const pins = [{ ipfs: `ipfs://${CID1}/mid.pk3` }, { repo: 'https://codeberg.org/kestrel/mid', commit: COMMIT }]
      const r = await send(app, env, key, { path: `/w/${MID}`, body: { as: '@kestrel/claude', kind: 'post', text: 'soak.sh: 0 failures in 10000.', claim: 'passed', links: pins } })
      expect(r.status).toBe(201)
      expect(JSON.parse(w.get('SELECT links FROM post WHERE id = ?', r.json.id).links)).toEqual(pins)
      const bad = await send(app, env, key, { path: `/w/${MID}`, body: { as: '@kestrel/claude', kind: 'post', text: 'x', claim: 'passed', links: [{ url: 'ipns://k51qzi5uqu5d' }] } })
      expect(bad.status).toBe(400)
      expect(bad.json).toMatchObject({ error: 'bad_request', message: UNPINNED, field: 'links' })
    })

    it("the passed claim's form takes one pin per line", async () => {
      const env = testEnv(w.db)
      w.db.raw.prepare('UPDATE person SET password_hash = ? WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), kestrel.id)
      const b = new Browser(env)
      expect((await b.post('/signin', { email: 'kestrel@example.org', password: GOOD_PASSWORD })).status).toBe(303)
      const token = formTokenIn(await body(await b.req('/new', { headers: { accept: 'text/html' } })))
      const links = [`${RAD} ${COMMIT}`, `ipfs://${CID0}`, `magnet:?xt=urn:btih:${BTIH}&dn=mid.pk3`, `https://codeberg.org/k/mid.pk3 ${'3F'.repeat(32)}`].join('\r\n')
      const r = await b.req(`/w/${MID}`, { form: { form_token: token, do: 'claim', status: 'passed', text: 'all nine maps.', links } })
      expect(r.status).toBe(303)
      const id = w.get("SELECT id FROM post WHERE claim = 'passed'").id
      expect(r.headers.get('location')).toBe(`/w/${MID}#${id}`)
      expect(JSON.parse(w.get('SELECT links FROM post WHERE id = ?', id).links)).toEqual([
        { repo: RAD, commit: COMMIT },
        { ipfs: `ipfs://${CID0}` },
        { magnet: `magnet:?xt=urn:btih:${BTIH}&dn=mid.pk3` },
        { url: 'https://codeberg.org/k/mid.pk3', sha256: '3f'.repeat(32) },
      ])
      // a blocked claim's form sends no pins, whatever the box held
      await b.req(`/w/${MID}`, { form: { form_token: token, do: 'claim', status: 'blocked', text: 'e1m3 softlocks.', links: `ipfs://${CID0}` } })
      expect(w.get("SELECT links FROM post WHERE claim = 'blocked'").links).toBe('[]')
    })
  })

  it('pinsFromForm reads the shapes and leaves the checking to core', () => {
    expect(pinsFromForm(`  ipfs://${CID0}  \n\nmagnet:?xt=urn:btih:${BTIH}\n${RAD} ${'E'.repeat(64)}\nhttps://x.org/r ${COMMIT} src/a.zs\nhttps://x.org/plain`)).toEqual([
      { ipfs: `ipfs://${CID0}` },
      { magnet: `magnet:?xt=urn:btih:${BTIH}` },
      { repo: RAD, commit: 'e'.repeat(64) }, // a rad repo is a repo, even with a 64-character commit
      { repo: 'https://x.org/r', commit: COMMIT, path: 'src/a.zs' },
      { url: 'https://x.org/plain' }, // no fingerprint: core refuses it
    ])
  })
})
