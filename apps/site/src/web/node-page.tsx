// The shwarm page (the live template) and the branch page, /w/<path> (go-live 3.3, 3.4), ported from
// mockups/shwarm.html and mockups/branch.html. Every piece of participant text goes through render/text.tsx.
// A closed shwarm shows its result page instead (web/result-page.tsx, go-live 5.7); this live template is its thread
// (?thread=1). A passed branch keeps this template, with "proof it's done" above its thread. An ended node (passed or a
// dead end) is locked (decided Oct 9): no compose box, pin, join, edit or delete, and the author's box is gone; a shwarm
// offers "build on this" instead.
// Join (go-live 8.2, decided Oct 12): a live shwarm or branch has a join button on its own post (the head) and one in
// the contributors box; both open one "say hi!" modal (JoinModal), whose optional words become the joiner's first post,
// marked "✿ joined". With no words the thread shows a quiet "✿ @you joined" line. With scripts off, either button posts a
// plain join. The burst (static/js/node.js) plays on the page the join lands on, where the modal was.
import { useContext, type FC } from 'hono/jsx'
import { shortHash } from '@shwarm/protocol'
import type { Link } from '@shwarm/protocol'
import { joinHref, signInHref } from '../auth/return-to'
import type { CheckSpec } from '../core/checks'
import type { BuiltOnBy, BuiltOnLink, Chain, CheckReport, Child, Contributor, JoinLine, NodeEdit, NodeHead, PostEdit, PostRow, Show, Sort, SubmissionRow, Thread } from '../read/node'
import { EDITS_SHOWN, lockedBy, SHOWS, SORTS } from '../read/node'
import { FORMER } from '../read/names'
import { ACTIVITY_DAYS, type ActivityDay } from '../read/activity'
import { groupBySlot, isOpen, openReview, recordedStatus, review, waitingDays, type ReviewRow } from '../read/review'
import { ago, cut, dayOf, exact, licenseName, monthDay, perDay, plural, q1, shortNum, triageNote } from '../render/format'
import { showHidden } from '../render/hidden'
import { MAX_TEXT, MAX_TITLE } from '../core/text'
import { Command, LINK_REL, linkParts, Log, Name, Plain, tagHref, Text } from '../render/text'
import { RELEASE_CAPS } from '../core/posts'
import { REASON_LABEL, REASONS, REPORT_TEXT_MAX } from '../core/reports'
import { FLAG_LABEL, FLAG_REASONS, PAUSE_AT } from '../core/flags'
import { AgentResources, Layout } from './layout'
import { InvitedSignIn, OPENS_SOON } from './opens-soon'
import { PageContext } from './viewer'


/** The author's own-eyes note (render/format.ts triageNote), with "the rules" as a link when it's blocked. */
export const TriageNote = (p: { triage: string }) =>
  p.triage === 'blocked' ? (
    <p class="held">
      blocked. see <a href="/rules">the rules</a>.
    </p>
  ) : (
    <p class="held">{triageNote(p)}</p>
  )

export type Me = { personId: number; handle: string; verified: boolean } | null

/**
 * A refused form, shown next to it: the compose box, join or leave (`seats`), the author's own box (dead end), or one
 * post's upvote, edit, delete or report (`post` names it). `draft` keeps the text they wrote; a refused submission
 * (`mode: 'submit'`) keeps every field of the submit form in `fields` and opens it again; a refused edit opens its form
 * again, and so does a refused report (`report`, with its reason in `fields`). `flag`: "flag this shwarm" in the head,
 * with its reason in `fields`.
 */
export type Flash = { at: 'compose' | 'seats' | 'owner' | 'post' | 'flag'; text: string; draft?: string; mode?: 'submit'; fields?: Record<string, string>; post?: string; pin?: boolean; report?: boolean }

export type NodePageData = {
  chain: Chain
  branches: Child[]
  contributors: { rows: Contributor[]; total: number }
  subs: SubmissionRow[]
  checks: Map<string, CheckReport[]>
  thread: Thread
  myUps?: Map<string, boolean> // the viewer's upvotes on the posts shown: post id → counted (A6)
  myReports?: Set<string> // the posts shown that the viewer reported (core/reports.ts)
  myFlag?: boolean // the viewer flagged this node (core/flags.ts)
  mySeat?: number | null // the viewer's join on a shwarm or branch (a seat row's number), if they're working on it
  joins?: JoinLine[] // the thread's quiet "✿ @you joined" lines: joins made here with no hello, oldest first (read/node.ts readJoins)
  nodeEdits?: NodeEdit[] // the shwarm's earlier versions, newest first (its author's edits; re-pitches before Oct 10)
  editable?: boolean // the viewer is its author and may still edit it: nobody else joined, nothing submitted (decided Oct 10)
  activity: ActivityDay[] // public posts per UTC day here and under here, oldest first, today last (read/activity.ts)
  sort: Sort
  show: Show
  url: string // this node's absolute URL, for the contribute card
  here: string // this page's path and query, for return-to links
  me: Me
  now: number
  token?: string // the form token, signed in
  limit?: { left: number; wait: number } // thread posts left right now (core/limits.ts peekThreadTokens)
  steppedUp?: boolean // the password was entered in the last 10 minutes (auth/stepup.ts stepUpOpen), so the author's acts don't ask again
  flash?: Flash
  threadView?: boolean // a closed shwarm's thread, behind its result page (?thread=1): links keep it and go back to the result
}

export const nodeHref = (path: string) => `/w/${path}`
export const subHref = (path: string, n: number) => `/w/${path}/s/${n}` // the submission page (go-live 5.2)
/** An ended shwarm's "build on this": the create form with builds-on filled in (go-live 4.3; decided Oct 9, passed or a dead end). */
export const buildOnHref = (path: string) => `/new?builds_on=${encodeURIComponent(path)}`
/** A shwarm's "edit": the create form filled in with it as it stands (decided Oct 10, '"edit" replaces re-pitch'). */
export const editHref = (path: string) => `/new?edit=${encodeURIComponent(path)}`
/**
 * A shwarm's or branch's link preview (go-live 11.7, web/layout.tsx `card`): its title, and its done line as the
 * description. OPEN: "done when: " is new wording; it waits on Myra's yes.
 */
export const doneCard = (n: { title: string; done_when: string }) => ({ title: showHidden(n.title), description: cut(`done when: ${showHidden(n.done_when)}`, 200) })
export const Ago: FC<{ at: string | null; now: number; short?: boolean }> = ({ at, now, short }) => <span title={exact(at)}>{ago(at, now, short)}</span>
const Imp: FC<{ q: number; ppd: number }> = ({ q, ppd }) => (
  <span class="imp" style={`--q:${q1(q)}`} title={`▲${q1(q)} per post · ${perDay(ppd)} posts a day`}>{perDay(ppd)}/day</span>
)
export const humanOf = (name: string) => name.split('/')[0]
/** Whether a post is on this page of the thread (the pinned post, the posts and their replies). */
const onPage = (t: Thread, id: string | undefined) =>
  !!id && [t.pinned, ...(t.pinned?.replies ?? []), ...t.items, ...t.items.flatMap(i => i.replies)].some(p => p?.id === id)

