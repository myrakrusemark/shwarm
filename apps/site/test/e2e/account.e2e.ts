// The account modal in a real Chrome (go-live 6.2), on the loop's world (test/e2e/server.ts): @myra with a password.
//   1. The modal: "account" opens it, focus moves in and stays in (Tab, Shift+Tab) with a ring at 3:1 on every stop,
//      Esc, × and the scrim close it and focus goes back to the button; axe finds nothing serious and nothing scrolls
//      sideways at 390 and 1280 px.
//      Without script, ?account=1 shows it open and × is a link back.
//   2. Saving the about line asks for the password inline (the session's window is closed) and lands on "saved.".
//   3. An email change: the old address stays, the new one's link opens a page whose button moves the account.
//   4. A password change from the modal ends @myra's other sessions (a second browser), not this one, and queues the
//      "password changed" mail.
//   5. "sign out everywhere" ends every session, this browser's too.
// The flows themselves, and their refusals, are covered in test/account.test.ts; this suite runs them through the pages.
//
// Run from apps/site: npm run test:e2e (CHROME_PATH=/path/to/chrome to pick a browser).
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSession } from '../../src/auth/session'
import { resetReadLimit } from '../../src/web/read-limit'
import { axeViolations, badRing, chrome, CHROMES, overflow } from './kit'
import { LOOP_PASSWORD, startLoopServer, type LoopServer } from './server'

// In-page code below runs in the browser; these names exist there, not in the Workers types this repo compiles with.
declare const document: any

const NEW_PASSWORD = 'quiet brown owls by the river'

let server: LoopServer
let browser: Browser
let my: Page // @myra
let phone: Page // @myra in a second browser, signed in on its own session
let out: Page // signed out

const one = (sql: string, ...args: unknown[]): any => server.db.raw.prepare(sql).get(...args)

async function open(page: Page, path: string): Promise<number | undefined> {
  await page.setViewportSize({ width: 1280, height: 900 })
  return (await page.goto(server.origin + path, { waitUntil: 'load' }))?.status()
}

/** Clicks something that sends a form, and waits for the page it lands on. */
async function send(page: Page, selector: string): Promise<URL> {
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.locator(selector).click()])
  return new URL(page.url())
}

const signedIn = async (page: Page) => (await page.locator('.strip .me .h').count()) === 1

const runIt = chrome || process.env.CI ? describe : describe.skip

