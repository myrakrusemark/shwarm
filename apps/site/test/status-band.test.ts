// The rubber band (decided Oct 14, "A branch's status: on track by vote, the rest by claims people back, with a rubber
// band", and "One model for every node": a shwarm's the same; Myra: "requires a certain number or portion of votes over
// the current status", "AND makes sense", "i like the rate--no less that 6h tho"): a challenger leading by 2 or more
// gathers lead-hours, and the status changes at 48 of them, never in under 6 hours of leading; below a lead of 2 they
// drain. Each change it goes through is reported, so a write can record it. core/status.ts advance and nodeStatus, pure.
// A node has no status until someone backs one (decided Oct 17): its first on-track vote makes it on track at once, and
// anything else takes the band against the next most-backed status.
import { describe, expect, it } from 'vitest'
import { advance, DRAIN_PER_HOUR, LEAD_HOURS, MARGIN, MIN_HOURS, nodeStatus, startBand, type Band, type Status } from '../src/core/status'
import { T0 } from './d1'

const H = 3_600_000
const at = (h: number) => new Date(T0 + h * H).toISOString()
const t = (o: Partial<Record<Status, number>>) => {
  const x = { on_track: 0, blocked: 0, passed: 0, dead_end: 0, ...o }
  return { ...x, people: x.on_track + x.blocked + x.passed + x.dead_end }
}
/** A new node: no status. */
const fresh = startBand(at(0))
/** A node that its first on-track vote made on track at hour 0, where most of the band's cases start. */
const start: Band = { ...fresh, current: 'on_track', changed_at: at(0) }
/** The band's stored part, as a write saves it. */
const saved = ({ current, challenger, lead_hours, leading_since, changed_at, at }: Band): Band => ({ current, challenger, lead_hours, leading_since, changed_at, at })
/** When the challenger takes over from a fresh start with this tally. */
const flipsAfter = (tally: Partial<Record<Status, number>>) => (Date.parse(advance(start, t(tally), T0).changes_at!) - T0) / H