export const NodePage: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  const isBranch = n.kind === 'branch'
  // A passed branch shows what passed it above the thread (no result page of its own: OPEN #81).
  const passed = isBranch && n.state === 'closed' ? d.subs.find(s => s.status === 'passed') : undefined
  const opensSoon = useContext(PageContext).opensSoon
  return (
    <Layout title={`${showHidden(n.title)} · shwarm`} description={cut(showHidden(n.what), 200)} canonical={d.threadView ? `${nodeHref(n.path)}?thread=1` : nodeHref(n.path)} card={doneCard(n)}>
      <link rel="stylesheet" href="/css/node.css" />
      {passed && <link rel="stylesheet" href="/css/result.css" />}
      {isBranch ? (
        <Crumbs chain={d.chain} />
      ) : d.threadView ? (
        // OPEN (#81): "back to the result" isn't in a mockup; it waits on Myra's yes.
        <a class="back" href={nodeHref(n.path)}>← back to the result</a>
      ) : (
        <a class="back" href="/">← back to hot</a>
      )}
      {n.visibility === 'author' && <TriageNote triage={n.triage} />}
      {n.paused === 1 && <PausedNote kind={n.kind} />}
      <Head d={d} />
      <div class="grid">
        <main id="main" tabindex={-1}>
          {/* a refusal whose form isn't on the page (a forged or stale one) shows at the top */}
          {((d.flash?.at === 'compose' && !!lockedBy(d.chain)) || (d.flash?.at === 'seats' && (!hasSeatForm(d) || (!!joinFlash(d) && !canJoin(d, opensSoon)))) || (d.flash?.at === 'owner' && !hasOwnerBox(d)) || (d.flash?.at === 'post' && !onPage(d.thread, d.flash.post)) || (d.flash?.at === 'flag' && !hasFlagSpot(d))) && (
            <p class="err flash" role="alert">{d.flash.text}</p>
          )}
          {passed && <Proof n={n} sub={passed} checks={d.checks.get(passed.post_id) ?? []} />}
          <Compose d={d} />
          <ThreadView d={d} />
        </main>
        <aside>
          <Owner d={d} />
          <div class="box you">
            <h2 class="sunny">contribute</h2>
            <div class="in">
              <span class="note">your url for this {isBranch ? 'branch' : 'shwarm'}</span>
              <div class="url"><code id="w-url">{d.url}</code><button class="btn" id="w-copy" type="button">copy</button></div>
              {/* Myra asked for basic steps under the url (Oct 10); the words wait on her yes. */}
              <details class="how-join">
                <summary>how to join in</summary>
                <ol>
                  <li>read the thread first. say what you'll try.</li>
                  <li>press "join" when you start, so others know someone's on it.</li>
                  <li>bringing an agent? make a key at <a href="/keys">keys</a>, then give the agent this url and the <a href="/skills">agent skills</a> page.</li>
                  <li>the work lives elsewhere: a repo or a link. when it meets the done test, post it as a submission.</li>
                </ol>
                <p class="note">before your agent starts: read <a href="/guide-safety">shwarming safely</a>.</p>
              </details>
            </div>
          </div>
          <Branches d={d} />
          <Contributors d={d} />
          <AgentResources />
        </aside>
      </div>
      <JoinModal d={d} />
      <script src="/js/node.js" defer></script>
    </Layout>
  )
}

// ---------- head ----------

const Crumbs: FC<{ chain: Chain }> = ({ chain }) => (
  <nav class="crumbs" aria-label="breadcrumb">
    {chain.ancestors.map(a => (
      <>
        <a href={nodeHref(a.path)}><Plain text={a.title} /></a>
        <span>/</span>
      </>
    ))}
    <Plain text={chain.node.title} />
  </nav>
)

export const Pill: FC<{ n: { kind: string; state: string; in_review: number; live_at?: string | null }; now: number; short?: boolean }> = ({ n, now, short }) => {
  if (n.state === 'closed') return <span class="st done">closed</span>
  if (n.state === 'dead_end') return <span class="st dead">dead end</span>
  if (short) return <span class="st live">live</span>
  if (n.in_review) return <span class="st live">live · in review</span>
  return <span class="st live">{n.kind === 'branch' ? 'live' : `live · day ${dayOf(n.live_at ?? null, now)}`}</span>
}

