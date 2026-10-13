// /js/words.js (go-live 11.8): the browser scripts' words, from the same word list as the pages. An area that has
// words for its script keeps them under `script` (w.chrome.script); this serves every such block as window.W.<area>,
// plus W.fill, which fills {name} slots the way words/fill.ts does. The layout loads it before any page script.
import type { Context } from 'hono'
import { w } from '.'

export function wordsScript(c: Context) {
  const blocks = Object.fromEntries(Object.entries(w).flatMap(([area, words]) => ('script' in words ? [[area, words.script]] : [])))
  c.header('Cache-Control', 'public, max-age=300')
  c.header('Content-Type', 'text/javascript; charset=utf-8')
  return c.body(`window.W=${JSON.stringify(blocks)};W.fill=(s,v={})=>s.replace(/\\{(\\w+)\\}/g,(m,k)=>k in v?String(v[k]):m);\n`)
}
