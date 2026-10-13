// The word list (go-live 11.8): every entry is text someone can edit, every entry is used somewhere, and every word a
// browser script asks for exists. A broken entry should fail here, not show up on the site.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { count, fill, fillx, w } from '../src/words'

type Tree = { [k: string]: string | Tree }
const leaves = (t: Tree, at: string[] = []): [string[], unknown][] =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === 'object' && v !== null && !('one' in v) ? leaves(v as Tree, [...at, k]) : [[[...at, k], v] as [string[], unknown]]))

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))
const SRC = walk('src').filter(f => /\.tsx?$/.test(f) && !f.startsWith('src/words/')).map(f => readFileSync(f, 'utf8')).join('\n')
const SCRIPTS = readdirSync('static/js').map(f => [f, readFileSync(`static/js/${f}`, 'utf8')] as const)

describe('the word list', () => {
  it('holds only text, or { one, other } for words that change with a number', () => {
    for (const [path, v] of leaves(w as unknown as Tree)) {
      const ok = typeof v === 'string' || (typeof v === 'object' && v !== null && typeof (v as any).one === 'string' && typeof (v as any).other === 'string')
      expect(ok, path.join('.')).toBe(true)
    }
  })

  it('has no entry that nothing uses', () => {
    const unused = leaves(w as unknown as Tree)
      .map(([path]) => path)
      .filter(([area, ...rest]) => {
        if (rest[0] === 'script') return !SCRIPTS.some(([, js]) => js.includes(`window.W.${area}`) && new RegExp(`(?<![.\\w])W\\.${rest[1]}\\b`).test(js))
        return !SRC.includes(`w.${area}.${rest.join('.')}`)
      })
    expect(unused.map(p => p.join('.'))).toEqual([])
  })

  it('has every word a browser script asks for', () => {
    for (const [file, js] of SCRIPTS) {
      const area = /const W = window\.W\.(\w+)/.exec(js)?.[1]
      if (!area) continue
      const block = (w as any)[area]?.script ?? {}
      for (const [, key] of js.matchAll(/(?<![.\w])W\.(\w+)/g)) expect(key in block, `${file}: W.${key} (w.${area}.script)`).toBe(true)
    }
  })
})

describe('filling an entry', () => {
  it('fills {name} slots, and leaves a slot with no value as it is', () => {
    expect(fill('made {date} · expires {expiry}', { date: 'oct 8', expiry: 'jan 6' })).toBe('made oct 8 · expires jan 6')
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}')
  })

  it('puts elements in order for page markup', () => {
    expect(fillx('see {link} now', { link: 'L' })).toEqual(['see ', 'L', ' now'])
    expect(fillx('{a}{b}', { a: 'x', b: 'y' })).toEqual(['x', 'y'])
  })

  it('picks one or other by the number', () => {
    const posts = { one: '{n} post', other: '{n} posts' }
    expect(count(posts, 1)).toBe('1 post')
    expect(count(posts, 0)).toBe('0 posts')
    expect(count(posts, 2, { n: '2' })).toBe('2 posts')
  })
})