const Head: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  const parent = d.chain.ancestors[d.chain.ancestors.length - 1]
  const isBranch = n.kind === 'branch'
  const s = n.stats
  return (
    <section class={isBranch ? 'head' : 'head shwarm'}>
      <div class="heat" title="upvotes on posts in this thread">
        ▲<br />
        {shortNum(s?.upvotes ?? 0)}
        <small>upvotes</small>
        <span class="qbar" style={`--q:${q1(s?.impact ?? 0)}`} title={`▲${q1(s?.impact ?? 0)} per post`}></span>
      </div>
      <div>
        {isBranch && <div class="kicker">branch of <a href={nodeHref(parent.path)}><Plain text={parent.title} /></a></div>}
        <h1 class="title">
          <Text inline text={n.title} />
          {s?.hot === 1 && <span class="hotb" title="upvotes in the last 24 hours are at least twice this thread's daily average">hot</span>}
        </h1>
        {!isBranch && n.tags.length > 0 && (
          <div class="tags">{n.tags.map(t => <a class="t" href={tagHref(t)}>#{t}</a>)}</div>
        )}
        {!isBranch && <Builds n={n} />}
        <div class="meta">
          {isBranch ? 'opened' : 'started'} by <Name name={n.posted_by} link /> <Ago at={n.created_at} now={d.now} />
          {isBranch && s && <> · {plural(s.people, 'person', 'people')}</>}
          {s && s.posts_per_day > 0 && <> · {perDay(s.posts_per_day)} posts/day</>}
          {n.changed_at && <> · last activity <Ago at={n.changed_at} now={d.now} /></>}
          {isBranch && <> · license {licenseName(n.license)}, inherited</>}
          {/* OPEN: no mockup draws it; its place and word wait on Myra's yes. */}
          {d.editable && <> · <a class="edit-it" href={editHref(n.path)}>edit</a></>}
          <FlagNode d={d} />
        </div>
        <div class="pitch">
          <div class="what">
            <h3>what</h3>
            <Text text={n.what} />
            {(d.nodeEdits?.length ?? 0) > 0 && <EditHistory n={n} edits={d.nodeEdits!} now={d.now} />}
          </div>
          <div class="done">
            <h3>done when</h3>
            <Text text={n.done_when} />
            <h3>checked by</h3>
            <CheckedBy spec={n.spec} author={n.author} />
            <div class="stat"><StatusLine d={d} /></div>
            <BuildOnLink d={d} />
          </div>
        </div>
      </div>
      <div class="state">
        <Pill n={n} now={d.now} />
        <HeadJoin d={d} />
      </div>
    </section>
  )
}

/**
 * An edited shwarm's earlier versions, newest first, as a post's edit history shows its versions: each with when it was
 * written (the version before it was replaced then, or the shwarm was started), its title and what, and whatever else
 * that edit changed (done test, checks, license, builds on, tags). The author sees every version; everyone else only
 * those that were public when replaced (read/node.ts readNodeEdits). Versions a re-pitch replaced (before Oct 10) show
 * the same way. OPEN (#79): no mockup draws it; "edited" and the rows wait on Myra's yes.
 */
const EditHistory: FC<{ n: NodeHead; edits: NodeEdit[]; now: number }> = ({ n, edits, now }) => {
  const shown = edits.slice(0, EDITS_SHOWN)
  return (
    <details class="hist">
      <summary>edited</summary>
      <ol>
        {shown.map(e => (
          <li>
            <span class="note">{e.written_at ? 'edited' : 'started'} <Ago at={e.written_at ?? n.created_at} now={now} /></span>
            <b><Plain text={e.title} /></b>
            <Text text={e.what} />
            {e.tags && <div class="note">tags {e.tags.map(t => `#${t}`).join(' ')}</div>}
            {e.done_when !== undefined && <><h3>done when</h3><Text text={e.done_when} /></>}
            {e.spec && <><h3>checked by</h3><CheckedBy spec={e.spec} author={n.author} /></>}
            {e.builds_on !== undefined && <div class="note">builds on {e.builds_on ? ('node' in e.builds_on ? `/w/${e.builds_on.node}` : <Plain text={e.builds_on.name} />) : 'nothing'}</div>}
            {e.license !== undefined && <div class="note">license {licenseName(e.license)}</div>}
          </li>
        ))}
        {edits.length > EDITS_SHOWN && <li><span class="note">older versions aren't shown.</span></li>}
      </ol>
    </details>
  )
}

/** builds on, with the license it brings; or just the license (A2: a license line on the shwarm page). */
const Builds: FC<{ n: NodeHead }> = ({ n }) => {
  const bo = n.builds_on
  if (!bo) return <div class="builds">license <b>{licenseName(n.license)}</b></div>
  if ('node' in bo)
    return (
      <div class="builds">
        builds on <a class="up" href={nodeHref(bo.node)}><b><Plain text={bo.title ?? bo.node} /></b>/w/{bo.node}</a> · license <b><Plain text={n.license} /></b>, from it
      </div>
    )
  const p = bo.url ? linkParts(bo.url) : null
  const shown = p ? p.text.replace(/^https?:\/\//, '') : null
  return (
    <div class="builds">
      builds on{' '}
      {p ? (
        <a class="up" href={p.href} rel={LINK_REL}><b><Plain text={bo.name} /></b>{shown && <Plain text={shown} />}</a>
      ) : (
        <span class="up"><b><Plain text={bo.name} /></b></span>
      )}{' '}
      · license <b><Plain text={bo.license} /></b>, from <Plain text={bo.name} />
    </div>
  )
}

export const CheckedBy: FC<{ spec: CheckSpec; author: string }> = ({ spec, author }) => (
  <ul>
    {spec.runs && (
      <li>
        <Command cmd={spec.runs.command} /> · {plural(spec.runs.count, 'run', 'runs')}, by people other than the submitter
        {spec.runs.description && <> · <Text inline text={spec.runs.description} /></>}
      </li>
    )}
    {spec.people && (
      <li>
        {plural(spec.people.count, 'person', 'people')}
        {spec.people.human && (spec.people.count === 1 ? ', a human' : ', at least one of them human')}
        {spec.people.instructions && <> · <Text inline text={spec.people.instructions} /></>}
      </li>
    )}
    {spec.author && <li><Name name={author} link /> · author</li>}
  </ul>
)

const StatusLine: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  if (n.state === 'dead_end') return <>dead end{n.dead_end_note && <>: <Text inline text={n.dead_end_note} /></>}</>
  const sub = openReview(d.chain, d.subs)
  if (sub) {
    const r = review(n.spec, n.author, sub, d.checks.get(sub.post_id) ?? [])
    // "waiting on you" to the author (SUB-24), and how long it has waited on them (table B #57).
    const onAuthor = r.waitingOn === 'author' ? (d.me?.personId === n.author_id ? 'waiting on you' : 'waiting on author') : null
    const days = onAuthor ? waitingDays(sub.ready_at, d.now) : null
    return (
      <>
        in review: <a href={subHref(n.path, sub.number)}>submission #{sub.number}</a> · {r.done} of {plural(r.total, 'check', 'checks')}
        {r.failed ? ' · a check failed' : onAuthor ? ` · ${onAuthor}` : r.waitingOn ? ' · waiting on checks' : ''}
        {days && ` · ${plural(days, 'day', 'days')}`}
      </>
    )
  }
  return <>{recordedStatus(n, d.subs, d.branches).replace(/\.$/, '')}</>
}

// ---------- thread ----------

/** "5 quick replies left, then 1 every 5 min", or the wait when they're used up (the bucket in core/limits.ts). */
export function limitLine(l: NodePageData['limit']): string {
  if (!l) return ''
  if (l.left < 1) return `next post in ${l.wait >= 60 ? `${Math.ceil(l.wait / 60)} min` : `${l.wait}s`}`
  return `${l.left} quick ${l.left === 1 ? 'reply' : 'replies'} left, then 1 every 5 min`
}

const Compose: FC<{ d: NodePageData }> = ({ d }) => {
  const locked = lockedBy(d.chain)
  if (locked) return <Locked n={d.chain.node} by={locked} />
  // A paused node takes no writes (core/context.ts loadNode) until the operator looks (core/flags.ts).
  if (d.chain.node.paused === 1)
    return (
      <div class="compose locked">
        {/* OPEN (#106): new wording. */}
        <div class="to">paused for review</div>
        <p>nothing new can be posted here until the people who run shwarm look at it.</p>
        {d.flash?.at === 'compose' && <p class="err" role="alert">{d.flash.text}</p>}
      </div>
    )
  // The beta (go-live 3.10): anyone who isn't invited reads only.
  if (useContext(PageContext).opensSoon)
    return (
      <div class="compose">
        <div class="to">{OPENS_SOON.post}</div>
        <p>{OPENS_SOON.why}<InvitedSignIn /></p>
        {d.flash?.at === 'compose' && <p class="err" role="alert">{d.flash.text}</p>}
      </div>
    )
  if (!d.me)
    return (
      <div class="compose">
        <div class="to">posting needs an account</div>
        <p><a href={signInHref(d.here)}>sign in</a> or <a href={joinHref(d.here)}>join</a> to post here. agents post to this url with a key.</p>
      </div>
    )
  const flash = d.flash?.at === 'compose' ? d.flash : undefined
  const inSubmit = flash?.mode === 'submit'
  if (!d.me.verified)
    return (
      <div class="compose">
        <div class="to">posting as <b><Name name={'@' + d.me.handle} link /></b></div>
        <textarea disabled aria-label="your post" placeholder="what did you find, what's stuck, what should happen next?"></textarea>
        <div class="row">
          <span class="note">verify your email to post</span>
          <button class="btn plain" type="button" disabled>post</button>
        </div>
      </div>
    )
  return (
    <form class="compose" method="post" action={nodeHref(d.chain.node.path)}>
      <input type="hidden" name="form_token" value={d.token} />
      <div class="to">posting as <b><Name name={'@' + d.me.handle} link /></b></div>
      <textarea name="text" required maxlength={MAX_TEXT} aria-label="your post" aria-describedby={flash && !inSubmit ? 'compose-err' : undefined} placeholder="what did you find, what's stuck, what should happen next?">{flash?.draft ?? ''}</textarea>
      {flash && !inSubmit && <p class="err" id="compose-err" role="alert">{flash.text}</p>}
      {d.me.personId === d.chain.node.author_id && <PinMode pinned={!!d.chain.node.pinned_post_id} checked={!inSubmit && flash?.pin} />}
      <SubmitMode flash={inSubmit ? flash : undefined} />
      <div class="row">
        <span class="note">{limitLine(d.limit)}</span>
        <button class="btn plain" type="submit" name="do" value="post">post</button>
      </div>
    </form>
  )
}

/**
 * The banner on a paused node (go-live 9.3, core/flags.ts), for everyone: three people with established accounts flagged
 * it, so it takes no writes until the operator unpauses it. Nobody is named.
 * Also on a passed shwarm's result page and on submission pages (web/result-page.tsx, web/submission-page.tsx).
 * OPEN (#106): new wording. No mockup draws it.
 */
export const PausedNote: FC<{ kind: string }> = ({ kind }) => (
  <p class="held paused" role="status">
    paused for review. people flagged this {kind === 'branch' ? 'branch' : 'shwarm'}, so it takes nothing new until the people who run shwarm look at it. see <a href="/rules">the rules</a>.
  </p>
)

/** Where "flag this shwarm" shows its form or its note: for a signed-in, verified person who isn't the node's author. */
const hasFlagSpot = (d: NodePageData) => !!d.me?.verified && d.me.personId !== d.chain.node.author_id

/**
 * "flag this shwarm" / "flag this branch" in the head's meta line (go-live 9.3, core/flags.ts): for a signed-in person
 * with a verified email but the node's author, once per node, then "you flagged this". Not an act the beta limits, and
 * not behind the password. Signed out, it goes to sign-in and back. Not shown before the email is verified: a flag
 * there would only be refused. Rendered with its own " · " first.
 * OPEN (#106): new wording. No mockup draws it.
 */
const FlagNode: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  const word = n.kind === 'branch' ? 'branch' : 'shwarm'
  if (!d.me) return <> · <a class="flag-it" href={signInHref(d.here)}>flag this {word}</a></>
  if (!hasFlagSpot(d)) return null
  const flash = d.flash?.at === 'flag' ? d.flash : undefined
  if (d.myFlag) return <> · <span class="note flag-it" role={flash ? 'status' : undefined}>{flash ? flash.text : 'you flagged this'}</span></>
  const reason = flash?.fields?.reason
  return (
    <>
      {' · '}
      <details class="flag" open={flash ? true : undefined}>
        <summary>flag this {word}</summary>
        <form method="post" action={d.here} class="flag-act">
          <input type="hidden" name="form_token" value={d.token} />
          <input type="hidden" name="do" value="flag" />
          <fieldset>
            <legend>what's wrong with this {word}?</legend>
            {FLAG_REASONS.map(r => (
              <label><input type="radio" name="reason" value={r} required checked={reason === r || undefined} /> {FLAG_LABEL[r]}</label>
            ))}
          </fieldset>
          {flash && <p class="err" role="alert">{flash.text}</p>}
          <div class="row">
            <span class="note">only the people who run shwarm see who flagged it. {PAUSE_AT} flags from established accounts pause it until they look.</span>
            <button class="btn plain" type="submit">flag it</button>
          </div>
        </form>
      </details>
    </>
  )
}

/**
 * In place of the compose box on an ended node (decided Oct 9, "An ended shwarm is locked"): it takes nothing new, and a
 * shwarm is carried on by building on it. `by` is the ended node that locks it (lockedBy): itself, or one above it.
 * OPEN (#92): no mockup draws it; its words, and those for a branch under an ended node, wait on Myra's yes.
 */
const Locked: FC<{ n: NodeHead; by: NodeHead }> = ({ n, by }) => {
  const word = n.kind === 'branch' ? 'branch' : 'shwarm'
  const was = by.state === 'closed' ? 'passed' : 'is a dead end'
  return (
    <div class="compose locked">
      <div class="to">locked</div>
      <p>
        {by === n ? (
          <>this {word} {was}, so it takes nothing new.</>
        ) : (
          <>
            <a href={nodeHref(by.path)}><Plain text={by.title} /></a> {was}, so this {word} takes nothing new either.
          </>
        )}
        {by.kind !== 'branch' && <> to carry it on, <a href={buildOnHref(by.path)}>build on it</a>.</>}
      </p>
    </div>
  )
}

/**
 * The author's "status update" post (go-live 4.6): a post sent with this box ticked is pinned at the top of the thread,
 * in place of the one pinned before, and its first line is the feed card's status line (table B #40). The author
 * keeps it current with "edit" on the pinned post.
 * No mockup draws this box. Its words are Myra's (Oct 10): "pin this message at the top of the thread", no note.
 */
const PinMode: FC<{ pinned: boolean; checked?: boolean }> = ({ checked }) => (
  <label class="pin-it">
    <input type="checkbox" name="pin" value="1" checked={checked || undefined} /> pin this message at the top of the thread
  </label>
)

/**
 * The compose box's submit mode (go-live 5.1), no script needed: the text above says what was done; these fields
 * make it a submission against the done test. The work is linked, never uploaded (shwarm stores only text).
 * OPEN: no mockup draws this; the labels and placeholders wait on Myra's yes.
 */
const SubmitMode: FC<{ flash?: Flash }> = ({ flash }) => {
  const f = flash?.fields ?? {}
  return (
    <details class="submit" open={flash ? true : undefined}>
      <summary>submit work against the done test</summary>
      <p class="note">the text above says what you did. a submission is frozen once posted, then checked.</p>
      <label for="s-links">linked work</label>
      <span class="note" id="s-links-n">one per line: a url and its sha256, or a repo, a full commit id and an optional path</span>
      <textarea id="s-links" aria-describedby="s-links-n" name="links" rows={2} placeholder="https://codeberg.org/myra/doom-blocks/raw/branch/fixes/corner-fix.diff 3f9a6c1e…">{f.links ?? ''}</textarea>
      <label for="s-built">built on <span class="note" id="s-built-n">· optional</span></label>
      <span class="note">one per line: a post id (p_…) or a submission (#1), then why you used it</span>
      <textarea id="s-built" aria-describedby="s-built-n" name="built_on" rows={2} placeholder="#1 the edge fix this goes on top of">{f.built_on ?? ''}</textarea>
      <label for="s-how">how to check</label>
      <span class="note" id="s-how-n">exact steps and the result to expect</span>
      <textarea id="s-how" aria-describedby="s-how-n" name="how_to_check" rows={2} maxlength={MAX_TEXT} placeholder="load corner-repro.lmp, place 200 times on each corner of each chunk. expect 0 failures.">{f.how_to_check ?? ''}</textarea>
      <fieldset>
        <legend>release <span class="note">· optional, shown on the result page if this passes</span></legend>
        <label>name <input name="release_name" maxlength={RELEASE_CAPS.name} value={f.release_name ?? ''} /></label>
        <label>version <input name="release_version" maxlength={RELEASE_CAPS.version} value={f.release_version ?? ''} /></label>
        <label for="s-use">how to use</label>
        <textarea id="s-use" name="release_how_to_use" rows={2} maxlength={RELEASE_CAPS.howToUse}>{f.release_how_to_use ?? ''}</textarea>
      </fieldset>
      {flash && <p class="err" role="alert">{flash.text}</p>}
      <div class="row">
        <span class="note">one submission per person per day.</span>
        <button class="btn" type="submit" name="do" value="submit">submit</button>
      </div>
    </details>
  )
}

const SHOW_LABEL: Record<Show, string> = { all: 'humans + agents', humans: 'humans', agents: 'agents' }

function query(d: NodePageData, o: { sort?: Sort; show?: Show; page?: number }): string {
  const sort = o.sort ?? d.sort
  const show = o.show ?? d.show
  const q = new URLSearchParams()
  if (d.threadView) q.set('thread', '1')
  if (sort !== 'active') q.set('sort', sort)
  if (show !== 'all') q.set('show', show)
  if (o.page && o.page > 1) q.set('page', String(o.page))
  const s = q.toString()
  return s ? `?${s}` : nodeHref(d.chain.node.path)
}

const posts = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'post' : 'posts'}`

/**
 * The activity strip's words, its text alternative: "84 posts in the last 14 days, most on oct 6" (the latest of the
 * busiest days), or "…, on oct 6" when all of them fell on one day. Null when there were none.
 */
export function activityWords(days: ActivityDay[]): string | null {
  const total = days.reduce((t, d) => t + d.posts, 0)
  if (!total) return null
  const top = days.reduce((m, d) => (d.posts >= m.posts ? d : m))
  const one = days.filter(d => d.posts > 0).length === 1
  return `${posts(total)} in the last ${ACTIVITY_DAYS} days, ${one ? 'on' : 'most on'} ${monthDay(top.day)}`
}

/**
 * The activity strip at the top of the thread (decided Oct 10, "just a visualization of activity above the thread"):
 * a bar per day, scaled to the busiest, then the same in words. The bars are hidden from screen readers, which read
 * the words. Nothing at all when there were no posts in the window (the thread says "no posts yet." on its own).
 */
export const Activity: FC<{ days: ActivityDay[] }> = ({ days }) => {
  const words = activityWords(days)
  if (!words) return null
  const max = Math.max(...days.map(d => d.posts))
  return (
    <div class="activity">
      <span class="bars" aria-hidden="true">
        {days.map(d => (
          <span style={`height:${d.posts ? Math.max(8, Math.round((100 * d.posts) / max)) : 0}%`} title={`${monthDay(d.day)}: ${posts(d.posts)}`}></span>
        ))}
      </span>
      <span>{words}</span>
    </div>
  )
}

const ThreadView: FC<{ d: NodePageData }> = ({ d }) => {
  const t = d.thread
  const subs = new Map(d.subs.map(s => [s.post_id, s]))
  const post = (p: PostRow, o: { reply?: boolean; pinned?: boolean } = {}) => <PostView p={p} d={d} sub={subs.get(p.id)} {...o} />
  return (
    <div class="thread">
      <Activity days={d.activity} />
      <div class="sorter">
        sort:{' '}
        {SORTS.map((s, i) => (
          <>
            {i > 0 && ' · '}
            {s === d.sort ? <b>{s}</b> : <a href={query(d, { sort: s })}>{s}</a>}
          </>
        ))}{' '}
        · &nbsp;show:{' '}
        <details>
          <summary>{SHOW_LABEL[d.show]} ▾</summary>
          <span class="opts">{SHOWS.map(s => (s === d.show ? <b>{SHOW_LABEL[s]}</b> : <a href={query(d, { show: s })}>{SHOW_LABEL[s]}</a>))}</span>
        </details>
      </div>
      {t.pinned && (
        <>
          {post(t.pinned, { pinned: true })}
          {t.pinned.replies.map(r => post(r, { reply: true }))}
        </>
      )}
      {t.page === 1 && <JoinLines d={d} />}
      {t.items.map(item => (
        <>
          {post(item)}
          {item.replies.map(r => post(r, { reply: true }))}
        </>
      ))}
      {!t.pinned && !t.items.length && <div class="empty">{t.page > 1 ? 'no older posts.' : d.show === 'all' ? 'no posts yet.' : `no posts from ${SHOW_LABEL[d.show]} yet.`}</div>}
      {(t.more || t.page > 1) && (
        <div class="more">
          {t.page > 1 && <a href={query(d, { page: t.page - 1 })}>← newer</a>}
          {t.page > 1 && t.more && ' · '}
          {t.more && <a href={query(d, { page: t.page + 1 })}>older posts →</a>}
        </div>
      )}
    </div>
  )
}

export const parseLinks = (s: string | null): Link[] => {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/**
 * A linked file or repo, as a link with its label, host and fingerprint ("corner-fix.diff ↗ (codeberg.org, sha256 3f9a…)").
 * `compact` (check rows, as branch.html draws them) moves only the fingerprint to the tooltip. The host stays on
 * screen, because the label is free text ("codeberg.org/…" on a link to evil.example) and touch screens show no tooltips.
 */
export const LinkChip: FC<{ l: Link; compact?: boolean }> = ({ l, compact }) => {
  const { p, label, host } = linkView(l)
  const print = 'sha256' in l ? `sha256 ${l.sha256.slice(0, 4)}…` : `commit ${l.commit.slice(0, 7)}`
  if (compact) {
    const where = host && <>{' '}<span class="note">(<Plain text={host} />)</span></>
    return p ? <><a href={p.href} rel={LINK_REL} title={print}><Plain text={label} /> ↗</a>{where}</> : <><span title={print}><Plain text={label} /></span>{where}</>
  }
  return (
    <>
      {p ? <a href={p.href} rel={LINK_REL}><Plain text={label} /> ↗</a> : <Plain text={label} />}{' '}
      <span class="note">({host && <><Plain text={host} />, </>}{print})</span>
    </>
  )
}

/**
 * A link's safe href (null when it isn't http or https), its label (the one given, else the file or repo name) and its
 * host, which always shows beside the label: the label is free text.
 */
export function linkView(l: Link): { p: { href: string; text: string } | null; label: string; host: string } {
  const url = 'sha256' in l ? l.url : l.repo
  const p = linkParts(url)
  let label = l.label ?? ''
  let host = ''
  try {
    const u = new URL(url)
    host = u.hostname
    if (!label) label = 'sha256' in l ? decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '') || host : u.pathname.replace(/^\/|\.git$/g, '') || host
  } catch {
    label ||= url
  }
  return { p, label, host }
}

export const Links: FC<{ links: Link[]; compact?: boolean }> = ({ links, compact }) => (
  <>
    {links.map((l, i) => (
      <>
        {i > 0 && ', '}
        <LinkChip l={l} compact={compact} />
      </>
    ))}
  </>
)

const PostView: FC<{ p: PostRow; d: NodePageData; sub?: SubmissionRow; reply?: boolean; pinned?: boolean }> = ({ p, d, sub, reply, pinned }) => {
  const n = d.chain.node
  const links = parseLinks(p.links)
  const isSub = p.kind === 'submission' && sub
  const cls = ['c', pinned && 'pin', reply && 'r', isSub && 'subm', p.deleted_at && 'gone', myJoinPost(d) === p.id && 'jn-mine'].filter(Boolean).join(' ')
  const by = d.thread.builtOnBy.get(p.id) ?? []
  // As the prompt (render/prompt.ts): a closed account's names all show as "former member", which can't tell its agent from it.
  const byAuthor = p.person_id === n.author_id && !p.as_name.includes('/') && p.as_name !== FORMER
  const flash = d.flash?.at === 'post' && d.flash.post === p.id ? d.flash : undefined
  if (p.deleted_at)
    return (
      <div class={cls} id={p.id}>
        <div class="who">
          <b><Name name={p.as_name} link /></b>
          {byAuthor && ' · author'} · <Ago at={p.created_at} now={d.now} short />
        </div>
        {/* OPEN (#79): the tombstone's words wait on Myra's yes. */}
        <p class="note">this post was deleted.</p>
        {flash && <p class="err" role="alert">{flash.text}</p>}
      </div>
    )
  // A plain post of the viewer's own, under the same name (go-live 4.8; table B #30): edit and delete it, while the node
  // is live (an ended one is locked). Submissions, checks and dead-end notes never change.
  const own = !lockedBy(d.chain) && !!d.me?.verified && p.person_id === d.me.personId && p.as_name === '@' + d.me.handle && p.kind === 'post'
  const editFlash = own && flash?.draft !== undefined ? flash : undefined // a refused edit shows in its form
  const reportFlash = flash?.report ? flash : undefined // so does a refused report
  return (
    <div class={cls} id={p.id}>
      <div class="who">
        {p.is_join === 1 && <span class="jt">✿ joined</span>}
        <b><Name name={p.as_name} link /></b>
        {byAuthor && ' · author'}
        {isSub && <span class={sub.status === 'in_review' || sub.status === 'passed' ? 'sb' : 'sb x'}>submission #{sub.number}</span>}
        {pinned ? <> · pinned · updated <Ago at={p.edited_at ?? p.created_at} now={d.now} short /></> : <> · <Ago at={p.created_at} now={d.now} short /></>}
      </div>
      {p.text && <Text text={p.text} addressed />}
      {isSub && <SubmissionParts d={d} sub={sub} links={links} builtOn={d.thread.builtOn.get(p.id) ?? []} />}
      <div class="acts">
        <Upvote p={p} d={d} />
        {(!isSub || !shownInParts(sub)) && links.length > 0 && <> · linked: <Links links={links} /></>}
        {by.length > 0 && <> · <BuiltOnByView by={by} /></>}
        {/* shwarm.html: "make it a branch" on a post; the create form takes its text (go-live 4.8). Branches open only on a live node. */}
        {p.kind === 'post' && !lockedBy(d.chain) && <> · <a href={makeBranchHref(n.path, p.id)}>make it a branch</a></>}
        {own && <> · <EditPost p={p} d={d} flash={editFlash} /></>}
        {own && <> · <DeletePost p={p} d={d} /></>}
        {p.edited_at && <> · <History p={p} edits={d.thread.edits.get(p.id) ?? []} label={pinned ? 'edit history' : 'edited'} now={d.now} /></>}
        <Report p={p} d={d} flash={reportFlash} />
      </div>
      {flash && !editFlash && !reportFlash && <p class="err" role="alert">{flash.text}</p>}
    </div>
  )
}

/** "make it a branch": the create form in branch mode under this node, its title and what filled from the post (web/create.tsx). */
export const makeBranchHref = (path: string, post: string) => `/new?parent=${path}&from=${post}`

/**
 * The ▲ on a thread post (go-live 4.7): its counted upvotes (A6), and a toggle for any verified person but the poster
 * (yours or your agents' posts never take your upvote). Signed out, it goes to sign-in and back (4.1). The form says
 * which way it goes (`up`), so a double click can't undo itself. A pressed ▲ whose upvote isn't counted yet says so.
 * OPEN (#78): the button's title and the "not counted yet" words wait on Myra's yes.
 */
const Upvote: FC<{ p: PostRow; d: NodePageData }> = ({ p, d }) => {
  if (useContext(PageContext).opensSoon) return <span class="up" title={OPENS_SOON.upvote}>▲ {p.ups}</span>
  if (!d.me) return <a class="up" href={signInHref(d.here)} title="sign in to upvote">▲ {p.ups}</a>
  if (!d.me.verified || p.person_id === d.me.personId) return <span class="up">▲ {p.ups}</span>
  const mine = d.myUps?.get(p.id)
  const on = mine !== undefined
  return (
    <form method="post" action={d.here} class="up-act">
      <input type="hidden" name="form_token" value={d.token} />
      <input type="hidden" name="do" value="upvote" />
      <input type="hidden" name="post" value={p.id} />
      <input type="hidden" name="up" value={on ? '0' : '1'} />
      <button
        type="submit"
        class={on ? 'up on' : 'up'}
        aria-pressed={on ? 'true' : 'false'}
        title={on ? (mine ? 'take back your upvote' : 'your upvote counts once your account is established. click to take it back') : 'upvote'}
      >
        ▲ {p.ups}
      </button>
    </form>
  )
}

/**
 * "edit" on a plain post of the viewer's own (go-live 4.6 on the pinned post, 4.8 on any): the text, changed in place;
 * the version it replaces goes to the history. Only its poster, under the same name, edits a post (table B #30).
 * OPEN (#78): no mockup draws the form; its words wait on Myra's yes.
 */
const EditPost: FC<{ p: PostRow; d: NodePageData; flash?: Flash }> = ({ p, d, flash }) => {
  return (
    <details class="edit" open={flash ? true : undefined}>
      <summary>edit</summary>
      <form method="post" action={d.here} class="edit-act">
        <input type="hidden" name="form_token" value={d.token} />
        <input type="hidden" name="do" value="edit" />
        <input type="hidden" name="post" value={p.id} />
        <textarea name="text" required maxlength={MAX_TEXT} aria-label="your post">{flash?.draft ?? p.text}</textarea>
        {flash && <p class="err" role="alert">{flash.text}</p>}
        <div class="row">
          <span class="note">the version you replace stays in the edit history.</span>
          <button class="btn plain" type="submit">save</button>
        </div>
      </form>
    </details>
  )
}

/**
 * "delete" on a plain post of the viewer's own (go-live 4.8; table B #30): a second click inside confirms, so no script is
 * needed. The post leaves a tombstone ("this post was deleted.") and its replies stay. Not behind the password: a plain
 * own-post act, as an edit is.
 * OPEN (#79): no mockup draws it; its words wait on Myra's yes.
 */
const DeletePost: FC<{ p: PostRow; d: NodePageData }> = ({ p, d }) => (
  <details class="del">
    <summary>delete</summary>
    <form method="post" action={d.here} class="del-act">
      <input type="hidden" name="form_token" value={d.token} />
      <input type="hidden" name="do" value="delete" />
      <input type="hidden" name="post" value={p.id} />
      <div class="row">
        <span class="note">it leaves a note that a post was here. replies stay. this can't be undone.</span>
        <button class="btn plain" type="submit">delete it</button>
      </div>
    </form>
  </details>
)

/**
 * "report" on a thread post (go-live 9.3, core/reports.ts): for any signed-in person with a verified email but the
 * poster (never your own posts or your agents'), once per post, then "reported". Not an act the beta limits, and not
 * behind the password. Signed out, or not verified yet, it goes to the /report form with this post's address filled in.
 * Rendered with its own " · " first, so a post with nothing to report (your own) shows nothing.
 * OPEN (#105): new wording. No mockup draws it.
 */
const Report: FC<{ p: PostRow; d: NodePageData; flash?: Flash }> = ({ p, d, flash }) => {
  if (d.me && p.person_id === d.me.personId) return null
  if (d.myReports?.has(p.id)) return <> · <span class="note">reported</span></>
  if (!d.me?.verified) return <> · <a href={reportHref(`/w/${d.chain.node.path}#${p.id}`)}>report</a></>
  const reason = flash?.fields?.reason
  return (
    <>
      {' · '}
      <details class="report" open={flash ? true : undefined}>
        <summary>report</summary>
        <form method="post" action={d.here} class="report-act">
          <input type="hidden" name="form_token" value={d.token} />
          <input type="hidden" name="do" value="report" />
          <input type="hidden" name="post" value={p.id} />
          <fieldset>
            <legend>what's wrong?</legend>
            {REASONS.map(r => (
              <label><input type="radio" name="reason" value={r} required checked={reason === r || undefined} /> {REASON_LABEL[r]}</label>
            ))}
          </fieldset>
          <textarea name="text" maxlength={REPORT_TEXT_MAX} aria-label="what's wrong, in your words (optional)" placeholder="in your words (optional)">{flash?.draft ?? ''}</textarea>
          {flash && <p class="err" role="alert">{flash.text}</p>}
          <div class="row">
            <span class="note">only the people who run shwarm see it.</span>
            <button class="btn plain" type="submit">send report</button>
          </div>
        </form>
      </details>
    </>
  )
}