describe('the rubber band (decided Oct 14)', () => {
  it('the constants are the decided ones', () => {
    expect({ MARGIN, LEAD_HOURS, MIN_HOURS, DRAIN_PER_HOUR }).toEqual({ MARGIN: 2, LEAD_HOURS: 48, MIN_HOURS: 6, DRAIN_PER_HOUR: 2 })
  })

  it('on track with nothing else backed: nothing gathered, nobody challenging', () => {
    expect(advance(start, t({}), T0 + 100 * H)).toEqual({ ...start, at: at(100), lead: 0, changes_at: null, needs: null, flips: [] })
    expect(advance(start, t({ on_track: 5 }), T0 + 100 * H)).toMatchObject({ current: 'on_track', challenger: null, lead: 0, needs: null })
  })

  it('a lead under 2 gathers nothing, and says what it needs', () => {
    const b = advance(start, t({ blocked: 1 }), T0 + 500 * H)
    expect(b).toMatchObject({ current: 'on_track', challenger: 'blocked', lead: 1, lead_hours: 0, leading_since: null, changes_at: null, needs: 1 })
    expect(advance(start, t({ on_track: 3, passed: 2 }), T0 + 500 * H)).toMatchObject({ current: 'on_track', challenger: 'passed', lead: -1, needs: 3 })
  })

  it('48 lead-hours change it: a lead of 2 takes 24 hours, 3 takes 16, 4 takes 12, 8 takes 6', () => {
    expect(flipsAfter({ passed: 2 })).toBe(24)
    expect(flipsAfter({ passed: 3 })).toBe(16)
    expect(flipsAfter({ blocked: 5, on_track: 1 })).toBe(12)
    expect(flipsAfter({ dead_end: 8 })).toBe(6)
  })

  it('never in under 6 hours of leading: a lead of 16 still takes 6', () => {
    expect(flipsAfter({ passed: 16 })).toBe(6)
    expect(flipsAfter({ passed: 100 })).toBe(6)
    const b = advance(start, t({ passed: 16 }), T0 + 5 * H)
    expect(b).toMatchObject({ current: 'on_track', challenger: 'passed', lead_hours: 80, leading_since: at(0), changes_at: at(6) })
  })

  it('gathers lead × hours, and flips at the exact moment', () => {
    const b = advance(start, t({ passed: 2 }), T0 + 23 * H)
    expect(b).toMatchObject({ current: 'on_track', challenger: 'passed', lead: 2, lead_hours: 46, leading_since: at(0), changes_at: at(24), needs: null, at: at(23) })
    expect(b.flips).toEqual([])
    const flipped = advance(saved(b), t({ passed: 2 }), T0 + 30 * H)
    const flip = { from: 'on_track', to: 'passed', at: at(24), backers: 2, against: 0 }
    expect(flipped).toEqual({ current: 'passed', challenger: null, lead_hours: 0, leading_since: null, changed_at: at(24), at: at(30), lead: 0, changes_at: null, needs: null, flips: [flip] })
    // the same from the start in one step: a read that comes late flips it where it happened
    expect(advance(start, t({ passed: 2 }), T0 + 30 * H)).toEqual(flipped)
    // and once saved past it, the change is behind the band: nothing to report again
    expect(advance(saved(flipped), t({ passed: 2 }), T0 + 40 * H).flips).toEqual([])
  })

  it('reports every change it passes, with the backing then, even where the band only reads past it', () => {
    const b = advance(start, t({ on_track: 1, blocked: 5 }), T0 + 13 * H)
    expect(b.flips).toEqual([{ from: 'on_track', to: 'blocked', at: at(12), backers: 5, against: 1 }])
    const back = advance(saved(advance(saved(b), t({ on_track: 6, blocked: 2 }), T0 + 13 * H)), t({ on_track: 6, blocked: 2 }), T0 + 26 * H)
    expect(back.flips).toEqual([{ from: 'blocked', to: 'on_track', at: at(25), backers: 6, against: 2 }])
  })

  it('after a flip, the old status is the challenger and gathers nothing while it trails', () => {
    const b = advance(start, t({ passed: 3, on_track: 1 }), T0 + 40 * H)
    expect(b).toMatchObject({ current: 'passed', changed_at: at(24), challenger: 'on_track', lead: -2, lead_hours: 0, needs: 4, changes_at: null })
  })

  it('drains 2 an hour below a lead of 2, never under 0, and picks up where it was', () => {
    const ten = advance(start, t({ blocked: 2 }), T0 + 10 * H) // 20 gathered
    expect(ten.lead_hours).toBe(20)
    const dropped = advance(saved(ten), t({ blocked: 2, on_track: 1 }), T0 + 15 * H) // lead 1 for 5 hours
    // 10 hours led, less 5 drained: 5 left
    expect(dropped).toMatchObject({ challenger: 'blocked', lead: 1, lead_hours: 10, leading_since: at(10), needs: 1, changes_at: null })
    // back to a lead of 2: 38 more lead-hours at 2 an hour, 19 hours, long past 6 hours led
    const back = advance(saved(dropped), t({ blocked: 2 }), T0 + 15 * H)
    expect(back).toMatchObject({ lead_hours: 10, leading_since: at(10), changes_at: at(34) })
    expect(advance(saved(dropped), t({ blocked: 2 }), T0 + 34 * H)).toMatchObject({ current: 'blocked', changed_at: at(34) })
    // drained out
    expect(advance(saved(ten), t({ blocked: 1 }), T0 + 100 * H).lead_hours).toBe(0)
  })

  it('gathered lead-hours never skip the 6 hours of leading', () => {
    const big = advance(start, t({ passed: 16 }), T0 + 2 * H) // 32 gathered in 2 hours
    expect(big).toMatchObject({ lead_hours: 32, changes_at: at(6) })
    expect(advance(saved(big), t({ passed: 16 }), T0 + 6 * H)).toMatchObject({ current: 'passed', changed_at: at(6) })
  })

  it('a dip costs what it lasted: toggling a vote for a minute never starts the 6 hours over', () => {
    const M = 60_000
    const five = advance(start, t({ passed: 8 }), T0 + 5 * H) // 40 gathered, 5 hours led
    const dip = advance(saved(five), t({ passed: 8, on_track: 7 }), T0 + 5 * H + M) // one minute at a lead of 1
    expect(dip.leading_since).toBe(new Date(T0 + 2 * M).toISOString()) // 5 hours led, less the minute drained
    // back at a lead of 8: the 6 hours led are reached 2 minutes late, not 6 hours late
    const back = advance(saved(dip), t({ passed: 8 }), T0 + 5 * H + M)
    expect(back.changes_at).toBe(new Date(T0 + 6 * H + 2 * M).toISOString())
    // and a dip that lasts drains the hours led away entirely
    expect(advance(saved(five), t({ passed: 8, on_track: 7 }), T0 + 11 * H).leading_since).toBe(null)
  })

  it('a new challenger starts from nothing', () => {
    const ten = advance(start, t({ blocked: 2 }), T0 + 10 * H)
    const passedNow = advance(saved(ten), t({ blocked: 2, passed: 4 }), T0 + 10 * H)
    expect(passedNow).toMatchObject({ challenger: 'passed', lead: 4, lead_hours: 0, leading_since: at(10), changes_at: at(22) })
    // and when nobody backs another status, there's no challenger and nothing gathered
    expect(advance(saved(ten), t({ on_track: 3 }), T0 + 11 * H)).toMatchObject({ challenger: null, lead_hours: 0, lead: 0 })
  })

  it('a tie keeps the challenger it had, else the first in order', () => {
    expect(advance(start, t({ dead_end: 2, passed: 2, blocked: 2 }), T0)).toMatchObject({ challenger: 'blocked' })
    const passed = advance(start, t({ passed: 3 }), T0 + 4 * H) // 12 gathered
    const tied = advance(saved(passed), t({ passed: 3, blocked: 3 }), T0 + 5 * H)
    expect(tied).toMatchObject({ challenger: 'passed', lead_hours: 15, leading_since: at(0) })
  })

  it('changes again with new backing: on track, blocked, then on track again', () => {
    const blocked = advance(start, t({ on_track: 1, blocked: 5 }), T0 + 13 * H)
    expect(blocked).toMatchObject({ current: 'blocked', changed_at: at(12), challenger: 'on_track', lead: -4 })
    const back = advance(saved(blocked), t({ on_track: 6, blocked: 2 }), T0 + 13 * H)
    expect(back).toMatchObject({ current: 'blocked', challenger: 'on_track', lead: 4, leading_since: at(13), changes_at: at(25) })
    expect(advance(saved(back), t({ on_track: 6, blocked: 2 }), T0 + 26 * H)).toMatchObject({ current: 'on_track', changed_at: at(25), challenger: 'blocked', lead: -4 })
  })

  it('reads advance to now, and nothing freezes it: a status keeps moving with its backing', () => {
    const stored = saved(advance(start, t({ passed: 2 }), T0 + 10 * H))
    expect(nodeStatus(stored, t({ passed: 2 }), T0 + 12 * H)).toEqual({
      current: 'on_track',
      changed_at: at(0),
      backing: t({ passed: 2 }),
      challenger: { status: 'passed', lead: 2, lead_hours: 24, changes_at: at(24), needs: null },
    })
    expect(nodeStatus(stored, t({ passed: 2 }), T0 + 30 * H)).toMatchObject({ current: 'passed', changed_at: at(24), challenger: null })
    expect(nodeStatus(stored, t({ passed: 2 }), T0 + 500 * H)).toMatchObject({ current: 'passed', changed_at: at(24) })
    // no row yet: no status, nothing gathered
    expect(nodeStatus(null, t({}), T0)).toEqual({ current: null, changed_at: null, backing: t({}), challenger: null })
  })
})

