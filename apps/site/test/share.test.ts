// The share button and sheet on a shwarm or branch page (decided Nov 23; web/node-page.tsx ShareSheet,
// static/js/share.js). The image is drawn in the reader's browser, so these check what the page hands the script: the
// button, the sheet, the card's data and the post-it links, and that the script, the page and the fonts agree.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXAMPLE_BRANCH, EXAMPLE_ROOT } from '../src/seed/example'
import { resetReadLimit } from '../src/web/read-limit'
import { forgetVersions } from '../src/web/version-memo'
import { scriptJson } from '../src/web/node-page'
import { T0 } from './d1'
import { body, Browser, fakeFetch, testEnv } from './browser'
import { stagingWorld } from './node-fixture'

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

const HTML = { accept: 'text/html' }
const STATIC = join(__dirname, '..', 'static')

async function page(path: string, prep?: (db: any) => void) {
  const w = await stagingWorld()
  prep?.(w.db)
  const b = new Browser(testEnv(w.db))
  const res = await b.req(`/w/${path}`, { headers: HTML })
  expect(res.status).toBe(200)
  return { html: await body(res), db: w.db }
}
const cardOf = (html: string) => {
  const m = /<script type="application\/json" id="sh-data">([\s\S]*?)<\/script>/.exec(html)
  expect(m, 'the card data').not.toBeNull()
  return JSON.parse(m![1])
}

