// The browser suite (go-live 3.8): every reading, account and error page, signed out and signed in, in a real
// Chrome driven by playwright-core (no browser download: it uses the system or CI Chrome). For each page:
//   - the status is the one we expect;
//   - at 390, 640, 860 and 1280 px nothing scrolls sideways (scrollWidth <= innerWidth);
//   - axe-core finds no serious or critical violations at 390 and 1280 px;
//   - every relative time ("3h ago") carries the exact time in a title.
// The donate modal is checked on a spread of pages: role=dialog with a name, focus moves in, Tab and Shift+Tab stay
// inside (also after a click on the dialog's text), Esc, × and the scrim close it, and focus goes back to the link
// that opened it. Every focus ring is checked for 3:1 against what's behind it, not only that it exists.
// The world has long words that must wrap: a branch title with no break points, a long URL in a post and in the
// takedown reason, and a signed-in handle at the 32-character limit.
//
// Run from apps/site: npm run test:e2e (CHROME_PATH=/path/to/chrome to pick a browser).
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../../src/seed/example'
import { PAGES as DOCS } from '../../src/web/doc'
import { takeRead, resetReadLimit } from '../../src/web/read-limit'
import { PLAIN } from '../node-fixture'
import { axeViolations, badRing, chrome, CHROMES, overflow } from './kit'
import { HIDDEN, LONG_BRANCH, LONG_HANDLE, LONG_TITLE, startServer, type E2eServer } from './server'

// In-page code below runs in the browser; these names exist there, not in the Workers types this repo compiles with.
declare const document: any
declare const window: any
declare const NodeFilter: any

const WIDTHS = [390, 640, 860, 1280]
const AXE_WIDTHS = [390, 1280]
const BUSY_IP = '198.51.100.7'

type Who = 'out' | 'in'
type Case = { path: string; status: number; only?: Who; headers?: Record<string, string>; before?: () => void }

const CASES: Case[] = [
  // the feed
  { path: '/', status: 200 },
  { path: '/?tab=new', status: 200 },
  { path: '/?tab=closed', status: 200 },
  { path: '/?q=doom', status: 200 },
  { path: '/?q=nothing-matches-this', status: 200 },
  // node pages
  { path: `/w/${EXAMPLE_ROOT}`, status: 200 },
  { path: `/w/${EXAMPLE_ROOT}?sort=new&show=submissions`, status: 200 },
  { path: `/w/${EXAMPLE_BRANCH}`, status: 200 },
  { path: `/w/${PLAIN}`, status: 200 },
  { path: `/w/${LONG_BRANCH}`, status: 200 },
  // profiles
  { path: '/@myra', status: 200 },
  { path: '/@myra?as=@myra/m-04', status: 200 },
  { path: '/@myra?as=not%20a%20name!', status: 400 },
  // the owner's account modal, open without script (go-live 6.2)
  { path: '/@myra?account=1', status: 200, only: 'in' },
  // the keys page (go-live 7.2)
  { path: '/keys', status: 200, only: 'in' },
  // footer pages and guides
  ...DOCS.map(d => ({ path: `/${d.slug}`, status: 200 })),
  // account pages
  { path: '/join', status: 200 },
  { path: '/signin', status: 200 },
  { path: '/forgot', status: 200 },
  { path: '/check-email', status: 200 },
  { path: '/check-email?r=reset', status: 200 },
  { path: '/verified', status: 200 },
  { path: '/verify?t=no-such-token', status: 410 },
  { path: '/reset?t=no-such-token', status: 410 },
  { path: '/step-up', status: 200, only: 'in' },
  // the create form, its branch mode and builds-on (go-live 4.2, 4.3; no variants since Oct 9); the long branch title must
  // wrap in the crumbs and the done test
  { path: '/new', status: 200, only: 'in' },
  { path: `/new?parent=${LONG_BRANCH}`, status: 200, only: 'in' },
  { path: `/new?builds_on=${EXAMPLE_ROOT}`, status: 200, only: 'in' },
  // error pages
  { path: '/no-such-page', status: 404 },
  { path: '/w/no-such-shwarm', status: 404 },
  { path: `/w/${HIDDEN}`, status: 410 },
  { path: '/@nobody_here', status: 404 },
  { path: '/@gone_one', status: 410 },
  { path: '/@held_one', status: 403 },
  {
    path: `/w/${EXAMPLE_ROOT}?busy`,
    status: 429,
    headers: { 'x-e2e-ip': BUSY_IP },
    before: () => { for (let i = 0; i < 500; i++) takeRead(BUSY_IP) },
  },
  { path: '/@myra?broken', status: 500, headers: { 'x-e2e-db': 'broken' } },
  // mail's unsubscribe page: rendered without the session (it's reached from a mail link), so signed out only
  { path: '/unsubscribe?t=not-a-token', status: 400, only: 'out' },
]