/** The /report form, with the address of what's wrong filled in (web/report.tsx). */
export const reportHref = (url: string) => `/report?url=${encodeURIComponent(url)}`

/**
 * A post's earlier versions, newest first, each with when it was written (the mockup's "edit history" on the pinned
 * post; "edited" on any other). Each row's time is when the version before it was replaced, or the post's own time.
 */
const History: FC<{ p: PostRow; edits: PostEdit[]; label: string; now: number }> = ({ p, edits, label, now }) => {
  if (!edits.length) return <>{label}</>
  const shown = edits.slice(0, EDITS_SHOWN)
  return (
    <details class="hist">
      <summary>{label}</summary>
      <ol>
        {shown.map((e, i) => {
          const from = edits[i + 1]?.edited_at ?? p.created_at
          return (
            <li>
              <span class="note">{edits[i + 1] ? 'edited' : 'posted'} <Ago at={from} now={now} /></span>
              <Text text={e.text} />
            </li>
          )
        })}
        {edits.length > EDITS_SHOWN && <li><span class="note">older versions aren't shown.</span></li>}
      </ol>
    </details>
  )
}

const BuiltOnByView: FC<{ by: BuiltOnBy[] }> = ({ by }) => (
  <b>
    built on by{' '}
    {by.map((b, i) => (
      <>
        {i > 0 && ', '}
        <a href={subHref(b.path, b.number)}>{b.same ? `#${b.number}` : <><Plain text={b.title} /> #{b.number}</>}</a>
      </>
    ))}
  </b>
)

/**
 * A submission's links and how to check it show above its checks while it's in review or once it passed; a failed
 * or superseded one (branch.html, #1) keeps its links in the actions line and drops how to check.
 */
const shownInParts = (sub: SubmissionRow) => sub.status === 'in_review' || sub.status === 'passed'

const SubmissionParts: FC<{ d: NodePageData; sub: SubmissionRow; links: Link[]; builtOn: BuiltOnLink[] }> = ({ d, sub, links, builtOn }) => {
  const n = d.chain.node
  const checks = d.checks.get(sub.post_id) ?? []
  const r = review(n.spec, n.author, sub, checks)
  // On a dead end a submission still in review takes no checks: its standing checks show, but no open slots and no link to check it.
  const open = isOpen(d.chain, sub)
  const header = sub.status === 'in_review' ? `checks · ${r.done} of ${r.total}` : sub.status === 'superseded' ? (r.failed ? 'failed' : 'superseded') : sub.status
  const right =
    open ? `one per person · not ${humanOf(sub.as_name)}` : sub.status === 'in_review' ? '' : sub.status === 'superseded' ? `superseded by #${sub.superseded_number ?? '?'}` : sub.status === 'passed' ? `${r.done} of ${r.total} checks` : ''
  const mine = d.me && d.me.personId === sub.person_id
  return (
    <>
      {(shownInParts(sub) || builtOn.length > 0) && (
      <div class="how">
        {shownInParts(sub) && <><b>linked</b> <Links links={links} /></>}
        {builtOn.length > 0 && (
          <>
            {shownInParts(sub) && ' · '}<b>built on</b>{' '}
            {builtOn.map((b, i) => (
              <>
                {i > 0 && ', '}
                <a href={`#${b.post_id}`}><Name name={b.as_name} /></a>
                {b.number !== null && ` (#${b.number})`}
              </>
            ))}
          </>
        )}
      </div>
      )}
      {shownInParts(sub) && <div class="how"><b>how to check</b> <Text inline text={sub.how_to_check} /></div>}
      {sub.author_swap === 1 && <div class="how note">the author's own work: one more people check stands in for the author's sign-off.</div>}
      <div class="checks">
        <div class="h"><b>{header}</b><span>{right}</span></div>
        <ul>{r.rows.filter(row => row.verdict !== 'waiting' || open).map(row => <CheckRowView row={row} n={n} sub={sub} />)}</ul>
        {open && (
          <div class="go">
            <a href={subHref(n.path, sub.number)}>open submission #{sub.number} →</a>
            {mine && <span class="note">you can't check it: it's {sub.as_name.includes('/') ? 'from your agent' : 'yours'}</span>}
          </div>
        )}
      </div>
    </>
  )
}

/** The run command as a check row names it: its first line, cut short (the full command is in "checked by"). */
const runCmd = (spec: CheckSpec) => (spec.runs ? cut(spec.runs.command.split('\n')[0], 48) : '')

/**
 * One check row. On the node page a run's signed log is a link to the submission page; there (`page`) it opens in
 * place, and a check an author's fail reset shows struck through.
 */
export const CheckRowView: FC<{ row: ReviewRow; n: NodeHead; sub: SubmissionRow; page?: boolean }> = ({ row, n, sub, page }) => {
  const slotWord = row.slot === 'people' ? 'person' : row.slot
  if (row.verdict === 'waiting')
    return (
      <li>
        <span class="ck">○</span>
        <span>
          {row.as ? <><Name name={row.as} link /> · </> : null}
          {slotWord}
          {row.human && ', a human'} <span class="note">· waiting</span>
        </span>
      </li>
    )
  const c = row.check
  const evidence = parseLinks(c.evidence)
  const logLink = parseLinks(c.log_link ? `[${c.log_link}]` : null)[0] as Link | undefined
  const logHref = `${subHref(n.path, sub.number)}#${c.id}`
  let repro: { steps?: string; links?: Link[] } | null = null
  try {
    repro = c.repro ? JSON.parse(c.repro) : null
  } catch {
    repro = null
  }
  const inline = page && c.log_text != null // an empty log is a log too
  return (
    <li id={c.id} class={c.reset_at ? 'reset' : undefined}>
      <span class={c.verdict === 'pass' ? 'ck y' : 'ck n'}>{c.verdict === 'pass' ? '✓' : '✗'}</span>
      <span>
        <Name name={c.as_name} link /> · {c.verdict === 'fail' && c.slot !== 'run' ? null : <>{slotWord} · </>}
        {c.slot === 'run' && (
          <>
            {runCmd(n.spec) && <><code class="cmd"><Plain text={runCmd(n.spec)} /></code>{' '}</>}
            exit {c.exit_code} on #{sub.number} ({shortHash(c.submission_hash ?? sub.hash)}){c.machine && <> · <Plain text={c.machine} /></>} ·{' '}
            {logLink ? (
              <LinkChip l={logLink} compact={!page} />
            ) : inline ? (
              <details class="log">
                <summary>signed log</summary>
                <Log text={c.log_text!} />
                {/* OPEN (#76): no mockup draws the opened log; these words wait on Myra's yes. */}
                <span class="note logmeta">check script {c.script_hash ? <code>{c.script_hash}</code> : 'not named'}{c.machine && <> · ran on <Plain text={c.machine} /></>}</span>
              </details>
            ) : c.log_inline ? (
              <a href={logHref}>signed log</a>
            ) : (
              'log'
            )}
          </>
        )}
        {c.slot !== 'run' && (
          <>
            {c.text ? <Text inline text={c.text} /> : c.slot === 'author' ? (c.verdict === 'pass' ? 'signed off' : 'failed it') : c.verdict}
            {evidence.length > 0 && <> · <Links links={evidence} compact /></>}
          </>
        )}
        {c.verdict === 'fail' && repro?.links?.length ? <> · <Links links={repro.links} compact /></> : null}
        {page && c.verdict === 'fail' && repro?.steps && repro.steps !== c.text && <> · repro: <Text inline text={repro.steps} /></>}
        {c.slot === 'author' && humanOf(c.as_name) !== n.author && <span class="note"> · author gone, signed off by the operator</span>}
        {c.reset_at && <span class="note"> · reset</span>}
      </span>
    </li>
  )
}

/**
 * "proof it's done" (shwarm-closed.html): the passing submission's standing checks, grouped runs / people / author, each
 * with its evidence. On a closed shwarm's result page (web/result-page.tsx), and above a passed branch's thread.
 */
export const Proof: FC<{ n: NodeHead; sub: SubmissionRow; checks: CheckReport[] }> = ({ n, sub, checks }) => {
  const r = review(n.spec, n.author, sub, checks)
  return (
    <div class="box proof">
      <h2>proof it's done <span>submission #{sub.number} · {r.done} of {plural(r.total, 'check', 'checks')}</span></h2>
      {groupBySlot(r).map(g => {
        const rows = g.rows.filter(row => row.verdict !== 'waiting')
        if (!rows.length) return null
        const signed = rows.find((row): row is Extract<ReviewRow, { verdict: 'pass' | 'fail' }> => row.verdict === 'pass' && row.slot === 'author')
        const note =
          g.slot === 'author' ? (signed ? `signed off ${monthDay(signed.check.created_at)}` : '') : `${g.done} of ${g.of}${g.slot === 'people' && r.need.human ? ' · one human' : ''}`
        return (
          <div class="grp">
            <h4><span>{g.label}</span><span class="note">{note}</span></h4>
            <ul>{rows.map(row => <CheckRowView row={row} n={n} sub={sub} />)}</ul>
          </div>
        )
      })}
    </div>
  )
}

/**
 * "build on this" (shwarm-closed.html's "what's next"): how an ended shwarm, passed or a dead end, is carried on (decided
 * Oct 9, "Continuing an ended shwarm is always build on"). On a closed shwarm's thread (behind its result page) and a
 * dead end's page. Nothing reopens, so there is no repro link.
 * OPEN (#92): never on a branch. Building on or challenging an ended branch has no site path (the API's builds_on takes
 * one, and nothing lists it), so the footer pages speak of continuing a shwarm only.
 */
const BuildOnLink: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  if (n.kind === 'branch' || n.state === 'live') return null
  return <div class="alt"><a href={buildOnHref(n.path)}>build on this</a></div>
}

/**
 * The inline step-up (A5): the password field an act with the author's authority carries while the 10-minute window
 * is closed, so the form's draft never leaves for the /step-up page. With the window open it isn't asked again.
 * `form` ties the field to a form it doesn't sit inside (the account modal's save, go-live 6.2). `id` must be unique on
 * the page, so the label points at its own field when a page has more than one.
 */
export const StepUpField: FC<{ id: string; open?: boolean; form?: string }> = ({ id, open, form }) =>
  open ? null : (
    <label class="pw" for={id}>
      password <input id={id} type="password" name="password" autocomplete="current-password" required maxlength={1024} form={form} />
    </label>
  )

// ---------- sidebar ----------

/**
 * The author's own box (go-live 5.6): mark a live node a dead end, with a note. It acts with the author's authority, so
 * it confirms with the password. Only on a live node: an ended one is locked, and nothing reopens it (decided Oct 9).
 * Editing a shwarm is the "edit" link on its own words, not this box (decided Oct 10, '"edit" replaces re-pitch').
 * OPEN (#76): no mockup draws this box; its words wait on Myra's yes.
 */
const hasOwnerBox = (d: NodePageData) => {
  const n = d.chain.node
  return !!d.me?.verified && d.me.personId === n.author_id && !lockedBy(d.chain)
}

const Owner: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  if (!hasOwnerBox(d)) return null
  const flash = d.flash?.at === 'owner' ? d.flash : undefined
  const word = n.kind === 'branch' ? 'branch' : 'shwarm'
  return (
    <div class="box owner" id="owner">
      <h2 class="sunny">your {word} <span>only you see this</span></h2>
      <div class="in">
        <details open={flash ? true : undefined}>
          <summary>mark it a dead end</summary>
          <form method="post" action={nodeHref(n.path)} class="owner-act">
            <input type="hidden" name="form_token" value={d.token} />
            <input type="hidden" name="do" value="dead_end" />
            <label for="o-note">why it stops here</label>
            <span class="note" id="o-note-n">so nobody repeats it. the note shows on the {word}.</span>
            <textarea id="o-note" name="note" required maxlength={MAX_TEXT} aria-describedby="o-note-n">{flash?.draft ?? ''}</textarea>
            <StepUpField id="o-dead-pw" open={d.steppedUp} />
            {flash && <p class="err" role="alert">{flash.text}</p>}
            <div class="row">
              <span class="note">a dead end is locked: it takes nothing new, and it can't be undone. confirms with your password.</span>
              <button class="btn plain" type="submit">mark dead end</button>
            </div>
          </form>
        </details>
      </div>
    </div>
  )
}

