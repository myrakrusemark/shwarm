// The Oct 15 answers (decided Oct 15, the five newest entries in docs/decisions.md), in core and the read model:
//   * a passed node's claim is pinned to the top of its thread when its people pass it, as the site's pin, and the site
//     unpins it when the status moves away from passed, unless the author pinned it again by hand;
//   * every status change puts a notice in the inbox of everyone who joined the node (#138), once, with no mail; the
//     shwarm's author gets the "approve it too?" notice in its place on a pass;
//   * everything posted here is MIT: a create's license is ignored, building on passes none on, an old license is a
//     note about the work (`work_license`);
//   * the author's own approval, `author_approved`, apart from the status.
import { beforeEach, describe, expect, it } from 'vitest'
import { workLicense } from '../src/core/nodes'
import { statusLine } from '../src/core/stats'
import { rollupStats } from '../src/jobs/stats'
import { loadFeed } from '../src/read/feed'
import { readInbox } from '../src/read/inbox'
import { FORMER } from '../src/read/names'
import { readChain, readWorkRepo } from '../src/read/node'
import { loadAgentView } from '../src/read/views'
import { renderNodeJson, renderPrompt } from '../src/render/prompt'
import { loadStatus, PASS_BOX } from '../src/read/status'
import { DAY, HOUR, person, site, stepped, World, type P } from './core-fixtures'
import { T0 } from './d1'

const MID = 'minecraft-in-doom'
const BP = 'minecraft-in-doom/block-placement'

let w: World
let myra: P, kestrel: P, lumpy: P, ana: P, bo: P

const at = (h: number) => new Date(T0 + h * HOUR).toISOString()
const claim = (by: P, node: string, status: string, text = 'all nine maps from a pistol start.') => w.run({ type: 'post', actor: site(by), input: { node, text, claim: status } })
const back = (by: P, node: string, post: string, on = true) => w.run({ type: 'back', actor: site(by), input: { node, post, on } })
const vote = (by: P, node: string, status: unknown) => w.run({ type: 'status', actor: site(by), input: { node, status } })
const pin = (by: P, node: string, post: string, on: boolean) => w.run({ type: 'pinPost', actor: site(by), input: { node, post, pin: on } })
const pinned = (path: string) => w.all('SELECT p.id, p.pinned_at, p.pinned_by FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.pinned_at IS NOT NULL ORDER BY p.id', path)
const notices = (path: string) =>
  w.all(
    "SELECT pr.handle, i.post_id, i.status_to, i.text FROM inbox_item i JOIN person pr ON pr.id = i.person_id JOIN node n ON n.id = i.node_id WHERE i.kind = 'system' AND n.path = ? ORDER BY i.id",
    path,
  )

beforeEach(async () => {
  w = new World()
  myra = await person(w.db, 'myra')
  kestrel = await person(w.db, 'kestrel')
  lumpy = await person(w.db, 'lumpy')
  ana = await person(w.db, 'ana')
  bo = await person(w.db, 'bo')
  await w.shwarm(site(myra))
  await w.branch(site(myra), MID)
  await w.join(site(kestrel), BP) // counted on the shwarm too, through its branch
  await w.join(site(lumpy), BP)
  w.db.raw.prepare("UPDATE node SET triage = 'clear'").run()
})

/** kestrel's passed claim on the shwarm, backed by lumpy: passed leads on track by 2, so it passes at hour 24. */
async function passAtDay() {
  const c = await claim(kestrel, MID, 'passed')
  await back(lumpy, MID, c.id)
  w.tick(25 * HOUR)
  await w.join(site(ana), MID)
  await vote(ana, MID, 'on_track') // the next act saves the change at hour 24
  return c.id as string
}

