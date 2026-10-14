// The submission page, /w/<path>/s/<n> (go-live 5.2, SUB-21), ported from mockups/submission.html: what was
// submitted with its pinned hash, the done test it answers, its checks grouped runs / people / author, its history,
// and the node's submissions; the people check form (5.3) and the author's sign-off box behind the password (5.5).
// Participant text goes through render/text.tsx.
import { useContext, type FC } from 'hono/jsx'
import { shortHash } from '@shwarm/protocol'
import { signInHref } from '../auth/return-to'
import { MAX_TEXT } from '../core/text'
import type { BuiltOnLink, Chain, CheckReport, HistoryRow, SubmissionDetail, SubmissionRow } from '../read/node'
import { groupBySlot, isOpen, review, waitingDays, type Review, type ReviewRow } from '../read/review'
import { cut } from '../render/format'
import { showHidden } from '../render/hidden'
import { Name, Plain, Text } from '../render/text'
import { count, fill, fillx, w } from '../words'
import { AgentResources, Layout } from './layout'
import { InvitedSignIn, OPENS_SOON } from './opens-soon'
import { PageContext } from './viewer'
import { Ago, CheckedBy, CheckRowView, humanOf, Links, nodeHref, parseLinks, StepUpField, subHref, type Me, TriageNote, PausedNote } from './node-page'

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

export type Pill = { cls: 'wait' | 'ok' | 'no' | ''; text: string }

/**
 * A submission's state as a pill. The author sees "waiting on you", "approved" and "failed" (design system .stp).
 * OPEN: the wording others see ("waiting on author", "in review", "superseded", "reopened") isn't in a mockup yet.
 */
export function pillOf(status: SubmissionRow['status'], waitingOnAuthor: boolean, mine: boolean, reopened = false): Pill {
  if (status === 'passed') return reopened ? { cls: 'no', text: w.submission.pillReopened } : { cls: 'ok', text: w.submission.pillApproved }
  if (status === 'failed') return { cls: 'no', text: w.submission.pillFailed }
  if (status === 'superseded') return { cls: '', text: w.submission.pillSuperseded }
  if (waitingOnAuthor) return { cls: 'wait', text: mine ? w.submission.pillWaitingOnYou : w.submission.pillWaitingOnAuthor }
  return { cls: 'wait', text: w.submission.pillInReview }
}

export const PillView: FC<{ p: Pill; id?: string }> = ({ p, id }) => <span class={p.cls ? `stp ${p.cls}` : 'stp'} id={id}>{p.text}</span>

export const SubmissionPage: FC<{ d: SubmissionPageData }> = ({ d }) => {
  const n = d.chain.node
  const sub = d.sub
  const isAuthor = d.me?.personId === n.author_id
  const standing = d.checks.filter(c => !c.reset_at)
  const r = review(n.spec, n.author, sub, standing)
  // A dead end keeps its submission in review but takes no checks or sign-off, so nobody is waited on (isOpen).
  const pill = pillOf(sub.status, isOpen(d.chain, sub) && r.waitingOn === 'author', isAuthor || !!d.operator, reopened(d, sub))
  const forms = whichForms(d, r)
  const lost = d.flash && !(d.flash.at === 'check' ? forms.check : forms.signOff)
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
      {/* A paused node takes no checks or sign-off (core/context.ts loadNode): say so above the forms that would be refused. */}
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
              <p class="lbl"><b>{w.submission.checkedBy}</b></p>
              <CheckedBy spec={n.spec} author={n.author} />
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
                  <PillView p={s.number === sub.number ? pill : pillOf(s.status, s.status === 'in_review' && s.ready_at !== null, isAuthor, reopened(d, s))} />
                </li>
              ))}
            </ul>
            <div class="in rule"><p class="note">{w.submission.oneADay}</p></div>
          </div>
          <AgentResources />
        </aside>
      </div>
      <script src="/js/submission.js" defer></script>
    </Layout>
  )
}

/** The passed submission that closed the node, while it stays closed. */
const closingNumber = (d: SubmissionPageData) => (d.chain.node.state === 'closed' ? d.subs.find(s => s.status === 'passed')?.number ?? null : null)

/**
 * A passed submission whose pass no longer closes the node: a repro reopened it, before Oct 9. Nothing reopens now (decided
 * Oct 9), but the record stays: its pass, and the pill that says what became of it. A branch's passed submission never
 * closed it (decided Oct 13: it passed its checks, and the branch's pass is its status vote), so it isn't reopened.
 */