describe('share (decided Nov 23)', () => {
  it('a shwarm page: share in the head, hidden until the script shows it, and the sheet with its parts', async () => {
    const { html } = await page(EXAMPLE_ROOT)
    expect(html).toContain('<button type="button" class="btn plain sh-open" aria-haspopup="dialog" hidden="">share</button>')
    // in the head's state column, after join
    const head = /<section class="head[\s\S]*?<\/section>/.exec(html)![0]
    expect(head).toContain('sh-open')
    expect(html).toMatch(/<div class="dn-scrim sh-scrim" id="sh-scrim" hidden="">\s*<div class="dn sh" role="dialog" aria-modal="true" aria-labelledby="sh-title">/)
    expect(html).toContain('<span>share this shwarm</span><button type="button" id="sh-close" aria-label="close">×</button>')
    expect(html).toContain('<canvas id="sh-canvas" width="1200" height="630" role="img" aria-label="the share image for this shwarm"></canvas>')
    for (const id of ['sh-download', 'sh-copy-img', 'sh-app', 'sh-copy-url', 'sh-size-note', 'sh-err', 'sh-url']) expect(html, id).toContain(`id="${id}"`)
    expect(html).toContain('<button type="button" data-size="wide" aria-pressed="true">wide</button>')
    expect(html).toContain('<button type="button" data-size="tall" aria-pressed="false">tall</button>')
    expect(html).toContain('<code id="sh-url">https://shwarm.org/w/minecraft-in-doom</code>')
    expect(html).toContain('<script src="/js/share.js" defer=""></script>')
  })

  it("the card's data: the title, the tags in order, the what's first paragraph as plain text, the links and Myra's words", async () => {
    const { html, db } = await page(EXAMPLE_ROOT)
    const card = cardOf(html)
    const n = db.raw.prepare('SELECT id, title, what FROM node WHERE path = ?').get(EXAMPLE_ROOT)
    const tags = db.raw.prepare('SELECT tag FROM node_tag WHERE node_id = ? ORDER BY rowid').all(n.id).map((r: any) => r.tag)
    expect(card.title).toBe(n.title)
    expect(card.tags).toEqual(tags)
    expect(card.url).toBe('https://shwarm.org/w/minecraft-in-doom')
    expect(card.skill).toBe('https://shwarm.org/skills/shwarm/SKILL.md')
    expect(card.file).toBe('shwarm-minecraft-in-doom')
    // the first paragraph only, plain: no markdown left, one line
    expect(card.what.length).toBeGreaterThan(20)
    expect(card.what).not.toMatch(/\]\(|\*\*|\n/)
    expect(n.what.replace(/\s+/g, ' ')).toContain(card.what.slice(0, 20).replace(/\s+/g, ' ').split(' ')[0])
    expect(card.words).toEqual({
      tagline: 'people + their agents, working on things out in the open.',
      join: 'Join this shwarm!',
      paste: 'paste this image into your coding agent',
      url: 'shwarm:',
      setUp: 'set up:',
      setUpCommand: 'npx @shwarm/cli start <the shwarm url above>',
      skill: 'skill:',
    })
    // nothing on the image changes after posting: no counts, no status
    expect(Object.keys(card).sort()).toEqual(['file', 'skill', 'tags', 'title', 'url', 'what', 'words'])
  })

  it('the post-it links carry the link and title, encoded, and open in a new tab', async () => {
    const { html } = await page(EXAMPLE_ROOT)
    const u = encodeURIComponent('https://shwarm.org/w/minecraft-in-doom'), t = encodeURIComponent('minecraft in doom')
    for (const href of [
      `https://www.reddit.com/submit?url=${u}&title=${t}`,
      `https://bsky.app/intent/compose?text=${encodeURIComponent('minecraft in doom https://shwarm.org/w/minecraft-in-doom')}`,
      `https://news.ycombinator.com/submitlink?u=${u}&t=${t}`,
      `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    ]) expect(html).toContain(`<a href="${href}" target="_blank" rel="noopener noreferrer">`)
  })

  it('a branch page shares too, with no tags on its image (a branch has none)', async () => {
    const { html } = await page(EXAMPLE_BRANCH)
    expect(html).toContain('<span>share this branch</span>')
    const card = cardOf(html)
    expect(card.tags).toEqual([])
    expect(card.url).toBe(`https://shwarm.org/w/${EXAMPLE_BRANCH}`)
    expect(card.file).toBe(`shwarm-${EXAMPLE_BRANCH.split('/').pop()}`)
  })

  it('a paused shwarm offers no share, no sheet and no script', async () => {
    const { html } = await page(EXAMPLE_ROOT, db => db.raw.prepare('UPDATE node SET paused = 1 WHERE path = ?').run(EXAMPLE_ROOT))
    for (const x of ['sh-open', 'sh-scrim', 'sh-data', '/js/share.js']) expect(html, x).not.toContain(x)
  })

  it("the card's JSON can't end its script element or open a comment", () => {
    const out = scriptJson({ title: '</script><script>alert(1)</script><!-- \u2028\u2029' })
    expect(out).not.toMatch(/<|\u2028|\u2029/)
    expect(JSON.parse(out).title).toBe('</script><script>alert(1)</script><!-- \u2028\u2029')
  })

  it('the script, the page and the fonts agree: every id the script reads is on the page, every font it loads is shipped with its license', async () => {
    const js = readFileSync(join(STATIC, 'js', 'share.js'), 'utf8')
    const { html } = await page(EXAMPLE_ROOT)
    const ids = [...js.matchAll(/g\('([a-z-]+)'\)/g)].map(m => m[1])
    expect(ids.length).toBeGreaterThan(5)
    for (const id of new Set(ids)) expect(html, id).toContain(`id="${id}"`)
    // the words the script uses are served to it (window.W.node)
    const { en } = await import('../src/words/en')
    for (const k of [...js.matchAll(/W\.(share[A-Za-z]+)/g)].map(m => m[1])) expect((en.node.script as Record<string, string>)[k], k).toBeTypeOf('string')
    const fonts = [...js.matchAll(/url\(\/fonts\/([^)]+)\)/g)].map(m => m[1])
    expect(fonts).toEqual(['Montserrat-Black.otf', 'LiberationMono-Regular.ttf', 'LiberationMono-Bold.ttf'])
    for (const f of fonts) expect(existsSync(join(STATIC, 'fonts', f)), f).toBe(true)
    for (const l of ['Montserrat-OFL.txt', 'LiberationMono-OFL.txt']) expect(readFileSync(join(STATIC, 'fonts', l), 'utf8')).toMatch(/SIL Open Font License,?\s+Version 1\.1/)
  })
})