/** The donate modal is checked here (one of each page kind). */
const MODAL_PAGES = ['/', `/w/${EXAMPLE_ROOT}`, `/w/${EXAMPLE_BRANCH}`, '/@myra', '/how-it-works', '/signin', '/no-such-page']

let server: E2eServer
let browser: Browser
const contexts = {} as Record<Who, BrowserContext>
const pages = {} as Record<Who, Page>

async function open(who: Who, c: Case) {
  const page = pages[who]
  c.before?.()
  await page.setExtraHTTPHeaders(c.headers ?? {})
  await page.setViewportSize({ width: 1280, height: 900 })
  const res = await page.goto(server.origin + c.path, { waitUntil: 'load' })
  await page.setExtraHTTPHeaders({})
  return { page, res }
}

/** Relative times outside participant text: how many, and those with no exact time in a title above them. */
const relativeTimes = (page: Page) =>
  page.evaluate(() => {
    const REL = /^(?:[a-z ]{0,20} )?(?:\d+[mhdwy] ago|just now|yesterday|\d+ (?:days?|weeks?|months?|years?) ago)$/
    const out: string[] = []
    let seen = 0
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const text = n.textContent.replace(/\s+/g, ' ').trim().replace(/^· | ·$/g, '')
      if (!REL.test(text)) continue
      const el = n.parentElement
      if (el.closest('.txt, pre, code')) continue
      seen++
      const titled = el.closest('[title]')
      if (!titled || !/\d{4}-\d{2}-\d{2}/.test(titled.getAttribute('title'))) out.push(text)
    }
    return { seen, untitled: out }
  })

/** Pages that show relative times, so the check above can't pass by finding none. */
const HAS_TIMES = ['/', `/w/${EXAMPLE_ROOT}`, `/w/${EXAMPLE_BRANCH}`, '/@myra', '/@myra?as=@myra/m-04']

const runIt = chrome || process.env.CI ? describe : describe.skip

