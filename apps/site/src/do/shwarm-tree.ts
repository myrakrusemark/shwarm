// ShwarmTree: one Durable Object per root shwarm (idFromName of its path; new top-level shwarms share ':new').
// It holds a TreeEngine, whose promise queue runs the tree's commands one at a time. A Durable Object lets
// other requests in while one awaits D1, so the queue, not the runtime, is what serializes them.
// Internal only: the Worker reaches it through runInTree(); nothing outside the Worker can address it.
// (Fetch-based on purpose: no 'cloudflare:workers' import, so the class loads in Node tests too.)
import { isErrorCode, ShwarmError } from '@shwarm/protocol'
import { TreeEngine, treeName, type Command } from '../core/engine'
import { actsLimited } from '../core/site-mode'

type TreeEnv = { DB: D1Database; ENV?: string; SITE_MODE?: string }

export class ShwarmTree {
  private engine: TreeEngine

  constructor(
    readonly state: DurableObjectState,
    env: TreeEnv,
  ) {
    this.engine = new TreeEngine(env.DB, Date.now, { beta: actsLimited(env) })
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method !== 'POST') return Response.json({ error: 'bad_request', message: 'POST a command' }, { status: 405 })
    let cmd: Command
    try {
      cmd = await req.json<Command>()
    } catch {
      return Response.json({ error: 'bad_request', message: 'not JSON' }, { status: 400 })
    }
    try {
      return Response.json({ ok: true, result: await this.engine.run(cmd) })
    } catch (e) {
      if (e instanceof ShwarmError) {
        const headers: Record<string, string> = {}
        if (e.code === 'rate_limited' && typeof e.details.retry_after === 'number') headers['Retry-After'] = String(e.details.retry_after)
        return Response.json({ ok: false, ...e.toJSON() }, { status: e.status, headers })
      }
      console.error('tree command failed', e)
      return Response.json({ ok: false, error: 'internal', message: 'something went wrong. try again' }, { status: 500 })
    }
  }
}

/** Send a command to its tree and return the result, or throw the ShwarmError the tree refused it with. */
export async function runInTree<T = unknown>(ns: DurableObjectNamespace, cmd: Command): Promise<T> {
  const stub = ns.get(ns.idFromName(treeName(cmd)))
  const res = await stub.fetch('https://tree.internal/run', { method: 'POST', body: JSON.stringify(cmd), headers: { 'content-type': 'application/json' } })
  const body = await res.json<{ ok: boolean; result?: T; error?: string; message?: string; [k: string]: unknown }>()
  if (body.ok) return body.result as T
  if (body.error && isErrorCode(body.error)) {
    const { ok: _ok, error: _error, message, ...details } = body
    throw new ShwarmError(body.error, message, details)
  }
  throw new Error(`tree failed: ${res.status} ${body.message ?? ''}`)
}
