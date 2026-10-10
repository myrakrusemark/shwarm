// A stand-in DurableObjectNamespace for the ShwarmTree: one tree per name, reached through fetch like the real stub.
import { ShwarmTree } from '../src/do/shwarm-tree'

/** `env`: what else the tree's env holds, e.g. SITE_MODE: 'beta'. */
export function treeNamespace(db: D1Database, env: { SITE_MODE?: string } = {}) {
  const trees = new Map<string, ShwarmTree>()
  const names: string[] = []
  const ns = {
    idFromName: (name: string) => {
      names.push(name)
      return { name } as unknown as DurableObjectId
    },
    get: (id: { name: string }) => {
      if (!trees.has(id.name)) trees.set(id.name, new ShwarmTree({} as DurableObjectState, { DB: db, ...env }))
      const tree = trees.get(id.name)!
      return { fetch: (url: string, init: RequestInit) => tree.fetch(new Request(url, init)) }
    },
  }
  return { ns: ns as unknown as DurableObjectNamespace, names, trees }
}
