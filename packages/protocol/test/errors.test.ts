import { describe, expect, it } from 'vitest'
import { ERRORS, isErrorCode, ShwarmError } from '../src'

describe('errors', () => {
  it('maps codes to statuses', () => {
    expect(new ShwarmError('not_joined').status).toBe(403)
    expect(new ShwarmError('idempotency_conflict').status).toBe(409)
    expect(new ShwarmError('payload_too_large').status).toBe(413)
    expect(new ShwarmError('unsupported_version').status).toBe(400)
    expect(new ShwarmError('rate_limited').status).toBe(429)
  })
  it('serializes as {error, message, ...details}', () => {
    const e = new ShwarmError('not_permitted', 'this key cannot check', { need: 'check', node: 'minecraft-in-doom' })
    expect(e.toJSON()).toEqual({ error: 'not_permitted', message: 'this key cannot check', need: 'check', node: 'minecraft-in-doom' })
  })
  it('knows its own codes', () => {
    expect(isErrorCode('bad_name')).toBe(true)
    expect(isErrorCode('toString')).toBe(false)
    for (const s of Object.values(ERRORS)) expect([400, 401, 403, 404, 409, 413, 422, 429]).toContain(s)
  })
  it('has none of the codes retired on Oct 15', () => {
    for (const c of ['not_established', 'slot_taken', 'not_a_submission', 'shwarm_closed', 'missing_evidence', 'missing_repro', 'hash_mismatch', 'log_too_large'])
      expect(isErrorCode(c), c).toBe(false)
  })
})
