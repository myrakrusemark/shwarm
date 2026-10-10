#!/usr/bin/env node
// Export the agent skill into the live site and the mockups (go-live 7.6). skills/shwarm/ stays the source:
//   node scripts/pages/export-skill.mjs
// Writes apps/site/src/content/skill.json (SKILL.md and sandbox.md as written; the Worker serves them raw at
// /skills/shwarm/SKILL.md and /skills/shwarm/sandbox.md and as the page /skills) and scripts/pages/skills-page.json
// (the same page for the mockup), then runs build.py, which writes mockups/skills.html from it.
// apps/site/test/skills.test.ts fails until this has run. Needs a Node that runs .ts files (22.18 or later).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { skillPage } from '../../apps/site/src/render/skill.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const skill_md = readFileSync(join(ROOT, 'skills', 'shwarm', 'SKILL.md'), 'utf8')
const sandbox_md = readFileSync(join(ROOT, 'skills', 'shwarm', 'sandbox.md'), 'utf8')
writeFileSync(join(ROOT, 'apps', 'site', 'src', 'content', 'skill.json'), JSON.stringify({ skill_md, sandbox_md }) + '\n')

// In the mockups, the site's pages are their mockups where one exists; the protocol is the doc, the spec its symlink.
const mockup = path => {
  const [p, q] = path.split('?')
  if (p === '/docs/protocol') return '../docs/protocol.md'
  if (p === '/openapi.yaml') return 'openapi.yaml'
  const slug = p.slice(1)
  if (/^[a-z0-9-]+$/.test(slug) && existsSync(join(ROOT, 'mockups', slug + '.html'))) return slug + '.html' + (q ? '?' + q : '')
  return 'https://shwarm.org' + path
}
const page = skillPage(skill_md, sandbox_md, mockup)
writeFileSync(join(HERE, 'skills-page.json'), JSON.stringify(page, null, 1) + '\n')
execFileSync('python3', [join(HERE, 'build.py')], { stdio: 'inherit' })
console.log('exported apps/site/src/content/skill.json and scripts/pages/skills-page.json')
