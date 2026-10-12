// Go-live 11.7: robots.txt, the sitemap from the database, link previews (og: and twitter: meta tags) and canonical links.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { ROBOTS_DISALLOW, sitemapNodes } from '../src/web/crawl'
import { PAGES } from '../src/web/doc'
import { pickFormat, previewFetcher } from '../src/web/format'
import { READ_BURST, resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { T0 } from './d1'
import { body, Browser, fakeFetch, ORIGIN, testEnv } from './browser'
import { PLAIN, stagingWorld } from './node-fixture'
import { closedWorld } from './result-fixture'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 + 3_600_000)
  resetReadLimit()
  forgetVersions()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const HTML = { accept: 'text/html' }

/** The <loc> addresses in a sitemap. */
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1])

/** A meta tag's content, or a link's href, from a page's head. */
const meta = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1]
const canonical = (html: string) => /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1]

describe('robots.txt', () => {
  it('disallows everything outside production, staging too, before its lock', async () => {
    for (const env of [testEnv(), { ...testEnv(), ENV: 'staging', STAGING_PASSWORD: 'pw' }, { ...testEnv(), ENV: 'staging' }]) {
      const res = await new Browser(env).req('/robots.txt')
      expect(res.status, env.ENV).toBe(200)
      expect(await body(res)).toBe('User-agent: *\nDisallow: /\n')
    }
  })

  it('on production keeps crawlers off accounts, keys, messages, admin and the forms, and names the sitemap', async () => {
    const env = { ...testEnv(), ENV: 'production', SITE_MODE: 'beta', SITE_URL: 'https://shwarm.org' }
    const res = await new Browser(env).req('/robots.txt')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
    const txt = await body(res)
    const lines = txt.split('\n')
    expect(lines[0]).toBe('User-agent: *')
    expect(lines).toContain('Allow: /w/')
    for (const p of ['/admin', '/keys', '/dms', '/step-up', '/join', '/signin', '/forgot', '/reset', '/verify', '/check-email', '/email-change', '/new'])
      expect(lines, p).toContain(`Disallow: ${p}`)
    expect(lines).toContain('Sitemap: https://shwarm.org/sitemap.xml')
    // Nothing public is kept out: shwarm pages, profiles, the feed, the footer pages, the moderation log.
    for (const open of ['/w/minecraft-in-doom', '/@myra', '/', '/rules', '/moderation', '/terms', '/shwarms'])
      expect(ROBOTS_DISALLOW.some(d => open.startsWith(d)), open).toBe(false)
  })

  it('every disallowed path is one the site answers', async () => {
    const env = { ...testEnv(), ENV: 'production', SITE_MODE: 'beta' }
    const b = new Browser(env)
    for (const p of ROBOTS_DISALLOW) {
      if (p === '/hooks/' || p === '/terms/accept' || p === '/signout' || p === '/donate') continue // POST only, or no Stripe key here
      const res = await b.req(p, { headers: HTML })
      // /admin is a 404 to everyone but an admin, on purpose; the rest answer (a page, or a redirect to sign in).
      if (p === '/admin') expect(res.status).toBe(404)
      else expect(res.status, p).not.toBe(404)
    }
  })
})

