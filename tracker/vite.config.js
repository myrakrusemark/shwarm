// Go-live tracker: one page with the progress of docs/go-live.md and only what needs Myra.
// Run: npx vite --config tracker/vite.config.js   (from the project root) → http://localhost:5174/
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const PLAN = path.resolve(here, '../docs/go-live.md')
const REPLIES = path.resolve(here, 'replies.json') // Myra's answers to the decisions; Claude reads this
const LAUNCH = path.resolve(here, '../docs/launch-shwarms.json')
const IDEAS = path.resolve(here, '../docs/shwarm-ideas.json') // new shwarm ideas, reviewed on the same page
const PROOF = path.resolve(here, 'proof.json') // Myra's proofreading verdicts on the launch shwarms (step 12.1)
const DROPS = path.resolve(here, '../docs/launch-drops.md')
const STATUSES =['todo', 'doing', 'done', 'blocked', 'parked']

function planApi() {
  return {
    name: 'go-live-plan',
    configureServer(server) {
      server.watcher.add(PLAN)
      server.watcher.on('change', f => {
        if ([PLAN, REPLIES, LAUNCH, PROOF, IDEAS].includes(path.resolve(f))) server.ws.send({ type: 'custom', event: 'plan-changed' })
      })
      // Launch shwarm cards and Myra's verdict on each (shown on the page when a card waits on her).
      server.watcher.add([LAUNCH, PROOF, IDEAS])
      server.middlewares.use('/launch.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(fs.readFileSync(LAUNCH, 'utf8'))
      })
      server.middlewares.use('/ideas.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(fs.existsSync(IDEAS) ? fs.readFileSync(IDEAS, 'utf8') : '[]')
      })
      // GET /api/proof → {slug: [{from, choice, text, at}]}; POST {slug, choice, text} appends Myra's verdict.
      server.middlewares.use('/api/proof', (req, res) => {
        const read = () => { try { return JSON.parse(fs.readFileSync(PROOF, 'utf8')) } catch { return {} } }
        res.setHeader('Cache-Control', 'no-store')
        if (req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(read())) }
        if (req.method !== 'POST') { res.statusCode = 405; return res.end() }
        let body = ''
        req.on('data', c => (body += c))
        req.on('end', () => {
          try {
            const { slug, choice, text, locked } = JSON.parse(body)
            const ideas = fs.existsSync(IDEAS) ? JSON.parse(fs.readFileSync(IDEAS, 'utf8')) : []
            const slugs = [...JSON.parse(fs.readFileSync(LAUNCH, 'utf8')), ...ideas].map(x => x.slug).concat('_suggest') // _suggest: Myra's own new ideas
            if (!slugs.includes(slug) || !['approve', 'change', 'question', 'idea'].includes(choice) || String(text || '').length > 4000) throw new Error('bad input')
            const all = read()
            ;(all[slug] ||= []).push({ from: 'myra', choice, text: String(text || '').trim(), at: new Date().toISOString(), ...(typeof locked === 'string' && locked.length < 20000 ? { locked } : {}) }) // locked: the done test she approved, so a later change shows the card again
            fs.writeFileSync(PROOF, JSON.stringify(all, null, 2) + '\n')
            res.end('ok')
          } catch (e) {
            res.statusCode = 400
            res.end(String(e.message))
          }
        })
      })
      // The dropped cards list, so the page can leave them out.
      server.middlewares.use('/drops.md', (req, res) => {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(fs.existsSync(DROPS) ? fs.readFileSync(DROPS, 'utf8') : '')
      })
      server.middlewares.use('/plan.md', (req, res) => {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(fs.readFileSync(PLAN, 'utf8'))
      })
      // GET /api/replies → {A1: [{choice, text, at}], ...}; POST {id, choice, text} appends one.
      server.watcher.add(REPLIES)
      server.middlewares.use('/api/replies', (req, res) => {
        const read = () => { try { return JSON.parse(fs.readFileSync(REPLIES, 'utf8')) } catch { return {} } }
        res.setHeader('Cache-Control', 'no-store')
        if (req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(read())) }
        if (req.method !== 'POST') { res.statusCode = 405; return res.end() }
        let body = ''
        req.on('data', c => (body += c))
        req.on('end', () => {
          try {
            const { id, choice, text } = JSON.parse(body)
            if (!/^(A\d+|B|r2?:[a-z0-9-]{1,60}|m-[a-z0-9-]{1,60})$/.test(id) || !['yes', 'change', 'question'].includes(choice) || String(text || '').length > 4000) throw new Error('bad input')
            const all = read()
            ;(all[id] ||= []).push({ from: 'myra', choice, text: String(text || '').trim(), at: new Date().toISOString() })
            fs.writeFileSync(REPLIES, JSON.stringify(all, null, 2) + '\n')
            res.end('ok')
          } catch (e) {
            res.statusCode = 400
            res.end(String(e.message))
          }
        })
      })
      // POST /api/status {id: "1.8", status: "done"} rewrites that step's heading line.
      server.middlewares.use('/api/status', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end() }
        let body = ''
        req.on('data', c => (body += c))
        req.on('end', () => {
          try {
            const { id, status } = JSON.parse(body)
            if (!/^\d+\.\d+[ab]?$/.test(id) || !STATUSES.includes(status)) throw new Error('bad input')
            const src = fs.readFileSync(PLAN, 'utf8')
            const re = new RegExp(`^(\\*\\*${id.replace('.', '\\.')} [^\\n]*?\\*\\*)(?: · (?:${STATUSES.join('|')}))?[ \\t]*$`, 'm')
            if (!re.test(src)) throw new Error('step not found')
            fs.writeFileSync(PLAN, src.replace(re, status === 'todo' ? '$1' : `$1 · ${status}`))
            res.end('ok')
          } catch (e) {
            res.statusCode = 400
            res.end(String(e.message))
          }
        })
      })
    },
  }
}

export default {
  root: here,
  server: { port: 5174, strictPort: true },
  plugins: [planApi()],
}