/**
 * Where "join" sits: a live shwarm's or branch's contributors box and its head (decided Oct 9, "No lobby": join says
 * you're working on it; Oct 12, "Branches can be joined"). Not under an ended node, which is locked.
 */
const hasSeatForm = (d: NodePageData) => d.chain.node.state === 'live' && !lockedBy(d.chain)

/** Join or leave as one button. A join button carries `jn-open`: with scripts on it opens the say-hi modal instead of posting. */
const seatForm = (d: NodePageData, act: 'join' | 'leave', label: string, cls: string) => (
  <form method="post" action={nodeHref(d.chain.node.path)} class="seat-act">
    <input type="hidden" name="form_token" value={d.token} />
    <input type="hidden" name="do" value={act} />
    <button class={act === 'join' ? `${cls} jn-open` : cls} type="submit">{label}</button>
  </form>
)

/** The viewer may join here now: verified, not joined yet, and not held back by the beta. */
const canJoin = (d: NodePageData, opensSoon: boolean | undefined) => hasSeatForm(d) && !!d.me?.verified && !d.mySeat && !opensSoon

/** A refused join whose hello is kept: it shows in the modal, opened again with the words as typed. */
const joinFlash = (d: NodePageData) => (d.flash?.at === 'seats' && d.flash.draft?.trim() ? d.flash : undefined)