/** ana's blocked claim, backed by myra and lumpy (moving off the passed claim): blocked leads by 2, so it changes a day on. */
async function blockAfter() {
  const b = await claim(ana, MID, 'blocked', 'e1m3 softlocks after the red key.')
  await back(myra, MID, b.id)
  await back(lumpy, MID, b.id)
  w.tick(DAY)
  await vote(kestrel, MID, 'on_track')
  return b.id as string
}

describe('the claim a pass cites is pinned to the top of the thread (decided Oct 15)', () => {
  it('pinned as the site\'s pin when the people pass the node, and its first line is the status line', async () => {
    const c = await passAtDay()
    expect(pinned(MID)).toEqual([{ id: c, pinned_at: at(24), pinned_by: 'site' }])
    await rollupStats(w.db, w.now)
    expect(w.get('SELECT status_line FROM node_stats WHERE node_id = ?', w.node(MID).id).status_line).toBe('all nine maps from a pistol start.')
    // the author's own approval pins nothing more
    w.tick(HOUR)
    await w.run({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: c } })
    expect(pinned(MID)).toEqual([{ id: c, pinned_at: at(24), pinned_by: 'site' }])
  })

  it('unpinned when the status moves away from passed; the old record stays', async () => {
    const c = await passAtDay()
    const b = await blockAfter()
    expect(w.all('SELECT to_status FROM status_change ORDER BY at').map(r => r.to_status)).toEqual(['passed', 'blocked'])
    expect(pinned(MID)).toEqual([])
    expect(w.all('SELECT claim_id FROM pass_record')).toEqual([{ claim_id: c }])
    await rollupStats(w.db, w.now)
    expect(w.get('SELECT status_line FROM node_stats WHERE node_id = ?', w.node(MID).id).status_line).toBe('e1m3 softlocks after the red key.')
    expect(b).toBeTruthy()
  })

  it('a claim the author pinned again by hand stays pinned, and so does one they had pinned before the pass', async () => {
    const c = await passAtDay()
    await pin(myra, MID, c, false)
    await pin(myra, MID, c, true) // by hand now: the author's pin
    expect(pinned(MID)).toEqual([{ id: c, pinned_at: w.get('SELECT pinned_at FROM post WHERE id = ?', c).pinned_at, pinned_by: null }])
    await blockAfter()
    expect(pinned(MID).map(p => [p.id, p.pinned_by])).toEqual([[c, null]])
    // the status line is the current status's, not a pinned claim of another status
    await rollupStats(w.db, w.now)
    expect(w.get('SELECT status_line FROM node_stats WHERE node_id = ?', w.node(MID).id).status_line).toBe('e1m3 softlocks after the red key.')
  })

  it('"pin" on the site\'s pin makes it the author\'s, so it stays', async () => {
    const c = await passAtDay()
    await pin(myra, MID, c, true)
    expect(pinned(MID)).toEqual([{ id: c, pinned_at: at(24), pinned_by: null }])
    await blockAfter()
    expect(pinned(MID).map(p => p.id)).toEqual([c])
  })

  it('on a branch too; a claim pinned before the pass is left as it was', async () => {
    const c = await claim(kestrel, BP, 'passed', 'all four corners hold.')
    await pin(myra, BP, c.id, true) // the branch's author pinned it already
    await back(lumpy, BP, c.id)
    w.tick(DAY + HOUR)
    await vote(kestrel, BP, 'on_track')
    expect(w.all('SELECT to_status FROM status_change').map(r => r.to_status)).toEqual(['passed'])
    expect(pinned(BP).map(p => [p.id, p.pinned_by])).toEqual([[c.id, null]])
  })

  it("the site's pin never names where the work lives: the author's shared repo stays the shared repo, here and below", async () => {
    const repo = await w.post(site(myra), MID, 'the shared repo: https://codeberg.org/crew/doom-mc', { pin: true })
    const fork = 'https://github.com/kestrel/my-fork'
    const c = await w.post(site(kestrel), MID, 'all nine maps from a pistol start.', { claim: 'passed', links: [{ repo: fork, commit: 'e9b41d0'.padEnd(40, 'a') }] })
    await back(lumpy, MID, c.id)
    w.tick(25 * HOUR)
    await w.join(site(ana), MID)
    await vote(ana, MID, 'on_track') // the next act saves the pass
    expect(new Map(pinned(MID).map(p => [p.id, p.pinned_by]))).toEqual(new Map([[repo.id, null], [c.id, 'site']]))
    for (const path of [MID, BP]) {
      const chain = (await readChain(w.db, path, null))!
      expect(await readWorkRepo(w.db, chain)).toMatchObject({ repo: 'https://codeberg.org/crew/doom-mc', from: MID })
      const v = (await loadAgentView(w.db, chain, { origin: 'https://shwarm.org', before: null, now: w.now }))!
      expect((renderNodeJson(v) as any).work).toMatchObject({ repo: 'https://codeberg.org/crew/doom-mc' })
      expect(renderPrompt(v, 'n0nce123')).not.toContain(fork.replace('https://', 'git clone https://'))
    }
    // a claim the author pinned by hand isn't a shared repo either; with no other pin, none is named
    await pin(myra, MID, repo.id, false)
    await pin(myra, MID, c.id, true)
    const chain = (await readChain(w.db, BP, null))!
    expect(await readWorkRepo(w.db, chain)).toBeNull()
    const v = (await loadAgentView(w.db, (await readChain(w.db, MID, null))!, { origin: 'https://shwarm.org', before: null, now: w.now }))!
    expect((renderNodeJson(v) as any).needs.map((n: any) => n.text)).toContain(
      'say where the work lives (a shared repo and file store) and how work lands, in a pinned post. the steps are under WHERE THE WORK LIVES',
    )
    // and a pinned claim isn't the shwarm's own background
    expect(renderPrompt(v, 'n0nce123')).not.toContain('read the pinned post under LATEST POSTS')
  })

  it('the status line: a pinned claim speaks only while its status is the node\'s', () => {
    const pins = [{ text: 'it passes.', claim: 'passed' as const }, { text: 'the sources.', bySeed: true }]
    expect(statusLine({ pins, status: 'passed', reason: 'it passes.', branches: {} })).toBe('it passes.')
    expect(statusLine({ pins, status: 'blocked', reason: 'waits on a fix.', branches: {} })).toBe('waits on a fix.')
    expect(statusLine({ pins: [{ text: 'my own word on it.' }, ...pins], status: 'blocked', reason: 'waits on a fix.', branches: {} })).toBe('my own word on it.')
  })
})