runIt('the account modal in a real browser (6.2)', () => {
  beforeAll(async () => {
    if (!chrome) throw new Error(`no Chrome found; set CHROME_PATH (looked in ${CHROMES.join(', ')})`)
    resetReadLimit()
    server = await startLoopServer()
    browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
    const myId = one("SELECT id FROM person WHERE handle = 'myra'").id as number
    const second = await createSession(server.db, myId, { ip: '127.0.0.2', ua: 'e2e phone' })
    const pages: Page[] = []
    for (const session of [server.sessions.myra, second, null]) {
      const ctx = await browser.newContext({ bypassCSP: true, reducedMotion: 'reduce' })
      await ctx.route(url => !url.toString().startsWith(server.origin), r => r.abort())
      // The session rides in a test header that the server sends on as the cookie, redirects included.
      if (session) await ctx.setExtraHTTPHeaders({ 'x-e2e-session': session })
      pages.push(await ctx.newPage())
    }
    ;[my, phone, out] = pages
  })

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  it('1. opens from "account", keeps focus inside, closes with Esc, × and the scrim', async () => {
    expect(await open(my, '/@myra')).toBe(200)
    const dialog = my.locator('#ascrim [role="dialog"]')
    expect(await dialog.isVisible()).toBe(false)
    expect(await dialog.getAttribute('aria-modal')).toBe('true')
    expect(await my.locator('#atitle span').textContent()).toBe('account')
    const inside = () => my.evaluate(() => !!document.activeElement?.closest('#ascrim [role="dialog"]'))

    for (const width of [390, 1280]) {
      await my.setViewportSize({ width, height: 800 })
      const opener = my.locator('#acct')
      await opener.focus()
      await my.keyboard.press('Enter')
      expect(await dialog.isVisible(), `${width}px: opens`).toBe(true)
      expect(new URL(my.url()).search, 'opened in place, no page load').toBe('')
      expect(await inside(), 'focus moves into the dialog').toBe(true)
      expect(await my.evaluate(() => document.activeElement?.id)).toBe('about-in')
      expect(await my.locator('#acount').textContent()).toMatch(/^\d+ left$/)
      // every stop shows a focus ring at 3:1 against what's behind it (the × sits on the sun header)
      const rings: string[] = []
      for (let i = 0; i < 30; i++) {
        await my.keyboard.press('Tab')
        expect(await inside(), `Tab ${i + 1} stays inside`).toBe(true)
        const bad = await badRing(my)
        if (bad) rings.push(bad)
      }
      for (let i = 0; i < 30; i++) {
        await my.keyboard.press('Shift+Tab')
        expect(await inside(), `Shift+Tab ${i + 1} stays inside`).toBe(true)
      }
      expect(rings, 'focus rings in the dialog').toEqual([])
      // a click on the dialog's text sends focus to body; the next Tab still lands inside
      await my.locator('#ascrim .fixed').click()
      await my.keyboard.press('Tab')
      expect(await inside(), 'Tab after a click on the text stays inside').toBe(true)
      const o = await overflow(my)
      expect(o.scrollWidth, `open modal scrolls sideways at ${width}px: ${o.wide.join(', ')}`).toBeLessThanOrEqual(o.innerWidth)
      expect(await axeViolations(my, '#ascrim [role="dialog"]'), `axe on the open dialog at ${width}px`).toEqual([])
      // the change password form, opened, at this width too
      await my.locator('.chpw > summary').click()
      expect(await my.locator('#pw-change').isVisible()).toBe(true)
      expect((await overflow(my)).scrollWidth).toBeLessThanOrEqual(width)
      expect(await axeViolations(my, '#ascrim [role="dialog"]'), `axe with change password open at ${width}px`).toEqual([])
      await my.locator('.chpw > summary').click()

      await my.keyboard.press('Escape')
      expect(await dialog.isVisible(), 'Esc closes').toBe(false)
      expect(await my.evaluate(() => document.activeElement?.id), 'focus goes back to the button').toBe('acct')

      await opener.click()
      await my.locator('#aclose').click()
      expect(await dialog.isVisible(), '× closes').toBe(false)
      expect(new URL(my.url()).pathname).toBe('/@myra')

      await opener.click()
      await my.mouse.click(3, 3) // the scrim, outside the dialog
      expect(await dialog.isVisible(), 'a click on the scrim closes').toBe(false)
    }
  })

  it('1b. works without script: ?account=1 shows it open, × is a link back', async () => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, extraHTTPHeaders: { 'x-e2e-session': server.sessions.myra } })
    const page = await ctx.newPage()
    await page.goto(server.origin + '/@myra', { waitUntil: 'load' })
    expect(await page.locator('#ascrim').isVisible()).toBe(false)
    await Promise.all([page.waitForNavigation(), page.locator('#acct').click()])
    expect(new URL(page.url()).search).toBe('?account=1')
    expect(await page.locator('#ascrim [role="dialog"]').isVisible()).toBe(true)
    await Promise.all([page.waitForNavigation(), page.locator('#aclose').click()])
    expect(await page.locator('#ascrim').isVisible()).toBe(false)
    await ctx.close()
  })

  it('2. saving asks for the password inline and lands on "saved."', async () => {
    await open(my, '/@myra')
    await my.locator('#acct').click()
    await my.fill('#about-in', 'product designer who also ships the things i make.')
    await my.locator('input[name="website"]').fill('myrakrusemark.com')
    // the session was made without a sign-in, so its window is closed: the password field shows
    expect(await my.locator('#pw-save').isVisible()).toBe(true)
    await my.fill('#pw-save', LOOP_PASSWORD)
    const landed = await send(my, '#asave')
    expect(landed.pathname + landed.search).toBe('/@myra?account=saved')
    expect(await my.locator('.astatus').textContent()).toBe('saved.')
    expect(await my.locator('#ascrim [role="dialog"]').isVisible()).toBe(true)
    expect(await my.locator('.who-head .about').textContent()).toBe('product designer who also ships the things i make.')
    // within the window now: no password field
    expect(await my.locator('#pw-save').count()).toBe(0)
    // closing drops ?account= so a reload doesn't open it again
    await my.keyboard.press('Escape')
    expect(new URL(my.url()).search).toBe('')
  })

  it('3. an email change keeps the old address until the new one is confirmed by its link', async () => {
    await open(my, '/@myra?account=1')
    await my.locator('input[name="email"]').fill('myra@new.example')
    await send(my, '#asave')
    expect(await my.locator('.pending').textContent()).toContain('a link went to myra@new.example.')
    expect(one("SELECT email FROM person WHERE handle = 'myra'").email).not.toBe('myra@new.example')
    expect(one("SELECT COUNT(*) AS n FROM email_outbox WHERE template = 'email_change_old'").n).toBe(1)
    const link = JSON.parse(one("SELECT payload FROM email_outbox WHERE template = 'email_change_new' ORDER BY id DESC").payload).link as string

    expect(await open(out, link)).toBe(200)
    expect(await out.locator('main').textContent()).toContain('myra@new.example')
    const done = await send(out, 'button[type="submit"]:has-text("use this address")')
    expect(done.pathname + done.search).toBe('/email-change?done=1')
    expect(await out.locator('main h2').textContent()).toBe('your new email is set')
    expect(one("SELECT email FROM person WHERE handle = 'myra'").email).toBe('myra@new.example')
    await open(my, '/@myra?account=1')
    expect(await my.locator('input[name="email"]').inputValue()).toBe('myra@new.example')
    expect(await my.locator('.pending').count()).toBe(0)
  })

  it('4. a password change ends every other session, keeps this one, and sends the mail', async () => {
    await open(phone, '/@myra')
    expect(await signedIn(phone), 'the second browser starts signed in').toBe(true)
    await open(my, '/@myra?account=1')
    await my.locator('.chpw > summary').click()
    await my.fill('input[name="new_password"]', NEW_PASSWORD)
    await my.fill('input[name="new_password2"]', NEW_PASSWORD)
    const landed = await send(my, '.chpw button[type="submit"]')
    expect(landed.pathname + landed.search).toBe('/@myra?account=password')
    expect(await my.locator('.astatus').textContent()).toBe('your password is changed. every other browser is signed out.')
    expect(await signedIn(my)).toBe(true)
    await open(phone, '/@myra')
    expect(await signedIn(phone), 'the second browser is signed out').toBe(false)
    const mail = one("SELECT to_email, stream FROM email_outbox WHERE template = 'password_changed' ORDER BY id DESC")
    expect(mail).toEqual({ to_email: 'myra@new.example', stream: 'security' })
  })

  it('5. "sign out everywhere" ends every session, this one too', async () => {
    await open(my, '/@myra?account=1')
    const landed = await send(my, '.out-all button[type="submit"]')
    expect(landed.pathname + landed.search).toBe('/signin?done=everywhere')
    expect(await my.locator('main').textContent()).toContain("you're signed out everywhere.")
    expect(await signedIn(my)).toBe(false)
    expect(one("SELECT COUNT(*) AS n FROM session s JOIN person p ON p.id = s.person_id WHERE p.handle = 'myra'").n).toBe(0)
  })
})
