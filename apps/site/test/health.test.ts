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
  it('serves the holding page with noindex on production', async () => {
    const res = await app.request('/', {}, { ...env, ENV: 'production' })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
  })
  it('locks staging behind a password but leaves health open', async () => {
    const st = { ...env, ENV: 'staging', STAGING_PASSWORD: 'pw' }
    expect((await app.request('/', {}, st)).status).toBe(401)
    expect((await app.request('/healthz', {}, st)).status).toBe(200)
    const ok = await app.request('/rules', { headers: { Authorization: 'Basic ' + btoa('shwarm:pw') } }, st)
    expect(ok.status).toBe(200)
  })
  it('sets security headers', async () => {
    const res = await app.request('/', {}, { ...env, ENV: 'production' })
    expect(res.headers.get('strict-transport-security')).toContain('max-age=')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
  it('serves the footer pages on production, noindex until open', async () => {
    const prod = { ...env, ENV: 'production' }
    const res = await app.request('/rules', {}, prod)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<!doctype html>')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    const open = await app.request('/rules', {}, { ...prod, SITE_MODE: 'open' })
    expect(open.headers.get('x-robots-tag')).toBeNull()
    expect((await app.request('/no-such-page', {}, prod)).status).toBe(404)
  })
  it('serves security.txt', async () => {
    const body = await (await app.request('/.well-known/security.txt', {}, env)).text()
    expect(body).toContain('Contact: mailto:security@shwarm.org')
    expect(body).toMatch(/Expires: \d{4}-/)
  })
  it('sends www to the apex', async () => {
    const res = await app.request('https://www.shwarm.org/rules?x=1', {}, env)
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://shwarm.org/rules?x=1')
  })
})
