// The agent skill on the site (go-live 7.6): skills/shwarm/ as written, for harnesses, and as a page for people.
//   GET /skills                      the skill and its sandbox recipe, laid out like the footer pages
//   GET /skills/shwarm/SKILL.md      the skill as written, to load into a harness
//   GET /skills/shwarm/sandbox.md    its sandbox recipe, which SKILL.md links by that relative name
// The text comes from src/content/skill.json, which scripts/pages/export-skill.mjs writes from skills/shwarm/;
// test/skills.test.ts fails when it's stale.
// OPEN (#97): the skill is a draft until Myra approves it, so it is served only where the reading pages are
// (readingOpen: not on production while it shows the holding page). There, /skills is a short "opens soon" page, so
// the agent resources card on the footer pages never links a 404, and the raw files are a 404.
import { Hono } from 'hono'
import { raw } from 'hono/html'
import type { FC } from 'hono/jsx'
import skill from '../content/skill.json'
import { allowRead } from '../api/cors'
import { readingOpen } from '../core/site-mode'
import { skillPage } from '../render/skill'
import { notFoundHandler } from './errors'
import { AgentResources, Layout } from './layout'
import { page } from './viewer'

type Env = { Bindings: { DB: D1Database; CSRF_SECRET: string; ENV?: string; SITE_MODE?: string } }

const FILES: Record<string, string> = { 'SKILL.md': skill.skill_md, 'sandbox.md': skill.sandbox_md }

let cache: ReturnType<typeof skillPage> | null = null
/** The page, rendered once per isolate; the skill's links to shwarm.org stay on whichever site serves it. */
const skillDoc = () => (cache ??= skillPage(skill.skill_md, skill.sandbox_md, path => path))

const SkillsPage: FC = () => {
  const d = skillDoc()
  return (
    <Layout title="agent skills · shwarm" description="how an agent should behave here, ready to load into your harness.">
      <link rel="stylesheet" href="/css/docs.css" />
      <div class="dochead">
        <h1>{d.title.toLowerCase()}</h1>
        <p>{raw(d.lede)}</p>
        <p>
          for your harness, as plain text: <a href="/skills/shwarm/SKILL.md">SKILL.md</a> and <a href="/skills/shwarm/sandbox.md">sandbox.md</a>.
        </p>
      </div>
      <div class="doc apidoc">
        <article id="main" tabindex={-1}>
          {d.sections.map(s => (
            <section id={s.id}><h2>{raw(s.h)}</h2><div class="body">{raw(s.body)}</div></section>
          ))}
        </article>
        <aside class="toc">
          <div class="box"><h2>on this page</h2><ol>{d.sections.map(s => <li><a href={`#${s.id}`}>{raw(s.h)}</a></li>)}</ol></div>
          <AgentResources current="/skills" />
        </aside>
      </div>
    </Layout>
  )
}

// OPEN (#97): new words, the api page's row for the skill and "opens soon".
const SkillsSoonPage: FC = () => (
  <Layout title="agent skills · shwarm" description="how an agent should behave here, ready to load into your harness.">
    <div class="dochead"><h1>agent skills</h1><p>how an agent should behave here, ready to load into your harness.</p></div>
    <div class="doc">
      <article id="main" tabindex={-1}><p>opens soon.</p></article>
      <aside class="toc"><AgentResources current="/skills" /></aside>
    </div>
  </Layout>
)

export const skills = new Hono<Env>()

skills.get('/skills', c => page(c, readingOpen(c.env) ? <SkillsPage /> : <SkillsSoonPage />))
skills.get('/skills/shwarm/:file{SKILL\\.md|sandbox\\.md}', c => {
  if (!readingOpen(c.env)) return notFoundHandler(c)
  c.header('Cache-Control', 'public, max-age=300')
  const res = c.body(FILES[c.req.param('file')], 200, { 'Content-Type': 'text/markdown; charset=utf-8' })
  allowRead(res.headers)
  return res
})
