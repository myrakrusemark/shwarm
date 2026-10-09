// The submission page, /w/<path>/s/<n> (go-live 5.2, SUB-21), ported from mockups/submission.html: what was
// submitted with its pinned hash, the done test it answers, its checks grouped runs / people / author, its history,
// and the node's submissions; the people check form (5.3) and the author's sign-off box behind the password (5.5).
// Participant text goes through render/text.tsx.
import type { FC } from 'hono/jsx'
import { shortHash } from '@shwarm/protocol'
import { signInHref } from '../auth/return-to'
import { MAX_TEXT } from '../core/text'
import type { BuiltOnLink, Chain, CheckReport, HistoryRow, SubmissionDetail, SubmissionRow } from '../read/node'
import { groupBySlot, isOpen, review, waitingDays, type Review, type ReviewRow } from '../read/review'
import { cut, plural, triageNote } from '../render/format'
import { showHidden } from '../render/hidden'
import { Name, Plain, Text } from '../render/text'
import { AgentResources, Layout } from './layout'
import { Ago, CheckedBy, CheckRowView, humanOf, Links, nodeHref, parseLinks, StepUpField, subHref, type Me } from './node-page'

export type SubmissionPageData = {
  chain: Chain
  sub: SubmissionDetail
  subs: SubmissionRow[] // every submission on the node, newest first, for the sidebar
  checks: CheckReport[] // on this submission, reset ones included, with their logs
  builtOn: BuiltOnLink[]
  history: HistoryRow[]
  me: Me
  now: number
  token?: string // the form token, signed in
  steppedUp?: boolean // the password was entered in the last 10 minutes: the sign-off doesn't ask again
  operator?: boolean // the viewer is an admin and the author is gone, so the viewer signs off (table B)
  flash?: SubFlash
}

/**
 * A refused check or sign-off, shown at its form with the draft kept: `fields` holds what was typed (verdict, text,
 * links). A refusal whose form isn't on the page (a forged or stale post) shows at the top instead.
 */
export type SubFlash = { at: 'check' | 'signoff'; text: string; fields: Record<string, string> }

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
  // A dead end keeps its submission in review but takes no checks or sign-off, so nobody is waited on (isOpen).
  const pill = pillOf(sub.status, isOpen(n, sub) && r.waitingOn === 'author', isAuthor || !!d.operator)
  const forms = whichForms(d, r)
  const lost = d.flash && !(d.flash.at === 'check' ? forms.check : forms.signOff)
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
          {lost && <p class="err flash" role="alert">{d.flash!.text}</p>}
          <Submitted d={d} />
          <ChecksBox d={d} r={r} isAuthor={isAuthor} />
          {forms.signOff && <SignOff d={d} />}
          {forms.checkBox && <CheckForm d={d} why={forms.why} />}
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
      <script src="/js/submission.js" defer></script>
    </Layout>
  )
}

/**
 * Which forms the viewer gets. The sign-off box: the author (or, author gone, the operator) once every other check has
 * passed. The check box: anyone else while the submission takes checks, or, on a closed node, a repro on the passing
 * submission (fail only); in it, the form itself or why this viewer can't check (signed out, unverified, their own
 * work, a slot they already hold). Core decides every refusal anyway; this only keeps forms off a page that can't use them.
 */
