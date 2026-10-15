// Go-live 7.6: the agent skill. skills/shwarm/SKILL.md and sandbox.md are what the site serves at
// /skills/shwarm/SKILL.md and /skills/shwarm/sandbox.md, and what /skills shows as a page; mockups/skills.html is
// the same page; every "agent skills" link on the site and in the mockups lands there, never on "#". The skill says
// what the code does: its calls are in openapi.yaml, its error codes are the API's, its limits and name pattern are
// core's, and its gitleaks rule is the repo's.
// After changing skills/shwarm/: node scripts/pages/export-skill.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { ERRORS, NAME_RE } from '@shwarm/protocol'
import app from '../src/index'
import skill from '../src/content/skill.json'
import { PAGES } from '../src/web/doc'
import { EXAMPLE_BRANCH } from '../src/seed/example'
import { THREAD_BURST, THREAD_REFILL_S, NEW_NODES_PER_DAY } from '../src/core/limits'
import { KEY_REQUESTS } from '../src/api/limits'
import { READ_BURST, READ_REFILL_PER_S } from '../src/web/read-limit'
import { MAX_TEXT } from '../src/core/text'
import { fakeFetch, repeatedIds, testEnv } from './browser'
import { T0 } from './d1'
import { stagingWorld } from './node-fixture'

const SITE = 'https://shwarm.org'
const file = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')
const SKILL = file('skills/shwarm/SKILL.md')
const SANDBOX = file('skills/shwarm/sandbox.md')
const STALE = 'stale: run node scripts/pages/export-skill.mjs'

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function world() {
  const { db } = await stagingWorld()
  const env = { ...testEnv(db), SITE_URL: SITE }
  const at = (e: object) => (path: string) => app.fetch(new Request(SITE + path, { headers: { 'cf-connecting-ip': '198.51.100.7' } }), e)
  return { env, get: at(env), held: at({ ...env, ENV: 'production', SITE_MODE: 'holding' }), beta: at({ ...env, ENV: 'production', SITE_MODE: 'beta' }) }
}

/** Every `href="#…"` that doesn't land on an id on the page. */
function strayAnchors(html: string): string[] {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))
  return [...html.matchAll(/href="#([^"]*)"/g)].map(m => m[1]).filter(a => a !== 'donate' && !ids.has(a))
}

/** Where each link whose text is "agent skills" goes. */
const skillLinks = (html: string) => [...html.matchAll(/<a href="([^"]*)">(?:<b>)?agent skills(?:<\/b>)?<\/a>/g)].map(m => m[1])

/** The `## ` headings of a Markdown file, outside code. */
const h2s = (md: string) => {
  let fenced = false
  return md.split('\n').flatMap(l => {
    if (l.startsWith('```')) fenced = !fenced
    return !fenced && l.startsWith('## ') ? [l.slice(3)] : []
  })
}

describe('the served skill is skills/shwarm', () => {
  it('serves SKILL.md and sandbox.md as written, as plain text anyone can read', async () => {
    expect(skill.skill_md, STALE).toBe(SKILL)
    expect(skill.sandbox_md, STALE).toBe(SANDBOX)
    const w = await world()
    for (const [name, text] of [['SKILL.md', SKILL], ['sandbox.md', SANDBOX]]) {
      const r = await w.get(`/skills/shwarm/${name}`)
      expect(r.status, name).toBe(200)
      expect(r.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
      expect(r.headers.get('access-control-allow-origin')).toBe('*')
      expect(await r.text()).toBe(text)
    }
    for (const p of ['/skills/shwarm/LICENSE', '/skills/shwarm/skill.md', '/skills/shwarm/', '/skills/other/SKILL.md'])
      expect((await w.get(p)).status, p).toBe(404)
  })

  it('shows it as a page at /skills: every section of the skill and the sandbox recipe, links that land, our own scripts only', async () => {
    const w = await world()
    const r = await w.get('/skills')
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('<h1>shwarm agent skill</h1>')
    for (const h of h2s(SKILL)) expect(html, h).toContain(`<h2>${h}</h2>`)
    expect(html).toContain('<section id="sandbox-recipe"><h2>sandbox recipe</h2>')
    for (const h of h2s(SANDBOX)) expect(html, h).toContain(`>${h}</h3>`)
    expect(html).toContain('href="/skills/shwarm/SKILL.md"')
    expect(html).toContain('href="/skills/shwarm/sandbox.md"')
    // the skill's links to shwarm.org stay on the site serving it; its link to sandbox.md lands on the recipe
    expect(html).not.toContain('href="https://shwarm.org')
    expect(html).toContain('href="/docs/protocol#10-keys-and-signing"')
    expect(html).toContain('href="#sandbox-recipe"')
    expect(strayAnchors(html)).toEqual([])
    expect(repeatedIds(html)).toEqual([])
    expect([...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]).filter(s => !s.startsWith('/'))).toEqual([])
    expect(html).toContain('<li class="on"><a href="/skills">agent skills</a></li>')
  })

  it("isn't published on production while it shows the holding page: /skills says it opens soon, the files are a 404", async () => {
    const w = await world()
    const r = await w.held('/skills')
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('opens soon.')
    expect(html).not.toContain('sandbox')
    for (const p of ['/skills/shwarm/SKILL.md', '/skills/shwarm/sandbox.md']) expect((await w.held(p)).status, p).toBe(404)
    expect((await w.beta('/skills/shwarm/SKILL.md')).status).toBe(200)
    expect(await (await w.beta('/skills')).text()).toContain('id="sandbox-recipe"')
  })
})

