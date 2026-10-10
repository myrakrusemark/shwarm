// The whole loop, end to end (go-live 5.8): four accounts in a real Chrome, through the real pages, from an empty
// create form to the result page.
//   1. @myra starts a shwarm on /new: one run, one human people check, and her own sign-off. It's live at once (no
//      lobby, decided Oct 9). Triage clears it.
//   2. @submitter, @checker and @runner join it ("working on it"); nothing waits on them.
//   3. @submitter submits from the compose box's submit mode and lands on submission #1.
//   4. @runner's agent posts a passing run report, through core (signed `shwarm run` reports come in phase 7; 7.10
//      repeats this loop with them).
//   5. @checker posts a people check through the check form. That is the last check before the author's, so @myra
//      gets the sign_off inbox item and its mail in the same batch: the item appears in the inbox on her profile
//      ("waiting on you", "for you" counts it, "open" goes to the submission), and the node and the submission say
//      "waiting on you" to her. Nobody else sees it.
//   6. @myra passes it from the sign-off box, entering her password inline; the item's pill says "approved".
//   7. The shwarm's address now shows the result page, and /w/<path>/log lists every event of the run.
// Each new page is checked as the page suite checks pages: no sideways scroll at 390–1280 px, no serious or critical
// axe findings at 390 and 1280 px.
//
// Run from apps/site: npm run test:e2e (CHROME_PATH=/path/to/chrome to pick a browser).
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetReadLimit } from '../../src/web/read-limit'
import { axeViolations, chrome, CHROMES, overflow } from './kit'
import { LOOP_PASSWORD, LOOP_PEOPLE, startLoopServer, type LoopPerson, type LoopServer } from './server'

const TITLE = 'a doom map you can dig through'
const WORK = `https://codeberg.org/submitter/dig-map/releases/download/v1/dig.pk3 ${'3f'.repeat(32)}`
const EVIDENCE = `https://archive.org/download/dig-map-checks/played.mp4 ${'2d'.repeat(32)}`

// The steps run in order, each on the one before: the new shwarm's path and its submission's post id.
let path = ''
let sub = ''
let server: LoopServer
let browser: Browser
const pages = {} as Record<LoopPerson | 'out', Page>

/** Rows from the server's test database. */
const all = (sql: string, ...args: unknown[]): any[] => server.db.raw.prepare(sql).all(...args).map((r: any) => ({ ...r }))

