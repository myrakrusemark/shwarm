// Pass records, the status history and nothing locking (decided Oct 14, "One model for every node: claims and the
// rubber band decide a shwarm too; a pass is a dated record with pinned work; nothing locks", and "With nothing locking:
// build on any shwarm, a pass box in place of the result page, a passed tab"; Myra: "a PASS needs to be AS-OF a specific
// time", "neither locks a shwarm, its just that the poster can mark their own shwarm as passed"). Who writes a change of
// status (the act that first advances past it, or the stats job when nothing does), each written once; the crowd's pass
// record and the author's inbox notice; the author's own mark; what reads them; the log; building on; the feed's tab.
import { describe, expect, beforeEach, it } from 'vitest'
import { closeAccount } from '../src/auth/close'
import { actOnPost, readPostView } from '../src/core/admin-content'
import { NO_PASSED_CLAIM, NOT_A_PASSED_CLAIM, ONLY_SHWARM_MARK } from '../src/core/records'
import { computeNodes, rollupStats } from '../src/jobs/stats'
import { RANKING } from '../src/core/stats'
import { loadFeed } from '../src/read/feed'
import { readInbox } from '../src/read/inbox'
import { readLog } from '../src/read/log'
import { readChain } from '../src/read/node'
import { loadStatus, PASS_BOX, readLatestPass } from '../src/read/status'
import { DAY, HOUR, MIN, person, refused, site, stepped, World, type P } from './core-fixtures'
import { T0 } from './d1'

