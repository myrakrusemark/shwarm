// Go-live 9.4 and 9.5, the console as a whole: the slices (queue, people, switches, the beta funnel, the public log)
// link to each other, every stylesheet they link exists, and the public log has words for every action.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { MOD_ACTIONS } from '../src/core/moderation'
import { EXAMPLE_BRANCH } from '../src/seed/example'
import { ADMIN_PAGES } from '../src/web/admin-nav'
import { ACTION_WORDS } from '../src/web/moderation-log'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { addPerson, T0 } from './d1'
import { Browser, fakeFetch, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { stagingWorld } from './node-fixture'

const iso = (ms: number) => new Date(ms).toISOString()
const HTML = { accept: 'text/html' }
const POST = 'p_consolelink1'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetReadLimit()
  forgetVersions()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function world() {
  const w = await stagingWorld()
  const env = testEnv(w.db)
  const raw = w.db.raw
  const hash = await hashPassword(GOOD_PASSWORD, pepper, 1000)
  raw.prepare('UPDATE person SET is_admin = 0').run()
  raw.prepare('UPDATE person SET password_hash = ?, is_admin = 1 WHERE id = ?').run(hash, w.myraId)
  const ana = await addPerson(env.DB, 'ana', { hash })
  const bo = await addPerson(env.DB, 'bo', { hash })
  raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id IN (?, ?)').run(iso(T0), ana, bo)
  const branch = (raw.prepare('SELECT id FROM node WHERE path = ?').get(EXAMPLE_BRANCH) as { id: number }).id
  raw
    .prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES (?, ?, ?, '@ana/m-04', 'post', 'look at this', ?)")
    .run(POST, branch, ana, iso(T0 - 60_000))
  const report = raw
    .prepare("INSERT INTO report (node_id, post_id, url, person_id, kind, reason, text, created_at) VALUES (?, ?, ?, ?, 'abuse', 'spam', 'an ad', ?)")
    .run(branch, POST, `/w/${EXAMPLE_BRANCH}#${POST}`, bo, iso(T0 - 50_000)).lastInsertRowid
  const b = new Browser(env)
  expect((await b.post('/signin', { email: 'myra@example.org', password: GOOD_PASSWORD })).status).toBe(303)
  return { env, b, report: Number(report) }
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'))
const sheets = (html: string) => [...html.matchAll(/<link rel="stylesheet" href="(\/css\/[^"]+)"/g)].map(m => m[1])

describe('the admin console as one piece', () => {
  it('every admin page carries the nav, every nav link opens, and every stylesheet linked exists', async () => {
    const { b } = await world()
    for (const [href] of ADMIN_PAGES) {
      const r = await b.req(href, { headers: HTML })
      expect(r.status, href).toBe(200)
      const html = await r.text()
      if (href.startsWith('/admin')) {
        expect(html, href).toContain('class="adminnav"')
        for (const [to] of ADMIN_PAGES) expect(html, `${href} → ${to}`).toContain(to === href ? '<b aria-current="page">' : `href="${to}"`)
      }
      for (const css of sheets(html)) expect(existsSync(resolve(__dirname, '../static', css.slice(1))), `${href}: ${css}`).toBe(true)
    }
  })

  it('the queue links a person to their account page, and the account page links back to the queue pages', async () => {
    const { b, report } = await world()
    const node = await (await b.req(`/admin/node?path=${encodeURIComponent(EXAMPLE_BRANCH)}`, { headers: HTML })).text()
    expect(hrefs(node)).toContain('/admin/people?q=ana') // the post's name, '@ana/m-04', sits under ana
    const post = await (await b.req(`/admin/post?id=${POST}`, { headers: HTML })).text()
    expect(hrefs(post)).toContain('/admin/people?q=ana')
    expect(hrefs(post)).toContain('/admin/people?q=bo') // the reporter
    const queue = await (await b.req('/admin', { headers: HTML })).text()
    expect(hrefs(queue)).toContain('/admin/people?q=bo')

    const people = await (await b.req('/admin/people?q=bo', { headers: HTML })).text()
    const back = hrefs(people)
    expect(back).toContain(`/admin/report?id=${report}`)
    expect(back).toContain(`/admin/node?path=${encodeURIComponent(EXAMPLE_BRANCH)}`)
    expect(back).toContain(`/admin/post?id=${POST}`)
    for (const href of back.filter(h => h.startsWith('/admin/'))) expect((await b.req(href, { headers: HTML })).status, href).toBe(200)
  })

  it('the public log has plain words for every action', () => {
    for (const a of MOD_ACTIONS) expect(ACTION_WORDS[a], a).toMatch(/^[a-z]/)
  })
})
