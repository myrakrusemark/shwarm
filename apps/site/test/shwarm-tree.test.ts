// The ShwarmTree Durable Object over a fake namespace: commands in, results or refusals out, one tree per root.
import { describe, expect, it } from 'vitest'
import { runInTree, ShwarmTree } from '../src/do/shwarm-tree'
import { agent, person, site, World } from './core-fixtures'

/** A stand-in DurableObjectNamespace: one ShwarmTree per name, reached through fetch like the real stub. */
function namespace(db: D1Database) {
  const trees = new Map<string, ShwarmTree>()
  const names: string[] = []
  const ns = {
    idFromName: (name: string) => {
      names.push(name)
      return { name } as unknown as DurableObjectId
    },
    get: (id: { name: string }) => {
      if (!trees.has(id.name)) trees.set(id.name, new ShwarmTree({} as DurableObjectState, { DB: db }))
      const tree = trees.get(id.name)!
      return { fetch: (url: string, init: RequestInit) => tree.fetch(new Request(url, init)) }
    },
  }
  return { ns: ns as unknown as DurableObjectNamespace, names, trees }
}

describe('ShwarmTree', () => {
  it('runs commands in the tree of their root shwarm', async () => {
    const w = new World()
    const myra = await person(w.db, 'myra')
    const kestrel = await person(w.db, 'kestrel')
    const { ns, names, trees } = namespace(w.db)
    const made = await runInTree<{ path: string }>(ns, {
      type: 'createNode',
      actor: site(myra),
      input: { kind: 'shwarm', title: 'minecraft in doom', what: 'w', doneWhen: 'd', check: { author: true }, tags: ['games'], lobby: 2 },
    })
    expect(made.path).toBe('minecraft-in-doom')
    await runInTree(ns, { type: 'join', actor: site(kestrel), input: { node: 'minecraft-in-doom' } })
    await runInTree(ns, { type: 'post', actor: agent(kestrel), input: { node: 'minecraft-in-doom', text: 'hi @myra' } })
    expect(names).toEqual([':new', 'minecraft-in-doom', 'minecraft-in-doom'])
    expect(trees.size).toBe(2)
  })

  it('passes refusals back as ShwarmErrors, with retry_after on rate limits', async () => {
    const w = new World()
    const myra = await person(w.db, 'myra')
    const { ns } = namespace(w.db)
    const e: any = await runInTree(ns, { type: 'join', actor: site(myra), input: { node: 'nope' } }).catch(x => x)
    expect(e.code).toBe('no_such_node')
    expect(e.status).toBe(404)
    expect(e.details).toEqual({ node: 'nope' })
  })

  it('answers bad requests without running anything', async () => {
    const w = new World()
    const tree = new ShwarmTree({} as DurableObjectState, { DB: w.db })
    expect((await tree.fetch(new Request('https://tree.internal/run'))).status).toBe(405)
    expect((await tree.fetch(new Request('https://tree.internal/run', { method: 'POST', body: '{' }))).status).toBe(400)
    const r = await tree.fetch(new Request('https://tree.internal/run', { method: 'POST', body: JSON.stringify({ type: 'nope', actor: {} }) }))
    expect(r.status).toBe(400)
    expect(await r.json()).toMatchObject({ ok: false, error: 'bad_request' })
  })

  it('sets Retry-After on a rate limit', async () => {
    const w = new World()
    const myra = await person(w.db, 'myra')
    const tree = new ShwarmTree({} as DurableObjectState, { DB: w.db })
    const call = (input: object) => tree.fetch(new Request('https://tree.internal/run', { method: 'POST', body: JSON.stringify({ type: 'post', actor: site(myra), input }) }))
    await w.shwarm(site(myra), { lobby: 1 })
    for (let i = 0; i < 5; i++) expect((await call({ node: 'minecraft-in-doom', text: 'hi' })).status).toBe(200)
    const r = await call({ node: 'minecraft-in-doom', text: 'hi' })
    expect(r.status).toBe(429)
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await r.json()).toMatchObject({ error: 'rate_limited', limit: 'thread_posts' })
  })
})
