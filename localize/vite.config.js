// Localize: the site's words in every language, on one page (go-live 11.8).
// Run: npx vite --config localize/vite.config.js   (from the project root) → http://localhost:5175/
//
// English is the source: apps/site/src/words/en/<area>.ts, one file per page area, a comment above each entry saying
// where it shows. Editing English here changes only the text between the quotes; comments and names stay as they are.
// Other languages: apps/site/src/words/translations/<code>.json, one line per English entry ({ text, from, checked }),
// listed in apps/site/src/words/languages.json. The site falls back to English for any line a language lacks.
// The reading pages (footer pages, guides, the manifesto, about) are translated here too, as doc.<slug>.<part> lines
// in the same files. Their English is apps/site/src/content/pages.json, written from scripts/pages/content.py, which
// is where the English changes; here it's read-only.
// "Waiting to ship" means different from the last commit (git HEAD); Claude ships them (commit, tests, deploy).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const WORDS = path.join(ROOT, 'apps/site/src/words')
const EN = path.join(WORDS, 'en')
const LANGS = path.join(WORDS, 'languages.json')
const TRANS = path.join(WORDS, 'translations')
const PAGES = path.join(ROOT, 'apps/site/src/content/pages.json')
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb'])
const rel = f => path.relative(ROOT, f)
const slotsOf = s => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort()
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n')
const shipped = file => { try { return execFileSync('git', ['show', `HEAD:${rel(file)}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null } }

// ---------- English: the area files ----------

// The area files in the order en/index.ts lists them (the order of the site), any others after.
function areas() {
  const files = fs.readdirSync(EN).filter(f => f.endsWith('.ts') && f !== 'index.ts').map(f => f.slice(0, -3))
  const order = [...fs.readFileSync(path.join(EN, 'index.ts'), 'utf8').matchAll(/from '\.\/(\w+)'/g)].map(m => m[1])
  return [...order.filter(a => files.includes(a)), ...files.filter(a => !order.includes(a))]
}

const commentText = (src, ranges) =>
  (ranges ?? []).map(r => src.slice(r.pos, r.end).replace(/^\/\/ ?/, '').replace(/^\/\*+|\*+\/$/g, '').trim()).filter(Boolean).join('\n')

/**
 * An area file as entries: [{ path: ['donateGo'] | ['script', 'donateGo'] | ['posts', 'one'], text, note, start, end }].
 * `note` is the comment above the entry, or above its group (entries under one comment, no blank line between).
 * `start`/`end` are the string literal's place in the file, for writing it back.
 */
function parse(src, file) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)
  const about = commentText(src, ts.getLeadingCommentRanges(src, 0))
  const out = []
  const walk = (obj, at, parentNote) => {
    let group = parentNote
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue
      const name = p.name.getText(sf).replace(/^['"]|['"]$/g, '')
      const note = commentText(src, ts.getLeadingCommentRanges(src, p.getFullStart()))
      if (note) group = note
      else if (/\n\s*\n/.test(src.slice(p.getFullStart(), p.getStart(sf)))) group = parentNote // a blank line ends the group above
      const v = p.initializer
      if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) out.push({ path: [...at, name], text: v.text, note: group ?? '', start: v.getStart(sf), end: v.getEnd() })
      else if (ts.isObjectLiteralExpression(v)) walk(v, [...at, name], group)
    }
  }
  sf.forEachChild(n => {
    if (!ts.isVariableStatement(n)) return
    for (const d of n.declarationList.declarations) if (d.initializer && ts.isObjectLiteralExpression(d.initializer)) walk(d.initializer, [], undefined)
  })
  return { about, entries: out }
}

/** The text as a TypeScript string literal: single quotes unless the text has one and no double quote. */
function literal(text) {
  const q = text.includes("'") && !text.includes('"') ? '"' : "'"
  return q + text.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + q
}

/** Every English entry, area by area: { area, file, about, entries: [{ key, path, text, note, plural, shipped }] }. */
function english() {
  return areas().map(area => {
    const file = path.join(EN, `${area}.ts`)
    const { about, entries } = parse(fs.readFileSync(file, 'utf8'), file)
    const old = shipped(file)
    const before = new Map(old ? parse(old, file).entries.map(e => [e.path.join('.'), e.text]) : [])
    // a plural is an object with exactly one and other
    const forms = new Map()
    for (const e of entries) if (e.path.length > 1) { const b = e.path.slice(0, -1).join('.'); forms.set(b, [...(forms.get(b) ?? []), e.path.at(-1)]) }
    const isPlural = b => { const f = (forms.get(b) ?? []).sort().join(); return f === 'one,other' }
    return {
      area, file: rel(file), about,
      entries: entries.map(e => {
        const key = `${area}.${e.path.join('.')}`
        const base = e.path.slice(0, -1).join('.')
        return { key, path: e.path.join('.'), text: e.text, note: e.note, plural: e.path.length > 1 && isPlural(base) ? e.path.at(-1) : null, shipped: before.get(e.path.join('.')) ?? null }
      }),
    }
  })
}

function saveEnglish(area, entryPath, text) {
  if (!areas().includes(area)) throw new Error('no such area')
  const file = path.join(EN, `${area}.ts`)
  const src = fs.readFileSync(file, 'utf8')
  const e = parse(src, file).entries.find(x => x.path.join('.') === entryPath)
  if (!e) throw new Error('no such entry')
  // A {slot} the code doesn't fill would show on the site as typed, so only the entry's own slots are allowed.
  const old = shipped(file)
  const known = slotsOf(old ? (parse(old, file).entries.find(x => x.path.join('.') === entryPath)?.text ?? e.text) : e.text)
  const extra = slotsOf(text).filter(s => !known.includes(s))
  if (extra.length) throw new Error(`{${extra.join('}, {')}} isn't filled in by the site here. this line's slots: ${known.map(s => `{${s}}`).join(' ') || 'none'}`)
  const next = src.slice(0, e.start) + literal(text) + src.slice(e.end)
  if (parse(next, file).entries.find(x => x.path.join('.') === entryPath)?.text !== text) throw new Error("couldn't write that safely; nothing changed")
  fs.writeFileSync(file, next)
}

// ---------- other languages ----------

const languages = () => readJson(LANGS, [{ code: 'en', name: 'english', dir: 'ltr', source: true }])
const transFile = code => path.join(TRANS, `${code}.json`)
const formsOf = code => new Intl.PluralRules(code).resolvedOptions().pluralCategories

/** The reading pages as areas of lines, one per part: title, lede, the intro's text bits, each section's heading and body. */
function docAreas() {
  return readJson(PAGES, []).map(p => ({
    area: `doc.${p.slug}`,
    about: `the page /${p.slug} ("${p.title}"). its english comes from scripts/pages/content.py; keep every link, tag and bit of code as the english has it.`,
    entries: [
      { key: `doc.${p.slug}.title`, source: p.title, note: 'the page title' },
      { key: `doc.${p.slug}.lede`, source: p.lede, note: 'the line under the title' },
      ...(p.introText ?? []).map((t, i) => ({ key: `doc.${p.slug}.intro.${i}`, source: t, note: 'a bit of text in the figure at the top' })),
      ...p.sections.flatMap(x => [
        { key: `doc.${p.slug}.${x.id}.h`, source: x.h, note: `the heading of section #${x.id}` },
        { key: `doc.${p.slug}.${x.id}.body`, source: x.body, note: `section #${x.id}, as html` },
      ]),
    ],
  }))
}