const reopened = (d: SubmissionPageData, s: SubmissionRow) => s.status === 'passed' && d.chain.node.kind !== 'branch' && closingNumber(d) !== s.number

/**
 * Which forms the viewer gets. The sign-off box: the author (or, author gone, the operator) once every other check has
 * passed. The check box: anyone else while the submission takes checks (an ended node is locked, so it takes none); in it, the form itself or why this viewer can't check (signed out, unverified, their own
 * work, a slot they already hold). Core decides every refusal anyway; this only keeps forms off a page that can't use them.
 */
function whichForms(d: SubmissionPageData, r: Review): { signOff: boolean; checkBox: boolean; check: boolean; why: string | null } {
  const n = d.chain.node
  const sub = d.sub
  const me = d.me
  const open = isOpen(d.chain, sub)
  const mine = !!me && sub.person_id === me.personId
  const holds = !!me && d.checks.some(c => !c.reset_at && humanOf(c.as_name) === '@' + me.handle)
  const signer = !!me?.verified && open && r.need.author && (me.personId === n.author_id || !!d.operator)
  const signOff = signer && r.waitingOn === 'author' && !mine && !holds
  // The author's check on a submission in review is the sign-off; until it's their turn there's nothing to fill. The
  // same holds for the operator standing in for a gone author: a people check would take the slot the sign-off needs.
  const authorWaits = !!me && open && r.need.author && (me.personId === n.author_id || (!!d.operator && !mine && !holds))
  const checkBox = open && !signOff && !authorWaits
  const why = !me
    ? null
    : !me.verified
      ? w.submission.verifyToCheck
      : mine
        ? sub.as_name.includes('/') ? w.submission.cantCheckAgent : w.submission.cantCheckYours
        : holds
          ? w.submission.alreadyChecked
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
  // OPEN (#76): "reopened by a repro" isn't in a mockup; only passes reopened before Oct 9 show it.
  if (s.status === 'passed' && d.chain.node.kind === 'branch') return fill(w.submission.tallyPassedChecks, { done: r.done, total: r.total }) // Oct 13
  if (s.status === 'passed') return reopened(d, s) ? fill(w.submission.tallyReopened, { done: r.done, total: r.total }) : fill(w.submission.tallyDone, { done: r.done, total: r.total, title: showHidden(d.chain.node.title) })
  if (s.status === 'failed') return w.submission.tallyReset
  if (s.status === 'superseded') return fill(w.submission.tallySuperseded, { n: s.superseded_number ?? '?' })
  return fill(w.submission.tally, { done: r.done, total: r.total })
}