describe('a status change notifies the people who joined the node (#138)', () => {
  it('on a pass: each person with a seat on it, once, but the author, who gets the approve notice; no mail', async () => {
    await w.join(site(bo), BP) // on the branch, so on the shwarm too
    await w.run({ type: 'leave', actor: site(bo), input: { node: MID } }) // left the shwarm: no seat there now
    const c = await passAtDay() // ana joined at hour 25, after the pass at hour 24: it isn't news of hers
    expect(notices(MID)).toEqual([
      { handle: 'myra', post_id: c, status_to: null, text: 'minecraft in doom passed: its people back a passed claim. approve it too?' },
      { handle: 'kestrel', post_id: c, status_to: 'passed', text: 'minecraft in doom is now passed.' },
      { handle: 'lumpy', post_id: c, status_to: 'passed', text: 'minecraft in doom is now passed.' },
    ])
    expect(w.all('SELECT template FROM email_outbox')).toEqual([])
    // the next act writes nothing again
    await w.post(site(ana), MID, 'nice.')
    await vote(ana, MID, null)
    expect(notices(MID)).toHaveLength(3)
    // the inbox writes the words with the claimant's name as it reads now, and opens the pass box
    const [item] = (await readInbox(w.db, kestrel.id, { all: false, max: 100 })).items
    expect(item).toMatchObject({ kind: 'system', status_to: 'passed', post_id: c, as_name: '@kestrel', href: `/w/${MID}#${PASS_BOX}` })
    // the author's own approval answers only their approve notice
    w.tick(HOUR)
    await w.run({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: c } })
    expect(w.all("SELECT pr.handle, i.done_at IS NOT NULL AS done FROM inbox_item i JOIN person pr ON pr.id = i.person_id WHERE i.kind = 'system' ORDER BY i.id").map(r => r.done)).toEqual([1, 0, 0])
  })

  it('goes to the people on the node at the moment of the change, though a later act writes it', async () => {
    await w.join(site(bo), MID) // backs nothing, so leaving moves no band
    const c = await claim(kestrel, MID, 'passed')
    await back(lumpy, MID, c.id)
    w.tick(25 * HOUR) // the pass's moment is hour 24
    await w.run({ type: 'leave', actor: site(bo), input: { node: MID } }) // bo left after it, before it's written
    await w.join(site(ana), MID) // ana joined after it
    await vote(ana, MID, 'on_track') // writes it
    expect(w.all('SELECT at FROM status_change')).toEqual([{ at: at(24) }])
    expect(notices(MID).map(n => [n.handle, n.status_to])).toEqual([
      ['myra', null],
      ['kestrel', 'passed'],
      ['lumpy', 'passed'],
      ['bo', 'passed'],
    ])
  })

  it('on every change, any direction: the author too when it isn\'t a pass; the claim it went with, or none for on track', async () => {
    await passAtDay()
    const b = await blockAfter()
    const blocked = notices(MID).filter(n => n.status_to === 'blocked')
    expect(blocked.map(n => n.handle)).toEqual(['myra', 'kestrel', 'lumpy', 'ana'])
    expect(blocked.every(n => n.post_id === b)).toBe(true)
    const [item] = (await readInbox(w.db, myra.id, { all: false, max: 100 })).items
    expect(item).toMatchObject({ status_to: 'blocked', post_id: b, as_name: '@ana', href: `/w/${MID}#${b}` })
    // back to on track: on track takes no claim
    await back(myra, MID, b, false)
    await back(lumpy, MID, b, false)
    for (const p of [myra, lumpy, ana]) await vote(p, MID, 'on_track')
    w.tick(DAY)
    await vote(bo, MID, 'on_track').catch(() => null) // not joined: refused, but nothing else moves the band either
    await w.post(site(kestrel), MID, 'back at it')
    await vote(kestrel, MID, null)
    const onTrack = notices(MID).filter(n => n.status_to === 'on_track')
    expect(onTrack.map(n => [n.handle, n.post_id, n.text])).toEqual(['myra', 'kestrel', 'lumpy', 'ana'].map(h => [h, null, 'minecraft in doom is now on track.']))
    const items = (await readInbox(w.db, ana.id, { all: false, max: 100 })).items
    expect(items[0]).toMatchObject({ status_to: 'on_track', post_id: null, href: `/w/${MID}` })
  })

  it('a branch\'s change notifies the branch\'s people, its author among them on a pass; never someone who only posted', async () => {
    await w.post(site(bo), BP, 'just passing through') // posted, never joined
    const c = await claim(kestrel, BP, 'passed', 'all four corners hold.')
    await back(lumpy, BP, c.id)
    w.tick(DAY + HOUR)
    await vote(kestrel, BP, 'on_track')
    expect(notices(BP).map(n => [n.handle, n.status_to])).toEqual([
      ['kestrel', 'passed'],
      ['lumpy', 'passed'],
    ])
    expect(notices(MID)).toEqual([]) // the shwarm's status didn't change
  })

  it('the job writes them once when no act comes', async () => {
    const c = await claim(kestrel, MID, 'passed')
    await back(lumpy, MID, c.id)
    w.tick(25 * HOUR)
    await rollupStats(w.db, w.now)
    await rollupStats(w.db, w.now + 5 * 60_000)
    await vote(lumpy, MID, 'on_track') // an act after it writes nothing again
    expect(notices(MID).map(n => [n.handle, n.status_to])).toEqual([
      ['myra', null],
      ['kestrel', 'passed'],
      ['lumpy', 'passed'],
    ])
    expect(pinned(MID).map(p => [p.id, p.pinned_by])).toEqual([[c.id, 'site']])
  })
})

