// A local server for the browser suite (go-live 3.8): the real Hono app over node:http, on the staging-like test
// database (test/node-fixture.ts), with static/ served first, as Workers assets are. No wrangler, no network.
//
// Test-only switches, read from request headers so a browser page can set them:
//   x-e2e-ip: the client address the app sees (cf-connecting-ip), so a test can drain one network's read bucket.
//   x-e2e-db: 'broken' gives the request a database whose every query throws, to reach the 500 page.
//   x-e2e-session: a session token, sent on as the session cookie. A __Host- cookie can't be set on http://localhost,
//     and Chrome drops a cookie header set by hand when it follows a redirect, so a form's 303 would land signed out.
//
// Two worlds: startServer() for the page suite, startLoopServer() for the whole loop (go-live 5.8): four accounts
// with passwords, and a hook that lets a day go by for a node's status (its rubber band runs on hours, core/status.ts).
// Triage answers through a stand-in model that clears everything, so a new shwarm goes public as on staging.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import app from '../../src/index'
import { hashPassword } from '../../src/auth/password'
import { COOKIE, createSession } from '../../src/auth/session'
import { rollupStats } from '../../src/jobs/stats'
import { EXAMPLE_ROOT } from '../../src/seed/example'
import { CATEGORIES } from '../../src/triage/rubric'
import { addPerson, T0 } from '../d1'
import { GOOD_PASSWORD, pepper, testEnv } from '../browser'
import { stagingWorld } from '../node-fixture'

const STATIC = fileURLToPath(new URL('../../static/', import.meta.url))
const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
}

/** A launch shwarm the operator hid with a public reason: its URL answers with the 410 tombstone. */
export const HIDDEN = 'kart-race-on-the-moon'

// Long words that have to wrap, not widen the page (go-live 3.8):
/** A branch whose title has no break points, as an agent might write it. */
export const LONG_BRANCH = `${EXAMPLE_ROOT}/raycast-port`
export const LONG_TITLE = 'block_placement_raycast_for_the_doom_engine_port'
/** A long URL, in the takedown reason and in a post on the example shwarm. */
export const LONG_URL = `https://codeberg.org/${'a'.repeat(150)}/notice`
/** A valid handle at the 32-character limit. */
export const LONG_HANDLE = 'abcdefghijklmnopqrstuvwxyz_abcde'

async function world() {
  const { db, myraId } = await stagingWorld({ extra: [HIDDEN] })
  const at = new Date(T0).toISOString()
  db.raw.prepare('UPDATE node SET hidden = 1 WHERE path = ?').run(HIDDEN)
  db.raw
    .prepare("INSERT INTO moderation_action (by_person, action, node_id, reason, public, created_at) SELECT ?, 'hide', id, ?, 1, ? FROM node WHERE path = ?")
    .run(myraId, `a test takedown for the browser suite. see ${LONG_URL}`, at, HIDDEN)
  const root = db.raw.prepare('SELECT id FROM node WHERE path = ?').get(EXAMPLE_ROOT) as { id: number }
  db.raw
    .prepare(
      `INSERT INTO node (path, slug, kind, parent_id, root_id, title, what, done_when, checks, license, author_id, posted_by, state, triage, created_at)
       VALUES (?, 'raycast-port', 'branch', ?, ?, ?, 'place blocks where the crosshair points.', 'a placed block shows up where the ray hits.', '{}', 'MIT', ?, '@myra', 'live', 'clear', ?)`,
    )
    .run(LONG_BRANCH, root.id, root.id, LONG_TITLE, myraId, at)
  db.raw
    .prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_e2e_long', ?, ?, '@myra', 'post', ?, ?)")
    .run(root.id, myraId, `the notes are here: ${LONG_URL}`, at)
  // A closed account (410) and a suspended one (403), both verified so their profiles resolve.
  for (const [handle, status] of [['gone_one', 'closed'], ['held_one', 'suspended']] as const) {
    const id = await addPerson(db, handle, { status })
    db.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(at, id)
  }
  const longId = await addPerson(db, LONG_HANDLE)
  db.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(at, longId)
  await rollupStats(db, T0)
  return { db, myraId, longId }
}

const brokenDb = new Proxy({}, { get: () => () => { throw new Error('e2e: the database is down') } }) as D1Database

async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
  headers.set('cf-connecting-ip', String(req.headers['x-e2e-ip'] ?? '127.0.0.1'))
  const sid = req.headers['x-e2e-session']
  if (typeof sid === 'string') headers.set('cookie', [headers.get('cookie'), `${COOKIE}=${sid}`].filter(Boolean).join('; '))
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const body = chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined
  return new Request(origin + req.url, { method: req.method, headers, body })
}

async function sendStatic(path: string, res: ServerResponse): Promise<boolean> {
  const file = normalize(join(STATIC, decodeURIComponent(path)))
  if (!file.startsWith(STATIC)) return false
  const s = await stat(file).catch(() => null)
  if (!s?.isFile()) return false
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(await readFile(file))
  return true
}

async function send(r: Response, res: ServerResponse) {
  const headers: Record<string, string | string[]> = {}
  r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v })
  const cookies = (r.headers as unknown as { getSetCookie(): string[] }).getSetCookie()
  if (cookies.length) headers['set-cookie'] = cookies
  res.writeHead(r.status, headers)
  res.end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined)
}

type Cookie = { name: string; value: string }
type Db = Awaited<ReturnType<typeof stagingWorld>>['db']

/** A stand-in for the triage model (Workers AI's Clef): every node is clear ("no" to the hard-block question). */
const clearingModel = {
  run: async () => ({
    model: 'clef-flash',
    answers: {
      hard_block: { type: 'choice', choice: 'no', probabilities: { yes: 0.02, no: 0.96, unsure: 0.02 }, confidence: 0.96 },
      ...Object.fromEntries(CATEGORIES.map(c => [c, { type: 'noul', noul: 0.01 }])),
    },
  }),
} as unknown as Ai

