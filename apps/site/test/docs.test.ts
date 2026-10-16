// Go-live 7.5: the API docs match what ships. docs/openapi.yaml is what the site serves at /openapi.yaml, and what
// mockups/openapi.yaml holds; every call it lists exists, and every call the API serves is listed; its examples follow
// its own schemas, and the code takes the request examples; its error codes are exactly the ones the code answers
// with; the A10 hash example is the hash the code makes. /docs/reference and /docs/protocol render from the same
// files, with every link on the page landing somewhere and no script from anywhere else.
// After changing docs/openapi.yaml or docs/protocol.md: node scripts/pages/export-api-docs.mjs
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { ERRORS } from '@shwarm/protocol'
import app from '../src/index'
import docs from '../src/content/api-docs.json'
import { api } from '../src/api'
import { siteActor } from '../src/core/actor'
import { TreeEngine } from '../src/core/engine'
import { PAGES } from '../src/web/doc'
import { inline, markdown, slugOf } from '../src/render/markdown'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { ALL_PERMS, keyFor, send, verifiedPerson } from './agent-client'
import { fakeFetch, testEnv } from './browser'
import { hasResponse, schemaErrors, spec as contractSpec } from './contract'
import { T0 } from './d1'
import { stagingWorld } from './node-fixture'

const SITE = 'https://shwarm.org'
const file = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')
const YAML = file('docs/openapi.yaml')
const PROTOCOL = file('docs/protocol.md')
const STALE = 'stale: run node scripts/pages/export-api-docs.mjs'
// the spec, walked by key below
const spec: any = contractSpec

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  vi.spyOn(console, 'warn').mockImplementation(() => {}) // triage has no model here, and says so
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function world() {
  const { db, myraId } = await stagingWorld()
  const env = { ...testEnv(db), SITE_URL: SITE }
  const ana = await verifiedPerson(db, 'ana')
  const key = await keyFor(db, ana.id, { canPostAs: '@ana/*', grants: [{ node: '*', perms: ALL_PERMS }] })
  const get = (path: string, headers: Record<string, string> = {}) =>
    app.fetch(new Request(SITE + path, { headers: { 'cf-connecting-ip': '198.51.100.7', ...headers } }), env)
  return { db, env, myraId, key, get, raw: db.raw as any }
}

/** Every `id="…"` on a page, and every `href="#…"` that doesn't land on one. */
function strayAnchors(html: string): string[] {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))
  return [...html.matchAll(/href="#([^"]*)"/g)].map(m => m[1]).filter(a => a !== 'donate' && !ids.has(a))
}

/** Scripts a page loads: only our own. */
const foreignScripts = (html: string) => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]).filter(s => !s.startsWith('/'))

