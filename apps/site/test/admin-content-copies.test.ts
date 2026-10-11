// Go-live 9.6, the admin's post acts reach every copy of what they act on. A dead-end note is copied into
// node.dead_end_note (the node's page and text, its parent's branch list, the feed's status line), so hiding the note
// blanks those and restoring it puts them back. A check's links are read from check_report (evidence, the repro's
// links, the log link), so /admin/post lists them and removing one takes it from there too.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth/password'
import { rollupStats } from '../src/jobs/stats'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { T0 } from './d1'
import { body, Browser, fakeFetch, formTokenIn, GOOD_PASSWORD, pepper, testEnv } from './browser'
import { PLAIN, stagingWorld } from './node-fixture'

const iso = (ms: number) => new Date(ms).toISOString()
const HTML = { accept: 'text/html' }
const BRANCH_NOTE = 'gzdoom caps dynamic geometry at 4096 sectors.'
const PLAIN_NOTE = 'freedoom bots cannot path through placed voxels.'
const BRANCH_END = 'p_deadendbr01'
const PLAIN_END = 'p_deadendpl01'
const RERUN = 'https://archive.org/download/doom-blocks-checks/corner-rerun.log'
const CORNER = 'https://archive.org/download/doom-blocks-repros/corner-repro.lmp'

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
  const q = <T = any>(sql: string, ...args: unknown[]) => raw.prepare(sql).get(...args) as T
  raw.prepare('UPDATE person SET is_admin = 0').run()
  raw.prepare('UPDATE person SET password_hash = ?, is_admin = 1 WHERE id = ?').run(await hashPassword(GOOD_PASSWORD, pepper, 1000), w.myraId)
  const nodeId = (path: string) => q<{ id: number }>('SELECT id FROM node WHERE path = ?', path).id
  const myra = new Browser(env)
  expect((await myra.post('/signin', { email: 'myra@example.org', password: GOOD_PASSWORD })).status).toBe(303)
  return { ...w, env, raw, q, nodeId, myra }
}

/** POST an act with the token from the page it's on. */
async function act(b: Browser, path: string, fields: Record<string, string>) {
  const token = formTokenIn(await (await b.get(path)).text())
  return b.req(path, { form: { form_token: token, ...fields } })
}

const postUrl = (id: string) => `/admin/post?id=${id}`
const read = async (env: ReturnType<typeof testEnv>, path: string, headers: Record<string, string> = HTML) => {
  forgetVersions()
  return body(await new Browser(env).req(path, { headers }))
}

describe('hiding a dead-end note', () => {
  it('blanks the note on the node page and text, the parent branch list and the feed; restoring it brings it back', async () => {
    const w = await world()
    // The branch and the plain shwarm end as dead ends, as core/nodes.ts deadEnd leaves them: the post and its copy.
    const end = (path: string, id: string, note: string) => {
      w.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES (?, ?, ?, '@myra', 'dead_end', ?, ?)").run(id, w.nodeId(path), w.myraId, note, iso(T0 - 30_000))
      w.raw.prepare("UPDATE node SET state = 'dead_end', dead_end_note = ?, closed_at = ? WHERE id = ?").run(note, iso(T0 - 30_000), w.nodeId(path))
    }
    end(EXAMPLE_BRANCH, BRANCH_END, BRANCH_NOTE)
    end(PLAIN, PLAIN_END, PLAIN_NOTE)
    await rollupStats(w.db, T0)
    const shown = async () => ({
      page: (await read(w.env, `/w/${EXAMPLE_BRANCH}`)).includes(BRANCH_NOTE),
      text: (await read(w.env, `/w/${EXAMPLE_BRANCH}?format=text`, {})).includes(BRANCH_NOTE),
      parent: (await read(w.env, `/w/${EXAMPLE_ROOT}`)).includes(BRANCH_NOTE),
      feed: (await read(w.env, '/?tab=closed')).includes(PLAIN_NOTE),
    })
    const all = { page: true, text: true, parent: true, feed: true }
    expect(await shown()).toEqual(all)

    const parent0 = w.q<{ v: string }>('SELECT last_event_id AS v FROM node WHERE path = ?', EXAMPLE_ROOT).v
    expect((await act(w.myra, postUrl(BRANCH_END), { do: 'hide', reason: 'doxxing' })).status).toBe(303)
    expect((await act(w.myra, postUrl(PLAIN_END), { do: 'hide', reason: 'doxxing' })).status).toBe(303)
    expect(w.q('SELECT dead_end_note FROM node WHERE path = ?', EXAMPLE_BRANCH).dead_end_note).toBe('')
    expect(w.q('SELECT last_event_id AS v FROM node WHERE path = ?', EXAMPLE_ROOT).v).not.toBe(parent0) // its branch list changed
    expect(w.q('SELECT status_line FROM node_stats WHERE node_id = ?', w.nodeId(PLAIN)).status_line).toBe('dead end.')
    expect(await shown()).toEqual({ page: false, text: false, parent: false, feed: false })
    // The stats job, run again, doesn't bring it back.
    await rollupStats(w.db, T0 + 60_000)
    expect((await read(w.env, '/?tab=closed')).includes(PLAIN_NOTE)).toBe(false)

    expect((await act(w.myra, postUrl(BRANCH_END), { do: 'unhide', reason: 'misread it' })).status).toBe(303)
    expect((await act(w.myra, postUrl(PLAIN_END), { do: 'unhide', reason: 'misread it' })).status).toBe(303)
    expect(w.q('SELECT dead_end_note FROM node WHERE path = ?', EXAMPLE_BRANCH).dead_end_note).toBe(BRANCH_NOTE)
    expect(await shown()).toEqual(all)
  })
})

