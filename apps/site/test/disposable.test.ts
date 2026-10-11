import { describe, expect, it } from 'vitest'
import { DISPOSABLE_LIST, MIN_DOMAINS, refreshDisposable } from '../src/auth/disposable'
import { isDisposable } from '../src/auth/email'
import { MAIL_CRON, scheduled } from '../src/jobs'
import { addPerson, T0, testDb } from './d1'

const list = (extra: string[] = [], n = MIN_DOMAINS) =>
  ['# comment', '', ...Array.from({ length: n }, (_, i) => `throwaway-${i}.example`), ...extra].join('\n')

/** A fetch that answers the list once, with an ETag, and 304 when asked with it. */
function upstream(body: string, o: { status?: number; etag?: string } = {}) {
  const calls: { url: string; ifNoneMatch: string | null }[] = []
  const get = (async (url: string, init?: RequestInit) => {
    const ifNoneMatch = new Headers(init?.headers).get('if-none-match')
    calls.push({ url, ifNoneMatch })
    if (o.etag && ifNoneMatch === o.etag) return new Response(null, { status: 304 })
    return new Response(body, { status: o.status ?? 200, headers: o.etag ? { etag: o.etag } : {} })
  }) as typeof fetch
  return { get, calls }
}

const count = (db: any) => db.raw.prepare('SELECT COUNT(*) AS n FROM disposable_domain').get().n as number

describe('the weekly disposable-domain refresh (go-live 11.5)', () => {
  it('adds the new domains from the same public list, and asks with the ETag next time', async () => {
    const db = testDb()
    const before = count(db)
    const u = upstream(list(['new-burner.test', 'Mailinator.com', 'BAD DOMAIN', 'com']), { etag: '"v1"' })
    const r = await refreshDisposable(db, u.get)
    expect(u.calls[0]).toEqual({ url: DISPOSABLE_LIST, ifNoneMatch: null })
    expect(r).toEqual({ unchanged: false, listed: MIN_DOMAINS + 2, added: MIN_DOMAINS + 1, spared: 0, skipped: 2 })
    expect(count(db)).toBe(before + MIN_DOMAINS + 1) // mailinator.com was there already
    expect(await isDisposable(db, 'mx.new-burner.test')).toBe(true)
    expect(await isDisposable(db, 'com')).toBe(false)

    expect(await refreshDisposable(db, u.get)).toEqual({ unchanged: true })
    expect(u.calls[1].ifNoneMatch).toBe('"v1"')
  })

  it("spares a domain a verified account's address uses", async () => {
    const db = testDb()
    const ana = await addPerson(db, 'ana')
    db.raw.prepare("UPDATE person SET email = 'ana@mail.uni.example', email_verified_at = ? WHERE id = ?").run(new Date(T0).toISOString(), ana)
    const r = await refreshDisposable(db, upstream(list(['uni.example', 'mail.uni.example'])).get)
    expect(r).toMatchObject({ added: MIN_DOMAINS, spared: 2 })
    expect(await isDisposable(db, 'mail.uni.example')).toBe(false)
  })

  it('fails safe: an error, a short list or a failed fetch changes nothing and never deletes', async () => {
    const db = testDb()
    const before = count(db)
    await expect(refreshDisposable(db, upstream('', { status: 503 }).get)).rejects.toThrow(/http 503/)
    await expect(refreshDisposable(db, upstream(list([], 10)).get)).rejects.toThrow(/only 10 domains/)
    await expect(refreshDisposable(db, upstream('<html>rate limited</html>').get)).rejects.toThrow(/only 0 domains/)
    await expect(refreshDisposable(db, (async () => { throw new TypeError('network down') }) as typeof fetch)).rejects.toThrow(/network down/)
    expect(count(db)).toBe(before)
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM meta WHERE key = 'disposable_etag'").get().n).toBe(0)
  })

  it('runs from the cron on Mondays at 04:23 UTC', async () => {
    const db = testDb()
    const real = globalThis.fetch
    const u = upstream(list(['weekly.test']))
    globalThis.fetch = u.get
    try {
      for (const at of ['2026-10-12T04:22:00Z', '2026-10-13T04:23:00Z', '2026-10-12T04:23:00Z']) {
        const waits: Promise<unknown>[] = []
        await scheduled({ scheduledTime: Date.parse(at), cron: MAIL_CRON, noRetry() {} } as ScheduledController, { DB: db, ENV: 'test', SITE_URL: 'https://shwarm.org' }, {
          waitUntil: (p: Promise<unknown>) => void waits.push(p),
          passThroughOnException() {},
        } as unknown as ExecutionContext)
        await Promise.all(waits)
      }
    } finally {
      globalThis.fetch = real
    }
    expect(u.calls.length).toBe(1)
    expect(await isDisposable(db, 'weekly.test')).toBe(true)
  })
})