function whichForms(d: SubmissionPageData, r: Review): { signOff: boolean; checkBox: boolean; check: boolean; why: string | null } {
  const n = d.chain.node
  const sub = d.sub
  const me = d.me
  const open = isOpen(n, sub)
  const repro = n.state === 'closed' && sub.status === 'passed' && d.subs.find(s => s.status === 'passed')?.number === sub.number
  const mine = !!me && sub.person_id === me.personId
  const holds = !!me && d.checks.some(c => !c.reset_at && humanOf(c.as_name) === '@' + me.handle)
  const signer = !!me?.verified && open && r.need.author && (me.personId === n.author_id || !!d.operator)
  const signOff = signer && r.waitingOn === 'author' && !mine && !holds
  // The author's check on a submission in review is the sign-off; until it's their turn there's nothing to fill.
  const authorWaits = !!me && open && r.need.author && me.personId === n.author_id
  const checkBox = (open || repro) && !signOff && !authorWaits
  const why = !me
    ? null
    : !me.verified
      ? 'verify your email to check it.'
      : mine
        ? `you can't check it: it's ${sub.as_name.includes('/') ? 'from your agent' : 'yours'}.`
        : holds
          ? 'you have a check on it already.'
          : null
  // A refused check comes back to its form with the draft, whatever kept the form off before.
  const refused = d.flash?.at === 'check' && !!me
  return { signOff, checkBox, check: checkBox && !!me && (why === null || refused), why: refused ? null : why }
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
  const days = open && r.waitingOn === 'author' ? waitingDays(sub.ready_at, d.now) : null
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

/**
 * The people check form (go-live 5.3), no script needed: pass with evidence links, or fail with steps that show it
 * failing (and optional links). A log stays a run report's, sent by an agent. On a closed node it takes only a repro.
 * OPEN (#76): no mockup draws this form; its words wait on Myra's yes.
 */
const CheckForm: FC<{ d: SubmissionPageData; why: string | null }> = ({ d, why }) => {
  const n = d.chain.node
  const sub = d.sub
  const repro = n.state === 'closed'
  const f = d.flash?.at === 'check' ? d.flash : undefined
  const v = f?.fields ?? {}
  const here = subHref(n.path, sub.number)
  return (
    <div class="box checkform" id="check">
      <h2>{repro ? "it's broken? post a repro" : 'check it'} <span>one check per person, never on their own work.</span></h2>
      <div class="in">
        {!d.me ? (
          <p class="note"><a href={signInHref(here)}>sign in</a> to check it. agents send run reports with a key.</p>
        ) : why ? (
          <p class="note">{why}</p>
        ) : (
          <form method="post" action={here}>
            <input type="hidden" name="form_token" value={d.token} />
            <input type="hidden" name="do" value="check" />
            {repro ? (
              <>
                <input type="hidden" name="verdict" value="fail" />
                <p class="note">#{sub.number} passed. a repro on it reopens {showHidden(n.title)}.</p>
              </>
            ) : (
              <fieldset class="verdict">
                <legend>your check</legend>
                <label><input type="radio" name="verdict" value="pass" required checked={v.verdict === 'pass' ? true : undefined} /> pass</label>
                <label><input type="radio" name="verdict" value="fail" checked={v.verdict === 'fail' ? true : undefined} /> fail</label>
              </fieldset>
            )}
            <label for="k-text">{repro ? 'what fails and how to see it' : 'what you checked, or what fails and how to see it'}</label>
            <textarea id="k-text" name="text" rows={3} maxlength={MAX_TEXT}>{v.text ?? ''}</textarea>
            <label for="k-links">links</label>
            <span class="note" id="k-links-n">one per line: a url and its sha256, or a repo and a full commit id. a pass needs at least one: a recording or a rerun.</span>
            <textarea id="k-links" name="links" rows={2} aria-describedby="k-links-n">{v.links ?? ''}</textarea>
            {f && <p class="err" role="alert">{f.text}</p>}
            <div class="row">
              <span class="note">{repro ? 'a fail needs steps that show it failing.' : 'a pass needs evidence. a fail needs steps that show it failing.'}</span>
              <button class="btn" type="submit">{repro ? 'post repro' : 'post check'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

/**
 * The author's sign-off box (go-live 5.5), from mockups/submission.html: pass with what you checked, or fail with a
 * repro, which resets every check. No script: two radios open one form each. Both confirm with the password, asked
 * inline while the step-up window is closed (A5). Author gone (table B), the operator gets the same box.
 */
const SignOff: FC<{ d: SubmissionPageData }> = ({ d }) => {
  const n = d.chain.node
  const here = subHref(n.path, d.sub.number)
  const f = d.flash?.at === 'signoff' ? d.flash : undefined
  const pick = f?.fields.verdict
  const form = (verdict: 'pass' | 'fail') => (
    <>
      <input type="hidden" name="form_token" value={d.token} />
      <input type="hidden" name="do" value="signoff" />
      <input type="hidden" name="verdict" value={verdict} />
    </>
  )
  const err = (verdict: 'pass' | 'fail') => f && pick === verdict && <p class="err" role="alert">{f.text}</p>
  const draft = (verdict: 'pass' | 'fail') => (pick === verdict ? f?.fields.text ?? '' : '')
  return (
    <div class="box decide" id="decide">
      <h2 class="sunny">your sign-off <span>only you see this</span></h2>
      <div class="in">
        <p class="note first">everything else passed. it's your call whether this meets the done test.</p>
        {/* OPEN (#76): the operator's line isn't in a mockup; it waits on Myra's yes. */}
        {d.operator && <p class="note">its author's account is gone, so you sign off as the operator.</p>}
        <input type="radio" name="pick" id="pick-pass" class="pick" checked={pick === 'pass' ? true : undefined} />
        <input type="radio" name="pick" id="pick-fail" class="pick" checked={pick === 'fail' ? true : undefined} />
        <div class="opts">
          <label class="btn" for="pick-pass">pass</label>
          <label class="btn plain" for="pick-fail">fail</label>
        </div>
        <form method="post" action={here} id="f-pass">
          {form('pass')}
          <textarea name="text" aria-label="what you checked" maxlength={MAX_TEXT} placeholder="what you checked: ran it to y=-80, 62 fps the whole way…">{draft('pass')}</textarea>
          <StepUpField id="pw-pass" open={d.steppedUp} />
          {err('pass')}
          <div class="row"><span class="note">passing closes {showHidden(n.title)} as done. confirms with your password.</span><button class="btn" type="submit">pass it</button></div>
        </form>
        <form method="post" action={here} id="f-fail">
          {form('fail')}
          <textarea name="text" aria-label="what fails and how to see it" maxlength={MAX_TEXT} placeholder="what fails and how to see it: at y=-120 it drops to 40 fps. steps…">{draft('fail')}</textarea>
          <div class="warnline">failing resets every check on this done test. the runs and the people check start over, and the next submission begins from zero.</div>
          <StepUpField id="pw-fail" open={d.steppedUp} />
          {err('fail')}
          <div class="row"><span class="note">confirms with your password.</span><button class="btn plain" type="submit">fail it</button></div>
        </form>
      </div>
    </div>
  )
}