describe('the served docs are the docs', () => {
  it('serves docs/openapi.yaml as written at /openapi.yaml, readable from other sites, and mockups/openapi.yaml matches', async () => {
    expect(file('mockups/openapi.yaml'), STALE).toBe(YAML)
    expect(docs.openapi_yaml, STALE).toBe(YAML)
    expect(docs.openapi, STALE).toEqual(parse(YAML))
    expect(docs.protocol_md, STALE).toBe(PROTOCOL)
    const w = await world()
    const r = await w.get('/openapi.yaml')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/yaml; charset=utf-8')
    expect(r.headers.get('access-control-allow-origin')).toBe('*')
    expect(await r.text()).toBe(YAML)
    expect(parse(YAML)).toEqual(spec)
  })

  it('renders a reference from it at /docs/reference: every call, schema and refusal, links that land, no outside script', async () => {
    const w = await world()
    const r = await w.get('/docs/reference')
    expect(r.status).toBe(200)
    const html = await r.text()
    const ops = Object.values(spec.paths as Record<string, Record<string, any>>).flatMap(item => Object.values(item).map(op => op?.operationId).filter(Boolean))
    expect(ops.length).toBeGreaterThan(8)
    for (const id of ops) expect(html, id).toContain(`<section id="${id}">`)
    for (const name of Object.keys(spec.components.schemas)) expect(html, name).toContain(`id="schema-${name}"`)
    for (const name of Object.keys(spec.components.responses)) expect(html, name).toContain(`id="response-${name}"`)
    for (const code of spec.components.schemas.ErrorCode.enum) expect(html, code).toContain(`<code>${code}</code>`)
    expect(strayAnchors(html)).toEqual([])
    expect(foreignScripts(html)).toEqual([])
    // a doc the site doesn't serve keeps its words, unlinked
    expect(html).not.toMatch(/href="[^"]*\.md[#"]/)
    expect(html).toContain('href="/docs/protocol#10-keys-and-signing"')
  })

  it('renders docs/protocol.md at /docs/protocol, each heading with the anchor the docs link to', async () => {
    const w = await world()
    const r = await w.get('/docs/protocol')
    expect(r.status).toBe(200)
    const html = await r.text()
    const inCode = (line: number) => PROTOCOL.split('\n').slice(0, line).filter(l => l.startsWith('```')).length % 2 === 1
    const heads = PROTOCOL.split('\n').flatMap((l, i) => (/^#{2,3} /.test(l) && !inCode(i) ? [l.replace(/^#+ /, '')] : []))
    expect(heads.length).toBeGreaterThan(15)
    for (const h of heads) expect(html, h).toContain(`id="${slugOf(h)}"`)
    for (const a of ['10-keys-and-signing', 'links-not-files', 'pinned-work', 'a-nodes-status', 'pass-records', '14-errors', 'the-audit-log', 'build-on-a-shwarm', 'build-on-a-closed-shwarm']) expect(html, a).toContain(`id="${a}"`)
    expect(strayAnchors(html)).toEqual([])
    expect(foreignScripts(html)).toEqual([])
    expect(html).toContain('href="/openapi.yaml"')
    expect(html).not.toMatch(/href="[^"]*\.md[#"]/)
  })

  it("isn't served on production while it shows the holding page, like the reading pages", async () => {
    const w = await world()
    const held = { ...w.env, ENV: 'production', SITE_MODE: 'holding' }
    for (const p of ['/openapi.yaml', '/docs/reference', '/docs/protocol'])
      expect((await app.fetch(new Request(SITE + p, { headers: { 'cf-connecting-ip': '198.51.100.7' } }), held)).status, p).toBe(404)
    const beta = { ...w.env, ENV: 'production', SITE_MODE: 'beta' }
    expect((await app.fetch(new Request(SITE + '/openapi.yaml'), beta)).status).toBe(200)
  })

  it("isn't linked from the footer pages where it isn't served: the api page's rows say not built yet, and no link 404s", async () => {
    const w = await world()
    const at = (env: object) => (p: string) => app.fetch(new Request(SITE + p, { headers: { 'cf-connecting-ip': '198.51.100.7' } }), env)
    const held = at({ ...w.env, ENV: 'production', SITE_MODE: 'holding' })
    const docLinks = (html: string) => [...html.matchAll(/href="(\/openapi\.yaml|\/docs\/[^"]*)"/g)].map(m => m[1])
    for (const { slug } of PAGES) {
      const r = await held('/' + slug)
      expect(r.status, slug).toBe(200)
      const html = await r.text()
      expect(docLinks(html), slug).toEqual([])
      const own = [...new Set([...html.matchAll(/href="(\/[^"#?]*)/g)].map(m => m[1]))].filter(h => !h.startsWith('/css/') && !h.startsWith('/img/'))
      // the agent resources card's /skills says "opens soon" there (go-live 7.6, test/skills.test.ts)
      for (const h of own) expect((await held(h)).status, `${slug} → ${h}`).not.toBe(404)
    }
    const api = await (await held('/api')).text()
    for (const row of ['the openapi spec', 'the api reference', 'the protocol'])
      expect(api, row).toMatch(new RegExp(`<a href="#"><b>${row}</b></a>[^<]*<span class="soon">not built yet</span>`))
    // where the docs are served, the rows link them
    for (const env of [w.env, { ...w.env, ENV: 'production', SITE_MODE: 'beta' }])
      expect(docLinks(await (await at(env)('/api')).text())).toEqual(['/openapi.yaml', '/docs/reference', '/docs/protocol'])
  })
})

describe('openapi.yaml matches the code', () => {
  const METHODS = ['get', 'post'] as const

  it('has a route for every documented call: each answers with a status the spec lists, never "no such call"', async () => {
    const w = await world()
    // a submission from before Oct 14 reads as history (nothing takes them now), so one is written raw on the shwarm;
    // everything else is read on the branch
    const root = w.raw.prepare('SELECT id FROM node WHERE path = ?').get(EXAMPLE_ROOT).id
    if (!w.raw.prepare('SELECT 1 FROM submission WHERE node_id = ? AND number = 2').get(root)) {
      w.raw.prepare("INSERT INTO post (id, node_id, person_id, as_name, kind, text, created_at) VALUES ('p_oldsub0002', ?, ?, '@myra/m-07', 'submission', 'two-line fix on top of #1.', ?)").run(root, w.myraId, new Date(T0 - 3_600_000).toISOString())
      w.raw.prepare("INSERT INTO submission (post_id, node_id, number, hash, how_to_check, status) VALUES ('p_oldsub0002', ?, 2, ?, 'place 200 times per corner.', 'superseded')").run(root, 'b'.repeat(64))
    }
    const fill = (path: string) => path.replace('{nodePath}', path.includes('{number}') ? EXAMPLE_ROOT : EXAMPLE_BRANCH).replace('{number}', '2')
    let checked = 0
    for (const [path, item] of Object.entries(spec.paths))
      for (const m of METHODS) {
        const op = (item as any)[m]
        if (!op) continue
        const security: object[] = op.security ?? spec.security ?? []
        const open = !security.length || security.some(x => !Object.keys(x).length)
        const url = fill(path)
        // a public read answers unsigned; everything signed gets a real key, and a POST an empty object
        const r =
          open && m === 'get'
            ? { status: (await w.get(url + (url.includes('?') ? '&' : '?') + 'format=json')).status, json: null as any }
            : await send(app, w.env, w.key, { method: m.toUpperCase(), path: url, ...(m === 'post' ? { body: {} } : {}) })
        expect(r.status === 404 && r.json?.error === 'not_found', `${m} ${path} has no route`).toBe(false)
        expect(hasResponse(op.operationId, r.status), `${op.operationId} answered ${r.status}`).toBe(true)
        if (open && m === 'get') {
          expect(r.status, `${m} ${path}`).toBe(200)
          const signed = await send(app, w.env, w.key, { path: url })
          expect(signed.status, `signed ${m} ${path}`).toBe(200)
        }
        checked++
      }
    expect(checked).toBe(19)
  })

  it('lists every call the agent API serves', () => {
    const served = api.routes.filter(r => r.method !== 'ALL').map(r => `${r.method} ${r.path}`)
    expect(served.length).toBeGreaterThan(5)
    const documented = Object.entries(spec.paths).flatMap(([p, item]) => METHODS.filter(m => (item as any)[m]).map(m => `${m.toUpperCase()} ${p}`))
    for (const s of served) {
      const [method, path] = s.split(' ')
      const hit = path.endsWith('/*') ? documented.filter(d => d.startsWith(`${method} ${path.slice(0, -1)}`)) : documented.filter(d => d === s)
      expect(hit.length, `${s} isn't in openapi.yaml`).toBeGreaterThan(0)
    }
  })

  it('names exactly the error codes the code answers with, at the status it gives them', () => {
    const site = ['not_found', 'gone', 'server_error']
    expect([...spec.components.schemas.ErrorCode.enum].sort()).toEqual([...Object.keys(ERRORS), ...site].sort())
    const table: string = spec.components.schemas.ErrorCode.description
    for (const [code, status] of [...Object.entries(ERRORS), ['not_found', 404], ['gone', 410], ['server_error', 500]] as [string, number][])
      expect(table, code).toMatch(new RegExp(`\\| ${status} \\| [^\\n]*\`${code}\``))
  })

  it('gives examples that follow its own schemas', () => {
    const schemaOf = (s: any): string | null => s?.$ref?.split('/').pop() ?? null
    const cases: [string, string, unknown][] = []
    const add = (where: string, schema: any, content: any) => {
      const name = schemaOf(schema) ?? (schema?.oneOf ? 'oneOf' : null)
      if (!name) return
      const values = [
        ...(content.example !== undefined ? [content.example] : []),
        ...Object.values(content.examples ?? {}).map((e: any) => (e.$ref ? spec.components.examples[e.$ref.split('/').pop()].value : e.value)),
      ]
      for (const v of values) {
        if (name !== 'oneOf') cases.push([where, name, v])
        else expect(schema.oneOf.some((o: any) => !schemaErrors(schemaOf(o)!, v).length), `${where}: ${JSON.stringify(v).slice(0, 80)}`).toBe(true)
      }
    }
    for (const [path, item] of Object.entries(spec.paths))
      for (const m of METHODS) {
        const op = (item as any)[m]
        if (!op) continue
        const body = op.requestBody?.content?.['application/json']
        if (body) add(`${m} ${path} body`, body.schema, body)
        for (const [status, res] of Object.entries(op.responses ?? {}) as [string, any][]) {
          const json = (res.$ref ? spec.components.responses[res.$ref.split('/').pop()] : res).content?.['application/json']
          if (json) add(`${m} ${path} ${status}`, json.schema, json)
        }
      }
    for (const [name, s] of Object.entries(spec.components.schemas) as [string, any][]) for (const v of s.examples ?? []) if (typeof v === 'object') cases.push([`schema ${name}`, name, v])
    expect(cases.length).toBeGreaterThan(40)
    for (const [where, name, v] of cases) expect(schemaErrors(name, v), `${where} as ${name}`).toEqual([])
  })

  it('takes its own request examples: a thread post, a claim, a passed claim with pins, the vote, a branch and a shwarm made from them', async () => {
    const w = await world()
    const posts = w.raw.prepare("SELECT p.id FROM post p JOIN node n ON n.id = p.node_id WHERE n.path = ? AND p.kind = 'post' ORDER BY p.created_at").all(EXAMPLE_BRANCH)
    const ex = (path: string, method: string, name?: string) => {
      const body = spec.paths[path][method].requestBody.content['application/json']
      return structuredClone(name ? body.examples[name].value : body.example)
    }
    const thread = { ...ex('/w/{nodePath}', 'post', 'threadPost'), as: '@ana/m-04', reply_to: posts[0].id }
    expect((await send(app, w.env, w.key, { path: `/w/${EXAMPLE_BRANCH}`, body: thread })).status).toBe(201)
    // a claim needs the human on the branch: ana joins it on the site
    const ana = w.raw.prepare("SELECT id FROM person WHERE handle = 'ana'").get().id
    await new TreeEngine(w.db, () => T0).run({ type: 'join', actor: siteActor({ id: ana, handle: 'ana' }), input: { node: EXAMPLE_BRANCH } })
    const claim = await send(app, w.env, w.key, { path: `/w/${EXAMPLE_BRANCH}`, body: { ...ex('/w/{nodePath}', 'post', 'claim'), as: '@ana/f-11' } })
    expect(claim.status).toBe(201)
    expect(claim.json.claim).toBe('blocked')
    expect((await send(app, w.env, w.key, { path: `/w/${EXAMPLE_BRANCH}`, body: { ...ex('/w/{nodePath}', 'post', 'statusVote'), as: '@ana/m-04' } })).json).toMatchObject({ status: 'on_track', changed: true })
    // a passed claim on the shwarm, its work pinned (decided Oct 14): ana is on it through the branch
    const passed = await send(app, w.env, w.key, { path: `/w/${EXAMPLE_ROOT}`, body: { ...ex('/w/{nodePath}', 'post', 'passedClaim'), as: '@ana/m-07' } })
    expect(passed.status).toBe(201)
    expect(passed.json.claim).toBe('passed')
    expect(JSON.parse(w.raw.prepare('SELECT links FROM post WHERE id = ?').get(passed.json.id).links)).toEqual(ex('/w/{nodePath}', 'post', 'passedClaim').links)
    const branch = { ...ex('/w/{nodePath}/branches', 'post'), as: '@ana/r-03' }
    expect((await send(app, w.env, w.key, { path: `/w/${EXAMPLE_BRANCH}/branches`, body: branch })).status).toBe(202)
    const shwarm = { ...ex('/shwarms', 'post', 'shwarm'), as: '@ana/scribe', title: 'minecraft in doom, again' }
    const r = await send(app, w.env, w.key, { path: '/shwarms', body: shwarm })
    expect(r.status).toBe(202)
    // the upstream's license stays the upstream's; the shwarm is MIT (decided Oct 15)
    const made = w.raw.prepare('SELECT license, builds_on FROM node WHERE path = ?').get(r.json.node) as { license: string; builds_on: string }
    expect(made.license).toBe('MIT')
    expect(JSON.parse(made.builds_on).license).toBe('GPL-3.0')
  })
})

describe('the docs renderer', () => {
  it('escapes everything but its own few tags, and a raw anchor line', () => {
    const { html } = markdown('<a id="x-1"></a>\n\nhi <script>alert(1)</script> `<b>` **bold** *it* [a](https://x.example/?q="1")', { link: h => h })
    expect(html).toBe('<a id="x-1"></a>\n<p>hi &lt;script&gt;alert(1)&lt;/script&gt; <code>&lt;b&gt;</code> <b>bold</b> <i>it</i> <a href="https://x.example/?q=&quot;1&quot;">a</a></p>')
    expect(markdown('<a id="x" onclick="y"></a>', { link: h => h }).html).toBe('<p>&lt;a id=&quot;x&quot; onclick=&quot;y&quot;&gt;&lt;/a&gt;</p>')
  })

  it("prints a link's text alone where the map has no page for it", () => {
    expect(inline('see [the spec](spec.md#locking) and [§4](#the-audit-log)', h => (h.startsWith('#') ? h : null))).toBe('see the spec and <a href="#the-audit-log">§4</a>')
  })

  it('reads a long line of code spans and brackets with no link in it quickly', () => {
    const line = 'keys: ' + Array.from({ length: 60 }, (_, i) => `[{\`f${i}\`, \`g${i}\``).join(', ')
    const t = performance.now()
    markdown(line, { link: h => h })
    expect(performance.now() - t).toBeLessThan(200)
  })

  it('makes tables, lists, fences and headings with GitHub anchors', () => {
    const { html, headings } = markdown('## 14. Errors (proposed)\n\n| a | b |\n| --- | --- |\n| `x` | y \\| z |\n\n- one\n  more\n- two\n\n```json\n{"a": "<b>"}\n```', { link: h => h })
    expect(headings).toEqual([{ level: 2, id: '14-errors-proposed', text: '14. Errors (proposed)' }])
    expect(html).toContain('<h2 id="14-errors-proposed">')
    expect(html).toContain('<td><code>x</code></td><td>y | z</td>')
    expect(html).toContain('<ul><li>one more</li><li>two</li></ul>')
    expect(html).toContain('<pre class="code"><code>{&quot;a&quot;: &quot;&lt;b&gt;&quot;}</code></pre>')
  })
})
