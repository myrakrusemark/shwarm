// Go-live docs sync (Oct 9): the mockups, the footer pages the site serves and openapi.yaml follow "No lobby",
// "Variants are dropped" and "An ended shwarm is locked" / "Continuing an ended shwarm is always build on" (all decided
// Oct 9). The docs keep these words only as history, so they aren't checked here; the pages people and agents read are.
// holding.html is left out: its manifesto lines wait on Myra's wording (go-live 8.1, open question #94).
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { schemaErrors, spec } from './contract'

const MOCKUPS = new URL('../../../mockups/', import.meta.url)
// A lobby and its seats, kickoff and the filling tab; variants (not CSS's font-variant); reopening; the old name of the
// pinned status post.
const RETIRED = /\blobb(?:y|ies)\b|\bseats?\b|\bkickoff\b|\bfilling\b|(?<!font-)\bvariants?\b|\breopen|where we are/gi

describe('retired terms (docs sync, Oct 9)', () => {
  it('no mockup page speaks of a lobby, seats, variants or reopening', () => {
    const files = readdirSync(MOCKUPS).filter(f => f.endsWith('.html') && f !== 'holding.html')
    expect(files.length).toBeGreaterThan(10)
    const hits = files.flatMap(f => (readFileSync(new URL(f, MOCKUPS), 'utf8').match(RETIRED) ?? []).map(m => `${f}: ${m}`))
    expect(hits).toEqual([])
  })

  it("the site's footer pages don't either", () => {
    const pages = readFileSync(new URL('../src/content/pages.json', import.meta.url), 'utf8')
    expect(pages.match(RETIRED) ?? []).toEqual([])
  })

  // Only an ended shwarm has "build on this" and "challenged by" on the site (OPEN #92), so how it works says so.
  it("how it works offers building on a shwarm, not a branch", () => {
    const pages = JSON.parse(readFileSync(new URL('../src/content/pages.json', import.meta.url), 'utf8'))
    const done = pages.find((p: any) => p.slug === 'how-it-works').sections.find((s: any) => s.id === 'done').body as string
    const carryOn = done.split(/(?<=\.) /).filter(s => /builds on it/.test(s))
    expect(carryOn).toHaveLength(1)
    expect(carryOn[0]).toMatch(/^to keep a shwarm going\b/)
  })

  it("the PRD's result page keeps the thread locked", () => {
    const prd = readFileSync(new URL('../../../docs/prd.md', import.meta.url), 'utf8')
    const closed = prd.split('\n').filter(l => /^- \*\*CLOSED-\d+\*\*/.test(l))
    expect(closed.length).toBeGreaterThan(10)
    expect(closed.filter(l => /stays open|\brepros?\b/.test(l))).toEqual([])
    expect(closed.find(l => l.startsWith('- **CLOSED-12**'))).toMatch(/it's locked\./)
  })
})

describe('openapi.yaml after the docs sync', () => {
  const schemas = spec.components.schemas

  it('has three node states and two kinds', () => {
    expect(schemas.NodeState.enum).toEqual(['live', 'closed', 'dead_end'])
    expect(schemas.Node.properties.kind.enum).toEqual(['shwarm', 'branch'])
    expect(schemas.NodeCreated.properties.kind.enum).toEqual(['shwarm', 'branch'])
  })

  it('has no variant create, seats or lobby size', () => {
    for (const gone of ['CreateVariant', 'Seats', 'LobbyFields']) expect(schemas[gone], gone).toBeUndefined()
    expect(schemas.Node.properties.seats).toBeUndefined()
    expect(schemas.NodeCreated.properties.seats).toBeUndefined()
    const create = spec.paths['/shwarms'].post as any
    expect(create.requestBody.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/CreateShwarm' })
  })

  it('a new shwarm takes neither variant_of nor lobby', () => {
    const body = { as: '@myra/m-04', title: 't', what: 'w', done_when: 'd', check: { author: true }, tags: ['#weird'] }
    expect(schemaErrors('CreateShwarm', body)).toEqual([])
    expect(schemaErrors('CreateShwarm', { ...body, lobby: 12 })).not.toEqual([])
    expect(schemaErrors('CreateShwarm', { ...body, variant_of: 'minecraft-in-doom' })).not.toEqual([])
  })

  it("the locked refusal's example is a valid error body", () => {
    const ex = (spec.components as any).responses.Conflict.content['application/json'].examples.shwarm_closed.value
    expect(ex).toMatchObject({ error: 'shwarm_closed', state: 'closed', locked_by: 'minecraft-in-doom' })
    expect(schemaErrors('Error', ex)).toEqual([])
    expect(schemaErrors('Error', { ...ex, state: 'lobby' })).not.toEqual([])
  })
})