describe('no status until someone backs one (decided Oct 17)', () => {
  it('a new node has none, and nothing gathers while nobody backs anything', () => {
    expect(advance(fresh, t({}), T0 + 100 * H)).toEqual({ ...fresh, at: at(100), lead: 0, changes_at: null, needs: null, flips: [] })
  })

  it('its first on-track vote makes it on track at once, with no wait', () => {
    const b = advance(fresh, t({ on_track: 1 }), T0 + 2 * H)
    expect(b).toMatchObject({ current: 'on_track', changed_at: at(0), challenger: null, lead: 0, at: at(2) })
    expect(b.flips).toEqual([{ from: null, to: 'on_track', at: at(0), backers: 1, against: 0 }])
  })

  it('a claim takes the rubber band against nothing: one person alone never passes a node', () => {
    expect(advance(fresh, t({ passed: 1 }), T0 + 500 * H)).toMatchObject({ current: null, challenger: 'passed', lead: 1, needs: 1, changes_at: null, flips: [] })
    const two = advance(fresh, t({ passed: 2 }), T0 + 30 * H)
    expect(two).toMatchObject({ current: 'passed', changed_at: at(24) })
    expect(two.flips).toEqual([{ from: null, to: 'passed', at: at(24), backers: 2, against: 0 }])
  })

  it('on track against other backing leads the next most-backed status, as any challenger', () => {
    expect(advance(fresh, t({ on_track: 1, blocked: 1 }), T0 + 500 * H)).toMatchObject({ current: null, challenger: 'on_track', lead: 0, needs: 2 })
    const b = advance(fresh, t({ on_track: 3, blocked: 1 }), T0 + 30 * H)
    expect(b.flips).toEqual([{ from: null, to: 'on_track', at: at(24), backers: 3, against: 1 }])
  })

  it('never goes back to none: taking every vote back leaves the status it had', () => {
    const on = advance(fresh, t({ on_track: 1 }), T0 + H)
    expect(advance(saved(on), t({}), T0 + 100 * H)).toMatchObject({ current: 'on_track', changed_at: at(0), flips: [] })
  })
})
