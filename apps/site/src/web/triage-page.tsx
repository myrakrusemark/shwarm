// /triage: the public triage page (go-live 9.2). What the triage model is asked, and what it and @myra decided.
// The prompt is built here from src/triage (rubric.ts triageQuestions, model.ts clefRequest), never copied, so the page
// always shows what the model gets. The decision log reads triage_decision, newest first, paged with ?before=<id>,
// as a page, JSON (?format=json, or Accept: application/json) or plain text, like the moderation log.
// What never shows: a node's title, text, tags or checks (the model's input), so nothing of a held or blocked node
// leaks; error rows (no decision, and their messages are the platform's, not a reason). A node shows as the
// moderation log shows it (web/moderation-log.tsx): its path, linked only while the public can see it, "(taken down)"
// once it isn't; a node the public was never shown (it, or a node above it, never cleared triage) shows only as
// "a shwarm", since its address is a plain 404 to everyone but its author and the log mustn't confirm it.
// A public D1 read, so it takes from the same per-network read limit as the feed and the sitemap.
import { Hono } from 'hono'
import type { FC } from 'hono/jsx'
import { readingOpen } from '../core/site-mode'
import { CLEARED_NODE, PUBLIC_NODE } from '../read/visibility'
import { HAND_MODEL, parseBlockReason } from '../triage/decide'
import { clefRequest, DEFAULT_MODEL, selectorOf, type NodeForTriage } from '../triage/model'
import { CATEGORY_LABEL, HARD_BLOCKS, isCategory, RUBRIC, RUBRIC_VERSION, triageQuestions, type Category } from '../triage/rubric'
import { pickFormat } from './format'
import { AgentResources, Layout } from './layout'
import { overReadCap } from './read-limit'
import { page } from './viewer'
import { fill, fillx, w } from '../words'

type Env = { Bindings: { DB: D1Database; CSRF_SECRET: string; ENV?: string; SITE_MODE?: string; TRIAGE_MODEL?: string } }
export const triagePage = new Hono<Env>()

export const TRIAGE_PAGE = 50

/**
 * The node the request example is built from: placeholders only, so the page shows the request's shape and every
 * field the model reads, without anyone's words. OPEN: new wording, the placeholders.
 */
export const EXAMPLE_NODE: NodeForTriage = {
  kind: 'shwarm',
  title: '<the title>',
  what: '<the what>',
  done_when: '<the done test>',
  checks: JSON.stringify({ runs: { command: '<the run command>', count: 2 }, people: { count: 1, human: true, instructions: '<what checkers should look at>' }, author: true }),
  builds_on: null,
  tags: '<tag> <tag>',
  parent_title: null,
}

/** The model in use (the TRIAGE_MODEL setting, or the default). */
export const modelOf = (env: { TRIAGE_MODEL?: string }) => env.TRIAGE_MODEL || DEFAULT_MODEL

/** Everything the model is given, as it is given it. */
export function promptOf(modelId: string) {
  return { rubric: RUBRIC_VERSION, model: modelId, hard_blocks: HARD_BLOCKS, questions: triageQuestions(), request_example: clefRequest(modelId, EXAMPLE_NODE) }
}

export type Answer = 'yes' | 'no' | 'unsure'
export type DecisionRow = {
  id: number
  at: string
  node: string | null // null: a node the public was never shown
  shown: boolean // the public can read it now
  answer: Answer
  by: 'model' | 'hand'
  model: string // 'clef-flash', or 'myra' for a hand decision
  rubric: string
  outcome: string
  category: Category | null
  reason: string
}

// OPEN: new wording, the outcomes. A yes or unsure on a launch shwarm leaves it up while @myra looks; on anything
// else it waits for her, unseen. "sent for review" covers both.
export const OUTCOME_WORDS = {
  model: { no: 'cleared', yes: 'sent for review', unsure: 'sent for review' },
  hand: { no: 'cleared by hand', yes: 'blocked', unsure: 'sent for review' },
} as const

type Raw = { id: number; model: string; rubric: string; answer: Answer; reason: string; created_at: string; node_path: string | null; node_shown: number }

/** One page of decisions, newest first, below `before` when given; `more` when there are older ones. */
export async function readDecisions(db: D1Database, before: number | null, limit = TRIAGE_PAGE): Promise<{ rows: DecisionRow[]; more: boolean }> {
  const { results } = await db
    .prepare(
      `SELECT d.id, d.model, d.rubric, d.answer, d.reason, d.created_at,
              CASE WHEN ${CLEARED_NODE('n')} THEN n.path END AS node_path,
              CASE WHEN ${PUBLIC_NODE('n')} THEN 1 ELSE 0 END AS node_shown
       FROM triage_decision d
       JOIN node n ON n.id = d.node_id
       WHERE d.answer IN ('yes', 'no', 'unsure') AND (?1 IS NULL OR d.id < ?1)
       ORDER BY d.id DESC LIMIT ?2`,
    )
    .bind(before, limit + 1)
    .all<Raw>()
  return { rows: results.slice(0, limit).map(toRow), more: results.length > limit }
}

