// A local server for the browser suite (go-live 3.8): the real Hono app over node:http, on the staging-like test
// database (test/node-fixture.ts), with static/ served first, as Workers assets are. No wrangler, no network.
//
// Test-only switches, read from request headers so a browser page can set them:
//   x-e2e-ip: the client address the app sees (cf-connecting-ip), so a test can drain one network's read bucket.
//   x-e2e-db: 'broken' gives the request a database whose every query throws, to reach the 500 page.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import app from '../../src/index'
import { COOKIE, createSession } from '../../src/auth/session'
import { addPerson, T0 } from '../d1'
import { testEnv } from '../browser'
import { stagingWorld } from '../node-fixture'

const STATIC = fileURLToPath(new URL('../../static/', import.meta.url))
const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
}

/** A launch shwarm the operator hid with a public reason: its URL answers with the 410 tombstone. */
export const HIDDEN = 'kart-race-on-the-moon'

async function world() {
  const { db, myraId } = await stagingWorld({ extra: [HIDDEN] })
  const at = new Date(T0).toISOString()
  db.raw.prepare('UPDATE node SET hidden = 1 WHERE path = ?').run(HIDDEN)
  db.raw
    .prepare("INSERT INTO moderation_action (by_person, action, node_id, reason, public, created_at) SELECT ?, 'hide', id, ?, 1, ? FROM node WHERE path = ?")
    .run(myraId, 'a test takedown for the browser suite.', at, HIDDEN)
  // A closed account (410) and a suspended one (403), both verified so their profiles resolve.
  for (const [handle, status] of [['gone_one', 'closed'], ['held_one', 'suspended']] as const) {
    const id = await addPerson(db, handle, { status })
    db.raw.prepare('UPDATE person SET email_verified_at = ? WHERE id = ?').run(at, id)
  }
  return { db, myraId }
}

const brokenDb = new Proxy({}, { get: () => () => { throw new Error('e2e: the database is down') } }) as D1Database

async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
  headers.set('cf-connecting-ip', String(req.headers['x-e2e-ip'] ?? '127.0.0.1'))
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

export type E2eServer = { origin: string; cookie: { name: string; value: string }; db: Awaited<ReturnType<typeof world>>['db']; close(): Promise<void> }

/** Starts the server on a free port of localhost. `cookie` signs a browser in as @myra (verified). */
export async function startServer(): Promise<E2eServer> {
  const { db, myraId } = await world()
  const env = testEnv(db)
  const token = await createSession(db, myraId, { ip: '127.0.0.1', ua: 'e2e' })
  let origin = ''
  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? '/').split('?')[0]
      if (req.method === 'GET' && path !== '/' && (await sendStatic(path, res))) return
      const ctx = { waitUntil() {}, passThroughOnException() {} }
      const e = req.headers['x-e2e-db'] === 'broken' ? { ...env, DB: brokenDb } : env
      await send(await app.fetch(await toRequest(req, origin), e, ctx as unknown as ExecutionContext), res)
    } catch (err) {
      res.writeHead(599, { 'content-type': 'text/plain' }).end(`the e2e server failed: ${String(err)}`) // never the app's own 500
    }
  })
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  origin = `http://localhost:${(server.address() as AddressInfo).port}`
  return {
    origin,
    db,
    cookie: { name: COOKIE, value: token },
    close: () => new Promise<void>(ok => server.close(() => ok())),
  }
}

// Run directly (npx vite-node test/e2e/server.ts) to click around the test world by hand.
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const s = await startServer()
  console.log(`${s.origin}  (sign in: document.cookie is HttpOnly; set ${s.cookie.name}=${s.cookie.value} with devtools)`)
}
