// The whole loop, end to end (go-live 5.8; one model for every node, decided Oct 14): four accounts in a real Chrome,
// through the real pages, from an empty create form to the pass box.
//   1. @myra starts a shwarm on /new: the done test is its sentence, no checks box. It's live at once (no lobby,
//      decided Oct 9). Triage clears it.
//   2. @submitter, @checker and @runner join it ("working on it").
//   3. @submitter says it passed from the people card: a passed claim with the evidence and the work linked.
//   4. @checker and @runner back the claim from the thread: passed leads on track by 3, and the card says when the
//      status changes at this rate.
//   5. A day goes by (the stats job writes the change when it comes due): the status is passed, the pass box shows
//      the record with the work, and @myra's inbox has the notice inviting her own approval. No mail.
//   6. @myra approves it from the pass box, entering her password inline: "@myra approved".
//   7. Nothing locked: the thread, join and the claims stay; the feed lists it under passed.
//   8. /w/<path>/log lists every event of the run, each linked to its evidence.
// Each new page is checked as the page suite checks pages: no sideways scroll at 390–1280 px, no serious or critical
// axe findings at 390 and 1280 px.
//
// Run from apps/site: npm run test:e2e (CHROME_PATH=/path/to/chrome to pick a browser).
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetReadLimit } from '../../src/web/read-limit'
import { axeViolations, chrome, CHROMES, overflow } from './kit'
import { LOOP_PASSWORD, LOOP_PEOPLE, startLoopServer, type LoopPerson, type LoopServer } from './server'

declare const document: any

const TITLE = 'a doom map you can dig through'
const COMMIT = '9fceb02d0ae598e95dc970b74767f19372d61af8'
const PINS = `https://codeberg.org/submitter/dig-map ${COMMIT}\nipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/dig.pk3`
const EVIDENCE = 'the map loads in gzdoom; dug through and rebuilt five walls in 10 minutes of play, no crash. the source and the pk3 are pinned.'

// The steps run in order, each on the one before: the new shwarm's path and the passed claim's post id.
let path = ''
let claim = ''
let server: LoopServer
let browser: Browser
const pages = {} as Record<LoopPerson | 'out', Page>

/** Rows from the server's test database. */
const all = (sql: string, ...args: unknown[]): any[] => server.db.raw.prepare(sql).all(...args).map((r: any) => ({ ...r }))

/** Opens `path` as `who` and returns the response's status. */
async function open(who: LoopPerson | 'out', path: string): Promise<number | undefined> {
  const page = pages[who]
  await page.setViewportSize({ width: 1280, height: 900 })
  return (await page.goto(server.origin + path, { waitUntil: 'load' }))?.status()
}

/** Clicks something that sends a form, and waits for the page it lands on. */
async function send(page: Page, selector: string): Promise<URL> {
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.locator(selector).click()])
  return new URL(page.url())
}