const ChecksBox: FC<{ d: SubmissionPageData; r: Review; isAuthor: boolean }> = ({ d, r, isAuthor }) => {
  const n = d.chain.node
  const sub = d.sub
  const open = isOpen(d.chain, sub)
  const reset: ReviewRow[] = d.checks.filter(c => c.reset_at).map(c => ({ verdict: c.verdict, slot: c.slot, as: c.as_name, check: c }))
  const days = open && r.waitingOn === 'author' ? waitingDays(sub.ready_at, d.now) : null
  const authorNote = (): string => {
    const own = r.rows.find(x => x.slot === 'author' && x.verdict !== 'waiting')
    if (own) return own.verdict === 'pass' ? w.submission.authorPassed : isAuthor ? w.submission.authorFailedByYou : w.submission.authorFailed
    return days ? count(w.submission.authorWaitingDays, days) : w.submission.authorWaiting
  }
  return (
    <div class="box" id="checks">
      <h2>{w.submission.checks} <span>{checksNote(d, r)}</span></h2>
      {/* A submission that takes no checks now shows only the groups that hold one. */}
      {groupBySlot(r, reset).filter(g => open || g.rows.some(row => row.verdict !== 'waiting')).map(g => (
        <div class="grp">
          <h4>
            <span>{g.label}</span>
            <span class="note">{g.slot === 'author' ? authorNote() : fill(w.submission.tally, { done: g.done, total: g.of })}</span>
          </h4>
          <ul>
            {g.rows
              .filter(row => row.verdict !== 'waiting' || open)
              .map(row =>
                row.verdict === 'waiting' && row.slot === 'author' && isAuthor ? (
                  <li><span class="ck">○</span><span>{fillx(w.submission.authorRowYou, { name: <b><Plain text={row.as ?? n.author} /></b> })}</span></li>
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

/**
 * The people check form (go-live 5.3), no script needed: pass with evidence links, or fail with steps that show it
 * failing (and optional links). A log stays a run report's, sent by an agent.
 * OPEN (#76): no mockup draws this form; its words wait on Myra's yes.
 */
const CheckForm: FC<{ d: SubmissionPageData; why: string | null }> = ({ d, why }) => {
  const n = d.chain.node
  const sub = d.sub
  const f = d.flash?.at === 'check' ? d.flash : undefined
  const v = f?.fields ?? {}
  const here = subHref(n.path, sub.number)
  return (
    <div class="box checkform" id="check">
      <h2>{w.submission.checkIt} <span>{w.submission.checkItRule}</span></h2>
      <div class="in">
        {useContext(PageContext).opensSoon ? (
          <p class="note">{OPENS_SOON.check} {OPENS_SOON.why}<InvitedSignIn /></p>
        ) : !d.me ? (
          <p class="note">{fillx(w.submission.signInToCheck, { link: <a href={signInHref(here)}>{w.submission.signIn}</a> })}</p>
        ) : why ? (
          <p class="note">{why}</p>
        ) : (
          <form method="post" action={here}>
            <input type="hidden" name="form_token" value={d.token} />
            <input type="hidden" name="do" value="check" />
            <fieldset class="verdict">
              <legend>{w.submission.yourCheck}</legend>
              <label><input type="radio" name="verdict" value="pass" required checked={v.verdict === 'pass' ? true : undefined} />{w.submission.checkPass}</label>
              <label><input type="radio" name="verdict" value="fail" checked={v.verdict === 'fail' ? true : undefined} />{w.submission.checkFail}</label>
            </fieldset>
            <label for="k-text">{w.submission.checkText}</label>
            <textarea id="k-text" name="text" rows={3} maxlength={MAX_TEXT}>{v.text ?? ''}</textarea>
            <label for="k-links">{w.submission.links}</label>
            <span class="note" id="k-links-n">{w.submission.linksNote}</span>
            <textarea id="k-links" name="links" rows={2} aria-describedby="k-links-n">{v.links ?? ''}</textarea>
            {f && <p class="err" role="alert">{f.text}</p>}
            <div class="row">
              <span class="note">{w.submission.checkNeeds}</span>
              <button class="btn" type="submit">{w.submission.postCheck}</button>
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
      <h2 class="sunny">{w.submission.signOff} <span>{w.submission.onlyYou}</span></h2>
      <div class="in">
        <p class="note first">{w.submission.yourCall}</p>
        {/* OPEN (#76): the operator's line isn't in a mockup; it waits on Myra's yes. */}
        {d.operator && <p class="note">{w.submission.asOperator}</p>}
        <input type="radio" name="pick" id="pick-pass" class="pick" checked={pick === 'pass' ? true : undefined} />
        <input type="radio" name="pick" id="pick-fail" class="pick" checked={pick === 'fail' ? true : undefined} />
        <div class="opts">
          <label class="btn" for="pick-pass">{w.submission.pass}</label>
          <label class="btn plain" for="pick-fail">{w.submission.fail}</label>
        </div>
        <form method="post" action={here} id="f-pass">
          {form('pass')}
          <textarea name="text" aria-label={w.submission.passLabel} maxlength={MAX_TEXT} placeholder={w.submission.passPlaceholder}>{draft('pass')}</textarea>
          <StepUpField id="pw-pass" open={d.steppedUp} />
          {err('pass')}
          <div class="row"><span class="note">{fill(w.submission.passNote, { title: showHidden(n.title) })}</span><button class="btn" type="submit">{w.submission.passIt}</button></div>
        </form>
        <form method="post" action={here} id="f-fail">
          {form('fail')}
          <textarea name="text" aria-label={w.submission.failLabel} maxlength={MAX_TEXT} placeholder={w.submission.failPlaceholder}>{draft('fail')}</textarea>
          <div class="warnline">{w.submission.failWarning}</div>
          <StepUpField id="pw-fail" open={d.steppedUp} />
          {err('fail')}
          <div class="row"><span class="note">{w.submission.failNote}</span><button class="btn plain" type="submit">{w.submission.failIt}</button></div>
        </form>
      </div>
    </div>
  )
}
