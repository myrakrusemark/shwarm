// Concurrent guesses at sign-in and step-up (go-live 9.6). Every password check here waits at a gate until the test
// opens it, so a whole burst is in flight at once, the way parallel requests are on the real site.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { signIn, stepUp } from '../src/auth/signin'
import { LIMITS } from '../src/auth/throttle'
import { addPerson, T0 } from './d1'
import { GOOD_PASSWORD, pepper, testEnv } from './browser'

const gate = vi.hoisted(() => ({ calls: 0, open: Promise.resolve(), release: () => {} }))
vi.mock('../src/auth/password', async orig => {
  const m = await orig<typeof import('../src/auth/password')>()
  return {
    ...m,
    verifyPassword: async (...a: Parameters<typeof m.verifyPassword>) => {
      gate.calls++
      await gate.open
      return m.verifyPassword(...a)
    },
  }
})

function closeGate() {
  gate.calls = 0
  gate.open = new Promise<void>(r => (gate.release = r))
}
afterEach(() => gate.release())

async function member() {
  const env = testEnv()
  const id = await addPerson(env.DB, 'myra', { hash: await hashPassword(GOOD_PASSWORD, pepper) })
  env.DB.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(new Date(T0).toISOString(), id)
  return { env, id }
}

const kinds = (rs: { kind: string }[]) => rs.reduce<Record<string, number>>((n, r) => ({ ...n, [r.kind]: (n[r.kind] ?? 0) + 1 }), {})

/**
 * Fires `wrong` at once and waits until each is at the password check or already refused without one; then sends
 * `right`, waits the same way, and opens the gate.
 */
async function burst<R extends { kind: string }>(wrong: (() => Promise<R>)[], right: () => Promise<R>) {
  closeGate()
  let settled = 0
  const misses = wrong.map(f => f().finally(() => settled++))
  await vi.waitFor(() => expect(gate.calls + settled).toBe(wrong.length))
  const last = right().finally(() => settled++)
  await vi.waitFor(() => expect(gate.calls + settled).toBe(wrong.length + 1))
  gate.release()
  return { misses: kinds(await Promise.all(misses)), right: (await last).kind }
}

describe('a burst of guesses gets no more tries than the limit', () => {
  it('per address: 30 wrong passwords at once from 30 networks, then the right one waits', async () => {
    const { env } = await member()
    const r = await burst(
      Array.from({ length: 30 }, (_, i) => () => signIn(env.DB, pepper, 'myra@example.org', `guess ${i}`, { ip: `198.51.${i}.1`, ua: null, now: T0 })),
      () => signIn(env.DB, pepper, 'myra@example.org', GOOD_PASSWORD, { ip: '198.51.99.1', ua: null, now: T0 }),
    )
    expect(r.misses).toEqual({ bad: LIMITS.authAddr.tripAt - 1, slow: 30 - (LIMITS.authAddr.tripAt - 1) })
    expect(r.right).toBe('slow')
  })

  it('per network: 40 wrong passwords at once over 5 addresses, then a right one from that network waits', async () => {
    const { env } = await member()
    const r = await burst(
      Array.from({ length: 40 }, (_, i) => () => signIn(env.DB, pepper, `person${i % 5}@example.org`, `guess ${i}`, { ip: '203.0.113.5', ua: null, now: T0 })),
      () => signIn(env.DB, pepper, 'myra@example.org', GOOD_PASSWORD, { ip: '203.0.113.6', ua: null, now: T0 }),
    )
    // 8 per address stays under the address limit; the network's 20th try blocks it
    expect(r.misses).toEqual({ bad: LIMITS.authIp.tripAt - 1, slow: 40 - (LIMITS.authIp.tripAt - 1) })
    expect(r.right).toBe('slow')
  })

  it('at step-up, which needs only a session: 30 wrong at once, then the right one waits', async () => {
    const { env, id } = await member()
    const now = T0 + 11 * 60_000
    const r = await burst(
      Array.from({ length: 30 }, (_, i) => () => stepUp(env.DB, pepper, id, 'sid', `wrong ${i}`, '203.0.113.9', now)),
      () => stepUp(env.DB, pepper, id, 'sid', GOOD_PASSWORD, '203.0.113.9', now),
    )
    expect(r.misses).toEqual({ bad: LIMITS.authAddr.tripAt - 1, slow: 30 - (LIMITS.authAddr.tripAt - 1) })
    expect(r.right).toBe('slow')
  })

  it('a burst under the limit is answered as before, and the right password still gets in', async () => {
    const { env } = await member()
    const r = await burst(
      Array.from({ length: 5 }, (_, i) => () => signIn(env.DB, pepper, 'myra@example.org', `guess ${i}`, { ip: `198.51.${i}.1`, ua: null, now: T0 })),
      () => signIn(env.DB, pepper, 'myra@example.org', GOOD_PASSWORD, { ip: '198.51.99.1', ua: null, now: T0 }),
    )
    expect(r.misses).toEqual({ bad: 5 })
    expect(r.right).toBe('ok')
  })
})
