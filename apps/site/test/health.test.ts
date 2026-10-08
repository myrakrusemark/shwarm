import { describe, expect, it } from 'vitest'
import app from '../src/index'

const env = {
  ENV: 'test',
  SITE_MODE: 'holding',
  DB: { prepare: () => ({ first: async () => ({ value: '1' }) }) },
} as any

describe('site', () => {
  it('reports health from D1', async () => {
    const res = await app.request('/healthz', {}, env)
    expect(await res.json()).toEqual({ ok: true, env: 'test', schema: '1' })
  })
  it('serves the holding page with noindex', async () => {
    const res = await app.request('/', {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
  })
  it('sends www to the apex', async () => {
    const res = await app.request('https://www.shwarm.org/rules?x=1', {}, env)
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://shwarm.org/rules?x=1')
  })
})
