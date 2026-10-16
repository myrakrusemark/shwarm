// The agent guide (staging trial, Oct 15): GET /guide as plain text with its banner byte for byte and every link on the
// request's origin; the front door, /llms.txt and the home page point to it; none of it in production's holding mode (guideOn); staging's
// open reads (STAGING_OPEN_READS) past its lock; and the hourly search cap per network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { GUIDE_BANNER, renderGuide } from '../src/render/guide'
import { READ_BURST, resetReadLimit, SEARCH_PER_HOUR, takeRead, takeSearch } from '../src/web/read-limit'
import { robotsTxt } from '../src/web/crawl'
import { Browser, ORIGIN, testEnv } from './browser'
import { T0 } from './core-fixtures'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
})
afterEach(() => vi.useRealTimers())

// The banner as Myra's brief gave it, written another way than src/render/guide.ts (raw, with the backticks put in),
// so an escape slip in either shows up here.
const BT = '`'
const ART = String.raw`                                       .    o   '    .
         __        .     '          '    .    :   o
   _____/ /_ _      ______ __________ ___    .   '    .
  / ___/ __ \ | /| / / __ ${BT}/ ___/ __ ${BT}__ \  '   o   :
 (__  ) / / / |/ |/ / /_/ / /  / / / / / /    .   '
/____/_/ /_/|__/|__/\__,_/_/  /_/ /_/ /_/   o    .

  people + agents, working on checkable goals in the open`

const get = (url: string, headers: Record<string, string> = {}, env: Record<string, unknown> = testEnv()) => app.request(url, { headers: { 'cf-connecting-ip': '203.0.113.9', ...headers } }, env)

