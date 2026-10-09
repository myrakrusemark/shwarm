// The keys page and the new-key modal in a real Chrome (go-live 7.2), on the loop's world (test/e2e/server.ts): @myra
// with a password, in minecraft in doom (with its block placement branch).
//   1. "+ new key" opens the modal: focus moves in and stays in with a ring at 3:1 on every stop; Esc, × and the scrim
//      close it; axe finds nothing serious and nothing scrolls sideways at 390 and 1280 px.
//   2. The grant chooser: "you're in" on focus, drilling from a shwarm into its branches, a search, a pasted link.
//   3. Making a key: keys.js makes the pair with WebCrypto, the password goes inline (the session's window is closed),
//      and the secret shows once as shwarm_sk_<keyid>_<seed>. Every request the browser sent is recorded, and every
//      table dumped afterwards: the seed is in none of them, and the stored public half is the seed's.
//   4. Rotating from the row shows a new secret and revokes the old key; revoking from the row works without script.
//   5. Without script the list shows, "+ new key" and "rotate" stay hidden, and a note says why.
// Run from apps/site: npm run test:e2e (CHROME_PATH=/path/to/chrome to pick a browser).
import { chromium, type Browser, type Page, type Request } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseSecret, publicKeyFromSeed, toBase64, toBase64url, toHex } from '@shwarm/protocol'
import { resetReadLimit } from '../../src/web/read-limit'
import { axeViolations, badRing, chrome, CHROMES, overflow } from './kit'
import { LOOP_PASSWORD, startLoopServer, type LoopServer } from './server'

// In-page code below runs in the browser; these names exist there, not in the Workers types this repo compiles with.
declare const document: any

let server: LoopServer
let browser: Browser
let my: Page
const sent: string[] = [] // every request @myra's browser made: method, URL, headers and body

const one = (sql: string, ...args: unknown[]): any => server.db.raw.prepare(sql).get(...args)
const all = (sql: string, ...args: unknown[]): any[] => server.db.raw.prepare(sql).all(...args)
const dump = () => all("SELECT name FROM sqlite_master WHERE type = 'table'").map(t => JSON.stringify(all(`SELECT * FROM "${t.name}"`))).join('\n')

async function open(page: Page, path: string, width = 1280) {
  await page.setViewportSize({ width, height: 900 })
  return (await page.goto(server.origin + path, { waitUntil: 'load' }))?.status()
}

const dialog = () => my.locator('#scrim [role="dialog"]')
const inside = () => my.evaluate(() => !!document.activeElement?.closest('#scrim [role="dialog"]'))

/** The secret on show, checked against the format and against what reached the server and the database. */
async function secretShown(): Promise<{ keyid: string; seed: Uint8Array; secret: string }> {
  await my.locator('#step2').waitFor({ state: 'visible' })
  const secret = (await my.locator('#secret').textContent())!
  expect(secret).toMatch(/^shwarm_sk_[a-z2-7]{20}_[A-Za-z0-9_-]{43}$/)
  expect(await my.locator('#envkey').textContent()).toBe(secret)
  const parsed = parseSecret(secret)!
  const traces = [secret, toBase64url(parsed.seed), toBase64(parsed.seed), toHex(parsed.seed)]
  const requests = sent.join('\n'), held = dump()
  for (const t of traces) {
    expect(requests.includes(t), 'the seed in a request').toBe(false)
    expect(held.includes(t), 'the seed in the database').toBe(false)
  }
  expect(one('SELECT public_key FROM agent_key WHERE id = ?', parsed.keyid).public_key).toBe(toBase64url(await publicKeyFromSeed(parsed.seed)))
  return { keyid: parsed.keyid, seed: parsed.seed, secret }
}

const runIt = chrome || process.env.CI ? describe : describe.skip