describe('everything posted here is MIT (decided Oct 15)', () => {
  it('a new shwarm is MIT whatever it sends; building on passes no license on; a branch carries its shwarm\'s note', async () => {
    const mine = await w.run({ type: 'createNode', actor: site(ana), input: { kind: 'shwarm', title: 'warp drives', what: 'w', doneWhen: 'd', tags: ['physics'], license: 'GPL-3.0' } })
    expect(w.node(mine.path).license).toBe('MIT')
    const up = await w.run({
      type: 'createNode',
      actor: site(ana),
      input: { kind: 'shwarm', title: 'doom blocks', what: 'w', doneWhen: 'd', tags: ['games'], buildsOn: { name: 'uzdoom', url: 'https://github.com/UZDoom/UZDoom', license: 'GPL-3.0' } },
    })
    // the upstream's license is kept as part of what it builds on, and isn't the shwarm's
    expect(w.node(up.path).license).toBe('MIT')
    expect(JSON.parse(w.node(up.path).builds_on)).toEqual({ name: 'uzdoom', url: 'https://github.com/UZDoom/UZDoom', license: 'GPL-3.0' })
    // an outside project needs no license now
    const bare = await w.run({ type: 'createNode', actor: site(bo), input: { kind: 'shwarm', title: 'kart moon', what: 'w', doneWhen: 'd', tags: ['games'], buildsOn: { name: 'supertuxkart' } } })
    expect(JSON.parse(w.node(bare.path).builds_on)).toEqual({ name: 'supertuxkart' })
    // an old shwarm with another license: building on it takes nothing from it
    w.db.raw.prepare("UPDATE node SET license = 'CC-BY-SA-4.0' WHERE path = ?").run(MID)
    const on = await w.run({ type: 'createNode', actor: site(bo), input: { kind: 'shwarm', title: 'speedruns', what: 'w', doneWhen: 'd', tags: ['games'], buildsOn: MID } })
    expect(w.node(on.path).license).toBe('MIT')
    // a branch keeps its shwarm's note, whatever it sends
    const br = await w.run({ type: 'createNode', actor: site(myra), input: { kind: 'branch', parent: MID, title: 'sound', what: 'w', doneWhen: 'd', license: 'MIT' } })
    expect(w.node(br.path).license).toBe('CC-BY-SA-4.0')
    expect(mine).not.toHaveProperty('license')
    expect(mine).not.toHaveProperty('state')
  })

  it("the note about the work: null for MIT and the old default, else the license as stored", () => {
    for (const l of ['MIT', 'MIT+CC-BY-4.0', '', null, undefined]) expect(workLicense(l)).toBeNull()
    for (const l of ['GPL-3.0', 'CC0-1.0', 'CC-BY-SA-4.0', 'MPL-2.0']) expect(workLicense(l)).toBe(l)
  })
})

