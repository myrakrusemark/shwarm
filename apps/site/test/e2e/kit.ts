// What the browser suites share (go-live 3.8, 5.8, 6.2): the Chrome to drive, axe-core, the sideways-scroll check, focus rings.
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

/**
 * The focused element's ring: whether it has one, and its contrast against what's behind it. The ring sits outside
 * the element (outline-offset >= 0), so "behind" is the nearest ancestor background, blended down through any
 * translucent ones; an inset ring (negative offset) sits on the element's own background.
 */
export const focusRing = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    const s = getComputedStyle(el)
    const what = `${el.tagName.toLowerCase()} ${(el.textContent || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 30)}`
    if (s.outlineStyle === 'none' || !(parseFloat(s.outlineWidth) > 0)) {
      return { what, ring: !!(s.boxShadow && s.boxShadow !== 'none'), contrast: null as number | null }
    }
    const rgba = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); return [m[0], m[1], m[2], m[3] ?? 1] }
    const layers: number[][] = []
    for (let n = parseFloat(s.outlineOffset) < 0 ? el : el.parentElement; n; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor)
      if (c[3] > 0) layers.push(c)
      if (c[3] >= 1) break
    }
    let bg = [255, 255, 255]
    for (const c of layers.reverse()) bg = bg.map((v, i) => v * (1 - c[3]) + c[i] * c[3])
    const lum = (c: number[]) => {
      const [r, g, b] = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const a = lum(rgba(s.outlineColor)), b = lum(bg)
    return { what, ring: true, contrast: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 }
  })

/** A ring that's missing or under 3:1, as a line for the failure message; null when it's fine. */
export async function badRing(page: Page): Promise<string | null> {
  const r = await focusRing(page)
  if (!r) return null
  if (!r.ring) return `${r.what}: no ring`
  if (r.contrast !== null && r.contrast < 3) return `${r.what}: ring ${r.contrast}:1`
  return null
}
