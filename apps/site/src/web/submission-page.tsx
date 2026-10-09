// The submission page, /w/<path>/s/<n> (go-live 5.2, SUB-21), ported from mockups/submission.html: what was
// submitted with its pinned hash, the done test it answers, its checks grouped runs / people / author, its history,
// and the node's submissions. The author's sign-off box comes with 5.5. Participant text goes through render/text.tsx.
import type { FC } from 'hono/jsx'
import { shortHash } from '@shwarm/protocol'
import type { BuiltOnLink, Chain, CheckReport, HistoryRow, SubmissionDetail, SubmissionRow } from '../read/node'
import { groupBySlot, isOpen, review, waitingDays, type Review, type ReviewRow } from '../read/review'
import { cut, plural, triageNote } from '../render/format'
import { showHidden } from '../render/hidden'
import { Name, Plain, Text } from '../render/text'
import { AgentResources, Layout } from './layout'
import { Ago, CheckedBy, CheckRowView, Links, nodeHref, parseLinks, subHref, type Me } from './node-page'

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

type Pill = { cls: 'wait' | 'ok' | 'no' | ''; text: string }

/**
 * A submission's state as a pill. The author sees "waiting on you", "approved" and "failed" (design system .stp).
 * OPEN: the wording others see ("waiting on author", "in review", "superseded") isn't in a mockup yet.
 */
function pillOf(status: SubmissionRow['status'], waitingOnAuthor: boolean, mine: boolean): Pill {
  if (status === 'passed') return { cls: 'ok', text: 'approved' }
  if (status === 'failed') return { cls: 'no', text: 'failed' }
  if (status === 'superseded') return { cls: '', text: 'superseded' }
  if (waitingOnAuthor) return { cls: 'wait', text: mine ? 'waiting on you' : 'waiting on author' }
  return { cls: 'wait', text: 'in review' }
}

const PillView: FC<{ p: Pill; id?: string }> = ({ p, id }) => <span class={p.cls ? `stp ${p.cls}` : 'stp'} id={id}>{p.text}</span>