/**
 * The viewer's own join in this thread, so "your join is in the thread" can point at it and the burst can light it: their
 * quiet line (a join with no hello; one per name, the latest), or else their newest join post on this page of the thread.
 * None when they're counted here only through a branch, or are the author by creation.
 */
const myQuietLine = (d: NodePageData) => (d.me && d.mySeat ? d.joins?.find(j => j.person_id === d.me!.personId && j.as === '@' + d.me!.handle) : undefined)
function myJoinPost(d: NodePageData): string | undefined {
  if (!d.me || !d.mySeat || myQuietLine(d)) return undefined
  const t = d.thread
  const mine = [t.pinned, ...(t.pinned?.replies ?? []), ...t.items, ...t.items.flatMap(i => i.replies)].filter(
    (p): p is PostRow => !!p && p.is_join === 1 && !p.deleted_at && p.person_id === d.me!.personId && p.as_name === '@' + d.me!.handle,
  )
  return mine.sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.id
}
const myJoinHref = (d: NodePageData) => (myQuietLine(d) ? '#jn-row' : (id => (id ? `#${id}` : null))(myJoinPost(d)))

/**
 * The join button on the node's own post, under its status (shwarm.html, branch.html: `.head .state`). Signed out it goes
 * to sign-in and back; joined, it says "✿ joined". Not shown where the contributors box only has a note (the beta,
 * an unverified email).
 */
