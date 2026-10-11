import { describe, expect, it } from 'vitest'
import { prunePlumbing, pruneReports, purgeNetworks } from '../src/auth/cleanup'
import { stagingWorld } from './node-fixture'
import { createSession, readSession } from '../src/auth/session'
import { ALERT_EVERY, recordUse, type Agent } from '../src/api/signed'
import { addPerson, T0, testDb } from './d1'

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'

async function world() {
  const db = testDb()
  const myra = await addPerson(db, 'myra')
  await db
    .prepare("INSERT INTO agent_key (id, person_id, name, public_key, can_post_as, created_at) VALUES ('k1', ?, 'laptop', 'pk', '@myra/*', ?)")
    .bind(myra, iso(T0))
    .run()
  const agent = { key: { id: 'k1', name: 'laptop' }, person: { id: myra, handle: 'myra' }, used: null } as unknown as Agent
  const all = (sql: string, ...a: unknown[]) => db.raw.prepare(sql).all(...a).map((r: any) => ({ ...r }))
  const mails = () => all("SELECT payload FROM email_outbox WHERE template = 'key_new_network' ORDER BY id").map((m: any) => JSON.parse(m.payload).network)
  return { db, myra, agent, all, mails }
}

describe('IP and browser data goes after 30 days (#61)', () => {
  it('deletes expired sessions and clears the sign-in network and browser of live ones 30 days after sign-in', async () => {
    const w = await world()
    const old = await createSession(w.db, w.myra, { ip: '198.51.100.7', ua: UA }, T0) // kept alive below
    await createSession(w.db, w.myra, { ip: '198.51.100.8', ua: UA }, T0) // left to expire
    const fresh = await createSession(w.db, w.myra, { ip: '203.0.113.9', ua: UA }, T0 + 20 * DAY)
    expect(await readSession(w.db, old, T0 + 25 * DAY)).not.toBeNull() // slides its expiry to day 55

    expect(await purgeNetworks(w.db, T0 + 29 * DAY)).toEqual({ sessions: 0, cleared: 0, networks: 0 })
    expect(await purgeNetworks(w.db, T0 + 31 * DAY)).toEqual({ sessions: 1, cleared: 1, networks: 0 })
    expect(w.all('SELECT created_at, ip_prefix, browser FROM session ORDER BY created_at')).toEqual([
      { created_at: iso(T0), ip_prefix: null, browser: null },
      { created_at: iso(T0 + 20 * DAY), ip_prefix: '203.0.113.0/24', browser: 'firefox · linux' },
    ])
    // the cleared session still signs its person in
    expect(await readSession(w.db, old, T0 + 31 * DAY)).toMatchObject({ handle: 'myra' })
    expect(await readSession(w.db, fresh, T0 + 31 * DAY)).toMatchObject({ handle: 'myra' })
    // nothing left to clear: the count is only what changed
    expect(await purgeNetworks(w.db, T0 + 31 * DAY + 3600_000)).toEqual({ sessions: 0, cleared: 0, networks: 0 })
  })

  it("deletes a key's network 30 days after it was last seen there, so its next use from there is mailed again", async () => {
    const w = await world()
    await recordUse(w.db, w.agent, '198.51.100.7', T0)
    await recordUse(w.db, w.agent, '198.51.100.7', T0 + 5 * DAY) // seen again: its 30 days start over
    await recordUse(w.db, w.agent, '203.0.113.9', T0 + 10 * DAY)
    expect(w.mails()).toEqual(['198.51.100.0/24', '203.0.113.0/24'])

    expect((await purgeNetworks(w.db, T0 + 34 * DAY)).networks).toBe(0)
    expect((await purgeNetworks(w.db, T0 + 36 * DAY)).networks).toBe(1)
    expect(w.all('SELECT ip_prefix FROM key_network')).toEqual([{ ip_prefix: '203.0.113.0/24' }])

    // the pruned network is new to the key again: recorded and mailed, as any new network is
    await recordUse(w.db, w.agent, '198.51.100.20', T0 + 37 * DAY)
    expect(w.mails()).toEqual(['198.51.100.0/24', '203.0.113.0/24', '198.51.100.0/24'])
    expect(w.all('SELECT ip_prefix, first_seen FROM key_network ORDER BY first_seen')).toEqual([
      { ip_prefix: '203.0.113.0/24', first_seen: iso(T0 + 10 * DAY) },
      { ip_prefix: '198.51.100.0/24', first_seen: iso(T0 + 37 * DAY) },
    ])
  })

  it("treats a key's next network as its first once every one is pruned, and its human's sign-in there as cleared after 30 days", async () => {
    const w = await world()
    const s = await createSession(w.db, w.myra, { ip: '198.51.100.7', ua: UA }, T0)
    // the key's first network, where its human signed in: no mail
    await recordUse(w.db, w.agent, '198.51.100.7', T0)
    expect(w.mails()).toEqual([])

    expect(await readSession(w.db, s, T0 + 25 * DAY)).not.toBeNull()
    expect(await purgeNetworks(w.db, T0 + 31 * DAY)).toEqual({ sessions: 0, cleared: 1, networks: 1 })
    // first network again, but the sign-in's network is gone too: mailed
    await recordUse(w.db, w.agent, '198.51.100.7', T0 + 32 * DAY)
    expect(w.mails()).toEqual(['198.51.100.0/24'])
  })

  it("drops a network held back by the hourly pace once it's 30 days old, and the key's next request still works", async () => {
    const w = await world()
    await recordUse(w.db, w.agent, '198.51.100.7', T0)
    await recordUse(w.db, w.agent, '203.0.113.9', T0 + 60_000) // held back: the hour isn't up
    expect(w.all('SELECT ip_prefix, held_at FROM key_network ORDER BY first_seen')).toEqual([
      { ip_prefix: '198.51.100.0/24', held_at: null },
      { ip_prefix: '203.0.113.0/24', held_at: iso(T0 + 60_000) },
    ])
    expect((await purgeNetworks(w.db, T0 + 31 * DAY)).networks).toBe(2)
    await recordUse(w.db, w.agent, '192.0.2.44', T0 + 31 * DAY + ALERT_EVERY)
    expect(w.mails()).toEqual(['198.51.100.0/24', '192.0.2.0/24'])
    expect(w.all('SELECT ip_prefix, held_at FROM key_network')).toEqual([{ ip_prefix: '192.0.2.0/24', held_at: null }])
  })
})

