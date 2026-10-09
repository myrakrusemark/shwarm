// Small pure pieces of the core: names in text, links, slugs, check specs and tallies, grants, ids, settings.
import { describe, expect, it } from 'vitest'
import { grantFor } from '../src/core/actor'
import { needs, parseCheckSpec, tally } from '../src/core/checks'
import { treeName } from '../src/core/engine'
import { parseRelease, RELEASE_CAPS } from '../src/core/posts'
import { isId, newId } from '../src/core/ids'
import { readSettings, setting } from '../src/core/settings'
import { extractMentions, parseLinks, slugify } from '../src/core/text'
import { testDb } from './d1'

describe('mentions (protocol §9)', () => {
  it('takes the longest name after a start, space or punctuation, dropping trailing . - _', () => {
    expect(extractMentions('thanks @myra/m-07.')).toEqual(['@myra/m-07'])
    expect(extractMentions('a@b_c mentions nobody')).toEqual([])
    expect(extractMentions('@kestrel/swarm/r-17 go for it, (@myra) and @myra again')).toEqual(['@kestrel/swarm/r-17', '@myra'])
    expect(extractMentions('@x is too short; @Myra is not lowercase')).toEqual([])
    expect(extractMentions('see @myra/fathom-minecraft-in-doom/0a27_')).toEqual(['@myra/fathom-minecraft-in-doom/0a27'])
  })
})

describe('links', () => {
  const sha = 'a'.repeat(64)
  it('accepts pinned files and repos at a commit', () => {
    expect(parseLinks([{ url: 'https://x.org/a', sha256: sha, name: 'log' }])).toEqual([{ url: 'https://x.org/a', sha256: sha, label: 'log' }])
    expect(parseLinks([{ url: 'https://codeberg.org/x/y', commit: 'b'.repeat(40) }])).toEqual([{ repo: 'https://codeberg.org/x/y', commit: 'b'.repeat(40) }])
  })
  it('refuses unpinned links, other schemes, uploads and too many', () => {
    expect(() => parseLinks([{ url: 'https://x.org/a' }])).toThrow(/sha256/)
    expect(() => parseLinks([{ url: 'javascript:alert(1)', sha256: sha }])).toThrow(/web address/)
    expect(() => parseLinks([{ name: 'x', upload: 'u_1' }])).toThrow(/unknown fields/)
    expect(() => parseLinks([{ repo: 'https://x.org', commit: 'main' }])).toThrow(/full commit/)
    expect(() => parseLinks(Array(21).fill({ url: 'https://x.org/a', sha256: sha }))).toThrow(/at most 20/)
  })
})

describe('slugs (protocol §3)', () => {
  it('lowercases, turns other runs into dashes and trims', () => {
    expect(slugify('every US lead pipe, mapped')).toBe('every-us-lead-pipe-mapped')
    expect(slugify('  café: déjà vu!  ')).toBe('cafe-deja-vu')
    expect(slugify('!!!')).toBe('')
    expect(slugify('word '.repeat(40)).length).toBeLessThanOrEqual(80)
  })
})

describe('check specs', () => {
  it('reads the flat and grouped people forms', () => {
    expect(parseCheckSpec({ runs: { command: './bench.sh' }, people: 3, human: true, author: true, instructions: 'play it' })).toEqual({
      runs: { command: './bench.sh', count: 2 },
      people: { count: 3, human: true, instructions: 'play it' },
      author: true,
    })
    expect(parseCheckSpec({ people: { count: 1, human: true } })).toEqual({ people: { count: 1, human: true }, author: false })
  })
  it('refuses an empty spec (no_done_test) and malformed counts (bad_request)', () => {
    expect(() => parseCheckSpec({})).toThrow(expect.objectContaining({ code: 'no_done_test' }))
    expect(() => parseCheckSpec({ people: -1 })).toThrow(expect.objectContaining({ code: 'bad_request' }))
    expect(() => parseCheckSpec({ human: true, author: true })).toThrow(expect.objectContaining({ code: 'bad_request' }))
  })
  it('tallies: author last, a standing repro blocks, the A9 swap adds a people check', () => {
    const spec = parseCheckSpec({ runs: { command: 'x', count: 1 }, people: { count: 1, human: true }, author: true })
    const n = needs(spec, false)
    expect(tally(n, [{ slot: 'run', verdict: 'pass', human: false }]).othersDone).toBe(false)
    const others = [
      { slot: 'run' as const, verdict: 'pass' as const, human: false },
      { slot: 'people' as const, verdict: 'pass' as const, human: true },
    ]
    expect(tally(n, others)).toMatchObject({ othersDone: true, passed: false })
    expect(tally(n, [...others, { slot: 'author', verdict: 'pass', human: true }]).passed).toBe(true)
    expect(tally(n, [...others, { slot: 'people', verdict: 'fail', human: false }]).othersDone).toBe(false)
    expect(needs(spec, true)).toEqual({ runs: 1, people: 2, human: true, author: false })
    expect(needs(parseCheckSpec({ people: 1 }), true)).toEqual({ runs: 0, people: 1, human: false, author: false })
  })
})

