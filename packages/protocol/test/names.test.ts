import { describe, expect, it } from 'vitest'
import { handleProblem, isPostAsPattern, isValidName, matchesPostAs, parseName, RESERVED_HANDLES } from '../src'

const seg = (n: number) => 'a'.repeat(n)

describe('names', () => {
  it.each([
    '@myra', '@my', '@a_b', '@' + seg(32), '@myra/m-04', '@myra/fathom-minecraft-in-doom/0a27',
    '@kestrel/swarm/r-03', '@myra/a.b_c-d', '@myra/' + seg(64), '@myra/1/2/3/4/5/6', '@myra/9lives',
  ])('accepts %s', n => expect(isValidName(n)).toBe(true))

  it.each([
    ['no @', 'myra'], ['empty', '@'], ['one-char handle', '@m'], ['33-char handle', '@' + seg(33)],
    ['uppercase', '@Myra'], ['dash in handle', '@my-ra'], ['dot in handle', '@my.ra'],
    ['trailing slash', '@myra/'], ['empty segment', '@myra//x'], ['segment starts with dot', '@myra/.x'],
    ['segment starts with dash', '@myra/-x'], ['segment starts with underscore', '@myra/_x'],
    ['65-char segment', '@myra/' + seg(65)], ['seven segments', '@myra/1/2/3/4/5/6/7'],
    ['double dot', '@myra/a..b'], ['space', '@myra/a b'], ['unicode', '@myrä'], ['uppercase segment', '@myra/M-04'],
    ['newline', '@myra\n'], ['leading space', ' @myra'],
  ])('refuses %s', (_why, n) => expect(isValidName(n)).toBe(false))

  it('parses handle and path', () => {
    expect(parseName('@myra')).toEqual({ handle: 'myra', path: [], bare: true })
    expect(parseName('@myra/swarm/r-03')).toEqual({ handle: 'myra', path: ['swarm', 'r-03'], bare: false })
    expect(parseName('@Myra')).toBeNull()
  })

  it('checks handles for sign-up', () => {
    expect(handleProblem('myra')).toBeNull()
    expect(handleProblem('m')).toBe('pattern')
    expect(handleProblem('Myra')).toBe('pattern')
    for (const h of ['support', 'admin', 'shwarm', 'anthropic', 'claude', 'log', 'dmca', 'security']) {
      expect(handleProblem(h)).toBe('reserved')
    }
  })

  it('keeps every reserved handle inside the handle pattern', () => {
    for (const h of RESERVED_HANDLES) expect(h, h).toMatch(/^[a-z0-9_]{1,32}$/)
  })

  it('matches can-post-as patterns, never the bare handle', () => {
    expect(matchesPostAs('@myra/*', '@myra/m-04')).toBe(true)
    expect(matchesPostAs('@myra/*', '@myra/swarm/r-03')).toBe(true)
    expect(matchesPostAs('@myra/*', '@myra')).toBe(false)
    expect(matchesPostAs('@myra/*', '@myrax/m-04')).toBe(false)
    expect(matchesPostAs('@myra/*', '@kestrel/m-04')).toBe(false)
    expect(matchesPostAs('@myra/swarm/*', '@myra/m-04')).toBe(false)
    expect(matchesPostAs('@myra/m-04', '@myra/m-04')).toBe(true)
    expect(matchesPostAs('@myra/m-04', '@myra/m-05')).toBe(false)
    expect(matchesPostAs('@myra', '@myra')).toBe(false)
    expect(matchesPostAs('@myra/*', '@myra/../x')).toBe(false)
  })

  it('matches a pattern cut short with * (spec: @myra/fathom-*)', () => {
    expect(matchesPostAs('@myra/fathom-*', '@myra/fathom-lead')).toBe(true)
    expect(matchesPostAs('@myra/fathom-*', '@myra/fathom-lead/0a27')).toBe(true)
    expect(matchesPostAs('@myra/fathom-*', '@myra/fathom')).toBe(false)
    expect(matchesPostAs('@myra/fathom-*', '@myra/fathom-')).toBe(false) // nothing after the cut: not covered
    expect(matchesPostAs('@myra/fathom-*', '@myra/m-04')).toBe(false)
    expect(matchesPostAs('@myra/m-0*', '@myra/m-04')).toBe(true)
    expect(matchesPostAs('@myra*', '@myrax/m-04')).toBe(false)
    expect(matchesPostAs('@myra*', '@myra/m-04')).toBe(false)
    expect(matchesPostAs('@myra/*/x', '@myra/a/x')).toBe(false)
  })

  it.each(['@myra/*', '@myra/m-04', '@myra/fathom-*', '@myra/swarm/*', '@myra/a.b_c-*', '@myra/1/2/3/4/5/*'])('takes the can-post-as pattern %s', p =>
    expect(isPostAsPattern(p)).toBe(true),
  )

  it.each([
    ['bare', '@myra'], ['bare with *', '@myra*'], ['star alone', '*'], ['two stars', '@myra/**'], ['star inside', '@myra/*/x'],
    ['empty segment', '@myra//*'], ['segment starts with dot', '@myra/.*'], ['uppercase', '@Myra/*'], ['seven segments', '@myra/1/2/3/4/5/6/*'],
    ['trailing slash', '@myra/m-04/'], ['no handle', '@/*'], ['space', '@myra/a *'],
  ])('refuses the can-post-as pattern %s', (_why, p) => expect(isPostAsPattern(p)).toBe(false))
})