describe('removing a check link', () => {
  const checkWith = (w: Awaited<ReturnType<typeof world>>, like: string, col: 'evidence' | 'repro') =>
    w.q<{ id: string; post_id: string; evidence: string | null; repro: string | null; log_link: string | null }>(
      `SELECT id, post_id, evidence, repro, log_link FROM check_report WHERE ${col} LIKE ?`,
      `%${like}%`,
    )

  it('takes a check evidence link off the submission page, and out of check_report', async () => {
    const w = await world()
    const c = checkWith(w, RERUN, 'evidence')
    const S2 = `/w/${EXAMPLE_BRANCH}/s/2`
    expect(await read(w.env, S2)).toContain(RERUN)
    const was = JSON.stringify(JSON.parse(c.evidence!)[0])
    expect(await body(await w.myra.get(postUrl(c.post_id)))).toContain(RERUN)
    expect((await act(w.myra, postUrl(c.post_id), { do: 'remove_link', link: '0', was, reason: 'malware' })).status).toBe(303)
    expect(checkWith(w, RERUN, 'evidence')).toBeUndefined()
    expect(w.q('SELECT evidence FROM check_report WHERE id = ?', c.id).evidence).toBeNull()
    expect(await read(w.env, S2)).not.toContain(RERUN)
    expect(w.q("SELECT COUNT(*) AS k FROM moderation_action WHERE action = 'remove_link'").k).toBe(1)
  })

  it("lists a check's repro and log links on /admin/post, and removes each from check_report, steps kept", async () => {
    const w = await world()
    const c = checkWith(w, CORNER, 'repro')
    const LOG = { url: 'https://archive.org/download/doom-blocks-checks/soak.log', sha256: 'e'.repeat(64) }
    w.raw.prepare('UPDATE check_report SET log_link = ? WHERE id = ?').run(JSON.stringify(LOG), c.id)
    const page = await body(await w.myra.get(postUrl(c.post_id)))
    expect(page).toContain(CORNER)
    expect(page).toContain(LOG.url)
    const corner = JSON.parse(c.repro!).links[0]
    expect((await act(w.myra, postUrl(c.post_id), { do: 'remove_link', link: '0', was: JSON.stringify(corner), reason: 'malware' })).status).toBe(303)
    const after = JSON.parse(w.q('SELECT repro FROM check_report WHERE id = ?', c.id).repro)
    expect(after).toEqual({ steps: JSON.parse(c.repro!).steps, links: [] })
    // The log link moved up to the first place.
    expect((await act(w.myra, postUrl(c.post_id), { do: 'remove_link', link: '0', was: JSON.stringify(LOG), reason: 'malware' })).status).toBe(303)
    expect(w.q('SELECT log_link FROM check_report WHERE id = ?', c.id).log_link).toBeNull()
    expect(await body(await w.myra.get(postUrl(c.post_id)))).toContain('no links.')
    // A form sent again after the first landed is refused, with nothing changed.
    expect((await act(w.myra, postUrl(c.post_id), { do: 'remove_link', link: '0', was: JSON.stringify(LOG), reason: 'malware' })).status).toBe(400)
    expect(w.q("SELECT COUNT(*) AS k FROM moderation_action WHERE action = 'remove_link'").k).toBe(2)
  })
})