describe('the signed-request plumbing is pruned once it can no longer matter', () => {
  it('deletes idempotency rows past 24 hours, nonces an hour past their expiry, and rate buckets untouched for a day', async () => {
    const w = await world()
    const run = (sql: string, ...a: unknown[]) => w.db.raw.prepare(sql).run(...a)
    const now = T0 + 10 * DAY
    for (const [k, at] of [['old', now - DAY], ['young', now - DAY + 1000]] as const)
      run("INSERT INTO idempotency (key_id, idem_key, request_hash, status, response, created_at) VALUES ('k1', ?, 'h', 201, '{}', ?)", k, iso(at))
    for (const [n, exp] of [['dead', now - 3600_000 - 1000], ['lately', now - 60_000], ['live', now + 200_000]] as const)
      run("INSERT INTO sig_nonce (key_id, nonce, expires_at) VALUES ('k1', ?, ?)", n, iso(exp))
    for (const [b, at] of [['key:k1', now - DAY - 1000], ['thread:1:2', now - 3600_000]] as const)
      run('INSERT INTO rate_bucket (bucket, tokens, updated_at) VALUES (?, 0, ?)', b, iso(at))

    expect(await prunePlumbing(w.db, now)).toEqual({ idempotency: 1, nonces: 1, buckets: 1 })
    expect(w.all('SELECT idem_key FROM idempotency')).toEqual([{ idem_key: 'young' }])
    expect(w.all('SELECT nonce FROM sig_nonce ORDER BY nonce')).toEqual([{ nonce: 'lately' }, { nonce: 'live' }])
    expect(w.all('SELECT bucket FROM rate_bucket')).toEqual([{ bucket: 'thread:1:2' }])
    expect(await prunePlumbing(w.db, now)).toEqual({ idempotency: 0, nonces: 0, buckets: 0 })
  })
})

describe('reports and flags go a year after they were resolved (Myra, Oct 11)', () => {
  it('deletes resolved ones older than a year and keeps open and recent ones', async () => {
    const { db, myraId } = await stagingWorld()
    const node = (db.raw.prepare('SELECT id FROM node ORDER BY id LIMIT 1').get() as any).id
    const ana = await addPerson(db, 'ana')
    const report = db.raw.prepare("INSERT INTO report (url, contact, kind, text, created_at, resolved_at) VALUES ('https://shwarm.org/w/x', 'a@example.com', 'other', 't', ?, ?)")
    report.run(iso(T0), iso(T0 + DAY)) // resolved on day 1
    report.run(iso(T0), iso(T0 + 300 * DAY)) // resolved on day 300
    report.run(iso(T0), null) // still open
    db.raw.prepare("INSERT INTO flag (node_id, person_id, reason, created_at, resolved_at) VALUES (?, ?, 'spam', ?, ?)").run(node, myraId, iso(T0), iso(T0 + DAY))
    db.raw.prepare("INSERT INTO flag (node_id, person_id, reason, created_at, resolved_at) VALUES (?, ?, 'spam', ?, NULL)").run(node, ana, iso(T0))

    expect(await pruneReports(db, T0 + 365 * DAY)).toEqual({ reports: 0, flags: 0 })
    expect(await pruneReports(db, T0 + 367 * DAY)).toEqual({ reports: 1, flags: 1 })
    const left = (sql: string) => db.raw.prepare(sql).all().map((r: any) => r.resolved_at)
    expect(left('SELECT resolved_at FROM report ORDER BY id')).toEqual([iso(T0 + 300 * DAY), null])
    expect(left('SELECT resolved_at FROM flag ORDER BY id')).toEqual([null])
  })
})