const MID = 'minecraft-in-doom'
const BP = 'minecraft-in-doom/block-placement'
const PINS = [
  { repo: 'https://codeberg.org/myra/doom-blocks', commit: 'e9b41d0'.padEnd(40, 'a') },
  { ipfs: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/mid.pk3' },
]

let w: World
let myra: P, kestrel: P, lumpy: P, ana: P

const at = (h: number) => new Date(T0 + h * HOUR).toISOString()
const claim = (by: P, node: string, status: string, text = 'all nine maps from a pistol start, 60 fps on the reference rig.', links?: unknown) =>
  w.run({ type: 'post', actor: site(by), input: { node, text, claim: status, ...(links ? { links } : {}) } })
const back = (by: P, node: string, post: string, on = true) => w.run({ type: 'back', actor: site(by), input: { node, post, on } })
const vote = (by: P, node: string, status: unknown) => w.run({ type: 'status', actor: site(by), input: { node, status } })
const mark = (by: P, post: string, o: { stepped?: boolean; node?: string } = {}) =>
  w.run({ type: 'markPassed', actor: o.stepped === false ? site(by) : stepped(by), input: { node: o.node ?? MID, post } })
const lines = (path: string) =>
  w.all('SELECT h.at, h.from_status, h.to_status, h.claim_id, h.backers, h.against, h.written_by FROM status_change h JOIN node n ON n.id = h.node_id WHERE n.path = ? ORDER BY h.at', path)
const records = (path: string) =>
  w.all('SELECT r.kind, r.status, r.at, r.claim_id, r.backers, r.pins, r.by_name, r.change_id IS NOT NULL AS crowd FROM pass_record r JOIN node n ON n.id = r.node_id WHERE n.path = ? ORDER BY r.at, r.rowid', path)
// The author's approve notices; the status-change notices to the people who joined (#138, Oct 15) are test/oct15.test.ts's.
const notices = () => w.all("SELECT person_id, kind, node_id, post_id, text FROM inbox_item WHERE kind = 'system' AND status_to IS NULL ORDER BY id")

beforeEach(async () => {
  w = new World()
  myra = await person(w.db, 'myra')
  kestrel = await person(w.db, 'kestrel')
  lumpy = await person(w.db, 'lumpy')
  ana = await person(w.db, 'ana')
  await w.shwarm(site(myra))
  await w.branch(site(myra), MID)
  await w.join(site(kestrel), BP) // counted on the shwarm too, through its branch
  await w.join(site(lumpy), BP)
  w.db.raw.prepare("UPDATE node SET triage = 'clear'").run()
})

/** kestrel's passed claim on the shwarm with pins, backed by lumpy: passed leads on track by 2, so it passes at hour 24. */
async function leading() {
  const c = await claim(kestrel, MID, 'passed', 'all nine maps from a pistol start, 60 fps on the reference rig.', PINS)
  await back(lumpy, MID, c.id)
  return c.id as string
}

describe('a change of status is written by whoever first advances past it (decided Oct 14)', () => {
  it('an act after the moment: the dated line, the crowd pass record with a copy of the pins, the log row and the author notice', async () => {
    const c = await leading()
    expect(lines(MID)).toEqual([]) // nothing yet: the band only leads
    w.tick(25 * HOUR)
    await w.join(site(ana), MID)
    await vote(ana, MID, 'on_track') // the next act on the shwarm saves the band, and with it the change at hour 24
    expect(lines(MID)).toEqual([{ at: at(24), from_status: null, to_status: 'passed', claim_id: c, backers: 2, against: 0, written_by: 'act' }])
    expect(records(MID)).toEqual([{ kind: 'crowd', status: 'passed', at: at(24), claim_id: c, backers: 2, pins: JSON.stringify(PINS), by_name: null, crowd: 1 }])
    const passed = w.events(MID, 'passed')
    expect(passed).toHaveLength(1)
    expect(passed[0]).toMatchObject({ at: at(24), by_name: null, submission_id: null, detail: 'backed by 2 to 0', evidence: `/w/${MID}#${c}`, milestone: 1 })
    // the shwarm's author is asked for their own approval; no mail goes with it
    expect(notices()).toEqual([
      // the stored words name no one: the inbox names the claimant as their name reads when it shows (web/profile.tsx)
      { person_id: myra.id, kind: 'system', node_id: w.node(MID).id, post_id: c, text: 'minecraft in doom passed: its people back a passed claim. approve it too?' },
    ])
    expect(w.all('SELECT template FROM email_outbox')).toEqual([])
    const inbox = async () => (await readInbox(w.db, myra.id, { all: false, max: 100 })).items[0]
    expect(await inbox()).toMatchObject({ kind: 'system', href: `/w/${MID}#${PASS_BOX}`, post_id: c, as_name: '@kestrel', read: false, done: false })
    // the author's mark answers it: read, and done
    w.tick(HOUR)
    await mark(myra, c)
    expect(await inbox()).toMatchObject({ post_id: c, read: true, done: true })
    // a closed account's name doesn't outlive it there
    await closeAccount(w.db, kestrel.id, w.now)
    expect(await inbox()).toMatchObject({ post_id: c, as_name: 'former member' })
    // the band and the node say so
    expect(w.get('SELECT current, changed_at FROM branch_status WHERE node_id = ?', w.node(MID).id)).toEqual({ current: 'passed', changed_at: at(24) })
  })

  it('on a branch: the line and the record, and no notice (a branch has no author mark)', async () => {
    const c = await claim(kestrel, BP, 'passed', 'all four corners hold.')
    await back(lumpy, BP, c.id)
    w.tick(DAY)
    await vote(kestrel, BP, 'on_track') // kestrel moves: the change at hour 24 is saved first, with the backing it had
    expect(lines(BP)).toEqual([{ at: at(24), from_status: null, to_status: 'passed', claim_id: c.id, backers: 2, against: 0, written_by: 'act' }])
    expect(records(BP)).toEqual([{ kind: 'crowd', status: 'passed', at: at(24), claim_id: c.id, backers: 2, pins: '[]', by_name: null, crowd: 1 }])
    expect(notices()).toEqual([])
    // a change to anything but passed is a line only
    const b = await claim(lumpy, BP, 'blocked', 'P_CheckSight caches the old block.')
    await w.join(site(ana), BP)
    await back(ana, BP, b.id) // blocked 2, passed 0, on track 1: blocked leads passed by 2
    w.tick(DAY)
    await vote(ana, BP, null) // changes nothing: a vote that isn't there
    await w.post(site(ana), BP, 'a note') // a post doesn't touch the band either
    expect(lines(BP)).toHaveLength(1)
    await vote(kestrel, BP, null)
    expect(lines(BP).slice(1)).toEqual([{ at: at(48), from_status: 'passed', to_status: 'blocked', claim_id: b.id, backers: 2, against: 0, written_by: 'act' }])
    expect(records(BP)).toHaveLength(1)
  })

  it('the stats job writes it when no act comes, once, and moves the node; a later act writes nothing again', async () => {
    const c = await leading()
    await rollupStats(w.db, w.now)
    // the stats know when the status changes, so the job comes back for it
    expect(w.get('SELECT stale_at FROM node_stats WHERE node_id = ?', w.node(MID).id).stale_at <= at(24)).toBe(true)
    w.tick(24 * HOUR + 5 * MIN)
    const version = w.node(MID).last_event_id
    await rollupStats(w.db, w.now)
    expect(lines(MID)).toEqual([{ at: at(24), from_status: null, to_status: 'passed', claim_id: c, backers: 2, against: 0, written_by: 'job' }])
    expect(records(MID)).toHaveLength(1)
    expect(w.events(MID, 'passed')).toHaveLength(1)
    expect(notices()).toHaveLength(1)
    expect(w.node(MID).last_event_id).not.toBe(version) // signed-out pages move with it
    expect(w.get('SELECT current, changed_at, at FROM branch_status WHERE node_id = ?', w.node(MID).id)).toEqual({ current: 'passed', changed_at: at(24), at: new Date(w.now).toISOString() })
    // a rerun, and then an act, find nothing new to write
    w.tick(10 * MIN)
    await rollupStats(w.db, w.now)
    await w.join(site(ana), MID)
    await vote(ana, MID, 'on_track')
    expect(lines(MID)).toHaveLength(1)
    expect(records(MID)).toHaveLength(1)
    expect(w.events(MID, 'passed')).toHaveLength(1)
    expect(notices()).toHaveLength(1)
    // a passed shwarm doesn't rank; its line is the claim's first line
    expect(w.get('SELECT score, hot, status_line FROM node_stats WHERE node_id = ?', w.node(MID).id)).toMatchObject({ score: 0, hot: 0, status_line: 'all nine maps from a pistol start, 60 fps on the reference rig.' })
  })

  it('the job and an act at once: the one that lands first writes the change, the other nothing', async () => {
    await leading()
    w.tick(25 * HOUR)
    const n = w.node(MID)
    const job = await computeNodes(w.db, [n.id], w.now, RANKING) // read before the act lands
    await w.join(site(ana), MID)
    await vote(ana, MID, 'on_track') // the act writes the change at hour 24 itself
    await w.db.batch(job.bandWrites) // the job's writes, read from the band the act has since replaced
    expect(lines(MID).map(l => l.written_by)).toEqual(['act'])
    expect(records(MID)).toHaveLength(1)
    expect(w.events(MID, 'passed')).toHaveLength(1)
    expect(notices()).toHaveLength(1)
    // and the band is the act's, with ana's vote behind it
    expect(w.get('SELECT current, at FROM branch_status WHERE node_id = ?', n.id)).toEqual({ current: 'passed', at: at(25) })
  })

  it("the job never writes a change the backing didn't make: a newer band from the tree wins", async () => {
    await leading()
    w.tick(30 * HOUR)
    const n = w.node(MID)
    const job = await computeNodes(w.db, [n.id], w.now, RANKING) // from the band saved at hour 0: a change at hour 24
    expect(job.bandWrites.length).toBeGreaterThan(0)
    // meanwhile the tree saved a band at hour 10 (an act the job didn't see), with the backing changed then
    w.db.raw
      .prepare("UPDATE branch_status SET at = ?, lead_hours = 20, leading_since = ? WHERE node_id = ?")
      .run(at(10), at(0), n.id)
    await w.db.batch(job.bandWrites)
    expect(lines(MID)).toEqual([])
    expect(records(MID)).toEqual([])
    expect(w.get('SELECT current, at FROM branch_status WHERE node_id = ?', n.id)).toEqual({ current: null, at: at(10) })
  })
})

describe('a change that falls due before a leave or a closed account is written with the backing it had', () => {
  /** kestrel's claim with pins backed by lumpy (2) and ana's (1): passed leads by 3, due at hour 16; nothing writes it until hour 30. */
  async function due() {
    const c = await leading()
    await w.join(site(ana), MID)
    w.tick(MIN)
    await claim(ana, MID, 'passed', 'reran it: all nine maps.')
    w.tick(30 * HOUR - MIN)
    return c
  }
  const cites = (c: string) => {
    expect(lines(MID).map(l => [l.to_status, l.claim_id, l.backers])).toEqual([['passed', c, 3]])
    expect(records(MID).map(r => [r.kind, r.claim_id, r.backers, r.pins])).toEqual([['crowd', c, 3, JSON.stringify(PINS)]])
    expect(notices().map(n => n.post_id)).toEqual([c])
  }

  it('leaving: the claim most backed at the moment, its pins, before the leaver stops counting', async () => {
    const c = await due()
    expect(await w.run({ type: 'leave', actor: site(lumpy), input: { node: MID } })).toMatchObject({ left: true })
    cites(c)
    expect(w.all('SELECT left_at FROM seat WHERE node_id = ? AND person_id = ?', w.node(MID).id, lumpy.id)).toEqual([{ left_at: new Date(w.now).toISOString() }])
  })

  it('closing an account: the same', async () => {
    const c = await due()
    expect(await closeAccount(w.db, lumpy.id, w.now)).toEqual({ handle: 'lumpy' })
    cites(c)
  })
})

describe("the author's mark (decided Oct 14: \"the poster can mark their own shwarm as passed\")", () => {
  it('cites a passed claim, with the password; writes a record of its own and changes no status', async () => {
    const c = await leading()
    await refused(mark(myra, c, { stepped: false }), 'not_permitted', { need: 'step_up' })
    await refused(mark(kestrel, c), 'not_permitted', { need: 'author' })
    w.tick(HOUR)
    expect(await mark(myra, c)).toMatchObject({ node: MID, post: c, at: at(1), changed: true })
    expect(records(MID)).toEqual([{ kind: 'author', status: 'passed', at: at(1), claim_id: c, backers: 2, pins: JSON.stringify(PINS), by_name: '@myra', crowd: 0 }])
    expect(w.events(MID, 'passed').map(e => [e.by_name, e.detail, e.evidence])).toEqual([['@myra', 'the author marks it passed', `/w/${MID}#${c}`]])
    expect(w.node(MID).last_event_id).toBe(w.events(MID, 'passed')[0].id)
    // the status is the crowd's: still none, passed leading
    const s = await loadStatus(w.db, w.node(MID), myra.id, w.now)
    expect(s.now).toMatchObject({ current: null, challenger: { status: 'passed', lead: 2 } })
    expect(s.records.map(r => [r.kind, r.by, r.claim, r.pins])).toEqual([['author', '@myra', { post: c, by: '@kestrel' }, PINS]])
    // the author's picker lists the passed claims, most-backed first; nobody else gets one
    expect(s.passedClaims.map(x => [x.post, x.backers])).toEqual([[c, 2]])
    expect((await loadStatus(w.db, w.node(MID), kestrel.id, w.now)).passedClaims).toEqual([])
    expect(lines(MID)).toEqual([])
    // the same claim twice is a double click; another claim later is a new record
    expect(await mark(myra, c)).toMatchObject({ changed: false, at: at(1) })
    w.tick(HOUR)
    const d = await claim(lumpy, MID, 'passed', 'reran it on my machine: all nine maps.')
    expect((await loadStatus(w.db, w.node(MID), myra.id, w.now)).passedClaims.map(x => x.post)).toEqual([d.id, c]) // 1 each: the newer first
    expect(await mark(myra, d.id)).toMatchObject({ changed: true, at: at(2) })
    // each keeps its backers as they were: lumpy moved to their own claim after the first
    expect(records(MID).map(r => [r.kind, r.claim_id, r.backers])).toEqual([
      ['author', c, 2],
      ['author', d.id, 1],
    ])
  })

  it('one record per claim, so going back and forth adds nothing; and a mark never bumps the live score', async () => {
    const a = await claim(myra, MID, 'passed', 'done, says me.')
    w.tick(MIN)
    const b = await claim(myra, MID, 'passed', 'done again, says me.')
    const id = w.node(MID).id
    const score = async () => (await computeNodes(w.db, [id], w.now, RANKING)).nodes[0].score
    const before = await score()
    const made = []
    for (const post of [a.id, b.id, a.id, b.id, a.id, b.id]) {
      w.tick(1000)
      made.push((await mark(myra, post)).changed)
    }
    expect(made).toEqual([true, true, false, false, false, false])
    expect(records(MID).map(r => [r.kind, r.claim_id])).toEqual([
      ['author', a.id],
      ['author', b.id],
    ])
    expect(w.events(MID, 'passed')).toHaveLength(2)
    expect(await score()).toBe(before)
  })

  it('refused with no passed claim to cite, a claim of another status or node, and on a branch', async () => {
    await refused(mark(myra, 'p_aaaaaaaaaa'), 'bad_request', { field: 'post' }).then(e => expect(e.message).toBe(NO_PASSED_CLAIM))
    const b = await claim(kestrel, MID, 'blocked', 'gzdoom 4.11 crashes on load.')
    const p = await claim(kestrel, BP, 'passed', 'all four corners hold.')
    await claim(lumpy, MID, 'passed')
    for (const post of [b.id, p.id, 'nonsense']) expect((await refused(mark(myra, post), 'bad_request', { field: 'post' })).message).toBe(NOT_A_PASSED_CLAIM)
    expect((await refused(mark(myra, p.id, { node: BP }), 'bad_request')).message).toBe(ONLY_SHWARM_MARK)
    expect(records(MID)).toEqual([])
  })
})

describe('nothing locks (decided Oct 14)', () => {
  it('after a pass the shwarm and its branches take everything as before, and a pass that does not hold moves on', async () => {
    const c = await leading()
    w.tick(DAY)
    await w.join(site(ana), MID)
    expect(w.node(MID).state).toBe('live')
    // posts, joins, branches, claims and backs all go through
    await w.post(site(ana), MID, 'found a softlock in e1m3.')
    await w.branch(site(ana), MID, { title: 'e1m3 softlock' })
    await w.post(site(kestrel), BP, 'still on it')
    const b = await claim(ana, MID, 'blocked', 'e1m3 softlocks after the red key.')
    await back(myra, MID, b.id)
    await back(lumpy, MID, b.id) // blocked 3, passed 1: blocked leads by 2
    w.tick(DAY)
    await vote(kestrel, MID, 'on_track')
    expect(lines(MID).map(l => [l.at, l.from_status, l.to_status])).toEqual([
      [at(24), null, 'passed'],
      [at(48), 'passed', 'blocked'],
    ])
    // the pass record stays in the history
    expect(records(MID).map(r => [r.kind, r.at, r.claim_id])).toEqual([['crowd', at(24), c]])
    const s = await loadStatus(w.db, w.node(MID), null, w.now)
    expect(s.now.current).toBe('blocked')
    expect(s.reason).toEqual({ post: b.id, text: 'e1m3 softlocks after the red key.' })
    expect(s.records.map(r => [r.kind, r.at, r.claim?.post, r.backers])).toEqual([['crowd', at(24), c, 2]])
    expect(s.history.map(h => [h.from, h.to, h.claim])).toEqual([
      ['passed', 'blocked', b.id],
      [null, 'passed', c],
    ])
  })

  it('the log lists every change: passes as their audit row, the rest as status rows, both pageable', async () => {
    const c = await leading()
    w.tick(DAY)
    await w.join(site(ana), MID)
    const b = await claim(ana, MID, 'blocked', 'e1m3 softlocks after the red key.')
    await back(lumpy, MID, b.id)
    await back(myra, MID, b.id) // blocked 3, passed 1
    w.tick(DAY)
    await vote(kestrel, MID, 'on_track')
    const chain = (await readChain(w.db, MID, null))!
    const log = (await readLog(w.db, chain, { filter: 'key', before: null }))!
    const changes = log.rows.filter(r => r.event === 'passed' || r.event === 'status')
    expect(changes.map(r => [r.event, r.at, r.detail, r.evidence])).toEqual([
      ['status', at(48), 'passed → blocked · 3 to 1', `/w/${MID}#${b.id}`],
      ['passed', at(24), 'backed by 2 to 0', `/w/${MID}#${c}`],
    ])
    expect(changes.every(r => r.key)).toBe(true)
    // a status row is a cursor too
    const older = (await readLog(w.db, chain, { filter: 'all', before: changes[0].id, limit: 50 }))!
    expect(older.rows[0]).toMatchObject({ event: 'passed', at: at(24) })
    // a hidden claim takes its status row out of the log, as any row with hidden evidence
    await actOnPost(w.db, { personId: myra.id, handle: 'myra' }, b.id, 'hide', { reason: 'spam' }, w.now)
    expect((await readLog(w.db, chain, { filter: 'key', before: null }))!.rows.some(r => r.event === 'status')).toBe(false)
  })
})

describe('a record outlives its claim', () => {
  it('deleting the claim keeps the pins; hiding it hides them; removing a link takes it from the copy too', async () => {
    const c = await leading()
    w.tick(DAY)
    await w.join(site(ana), MID)
    await vote(ana, MID, 'on_track') // saves the change at hour 24, and with it the crowd's record
    await mark(myra, c)
    const read = async () => (await loadStatus(w.db, w.node(MID), null, w.now)).records
    expect((await read()).map(r => [r.kind, r.claim?.post ?? null, r.pins])).toEqual([
      ['author', c, PINS],
      ['crowd', c, PINS],
    ])
    // the operator takes the ipfs pin off the claim: it leaves the records' copies too
    const was = JSON.stringify(PINS[1])
    await actOnPost(w.db, { personId: myra.id, handle: 'myra' }, c, 'remove_link', { reason: 'not what it says', link: '1', was }, w.now)
    expect((await read()).map(r => r.pins)).toEqual([[PINS[0]], [PINS[0]]])
    // the claimant deletes the claim: the records keep the pinned work, with no claim to link
    await w.run({ type: 'deletePost', actor: site(kestrel), input: { node: MID, post: c } })
    expect((await read()).map(r => [r.claim, r.pins, r.backers])).toEqual([
      [null, [PINS[0]], 2],
      [null, [PINS[0]], 2],
    ])
    // the operator still reaches the copies the pass box shows: the deleted claim's page lists them, and removing one
    // takes it from every record
    expect((await readPostView(w.db, c))!.post.links).toEqual([PINS[0]])
    await actOnPost(w.db, { personId: myra.id, handle: 'myra' }, c, 'remove_link', { reason: 'dmca', link: '0', was: JSON.stringify(PINS[0]) }, w.now)
    expect((await read()).map(r => r.pins)).toEqual([[], []])
    expect(w.all("SELECT COUNT(*) AS n FROM moderation_action WHERE action = 'remove_link'")).toEqual([{ n: 2 }])
    await expect(actOnPost(w.db, { personId: myra.id, handle: 'myra' }, c, 'remove_link', { reason: 'dmca', link: '0', was: JSON.stringify(PINS[0]) }, w.now)).rejects.toThrow('that link is gone already.')
  })

  it("a claim the operator hid takes its records' pins out of sight", async () => {
    const c = await leading()
    w.tick(DAY)
    // hiding it saves the band first, and with it the change at hour 24, citing the claim it then takes out of sight
    await actOnPost(w.db, { personId: myra.id, handle: 'myra' }, c, 'hide', { reason: 'malware' }, w.now)
    const [r] = (await loadStatus(w.db, w.node(MID), null, w.now)).records
    expect(r).toMatchObject({ kind: 'crowd', claim: null, pins: [], backers: 2 })
  })
})

describe('building on a shwarm records the pass it builds on (decided Oct 14)', () => {
  it('any shwarm, at any time: as of its latest pass record, or none', async () => {
    const plain = { title: 'doom in minecraft', tags: ['#games'], buildsOn: MID }
    await w.shwarm(site(ana), plain)
    expect(JSON.parse(w.node('doom-in-minecraft').builds_on)).toEqual({ node: MID, as_of: null })
    const c = await leading()
    w.tick(DAY)
    await mark(myra, c)
    const latest = (await readLatestPass(w.db, w.node(MID).id))!
    expect(latest).toMatchObject({ at: at(24) })
    await w.shwarm(site(ana), { ...plain, title: 'doom in minecraft, faster' })
    expect(JSON.parse(w.node('doom-in-minecraft-faster').builds_on)).toEqual({ node: MID, as_of: latest.id })
    const head = (await readChain(w.db, 'doom-in-minecraft-faster', ana.id))!.node // still being checked: its author reads it
    expect(head.builds_on).toEqual({ node: MID, title: 'minecraft in doom', as_of: { id: latest.id, at: at(24) } })
    // its branches inherit it; a branch can't be built on
    await w.branch(site(ana), 'doom-in-minecraft-faster', { title: 'chunks' })
    expect(JSON.parse(w.node('doom-in-minecraft-faster/chunks').builds_on)).toEqual({ node: MID, as_of: latest.id })
    await refused(w.shwarm(site(ana), { ...plain, title: 'on a branch', buildsOn: BP }), 'bad_request')
  })
})

describe("the feed's passed tab (decided Oct 14)", () => {
  it('lists shwarms whose status is passed, newest pass first; the live tab lists the rest, dead ends among them', async () => {
    await w.shwarm(site(ana), { title: 'warp travel', tags: ['#physics'] })
    w.db.raw.prepare("UPDATE node SET triage = 'clear'").run()
    await w.join(site(kestrel), 'warp-travel')
    await w.join(site(lumpy), 'warp-travel')
    const d = await claim(kestrel, 'warp-travel', 'dead_end', 'the metric needs negative energy.')
    await back(lumpy, 'warp-travel', d.id)
    await leading()
    w.tick(25 * HOUR)
    await rollupStats(w.db, w.now)
    expect((await loadFeed(w.db, { tab: 'passed' }, w.now)).cards.map(c => [c.path, c.status, c.at])).toEqual([[MID, 'passed', at(24)]])
    expect((await loadFeed(w.db, { tab: 'closed' }, w.now)).tab).toBe('passed') // the tab's name before Oct 14
    const live = await loadFeed(w.db, { tab: 'live' }, w.now)
    expect(live.cards.map(c => [c.path, c.status])).toEqual([['warp-travel', 'dead_end']])
  })
})
