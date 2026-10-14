// The reading pages in other languages (decided Oct 14, web/doc.tsx pageIn): each part is a doc.<slug>.<part> line in
// translations/<code>.json, kept by the localize tool. A translation must keep the links, code and tags of the English
// it was made from, so no language loses a link or a command; terms and privacy say the English is the one that counts.
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { PAGES, pageIn } from '../src/web/doc'
import { inLanguage, w } from '../src/words'
import { translations } from '../src/words/translations'
import { testDb } from './d1'
import { body, testEnv } from './browser'

const bag = (s: string, re: RegExp) => [...s.matchAll(re)].map(m => m.slice(1).join('\u0000')).sort()
const kept = (s: string) => ({ links: bag(s, /href="([^"]*)"/g), code: bag(s, /<(code|pre)[^>]*>([\s\S]*?)<\/\1>/g), tags: bag(s, /<(\/?[a-z0-9]+)/g) })
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

describe('reading pages in other languages', () => {
  const env = () => ({ ...testEnv(testDb()), SITE_MODE: 'open', LANGUAGES: 'fr,de,zh-Hans' })
  const get = (path: string, lang: string) => app.fetch(new Request('https://shwarm.org' + path, { headers: { cookie: `lang=${lang}` } }), env())

  it('has lines only for parts of pages that exist', () => {
    const parts = new Set(PAGES.flatMap(p => [`doc.${p.slug}.title`, `doc.${p.slug}.lede`, ...(p.introText ?? []).map((_, i) => `doc.${p.slug}.intro.${i}`), ...p.sections.flatMap(s => [`doc.${p.slug}.${s.id}.h`, `doc.${p.slug}.${s.id}.body`])]))
    for (const [code, t] of Object.entries(translations)) for (const key of Object.keys(t)) if (key.startsWith('doc.')) expect(parts.has(key), `${code} ${key}: no such page part (renamed or removed?)`).toBe(true)
  })

  it('keeps every link, bit of code and tag of the English it was translated from', () => {
    for (const [code, t] of Object.entries(translations))
      for (const [key, line] of Object.entries(t)) if (key.startsWith('doc.') && line.text) expect(kept(line.text), `${code} ${key}`).toEqual(kept(line.from))
  })

  it('fills in every bit of a figure’s text, translated or not', () => {
    for (const p of PAGES) for (const code of ['en', ...Object.keys(translations)]) expect(pageIn(p, code).intro ?? '', `${code} ${p.slug}`).not.toMatch(/\{\{t\d+\}\}/)
  })

  it('serves a page in the reader’s language, with English for any part it lacks', async () => {
    const about = PAGES.find(p => p.slug === 'about')!
    for (const code of ['fr', 'de', 'zh-Hans']) {
      const html = await body(await get('/about', code))
      const t = translations[code]
      expect(html, code).toContain(`<h1>${esc(t['doc.about.title']?.text || about.title)}</h1>`)
      expect(html, code).toContain(`<h2>${esc(inLanguage(code, () => w.chrome.onThisPage))}</h2>`)
      for (const s of about.sections) expect(html, `${code} #${s.id}`).toContain(t[`doc.about.${s.id}.h`]?.text || s.h)
    }
    expect(await body(await get('/about', 'en'))).toContain(`<h1>${esc(about.title)}</h1>`)
  })

  it('says on the terms and the privacy page that the English counts, in every language but English', async () => {
    for (const path of ['/terms', '/privacy']) {
      const note = (code: string) => `<p class="note">${esc(inLanguage(code, () => w.chrome.translationNote))}</p>`
      expect(await body(await get(path, 'de')), path).toContain(note('de'))
      expect(await body(await get(path, 'en')), path).not.toContain('class="note">' + esc(w.chrome.translationNote))
    }
    expect(await body(await get('/about', 'de'))).not.toContain(esc(inLanguage('de', () => w.chrome.translationNote)))
  })
})
