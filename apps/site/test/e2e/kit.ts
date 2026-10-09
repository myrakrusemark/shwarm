// What the browser suites share (go-live 3.8, 5.8): the Chrome to drive, axe-core, the sideways-scroll check.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'

// In-page code below runs in the browser; these names exist there, not in the Workers types this repo compiles with.
declare const document: any
declare const window: any
declare const axe: any
declare const getComputedStyle: any

export const CHROMES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((p): p is string => !!p)
export const chrome = CHROMES.find(p => existsSync(p))
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

/** The page's scroll width against the window's, and the first few elements that stick out. */
export const overflow = (page: Page) =>
  page.evaluate(() => {
    const d = document.documentElement
    const wide = [...document.querySelectorAll('body *')]
      .filter((el: any) => el.getBoundingClientRect().right > window.innerWidth + 0.5 && getComputedStyle(el).position !== 'fixed')
      .slice(0, 5)
      .map((el: any) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}`)
    return { scrollWidth: d.scrollWidth, innerWidth: window.innerWidth, wide }
  })

/** axe-core's serious and critical findings on the page (or inside `include`), one line per node. */
export async function axeViolations(page: Page, include?: string) {
  if (!(await page.evaluate(() => typeof axe !== 'undefined'))) await page.evaluate(AXE)
  const result = await page.evaluate(async (sel: string | null) => {
    const r = await axe.run(sel ? { include: [sel] } : document, { resultTypes: ['violations'] })
    return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n: any) => `${n.target.join(' ')} :: ${(n.any[0] ?? n.all[0] ?? n.none[0])?.message ?? ''}`) }))
  }, include ?? null)
  // As strings, so a failure prints every node in full.
  return (result as { id: string; impact: string; help: string; nodes: string[] }[])
    .filter(v => v.impact === 'serious' || v.impact === 'critical')
    .flatMap(v => v.nodes.map(n => `${v.id} (${v.impact}): ${n}`))
}
