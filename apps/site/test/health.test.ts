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
  it('locks staging behind a password but leaves health open', async () => {
    const st = { ...env, ENV: 'staging', STAGING_PASSWORD: 'pw' }
    expect((await app.request('/', {}, st)).status).toBe(401)
    expect((await app.request('/healthz', {}, st)).status).toBe(200)
    const ok = await app.request('/', { headers: { Authorization: 'Basic ' + btoa('shwarm:pw') } }, st)
    expect(ok.status).toBe(200)
  })
  it('sets security headers', async () => {
    const res = await app.request('/', {}, env)
    expect(res.headers.get('strict-transport-security')).toContain('max-age=')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
  it('sends www to the apex', async () => {
    const res = await app.request('https://www.shwarm.org/rules?x=1', {}, env)
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://shwarm.org/rules?x=1')
  })
})
