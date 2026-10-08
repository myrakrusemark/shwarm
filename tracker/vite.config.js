// Go-live tracker: serves docs/go-live.md live and lets the page set a step's status.
// Run: npx vite --config tracker/vite.config.js   (from the project root) → http://localhost:5174/
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const PLAN = path.resolve(here, '../docs/go-live.md')
const REPLIES = path.resolve(here, 'replies.json') // Myra's answers to the decisions; Claude reads this
const STATUSES = ['todo', 'doing', 'done', 'blocked', 'parked']

function planApi() {
  return {
    name: 'go-live-plan',
    configureServer(server) {
      server.watcher.add(PLAN)
      server.watcher.on('change', f => {
        if ([PLAN, REPLIES].includes(path.resolve(f))) server.ws.send({ type: 'custom', event: 'plan-changed' })
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
            if (!/^(A\d+|B)$/.test(id) || !['yes', 'change', 'question'].includes(choice) || String(text || '').length > 4000) throw new Error('bad input')
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
