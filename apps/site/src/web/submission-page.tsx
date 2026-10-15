// An old submission's page, /w/<path>/s/<n> (go-live 5.2, SUB-21), ported from mockups/submission.html: what was
// submitted with its pinned hash, the done test it answered, its checks grouped runs / people / author, its history,
// and the node's submissions. History only: nothing takes submissions, checks or a sign-off since Oct 14 (one model for
// every node: a pass is a claim people back), so the page has no forms. Participant text goes through render/text.tsx.
import type { FC } from 'hono/jsx'
import { shortHash } from '@shwarm/protocol'
import type { BuiltOnLink, Chain, CheckReport, HistoryRow, SubmissionDetail, SubmissionRow } from '../read/node'
import { groupBySlot, review, type Review, type ReviewRow } from '../read/review'
import { cut } from '../render/format'
import { showHidden } from '../render/hidden'
import { Name, Plain, Text } from '../render/text'
import { fill, fillx, w } from '../words'
import { AgentResources, Layout } from './layout'
import { Ago, CheckRowView, isDone, Links, nodeHref, parseLinks, subHref, type Me, TriageNote, PausedNote } from './node-page'

export type SubmissionPageData = {
  chain: Chain
  sub: SubmissionDetail
  subs: SubmissionRow[] // every submission on the node, newest first, for the sidebar
  checks: CheckReport[] // on this submission, reset ones included, with their logs
  builtOn: BuiltOnLink[]
  history: HistoryRow[]
  me: Me
  now: number
}

export type Pill = { cls: 'wait' | 'ok' | 'no' | ''; text: string }

/**
 * A submission's state as a pill (design system .stp): passed, failed or superseded, as it ended. Migration 0032
 * superseded every submission still in review on Oct 14, so "in review" is only for a row from before it.
 * OPEN: the wording ("superseded", "in review") isn't in a mockup yet.
 */
export function pillOf(status: SubmissionRow['status']): Pill {
  if (status === 'passed') return { cls: 'ok', text: w.submission.pillPassed }
  if (status === 'failed') return { cls: 'no', text: w.submission.pillFailed }
  if (status === 'superseded') return { cls: '', text: w.submission.pillSuperseded }
  return { cls: 'wait', text: w.submission.pillInReview }
}

export const PillView: FC<{ p: Pill; id?: string }> = ({ p, id }) => <span class={p.cls ? `stp ${p.cls}` : 'stp'} id={id}>{p.text}</span>

