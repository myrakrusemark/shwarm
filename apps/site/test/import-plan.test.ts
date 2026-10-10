// Go-live 3.10 / 12.1: which launch shwarms may go to production. Only an approval Myra gave for the done test as it
// stands now; never a "change", a question, no verdict, or a dropped card.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { approvedFrom, checkArgs, parseArgs, Refused } from '../../../scripts/seed-launch'
import { formatReadiness, latestVerdict, parseDrops, readiness, type LaunchEntry, type Proof } from '../src/seed/approved'

const LIST: LaunchEntry[] = JSON.parse(readFileSync(new URL('../../../docs/launch-shwarms.json', import.meta.url), 'utf8'))
const PROOF: Proof = JSON.parse(readFileSync(new URL('../../../tracker/proof.json', import.meta.url), 'utf8'))

const entry = (slug: string, extra: Partial<LaunchEntry> = {}): LaunchEntry => ({
  slug, wave: 1, title: slug, what: 'why it matters.', tags: ['#t'], done_when: 'it is done.', checked_by: { runs: { count: 1 } }, builds_on: '', sources: [], why_now: '', ...extra,
})
const say = (from: string, choice: string, at: string, text = '') => ({ from, choice, at, text })

describe('the latest verdict', () => {
  it("is the last message that isn't Claude's", () => {
    expect(latestVerdict(undefined)).toBeNull()
    expect(latestVerdict([say('claude', 'answer', 't1')])).toBeNull()
    expect(latestVerdict([say('myra', 'approve', 't1'), say('claude', 'answer', 't2')])).toEqual({ choice: 'approve', at: 't1' })
    expect(latestVerdict([say('myra', 'approve', 't1'), say('myra', 'question', 't2'), say('claude', 'answer', 't3')])).toEqual({ choice: 'question', at: 't2' })
    expect(latestVerdict([say('myra', 'change', 't1'), say('myra', 'approve', 't2')])).toEqual({ choice: 'approve', at: 't2' })
  })

  it('reads the drop list', () => {
    expect([...parseDrops('# drops\n\nintro - not-a-slug\n- a-year-of-earthquakes-played (wave 1; ideas)\n- moss-powered-clock (wave 2)\n')]).toEqual([
      'a-year-of-earthquakes-played',
      'moss-powered-clock',
    ])
  })
})

