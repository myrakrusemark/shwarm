// The site's words (go-live 11.8). Every word people see on the site lives in words/en/, one file per page area;
// pages read them as w.<area>.<entry>. English is the source. Other languages are translations of it, kept by the
// localize tool (localize/ at the repo root) in translations/<code>.json, one line per English entry; any line a
// language doesn't have yet falls back to English (wordsFor). Which language a visitor gets is open #116: until
// then every page uses `w`, the English list.
import { en } from './en'
import { setRules } from './fill'
import LANGUAGES from './languages.json'
import { translations } from './translations'

export type Words = typeof en
export const w: Words = en

/** A language the site has words for. `source`: English, which every other language translates. */
export type Language = { code: string; name: string; dir: 'ltr' | 'rtl'; source?: boolean }
export const languages = LANGUAGES as Language[]

/**
 * One language's translations, by the English entry's path ("chrome.tagline", "feed.posts.other"). `from` is the
 * English text it was translated from: when the English changes, the translation is out of date until someone looks
 * again. `checked`: someone who reads the language checked it (a draft otherwise). A plural entry has one line per
 * form the language uses ("feed.posts.few" in Russian, only ".other" in Japanese).
 */
export type Translation = Record<string, { text: string; from: string; checked?: boolean }>

/** The words for a language: its translations over the English list, English wherever it has no line yet. */
export function wordsFor(code: string): Words {
  const t = translations[code]
  if (!t || code === 'en') return en
  const rules = new Intl.PluralRules(code)
  const over = (node: Record<string, unknown>, at: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) {
      const key = at ? `${at}.${k}` : k
      if (typeof v === 'string') out[k] = t[key]?.text || v
      else if (v && typeof v === 'object' && 'one' in v && 'other' in v) {
        // a plural: the language's own forms where it has them, English's "other" for any it lacks
        const forms: Record<string, string> = {}
        for (const cat of rules.resolvedOptions().pluralCategories) forms[cat] = t[`${key}.${cat}`]?.text || (v as Record<string, string>)[cat] || (v as Record<string, string>).other
        out[k] = setRules(forms, rules)
      } else out[k] = over(v as Record<string, unknown>, key)
    }
    return out
  }
  return over(en as unknown as Record<string, unknown>, '') as unknown as Words
}

/** A short fingerprint of the whole word list and its translations. It's in every signed-out ETag
 * (web/node-routes.tsx etagOf), so an edited word reaches browsers and caches without a RENDER_VERSION bump. FNV-1a. */
export const WORDS_VERSION = (() => {
  let h = 0x811c9dc5
  const all = Object.keys(translations).length ? JSON.stringify([en, translations]) : JSON.stringify(en)
  for (const ch of all) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return h.toString(36)
})()
export { count, fill, fillx, type Plural } from './fill'