describe('guessed addresses (7.11)', () => {
  it('/skill and /docs move for good to /skills and /api, for a browser and an agent alike', async () => {
    const { env } = await world()
    for (const accept of ['text/html,application/xhtml+xml,*/*;q=0.8', '*/*', 'text/plain', 'application/json']) {
      for (const [from, to] of [['/skill', '/skills'], ['/docs', '/api']]) {
        const r = await app.fetch(new Request(SITE + from, { headers: { accept, 'cf-connecting-ip': '198.51.100.7' } }), env)
        expect(r.status, `${from} ${accept}`).toBe(302)
        expect(new URL(r.headers.get('location')!, SITE).pathname, from).toBe(to)
      }
    }
  })
})

describe('every "agent skills" link goes to the skill', () => {
  it('on the site: the agent resources card and the api page (the keys page: test/keys.test.ts)', async () => {
    const w = await world()
    const pages = ['/', `/w/${EXAMPLE_BRANCH}?format=html`, '/skills', ...PAGES.map(p => '/' + p.slug)]
    for (const p of pages) {
      for (const get of [w.get, w.held]) {
        const r = await get(p)
        if (r.status !== 200) continue
        const html = await r.text()
        if (!html.includes('agent skills')) continue
        const links = skillLinks(html)
        expect(links.length, p).toBeGreaterThan(0)
        expect(new Set(links), p).toEqual(new Set(['/skills']))
      }
    }
    expect(skillLinks(await (await w.get('/api')).text())).toEqual(['/skills', '/skills']) // the next steps row and the card
  })

  it('in the mockups, and mockups/skills.html is the same page', () => {
    const dir = new URL('../../../mockups/', import.meta.url)
    const names = readdirSync(dir).filter(n => n.endsWith('.html'))
    let seen = 0
    for (const n of names) {
      const html = readFileSync(new URL(n, dir), 'utf8')
      expect(html, n).not.toMatch(/href="#"[^>]*>(?:<b>)?agent skills/)
      const links = skillLinks(html)
      if (links.length) expect(new Set(links), n).toEqual(new Set(['skills.html']))
      seen += links.length
    }
    expect(seen).toBeGreaterThan(10)
    const mock = readFileSync(new URL('skills.html', dir), 'utf8')
    for (const h of [...h2s(SKILL), 'sandbox recipe']) expect(mock, `${h}: ${STALE}`).toContain(`<h2>${h}</h2>`)
    expect(mock).toContain('<li class="on"><a href="skills.html">agent skills</a></li>')
  })
})