describe('sitemap.xml', () => {
  it('lists home, the footer pages and every public shwarm and branch', async () => {
    const w = await stagingWorld()
    const res = await new Browser(testEnv(w.db)).req('/sitemap.xml')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=900')
    const xml = await body(res)
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true)
    const o = ORIGIN
    const got = locs(xml)
    expect(got).toEqual(expect.arrayContaining([`${o}/`, ...PAGES.map(p => `${o}/${p.slug}`), `${o}/triage`, `${o}/w/${EXAMPLE_ROOT}`, `${o}/w/${EXAMPLE_BRANCH}`, `${o}/w/${PLAIN}`]))
    expect(new Set(got).size).toBe(got.length)
    expect(xml).toMatch(new RegExp(`<loc>${o}/w/${PLAIN}</loc><lastmod>\\d{4}-\\d\\d-\\d\\dT[^<]+</lastmod>`))
  })

  it('leaves out what the public can’t read: taken down, held, blocked, and anything under them', async () => {
    const w = await stagingWorld()
    const b = new Browser(testEnv(w.db))
    const set = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).run(...args)
    set("UPDATE node SET triage = 'held' WHERE path = ?", EXAMPLE_BRANCH)
    let got = locs(await body(await b.req('/sitemap.xml')))
    expect(got.some(l => l.endsWith(`/w/${EXAMPLE_BRANCH}`))).toBe(false)
    expect(got.some(l => l.endsWith(`/w/${EXAMPLE_ROOT}`))).toBe(true)

    set("UPDATE node SET triage = 'clear' WHERE path = ?", EXAMPLE_BRANCH)
    set('UPDATE node SET hidden = 1 WHERE path = ?', EXAMPLE_ROOT) // the branch goes down with its shwarm
    set("UPDATE node SET triage = 'blocked' WHERE path = ?", PLAIN)
    got = locs(await body(await b.req('/sitemap.xml')))
    expect(got.filter(l => l.includes('/w/'))).toEqual([])
  })

  it('caps the count, newest change first', async () => {
    const w = await stagingWorld()
    w.db.raw.prepare('UPDATE node SET changed_at = ? WHERE path = ?').run(new Date(T0 + 60_000).toISOString(), PLAIN)
    expect((await sitemapNodes(w.db, 1)).map(n => n.path)).toEqual([PLAIN])
    expect((await sitemapNodes(w.db)).length).toBe(3)
  })

  it('lists no shwarm where the reading pages are closed, and uses the site’s own address', async () => {
    const w = await stagingWorld()
    const env = { ...testEnv(w.db), ENV: 'production', SITE_MODE: 'holding', SITE_URL: 'https://shwarm.org' }
    const got = locs(await body(await new Browser(env).req('/sitemap.xml')))
    expect(got).toEqual(['https://shwarm.org/', ...PAGES.map(p => `https://shwarm.org/${p.slug}`), 'https://shwarm.org/triage'])
  })

  it('counts against the public read limit', async () => {
    const w = await stagingWorld()
    const b = new Browser(testEnv(w.db))
    for (let i = 0; i < READ_BURST; i++) expect((await b.req('/sitemap.xml')).status).toBe(200)
    expect((await b.req('/sitemap.xml')).status).toBe(429)
  })
})