/** What a page line's translation must keep from its English (test/doc-translations.test.ts checks the same). */
const kept = s => {
  const bag = re => [...s.matchAll(re)].map(m => m.slice(1).join('\u0000')).sort().join('\u0001')
  return { links: bag(/href="([^"]*)"/g), code: bag(/<(code|pre)[^>]*>([\s\S]*?)<\/\1>/g), tags: bag(/<(\/?[a-z0-9]+)/g) }
}

/**
 * A language's lines against the English: one row per English entry, and for a plural one row per form the language
 * uses (English's "other" shown for forms English doesn't have). Status: missing, draft, checked, or stale (the English
 * changed since it was translated). Lines for English entries that no longer exist come back as `orphans`.
 */
function translation(code) {
  const en = english()
  const t = readJson(transFile(code), {})
  const old = (() => { const s = shipped(transFile(code)); try { return s ? JSON.parse(s) : {} } catch { return {} } })()
  const used = new Set()
  const out = en.map(a => {
    const rows = []
    const seen = new Set()
    for (const e of a.entries) {
      if (e.plural) {
        const base = e.key.slice(0, -(e.plural.length + 1))
        if (seen.has(base)) continue
        seen.add(base)
        const ens = Object.fromEntries(a.entries.filter(x => x.key.startsWith(base + '.') && x.plural).map(x => [x.plural, x.text]))
        for (const form of formsOf(code)) rows.push(row(`${base}.${form}`, ens[form] ?? ens.other, e.note, form))
      } else rows.push(row(e.key, e.text, e.note, null))
    }
    return { area: a.area, about: a.about, entries: rows }
  })
  for (const a of docAreas()) out.push({ area: a.area, about: a.about, entries: a.entries.map(e => row(e.key, e.source, e.note, null, true)) })
  function row(key, source, note, form, doc = false) {
    used.add(key)
    const line = t[key]
    const status = !line?.text ? 'missing' : line.from !== source ? 'stale' : line.checked ? 'checked' : 'draft'
    const was = old[key]
    return { key, source, note, form, text: line?.text ?? '', from: line?.from ?? null, checked: !!line?.checked, status, slots: doc ? [] : slotsOf(source), doc, unshipped: JSON.stringify(was ?? null) !== JSON.stringify(line ?? null) }
  }
  const orphans = Object.entries(t).filter(([k]) => !used.has(k)).map(([key, v]) => ({ key, ...v }))
  return { areas: out, orphans }
}