/** The app over node:http on a free port of localhost, on `db`. */
async function serve(db: Db) {
  // MAIL_SECRET, so /unsubscribe reads its token (a bad one is a 400)
  const env = { ...testEnv(db), MAIL_SECRET: 'e2e-mail-secret', AI: clearingModel }
  let origin = ''
  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? '/').split('?')[0]
      if (req.method === 'GET' && path !== '/' && (await sendStatic(path, res))) return
      // waitUntil does nothing: the work handed to it (triage, mail) is already running, and finishes on its own.
      const ctx = { waitUntil() {}, passThroughOnException() {} }
      const e = req.headers['x-e2e-db'] === 'broken' ? { ...env, DB: brokenDb } : env
      await send(await app.fetch(await toRequest(req, origin), e, ctx as unknown as ExecutionContext), res)
    } catch (err) {
      res.writeHead(599, { 'content-type': 'text/plain' }).end(`the e2e server failed: ${String(err)}`) // never the app's own 500
    }
  })
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  origin = `http://localhost:${(server.address() as AddressInfo).port}`
  return { origin, env, close: () => new Promise<void>(ok => server.close(() => ok())) }
}

const session = async (db: Db, personId: number): Promise<Cookie> => ({ name: COOKIE, value: await createSession(db, personId, { ip: '127.0.0.1', ua: 'e2e' }) })

export type E2eServer = { origin: string; cookie: Cookie; longCookie: Cookie; db: Db; close(): Promise<void> }

/** Starts the page suite's server. `cookie` signs a browser in as @myra (verified), `longCookie` as LONG_HANDLE. */
export async function startServer(): Promise<E2eServer> {
  const { db, myraId, longId } = await world()
  const s = await serve(db)
  return { origin: s.origin, db, cookie: await session(db, myraId), longCookie: await session(db, longId), close: s.close }
}

/** The loop's four accounts (go-live 5.8): the author, someone who says it passed, and two who check and back the claim. */
export const LOOP_PEOPLE = ['myra', 'submitter', 'checker', 'runner'] as const
export type LoopPerson = (typeof LOOP_PEOPLE)[number]
/** Every loop account's password, for the author's inline step-up when she marks her shwarm passed. */
export const LOOP_PASSWORD = GOOD_PASSWORD

/** The staging world plus the loop's three other accounts: verified and founding (so established, A6), with passwords. */
async function loopWorld() {
  const { db, myraId } = await stagingWorld()
  const hash = await hashPassword(LOOP_PASSWORD, pepper, 1000)
  const ids = { myra: myraId } as Record<LoopPerson, number>
  db.raw.prepare('UPDATE person SET password_hash = ? WHERE id = ?').run(hash, myraId)
  for (const handle of LOOP_PEOPLE.slice(1)) {
    ids[handle] = await addPerson(db, handle, { hash })
    db.raw.prepare('UPDATE person SET email_verified_at = ?, founding = 1 WHERE id = ?').run(new Date(T0).toISOString(), ids[handle])
  }
  return { db, ids }
}

export type LoopServer = {
  origin: string
  db: Db
  /** A session token for each account, for the x-e2e-session header. */
  sessions: Record<LoopPerson, string>
  /**
   * `hours` go by for `path`'s status: its stored band (core/status.ts) is moved back that far, as if its backing had
   * stood that long, and the stats job runs, writing any change of status that came due, as it would on time.
   */
  passTime(path: string, hours: number): Promise<void>
  close(): Promise<void>
}

export async function startLoopServer(): Promise<LoopServer> {
  const { db, ids } = await loopWorld()
  const s = await serve(db)
  const sessions = {} as Record<LoopPerson, string>
  for (const h of LOOP_PEOPLE) sessions[h] = (await session(db, ids[h])).value
  return {
    origin: s.origin,
    db,
    sessions,
    passTime: async (path, hours) => {
      const back = (iso: string | null) => (iso === null ? null : new Date(Date.parse(iso) - hours * 3_600_000).toISOString())
      const band = db.raw.prepare('SELECT b.node_id, b.at, b.leading_since, b.changed_at FROM branch_status b JOIN node n ON n.id = b.node_id WHERE n.path = ?').get(path) as
        | { node_id: number; at: string; leading_since: string | null; changed_at: string | null }
        | undefined
      if (band) db.raw.prepare('UPDATE branch_status SET at = ?, leading_since = ?, changed_at = ? WHERE node_id = ?').run(back(band.at), back(band.leading_since), back(band.changed_at), band.node_id)
      // the people on it joined that long ago too: a change's notice goes to those on the node at its moment (#138)
      const seats = db.raw.prepare('SELECT s.node_id, s.person_id, s.joined_at, s.left_at FROM seat s JOIN node n ON n.id = s.node_id WHERE n.path = ?1 OR n.path LIKE ?1 || \'/%\'').all(path) as {
        node_id: number
        person_id: number
        joined_at: string
        left_at: string | null
      }[]
      for (const x of seats) db.raw.prepare('UPDATE seat SET joined_at = ?, left_at = ? WHERE node_id = ? AND person_id = ?').run(back(x.joined_at), back(x.left_at), x.node_id, x.person_id)
      await rollupStats(db, Date.now())
    },
    close: s.close,
  }
}

// Run directly (npx vite-node test/e2e/server.ts) to click around the test world by hand.
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const s = await startServer()
  console.log(`${s.origin}  (sign in: document.cookie is HttpOnly; set ${s.cookie.name}=${s.cookie.value} with devtools)`)
}