runIt('every page in a real browser (3.8)', () => {
  beforeAll(async () => {
    if (!chrome) throw new Error(`no Chrome found; set CHROME_PATH (looked in ${CHROMES.join(', ')})`)
    resetReadLimit()
    server = await startServer()
    browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
    for (const who of ['out', 'in'] as Who[]) {
      // bypassCSP lets axe run; the site's own scripts are same-origin and pass the CSP either way.
      const ctx = await browser.newContext({ bypassCSP: true, reducedMotion: 'reduce' })
      // Nothing leaves the machine: Turnstile and any other outside request is refused.
      await ctx.route(url => !url.toString().startsWith(server.origin), r => r.abort())
      // Signed in: the session cookie on every request. A __Host- cookie can't be set on http://localhost, so it
      // rides as a header instead of in the cookie jar.
      if (who === 'in') await ctx.setExtraHTTPHeaders({ cookie: `${server.cookie.name}=${server.cookie.value}` })
      contexts[who] = ctx
      pages[who] = await ctx.newPage()
    }
  })

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  it('signs in with the session cookie', async () => {
    const { page } = await open('in', { path: '/', status: 200 })
    expect(await page.locator('.strip .me .h').textContent()).toBe('@myra')
    const out = await open('out', { path: '/', status: 200 })
    expect(await out.page.locator('.strip .me').textContent()).toContain('sign in')
  })

  for (const who of ['out', 'in'] as Who[]) {
    describe(`signed ${who}`, () => {
      for (const c of CASES.filter(c => !c.only || c.only === who)) {
        it(`${c.path} → ${c.status}`, async () => {
          const { page, res } = await open(who, c)
          expect(res?.status(), 'status').toBe(c.status)
          // The 500 and the read cap's 429 show the strip signed out: neither reads the session (web/read-limit.ts).
          if (who === 'in' && c.status !== 500 && c.status !== 429) expect(await page.locator('.strip .me .h').count(), 'signed in').toBe(1)

          for (const width of WIDTHS) {
            await page.setViewportSize({ width, height: 900 })
            const o = await overflow(page)
            expect(o.scrollWidth, `sideways scroll at ${width}px: ${o.wide.join(', ')}`).toBeLessThanOrEqual(o.innerWidth)
            if (AXE_WIDTHS.includes(width)) {
              const v = await axeViolations(page)
              expect(v, `axe at ${width}px`).toEqual([])
            }
          }
          const times = await relativeTimes(page)
          expect(times.untitled, 'relative times without an exact title').toEqual([])
          if (HAS_TIMES.includes(c.path)) expect(times.seen, 'relative times found').toBeGreaterThan(0)
        })
      }
    })
  }

  describe('the donate modal', () => {
    for (const who of ['out', 'in'] as Who[]) {
      for (const path of MODAL_PAGES) {
        for (const width of [390, 1280]) {
          it(`${path}, signed ${who}, ${width}px`, async () => {
            const { page } = await open(who, { path, status: 200 })
            await page.setViewportSize({ width, height: 800 })
            // the owner's profile also has the account modal (go-live 6.2, test/e2e/account.e2e.ts)
            const dialog = page.locator('#dn-scrim [role="dialog"]')
            expect(await dialog.count()).toBe(1)
            expect(await dialog.getAttribute('aria-modal')).toBe('true')
            const label = await page.evaluate(() => document.getElementById(document.querySelector('#dn-scrim [role="dialog"]').getAttribute('aria-labelledby'))?.textContent?.trim())
            expect(label).toBeTruthy()
            expect(await dialog.isVisible()).toBe(false)

            // open from the keyboard: focus the strip's donate link and press enter
            const opener = page.locator('.strip .dn-link')
            await opener.focus()
            await page.keyboard.press('Enter')
            expect(await dialog.isVisible()).toBe(true)
            const inside = () => page.evaluate(() => !!document.activeElement?.closest('#dn-scrim [role="dialog"]'))
            expect(await inside(), 'focus moves into the dialog').toBe(true)

            // the focus ring shows on whatever has focus, at 3:1 against what's behind it (the × sits on the sun header)
            const rings: string[] = []
            const ring = async () => { const bad = await badRing(page); if (bad) rings.push(bad) }
            await ring()

            for (let i = 0; i < 25; i++) {
              await page.keyboard.press('Tab')
              expect(await inside(), `Tab ${i + 1} stays inside`).toBe(true)
              await ring()
            }
            for (let i = 0; i < 25; i++) {
              await page.keyboard.press('Shift+Tab')
              expect(await inside(), `Shift+Tab ${i + 1} stays inside`).toBe(true)
              await ring()
            }
            expect(rings, 'focus rings in the dialog').toEqual([])

            // a click on the dialog's text sends focus to body; the next Tab or Shift+Tab still lands inside
            for (const key of ['Shift+Tab', 'Tab']) {
              await page.locator('#dn-title span').click()
              await page.keyboard.press(key)
              expect(await inside(), `${key} after a click on the title stays inside`).toBe(true)
            }
            await page.locator('.dn .sec p').first().click()
            await page.keyboard.press('Shift+Tab')
            expect(await inside(), 'Shift+Tab after a click on the text stays inside').toBe(true)
            const o = await overflow(page)
            expect(o.scrollWidth, `open modal scrolls sideways at ${width}px`).toBeLessThanOrEqual(o.innerWidth)
            expect(await axeViolations(page, '#dn-scrim [role="dialog"]'), 'axe on the open dialog').toEqual([])

            await page.keyboard.press('Escape')
            expect(await dialog.isVisible(), 'Esc closes').toBe(false)
            expect(await page.evaluate(() => document.activeElement?.matches('.strip .dn-link')), 'focus goes back to the opener').toBe(true)

            await opener.click()
            await page.locator('#dn-close').click()
            expect(await dialog.isVisible(), '× closes').toBe(false)

            await opener.click()
            await page.mouse.click(3, 3) // the scrim, outside the dialog
            expect(await dialog.isVisible(), 'a click on the scrim closes').toBe(false)
          })
        }
      }
    }
  })

  describe('long words', () => {
    it('the long branch title shows, on its own page and on the parent', async () => {
      for (const path of [`/w/${EXAMPLE_ROOT}`, `/w/${LONG_BRANCH}`]) {
        const { page } = await open('out', { path, status: 200 })
        expect(await page.content(), path).toContain(LONG_TITLE)
      }
    })

    it(`a handle at the 32-character limit doesn't widen any page`, async () => {
      const ctx = await browser.newContext({ bypassCSP: true, reducedMotion: 'reduce' })
      await ctx.route(url => !url.toString().startsWith(server.origin), r => r.abort())
      await ctx.setExtraHTTPHeaders({ cookie: `${server.longCookie.name}=${server.longCookie.value}` })
      const page = await ctx.newPage()
      try {
        for (const [path, status] of [['/', 200], [`/w/${EXAMPLE_ROOT}`, 200], [`/w/${LONG_BRANCH}`, 200], [`/@${LONG_HANDLE}`, 200], ['/@myra', 200], ['/signin', 200], ['/no-such-page', 404], [`/w/${HIDDEN}`, 410]] as const) {
          const res = await page.goto(server.origin + path, { waitUntil: 'load' })
          expect(res?.status(), path).toBe(status)
          expect(await page.locator('.strip .me .h').textContent(), path).toBe('@' + LONG_HANDLE)
          for (const width of [390, 640]) {
            await page.setViewportSize({ width, height: 900 })
            const o = await overflow(page)
            expect(o.scrollWidth, `${path} at ${width}px: ${o.wide.join(', ')}`).toBeLessThanOrEqual(o.innerWidth)
          }
        }
      } finally {
        await ctx.close()
      }
    })
  })

  describe('focus', () => {
    const FOCUS_PAGES = ['/', `/w/${EXAMPLE_ROOT}`, `/w/${EXAMPLE_BRANCH}`, '/@myra', '/signin', '/how-it-works', '/no-such-page']
    for (const who of ['out', 'in'] as Who[]) {
      for (const path of FOCUS_PAGES) {
        it(`every control reached by Tab on ${path}, signed ${who}, shows a ring at 3:1`, async () => {
          const { page } = await open(who, { path, status: path === '/no-such-page' ? 404 : 200 })
          const bad: string[] = []
          let reached = 0
          // the whole page, until focus comes back round to the first stop
          let first: unknown = null
          for (let i = 0; i < 200; i++) {
            await page.keyboard.press('Tab')
            const id = await page.evaluate(() => {
              const el = document.activeElement
              if (!el || el === document.body) return null
              el.dataset.e2eStop ??= String(Math.random())
              return el.dataset.e2eStop
            })
            if (id === null) continue
            if (id === first) break
            first ??= id
            reached++
            const b = await badRing(page)
            if (b) bad.push(b)
          }
          expect(reached, 'controls reached').toBeGreaterThan(3)
          expect(bad).toEqual([])
        })
      }
    }

    it('the compose box links, on sun, show a ring at 3:1', async () => {
      for (const who of ['out', 'in'] as Who[]) {
        const { page } = await open(who, { path: `/w/${EXAMPLE_ROOT}`, status: 200 })
        const links = page.locator('.compose a')
        expect(await links.count()).toBeGreaterThan(0)
        for (let i = 0; i < (await links.count()); i++) {
          await links.nth(i).focus()
          await page.keyboard.press('Shift+Tab')
          await page.keyboard.press('Tab') // keyboard focus, so :focus-visible applies
          expect(await badRing(page), `signed ${who}, link ${i + 1}`).toBeNull()
        }
      }
    })

    it('the skip link is the first stop and lands on the main content', async () => {
      const { page } = await open('out', { path: `/w/${EXAMPLE_ROOT}`, status: 200 })
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('skip to content')
      expect(await page.evaluate(() => document.activeElement.getBoundingClientRect().width > 1)).toBe(true)
      await page.keyboard.press('Enter')
      expect(await page.evaluate(() => window.location.hash)).toBe('#main')
      expect(await page.evaluate(() => !!document.getElementById('main'))).toBe(true)
    })
  })
})