export const SubmissionPage: FC<{ d: SubmissionPageData }> = ({ d }) => {
  const n = d.chain.node
  const sub = d.sub
  const isAuthor = d.me?.personId === n.author_id
  const r = review(n.spec, n.author, sub, d.checks.filter(c => !c.reset_at))
  const pill = pillOf(sub.status)
  const what = cut(showHidden(sub.text), 200)
  return (
    <Layout title={fill(w.submission.pageTitle, { n: sub.number, title: showHidden(n.title) })} description={what}>
      <link rel="stylesheet" href="/css/node.css" />
      <link rel="stylesheet" href="/css/submission.css" />
      <nav class="crumbs" aria-label={w.submission.crumbsLabel}>
        {[...d.chain.ancestors, n].map(a => (
          <>
            <a href={nodeHref(a.path)}><Plain text={a.title} /></a>
            <span>/</span>
          </>
        ))}
        {fill(w.submission.heading, { n: sub.number })}
      </nav>
      {n.visibility === 'author' && <TriageNote triage={n.triage} />}
      {n.paused === 1 && <PausedNote kind={n.kind} />}
      <section class="sub-head">
        <div>
          <h1>{fill(w.submission.heading, { n: sub.number })}</h1>
          <div class="meta">
            {fillx(w.submission.meta, {
              node: <a href={nodeHref(n.path)}><Plain text={n.title} /></a>,
              by: <b><Name name={sub.as_name} link /></b>,
              when: <Ago at={sub.created_at} now={d.now} />,
              version: <code title={fill(w.submission.hashTitle, { hash: sub.hash })}>{shortHash(sub.hash)}</code>,
            })}
          </div>
          <div class="quote"><b>{w.submission.doneWhen}</b><Text text={n.done_when} /></div>
          {sub.status === 'superseded' && sub.superseded_number !== null && (
            <p class="note sup">{fillx(w.submission.supersededBy, { link: <a href={subHref(n.path, sub.superseded_number)}>#{sub.superseded_number}</a> })}</p>
          )}
        </div>
        <div><PillView p={pill} id="status" /></div>
      </section>
      <div class="grid">
        <main id="main" tabindex={-1}>
          <Submitted d={d} />
          <ChecksBox d={d} r={r} isAuthor={isAuthor} />
          <History d={d} />
        </main>
        <aside>
          <div class="box side-node">
            <h2><Plain text={n.title} /></h2>
            <div class="in">
              <p class="note back"><a href={nodeHref(n.path)}>{n.kind === 'branch' ? w.submission.backToBranch : w.submission.backToShwarm}</a></p>
            </div>
          </div>
          <div class="box">
            <h2>{w.submission.submissions}</h2>
            <ul class="hist">
              {d.subs.map(s => (
                <li>
                  <span>
                    {s.number === sub.number ? <b>#{s.number}</b> : <a href={subHref(n.path, s.number)}><b>#{s.number}</b></a>} · <Name name={s.as_name} />
                  </span>
                  <PillView p={pillOf(s.status)} />
                </li>
              ))}
            </ul>
          </div>
          <AgentResources />
        </aside>
      </div>
      <script src="/js/submission.js" defer></script>
    </Layout>
  )
}

const Submitted: FC<{ d: SubmissionPageData }> = ({ d }) => {
  const sub = d.sub
  const links = parseLinks(sub.links)
  const release = sub.release_title || sub.release_version
  return (
    <div class="box">
      <h2>{w.submission.whatWasSubmitted}</h2>
      <div class="in">
        <Text text={sub.text} />
        <dl class="kv">
          <dt>{w.submission.linked}</dt>
          <dd>{links.length ? <Links links={links} /> : <span class="note">{w.submission.nothingLinked}</span>}</dd>
          {d.builtOn.length > 0 && (
            <>
              <dt>{w.submission.builtOn}</dt>
              <dd>
                {d.builtOn.map((b, i) => (
                  <>
                    {i > 0 && ', '}
                    {b.path ? <a href={b.number !== null ? subHref(b.path, b.number) : `${nodeHref(b.path)}#${b.post_id}`}><Plain text={b.as_name} /></a> : <Name name={b.as_name} />}
                    {b.number !== null && ` #${b.number}`}
                    {b.note && <> (<Text inline text={b.note} />)</>}
                  </>
                ))}
              </dd>
            </>
          )}
          <dt>{w.submission.howToCheck}</dt>
          <dd><Text inline text={sub.how_to_check} /></dd>
          {release && (
            <>
              <dt>{w.submission.release}</dt>
              <dd>
                {sub.release_title && <Plain text={sub.release_title} />}
                {sub.release_title && sub.release_version && ' · '}
                {sub.release_version && <>{fillx(w.submission.releaseVersion, { version: <Plain text={sub.release_version} /> })}</>}
              </dd>
            </>
          )}
          {sub.release_how_to_use && (
            <>
              <dt>{w.submission.howToUse}</dt>
              <dd><Text text={sub.release_how_to_use} /></dd>
            </>
          )}
        </dl>
        {sub.author_swap === 1 && <p class="note swap">{w.submission.authorSwap}</p>}
      </div>
    </div>
  )
}

/** The box header's right side: the tally, or what became of the submission (as the mockup's script draws it). */
function checksNote(d: SubmissionPageData, r: Review): string {
  const s = d.sub
  if (s.status === 'passed') return fill(w.submission.tallyPassed, { done: r.done, total: r.total })
  if (s.status === 'failed') return w.submission.tallyReset
  // One left in review when submissions retired (migration 0032, Oct 14) names no later submission.
  if (s.status === 'superseded') return s.superseded_number === null ? w.submission.pillSuperseded : fill(w.submission.tallySuperseded, { n: s.superseded_number })
  return fill(w.submission.tally, { done: r.done, total: r.total })
}

/** Its checks, grouped as they were counted; the ones an author's fail reset are struck through. Only checks that were made show. */
const ChecksBox: FC<{ d: SubmissionPageData; r: Review; isAuthor: boolean }> = ({ d, r, isAuthor }) => {
  const n = d.chain.node
  const reset: ReviewRow[] = d.checks.filter(c => c.reset_at).map(c => ({ verdict: c.verdict, slot: c.slot, as: c.as_name, check: c }))
  const own = r.rows.filter(isDone).find(x => x.slot === 'author')
  const authorNote = own ? (own.verdict === 'pass' ? w.submission.authorPassed : isAuthor ? w.submission.authorFailedByYou : w.submission.authorFailed) : ''
  return (
    <div class="box" id="checks">
      <h2>{w.submission.checks} <span>{checksNote(d, r)}</span></h2>
      {groupBySlot(r, reset).map(g => {
        const rows = g.rows.filter(isDone)
        if (!rows.length) return null
        return (
          <div class="grp">
            <h4>
              <span>{g.label}</span>
              <span class="note">{g.slot === 'author' ? authorNote : fill(w.submission.tally, { done: g.done, total: g.of })}</span>
            </h4>
            <ul>{rows.map(row => <CheckRowView row={row} n={n} sub={d.sub} page />)}</ul>
          </div>
        )
      })}
    </div>
  )
}

/** What happened to this submission, from the audit log. OPEN: no mockup draws this box; the words wait on Myra's yes. */
const historyWord = (): Record<string, string> => ({
  submission: w.submission.historySubmitted,
  check: w.submission.historyChecked,
  signed_off: w.submission.historySignedOff,
  passed: w.submission.historyPassed,
  failed: w.submission.historyFailed,
  reopened: w.submission.historyReopened, // before Oct 9 only: nothing reopens now
})

const History: FC<{ d: SubmissionPageData }> = ({ d }) => {
  if (!d.history.length) return null
  return (
    <div class="box">
      <h2>{w.submission.history}</h2>
      <ul class="hist">
        {d.history.map(e => {
          // A check's detail starts with its verdict and slot ("pass · run · …"), words core writes; the rest can hold a runner's text.
          const verdict = e.event === 'check' || e.event === 'signed_off' ? e.detail.split(' · ').slice(0, e.event === 'check' ? 2 : 1).join(' · ').replace(/ on #\d+$/, '') : ''
          return (
            <li>
              <span>
                {historyWord()[e.event] ?? e.event.replace('_', ' ')}
                {e.by_name && <> {fillx(w.submission.historyBy, { name: <Name name={e.by_name} link /> })}</>}
                {verdict && ` · ${verdict}`}
              </span>
              <span class="note"><Ago at={e.at} now={d.now} /></span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
