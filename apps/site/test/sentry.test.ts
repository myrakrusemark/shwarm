// Go-live 11.3: error reports to Sentry carry the error and the route pattern, and nothing personal.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { frames, parseDsn, reportError, scrub, sentryEvent } from '../src/core/sentry'

const DSN = 'https://0123456789abcdef0123456789abcdef@o1.ingest.us.sentry.io/42'

afterEach(() => vi.unstubAllGlobals())

describe('scrub', () => {
  it('blanks email addresses and long tokens, and keeps ordinary words', () => {
    expect(scrub('no account for myra@example.com, try again')).toBe('no account for [email], try again')
    expect(scrub('key 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 refused')).toBe('key [hex] refused')
    expect(scrub('token eyJhbGciOiJIUzI1NiJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0 bad')).toBe('token [token] bad')
    expect(scrub('Cannot read properties of undefined (reading "title")')).toBe('Cannot read properties of undefined (reading "title")')
  })
})

describe('frames', () => {
  it('turns a V8 stack into frames, oldest first', () => {
    const stack = 'TypeError: x\n    at render (index.js:10:5)\n    at async dispatch (index.js:200:7)\n    at index.js:3:1'
    expect(frames(stack)).toEqual([
      { function: undefined, filename: 'index.js', lineno: 3, colno: 1, in_app: true },
      { function: 'async dispatch', filename: 'index.js', lineno: 200, colno: 7, in_app: true },
      { function: 'render', filename: 'index.js', lineno: 10, colno: 5, in_app: true },
    ])
  })
})

describe('parseDsn', () => {
  it('reads the key and the envelope url, and refuses anything else', () => {
    expect(parseDsn(DSN)).toEqual({ key: '0123456789abcdef0123456789abcdef', url: 'https://o1.ingest.us.sentry.io/api/42/envelope/' })
    expect(parseDsn('http://key@host/1')).toBeNull()
    expect(parseDsn('')).toBeNull()
  })
})

describe('sentryEvent', () => {
  it('holds the error, route pattern, method, source and environment, and no personal data', () => {
    const err = new Error('lookup failed for myra@example.com')
    const ev = sentryEvent(err, { source: 'request', route: '/w/:path{.+}', method: 'POST' }, { ENV: 'staging', SENTRY_DSN: DSN }, 1_700_000_000_000)
    expect(Object.keys(ev).sort()).toEqual(['environment', 'event_id', 'exception', 'level', 'platform', 'tags', 'timestamp', 'transaction'])
    expect(ev.tags).toEqual({ source: 'request', route: '/w/:path{.+}', method: 'POST' })
    expect(ev.environment).toBe('staging')
    expect(ev.exception.values[0]).toMatchObject({ type: 'Error', value: 'lookup failed for [email]' })
    expect(JSON.stringify(ev)).not.toContain('myra@example.com')
    expect(ev.event_id).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('reportError', () => {
  it('posts one envelope to the DSN with the key in the auth header', async () => {
    const fetch = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    await reportError(new Error('boom'), { source: 'cron:mail' }, { ENV: 'production', SENTRY_DSN: DSN })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://o1.ingest.us.sentry.io/api/42/envelope/')
    expect((init.headers as Record<string, string>)['X-Sentry-Auth']).toContain('sentry_key=0123456789abcdef0123456789abcdef')
    const [head, item, event] = String(init.body).trim().split('\n').map(l => JSON.parse(l))
    expect(item).toEqual({ type: 'event' })
    expect(head.event_id).toBe(event.event_id)
    expect(event.tags).toEqual({ source: 'cron:mail' })
  })

  it('sends nothing without a DSN, and never throws when the send fails', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', fetch)
    await reportError(new Error('boom'), { source: 'request' }, { ENV: 'test' })
    expect(fetch).not.toHaveBeenCalled()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(reportError(new Error('boom'), { source: 'request' }, { SENTRY_DSN: DSN })).resolves.toBeUndefined()
  })
})
