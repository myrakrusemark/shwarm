// The branch page's people card, status badge and claims (decided Oct 14, "One card for a node's people, status and
// joining" and "A branch's status: on track by vote, the rest by claims people back, with a rubber band"): what the card
// shows signed out, not joined and joined, the claim forms with no script needed, a claim's tag and "back" in the
// thread, the challenger line, and the parent's list. The acts behind the forms are test/status-vote.test.ts; a
// shwarm's card, pinned work and the pass box are test/pass-box.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { NOT_JOINED } from '../src/core/status'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { challengerText } from '../src/render/prompt'
import { challengerLine } from '../src/web/node-page'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { HOUR, person, site, World, type P } from './core-fixtures'
import { T0 } from './d1'

const MID = 'minecraft-in-doom'
const BP = 'minecraft-in-doom/block-placement'
const EVIDENCE = 'P_CheckSight still answers for the old block after a break.'

let w: World
let myra: P, finn: P, lumpy: P, kestrel: P, ana: P
let claimId: string

beforeEach(async () => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  resetReadLimit()
  forgetVersions()
  w = new World()
  myra = await person(w.db, 'myra')
  finn = await person(w.db, 'finn_irl')
  lumpy = await person(w.db, 'lumpy')
  kestrel = await person(w.db, 'kestrel')
  ana = await person(w.db, 'ana')
  await w.shwarm(site(myra))
  await w.branch(site(myra), MID)
  w.db.raw.prepare("UPDATE node SET triage = 'clear'").run()
  for (const p of [finn, lumpy, kestrel]) await w.join(site(p), BP)
  claimId = (await w.post(site(finn), BP, EVIDENCE, { claim: 'blocked' })).id
  await w.run({ type: 'back', actor: site(lumpy), input: { node: BP, post: claimId, on: true } })
  vi.setSystemTime(w.now)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function member(p: P) {
  w.db.raw.prepare('UPDATE person SET password_hash = ? WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), p.id)
  const b = new Browser(testEnv(w.db))
  expect((await b.post('/signin', { email: `${p.handle}@example.org`, password: GOOD_PASSWORD })).status).toBe(303)
  return b
}
const page = async (b: Browser, path = BP) => body(await b.req(`/w/${path}`, { headers: { accept: 'text/html' } }))
const part = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)))
const card = (html: string) => part(html, '<div class="box people" id="people">', '<div class="box"><h2>sub-branches')