describe('the skill says what the code does', () => {
  it('is a skill a harness can load: a name and a description in its front matter', () => {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(SKILL)
    expect(m).not.toBeNull()
    const front = parse(m![1])
    expect(front.name).toBe('shwarm')
    expect(typeof front.description).toBe('string')
    expect(front.description.length).toBeLessThanOrEqual(1024)
  })

  it('names only calls openapi.yaml lists', () => {
    const spec = parse(file('docs/openapi.yaml'))
    const paths = Object.keys(spec.paths)
    const calls = [...SKILL.matchAll(/`(GET|POST) ([^`]+)`/g)].map(m => [m[1], m[2]] as const)
    expect(calls.length).toBeGreaterThan(5)
    for (const [method, path] of calls) {
      const p = path.replace(/<node URL>/, '/w/{nodePath}').replace(/<n>/, '{number}').split('?')[0]
      expect(paths, `${method} ${path}`).toContain(p)
      expect(spec.paths[p][method.toLowerCase()], `${method} ${path}`).toBeDefined()
    }
  })

  it("uses only the API's error codes", () => {
    const codes = [...SKILL.matchAll(/^\| `([a-z_]+)` \|/gm)].map(m => m[1])
    expect(codes.length).toBeGreaterThan(8)
    for (const c of codes) expect(Object.keys(ERRORS), c).toContain(c)
    for (const c of [...SKILL.matchAll(/`\d{3} ([a-z_]+)`/g)].map(m => m[1])) expect(Object.keys(ERRORS), c).toContain(c)
  })

  it("gives core's limits, caps and name pattern", () => {
    const row = (what: string) => SKILL.split('\n').find(l => l.startsWith(`| ${what} |`))
    expect(row('thread posts, claims included')).toContain(`a burst of ${THREAD_BURST}, then 1 every ${THREAD_REFILL_S / 60} minutes, per thread`)
    expect(row('new shwarms and branches')).toContain(`${NEW_NODES_PER_DAY} a day`)
    expect(row('submissions')).toBeUndefined() // nothing takes submissions (decided Oct 14)
    expect(row('signed requests')).toContain(`${KEY_REQUESTS} a minute per key`)
    expect(row('unsigned reads')).toContain(`a burst of ${READ_BURST}, then ${READ_REFILL_PER_S} a second`)
    expect(SKILL).toContain(`up to ${MAX_TEXT.toLocaleString('en-US')} characters`)
    expect(SKILL).toContain('`' + NAME_RE.source.replaceAll('\\/', '/') + '`')
  })

  it('says one model for every node: claims and pinned work, pass records, nothing locks, no submissions or checks (decided Oct 14)', () => {
    const section = (h: string) => SKILL.split(`\n## ${h}\n`)[1].split('\n## ')[0]
    expect(h2s(SKILL)).toEqual(expect.arrayContaining(["a node's status", 'when it passes']))
    expect(h2s(SKILL)).not.toEqual(expect.arrayContaining(['submitting', 'checking', 'run reports', "a branch's status"]))
    expect(section('links, not files')).toContain('**Always pin code and files in a passed claim**')
    for (const shape of ['"ipfs": "ipfs://', '"magnet": "magnet:?xt=urn:btih:', '"repo": "rad:z…"']) expect(section('links, not files'), shape).toContain(shape)
    expect(section('when it passes')).toContain('**Nothing locks.**')
    expect(section('when it passes')).toContain('`403 bare_handle_needs_human`')
    expect(SKILL).not.toMatch(/sign-off|sign_off|shwarm_closed|slot_taken|own_work|\?tab=closed/)
  })

  it('puts no participant text through a shell: links and the command come out of the JSON with jq (sandbox.md)', () => {
    const blocks = [...(SKILL + SANDBOX).matchAll(/```sh\n([\s\S]*?)```/g)].map(m => m[1])
    expect(blocks.length).toBeGreaterThan(3)
    const lines = blocks.join('').split('\n').filter(l => l && !l.startsWith('#'))
    // no heredoc: a fixed end marker in someone's command would end it early and run the rest on the host
    for (const l of lines) expect(l, l).not.toContain('<<')
    // fetches take their address from a quoted variable, never from text pasted into the line
    const fetches = lines.filter(l => /\b(curl|git (-c \S+ )*clone)\b/.test(l))
    expect(fetches.length).toBeGreaterThanOrEqual(3) // the node, a file pin, a repo pin
    for (const l of fetches) {
      expect(l, l).not.toContain('://')
      expect(l, l).toMatch(/"\$(url|repo|node)[^"]*"/)
    }
    // downloads are named by index, never by label
    for (const [, out] of lines.join('\n').matchAll(/ -o (\S+)/g)) expect(['node.json', '"work/link-$i"']).toContain(out)
    // the pins come out of the node's JSON, the claim named by its post id in a quoted variable
    expect(SANDBOX).toContain(`jq --arg p "$post" '.status.claims[] | select(.post == $p) | {links: .pins}' node.json > pins.json`)
    expect(SANDBOX).toContain('url=$(jq -r ".links[$i].url" pins.json)')
    expect(SANDBOX).toContain('repo=$(jq -r ".links[$i].repo" pins.json)')
  })

  it("carries the repo's gitleaks rule, and nothing in it looks like a real secret", () => {
    const rule = /```toml\n([\s\S]*?)```/.exec(SKILL)?.[1]
    // The repo's file goes on with its own allowlist of documented example values; the skill carries only the rule.
    expect(rule).toBe(file('.gitleaks.toml').split(/\n(?=\n# )/)[0] + '\n')
    const re = new RegExp(/regex = '''(.*)'''/.exec(rule!)![1])
    expect(re.test(SKILL + SANDBOX)).toBe(false)
  })
})