/** This shwarm's sign_off inbox items, and its "ready for your sign-off" mails (the seeded example has its own). */
const signOffItems = () => all("SELECT i.person_id, i.post_id, i.done_at FROM inbox_item i JOIN node n ON n.id = i.node_id WHERE i.kind = 'sign_off' AND n.path = ?", path)
const signOffMails = () => all("SELECT person_id, stream, payload FROM email_outbox WHERE template = 'sign_off_ready' AND json_extract(payload, '$.title') = ?", TITLE)

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
    await my.fill('#title', TITLE)
    await my.fill('#pitch', 'a doom map where every wall can be dug out and placed again, so each run makes its own level.')
    await my.fill('#done', 'a map that loads in gzdoom where you can dig any wall and place it back, with no crash in 10 minutes of play.')
    await my.check('#c-machine')
    await my.fill('#cmd', './check.sh')
    await my.fill('#n-runs', '1')
    await my.check('#c-people')
    await my.fill('#n-people', '1')
    await my.check('#human')
    expect(await my.isChecked('#c-author'), 'the author check is on by default').toBe(true)
    await my.fill('#tags', '#games #gzdoom')
    expect(await my.locator('#seats').count(), 'no lobby size').toBe(0)
    const landed = await send(my, '#go')
    expect(landed.pathname).toMatch(/^\/w\/a-doom-map-you-can-dig-through$/)
    path = landed.pathname.slice('/w/'.length)
    const node = () => all('SELECT state, triage, author_id, checks FROM node WHERE path = ?', path)[0]
    expect(node()).toMatchObject({ state: 'live' })
    expect(JSON.parse(node().checks)).toEqual({ runs: { command: './check.sh', count: 1 }, people: { count: 1, human: true }, author: true })
    await until('triage clears the new shwarm', () => node().triage === 'clear')
    // public now: signed out, it shows live, with join under its contributors
    expect(await open('out', `/w/${path}`)).toBe(200)
    expect(await pages.out.locator('.head .st').textContent()).toContain('live')
    await open('myra', `/w/${path}`)
    expect(await my.locator('.late').textContent()).toContain("you're working on this.")
    await pageChecks(my, 'a new shwarm, to its author')
  })

  it('2. three people join it; it was live already', async () => {
    for (const who of ['submitter', 'checker', 'runner'] as const) {
      const page = pages[who]
      expect(await open(who, `/w/${path}`)).toBe(200)
      if (who === 'submitter') await pageChecks(page, 'a new shwarm, to someone not in it')
      const back = await send(page, '.late form.seat-act button')
      expect(back.pathname).toBe(`/w/${path}`)
    }
    expect(all('SELECT state FROM node WHERE path = ?', path)[0].state).toBe('live')
    const seated = all('SELECT p.handle, s.number FROM seat s JOIN person p ON p.id = s.person_id JOIN node n ON n.id = s.node_id WHERE n.path = ? ORDER BY s.number', path)
    expect(seated).toEqual(LOOP_PEOPLE.map((handle, i) => ({ handle, number: i + 1 })))
  })

  it('3. @submitter submits from the compose box and lands on submission #1', async () => {
    const page = pages.submitter
    await open('submitter', `/w/${path}`)
    await page.locator('details.submit summary').click()
    await pageChecks(page, 'the live shwarm, submit mode open')
    await page.fill('form.compose textarea[name="text"]', 'the map: 64 chunks, every wall diggable. walls you place go back in the blockmap.')
    await page.fill('#s-links', WORK)
    await page.fill('#s-how', 'run ./check.sh, then play 10 minutes: dig through three walls and place them back. expect no crash.')
    const landed = await send(page, 'button[name="do"][value="submit"]')
    expect(landed.pathname).toBe(`/w/${path}/s/1`)
    expect(await page.locator('.strip .me .h').textContent(), 'still signed in after the redirect').toBe('@submitter')
    const row = all("SELECT s.post_id, s.status FROM submission s JOIN node n ON n.id = s.node_id WHERE n.path = ? AND s.number = 1", path)[0]
    expect(row.status).toBe('in_review')
    sub = row.post_id
    expect(await page.locator('#status').textContent()).toBe('in review')
    expect(await page.locator('#check').textContent()).toContain("you can't check it: it's yours.")
    await pageChecks(page, 'the submission, to its submitter')
  })

  it("4. @runner's agent posts a passing run report, through core", async () => {
    const r = await server.runReport(path, 1, 'runner')
    expect(r).toMatchObject({ slot: 'run', verdict: 'pass', submission_state: 'in_review', node_state: 'live' })
    // nothing waits on the author yet: the people check is still out
    expect(signOffItems()).toEqual([])
    expect(signOffMails()).toEqual([])
    await open('runner', `/w/${path}/s/1`)
    expect(await pages.runner.locator('#check').textContent()).toContain('you have a check on it already.')
  })

  it("5. @checker's people check is the last before the author's: @myra's inbox item, her mail, \"waiting on you\"", async () => {
    const page = pages.checker
    expect(await open('checker', `/w/${path}/s/1`)).toBe(200)
    await pageChecks(page, 'the submission, with the check form')
    await page.locator('#check input[name="verdict"][value="pass"]').check()
    await page.fill('#k-text', 'played 10 minutes, dug through five walls and put them back. no crash.')
    await page.fill('#k-links', EVIDENCE)
    const landed = await send(page, '#check button[type="submit"]')
    expect(landed.pathname).toBe(`/w/${path}/s/1`)
    const mine = all("SELECT c.id, c.slot, c.verdict FROM check_report c JOIN post p ON p.id = c.post_id WHERE p.as_name = '@checker'")
    expect(mine).toEqual([{ id: landed.hash.slice(1), slot: 'people', verdict: 'pass' }])

    // the sign_off item in @myra's inbox, and the "ready for your sign-off" mail, from the same batch
    const myra = all("SELECT id FROM person WHERE handle = 'myra'")[0].id
    expect(signOffItems()).toEqual([{ person_id: myra, post_id: sub, done_at: null }])
    const mail = signOffMails()
    expect(mail).toHaveLength(1)
    expect(mail[0]).toMatchObject({ person_id: myra, stream: 'notices' })
    expect(JSON.parse(mail[0].payload)).toMatchObject({ notice: 'sign_off', handle: 'myra', number: 1, title: TITLE, link: `/w/${path}/s/1` })

    // the item on @myra's inbox page (6.1): new, waiting on her, counted in "for you", and it opens the submission
    const item = all("SELECT i.id FROM inbox_item i WHERE i.kind = 'sign_off' AND i.post_id = ?", sub)[0].id
    await open('myra', '/@myra')
    const entry = pages.myra.locator(`#addressed ~ #i${item}`)
    expect(await entry.getAttribute('class')).toBe('c new signoff')
    expect(await entry.locator('.stp').textContent()).toBe('waiting on you')
    expect(await entry.textContent()).toContain(`${TITLE} · submission #1 by @submitter passed its other checks and needs your sign-off.`)
    expect(Number(await pages.myra.locator('.strip .me .n').textContent())).toBeGreaterThan(0)
    expect(await pages.myra.locator('.made li', { hasText: TITLE }).locator('.st').textContent()).toBe('waiting on you')
    await pageChecks(pages.myra, 'the profile, with the inbox')
    const opened = await send(pages.myra, `#i${item} .acts a:text-is("open")`)
    expect(opened.pathname).toBe(`/w/${path}/s/1`)
    // nobody else sees it
    for (const who of ['checker', 'out'] as const) {
      await open(who, '/@myra')
      expect(await pages[who].locator('#addressed').count(), who).toBe(0)
      expect(await pages[who].getByText('waiting on you').count(), who).toBe(0)
    }

    // "waiting on you" to the author, on the node and on the submission; "waiting on author" to everyone else
    await open('myra', `/w/${path}`)
    expect(await pages.myra.locator('.stat').textContent()).toContain('waiting on you')
    await open('out', `/w/${path}`)
    expect(await pages.out.locator('.stat').textContent()).toContain('waiting on author')
    await open('myra', `/w/${path}/s/1`)
    expect(await pages.myra.locator('#status').textContent()).toBe('waiting on you')
    expect(await pages.myra.locator('#decide').isVisible()).toBe(true)
    await pageChecks(pages.myra, 'the submission, with the sign-off box')
  })

  it('6. @myra passes it from the sign-off box, with her password inline', async () => {
    const my = pages.myra
    await open('myra', `/w/${path}/s/1`)
    await my.locator('label[for="pick-pass"]').click()
    await my.fill('#f-pass textarea[name="text"]', 'dug through the whole first room and rebuilt it. it is what we wanted.')
    await my.fill('#pw-pass', LOOP_PASSWORD)
    const landed = await send(my, '#f-pass button[type="submit"]')
    expect(landed.pathname + landed.hash).toBe(`/w/${path}/s/1#checks`)
    expect(all('SELECT status FROM submission WHERE post_id = ?', sub)[0].status).toBe('passed')
    expect(all('SELECT state FROM node WHERE path = ?', path)[0].state).toBe('closed')
    expect(await my.locator('#status').textContent()).toBe('approved')
    // the inbox item is done, and its pill says so
    expect(signOffItems()[0].done_at).not.toBeNull()
    await open('myra', '/@myra')
    expect(await my.locator('#addressed ~ .c.signoff', { hasText: TITLE }).locator('.stp').textContent()).toBe('approved')
  })

  it("7. the shwarm's address is its result page", async () => {
    for (const who of ['out', 'myra'] as const) {
      expect(await open(who, `/w/${path}`)).toBe(200)
      const page = pages[who]
      expect(await page.locator('.donebadge').textContent()).toContain('✓ done')
      expect(await page.locator('.box.result h2').textContent()).toContain('submission #1, the version that passed')
      expect(await page.locator('.box.result .src').textContent()).toContain('@submitter')
      await pageChecks(page, `the result page, signed ${who === 'out' ? 'out' : 'in'}`)
    }
    // The log box at 1280 px (review fix, Oct 9): its key events are the submission and the pass, and each name and
    // "submission #1" sits on one line, not broken mid-word, even beside a long detail such as a dead end's note (one is
    // put in the page here, since this run has no dead end).
    const log = pages.out.locator('table.log')
    expect(await log.locator('td:nth-child(2)').allTextContents()).toEqual(['submission', 'passed'])
    expect(await pages.out.locator('.log-box .foot .note').textContent()).toContain('filter: key events')
    await log.locator('td:last-child a').first().evaluate((a: any) => {
      a.textContent = "uzdoom's savegame format can't hold per-block state without forking the engine. the mod keeps chunks in memory for now."
    })
    const lines = await log.locator('td.by').evaluateAll((tds: any[]) =>
      tds.map(td => {
        const r = td.ownerDocument.createRange()
        r.selectNodeContents(td)
        return [td.textContent, new Set([...r.getClientRects()].map((x: any) => Math.round(x.top))).size]
      }),
    )
    expect(lines).toEqual([['@submitter', 1], ['submission #1', 1]])
  })

  it('8. /w/<path>/log lists every event of the run, each linked to its evidence', async () => {
    const res = await pages.out.request.get(`${server.origin}/w/${path}/log?filter=all`)
    expect(res.status()).toBe(200)
    const log = (await res.json()) as { total: number; events: { id: string; event: string; by: string | null; number?: number; evidence: string }[] }
    const stored = all('SELECT a.id, a.event FROM audit_event a JOIN node n ON n.id = a.node_id WHERE n.path = ?', path)
    expect(log.total).toBe(stored.length)
    expect(new Set(log.events.map(e => e.id))).toEqual(new Set(stored.map(e => e.id)))
    // newest first: the pass, the sign-off, the two checks, the submission (no kickoff: no lobby)
    expect(log.events.map(e => [e.event, e.by])).toEqual([
      ['passed', null],
      ['signed_off', '@myra'],
      ['check', '@checker'],
      ['check', '@runner/r-01'],
      ['submission', '@submitter'],
    ])
    for (const e of log.events) {
      const [at, anchor] = e.evidence.slice(server.origin.length).split('#')
      expect(await open('out', at), e.evidence).toBe(200)
      if (anchor) expect(await pages.out.locator(`[id="${anchor}"]`).count(), e.evidence).toBe(1)
    }
  })
})