function saveTranslation(code, key, { text, checked }) {
  const lang = languages().find(l => l.code === code && !l.source)
  if (!lang) throw new Error('no such language')
  const row = translation(code).areas.flatMap(a => a.entries).find(r => r.key === key)
  const t = readJson(transFile(code), {})
  if (!row) {
    if (text === '' && t[key]) { delete t[key]; return writeJson(transFile(code), t) } // removing an orphan
    throw new Error('no such English entry')
  }
  if (text === undefined) text = t[key]?.text ?? ''
  text = String(text)
  if (text.length > (row.doc ? 30000 : 4000)) throw new Error('the text is too long')
  if (text.trim() === '') delete t[key]
  else {
    // every slot the English has, and no others: a missing {link} would drop a link from the page
    const want = row.slots, got = slotsOf(text)
    const missing = want.filter(s => !got.includes(s)), extra = got.filter(s => !want.includes(s))
    if (row.doc) {
      const a = kept(row.source), b = kept(text)
      const lost = ['links', 'code', 'tags'].filter(k => a[k] !== b[k])
      if (lost.length) throw new Error(`keep the english's ${lost.join(', ')} exactly as they are; translate only the words around them`)
    }
    if (missing.length || extra.length) throw new Error([missing.length && `keep ${missing.map(s => `{${s}}`).join(' ')}`, extra.length && `{${extra.join('}, {')}} isn't in the english`].filter(Boolean).join('; ') + ' (slots stay as they are; move them anywhere in the sentence)')
    // saving the text means it was looked at against today's English; a changed text is a draft again unless ticked
    const same = t[key]?.text === text
    t[key] = { text, from: row.source, checked: checked ?? (same ? !!t[key]?.checked : false) }
  }
  writeJson(transFile(code), Object.fromEntries(Object.entries(t).sort(([a], [b]) => a.localeCompare(b))))
}

