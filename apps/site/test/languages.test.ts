// Which language a page is in (decided Oct 13, words/index.ts): the footer switch's cookie, else the browser's
// Accept-Language, among the languages the environment serves (LANGUAGES); English for agents, mail, jobs, and
// wherever only English is served.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { renderMail } from '../src/email/templates'
import { currentLang, inLanguage, languages, pickLanguage, servedLanguages, w } from '../src/words'
import { en } from '../src/words/en'
import { T0, testDb } from './d1'
import { body, testEnv } from './browser'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())

const SERVED = ['fr', 'de', 'zh-Hans']

describe('picking a language', () => {
  it('takes the cookie first, when it names a served language or English', () => {
    expect(pickLanguage('de', 'fr-FR,fr;q=0.9', SERVED)).toBe('de')
    expect(pickLanguage('en', 'fr-FR', SERVED)).toBe('en')
    expect(pickLanguage('ja', 'fr-FR', SERVED)).toBe('fr') // not served: the browser decides
  })

  it('then the browser’s list by q-value, exact or by base, English first if it comes first', () => {
    expect(pickLanguage(undefined, 'fr-CA,fr;q=0.9,en;q=0.8', SERVED)).toBe('fr')
    expect(pickLanguage(undefined, 'de-AT', SERVED)).toBe('de')
    expect(pickLanguage(undefined, 'zh-CN,zh;q=0.9', SERVED)).toBe('zh-Hans')
    expect(pickLanguage(undefined, 'zh-Hans', SERVED)).toBe('zh-Hans')
    expect(pickLanguage(undefined, 'en-US,en;q=0.9,de;q=0.8', SERVED)).toBe('en')
    expect(pickLanguage(undefined, 'ja;q=0.9,de;q=0.4,en;q=0.5', SERVED)).toBe('en')
    expect(pickLanguage(undefined, 'ja,ko', SERVED)).toBe('en')
    expect(pickLanguage(undefined, '*', SERVED)).toBe('en')
    expect(pickLanguage(undefined, 'de;q=0,fr;q=0.2', SERVED)).toBe('fr')
    expect(pickLanguage(undefined, undefined, SERVED)).toBe('en')
  })

  it('is always English where only English is served', () => {
    expect(pickLanguage('fr', 'fr', [])).toBe('en')
    expect(servedLanguages({})).toEqual([])
    expect(servedLanguages({ LANGUAGES: ' de , xx,zh-Hans' })).toEqual(['de', 'zh-Hans'])
  })
})

describe('the words of the current language', () => {
  it('reads the request’s language inside inLanguage, English outside and for unknown codes', () => {
    expect(currentLang()).toBe('en')
    expect(w.chrome).toBe(en.chrome)
    inLanguage('fr', () => {
      expect(currentLang()).toBe('fr')
      // a line the language lacks reads in English, so every key is there
      expect(Object.keys(w)).toEqual(Object.keys(en))
      expect(typeof w.chrome.languageSwitch).toBe('string')
    })
    inLanguage('xx', () => expect(currentLang()).toBe('en'))
  })

  it('writes mail in English even during a request in another language', () => {
    const fr = inLanguage('fr', () => renderMail('account_closed', {}, { siteUrl: 'https://shwarm.org', stream: 'account' } as any))
    const plain = renderMail('account_closed', {}, { siteUrl: 'https://shwarm.org', stream: 'account' } as any)
    expect(fr).toEqual(plain)
  })

  it('names every language in its own words', () => {
    for (const l of languages) expect(l.native, l.code).toBeTruthy()
  })
})

describe('pages in the reader’s language', () => {
  const env = () => ({ ...testEnv(testDb()), SITE_MODE: 'open', LANGUAGES: 'fr,de,zh-Hans' })
  const get = (e: object, path: string, headers: Record<string, string> = {}) => app.fetch(new Request('https://shwarm.org' + path, { headers }), e)

  it('serves the browser’s language, says so, and offers the switch in the footer', async () => {
    const e = env()
    const r = await get(e, '/rules', { 'accept-language': 'de-DE,de;q=0.9' })
    const html = await body(r)
    expect(html).toContain('<html lang="de" dir="ltr"')
    expect(r.headers.get('content-language')).toBe('de')
    expect(r.headers.get('vary')).toMatch(/Accept-Language/)
    expect(r.headers.get('vary')).toMatch(/Cookie/)
    expect(html).toContain('<script src="/js/words.js?l=de" defer="">')
    expect(html).toMatch(/<nav class="langs" aria-label="[^"]+"><a href="\/language\/en\?to=%2Frules" lang="en" hreflang="en">english<\/a> · <a href="\/language\/fr\?to=%2Frules"[^>]*>français<\/a> · <span lang="de" aria-current="true">deutsch<\/span> · <a href="\/language\/zh-Hans\?to=%2Frules"[^>]*>简体中文<\/a><\/nav>/)
  })

  it('remembers a pick in a cookie and goes back to the page, on this site only', async () => {
    const e = env()
    const r = await get(e, '/language/zh-Hans?to=%2Frules%3Fx%3D1')
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/rules?x=1')
    expect(r.headers.get('set-cookie')).toMatch(/^lang=zh-Hans; Max-Age=31536000; Path=\/; HttpOnly; Secure; SameSite=Lax/)
    for (const to of ['https://evil.example/', '//evil.example/', '/\\evil.example', '']) expect((await get(e, `/language/fr?to=${encodeURIComponent(to)}`)).headers.get('location'), to).toBe('/')
    expect((await get(e, '/language/ja')).status).toBe(404)
    const page = await body(await get(e, '/rules', { cookie: 'lang=zh-Hans', 'accept-language': 'de' }))
    expect(page).toContain('<html lang="zh-Hans"')
  })

  it('keeps the browser scripts’ words in the language their address names', async () => {
    const e = env()
    const fr = await get(e, '/js/words.js?l=fr', { 'accept-language': 'de' })
    expect(fr.headers.get('cache-control')).toBe('public, max-age=300')
    const plain = await (await get(e, '/js/words.js', { 'accept-language': 'de' })).text()
    const english = await (await get(testEnv(testDb()), '/js/words.js')).text()
    expect(plain).toBe(english)
    expect(await fr.text()).not.toBe(english)
  })

  it('gives a node page a different ETag per language, and text stays English', async () => {
    const e = env()
    const etag = async (headers: Record<string, string>, q = '') => (await get(e, '/w/minecraft-in-doom' + q, { accept: 'text/html', ...headers })).headers.get('etag')
    const de = await etag({ 'accept-language': 'de' })
    const plain = await etag({})
    if (de || plain) expect(de).not.toBe(plain)
    const text = await get(e, '/w/minecraft-in-doom', { accept: 'text/plain', 'accept-language': 'de' })
    expect(text.headers.get('content-language')).toBeNull()
  })

  it('is English where the environment serves nothing else, with no switch', async () => {
    const e = { ...testEnv(testDb()), SITE_MODE: 'open' }
    const r = await get(e, '/rules', { 'accept-language': 'fr', cookie: 'lang=fr' })
    const html = await body(r)
    expect(html).toContain('<html lang="en" dir="ltr"')
    expect(html).not.toContain('class="langs"')
    expect(r.headers.get('content-language')).toBeNull()
    expect((await get(e, '/language/fr')).status).toBe(404)
  })
})