describe('the people card on a branch', () => {
  it('signed out: the heading, no badge while there is no status, the challenger line, join through sign-in and the url for an agent', async () => {
    const html = await page(new Browser(testEnv(w.db)))
    const c = card(html)
    // no status yet (decided Oct 17): no badge, so no panel; the challenger line (2 blocked over nothing: 24 hours) in the card
    expect(c).toMatch(/^<div class="box people" id="people"><div class="ph"><h2 class="sunny">on this branch<\/h2><\/div><div class="in"><p class="chal">blocked is ahead by 2\. at this rate, the status changes to blocked in 24 hours\.<\/p>/)
    expect(c).not.toContain('vote-badge')
    expect(c).toContain(`<p class="join"><a class="btn plain" href="/signin?next=%2Fw%2F${encodeURIComponent(BP)}">join</a></p>`)
    expect(c).toContain(`<p class="note">or give your agent this branch's url:</p><div class="url"><code id="w-url">`)
    expect(c).not.toContain('press "join"')
    expect(c).toContain('when the branch meets its done test, post a passed claim with your evidence and link the work.')
    expect(c).not.toContain(`how's it going?`)
    // the head: no badge either while there's no status; no "checked by" and no submit form on a branch
    expect(part(html, '<div class="state">', '</section>')).not.toContain('aria-controls="vb-head"')
    expect(html).not.toContain('<h3>checked by</h3>')
    expect(html).not.toContain('submit work against the done test')
    // the old boxes are gone
    for (const gone of ['class="box you"', 'status-vote', '>contribute<', 'class="vote"']) expect(html).not.toContain(gone)
  })

  it('a claim in the thread: its tag after the name, its backers, and why there is no button', async () => {
    const html = await page(new Browser(testEnv(w.db)))
    const post = part(html, `<div class="c" id="${claimId}">`, '</div></div>')
    expect(post).toContain('<b><a href="/@finn_irl">@finn_irl</a></b><span class="ct blocked">says blocked</span>')
    expect(post).toContain('<span class="up" title="join this branch to back its claims">2 backers</span>')
  })

  it('verified but not joined: join, the url and the steps; a claim shows only its count', async () => {
    const html = await page(await member(ana))
    const c = card(html)
    expect(c).toContain('<button class="btn plain jn-open" type="submit">join</button>')
    expect(c).toContain(`or give your agent this branch's url:`)
    expect(c).not.toContain('class="hows"')
    expect(html).toContain('title="join this branch to back its claims">2 backers</span>')
  })

  it('joined: the on-track toggle, three claim forms that open without script, and the claim they back', async () => {
    const b = await member(lumpy)
    const html = await page(b)
    const c = card(html)
    expect(c).toContain("<b>you're working on this branch.</b>")
    expect(c).not.toContain('or give your agent')
    expect(c).toContain(`<p class="note"><b>how's it going?</b></p>`)
    expect(c).toContain(
      '<button class="btn plain" type="submit" name="status" value="on_track" aria-pressed="false" title="vote on track">on track</button>',
    )
    // lumpy backs finn's blocked claim: that button is the yellow one, and the claim is named
    expect(c).toContain('<a class="btn on" href="#claim-blocked" aria-controls="claim-blocked">blocked</a>')
    expect(c).toContain('<a class="btn plain" href="#claim-passed" aria-controls="claim-passed">passed</a>')
    expect(c).toContain(`you back <a href="#${claimId}">@finn_irl's blocked claim</a>.`)
    for (const [claim, ask, vote] of [
      ['blocked', 'what is this branch waiting on?', 'vote blocked'],
      ['passed', 'what shows this branch passes its done test?', 'vote passed'],
      ['dead_end', 'why does the work stop here?', 'vote dead end'],
    ]) {
      const f = part(c, `<form id="claim-${claim}"`, '</form>')
      expect(f).toContain(`class="claim-act" method="post" action="/w/${BP}"`)
      expect(f).toContain(`<input type="hidden" name="do" value="claim"/><input type="hidden" name="status" value="${claim}"/>`)
      expect(f).toContain(`<label for="cl-${claim}">${ask}</label>`)
      expect(f).toContain('posts to the thread as @lumpy.')
      expect(f).toContain(`<a href="#status" class="cancel">cancel</a><button class="btn" type="submit">${vote}</button>`)
    }
    // in the thread: "back", pressed, since lumpy backs it
    expect(html).toContain('<button type="submit" class="up on" aria-pressed="true" title="take your backing off">▲ back</button></form> · 2 backers')
  })

  it("the claimant's own claim: delete, never edit; on track pressed after a vote takes the backing back", async () => {
    const b = await member(finn)
    let html = await page(b)
    const post = part(html, `<div class="c" id="${claimId}">`, '</main>')
    expect(post).toContain('<summary>delete</summary>')
    expect(post).not.toContain('<summary>edit</summary>')
    await w.run({ type: 'status', actor: site(finn), input: { node: BP, status: 'on_track' } })
    html = await page(b)
    expect(card(html)).toContain('<button class="btn on" type="submit" name="status" value="" aria-pressed="true" title="take back your on-track vote">on track</button>')
    expect(card(html)).not.toContain('you back')
    expect(html).toContain('<button type="submit" class="up" aria-pressed="false" title="back this claim: your vote for its status">▲ back</button></form> · 1 backer')
  })

  it('a refused claim opens its form again with the words kept; a refused vote says why under the buttons', async () => {
    const b = await member(kestrel)
    const empty = await b.req(`/w/${BP}`, { form: { form_token: formTokenIn(await page(b)), do: 'claim', status: 'passed', text: '  ' } })
    expect(empty.status).toBe(400)
    const html = await body(empty)
    expect(part(html, '<form id="claim-passed"', '</form>')).toMatch(/class="claim-act open"[\s\S]*autofocus=""[\s\S]*<p class="err" role="alert">write something first\.<\/p>/)
    expect(part(html, '<form id="claim-blocked"', '</form>')).toContain('class="claim-act"')
    // someone not on the branch who posts the form anyway gets the reason at the top: they have no card form
    const a = await member(ana)
    const r = await a.req(`/w/${BP}`, { form: { form_token: formTokenIn(await page(a)), do: 'status', status: 'on_track' } })
    expect(r.status).toBe(400)
    expect(await body(r)).toContain(`<p class="err flash" role="alert">${NOT_JOINED}.</p>`)
  })

  it('"+ n more" past five people: a link to /people, and the modal that loads it', async () => {
    let html = await page(new Browser(testEnv(w.db)))
    expect(html).not.toContain('id="pp-open"')
    expect(html).not.toContain('id="pp-scrim"')
    for (const h of ['oriel', 'pax', 'quill', 'tamsin']) await w.join(site(await person(w.db, h)), BP)
    html = await page(new Browser(testEnv(w.db)))
    expect(card(html)).toMatch(new RegExp(`<a class="more-people" id="pp-open" href="/w/${BP}/people">\\+ \\d more</a>`))
    expect(html).toContain(`<div class="dn pp" role="dialog" aria-modal="true" aria-labelledby="pp-title" data-src="/w/${BP}/people?format=json">`)
    expect(html).toContain('<h2 id="pp-title"><span>on this branch</span><button type="button" id="pp-close" aria-label="close">×</button></h2>')
  })
})

