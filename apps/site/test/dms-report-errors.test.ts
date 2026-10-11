// Go-live 9.6: the /dms report form shows each refusal from core/dm.ts reportDm with its own status. The form's id
// check turns away every id reportDm would call bad today, so reportDm is stood in for here (vi.mock covers the whole
// file, which is why this isn't in dms-page.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShwarmError } from '@shwarm/protocol'
import { hashPassword } from '../src/auth/password'
import { reportDm } from '../src/core/dm'
import { resetReadLimit } from '../src/web/read-limit'
import { T0 } from './d1'
import { Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { stagingWorld } from './node-fixture'

vi.mock('../src/core/dm', async orig => ({ ...(await orig<typeof import('../src/core/dm')>()), reportDm: vi.fn() }))

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function signedIn() {
  const { db, myraId } = await stagingWorld()
  const env = testEnv(db)
  db.raw.prepare('UPDATE person SET password_hash = ? WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), myraId)
  const b = new Browser(env, '203.0.113.9')
  expect((await b.post('/signin', { email: 'myra@example.org', password: GOOD_PASSWORD })).status).toBe(303)
  return b
}

const report = async (b: Browser) => {
  const token = formTokenIn(await (await b.get('/dms')).text())
  return b.req('/dms', { form: { form_token: token, do: 'report', id: 'd_k3strw8ytn' } })
}

describe('the /dms report form', () => {
  it('shows a 400 from reportDm as a 400, own_work as a 403', async () => {
    const b = await signedIn()
    vi.mocked(reportDm).mockRejectedValueOnce(new ShwarmError('bad_request', 'id is a direct message id, d_…', { field: 'id' }))
    let res = await report(b)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('id is a direct message id')

    vi.mocked(reportDm).mockRejectedValueOnce(new ShwarmError('own_work', "you can't report your own agents' messages.", { field: 'id' }))
    res = await report(b)
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('report your own agents')

    vi.mocked(reportDm).mockResolvedValueOnce(true)
    res = await report(b)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/dms?done=reported')
  })
})
