// The site's words (go-live 11.8). Every word people see on the site lives in words/en/, one file per page area;
// pages read them as w.<area>.<entry>. English is the source. Other languages are translations of it, kept by the
// localize tool (localize/ at the repo root) in translations/<code>.json, one line per English entry; any line a
// language doesn't have yet falls back to English (wordsFor).
//
// Which language a request gets (decided Oct 13): the `lang` cookie the footer's switch sets, else the first language
// the browser asks for (Accept-Language) that this environment serves, else English. LANGUAGES in wrangler.jsonc lists
// what each environment serves: drafts stay on staging until someone who reads the language checks them. `w` reads the
// current request's words (inLanguage, set in index.ts); outside a request (jobs, tests) and for mail, it's English.
import { AsyncLocalStorage } from 'node:async_hooks'
import { en } from './en'
import { setRules } from './fill'
import LANGUAGES from './languages.json'
import { translations } from './translations'

export type Words = typeof en

/** A language the site has words for. `source`: English, which every other language translates. `native`: its own
 * name for itself, shown in the footer's switch. */
export type Language = { code: string; name: string; native?: string; dir: 'ltr' | 'rtl'; source?: boolean }
export const languages = LANGUAGES as Language[]

type Current = { lang: string; words: Words; dir: 'ltr' | 'rtl'; path: string; served: string[] }
const current = new AsyncLocalStorage<Current>()
const built = new Map<string, Words>()

/** Runs `fn` with `code`'s words as `w` (English for a code the site has no words for). `path`: the page's own path
 * and query, for the language switch to come back to; `served`: the languages the switch offers besides English. */
export function inLanguage<T>(code: string, fn: () => T, { path = '/', served = [] as string[] } = {}): T {
  const lang = languages.find(l => l.code === code) ? code : 'en'
  let words = built.get(lang)
  if (!words) built.set(lang, (words = wordsFor(lang)))
  return current.run({ lang, words, dir: languages.find(l => l.code === lang)?.dir ?? 'ltr', path, served }, fn)
}

/** The current request's language code ('en', 'fr', 'zh-Hans'), its writing direction and the page's path. */
export const currentLang = () => current.getStore()?.lang ?? 'en'
export const currentDir = () => current.getStore()?.dir ?? 'ltr'
export const currentPath = () => current.getStore()?.path ?? '/'
export const currentServed = () => current.getStore()?.served ?? []

/** The words people see: the current request's language, English outside a request. */
export const w: Words = new Proxy({} as Words, {
  get: (_, k) => (current.getStore()?.words ?? en)[k as keyof Words],
  has: (_, k) => k in en,
  ownKeys: () => Reflect.ownKeys(current.getStore()?.words ?? en),
  getOwnPropertyDescriptor: (_, k) => {
    const d = Object.getOwnPropertyDescriptor(current.getStore()?.words ?? en, k)
    return d && { ...d, configurable: true }
  },
})

/** The languages an environment serves besides English, from its LANGUAGES variable ("fr,de,zh-Hans"). */
export function servedLanguages(env: { LANGUAGES?: string } | undefined): string[] {
  const want = (env?.LANGUAGES ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return languages.filter(l => !l.source && want.includes(l.code)).map(l => l.code)
}

/**
 * The language for a request: the cookie's when it names one served here ('en' included), else the browser's first
 * served language by q-value, matched exactly or by its base ('zh-CN' → 'zh-Hans', 'de-AT' → 'de'), else English.
 * English met first in the browser's list wins over a later served language.
 */
export function pickLanguage(cookie: string | undefined, acceptLanguage: string | undefined, served: string[]): string {
  if (!served.length) return 'en'
  const lower = (s: string) => s.toLowerCase()
  if (cookie && (cookie === 'en' || served.includes(cookie))) return cookie
  const tags = (acceptLanguage ?? '')
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';')
      const q = Number(params.find(p => p.trim().startsWith('q='))?.trim().slice(2) ?? 1)
      return { tag: lower(tag.trim()), q: Number.isFinite(q) ? q : 0, i }
    })
    .filter(t => t.tag && t.tag !== '*' && t.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
  for (const { tag } of tags) {
    const base = tag.split('-')[0]
    if (base === 'en') return 'en'
    const exact = served.find(c => lower(c) === tag)
    if (exact) return exact
    const same = served.find(c => lower(c).split('-')[0] === base)
    if (same) return same
  }
  return 'en'
}

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