describe('release fields (table B #64)', () => {
  it('takes name, version and how to use, each optional and trimmed', () => {
    expect(parseRelease(undefined)).toEqual({ name: null, version: null, howToUse: null })
    expect(parseRelease({ name: ' minecraft in doom v1.0 ', version: 'e9b41d0', howToUse: 'gzdoom -iwad freedoom2.wad\n-file mid-v1.pk3' })).toEqual({
      name: 'minecraft in doom v1.0',
      version: 'e9b41d0',
      howToUse: 'gzdoom -iwad freedoom2.wad\n-file mid-v1.pk3',
    })
    expect(parseRelease({ version: '' })).toEqual({ name: null, version: null, howToUse: null })
  })
  it('caps them at 120, 50 and 2000 characters (proposed)', () => {
    expect(RELEASE_CAPS).toEqual({ name: 120, version: 50, howToUse: 2000 })
    expect(parseRelease({ name: 'é'.repeat(120), version: 'v'.repeat(50), howToUse: 'x'.repeat(2000) }).name).toHaveLength(120)
    expect(() => parseRelease({ name: 'x'.repeat(121) })).toThrow(/release.name is longer than 120/)
    expect(() => parseRelease({ version: 'x'.repeat(51) })).toThrow(/release.version is longer than 50/)
    expect(() => parseRelease({ howToUse: 'x'.repeat(2001) })).toThrow(/release.how_to_use is longer than 2000/)
  })
  it('refuses other shapes, a second line in name or version, and hidden characters', () => {
    expect(() => parseRelease('v1')).toThrow(expect.objectContaining({ code: 'bad_request' }))
    expect(() => parseRelease([])).toThrow(expect.objectContaining({ code: 'bad_request' }))
    expect(() => parseRelease({ name: 'v1', archives: [] })).toThrow(/unknown fields: archives/)
    expect(() => parseRelease({ version: 'v1\r\nv2' })).toThrow(/one line/)
    expect(() => parseRelease({ howToUse: 'run\u200b it' })).toThrow(/hidden characters/)
  })
})

describe('grants', () => {
  it('picks the most specific grant; a node covers its branches', () => {
    const gs = [
      { node: '*', perms: ['read' as const] },
      { node: 'minecraft-in-doom', perms: ['post' as const] },
      { node: 'minecraft-in-doom/block-placement', perms: ['check' as const] },
    ]
    expect(grantFor(gs, 'other')?.node).toBe('*')
    expect(grantFor(gs, 'minecraft-in-doom/sound')?.node).toBe('minecraft-in-doom')
    expect(grantFor(gs, 'minecraft-in-doom/block-placement/monster-collision')?.node).toBe('minecraft-in-doom/block-placement')
    expect(grantFor(gs, 'minecraft-in-doomed')?.node).toBe('*')
    expect(grantFor([], 'x')).toBeNull()
  })
})

describe('ids and trees', () => {
  it('makes prefixed random ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId('p')))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(isId('p', id)).toBe(true)
    expect(isId('c', newId('p'))).toBe(false)
  })
  it('routes every command to its root shwarm; new shwarms share one tree', () => {
    const actor = { personId: 1, handle: 'myra', as: '@myra', via: 'site' as const }
    expect(treeName({ type: 'post', actor, input: { node: 'minecraft-in-doom/block-placement', text: 'x' } })).toBe('minecraft-in-doom')
    expect(treeName({ type: 'createNode', actor, input: { kind: 'branch', parent: 'minecraft-in-doom/block-placement' } as any })).toBe('minecraft-in-doom')
    expect(treeName({ type: 'createNode', actor, input: { kind: 'variant', variantOf: 'minecraft-in-doom' } as any })).toBe(':new')
  })
})

describe('settings', () => {
  it('reads JSON values with defaults', async () => {
    const db = testDb()
    expect(await readSettings(db, ['read_only', 'pause_new_nodes'])).toEqual({ read_only: false, pause_new_nodes: false })
    expect((await readSettings(db)).site_mode).toBe('holding')
    expect(await setting(db, 'missing', 7)).toBe(7)
    await db.prepare("UPDATE setting SET value = 'not json' WHERE key = 'read_only'").run()
    expect((await readSettings(db, ['read_only'])).read_only).toBe(false)
  })
})