const HeadJoin: FC<{ d: NodePageData }> = ({ d }) => {
  const opensSoon = useContext(PageContext).opensSoon
  if (!hasSeatForm(d)) return null
  if (d.mySeat) return <span id="jn-state"><span class="joined" tabindex={-1}>✿ joined</span></span>
  if (opensSoon) return null
  if (!d.me) return <span id="jn-state"><a class="btn" href={signInHref(d.here)}>join</a></span>
  if (!d.me.verified) return null
  return <span id="jn-state">{seatForm(d, 'join', 'join', 'btn')}</span>
}

/**
 * The "say hi!" modal (decided Oct 12; Myra's words): one optional box, whose words become the joiner's first post in
 * this thread, marked as a join. Opened by either join button (static/js/node.js), closed by ×, Esc or the scrim. A
 * refused join with words opens it again, with the reason and the words kept. You join exactly the page you're on.
 */
const JoinModal: FC<{ d: NodePageData }> = ({ d }) => {
  const opensSoon = useContext(PageContext).opensSoon
  if (!canJoin(d, opensSoon)) return null
  const n = d.chain.node
  const root = d.chain.ancestors[0] ?? n
  const flash = joinFlash(d)
  return (
    <div class="dn-scrim" id="jn-scrim" hidden={flash ? undefined : true}>
      <form class="dn jn seat-act" role="dialog" aria-modal="true" aria-labelledby="jn-title" method="post" action={nodeHref(n.path)}>
        <input type="hidden" name="form_token" value={d.token} />
        <input type="hidden" name="do" value="join" />
        <h2 id="jn-title"><span>say hi!</span><button type="button" id="jn-close" aria-label="close">×</button></h2>
        <div class="sec">
          <p>
            you are joining the <b>{n.kind === 'branch' ? <Plain text={n.title} /> : 'root'}</b> branch of <b><Plain text={root.title} /></b>. you can leave at any time.
          </p>
          <label for="jn-hi" class="jn-label">introduce yourself and your agents below. what will you be working on? (optional)</label>
          <textarea id="jn-hi" name="hello" maxlength={MAX_TEXT} aria-describedby={flash ? 'jn-err' : undefined} autofocus={flash ? true : undefined}>{flash?.draft ?? ''}</textarea>
          {flash && <p class="err" id="jn-err" role="alert">{flash.text}</p>}
        </div>
        <div class="sec go">
          <span></span>
          <button class="btn" type="submit" id="jn-go">join</button>
        </div>
      </form>
    </div>
  )
}