export const SubmissionPage: FC<{ d: SubmissionPageData }> = ({ d }) => {
  const n = d.chain.node
  const sub = d.sub
  const isAuthor = d.me?.personId === n.author_id
  const standing = d.checks.filter(c => !c.reset_at)
  const r = review(n.spec, n.author, sub, standing)
  const pill = pillOf(sub.status, r.waitingOn === 'author', isAuthor)
  const what = cut(showHidden(sub.text), 200)
  return (
    <Layout title={`submission #${sub.number} · ${showHidden(n.title)} · shwarm`} description={what}>
      <link rel="stylesheet" href="/css/node.css" />
      <link rel="stylesheet" href="/css/submission.css" />
      <nav class="crumbs" aria-label="breadcrumb">
        {[...d.chain.ancestors, n].map(a => (
          <>
            <a href={nodeHref(a.path)}><Plain text={a.title} /></a>
            <span>/</span>
          </>
        ))}
        submission #{sub.number}
      </nav>
      {n.visibility === 'author' && <p class="held">{triageNote(n)}</p>}
      <section class="sub-head">
        <div>
          <h1>submission #{sub.number}</h1>
          <div class="meta">
            to <a href={nodeHref(n.path)}><Plain text={n.title} /></a> · by <b><Name name={sub.as_name} link /></b> · <Ago at={sub.created_at} now={d.now} /> · version{' '}
            <code title={`sha256 ${sub.hash}`}>{shortHash(sub.hash)}</code>
          </div>
          <div class="quote"><b>done when</b><Text text={n.done_when} /></div>
          {sub.status === 'superseded' && sub.superseded_number !== null && (
            <p class="note sup">superseded by <a href={subHref(n.path, sub.superseded_number)}>#{sub.superseded_number}</a>. its checks stay on the record.</p>
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
              <p class="lbl"><b>checked by</b></p>
              <CheckedBy spec={n.spec} author={n.author} />
              <p class="note back"><a href={nodeHref(n.path)}>back to the {n.kind === 'branch' ? 'branch' : n.kind === 'variant' ? 'variant' : 'shwarm'} →</a></p>
            </div>
          </div>
          <div class="box">
            <h2>submissions</h2>
            <ul class="hist">
              {d.subs.map(s => (
                <li>
                  <span>
                    {s.number === sub.number ? <b>#{s.number}</b> : <a href={subHref(n.path, s.number)}><b>#{s.number}</b></a>} · <Name name={s.as_name} />
                  </span>
                  <PillView p={s.number === sub.number ? pill : pillOf(s.status, s.status === 'in_review' && s.ready_at !== null, isAuthor)} />
                </li>
              ))}
            </ul>
            <div class="in rule"><p class="note">one submission per person per day.</p></div>
          </div>
          <AgentResources />
        </aside>
      </div>
    </Layout>
  )
}

const Submitted: FC<{ d: SubmissionPageData }> = ({ d }) => {
  const sub = d.sub
  const links = parseLinks(sub.links)
  const release = sub.release_title || sub.release_version
  return (
    <div class="box">
      <h2>what was submitted</h2>
      <div class="in">
        <Text text={sub.text} />
        <dl class="kv">
          <dt>linked</dt>
          <dd>{links.length ? <Links links={links} /> : <span class="note">nothing linked</span>}</dd>
          {d.builtOn.length > 0 && (
            <>
              <dt>built on</dt>
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
          <dt>how to check</dt>
          <dd><Text inline text={sub.how_to_check} /></dd>
          {release && (
            <>
              <dt>release</dt>
              <dd>
                {sub.release_title && <Plain text={sub.release_title} />}
                {sub.release_title && sub.release_version && ' · '}
                {sub.release_version && <>version <Plain text={sub.release_version} /></>}
              </dd>
            </>
          )}
          {sub.release_how_to_use && (
            <>
              <dt>how to use</dt>
              <dd><Text text={sub.release_how_to_use} /></dd>
            </>
          )}
        </dl>
        {sub.author_swap === 1 && <p class="note swap">the author's own work: one more people check stands in for the author's sign-off.</p>}
      </div>
    </div>
  )
}

/** The box header's right side: the tally, or what became of the submission (as the mockup's script draws it). */
function checksNote(d: SubmissionPageData, r: Review): string {
  const s = d.sub
  if (s.status === 'passed') return `${r.done} of ${r.total} · ${showHidden(d.chain.node.title)} is done`
  if (s.status === 'failed') return 'reset · waiting for a new submission'
  if (s.status === 'superseded') return `superseded by #${s.superseded_number ?? '?'}`
  return `${r.done} of ${r.total}`
}

const ChecksBox: FC<{ d: SubmissionPageData; r: Review; isAuthor: boolean }> = ({ d, r, isAuthor }) => {
  const n = d.chain.node
  const sub = d.sub
  const open = isOpen(n, sub)
  const reset: ReviewRow[] = d.checks.filter(c => c.reset_at).map(c => ({ verdict: c.verdict, slot: c.slot, as: c.as_name, check: c }))
  const days = r.waitingOn === 'author' ? waitingDays(sub.ready_at, d.now) : null
  const authorNote = (): string => {
    const own = r.rows.find(x => x.slot === 'author' && x.verdict !== 'waiting')
    if (own) return own.verdict === 'pass' ? 'passed' : isAuthor ? 'failed by you' : 'failed'
    return days ? `waiting ${plural(days, 'day', 'days')}` : 'waiting'
  }
  return (
    <div class="box" id="checks">
      <h2>checks <span>{checksNote(d, r)}</span></h2>
      {/* A submission that takes no checks now shows only the groups that hold one. */}
      {groupBySlot(r, reset).filter(g => open || g.rows.some(row => row.verdict !== 'waiting')).map(g => (
        <div class="grp">
          <h4>
            <span>{g.label}</span>
            <span class="note">{g.slot === 'author' ? authorNote() : `${g.done} of ${g.of}`}</span>
          </h4>
          <ul>
            {g.rows
              .filter(row => row.verdict !== 'waiting' || open)
              .map(row =>
                row.verdict === 'waiting' && row.slot === 'author' && isAuthor ? (
                  <li><span class="ck">○</span><span><b><Plain text={row.as ?? n.author} /></b> · you · the last check</span></li>
                ) : (
                  <CheckRowView row={row} n={n} sub={sub} page />
                ),
              )}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** What happened to this submission, from the audit log. OPEN: no mockup draws this box; the words wait on Myra's yes. */
const HISTORY_WORD: Record<string, string> = {
  submission: 'submitted',
  check: 'checked',
  signed_off: 'signed off',
  passed: 'passed',
  failed: 'failed the author check',
  reopened: 'reopened by a repro',
}

const History: FC<{ d: SubmissionPageData }> = ({ d }) => {
  if (!d.history.length) return null
  return (
    <div class="box">
      <h2>history</h2>
      <ul class="hist">
        {d.history.map(e => {
          // A check's detail starts with its verdict and slot ("pass · run · …"), words core writes; the rest can hold a runner's text.
          const verdict = e.event === 'check' || e.event === 'signed_off' ? e.detail.split(' · ').slice(0, e.event === 'check' ? 2 : 1).join(' · ').replace(/ on #\d+$/, '') : ''
          return (
            <li>
              <span>
                {HISTORY_WORD[e.event] ?? e.event.replace('_', ' ')}
                {e.by_name && <> by <Name name={e.by_name} link /></>}
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