describe("the author's own approval (decided Oct 15)", () => {
  it('is null until the author approves; then when and the claim, whatever the status is now; never on a branch', async () => {
    expect((await loadStatus(w.db, w.node(MID), null, w.now)).authorApproved).toBeNull()
    const c = await passAtDay()
    expect((await loadStatus(w.db, w.node(MID), null, w.now)).authorApproved).toBeNull() // the people's pass isn't the author's
    w.tick(HOUR)
    await w.run({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: c } })
    const approvedAt = at(25) // ...the clock moved a minute per act on top
    const s = await loadStatus(w.db, w.node(MID), null, w.now)
    expect(s.authorApproved).toEqual({ at: s.records.find(r => r.kind === 'author')!.at, claim: { post: c, by: '@kestrel' } })
    expect(s.authorApproved!.at >= approvedAt).toBe(true)
    await blockAfter()
    expect((await loadStatus(w.db, w.node(MID), null, w.now)).authorApproved?.claim?.post).toBe(c) // apart from the status
    expect((await loadStatus(w.db, w.node(BP), null, w.now)).authorApproved).toBeNull()
    // the feed card reads it as the stats job rolled it up, so it never reads a thread's posts
    await rollupStats(w.db, w.now)
    const feed = [...(await loadFeed(w.db, { tab: 'live' }, w.now)).cards, ...(await loadFeed(w.db, { tab: 'passed' }, w.now)).cards]
    expect(feed.find(card => card.path === MID)?.authorApproved).toEqual({ at: s.authorApproved!.at, claim: { post: c, by: '@kestrel' } })
  })

  it("a pass from before Oct 14 is the author's approval only when they passed its author check", async () => {
    // migration 0032 kept every old pass as a record of the author's, though the author check was opt-in
    const sub = w.oldSubmission(kestrel, MID, { status: 'passed' })
    w.db.raw
      .prepare("INSERT INTO pass_record (id, node_id, kind, status, at, submission_id, backers, pins, by_name, person_id) VALUES ('r_old0001', ?, 'author', 'passed', ?, ?, 0, '[]', '@myra', ?)")
      .run(w.node(MID).id, at(0), sub.id, myra.id)
    const feedCard = async () => {
      await rollupStats(w.db, w.now)
      const cards = [...(await loadFeed(w.db, { tab: 'live' }, w.now)).cards, ...(await loadFeed(w.db, { tab: 'passed' }, w.now)).cards]
      return cards.find(card => card.path === MID)?.authorApproved
    }
    expect((await loadStatus(w.db, w.node(MID), null, w.now)).authorApproved).toBeNull()
    expect(await feedCard()).toBeNull()
    // someone else's people check isn't the author's word either
    const check = w.db.raw.prepare("INSERT INTO check_report (id, post_id, submission_id, person_id, slot, verdict, created_at) VALUES (?, ?, ?, ?, ?, 'pass', ?)")
    const chk = (id: string, by: P, slot: string) => {
      w.db.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, links, created_at) VALUES (?, ?, ?, ?, 'check', 'ran it.', '[]', ?)").run(id, w.node(MID).id, by.id, '@' + by.handle, at(0))
      check.run(`c_${id}`, id, sub.id, by.id, slot, at(0))
    }
    chk('p_lumpychk1', lumpy, 'people')
    expect((await loadStatus(w.db, w.node(MID), null, w.now)).authorApproved).toBeNull()
    // the author's own passed check: that was their approval, with no claim to cite
    chk('p_myrachk01', myra, 'author')
    expect((await loadStatus(w.db, w.node(MID), null, w.now)).authorApproved).toEqual({ at: at(0), claim: null })
    expect(await feedCard()).toEqual({ at: at(0), claim: null })
  })

  it("the feed card names the claimant as they read now: a closed account is a former member before the job runs again", async () => {
    const c = await passAtDay()
    w.tick(HOUR)
    await w.run({ type: 'markPassed', actor: stepped(myra), input: { node: MID, post: c } })
    await rollupStats(w.db, w.now)
    w.db.raw.prepare("UPDATE person SET status = 'closed' WHERE id = ?").run(kestrel.id) // no re-roll after it
    const cards = [...(await loadFeed(w.db, { tab: 'live' }, w.now)).cards, ...(await loadFeed(w.db, { tab: 'passed' }, w.now)).cards]
    expect(cards.find(card => card.path === MID)?.authorApproved?.claim).toEqual({ post: c, by: FORMER })
  })
})