describe("the parent's list of branches", () => {
  it('shows each live branch with its status badge, none while it has no status, and once it changed, the evidence behind it', async () => {
    let html = await page(new Browser(testEnv(w.db)), MID)
    const item = () => part(html, '<a href="/w/minecraft-in-doom/block-placement">', '<div class="in" style')
    expect(item()).not.toContain('vote-badge')
    expect(item()).not.toContain(EVIDENCE)
    w.tick(25 * HOUR)
    vi.setSystemTime(w.now)
    forgetVersions()
    html = await page(new Browser(testEnv(w.db)), MID)
    expect(item()).toContain('<button type="button" class="st vs blocked"')
    expect(item()).toContain(EVIDENCE)
  })
})

describe('the challenger line', () => {
  const at = (h: number) => new Date(T0 + h * HOUR).toISOString()
  const s = (challenger: object | null) =>
    ({ current: 'on_track', changed_at: null, backing: { on_track: 1, blocked: 0, passed: 3, dead_end: 0, people: 4 }, challenger }) as never
  it('counts down in whole hours, says what a lead under 2 still needs, and says nothing when no other status leads', () => {
    expect(challengerLine(s({ status: 'passed', lead: 4, lead_hours: 12, changes_at: at(9.2), needs: null }), T0)).toBe('passed is ahead by 4. at this rate, the status changes to passed in 9 hours.')
    expect(challengerLine(s({ status: 'passed', lead: 2, lead_hours: 47, changes_at: at(1), needs: null }), T0)).toBe('passed is ahead by 2. at this rate, the status changes to passed in 1 hour.')
    expect(challengerLine(s({ status: 'passed', lead: 2, lead_hours: 47.9, changes_at: at(0.4), needs: null }), T0)).toBe('passed is ahead by 2. at this rate, the status changes to passed in under an hour.')
    expect(challengerLine(s({ status: 'passed', lead: 1, lead_hours: 0, changes_at: null, needs: 1 }), T0)).toBe('passed is ahead by 1. passed needs a lead of 2 to start counting.')
    expect(challengerLine(s({ status: 'passed', lead: 0, lead_hours: 0, changes_at: null, needs: 2 }), T0)).toBeNull()
    expect(challengerLine(s(null), T0)).toBeNull()
  })

  it('rounds down as the briefing does, so a copy cached within the hour never says more time is left', () => {
    const ahead = s({ status: 'passed', lead: 2, lead_hours: 44.8, changes_at: at(1.6), needs: null })
    expect(challengerLine(ahead, T0)).toBe('passed is ahead by 2. at this rate, the status changes to passed in 1 hour.')
    expect(challengerText(ahead, T0)).toContain('the status changes to passed in 1 hour (')
    expect(challengerLine(ahead, T0 + 0.7 * HOUR)).toBe('passed is ahead by 2. at this rate, the status changes to passed in under an hour.')
  })
})
