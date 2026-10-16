// Go-live docs sync (Oct 9): the mockups, the footer pages the site serves and openapi.yaml follow "No lobby" and
// "Variants are dropped" (decided Oct 9), and since Oct 14 "One model for every node" (nothing locks). The docs keep these words only as history, so they aren't checked here; the pages people and agents read are.
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

  // Nothing locks (decided Oct 14, "One model for every node"): any shwarm can be built on, for a different finish line.
  it("how it works offers building on a shwarm for a different finish line, and says a pass locks nothing", () => {
    const pages = JSON.parse(readFileSync(new URL('../src/content/pages.json', import.meta.url), 'utf8'))
    const passed = pages.find((p: any) => p.slug === 'how-it-works').sections.find((s: any) => s.id === 'passed').body as string
    const carryOn = passed.split(/(?<=\.) /).filter(s => /builds on this one/.test(s))
    expect(carryOn).toHaveLength(1)
    expect(carryOn[0]).toMatch(/^to aim at a different finish line\b/)
    expect(passed).toContain('a pass locks nothing.')
    expect(JSON.stringify(pages)).not.toMatch(/\block(ed|s)? (along with|with it)\b|challenged by/)
  })

  it("the PRD's pass box locks nothing, and the result page's requirements are retired", () => {
    const prd = readFileSync(new URL('../../../docs/prd.md', import.meta.url), 'utf8')
    const pass = prd.split('\n').filter(l => /^- \*\*PASS-\d+\*\*/.test(l))
    expect(pass.length).toBeGreaterThan(5)
    expect(pass.find(l => l.startsWith('- **PASS-7**'))).toMatch(/^- \*\*PASS-7\*\* Nothing locks/)
    expect(prd.split('\n').filter(l => /^- \*\*CLOSED-\d+\*\*/.test(l))).toEqual([])
  })
})

describe('openapi.yaml after the docs sync', () => {
  const schemas = spec.components.schemas

  // Nothing locks (decided Oct 14, "One model for every node"): every node is live, so its state, which only ever said
  // live, left the API (decided Oct 15); how it's going is its status.
  it('has no node state, four statuses and two kinds', () => {
    expect(schemas.NodeState).toBeUndefined()
    for (const s of [schemas.Node, schemas.NodeCreated, schemas.ShwarmList.properties.shwarms.items, schemas.Node.properties.sub_branches.items])
      expect(s.properties.state).toBeUndefined()
    expect(schemas.NodeStatus.enum).toEqual(['on_track', 'blocked', 'passed', 'dead_end'])
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
    const body = { as: '@myra/m-04', title: 't', what: 'w', done_when: 'd', tags: ['#weird'] }
    expect(schemaErrors('CreateShwarm', body)).toEqual([])
    expect(schemaErrors('CreateShwarm', { ...body, lobby: 12 })).not.toEqual([])
    expect(schemaErrors('CreateShwarm', { ...body, variant_of: 'minecraft-in-doom' })).not.toEqual([])
  })

  it('has no locked refusal and no lock fields: nothing locks (decided Oct 14)', () => {
    const responses = JSON.stringify((spec.components as any).responses)
    expect(responses).not.toContain('"error":"shwarm_closed"')
    expect(schemas.Node.properties.locked_by).toBeUndefined()
    expect(schemas.Error.properties.locked_by).toBeUndefined()
    expect(schemas.Node.properties.take_part.properties.locked).toBeUndefined()
  })

  // Old API parts nothing uses are removed (decided Oct 15), at the same address: the fields kept only at a fixed value,
  // the retired kinds and permissions, and the retired error codes.
  it('has no fixed-value fields, retired permissions or retired error codes (Oct 15)', () => {
    for (const k of ['in_review', 'review', 'check', 'license', 'state']) expect(schemas.Node.properties[k], k).toBeUndefined()
    expect(schemas.Node.properties.work_license).toBeDefined()
    expect(schemas.Node.properties.author_approved).toBeDefined()
    expect(schemas.Node.required).toEqual(expect.arrayContaining(['work_license', 'author_approved']))
    for (const k of ['state', 'license']) expect(schemas.NodeCreated.properties[k], k).toBeUndefined()
    for (const k of ['license', 'check']) {
      expect(schemas.CreateShwarm.properties[k], k).toBeUndefined()
      expect(schemas.CreateBranch.properties[k], k).toBeUndefined()
    }
    expect(schemas.CheckSpecRead).toBeUndefined()
    expect(schemas.Upstream.required).toEqual(['name'])
    expect(schemas.KeyPermission.enum).toEqual(['read', 'post', 'branch', 'join', 'pin', 'new_shwarms'])
    const codes = schemas.ErrorCode.enum as string[]
    for (const c of ['not_established', 'slot_taken', 'not_a_submission', 'shwarm_closed', 'missing_evidence', 'missing_repro', 'hash_mismatch', 'log_too_large'])
      expect(codes, c).not.toContain(c)
    expect(JSON.stringify(spec)).not.toMatch(/Retired \(Oct 14\)|Kept, fixed/)
  })
})