describe('link previews and canonical links', () => {
  it('a shwarm page: its title, its done line, its canonical address, no image of its own', async () => {
    const w = await stagingWorld()
    const env = { ...testEnv(w.db), SITE_URL: 'https://shwarm.example' }
    const html = await body(await new Browser(env).req(`/w/${PLAIN}?sort=new&page=1`, { headers: HTML }))
    const n = w.db.raw.prepare('SELECT title, done_when FROM node WHERE path = ?').get(PLAIN) as { title: string; done_when: string }
    expect(canonical(html)).toBe(`https://shwarm.example/w/${PLAIN}`)
    expect(meta(html, 'og:url')).toBe(`https://shwarm.example/w/${PLAIN}`)
    expect(meta(html, 'og:title')).toBe(n.title)
    expect(meta(html, 'og:description')).toMatch(/^done when: /)
    expect(meta(html, 'og:description')!.length).toBeLessThanOrEqual(260)
    expect(meta(html, 'og:site_name')).toBe('shwarm')
    expect(meta(html, 'og:type')).toBe('website')
    expect(meta(html, 'twitter:card')).toBe('summary')
    expect(html.match(/og:image/g)?.length).toBe(1) // the site's mark only
  })

  it('a branch page and a closed shwarm’s result page and thread', async () => {
    const w = await closedWorld()
    const b = new Browser(testEnv(w.db))
    const branch = await body(await b.req(`/w/${EXAMPLE_BRANCH}`, { headers: HTML }))
    expect(canonical(branch)).toBe(`https://shwarm.org/w/${EXAMPLE_BRANCH}`)
    expect(meta(branch, 'og:description')).toMatch(/^done when: /)
    const result = await body(await b.req(`/w/${EXAMPLE_ROOT}`, { headers: HTML }))
    expect(result).toContain('class="passed"') // it is the result page
    expect(canonical(result)).toBe(`https://shwarm.org/w/${EXAMPLE_ROOT}`)
    expect(meta(result, 'og:title')).toBe('minecraft in doom')
    const thread = await body(await b.req(`/w/${EXAMPLE_ROOT}?thread=1`, { headers: HTML }))
    expect(canonical(thread)).toBe(`https://shwarm.org/w/${EXAMPLE_ROOT}?thread=1`)
  })

  it('escapes what the author wrote', async () => {
    const w = await stagingWorld()
    w.db.raw.prepare('UPDATE node SET title = ?, done_when = ? WHERE path = ?').run('a "quoted" <b>title</b>', 'it says "done" & <i>means it</i>', PLAIN)
    const html = await (await new Browser(testEnv(w.db)).req(`/w/${PLAIN}`, { headers: HTML })).text() // as sent, not unescaped
    expect(meta(html, 'og:title')).toBe('a &quot;quoted&quot; &lt;b&gt;title&lt;/b&gt;')
    expect(meta(html, 'og:description')).toBe('done when: it says &quot;done&quot; &amp; &lt;i&gt;means it&lt;/i&gt;')
    expect(html).not.toContain('<b>title</b>')
  })

  // What each service sent, or would send (Oct 12): Cardyb sent no Accept at all to production; the rest */*.
  const FETCHERS: [string, Record<string, string>][] = [
    ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', { accept: '*/*' }],
    ['Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', { accept: '*/*' }],
    ['http.rb/5.1.1 (Mastodon/4.3.0; +https://mastodon.social/) Bot', { accept: 'text/html' }],
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app) Chrome/W.X.Y.Z Safari/537.36', {}],
    ['Twitterbot/1.0', { accept: '*/*' }],
    ['facebookexternalhit/1.1', {}],
  ]

  it('a link-preview fetcher gets the page with its card, not the text prompt, at the bare address', async () => {
    const w = await stagingWorld()
    const b = new Browser(testEnv(w.db))
    for (const [ua, headers] of FETCHERS) {
      const res = await b.req(`/w/${PLAIN}`, { headers: { ...headers, 'user-agent': ua } })
      expect(res.headers.get('content-type'), ua).toMatch(/^text\/html/)
      expect(res.headers.get('vary'), ua).toContain('User-Agent')
      const html = await body(res)
      expect(meta(html, 'og:description'), ua).toMatch(/^done when: /)
      expect(canonical(html), ua).toBe(`https://shwarm.org/w/${PLAIN}`)
    }
    // The home page and a footer page, which also answer */* with text.
    const slack = { accept: '*/*', 'user-agent': FETCHERS[0][0] }
    expect((await b.req('/', { headers: slack })).headers.get('content-type')).toMatch(/^text\/html/)
    expect(canonical(await body(await b.req('/rules', { headers: slack })))).toBe('https://shwarm.org/rules')
  })

  it('an agent still gets the text prompt, and a fetcher gets text or JSON when it asks by name', async () => {
    const w = await stagingWorld()
    const b = new Browser(testEnv(w.db))
    const curl = await b.req(`/w/${PLAIN}`, { headers: { accept: '*/*', 'user-agent': 'curl/8.9.1' } })
    expect(curl.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    const ua = FETCHERS[0][0]
    expect((await b.req(`/w/${PLAIN}`, { headers: { accept: 'text/plain', 'user-agent': ua } })).headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect((await b.req(`/w/${PLAIN}?format=json`, { headers: { 'user-agent': ua } })).headers.get('content-type')).toMatch(/^application\/json/)
    expect(pickFormat(undefined, '*/*', ua)).toBe('html')
    expect(pickFormat(undefined, 'text/*', ua)).toBe('html')
    expect(pickFormat(undefined, 'text/plain;q=0.5, */*', ua)).toBe('html') // the wildcard ranks first: nothing named
    expect(pickFormat(undefined, '*/*;q=0.5, application/json', ua)).toBe('json')
    expect(pickFormat(undefined, '*/*', 'python-requests/2.32')).toBe('text')
    expect(previewFetcher('Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0')).toBe(false)
    expect(previewFetcher(undefined)).toBe(false)
  })

  it('footer pages have a canonical link; other pages don’t', async () => {
    const b = new Browser(testEnv())
    const rules = await body(await b.req('/rules', { headers: HTML }))
    expect(canonical(rules)).toBe('https://shwarm.org/rules')
    expect(meta(rules, 'og:url')).toBe('https://shwarm.org/rules')
    const signin = await body(await b.req('/signin', { headers: HTML }))
    expect(canonical(signin)).toBeUndefined()
    expect(meta(signin, 'twitter:card')).toBe('summary')
  })
})