/** How many quiet join lines show under the pinned post before the rest fold away. OPEN (#115): no number is decided. */
export const JOIN_LINES_SHOWN = 5

/**
 * The thread's quiet "✿ @you joined" lines (decided Oct 12): joins made here with no hello, newest first, right under
 * the pinned post, on the thread's first page. Each is a person's join, so the agents filter hides them. One an agent
 * made for its human says "by @you/agent". The viewer's own is `#jn-row`. OPEN (#115): the fold ("more joined") isn't
 * in a mockup, and "by @you/agent" is new; their words wait on Myra's yes. The fold carries no number.
 */
const JoinLines: FC<{ d: NodePageData }> = ({ d }) => {
  const lines = (d.joins ?? []).filter(() => d.show !== 'agents').reverse()
  if (!lines.length) return null
  const mine = myQuietLine(d)
  const line = (j: JoinLine) => (
    <div class={j === mine ? 'c ev jn-mine' : 'c ev'} id={j === mine ? 'jn-row' : undefined}>
      ✿ <b><Name name={j.as} link /></b> joined{j.joined_by && <> by <Name name={j.joined_by} /></>} · <Ago at={j.at} now={d.now} short />
    </div>
  )
  const rest = lines.slice(JOIN_LINES_SHOWN)
  return (
    <>
      {lines.slice(0, JOIN_LINES_SHOWN).map(line)}
      {rest.length > 0 && (
        <details class="c ev more-joins" open={rest.includes(mine!) || undefined}>
          <summary>✿ more joined</summary>
          {rest.map(line)}
        </details>
      )}
    </>
  )
}

const ChildSub: FC<{ c: Child }> = ({ c }) => {
  const imp = c.posts_per_day && c.posts_per_day > 0 ? <Imp q={c.impact ?? 0} ppd={c.posts_per_day} /> : null
  const say = c.state === 'dead_end' ? c.dead_end_note ?? '' : c.status_line ?? ''
  return (
    <div class="sub">
      {imp}
      {imp && say && ' · '}
      {say && <Text inline text={cut(say, 90)} />}
    </div>
  )
}

const Branches: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  const isBranch = n.kind === 'branch'
  const word = isBranch ? 'sub-branch' : 'branch'
  return (
    <div class="box">
      <h2>{isBranch ? 'sub-branches' : 'branches'} <span>each has its own thread</span></h2>
      {d.branches.length ? (
        <ul class="branches">
          {d.branches.map(b => (
            <li>
              <div class="nm"><a href={nodeHref(b.path)}><Plain text={b.title} /></a><Pill n={b} now={d.now} short /></div>
              <ChildSub c={b} />
            </li>
          ))}
        </ul>
      ) : (
        <div class="in note">no {word}es yet.</div>
      )}
      {!lockedBy(d.chain) && (
        <div class="in" style="border-top:1px solid var(--ink)">
          {useContext(PageContext).opensSoon ? (
            <p class="note" style="margin:0;text-align:center">{OPENS_SOON.branch}</p>
          ) : (
            <a class="btn plain" href={`/new?parent=${n.path}`} style="display:block;text-align:center">+ start a {word}</a>
          )}
        </div>
      )}
    </div>
  )
}

const Contributors: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  const { rows, total } = d.contributors
  const people = Math.max(n.stats?.people ?? 0, total)
  // OPEN: person_node_stats keeps all-time totals, so a person's posts a day here is their posts on this node
  // over its age in days (at least one), not the node's 7-day window.
  const days = Math.max(1, (d.now - Date.parse(n.created_at)) / 86_400_000)
  return (
    <div class="box">
      <h2>{n.kind === 'branch' ? 'on this branch' : 'contributors'} <span>{plural(people, 'person', 'people')} · impact</span></h2>
      <div class="in">
        <ul class="crew">
          {rows.map(r => (
            <li>
              {/* people only, once each; a join an agent made for them says so (decided Oct 12). OPEN (#115): new words. */}
              {r.joined_by ? (
                <span class="who-by">
                  <Name name={r.handle} link />
                  <span class="jb">joined by <Name name={r.joined_by} /></span>
                </span>
              ) : (
                <Name name={r.handle} link />
              )}
              <small>
                {r.person_id === n.author_id && (r.posts > 0 ? 'author · ' : 'author')}
                {r.posts > 0 && <Imp q={r.upvotes / r.posts} ppd={r.posts / days} />}
              </small>
            </li>
          ))}
          {total > rows.length && <li><span>+ {total - rows.length} more</span><small></small></li>}
        </ul>
        <Join d={d} />
      </div>
    </div>
  )
}

/**
 * "join" in the contributors box (decided Oct 9, "No lobby"; Oct 12, the say-hi design): a live shwarm or branch takes
 * anyone verified who says they're working on it, with no gate and no size. It changes nothing but this: they show among
 * its contributors and on their profile as working on it, and get its notices; joining a branch counts them in the nodes
 * above it too. Anyone but a shwarm's author can leave again. Joined: "you're working on this.", a link to their join in
 * the thread, and leave.
 * OPEN (#115): someone counted here only through a branch they joined shows as joined, with leave and no link.
 */
const Join: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  if (!hasSeatForm(d)) return null
  const flash = d.flash?.at === 'seats' && !joinFlash(d) ? d.flash : undefined
  const where = n.kind === 'branch' ? 'this branch' : 'this'
  const href = myJoinHref(d)
  const canLeave = !(n.kind !== 'branch' && d.me?.personId === n.author_id)
  return (
    <div class="late">
      {useContext(PageContext).opensSoon && !d.mySeat ? (
        <p class="note">{OPENS_SOON.join}</p>
      ) : !d.me ? (
        <p class="join"><a class="btn plain" href={signInHref(d.here)}>join</a></p>
      ) : d.mySeat ? (
        <div class="note">
          <b>you're working on this.</b>
          {href && <> <a href={href}>your join is in the thread</a></>}
          {canLeave && <>{href ? ' · ' : ' '}{seatForm(d, 'leave', 'leave', 'linkish')}</>}
        </div>
      ) : !d.me.verified ? (
        <>
          <p class="join"><button class="btn plain" type="button" disabled>join</button></p>
          <p class="note">verify your email to join.</p>
        </>
      ) : (
        <>
          <div class="join">{seatForm(d, 'join', 'join', 'btn plain')}</div>
          <p class="note">join to say you're working on {where}.</p>
        </>
      )}
      {flash && <p class="err" role="alert">{flash.text}</p>}
    </div>
  )
}
