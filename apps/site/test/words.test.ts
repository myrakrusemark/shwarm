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
// The agent resources card labels its pages with chrome words named in content/agent-resources.json.
const CARD_WORDS = new Set(RESOURCES.map(r => `chrome.${r.word}`))
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
        return !SRC.includes(`w.${area}.${rest.join('.')}`) && !CARD_WORDS.has(`${area}.${rest.join('.')}`)
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

// Translations (the localize tool, localize/): every line is for an English entry that exists, keeps its {slots},
// and a plural's forms are ones the language uses.
import { languages, wordsFor } from '../src/words'
import { translations } from '../src/words/translations'
import { setRules } from '../src/words/fill'
import { RESOURCES } from '../src/content/resources'

describe('translations', () => {
  const english = new Map(leaves(w as unknown as Tree).flatMap(([path, v]) =>
    typeof v === 'string' ? [[path.join('.'), v] as const] : Object.entries(v as Record<string, string>).map(([form, text]) => [`${path.join('.')}.${form}`, text] as const)))
  const plurals = new Set(leaves(w as unknown as Tree).filter(([, v]) => typeof v !== 'string').map(([p]) => p.join('.')))
  const slots = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort()

  it('has a file for every language listed, and a language listed for every file', () => {
    expect(Object.keys(translations).sort()).toEqual(languages.filter(l => !l.source).map(l => l.code).sort())
    expect(languages.filter(l => l.source).map(l => l.code)).toEqual(['en'])
  })

  for (const [code, t] of Object.entries(translations)) {
    it(`${code}: every line is for an English entry, with the same {slots}`, () => {
      const forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories as string[]
      for (const [key, { text }] of Object.entries(t)) {
        const base = key.slice(0, key.lastIndexOf('.'))
        if (plurals.has(base)) {
          expect(forms, `${key}: ${code} has no "${key.slice(base.length + 1)}" form`).toContain(key.slice(base.length + 1))
          // as the localize tool checks it: against English's own form when English has it ("one"), else "other"
          expect(slots(text), key).toEqual(slots(english.get(key) ?? english.get(`${base}.other`)!))
        } else {
          expect(english.has(key), `${key}: no such English entry (renamed or removed?)`).toBe(true)
          expect(slots(text), key).toEqual(slots(english.get(key)!))
        }
      }
    })
  }

  it("picks a translated plural's form by that language's rules", () => {
    const ru = setRules({ one: '{n} пост', few: '{n} поста', many: '{n} постов', other: '{n} поста' } as any, new Intl.PluralRules('ru'))
    expect([1, 3, 5, 21].map(n => count(ru, n))).toEqual(['1 пост', '3 поста', '5 постов', '21 пост'])
    const ja = setRules({ other: '{n}件' } as any, new Intl.PluralRules('ja'))
    expect(count(ja, 1)).toBe('1件')
  })

  it('falls back to English for a line a language lacks', () => {
    expect(wordsFor('xx').chrome.tagline).toBe(w.chrome.tagline)
  })
})