runIt('the keys page in a real browser (7.2)', () => {
  beforeAll(async () => {
    if (!chrome) throw new Error(`no Chrome found; set CHROME_PATH (looked in ${CHROMES.join(', ')})`)
    resetReadLimit()
    server = await startLoopServer()
    browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
    const ctx = await browser.newContext({ bypassCSP: true, reducedMotion: 'reduce' })
    await ctx.route(url => !url.toString().startsWith(server.origin), r => r.abort())
    await ctx.setExtraHTTPHeaders({ 'x-e2e-session': server.sessions.myra })
    my = await ctx.newPage()
    my.on('request', (r: Request) => void sent.push(`${r.method()} ${r.url()}\n${JSON.stringify(r.headers())}\n${r.postData() ?? ''}`))
  })

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  it('1. "+ new key" opens the modal, keeps focus inside, closes with Esc, × and the scrim', async () => {
    for (const width of [390, 1280]) {
      expect(await open(my, '/keys', width)).toBe(200)
      expect(await dialog().isVisible()).toBe(false)
      const opener = my.locator('#newkey')
      expect(await opener.isVisible(), 'keys.js shows the button').toBe(true)
      await opener.focus()
      await my.keyboard.press('Enter')
      expect(await dialog().isVisible(), `${width}px: opens`).toBe(true)
      expect(await my.evaluate(() => document.activeElement?.id)).toBe('kname')
      // the all-shwarms grant is there, with read, post, submit and check on; new shwarms off; edit and delete "later"
      expect(await my.locator('#grants .grant').count()).toBe(1)
      const checked = await my.locator('#grants .grant input:checked').evaluateAll((els: any[]) => els.map(e => e.value))
      expect(checked).toEqual(['read', 'post', 'submit', 'check'])
      expect(await my.locator('#grants input[value="new_shwarms"]').isChecked()).toBe(false)
      expect(await my.locator('#grants label.later input:disabled').count()).toBe(2)
      const rings: string[] = []
      for (let i = 0; i < 25; i++) {
        await my.keyboard.press('Tab')
        expect(await inside(), `Tab ${i + 1} stays inside`).toBe(true)
        const bad = await badRing(my)
        if (bad) rings.push(bad)
      }
      for (let i = 0; i < 25; i++) {
        await my.keyboard.press('Shift+Tab')
        expect(await inside(), `Shift+Tab ${i + 1} stays inside`).toBe(true)
      }
      expect(rings, 'focus rings in the dialog').toEqual([])
      const o = await overflow(my)
      expect(o.scrollWidth, `open modal scrolls sideways at ${width}px: ${o.wide.join(', ')}`).toBeLessThanOrEqual(o.innerWidth)
      expect(await axeViolations(my, '#scrim [role="dialog"]'), `axe on the open dialog at ${width}px`).toEqual([])

      await my.keyboard.press('Escape')
      expect(await dialog().isVisible(), 'Esc closes').toBe(false)
      expect(await my.evaluate(() => document.activeElement?.id), 'focus goes back to the button').toBe('newkey')
      await opener.click()
      await my.locator('#mclose').click()
      expect(await dialog().isVisible(), '× closes').toBe(false)
      await opener.click()
      await my.mouse.click(3, 3)
      expect(await dialog().isVisible(), 'a click on the scrim closes').toBe(false)
    }
  })

  it("2. the chooser: you're in, drilling into branches, a search, a pasted link", async () => {
    await open(my, '/keys')
    await my.locator('#newkey').click()
    const title = one("SELECT title FROM node WHERE path = 'minecraft-in-doom'").title as string
    const box = my.locator('#gsearch')
    await box.focus()
    await my.locator('#gresults').waitFor({ state: 'visible' })
    await expect.poll(() => my.locator('#ghead').textContent()).toBe("you're in")
    expect(await my.locator('#glist [role="option"]').first().textContent()).toBe('all shwarms every shwarm and branch')
    expect(await my.locator('#glist').textContent()).toContain(title)
    expect(await axeViolations(my, '#scrim [role="dialog"]'), 'axe with the list open').toEqual([])
    // a shwarm with branches drills in; a branch with none is added
    await my.locator('#glist li', { hasText: title }).click()
    await expect.poll(() => my.locator('#ghead').textContent()).toBe('branches')
    expect(await my.locator('#gcrumbs .seg').textContent()).toBe(title)
    expect(await my.locator('#gfoot').textContent()).toContain('and its branches')
    await my.locator('#glist li', { hasText: 'block placement' }).click()
    await expect.poll(() => my.locator('#grants .grant').count()).toBe(2)
    expect(await my.locator('#grants .grant').nth(1).locator('.gpath').textContent()).toBe(`${title} / block placement`)
    // new shwarms only on all shwarms
    expect(await my.locator('#grants .grant').nth(1).locator('input[value="new_shwarms"]').count()).toBe(0)
    // a search, then enter takes the highlighted shwarm; enter on the empty box adds it with its branches
    await box.fill(title.slice(0, 5))
    await expect.poll(() => my.locator('#ghead').textContent()).toBe('shwarms')
    await my.keyboard.press('Enter')
    await expect.poll(() => my.locator('#gcrumbs .seg').count()).toBe(1)
    await my.keyboard.press('Enter')
    await expect.poll(() => my.locator('#grants .grant').count()).toBe(3)
    // a pasted link resolves to its node
    await box.fill(`${server.origin}/w/minecraft-in-doom/block-placement/s/1`)
    await expect.poll(() => my.locator('#ghead').textContent()).toBe('from link')
    await my.keyboard.press('Escape')
    expect(await dialog().isVisible(), 'Esc in the chooser closes only the list').toBe(true)
    expect(await my.locator('#gresults').isVisible()).toBe(false)
    await my.keyboard.press('Escape')
    expect(await dialog().isVisible()).toBe(false)
  })

  it('3. makes a key in the browser: the password inline, the secret once, the seed nowhere on the server', async () => {
    await open(my, '/keys')
    await my.locator('#newkey').click()
    await my.fill('#kname', 'claude code · laptop')
    // the session was made without a sign-in, so its window is closed: the password shows, and an empty one is refused
    expect(await my.locator('#k-pw').isVisible()).toBe(true)
    await my.locator('#make').click()
    await expect.poll(() => my.locator('#e-make').textContent()).toBe('enter your password to confirm.')
    expect(await my.evaluate(() => document.activeElement?.id)).toBe('k-pw')
    await my.fill('#k-pw', LOOP_PASSWORD)
    await my.locator('#make').click()
    const made = await secretShown()
    expect(await my.locator('#madefor').textContent()).toBe('claude code · laptop')
    expect(await my.locator('#scopeecho').textContent()).toBe('@myra/*')
    expect(await my.locator('#accecho').textContent()).toBe('all shwarms')
    expect(await my.evaluate(() => document.activeElement?.id)).toBe('copy')
    expect(await axeViolations(my, '#scrim [role="dialog"]'), 'axe on the secret step').toEqual([])
    // done: the page reloads with the new row, and the secret is gone from it
    await Promise.all([my.waitForNavigation({ waitUntil: 'load' }), my.locator('#done').click()])
    expect(await my.locator(`#k-${made.keyid}`).isVisible()).toBe(true)
    expect(await my.content()).not.toContain(made.secret)
    for (const width of [390, 1280]) {
      await my.setViewportSize({ width, height: 900 })
      const o = await overflow(my)
      expect(o.scrollWidth, `the list scrolls sideways at ${width}px: ${o.wide.join(', ')}`).toBeLessThanOrEqual(o.innerWidth)
      expect(await axeViolations(my), `axe on the page at ${width}px`).toEqual([])
    }
  })

  it('4. rotates from the row (a new secret, the old key revoked), and revokes', async () => {
    await open(my, '/keys')
    const old = one("SELECT id FROM agent_key WHERE revoked_at IS NULL AND name = 'claude code · laptop'").id as string
    const row = my.locator(`#k-${old}`)
    await row.locator('details.rot > summary').click()
    await row.locator('form.rotate-act button[type="submit"]').click() // the window is open from the make
    const fresh = await secretShown()
    expect(fresh.keyid).not.toBe(old)
    expect(one('SELECT revoked_at FROM agent_key WHERE id = ?', old).revoked_at).not.toBeNull()
    await Promise.all([my.waitForNavigation({ waitUntil: 'load' }), my.keyboard.press('Escape')])
    expect(await my.locator(`#k-${old}`).getAttribute('class')).toBe('revoked')

    const r = my.locator(`#k-${fresh.keyid}`)
    await r.locator('details.rev > summary').click()
    expect((await overflow(my)).scrollWidth).toBeLessThanOrEqual(1280)
    await Promise.all([my.waitForNavigation({ waitUntil: 'load' }), r.locator('details.rev button[type="submit"]').click()])
    expect(new URL(my.url()).search).toBe('?done=revoked')
    expect(await my.locator('.kstatus').textContent()).toBe('revoked. it stops working at once.')
    expect(one('SELECT revoked_at FROM agent_key WHERE id = ?', fresh.keyid).revoked_at).not.toBeNull()
  })

  it('5. without script: the list and revoke, no "+ new key" or "rotate", and a note why', async () => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, extraHTTPHeaders: { 'x-e2e-session': server.sessions.myra } })
    const page = await ctx.newPage()
    await page.goto(server.origin + '/keys', { waitUntil: 'load' })
    expect(await page.locator('#newkey').isVisible()).toBe(false)
    expect(await page.locator('main').textContent()).toContain('making a key needs javascript')
    expect(await page.locator('details.rot').count()).toBe(0) // every key above is revoked
    await ctx.close()
  })
})