/** The page suite's checks, on the page as it is now: nothing scrolls sideways, axe finds nothing serious. */
async function pageChecks(page: Page, what: string) {
  for (const width of [390, 640, 860, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const o = await overflow(page)
    expect(o.scrollWidth, `${what}: sideways scroll at ${width}px: ${o.wide.join(', ')}`).toBeLessThanOrEqual(o.innerWidth)
    if (width === 390 || width === 1280) expect(await axeViolations(page), `${what}: axe at ${width}px`).toEqual([])
  }
  await page.setViewportSize({ width: 1280, height: 900 })
}

/** Waits for the database to say so (triage answers after the redirect, in waitUntil). */
async function until(what: string, ok: () => boolean) {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise(r => setTimeout(r, 50))
  expect(ok(), what).toBe(true)
}

const runIt = chrome || process.env.CI ? describe : describe.skip

runIt('the whole loop, end to end (5.8)', () => {

  beforeAll(async () => {
    if (!chrome) throw new Error(`no Chrome found; set CHROME_PATH (looked in ${CHROMES.join(', ')})`)
    resetReadLimit()
    server = await startLoopServer()
    browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
    for (const who of [...LOOP_PEOPLE, 'out'] as const) {
      // bypassCSP lets axe run; the site's own scripts are same-origin and pass the CSP either way.
      const ctx = await browser.newContext({ bypassCSP: true, reducedMotion: 'reduce' })
      await ctx.route(url => !url.toString().startsWith(server.origin), r => r.abort())
      // Signed in: the session rides in a test header that the server sends on as the cookie, redirects included.
      if (who !== 'out') await ctx.setExtraHTTPHeaders({ 'x-e2e-session': server.sessions[who] })
      pages[who] = await ctx.newPage()
    }
  })

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  it('1. @myra starts a shwarm from /new; triage clears it', async () => {
    const my = pages.myra
    expect(await open('myra', '/new')).toBe(200)
    expect(await my.locator('#c-machine, #c-people, #c-author').count(), 'no checks box: the done test is the sentence').toBe(0)
    await my.fill('#title', TITLE)
    await my.fill('#pitch', 'a doom map where every wall can be dug out and placed again, so each run makes its own level.')
    await my.fill('#done', 'a map that loads in gzdoom where you can dig any wall and place it back, with no crash in 10 minutes of play.')
    await my.fill('#tags', '#games #gzdoom')
    expect(await my.locator('#seats').count(), 'no lobby size').toBe(0)
    await pageChecks(my, 'the create form')
    const landed = await send(my, '#go')
    expect(landed.pathname).toMatch(/^\/w\/a-doom-map-you-can-dig-through$/)
    path = landed.pathname.slice('/w/'.length)
    const node = () => all('SELECT state, triage FROM node WHERE path = ?', path)[0]
    expect(node()).toMatchObject({ state: 'live' })
    await until('triage clears the new shwarm', () => node().triage === 'clear')
    // public now: signed out, its status badge says on track, with join in the people card
    expect(await open('out', `/w/${path}`)).toBe(200)
    expect(await pages.out.locator('.head .st.vs').textContent()).toBe('on track')
    await open('myra', `/w/${path}`)
    expect(await my.locator('.late').textContent()).toContain("you're working on this shwarm.")
    expect(await my.locator('.hows').textContent()).toContain("how's it going?")
    await pageChecks(my, 'a new shwarm, to its author')
  })

  it('2. three people join it; it was live already', async () => {
    for (const who of ['submitter', 'checker', 'runner'] as const) {
      const page = pages[who]
      expect(await open(who, `/w/${path}`)).toBe(200)
      if (who === 'submitter') await pageChecks(page, 'a new shwarm, to someone not in it')
      // join opens the "say hi!" modal (go-live 8.2): focus moves into it, Esc closes it and focus goes back to the button
      const dialog = page.locator('#jn-scrim [role="dialog"]')
      await page.locator('.late .jn-open').click()
      expect(await dialog.isVisible()).toBe(true)
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('jn-hi')
      await page.keyboard.press('Escape')
      expect(await dialog.isVisible()).toBe(false)
      expect(await page.evaluate(() => !!document.activeElement?.closest('.late'))).toBe(true)
      // the head's join opens the same modal; the submitter says hi, the others join quietly
      await page.locator('#jn-state .jn-open').click()
      if (who === 'submitter') {
        await pageChecks(page, 'the say-hi modal')
        await page.fill('#jn-hi', "hi! i'm on the map itself, my agents too.")
      }
      const back = await send(page, '#jn-go')
      expect(back.pathname).toBe(`/w/${path}`)
      expect(await page.locator('#jn-state .joined').textContent()).toBe('✿ joined')
      if (who === 'submitter') expect(await page.locator('.c.jn-mine .jt').textContent()).toBe('✿ joined')
      else expect(await page.locator('#jn-row').textContent()).toContain(`@${who} joined`)
    }
    const seated = all('SELECT p.handle, s.number FROM seat s JOIN person p ON p.id = s.person_id JOIN node n ON n.id = s.node_id WHERE n.path = ? ORDER BY s.number', path)
    expect(seated).toEqual(LOOP_PEOPLE.map((handle, i) => ({ handle, number: i + 1 })))
  })

  it('3. @submitter says it passed: a passed claim from the people card, with the evidence and the work linked', async () => {
    const page = pages.submitter
    await open('submitter', `/w/${path}`)
    await page.locator('.hows a[href="#claim-passed"]').click()
    expect(await page.locator('#claim-passed').isVisible()).toBe(true)
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('cl-passed')
    expect(await page.locator('#claim-passed .hint').textContent()).toContain("a pass without them can't be checked later.")
    await pageChecks(page, 'the passed claim form, open')
    await page.fill('#cl-passed', EVIDENCE)
    await page.fill('#cl-passed-pins', PINS)
    const landed = await send(page, '#claim-passed button[type="submit"]')
    expect(landed.pathname).toBe(`/w/${path}`)
    claim = landed.hash.slice(1)
    expect(all('SELECT claim, links FROM post WHERE id = ?', claim)).toEqual([
      { claim: 'passed', links: JSON.stringify([{ repo: 'https://codeberg.org/submitter/dig-map', commit: COMMIT }, { ipfs: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/dig.pk3' }]) },
    ])
    const post = page.locator(`[id="${claim}"]`)
    expect(await post.locator('.ct.passed').textContent()).toBe('says passed')
    expect(await post.locator('.how.pins').textContent()).toContain('the work:')
    expect(await post.locator('.how.pins code.pin').textContent()).toContain('ipfs://bafy')
    expect(await page.locator('.hows .btn.on').textContent(), 'the claimant backs their own claim').toBe('passed')
    await pageChecks(page, 'the thread, with a passed claim')
  })

  it('4. @checker and @runner back the claim from the thread; the card says when the status changes at this rate', async () => {
    for (const who of ['checker', 'runner'] as const) {
      const page = pages[who]
      await open(who, `/w/${path}`)
      const landed = await send(page, `[id="${claim}"] .back-act button`)
      expect(landed.hash).toBe(`#${claim}`)
      expect(await page.locator(`[id="${claim}"] .back-act button`).getAttribute('aria-pressed')).toBe('true')
    }
    expect(all('SELECT COUNT(*) AS n FROM status_vote WHERE claim_id = ?', claim)[0].n).toBe(3)
    await open('out', `/w/${path}`)
    expect(await pages.out.locator('#people .chal').textContent()).toMatch(/^passed is ahead by 3\. at this rate, the status changes to passed in (1[0-6]) hours\.$/)
    expect(await pages.out.locator('.head .st.vs').textContent()).toBe('on track')
  })

  it("5. a day goes by: passed, the pass box with its record and the work, and @myra's notice inviting her approval", async () => {
    await server.passTime(path, 25)
    expect(all('SELECT h.from_status, h.to_status, h.claim_id, h.backers FROM status_change h JOIN node n ON n.id = h.node_id WHERE n.path = ?', path)).toEqual([
      { from_status: 'on_track', to_status: 'passed', claim_id: claim, backers: 3 },
    ])
    expect(await open('out', `/w/${path}`)).toBe(200)
    const box = pages.out.locator('#passed')
    expect(await pages.out.locator('.head .st.vs').textContent()).toBe('passed')
    expect(await box.locator('li.crowd').textContent()).toMatch(/^passed as of [a-z]{3} \d+ \d\d:\d\d · @submitter's passed claim · backed by 3the work:/)
    expect(await box.locator('code.pin').textContent()).toContain('ipfs://bafy')
    expect(await box.locator('details.passmark').count(), 'only the author marks it').toBe(0)
    await pageChecks(pages.out, 'a passed shwarm, signed out')
    // the notice: a system item in @myra's inbox, no mail
    expect(all("SELECT template FROM email_outbox WHERE json_extract(payload, '$.title') = ?", TITLE)).toEqual([])
    const myra = all("SELECT id FROM person WHERE handle = 'myra'")[0].id
    const item = all("SELECT id, text FROM inbox_item WHERE person_id = ? AND kind = 'system' AND post_id = ?", myra, claim)[0]
    expect(item.text).toBe(`${TITLE} passed: its people back a passed claim. approve it too?`) // stored naming no one
    await open('myra', '/@myra')
    const entry = pages.myra.locator(`#addressed ~ #i${item.id}`)
    expect(await entry.getAttribute('class')).toBe('c new')
    expect(await entry.locator('.txt').textContent()).toBe(`${TITLE} passed: its people back @submitter's passed claim. approve it too?`)
    expect(Number(await pages.myra.locator('.strip .me .n').textContent())).toBeGreaterThan(0)
    expect(await pages.myra.locator('.made li', { hasText: TITLE }).locator('.st').textContent()).toBe('passed')
    await pageChecks(pages.myra, 'the profile, with the notice')
    const opened = await send(pages.myra, `#i${item.id} .acts a:text-is("open")`)
    expect(opened.pathname + opened.hash).toBe(`/w/${path}#passed`)
  })

  it('6. @myra approves it from the pass box, with her password inline', async () => {
    const my = pages.myra
    await open('myra', `/w/${path}`)
    const mark = my.locator('#passed details.passmark')
    expect(await mark.getAttribute('open'), 'open while she has no record of her own').toBe('')
    expect(await mark.locator('select[name="post"] option').evaluateAll((o: any[]) => o.map(x => [x.value, x.selected]))).toEqual([[claim, true]])
    await pageChecks(my, 'the pass box, to its author')
    await my.fill('#m-pw', LOOP_PASSWORD)
    const landed = await send(my, '#passed details.passmark button[type="submit"]')
    expect(landed.pathname + landed.hash).toBe(`/w/${path}#passed`)
    expect(all("SELECT r.kind, r.claim_id, r.by_name FROM pass_record r JOIN node n ON n.id = r.node_id WHERE n.path = ? ORDER BY r.at, r.rowid", path)).toEqual([
      { kind: 'crowd', claim_id: claim, by_name: null },
      { kind: 'author', claim_id: claim, by_name: '@myra' },
    ])
    expect(await my.locator('#passed li.author').textContent()).toMatch(/^@myra approved · [a-z]{3} \d+ \d\d:\d\d · citing @submitter's claim/)
    // "✓ author approved" beside the badge in the head, apart from it (decided Oct 15)
    expect(await my.locator('.head .state .badges a.approved').textContent()).toBe('✓ author approved')
    expect(await my.locator('.head .state .badges .st.vs').textContent()).toBe('passed')
    expect(await my.locator('#passed details.passmark').getAttribute('open'), 'folded once she has one').toBeNull()
    // her notice is answered: read and done
    const myraId = all("SELECT id FROM person WHERE handle = 'myra'")[0].id
    expect(all("SELECT read_at IS NOT NULL AS r, done_at IS NOT NULL AS d FROM inbox_item WHERE kind = 'system' AND post_id = ? AND person_id = ?", claim, myraId)).toEqual([{ r: 1, d: 1 }])
    // the others' status-change notices (#138, decided Oct 15) stay theirs: her approval doesn't mark them done
    const others = all("SELECT done_at IS NOT NULL AS d FROM inbox_item WHERE kind = 'system' AND post_id = ? AND person_id <> ?", claim, myraId)
    expect(others.length).toBeGreaterThan(0)
    expect(others.every((o: { d: number }) => o.d === 0)).toBe(true)
  })

  it('7. nothing locked: the thread, join and the claims stay; the feed lists it under passed', async () => {
    await open('checker', `/w/${path}`)
    expect(await pages.checker.locator('form.compose').count()).toBe(1)
    expect(await pages.checker.locator('.hows').count()).toBe(1)
    await open('out', `/w/${path}`)
    expect(await pages.out.locator('#jn-state a.btn').textContent()).toBe('join')
    expect(await pages.out.locator('.alt a').textContent()).toBe('build on this shwarm')
    expect(await open('out', '/?tab=passed')).toBe(200)
    expect(await pages.out.locator('.feed li', { hasText: TITLE }).locator('.st.vs').textContent()).toBe('passed')
    await pageChecks(pages.out, 'the passed tab')
  })

  it('8. /w/<path>/log lists every event of the run, each linked to its evidence', async () => {
    const res = await pages.out.request.get(`${server.origin}/w/${path}/log?filter=all`)
    expect(res.status()).toBe(200)
    const log = (await res.json()) as { total: number; events: { id: string; event: string; by: string | null; evidence: string }[] }
    const stored = all('SELECT a.id FROM audit_event a JOIN node n ON n.id = a.node_id WHERE n.path = ?', path)
    expect(log.total).toBe(stored.length)
    // newest first: @myra's mark, then its people's pass
    expect(log.events.filter(e => e.event === 'passed').map(e => e.by)).toEqual(['@myra', null])
    for (const e of log.events) {
      const [at, anchor] = e.evidence.slice(server.origin.length).split('#')
      expect(await open('out', at), e.evidence).toBe(200)
      if (anchor) expect(await pages.out.locator(`[id="${anchor}"]`).count(), e.evidence).toBe(1)
    }
  })
})