function writeIndex() {
  const codes = languages().filter(l => !l.source).map(l => l.code)
  const id = c => c.replace(/-/g, '_')
  fs.writeFileSync(path.join(TRANS, 'index.ts'),
    `// Written by the localize tool (localize/ at the repo root) when a language is added: one JSON file per language.\n// Don't edit by hand.\nimport type { Translation } from '../index'\n${codes.map(c => `import ${id(c)} from './${c}.json'\n`).join('')}\nexport const translations: Record<string, Translation> = {${codes.length ? ' ' + codes.map(c => (id(c) === c ? c : `'${c}': ${id(c)}`)).join(', ') + ' ' : ''}}\n`)
}

function addLanguage(code, name) {
  let canon
  try { canon = Intl.getCanonicalLocales(String(code).trim())[0] } catch { throw new Error(`"${code}" isn't a language code. use one like ja, pt-BR or zh-Hant`) }
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(canon)) throw new Error(`"${code}" isn't a language code`)
  const all = languages()
  if (all.some(l => l.code.toLowerCase() === canon.toLowerCase())) throw new Error(`${canon} is already here`)
  const shown = String(name || '').trim() || new Intl.DisplayNames(['en'], { type: 'language' }).of(canon)?.toLowerCase() || canon
  all.push({ code: canon, name: shown.slice(0, 60), dir: RTL.has(canon.split('-')[0]) ? 'rtl' : 'ltr' })
  fs.mkdirSync(TRANS, { recursive: true })
  if (!fs.existsSync(transFile(canon))) writeJson(transFile(canon), {})
  writeJson(LANGS, all)
  writeIndex()
  return canon
}

// ---------- the server ----------

function api() {
  return {
    name: 'localize-api',
    configureServer(server) {
      server.watcher.add([WORDS, PAGES])
      server.watcher.on('change', f => { if (path.resolve(f).startsWith(WORDS) || path.resolve(f) === PAGES) server.ws.send({ type: 'custom', event: 'words-changed' }) })
      const json = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)) }
      const post = (req, res, fn) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'post only' })
        let body = ''
        req.on('data', c => (body += c))
        req.on('end', () => { try { json(res, 200, { ok: true, ...(fn(JSON.parse(body || '{}')) ?? {}) }) } catch (e) { json(res, 400, { error: String(e.message) }) } })
      }
      // GET /api/words?lang=ja → { languages, lang, english | translation }
      server.middlewares.use('/api/words', (req, res) => {
        const lang = new URL(req.url, 'http://x').searchParams.get('lang') || 'en'
        try {
          const all = languages()
          const l = all.find(x => x.code === lang)
          if (!l) return json(res, 404, { error: 'no such language' })
          json(res, 200, { languages: all, lang: l, ...(l.source ? { english: english() } : { translation: translation(lang), forms: formsOf(lang) }) })
        } catch (e) { json(res, 400, { error: String(e.message) }) }
      })
      // POST /api/save { lang, key, text, checked? }
      server.middlewares.use('/api/save', (req, res) => post(req, res, ({ lang, key, text, checked }) => {
        if ((lang || 'en') === 'en') {
          const area = String(key).split('.')[0]
          return void saveEnglish(area, String(key).slice(area.length + 1), String(text))
        }
        saveTranslation(lang, key, { text, checked: typeof checked === 'boolean' ? checked : undefined })
      }))
      // POST /api/language { code, name } → { code }
      server.middlewares.use('/api/language', (req, res) => post(req, res, ({ code, name }) => ({ code: addLanguage(code, name) })))
      // GET /api/suggest?code=pt-br → { code, name }: what a code means, for the add-a-language form
      server.middlewares.use('/api/suggest', (req, res) => {
        const code = new URL(req.url, 'http://x').searchParams.get('code') || ''
        try { const c = Intl.getCanonicalLocales(code)[0]; json(res, 200, { code: c, name: new Intl.DisplayNames(['en'], { type: 'language' }).of(c)?.toLowerCase() ?? '' }) } catch { json(res, 200, { code: '', name: '' }) }
      })
    },
  }
}

export default {
  root: here,
  server: { port: 5175, strictPort: true },
  plugins: [api()],
}