describe('readiness', () => {
  const T = '2026-10-09T01:00:00.000Z'
  const list = [
    entry('ok'),
    entry('later', { what: 'a new why.' }),
    entry('moved', { done_when: 'something else.' }),
    entry('rechecked', { checked_by: { runs: { count: 2 } } }),
    entry('renamed'),
    entry('asked'),
    entry('fix'),
    entry('silent'),
    entry('gone'),
    entry('nope'),
    entry('two', { wave: 2 }),
  ]
  const proof: Proof = {
    ok: [say('myra', 'approve', T)],
    later: [say('myra', 'approve', T), say('claude', 'answer', T)],
    moved: [say('myra', 'approve', T)],
    rechecked: [say('myra', 'approve', T)],
    renamed: [say('myra', 'approve', T)],
    asked: [say('myra', 'approve', T), say('myra', 'question', T)],
    fix: [say('myra', 'change', T, 'say why')],
    gone: [say('myra', 'approve', T)],
    nope: [say('myra', 'no', T)],
    two: [say('myra', 'approve', T)],
  }
  const atApproval = (slug: string) => (slug === 'renamed' ? null : entry(slug, slug === 'two' ? { wave: 2 } : {}))
  const rows = readiness(list, proof, { dropped: new Set(['gone']), atApproval, wave: 1 })
  const of = (slug: string) => rows.find(r => r.slug === slug)!

  it('imports only approvals whose done test is as approved', () => {
    expect(rows.filter(r => r.status === 'ready').map(r => r.slug)).toEqual(['ok', 'later'])
    expect(of('later').pitchEdits).toEqual(['what']) // a pitch can still be re-pitched; named, not blocking
    expect(of('moved')).toMatchObject({ status: 'not_ready', reason: 'done_when changed after the approval: approve again' })
    expect(of('rechecked')).toMatchObject({ status: 'not_ready', reason: 'checked_by changed after the approval: approve again' })
    expect(of('renamed')).toMatchObject({ status: 'not_ready', reason: 'approved before this version was in the list: approve again' })
  })

  it('a question, a change or no verdict is not ready; a drop or a no never goes', () => {
    expect(of('asked')).toMatchObject({ status: 'not_ready', verdict: 'question' })
    expect(of('fix')).toMatchObject({ status: 'not_ready', verdict: 'change' })
    expect(of('silent')).toMatchObject({ status: 'not_ready', reason: 'no verdict yet' })
    expect(of('gone')).toMatchObject({ status: 'dropped' }) // approved, then dropped: the drop list wins
    expect(of('nope')).toMatchObject({ status: 'dropped', reason: 'Myra said no' })
  })

  it('keeps to the wave asked for, or every wave', () => {
    expect(rows.find(r => r.slug === 'two')).toBeUndefined()
    expect(readiness(list, proof, { dropped: new Set(), atApproval, wave: null }).find(r => r.slug === 'two')?.status).toBe('ready')
  })

  it('without history an approval is ready but says it was not checked', () => {
    const r = readiness([entry('ok')], proof, { dropped: new Set() })
    expect(r[0]).toMatchObject({ status: 'ready', reason: 'approved (not checked against the history)' })
  })

  it('prints three lists', () => {
    const out = formatReadiness(rows)
    expect(out).toMatch(/^ready to import: 2\n {2}ok \(wave 1\)\n {2}later \(wave 1\) · pitch edited since: what\nnot ready: 6\n/)
    expect(out).toContain('dropped: 2')
  })
})

describe('seed-launch --approved', () => {
  it('takes --approved and --wave, never adds the example, and lets production go without --slugs', () => {
    const a = parseArgs(['--', '--target', 'production', '--allow-production', '--approved', '--dry-run'])
    expect(a).toMatchObject({ approved: true, wave: 1, slugs: null })
    checkArgs(a, false)
    expect(a.example).toBe(false)
    expect(parseArgs(['--approved', '--offline', '--wave', 'all']).wave).toBeNull()
    expect(parseArgs(['--approved', '--offline', '--wave', '2']).wave).toBe(2)
    expect(() => parseArgs(['--wave', 'two'])).toThrow(Refused)
    const off = parseArgs(['--approved', '--offline'])
    checkArgs(off, false)
    expect(off.example).toBe(false)
  })

  it('still refuses production without a terminal, and never replaces', () => {
    expect(() => checkArgs(parseArgs(['--target', 'production', '--allow-production', '--approved']), false)).toThrow(/only from a terminal/)
    expect(() => checkArgs(parseArgs(['--target', 'production', '--approved']), true)).toThrow(/--allow-production/)
    expect(() => checkArgs(parseArgs(['--target', 'staging', '--approved', '--replace']), true)).toThrow(/never replaces/)
  })

  it('on the real files: every ready shwarm is approved, wave 1, and not dropped', () => {
    const a = parseArgs(['--approved', '--offline'])
    const rows = approvedFrom(LIST, a)
    const drops = parseDrops(readFileSync(new URL('../../../docs/launch-drops.md', import.meta.url), 'utf8'))
    expect(rows.length).toBe(LIST.filter(e => e.wave === 1).length)
    for (const r of rows.filter(r => r.status === 'ready')) {
      expect(r.wave).toBe(1)
      expect(latestVerdict(PROOF[r.slug])?.choice).toBe('approve')
      expect(drops.has(r.slug)).toBe(false)
    }
    for (const s of drops) expect(rows.find(r => r.slug === s)?.status ?? 'dropped').toBe('dropped')
  })
})