function toRow(r: Raw): DecisionRow {
  const hand = r.model === HAND_MODEL
  let category: Category | null = null
  let reason = ''
  if (hand) {
    // A block's reason is "<category>: <her words>" (triage/decide.ts blockReason); a clear's is her words. Both are
    // already public in the moderation log.
    const b = r.answer === 'yes' ? parseBlockReason(r.reason) : null
    if (b) [category, reason] = [b.category, b.reason]
    else reason = r.reason
  } else if (r.answer !== 'no' && isCategory(r.reason)) {
    // The model's row keeps the category it scored highest; on a no it means nothing, so it isn't shown.
    category = r.reason
  }
  return {
    id: r.id,
    at: r.created_at,
    node: r.node_path,
    shown: r.node_shown === 1,
    answer: r.answer,
    by: hand ? 'hand' : 'model',
    model: hand ? HAND_MODEL : selectorOf(r.model),
    rubric: r.rubric,
    outcome: OUTCOME_WORDS[hand ? 'hand' : 'model'][r.answer],
    category,
    reason: reason.trim(),
  }
}

const beforeOf = (q: string | undefined) => (q && /^[1-9]\d{0,15}$/.test(q) ? Number(q) : null)

triagePage.get('/triage', async c => {
  // As the footer pages: no Accept and no ?format= is a browser-ish request and gets the page; curl's */* gets text.
  const format = c.req.query('format')
  const accept = c.req.header('accept')
  const f = accept === undefined && format === undefined ? 'html' : (pickFormat(format, accept, c.req.header('user-agent')) ?? 'html')
  const capped = overReadCap(c, f)
  if (capped) return capped
  const before = beforeOf(c.req.query('before'))
  const { rows, more } = await readDecisions(c.env.DB, before)
  const older = more ? rows[rows.length - 1].id : null
  const model = modelOf(c.env)
  c.header('Vary', 'Accept, User-Agent')
  // Public and the same for everyone, so it may be cached briefly; page() makes a signed-in page private.
  c.header('Cache-Control', 'public, s-maxage=60')
  if (f === 'json') return c.json({ ...promptOf(model), decisions: rows, older: older === null ? null : `/triage?format=json&before=${older}` })
  if (f === 'text') return c.text(asText(model, rows, older, before === null))
  return page(c, <TriagePage model={model} rows={rows} older={older} first={before === null} links={readingOpen(c.env)} />)
})

const nodeText = (r: DecisionRow) => `${r.node ?? 'a shwarm'}${r.node && !r.shown ? ' (taken down)' : ''}`

function asText(model: string, rows: DecisionRow[], older: number | null, first: boolean): string {
  const out: string[] = []
  if (first) {
    out.push(
      `triage: rubric ${RUBRIC_VERSION}, model ${model}`,
      '',
      'the hard blocks:',
      RUBRIC,
      '',
      'the questions, as the model gets them:',
      JSON.stringify(triageQuestions(), null, 2),
      '',
      'a whole request, with placeholders for the words a person wrote:',
      JSON.stringify(clefRequest(model, EXAMPLE_NODE), null, 2),
      '',
      'decisions, newest first:',
    )
  }
  for (const r of rows)
    out.push(`${r.at.slice(0, 10)}  ${nodeText(r)}  ${r.answer}: ${r.outcome}${r.category ? ` (${r.category})` : ''}  by ${r.model}, rubric ${r.rubric}${r.reason ? `. ${r.reason}` : ''}`)
  if (!rows.length) out.push(first ? 'no decisions yet.' : 'nothing older.')
  if (older !== null) out.push(`older: /triage?format=text&before=${older}`)
  return out.join('\n') + '\n'
}

// ---------- the page ----------

const On: FC<{ r: DecisionRow; links: boolean }> = ({ r, links }) => {
  if (!r.node) return <>{w.pages.aShwarm}</>
  if (!r.shown) return <>{r.node}<span class="mk">{w.pages.takenDown}</span></>
  return links ? <a href={`/w/${r.node}`}>{r.node}</a> : <>{r.node}</>
}