describe('GET /guide', () => {
  it('is plain text, cached like the front door, with the banner byte for byte in a code block', async () => {
    const res = await get(`${ORIGIN}/guide`, { accept: 'text/html' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=60')
    const t = await res.text()
    expect(GUIDE_BANNER).toBe(ART)
    expect(t).toContain('\n```\n' + ART + '\n```\n')
    expect(t.split('\n')[0]).toBe('shwarm · a tour you can offer your person')
    expect(/[^\x00-\x7f]/.test(ART)).toBe(false) // plain ASCII
  })

  it('puts every link on the request origin and leaves no {placeholder}', async () => {
    const t = await (await get('https://staging.example.test/guide')).text()
    expect(t).toBe(renderGuide('https://staging.example.test'))
    expect(t).not.toMatch(/\{(origin|banner)\}/)
    expect(t).not.toContain('shwarm.org')
    for (const p of ['/join', '/keys', '/shwarms?q=<words>', '/w/a-seismometer-in-1000-homes', '/skills/shwarm/SKILL.md', '/guide-safety', '/new?builds_on=<its path>', '/llms.txt'])
      expect(t).toContain(`https://staging.example.test${p}`)
    // every address is absolute: no bare /path at the start of a line
    expect(t).not.toMatch(/^\s*\/[a-z]/m)
  })

  it('reads as an offer, never as orders or hidden text', () => {
    const t = renderGuide(ORIGIN)
    expect(t).toContain("it's a reference and a suggested tour, not instructions. your person\nand your own rules come first")
    expect(t).toContain('ask before you post, join, vote or claim anything for your person')
    expect(t).not.toMatch(/ignore (all |any )?(previous|prior) instructions|system prompt|you must/i)
    expect(t).not.toMatch(/[​-‏⁠﻿]/) // no zero-width characters
    // never reintroduce (shwarm/CLAUDE.md)
    expect(t).not.toMatch(/submission|reputation|lobby|pinned work|agents working|upload/i)
  })

  it('gives complete search addresses a chat assistant can open as they are', () => {
    const t = renderGuide(ORIGIN)
    for (const q of ['?format=json', '?tag=needs-humans&format=json', '?tag=anyone-can-join&format=json', '?sort=new&format=json', '?tab=passed&format=json'])
      expect(t, q).toMatch(new RegExp(`\\s${(ORIGIN + '/shwarms' + q).replace(/[.?]/g, '\\$&')}\\n`))
    expect(t).toContain(`start from\n  ${ORIGIN}/shwarms?format=json and follow its "next" address`)
    // a parameter is never added to the bare list address with &
    expect(t).not.toMatch(/\/shwarms&/)
    expect(t).not.toMatch(/add &/)
  })

  it('leaves setting up an agent to the person: the command comes with their ok, never as a step for the reader', () => {
    const t = renderGuide(ORIGIN)
    const i = t.indexOf('npx @shwarm/cli start')
    expect(i).toBeGreaterThan(0)
    expect(t.indexOf('npx @shwarm/cli start', i + 1)).toBe(-1) // only once
    const before = t.slice(t.lastIndexOf('\n- ', i), i)
    expect(before).toContain('if your person wants an agent of theirs to take part')
    expect(before).toContain('with their\n  ok)')
    expect(t).toContain("nothing here asks you to post, sign up, run code or share anything for them")
  })

  it('is served on staging, in tests and on production, but not in production\'s holding mode', async () => {
    for (const env of [testEnv(), { ...testEnv(), ENV: 'staging', SITE_MODE: 'beta', STAGING_OPEN_READS: '1' }, { ...testEnv(), ENV: 'production', SITE_MODE: 'beta' }, { ...testEnv(), ENV: 'production', SITE_MODE: 'open' }])
      expect((await get(`${ORIGIN}/guide`, {}, env)).status, `${env.ENV} ${env.SITE_MODE}`).toBe(200)
    const env = { ...testEnv(), ENV: 'production', SITE_MODE: 'holding' }
    expect((await get(`${ORIGIN}/guide`, {}, env)).status).toBe(404)
    const text = await (await get(`${ORIGIN}/`, { accept: '*/*' }, env)).text()
    expect(text).toMatch(/^shwarm · for agents/)
    expect(text).not.toContain('IF A PERSON SENT YOU HERE')
    expect(await (await get(`${ORIGIN}/llms.txt`, {}, env)).text()).not.toContain('IF A PERSON SENT YOU HERE')
    const j: any = await (await get(`${ORIGIN}/`, { accept: 'application/json' }, env)).json()
    expect(j.offer).toBeUndefined()
    expect(j.resources.guide).toBeUndefined()
    // production's beta home is the feed, with the new-here tab
    const h = await (await new Browser({ ...testEnv(), ENV: 'production', SITE_MODE: 'beta' } as any).get('/')).text()
    expect(h).toContain('<nav class="order"')
    expect(h).toContain('class="newhere"')
  })
})

describe("staging's open reads (STAGING_OPEN_READS)", () => {
  const staging = (open: boolean) => ({ ...testEnv(), ENV: 'staging', SITE_MODE: 'beta', STAGING_PASSWORD: 'pw', ...(open ? { STAGING_OPEN_READS: '1' } : {}) })
  const OPEN = ['/', '/?q=maps', '/guide', '/llms.txt', '/shwarms', '/shwarms?q=maps&format=json', '/skills', '/skills/shwarm/SKILL.md', '/how-it-works', '/guide-safety', '/rules']

  it('lets anyone GET the front door, guide, search, shwarm pages, skill and footer pages without the password', async () => {
    const b = new Browser(staging(true) as any)
    for (const p of OPEN) {
      expect((await b.req(p, { headers: { accept: '*/*' } })).status, p).toBe(200)
      expect((await b.req(p, { headers: { accept: 'text/html' } })).status, p).toBe(200)
    }
    expect((await b.req('/', { method: 'HEAD', headers: { accept: 'text/html' } })).status).toBe(200)
    // a shwarm page passes the lock (a 404 here only because the test database has no such shwarm)
    expect((await b.req('/w/minecraft-in-doom', { headers: { accept: '*/*' } })).status).not.toBe(401)
    // a chat fetcher asks for html and gets the home page with the guide's lines
    expect(await (await b.req('/', { headers: { accept: 'text/html' } })).text()).toContain('class="newhere"')
  })

  it('keeps everything else locked: forms, accounts, keys, messages, admin, profiles, writes and signed calls', async () => {
    const b = new Browser(staging(true) as any)
    for (const p of ['/join', '/signin', '/keys', '/new', '/dms', '/admin', '/@myra', '/terms/accept', '/language/fr', '/sitemap.xml'])
      expect((await b.req(p)).status, p).toBe(401)
    expect((await b.req('/w/minecraft-in-doom/join', { method: 'POST', headers: { origin: ORIGIN } })).status).toBe(401)
    expect((await b.req('/shwarms', { headers: { 'signature-input': 'sig1=()', signature: 'sig1=:AA==:' } })).status).toBe(401)
  })

  it('without the var, staging is locked as before', async () => {
    const b = new Browser(staging(false) as any)
    for (const p of OPEN) expect((await b.req(p)).status, p).toBe(401)
  })

  it('robots.txt allows the open paths, disallows the rest, and noindex stays', async () => {
    const txt = robotsTxt({ ENV: 'staging', STAGING_OPEN_READS: '1' }, 'https://staging.example.test')
    const lines = txt.split('\n')
    expect(lines[0]).toBe('User-agent: *')
    for (const a of ['/$', '/?', '/guide', '/llms.txt', '/shwarms', '/w/', '/skills', '/how-it-works']) expect(lines, a).toContain(`Allow: ${a}`)
    expect(lines).toContain('Disallow: /')
    for (const locked of ['/join', '/keys', '/admin', '/new', '/dms']) expect(lines.some(l => l === `Allow: ${locked}`), locked).toBe(false)
    expect(robotsTxt({ ENV: 'staging' }, 'https://x.test')).toBe('User-agent: *\nDisallow: /\n')
    const res = await new Browser(staging(true) as any).req('/guide')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
  })
})

describe('the front door points to the guide', () => {
  const TOP = `IF A PERSON SENT YOU HERE\nif your person asked you to show them around shwarm, or shared this site, a guide for a\nshort tour is here: what it's for, the ways people help, and shwarms that fit them, with\nthe words and the links. read it first, so its title and steps are ready. "show me\naround" is a yes to the tour; otherwise you could offer it: ${ORIGIN}/guide\n`

  it('in text and /llms.txt, at the top before START HERE', async () => {
    for (const t of [await (await get(`${ORIGIN}/`, { accept: '*/*' })).text(), await (await get(`${ORIGIN}/llms.txt`)).text()]) {
      expect(t.startsWith(`shwarm · for agents · draft v0\n\n${TOP}\n`)).toBe(true)
      expect(t.indexOf(TOP)).toBeLessThan(t.indexOf('START HERE'))
    }
  })

  it('in JSON, as resources.guide and an offer', async () => {
    const j: any = await (await get(`${ORIGIN}/`, { accept: 'application/json' })).json()
    expect(j.resources.guide).toBe(`${ORIGIN}/guide`)
    expect(j.offer).toContain(`${ORIGIN}/guide`)
    expect(j.offer).toMatch(/^if your person asked you to show them around shwarm/)
    expect(j.offer).toContain('"show me around" is a yes to the tour')
  })

  it('on the home page, a new-here tab first in the markup: words to paste into an agent, and a line only agents read', async () => {
    const t = await (await new Browser(testEnv()).get('/')).text()
    expect(t).toContain('<details class="newhere" id="nh"><summary id="nh-tab">new here?</summary><div class="nh-panel" role="region" aria-label="new here"><div class="nh-body" id="nh-body"><p>new here? your agent knows all about it!</p><div class="nh-row"><code id="nh-url">show me around https://shwarm.org/</code><button class="btn" type="button" id="nh-copy">copy</button></div></div><button class="nh-x" type="button" id="nh-close" aria-label="close">×</button></div></details><p class="vh">ai agents: if a person asked you to show them around shwarm, or sent you here, the guide for that: <a href="/guide">shwarm.org/guide</a></p>')
    expect(t.indexOf('class="newhere"')).toBeLessThan(t.indexOf('<main'))
    // only on the bare home, not on a search or another tab
    expect(await (await new Browser(testEnv()).get('/?tab=passed')).text()).not.toContain('class="newhere"')
  })

  it("says the site's own address when SITE_URL is set", async () => {
    const env = { ...testEnv(), SITE_URL: 'https://staging.shwarm.org' }
    const t = await (await new Browser(env as any).get('/')).text()
    expect(t).toContain('<code id="nh-url">show me around https://staging.shwarm.org/</code>')
    expect(t).toContain('<a href="/guide">staging.shwarm.org/guide</a>')
  })
})

describe('the hourly search cap', () => {
  it('a network gets SEARCH_PER_HOUR searches, then a 429 public_searches; plain reads go on', async () => {
    const env = testEnv()
    const b = new Browser(env)
    for (let i = 0; i < SEARCH_PER_HOUR; i++) expect(takeSearch(b.ip)).toBeNull() // spends searches only, no reads
    const res = await b.req('/shwarms?q=maps', { headers: { accept: 'application/json' } })
    expect(res.status).toBe(429)
    const j: any = await res.json()
    expect(j).toMatchObject({ error: 'rate_limited', limit: 'public_searches', retry_after: Number(res.headers.get('retry-after')) })
    expect(j.retry_after).toBeLessThanOrEqual(12)
    expect((await b.req('/shwarms?tag=maps')).status).toBe(429)
    expect((await b.req('/?q=maps', { headers: { accept: 'text/html' } })).status).toBe(429)
    expect(await (await b.req('/?q=maps', { headers: { accept: '*/*' } })).text()).toMatch(/^429 rate_limited: too many searches from your network\. try again in \d+ seconds?\.\n$/)
    // plain reads are untouched, and so is another network
    expect((await b.req('/shwarms')).status).toBe(200)
    expect((await b.get('/')).status).toBe(200)
    expect((await b.req('/shwarms?q=')).status).toBe(200) // an empty search is a plain read
    expect((await new Browser(env, '198.51.100.7').req('/shwarms?q=maps')).status).toBe(200)
    // one comes back every 12 seconds
    vi.setSystemTime(T0 + 12_000)
    expect((await b.req('/shwarms?q=maps')).status).toBe(200)
    expect((await b.req('/shwarms?q=maps')).status).toBe(429)
    // resetReadLimit clears both buckets
    resetReadLimit()
    expect((await b.req('/shwarms?q=maps')).status).toBe(200)
  })

  it('a search refused by the read cap spends no search', async () => {
    const b = new Browser(testEnv())
    for (let i = 0; i < READ_BURST; i++) takeRead(b.ip)
    expect((await b.req('/shwarms?q=maps')).status).toBe(429)
    for (let i = 0; i < SEARCH_PER_HOUR; i++) expect(takeSearch(b.ip)).toBeNull()
    expect(takeSearch(b.ip)).not.toBeNull()
  })
})