const DecisionTable: FC<{ rows: DecisionRow[]; links: boolean }> = ({ rows, links }) => (
  <table class="adm modlog">
    {/* OPEN: new wording, the column names. */}
    <thead><tr><th>{w.pages.colDate}</th><th>{w.pages.colOn}</th><th>{w.pages.colAnswer}</th><th>{w.pages.colOutcome}</th><th>{w.pages.colCategory}</th><th>{w.pages.colReason}</th><th>{w.pages.colBy}</th></tr></thead>
    <tbody>
      {rows.map(r => (
        <tr id={`t${r.id}`}>
          <td class="day"><time datetime={r.at}>{r.at.slice(0, 10)}</time></td>
          <td class="on"><On r={r} links={links} /></td>
          <td>{r.answer}</td>
          <td>{r.outcome}</td>
          <td>{r.category ? CATEGORY_LABEL[r.category] : '—'}</td>
          <td>{r.reason || '—'}</td>
          <td>{r.by === 'hand' ? `@${r.model}` : r.model}<span class="mk"> · {r.rubric}</span></td>
        </tr>
      ))}
    </tbody>
  </table>
)

const TriagePage: FC<{ model: string; rows: DecisionRow[]; older: number | null; first: boolean; links: boolean }> = ({ model, rows, older, first, links }) => {
  const toc: [string, string][] = first
    ? [['how', w.pages.triageHow], ['blocks', w.pages.triageBlocks], ['questions', w.pages.triageQuestions], ['request', w.pages.triageRequest], ['log', w.pages.triageDecisions]]
    : [['log', w.pages.triageOlder]]
  return (
    // OPEN: new wording, the whole page.
    <Layout title={fill(w.pages.title, { page: w.pages.triageTitle })} description={w.pages.triageDescription} canonical="/triage">
      <link rel="stylesheet" href="/css/admin.css" />
      <div class="dochead">
        <h1>{w.pages.triageTitle}</h1>
        <p>{w.pages.triageIntro}</p>
      </div>
      <div class="doc">
        <article id="main" tabindex={-1}>
          {first && (
            <>
              <section id="how">
                <h2>{w.pages.triageHow}</h2>
                {/* OPEN (decided Oct 12, no editing): "or edits one" dropped; waits on Myra's yes. */}
                <div class="body">
                  <p>{w.pages.triageHowPosted}</p>
                  <p>{w.pages.triageHowHarm}</p>
                  <p>{fillx(w.pages.triageHowModel, { model: <code>{model}</code>, version: <code>{RUBRIC_VERSION}</code> })}</p>
                </div>
              </section>
              <section id="blocks">
                <h2>{w.pages.triageBlocks}</h2>
                <div class="body">
                  <p>{fillx(w.pages.triageBlocksIntro, { rules: <a href="/rules">{w.pages.rulesLink}</a> })}</p>
                  <pre class="code">{RUBRIC}</pre>
                </div>
              </section>
              <section id="questions">
                <h2>{w.pages.triageQuestions}</h2>
                <div class="body">
                  <p>{w.pages.triageQuestionsIntro}</p>
                  <pre class="code">{JSON.stringify(triageQuestions(), null, 2)}</pre>
                </div>
              </section>
              <section id="request">
                <h2>{w.pages.triageRequest}</h2>
                <div class="body">
                  <p>{fillx(w.pages.triageRequestIntro, { state: <code>state</code>, branchOf: <code>branch_of</code> })}</p>
                  <pre class="code">{JSON.stringify(clefRequest(model, EXAMPLE_NODE), null, 2)}</pre>
                </div>
              </section>
            </>
          )}
          <section id="log">
            <h2>{first ? w.pages.triageDecisions : w.pages.triageOlder}</h2>
            <div class="body">
              {first && <p>{w.pages.triageDecisionsIntro}</p>}
              {rows.length ? <DecisionTable rows={rows} links={links} /> : <p>{first ? w.pages.triageEmpty : w.pages.nothingOlder}</p>}
              {(older !== null || !first) && (
                <p class="modlog-more">
                  {!first && <a href="/triage">{w.pages.newest}</a>}
                  {!first && older !== null && ' · '}
                  {older !== null && <a href={`/triage?before=${older}`}>{w.pages.triageOlder}</a>}
                </p>
              )}
              <p>
                {fillx(w.pages.triageAgents, {
                  json: <a href="/triage?format=json">?format=json</a>,
                  text: <a href="/triage?format=text">?format=text</a>,
                  modlog: <a href="/moderation">{w.pages.triageModlogLink}</a>,
                })}
              </p>
            </div>
          </section>
        </article>
        <aside class="toc">
          <div class="box"><h2>{w.pages.onThisPage}</h2><ol>{toc.map(([id, h]) => <li><a href={`#${id}`}>{h}</a></li>)}</ol></div>
          <AgentResources />
        </aside>
      </div>
    </Layout>
  )
}
