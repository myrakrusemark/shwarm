// The shwarm and branch pages, /w/<path> (go-live 3.3, 3.4), ported from mockups/shwarm.html and mockups/branch.html.
// Every piece of participant text goes through render/text.tsx.
// One model for every node (decided Oct 14): a shwarm and a branch each have a status, set by an on-track vote and the
// claims people back (core/status.ts): its badge in the head, in the people card and in its parent's list; in the people
// card, joined, the on-track vote and the three claim forms; in the thread, each claim's tag and its "back", and a passed
// claim's work (its links). Nothing locks: a node that passed keeps its thread, branches and join, with its pass box above the
// thread (the dated pass records, their work and the status history), where a shwarm's author can approve it
// too. Every shwarm offers "build on this shwarm". Old submissions and their checks still show in the thread, as history.
// Join (go-live 8.2, decided Oct 12): a shwarm or branch has a join button on its own post (the head) and one in the
// people card; both open one "say hi!" modal (JoinModal), whose optional words become the joiner's first post, marked
// "✿ joined". With no words the thread shows a quiet "✿ @you joined" line. With scripts off, either button posts a plain
// join. The burst (static/js/node.js) plays on the page the join lands on, where the modal was.
import { useContext, type Child as JsxChild, type FC } from 'hono/jsx'
import { shortHash } from '@shwarm/protocol'
import { isRadRepo, type Link, type WebLink } from '@shwarm/protocol'
import { joinHref, signInHref } from '../auth/return-to'
import type { CheckSpec } from '../core/checks'
import type { BuiltOnBy, BuiltOnLink, Chain, CheckReport, Child, Contributor, JoinLine, NodeEdit, NodeHead, PostEdit, PostRow, Show, Sort, SubmissionRow, Thread } from '../read/node'
import { EDITS_SHOWN, postsOnPage, QUIET_HOURS, SHOWS, SORTS } from '../read/node'
import { CLAIMS, hoursUntil, isClaim, MARGIN, STATUSES, type Claim, type NodeStatus, type Status } from '../core/status'
import { PASS_BOX, type ClaimRow, type PassRecord, type StatusData } from '../read/status'
import { FORMER } from '../read/names'
import { postsPerDay } from '../read/people'
import { ACTIVITY_DAYS, type ActivityDay } from '../read/activity'
import { recordedStatus, review, type ReviewRow } from '../read/review'
import { ago, cut, exact, licenseName, monthDay, perDay, q1, shortNum, triageNote } from '../render/format'
import { showHidden } from '../render/hidden'
import { MAX_TEXT } from '../core/text'
import { Command, LINK_REL, linkParts, Log, Name, Plain, Text } from '../render/text'
import { REASON_LABEL, REASONS, REPORT_TEXT_MAX } from '../core/reports'
import { FLAG_LABEL, FLAG_REASONS, PAUSE_AT } from '../core/flags'
import { workLicense } from '../core/nodes'
import { TagLink } from './tags'
import { ApprovedMark } from './approved'
import { AgentResources, Layout } from './layout'
import { InvitedSignIn, OPENS_SOON } from './opens-soon'
import { PageContext } from './viewer'
import { count, fill, fillx, w } from '../words'


/** The author's own-eyes note (render/format.ts triageNote), with "the rules" as a link when it's blocked. */
export const TriageNote = (p: { triage: string }) =>
  p.triage === 'blocked' ? (
    <p class="held">
      {fillx(w.node.blocked, { rules: <a href="/rules">{w.node.rulesLink}</a> })}
    </p>
  ) : (
    <p class="held">{triageNote(p)}</p>
  )

export type Me = { personId: number; handle: string; verified: boolean } | null

/**
 * A refused form, shown next to it: the compose box, join or leave (`seats`), the author's "approve it" (`owner`,
 * the claim they picked in `fields.post`), one post's upvote, back, edit, delete or report (`post` names it), or the
 * people card's on-track vote or claim form (`status`; a claim's status and the work it links in `fields`, which opens its
 * form again). `draft` keeps the text they wrote; a refused edit opens its form again, and so does a refused report
 * (`report`, with its reason in `fields`). `flag`: "flag this shwarm" in the head, with its reason in `fields`.
 */
export type Flash = { at: 'compose' | 'seats' | 'owner' | 'post' | 'flag' | 'status'; text: string; draft?: string; fields?: Record<string, string>; post?: string; pin?: boolean; report?: boolean }

export type NodePageData = {
  chain: Chain
  branches: Child[]
  contributors: { rows: Contributor[]; total: number }
  subs: SubmissionRow[] // the node's submissions from before Oct 14, shown in the thread as history
  checks: Map<string, CheckReport[]> // and their checks
  thread: Thread
  myUps?: Map<string, boolean> // the viewer's upvotes on the posts shown: post id → counted (A6)
  myReports?: Set<string> // the posts shown that the viewer reported (core/reports.ts)
  myFlag?: boolean // the viewer flagged this node (core/flags.ts)
  mySeat?: number | null // the viewer's join on a shwarm or branch (a seat row's number), if they're working on it
  joins?: JoinLine[] // the thread's quiet "✿ @you joined" lines: joins made here with no hello, oldest first (read/node.ts readJoins)
  nodeEdits?: NodeEdit[] // the shwarm's earlier versions, newest first (its author's edits until Oct 12; re-pitches before Oct 10)
  activity: ActivityDay[] // public posts per UTC day here and under here, oldest first, today last (read/activity.ts)
  status: StatusData // its status, claims, pass records and history, and the viewer's own backing (decided Oct 14)
  sort: Sort
  show: Show
  url: string // this node's absolute URL, for the people card
  here: string // this page's path and query, for return-to links
  me: Me
  now: number
  token?: string // the form token, signed in
  limit?: { left: number; wait: number } // thread posts left right now (core/limits.ts peekThreadTokens)
  steppedUp?: boolean // the password was entered in the last 10 minutes (auth/stepup.ts stepUpOpen), so the author's acts don't ask again
  flash?: Flash
}

export const nodeHref = (path: string) => `/w/${path}`
export const subHref = (path: string, n: number) => `/w/${path}/s/${n}` // an old submission's page (go-live 5.2)
/** A shwarm's "build on this": the create form with builds-on filled in (go-live 4.3; decided Oct 14, any shwarm). */
export const buildOnHref = (path: string) => `/new?builds_on=${encodeURIComponent(path)}`
/** A shwarm's or branch's link preview (go-live 11.7, web/layout.tsx `card`): its title, and its pitch as the description. */
export const previewCard = (n: { title: string; what: string }) => ({ title: showHidden(n.title), description: cut(showHidden(n.what), 200) })
export const Ago: FC<{ at: string | null; now: number; short?: boolean }> = ({ at, now, short }) => <span title={exact(at)}>{ago(at, now, short)}</span>
const Imp: FC<{ q: number; ppd: number }> = ({ q, ppd }) => (
  <span class="imp" style={`--q:${q1(q)}`} title={fill(w.node.impTitle, { q: q1(q), ppd: perDay(ppd) })}>{fill(w.node.impPerDay, { ppd: perDay(ppd) })}</span>
)
export const humanOf = (name: string) => name.split('/')[0]
/** "shwarm" or "branch", for the {kind} in the words. */
const kindWord = (n: { kind: string }) => (n.kind === 'branch' ? w.node.kindBranch : w.node.kindShwarm)
/** Whether a post is on this page of the thread (the pinned posts, the posts and their replies). */
const onPage = (t: Thread, id: string | undefined) => !!id && postsOnPage(t).some(p => p.id === id)

export const NodePage: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  const opensSoon = useContext(PageContext).opensSoon
  return (
    <Layout title={fill(w.node.pageTitle, { title: showHidden(n.title) })} description={cut(showHidden(n.what), 200)} canonical={nodeHref(n.path)} card={previewCard(n)}>
      <link rel="stylesheet" href="/css/node.css" />
      {n.kind === 'branch' ? <Crumbs chain={d.chain} /> : <a class="back" href="/">{w.node.backToHot}</a>}
      {n.visibility === 'author' && <TriageNote triage={n.triage} />}
      {n.paused === 1 && <PausedNote kind={n.kind} />}
      <Head d={d} />
      <div class="grid">
        <main id="main" tabindex={-1}>
          {/* a refusal whose form isn't on the page (a forged or stale one) shows at the top */}
          {((d.flash?.at === 'seats' && !!joinFlash(d) && !canJoin(d, opensSoon)) || (d.flash?.at === 'owner' && !canMark(d)) || (d.flash?.at === 'post' && !onPage(d.thread, d.flash.post)) || (d.flash?.at === 'flag' && !hasFlagSpot(d)) || (d.flash?.at === 'status' && !hasStatusForm(d, opensSoon))) && (
            <p class="err flash" role="alert">{d.flash.text}</p>
          )}
          <PassBox d={d} />
          <Compose d={d} />
          <ThreadView d={d} />
        </main>
        <aside>
          <Owner d={d} />
          <PeopleCard d={d} />
          <Branches d={d} />
          <AgentResources />
        </aside>
      </div>
      <JoinModal d={d} />
      <PeopleModal d={d} />
      <script src="/js/node.js" defer></script>
    </Layout>
  )
}

// ---------- head ----------

const Crumbs: FC<{ chain: Chain }> = ({ chain }) => (
  <nav class="crumbs" aria-label={w.node.breadcrumb}>
    {chain.ancestors.map(a => (
      <>
        <a href={nodeHref(a.path)}><Plain text={a.title} /></a>
        <span>/</span>
      </>
    ))}
    <Plain text={chain.node.title} />
  </nav>
)

const Head: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  const parent = d.chain.ancestors[d.chain.ancestors.length - 1]
  const isBranch = n.kind === 'branch'
  const s = n.stats
  return (
    <section class={isBranch ? 'head' : 'head shwarm'}>
      <div class="heat" title={w.node.heatTitle}>
        {shortNum(s?.upvotes ?? 0)}
        <small>{w.node.upvoteHow}</small>
        <span class="qbar" style={`--q:${q1(s?.impact ?? 0)}`} title={fill(w.node.perPost, { q: q1(s?.impact ?? 0) })}></span>
      </div>
      <div>
        {isBranch && <div class="kicker">{fillx(w.node.branchOf, { parent: <a href={nodeHref(parent.path)}><Plain text={parent.title} /></a> })}</div>}
        <h1 class="title">
          <Text inline text={n.title} />
          {s?.hot === 1 && <span class="hotb">{w.node.hot}</span>}
        </h1>
        {!isBranch && n.tags.length > 0 && (
          <div class="tags">{n.tags.map(t => <TagLink tag={t} />)}</div>
        )}
        {!isBranch && <Builds n={n} />}
        <WorkLicense d={d} />
        <div class="meta">
          {fillx(isBranch ? w.node.openedBy : w.node.startedBy, { name: <Name name={n.posted_by} link />, ago: <Ago at={n.created_at} now={d.now} /> })}
          {isBranch && s && <> · {count(w.node.people, s.people)}</>}
          {s && s.posts_per_day > 0 && <> · {fill(w.node.postsPerDay, { n: perDay(s.posts_per_day) })}</>}
          {n.changed_at && <> · {fillx(w.node.lastActivity, { ago: <Ago at={n.changed_at} now={d.now} /> })}</>}
          <FlagNode d={d} />
        </div>
        <div class="pitch">
          <div class="what">
            <h3>{w.node.what}</h3>
            <Text text={n.what} />
            {(d.nodeEdits?.length ?? 0) > 0 && <EditHistory n={n} edits={d.nodeEdits!} now={d.now} />}
          </div>
          <div class="done">
            <h3>{w.node.doneWhen}</h3>
            <Text text={n.done_when} />
            {hasStatusLine(d) && <div class="stat"><StatusLine d={d} /></div>}
            {!isBranch && <div class="alt"><a href={buildOnHref(n.path)}>{w.node.buildOnThis}</a></div>}
          </div>
        </div>
      </div>
      <div class="state">
        {/* The status badge, in place of "live", which only said it hadn't ended (Myra, Oct 13: "What is live? If it
            exists it's live yeah?"): nothing ends now (decided Oct 14). */}
        <div class="badges">
          <StatusBadge s={d.status.now} mine={d.status.myBacking?.status} now={d.now} id="vb-head" />
          {d.status.authorApproved && <ApprovedMark a={d.status.authorApproved} href="" />}
        </div>
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
 * the same way. Nobody edits a shwarm now (decided Oct 12: once posted, its words are fixed), so only shwarms edited
 * before that have versions to show. OPEN (#79): no mockup draws it; "edited" and the rows wait on Myra's yes.
 */
const EditHistory: FC<{ n: NodeHead; edits: NodeEdit[]; now: number }> = ({ n, edits, now }) => {
  const shown = edits.slice(0, EDITS_SHOWN)
  return (
    <details class="hist">
      <summary>{w.node.edited}</summary>
      <ol>
        {shown.map(e => (
          <li>
            <span class="note">{fillx(e.written_at ? w.node.editedAgo : w.node.startedAgo, { ago: <Ago at={e.written_at ?? n.created_at} now={now} /> })}</span>
            <b><Plain text={e.title} /></b>
            <Text text={e.what} />
            {e.tags && <div class="note">{fill(w.node.editTags, { tags: e.tags.map(t => `#${t}`).join(' ') })}</div>}
            {e.done_when !== undefined && <><h3>{w.node.doneWhen}</h3><Text text={e.done_when} /></>}
            {e.spec && <><h3>{w.node.checkedBy}</h3><CheckedBy spec={e.spec} author={n.author} /></>}
            {e.builds_on !== undefined && <div class="note">{fillx(w.node.editBuildsOn, { what: e.builds_on ? ('node' in e.builds_on ? `/w/${e.builds_on.node}` : <Plain text={e.builds_on.name} />) : w.node.editBuildsOnNothing })}</div>}
            {e.license !== undefined && <div class="note">{fill(w.node.editLicense, { license: licenseName(e.license) })}</div>}
          </li>
        ))}
        {edits.length > EDITS_SHOWN && <li><span class="note">{w.node.olderVersions}</span></li>}
      </ol>
    </details>
  )
}

/**
 * The note about the work's license (decided Oct 15, "Everything here is MIT"): only on a node set to another license
 * before then, or a launch shwarm carrying its upstream's, "the work: GPL-3.0, as its author planned it". A branch
 * shows its shwarm's. An MIT node shows nothing, since the footer and the rules say everything here is MIT.
 */
const WorkLicense: FC<{ d: NodePageData }> = ({ d }) => {
  const l = workLicense((d.chain.ancestors[0] ?? d.chain.node).license)
  return l ? <div class="builds worklic">{fillx(w.node.workLicense, { license: <b>{licenseName(l)}</b> })}</div> : null
}

/** What a shwarm builds on, when it builds on anything: a shwarm here (as of its latest pass) or an outside project. */
const Builds: FC<{ n: NodeHead }> = ({ n }) => {
  const bo = n.builds_on
  if (!bo) return null
  // A shwarm here, as of the pass it built on, when it had one (decided Oct 14): "builds on minecraft in doom, as passed oct 14".
  if ('node' in bo)
    return (
      <div class="builds">
        {fillx(bo.as_of ? w.node.buildsOnNodeAsOf : w.node.buildsOnNode, {
          node: <a class="up" href={nodeHref(bo.node)}><b><Plain text={bo.title ?? bo.node} /></b>/w/{bo.node}</a>,
          date: bo.as_of && <a href={`${nodeHref(bo.node)}#${PASS_BOX}`} title={exact(bo.as_of.at)}>{monthDay(bo.as_of.at)}</a>,
        })}
      </div>
    )
  const p = bo.url ? linkParts(bo.url) : null
  const shown = p ? p.text.replace(/^https?:\/\//, '') : null
  return (
    <div class="builds">
      {fillx(w.node.buildsOnSource, {
        source: p ? (
          <a class="up" href={p.href} rel={LINK_REL}><b><Plain text={bo.name} /></b>{shown && <Plain text={shown} />}</a>
        ) : (
          <span class="up"><b><Plain text={bo.name} /></b></span>
        ),
      })}
    </div>
  )
}

/** The checks a shwarm had before Oct 14 (nothing takes checks now): on its old submissions' pages and in its earlier versions. */
export const CheckedBy: FC<{ spec: CheckSpec; author: string }> = ({ spec, author }) => (
  <ul>
    {spec.runs && (
      <li>
        <Command cmd={spec.runs.command} /> · {count(w.node.runsBy, spec.runs.count)}
        {spec.runs.description && <> · <Text inline text={spec.runs.description} /></>}
      </li>
    )}
    {spec.people && (
      <li>
        {count(w.node.people, spec.people.count)}
        {spec.people.human && (spec.people.count === 1 ? w.node.oneHuman : w.node.someHuman)}
        {spec.people.instructions && <> · <Text inline text={spec.people.instructions} /></>}
      </li>
    )}
    {spec.author && <li><Name name={author} link /> · {w.node.author}</li>}
  </ul>
)

/** The status line under the done test (read/review.ts recordedStatus): why the node isn't on track, else its branches by status. */
const hasStatusLine = (d: NodePageData) => !!recordedStatus(d.chain.node, d.status, d.branches)

const StatusLine: FC<{ d: NodePageData }> = ({ d }) => <>{recordedStatus(d.chain.node, d.status, d.branches).replace(/\.$/, '')}</>

// ---------- thread ----------

/** "5 quick replies left, then 1 every 5 min", or the wait when they're used up (the bucket in core/limits.ts). */
export function limitLine(l: NodePageData['limit']): string {
  if (!l) return ''
  if (l.left < 1) return fill(w.node.nextPostIn, { wait: l.wait >= 60 ? fill(w.node.waitMinutes, { n: Math.ceil(l.wait / 60) }) : fill(w.node.waitSeconds, { n: l.wait }) })
  return count(w.node.quickReplies, l.left)
}

const Compose: FC<{ d: NodePageData }> = ({ d }) => {
  // A paused node takes no writes (core/context.ts loadNode) until the operator looks (core/flags.ts).
  if (d.chain.node.paused === 1)
    return (
      <div class="compose locked">
        {/* OPEN (#106): new wording. */}
        <div class="to">{w.node.paused}</div>
        <p>{w.node.pausedText}</p>
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
        <div class="to">{w.node.needsAccount}</div>
        <p>{fillx(w.node.signInToPost, { signIn: <a href={signInHref(d.here)}>{w.node.signIn}</a>, join: <a href={joinHref(d.here)}>{w.node.joinLink}</a> })}</p>
      </div>
    )
  const flash = d.flash?.at === 'compose' ? d.flash : undefined
  if (!d.me.verified)
    return (
      <div class="compose">
        <div class="to">{fillx(w.node.postingAs, { name: <b><Name name={'@' + d.me.handle} link /></b> })}</div>
        <textarea disabled aria-label={w.node.yourPost} placeholder={w.node.composePlaceholder}></textarea>
        <div class="row">
          <span class="note">{w.node.verifyToPost}</span>
          <button class="btn plain" type="button" disabled>{w.node.post}</button>
        </div>
      </div>
    )
  return (
    <form class="compose" method="post" action={nodeHref(d.chain.node.path)}>
      <input type="hidden" name="form_token" value={d.token} />
      <div class="to">{fillx(w.node.postingAs, { name: <b><Name name={'@' + d.me.handle} link /></b> })}</div>
      <textarea name="text" required maxlength={MAX_TEXT} aria-label={w.node.yourPost} aria-describedby={flash ? 'compose-err' : undefined} placeholder={w.node.composePlaceholder}>{flash?.draft ?? ''}</textarea>
      {flash && <p class="err" id="compose-err" role="alert">{flash.text}</p>}
      {d.me.personId === d.chain.node.author_id && <PinMode checked={flash?.pin} />}
      <div class="row">
        <span class="note">{limitLine(d.limit)}</span>
        <button class="btn plain" type="submit" name="do" value="post">{w.node.post}</button>
      </div>
    </form>
  )
}

/**
 * The banner on a paused node (go-live 9.3, core/flags.ts), for everyone: three people with established accounts flagged
 * it, so it takes no writes until the operator unpauses it. Nobody is named.
 * Also on old submissions' pages (web/submission-page.tsx).
 * OPEN (#106): new wording. No mockup draws it.
 */
export const PausedNote: FC<{ kind: string }> = ({ kind }) => (
  <p class="held paused" role="status">
    {fillx(w.node.pausedNote, { kind: kindWord({ kind }), rules: <a href="/rules">{w.node.rulesLink}</a> })}
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
  const word = kindWord(n)
  if (!d.me) return <> · <a class="flag-it" href={signInHref(d.here)}>{fill(w.node.flagThis, { kind: word })}</a></>
  if (!hasFlagSpot(d)) return null
  const flash = d.flash?.at === 'flag' ? d.flash : undefined
  if (d.myFlag) return <> · <span class="note flag-it" role={flash ? 'status' : undefined}>{flash ? flash.text : fill(w.node.youFlagged, { kind: word })}</span></>
  const reason = flash?.fields?.reason
  return (
    <>
      {' · '}
      <details class="flag" open={flash ? true : undefined}>
        <summary>{fill(w.node.flagThis, { kind: word })}</summary>
        <form method="post" action={d.here} class="flag-act">
          <input type="hidden" name="form_token" value={d.token} />
          <input type="hidden" name="do" value="flag" />
          <fieldset>
            <legend>{fill(w.node.flagWhatsWrong, { kind: word })}</legend>
            {FLAG_REASONS.map(r => (
              <label><input type="radio" name="reason" value={r} required checked={reason === r || undefined} /> {FLAG_LABEL[r]}</label>
            ))}
          </fieldset>
          {flash && <p class="err" role="alert">{flash.text}</p>}
          <div class="row">
            <span class="note">{fill(w.node.flagNote, { n: PAUSE_AT, kind: word })}</span>
            <button class="btn plain" type="submit">{w.node.flagIt}</button>
          </div>
        </form>
      </details>
    </>
  )
}

/**
 * The author's pin box (go-live 4.6): a post sent with this box ticked is pinned at the top of the thread, above the
 * posts pinned before it (decided Oct 14, "A thread can pin several posts"), and its first line is the feed card's status
 * line (table B #40) until another is pinned. The author keeps it current with "edit" on the pinned post.
 * No mockup draws this box. Its words are Myra's (Oct 10): "pin this message at the top of the thread", no note.
 */
const PinMode: FC<{ checked?: boolean }> = ({ checked }) => (
  <label class="pin-it">
    <input type="checkbox" name="pin" value="1" checked={checked || undefined} />{w.node.pinIt}
  </label>
)

const showLabel = (s: Show) => ({ all: w.node.showAll, humans: w.node.showHumans, agents: w.node.showAgents })[s]
const sortLabel = (s: Sort) => ({ active: w.node.sortActive, new: w.node.sortNew, top: w.node.sortTop })[s]

function query(d: NodePageData, o: { sort?: Sort; show?: Show; page?: number }): string {
  const sort = o.sort ?? d.sort
  const show = o.show ?? d.show
  const q = new URLSearchParams()
  if (sort !== 'active') q.set('sort', sort)
  if (show !== 'all') q.set('show', show)
  if (o.page && o.page > 1) q.set('page', String(o.page))
  const s = q.toString()
  return s ? `?${s}` : nodeHref(d.chain.node.path)
}

const posts = (n: number) => count(w.node.posts, n, { n: n.toLocaleString('en-US') })

/**
 * The activity strip's words, its text alternative: "84 posts in the last 14 days, most on oct 6" (the latest of the
 * busiest days), or "…, on oct 6" when all of them fell on one day. Null when there were none.
 */
export function activityWords(days: ActivityDay[]): string | null {
  const total = days.reduce((t, d) => t + d.posts, 0)
  if (!total) return null
  const top = days.reduce((m, d) => (d.posts >= m.posts ? d : m))
  const one = days.filter(d => d.posts > 0).length === 1
  return fill(one ? w.node.activityOneDay : w.node.activityMostOn, { posts: posts(total), days: ACTIVITY_DAYS, day: monthDay(top.day) })
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
          <span style={`height:${d.posts ? Math.max(8, Math.round((100 * d.posts) / max)) : 0}%`} title={fill(w.node.activityBar, { day: monthDay(d.day), posts: posts(d.posts) })}></span>
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
        {w.node.sort}{' '}
        {SORTS.map((s, i) => (
          <>
            {i > 0 && ' · '}
            {s === d.sort ? <b>{sortLabel(s)}</b> : <a href={query(d, { sort: s })}>{sortLabel(s)}</a>}
          </>
        ))}{' '}
        · &nbsp;{w.node.show}{' '}
        <details>
          <summary>{showLabel(d.show)} ▾</summary>
          <span class="opts">{SHOWS.map(s => (s === d.show ? <b>{showLabel(s)}</b> : <a href={query(d, { show: s })}>{showLabel(s)}</a>))}</span>
        </details>
      </div>
      {t.pinned.map(item => (
        <>
          {post(item, { pinned: true })}
          {item.replies.map(r => post(r, { reply: true }))}
        </>
      ))}
      {t.page === 1 && <JoinLines d={d} />}
      {t.items.map(item => (
        <>
          {post(item)}
          {item.replies.map(r => post(r, { reply: true }))}
        </>
      ))}
      {!t.pinned.length && !t.items.length && <div class="empty">{t.page > 1 ? w.node.noOlderPosts : d.show === 'all' ? w.node.noPostsYet : fill(w.node.noPostsFrom, { who: showLabel(d.show) })}</div>}
      {(t.more || t.page > 1) && (
        <div class="more">
          {t.page > 1 && <a href={query(d, { page: t.page - 1 })}>{w.node.newer}</a>}
          {t.page > 1 && t.more && ' · '}
          {t.more && <a href={query(d, { page: t.page + 1 })}>{w.node.olderPosts}</a>}
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
 * A pin that carries its own hash (decided Oct 14: an ipfs:// address, a magnet: link, a rad: repo at a commit) shows as
 * code to copy, never as a link: the site fetches nothing and names no gateway.
 */
export const LinkChip: FC<{ l: Link; compact?: boolean }> = ({ l, compact }) => {
  if ('ipfs' in l) return <CodePin label={l.label} text={l.ipfs} />
  if ('magnet' in l) return <CodePin label={l.label} text={l.magnet} />
  if ('repo' in l && isRadRepo(l.repo)) return <CodePin label={l.label} text={l.repo} at={<>{fill(w.node.linkCommit, { hash: l.commit.slice(0, 7) })}{l.path && <>, <Plain text={l.path} /></>}</>} />
  const { p, label, host } = linkView(l)
  const print = 'sha256' in l ? fill(w.node.linkSha, { hash: l.sha256.slice(0, 4) }) : fill(w.node.linkCommit, { hash: l.commit.slice(0, 7) })
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

/** A pin that carries its own hash, as code to copy: its label, if it has one, then the address, then where in it (`at`). */
const CodePin: FC<{ label?: string; text: string; at?: JsxChild }> = ({ label, text, at }) => (
  <>
    {label && <><Plain text={label} />{' '}</>}
    <code class="pin"><Plain text={text} /></code>
    {at && <>{' '}<span class="note">({at})</span></>}
  </>
)

/**
 * A web link's safe href (null when it isn't http or https), its label (the one given, else the file or repo name) and
 * its host, which always shows beside the label: the label is free text.
 */
export function linkView(l: WebLink): { p: { href: string; text: string } | null; label: string; host: string } {
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
          {byAuthor && ` · ${w.node.author}`} · <Ago at={p.created_at} now={d.now} short />
        </div>
        {/* OPEN (#79): the tombstone's words wait on Myra's yes. */}
        <p class="note">{w.node.deleted}</p>
        {flash && <p class="err" role="alert">{flash.text}</p>}
      </div>
    )
  // A plain post of the viewer's own, under the same name (go-live 4.8; table B #30): edit and delete it. Old
  // submissions, checks and dead-end notes never change, and a claim is only deleted.
  const own = !!d.me?.verified && p.person_id === d.me.personId && p.as_name === '@' + d.me.handle && p.kind === 'post'
  const editFlash = own && flash?.draft !== undefined ? flash : undefined // a refused edit shows in its form
  const reportFlash = flash?.report ? flash : undefined // so does a refused report
  return (
    <div class={cls} id={p.id}>
      <div class="who">
        {p.is_join === 1 && <span class="jt">{w.node.joined}</span>}
        <b><Name name={p.as_name} link /></b>
        {p.claim && <span class={`ct ${p.claim.replace('_', '-')}`}>{claimWords(p.claim).tag}</span>}
        {byAuthor && ` · ${w.node.author}`}
        {isSub && <span class={sub.status === 'in_review' || sub.status === 'passed' ? 'sb' : 'sb x'}>{fill(w.node.submissionNumber, { n: sub.number })}</span>}
        {pinned ? <> · {fillx(w.node.pinnedUpdated, { ago: <Ago at={p.edited_at ?? p.created_at} now={d.now} short /> })}</> : <> · <Ago at={p.created_at} now={d.now} short /></>}
      </div>
      {p.text && <Text text={p.text} addressed />}
      {p.claim === 'passed' && <PinnedWork pins={links} />}
      {isSub && <SubmissionParts d={d} sub={sub} links={links} builtOn={d.thread.builtOn.get(p.id) ?? []} />}
      <div class="acts">
        {p.claim ? <Back p={p} d={d} /> : <Upvote p={p} d={d} />}
        {(!isSub || !shownInParts(sub)) && p.claim !== 'passed' && links.length > 0 && <> · {fillx(w.node.linked, { links: <Links links={links} /> })}</>}
        {by.length > 0 && <> · <BuiltOnByView by={by} /></>}
        {/* shwarm.html: "make it a branch" on a post; the create form takes its text (go-live 4.8). */}
        {p.kind === 'post' && <> · <a href={makeBranchHref(n.path, p.id)}>{w.node.makeBranch}</a></>}
        {own && !p.claim && <> · <EditPost p={p} d={d} flash={editFlash} /></>}
        {own && <> · <DeletePost p={p} d={d} /></>}
        {pinnable(d, p, reply) && <> · <PinPost p={p} d={d} pinned={!!pinned} /></>}
        {p.edited_at && <> · <History p={p} edits={d.thread.edits.get(p.id) ?? []} label={pinned ? w.node.editHistory : w.node.edited} now={d.now} /></>}
        <Report p={p} d={d} flash={reportFlash} />
      </div>
      {flash && !editFlash && !reportFlash && <p class="err" role="alert">{flash.text}</p>}
    </div>
  )
}

/**
 * A passed claim's work (decided Oct 14; called "the work", not "pinned work", since Oct 15, when "pin" came to mean
 * only pinning a post), under its evidence: "the work:" and its links, one a line (an ipfs address or a magnet link is
 * long), or "no work linked", so a pass whose work can't be checked later says so. Also
 * under each pass record, and on the claim in its poster's name view (web/profile.tsx). A blocked or dead-end claim's
 * links show as any post's do.
 */
export const PinnedWork: FC<{ pins: Link[] }> = ({ pins }) =>
  pins.length ? (
    <div class="how pins">
      <b>{w.node.pinnedWork}</b>
      <ul>{pins.map(l => <li><LinkChip l={l} /></li>)}</ul>
    </div>
  ) : (
    <p class="note pins">{w.node.noPinnedWork}</p>
  )

/** "make it a branch": the create form in branch mode under this node, its title and what filled from the post (web/create.tsx). */
export const makeBranchHref = (path: string, post: string) => `/new?parent=${path}&from=${post}`

/**
 * The ▲ on a thread post (go-live 4.7): its counted upvotes (A6), and a toggle for any verified person but the poster
 * (yours or your agents' posts never take your upvote). Signed out, it goes to sign-in and back (4.1). The form says
 * which way it goes (`up`), so a double click can't undo itself. A pressed ▲ whose upvote isn't counted yet says so.
 * OPEN (#78): the button's title and the "not counted yet" words wait on Myra's yes.
 */
const Upvote: FC<{ p: PostRow; d: NodePageData }> = ({ p, d }) => {
  if (useContext(PageContext).opensSoon) return <span class="up" title={OPENS_SOON.upvote}>{count(w.node.upvoteCount, p.ups)}</span>
  if (!d.me) return <a class="up" href={signInHref(d.here)} title={w.node.signInToUpvote}>▲ {p.ups}</a>
  if (!d.me.verified || p.person_id === d.me.personId) return <span class="up">{count(w.node.upvoteCount, p.ups)}</span>
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
        title={on ? (mine ? w.node.takeBack : w.node.notCounted) : w.node.upvote}
      >
        ▲ {p.ups}
      </button>
    </form>
  )
}

/**
 * The ▲ on a claim (decided Oct 14): "back", for someone on the node, as their vote for the claim's status with its
 * evidence. It moves their one backing here, and a second press takes it off. The count is the people who back the
 * claim, the claimant among them while they do. Backing is a human act on the site. Not joined, or signed out, only the
 * count shows, with why.
 */
const Back: FC<{ p: PostRow; d: NodePageData }> = ({ p, d }) => {
  const opensSoon = useContext(PageContext).opensSoon
  const backers = count(w.node.backers, p.backers ?? 0)
  if (!hasStatusForm(d, opensSoon)) return <span class="up" title={opensSoon ? OPENS_SOON.upvote : fill(w.node.joinToBack, { kind: kindWord(d.chain.node) })}>{backers}</span>
  const on = d.status?.myBacking?.claim?.post === p.id
  return (
    <>
      <form method="post" action={d.here} class="back-act">
        <input type="hidden" name="form_token" value={d.token} />
        <input type="hidden" name="do" value="back" />
        <input type="hidden" name="post" value={p.id} />
        <input type="hidden" name="on" value={on ? '0' : '1'} />
        <button type="submit" class={on ? 'up on' : 'up'} aria-pressed={on ? 'true' : 'false'} title={on ? w.node.unbackTitle : w.node.backTitle}>
          ▲ {w.node.back}
        </button>
      </form>
      {' · '}
      {backers}
    </>
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
      <summary>{w.node.edit}</summary>
      <form method="post" action={d.here} class="edit-act">
        <input type="hidden" name="form_token" value={d.token} />
        <input type="hidden" name="do" value="edit" />
        <input type="hidden" name="post" value={p.id} />
        <textarea name="text" required maxlength={MAX_TEXT} aria-label={w.node.yourPost}>{flash?.draft ?? p.text}</textarea>
        {flash && <p class="err" role="alert">{flash.text}</p>}
        <div class="row">
          <span class="note">{w.node.editNote}</span>
          <button class="btn plain" type="submit">{w.node.save}</button>
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
    <summary>{w.node.delete}</summary>
    <form method="post" action={d.here} class="del-act">
      <input type="hidden" name="form_token" value={d.token} />
      <input type="hidden" name="do" value="delete" />
      <input type="hidden" name="post" value={p.id} />
      <div class="row">
        <span class="note">{w.node.deleteNote}</span>
        <button class="btn plain" type="submit">{w.node.deleteIt}</button>
      </div>
    </form>
  </details>
)

/**
 * "pin" and "unpin" on a top-level post or submission, anyone's (decided Oct 14, "A thread can pin several posts"): for
 * the node's author signed in as their bare handle. A pinned post leads the thread, the latest
 * pinned first; unpinned, it goes back to its place. Not behind the password: pinning is a thread act, as posting is.
 * OPEN: no mockup draws it; its words wait on Myra's yes.
 */
const pinnable = (d: NodePageData, p: PostRow, reply?: boolean) =>
  !reply && !p.deleted_at && (p.kind === 'post' || p.kind === 'submission') && !!d.me?.verified && d.me.personId === d.chain.node.author_id

const PinPost: FC<{ p: PostRow; d: NodePageData; pinned: boolean }> = ({ p, d, pinned }) => (
  <form method="post" action={d.here} class="pin-act">
    <input type="hidden" name="form_token" value={d.token} />
    <input type="hidden" name="do" value="pin" />
    <input type="hidden" name="post" value={p.id} />
    <input type="hidden" name="pin" value={pinned ? '0' : '1'} />
    <button type="submit">{pinned ? w.node.unpin : w.node.pin}</button>
  </form>
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
  if (d.myReports?.has(p.id)) return <> · <span class="note">{w.node.reported}</span></>
  if (!d.me?.verified) return <> · <a href={reportHref(`/w/${d.chain.node.path}#${p.id}`)}>{w.node.report}</a></>
  const reason = flash?.fields?.reason
  return (
    <>
      {' · '}
      <details class="report" open={flash ? true : undefined}>
        <summary>{w.node.report}</summary>
        <form method="post" action={d.here} class="report-act">
          <input type="hidden" name="form_token" value={d.token} />
          <input type="hidden" name="do" value="report" />
          <input type="hidden" name="post" value={p.id} />
          <fieldset>
            <legend>{w.node.reportWhatsWrong}</legend>
            {REASONS.map(r => (
              <label><input type="radio" name="reason" value={r} required checked={reason === r || undefined} /> {REASON_LABEL[r]}</label>
            ))}
          </fieldset>
          <textarea name="text" maxlength={REPORT_TEXT_MAX} aria-label={w.node.reportTextLabel} placeholder={w.node.reportPlaceholder}>{flash?.draft ?? ''}</textarea>
          {flash && <p class="err" role="alert">{flash.text}</p>}
          <div class="row">
            <span class="note">{w.node.reportNote}</span>
            <button class="btn plain" type="submit">{w.node.sendReport}</button>
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
              <span class="note">{fillx(edits[i + 1] ? w.node.editedAgo : w.node.postedAgo, { ago: <Ago at={from} now={now} /> })}</span>
              <Text text={e.text} />
            </li>
          )
        })}
        {edits.length > EDITS_SHOWN && <li><span class="note">{w.node.olderVersions}</span></li>}
      </ol>
    </details>
  )
}

const BuiltOnByView: FC<{ by: BuiltOnBy[] }> = ({ by }) => (
  <b>
    {fillx(w.node.builtOnBy, {
      list: by.map((b, i) => (
        <>
          {i > 0 && ', '}
          <a href={subHref(b.path, b.number)}>{b.same ? `#${b.number}` : <><Plain text={b.title} /> #{b.number}</>}</a>
        </>
      )),
    })}
  </b>
)

/**
 * An old submission's links and how to check it show above its checks once it passed; a failed or superseded one
 * (branch.html, #1) keeps its links in the actions line and drops how to check. Nothing takes submissions or checks
 * since Oct 14, so the thread shows them as history: one still in review then was superseded.
 */
const shownInParts = (sub: SubmissionRow) => sub.status === 'in_review' || sub.status === 'passed'

const SubmissionParts: FC<{ d: NodePageData; sub: SubmissionRow; links: Link[]; builtOn: BuiltOnLink[] }> = ({ d, sub, links, builtOn }) => {
  const n = d.chain.node
  const r = review(n.spec, n.author, sub, d.checks.get(sub.post_id) ?? [])
  const header =
    sub.status === 'superseded' ? (r.failed ? w.node.subFailed : w.node.subSuperseded) : sub.status === 'passed' ? w.node.subPassed : sub.status === 'failed' ? w.node.subFailed : fill(w.node.checksHeader, { done: r.done, total: r.total })
  const right =
    sub.status === 'superseded' ? (sub.superseded_number === null ? '' : fill(w.node.supersededBy, { n: sub.superseded_number })) : sub.status === 'passed' ? fill(w.node.checksOf, { done: r.done, total: r.total }) : ''
  return (
    <>
      {(shownInParts(sub) || builtOn.length > 0) && (
      <div class="how">
        {shownInParts(sub) && <><b>{w.node.linkedLabel}</b> <Links links={links} /></>}
        {builtOn.length > 0 && (
          <>
            {shownInParts(sub) && ' · '}<b>{w.node.builtOnLabel}</b>{' '}
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
      {shownInParts(sub) && <div class="how"><b>{w.node.howToCheckLabel}</b> <Text inline text={sub.how_to_check} /></div>}
      {sub.author_swap === 1 && <div class="how note">{w.node.authorSwap}</div>}
      <div class="checks">
        <div class="h"><b>{header}</b><span>{right}</span></div>
        <ul>{r.rows.filter(isDone).map(row => <CheckRowView row={row} n={n} sub={sub} />)}</ul>
      </div>
    </>
  )
}

/** A check that was made, not a slot still waiting for one. */
export const isDone = (row: ReviewRow): row is DoneRow => row.verdict !== 'waiting'
type DoneRow = Extract<ReviewRow, { verdict: 'pass' | 'fail' }>

/** The run command as a check row names it: its first line, cut short (the full command is in "checked by"). */
const runCmd = (spec: CheckSpec) => (spec.runs ? cut(spec.runs.command.split('\n')[0], 48) : '')

/**
 * One check row. On the node page a run's signed log is a link to the submission page; there (`page`) it opens in
 * place, and a check an author's fail reset shows struck through.
 */
export const CheckRowView: FC<{ row: DoneRow; n: NodeHead; sub: SubmissionRow; page?: boolean }> = ({ row, n, sub, page }) => {
  const slotWord = { run: w.node.slotRun, people: w.node.slotPerson, author: w.node.slotAuthor }[row.slot]
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
            {fill(w.node.exitOn, { code: c.exit_code ?? '', n: sub.number, hash: shortHash(c.submission_hash ?? sub.hash) })}{c.machine && <> · <Plain text={c.machine} /></>} ·{' '}
            {logLink ? (
              <LinkChip l={logLink} compact={!page} />
            ) : inline ? (
              <details class="log">
                <summary>{w.node.signedLog}</summary>
                <Log text={c.log_text!} />
                {/* OPEN (#76): no mockup draws the opened log; these words wait on Myra's yes. */}
                <span class="note logmeta">{fillx(w.node.checkScript, { script: c.script_hash ? <code>{c.script_hash}</code> : w.node.scriptNotNamed })}{c.machine && <> · {fillx(w.node.ranOn, { machine: <Plain text={c.machine} /> })}</>}</span>
              </details>
            ) : c.log_inline ? (
              <a href={logHref}>{w.node.signedLog}</a>
            ) : (
              w.node.log
            )}
          </>
        )}
        {c.slot !== 'run' && (
          <>
            {c.text ? <Text inline text={c.text} /> : c.slot === 'author' ? (c.verdict === 'pass' ? w.node.signedOff : w.node.failedIt) : c.verdict === 'pass' ? w.node.verdictPass : w.node.verdictFail}
            {evidence.length > 0 && <> · <Links links={evidence} compact /></>}
          </>
        )}
        {c.verdict === 'fail' && repro?.links?.length ? <> · <Links links={repro.links} compact /></> : null}
        {page && c.verdict === 'fail' && repro?.steps && repro.steps !== c.text && <> · {fillx(w.node.repro, { steps: <Text inline text={repro.steps} /> })}</>}
        {c.slot === 'author' && humanOf(c.as_name) !== n.author && <span class="note"> · {w.node.authorGone}</span>}
        {c.reset_at && <span class="note"> · {w.node.reset}</span>}
      </span>
    </li>
  )
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
      {w.node.password} <input id={id} type="password" name="password" autocomplete="current-password" required maxlength={1024} form={form} />
    </label>
  )

// ---------- the pass box ----------

/**
 * The pass box (decided Oct 14, in place of the result page): above the thread of a node with a pass record, its
 * records newest first, each with its work; "since then: blocked (oct 20)" once the status moved on after the
 * newest, or "now: on track" when it's another status that didn't move after it (an author's mark); the dated status history, folded; and, for a shwarm's author with a passed claim to cite, "approve it".
 * Nothing in it locks anything. Its id is PASS_BOX (#passed), where the author's inbox notice links.
 * OPEN: no mockup draws it; its words are Claude's drafts of the spec's lines (Oct 14).
 */
const PassBox: FC<{ d: NodePageData }> = ({ d }) => {
  const s = d.status
  const latest = s.records[0]
  if (!latest) return null
  const now = s.now
  // An author's approval can come before the node has any status of its people's: then nothing is said beside it.
  const other = now.current !== null && now.current !== latest.status
  const moved = other && !!now.changed_at && now.changed_at > latest.at
  const authored = s.authorApproved !== null // a pass from before Oct 14 isn't their approval unless they checked it (read/status.ts)
  return (
    <div class="box passbox" id={PASS_BOX}>
      <h2>{statusName(latest.status)}</h2>
      <ul class="records">
        {s.records.map(r => <RecordView r={r} d={d} />)}
      </ul>
      {(other || s.history.length > 0) && (
        <div class="in since">
          {other && (
            <p>
              <b>{moved ? fillx(w.node.sinceThen, { status: statusName(now.current!), when: <When at={now.changed_at!} /> }) : fill(w.node.statusNow, { status: statusName(now.current!) })}</b>
            </p>
          )}
          {s.history.length > 0 && <StatusHistory d={d} />}
        </div>
      )}
      {canMark(d) && <div class="in owner"><MarkPassed d={d} open={!authored} /></div>}
    </div>
  )
}

/** A record's or a change's moment: "oct 14 18:00", the exact time on hover (utc). */
const When: FC<{ at: string }> = ({ at }) => <span title={exact(at)}>{monthDay(at, true)}</span>

/** "a · b · c", skipping empty parts. */
const dotted = (parts: unknown[]) => parts.filter(p => p !== null && p !== undefined && p !== false && p !== '').flatMap((p, i) => (i ? [' · ', p] : [p]))

/**
 * One pass record (read/status.ts PassRecord):
 *   * its people's: "passed as of oct 14 18:00 · @ana's passed claim · backed by 6"
 *   * the author's approval (decided Oct 15): "@myra approved · oct 15 09:12 · citing @ana's claim"
 *   * from before Oct 14 (migration 0032): "passed oct 9 21:47 · submission #2", or "dead end oct 9 21:47 · <its note>".
 * Then the work it links, or "no work linked"; a dead end has none to show.
 */
const RecordView: FC<{ r: PassRecord; d: NodePageData }> = ({ r, d }) => {
  const when = <When at={r.at} />
  const claim = r.claim && <a href={`#${r.claim.post}`}>{fillx(w.node.theirClaim, { name: <Name name={r.claim.by} />, status: statusName('passed') })}</a>
  const parts =
    r.status === 'dead_end'
      ? [fillx(w.node.recordDeadEnd, { when }), r.note && <a href={`#${r.note.post}`}><Text inline text={cut(r.note.text, 200)} /></a>]
      : r.submission !== null
        ? [fillx(w.node.recordPassed, { when }), <a href={subHref(d.chain.node.path, r.submission)}>{fill(w.node.submissionNumber, { n: r.submission })}</a>]
        : r.kind === 'author'
          ? [fillx(w.node.recordAuthor, { name: <b><Name name={r.by ?? FORMER} link /></b>, when }), r.claim && <a href={`#${r.claim.post}`}>{fillx(w.node.citingClaim, { name: <Name name={r.claim.by} /> })}</a>]
          : [fillx(w.node.recordCrowd, { when }), claim, count(w.node.backedBy, r.backers)]
  return (
    <li class={r.kind}>
      <div>{dotted(parts)}</div>
      {r.status === 'passed' && <PinnedWork pins={r.pins} />}
    </li>
  )
}

/** The node's dated status changes, newest first (read/status.ts StatusChange): "on track → blocked · oct 12 09:00 · 3 to 1", or for its first status "no status → on track". */
const StatusHistory: FC<{ d: NodePageData }> = ({ d }) => (
  <details class="hist">
    <summary>{w.node.statusHistory}</summary>
    <ol>
      {d.status.history.map(h => (
        <li>
          {fillx(w.node.historyLine, {
            from: h.from === null ? w.node.noStatus : statusName(h.from),
            to: h.claim ? <a href={`#${h.claim}`}>{statusName(h.to)}</a> : statusName(h.to),
            when: <When at={h.at} />,
          })}
          {/* the changes migration 0032 recorded from before Oct 14 have no tally */}
          {h.backers + h.against > 0 && <> · {fill(w.node.historyTally, { backers: h.backers, against: h.against })}</>}
        </li>
      ))}
    </ol>
  </details>
)

/**
 * "approve it" (decided Oct 14 as "mark it passed"; worded as approving Oct 15): a shwarm's author's own record, citing one of its passed claims, the most-backed
 * first. It acts with the author's authority, so it confirms with the password (asked inline while the 10-minute
 * window is closed). It changes no status and locks nothing; marking again citing another claim adds a record.
 * Open while the author has no record of their own yet.
 */
const canMark = (d: NodePageData) => !!d.me?.verified && d.me.personId === d.chain.node.author_id && d.chain.node.kind !== 'branch' && d.status.passedClaims.length > 0

const MarkPassed: FC<{ d: NodePageData; open: boolean }> = ({ d, open }) => {
  const flash = d.flash?.at === 'owner' ? d.flash : undefined
  const picked = flash?.fields?.post
  const pick = (c: ClaimRow, i: number) => (picked ? picked === c.post : i === 0)
  return (
    <details class="passmark" open={open || flash ? true : undefined}>
      <summary>{w.node.markPassed}</summary>
      <form method="post" action={nodeHref(d.chain.node.path)} class="owner-act">
        <input type="hidden" name="form_token" value={d.token} />
        <input type="hidden" name="do" value="mark_passed" />
        <label for="m-claim">{w.node.markCites}</label>
        <select id="m-claim" name="post" required>
          {d.status.passedClaims.map((c, i) => (
            <option value={c.post} selected={pick(c, i) || undefined}>
              {fill(w.node.markOption, { name: c.by, backers: count(w.node.backers, c.backers), when: monthDay(c.at, true), what: cut(c.text, 60) })}
            </option>
          ))}
        </select>
        <StepUpField id="m-pw" open={d.steppedUp} />
        {flash && <p class="err" role="alert">{flash.text}</p>}
        <div class="row">
          <span class="note">{w.node.markNote}</span>
          <button class="btn plain" type="submit">{w.node.markButton}</button>
        </div>
      </form>
    </details>
  )
}

// ---------- sidebar ----------

/**
 * The author's own box (go-live 5.6): "approve it", on a shwarm with no pass record yet, once someone posted a
 * passed claim to cite. Once there is a record, the mark sits in the pass box with it. Editing a shwarm is retired
 * (decided Oct 12), and so is the author's dead end (decided Oct 14: dead end comes from claims).
 * OPEN (#76): no mockup draws this box; its words wait on Myra's yes.
 */
const Owner: FC<{ d: NodePageData }> = ({ d }) => {
  if (!canMark(d) || d.status.records.length) return null
  return (
    <div class="box owner" id="owner">
      <h2 class="sunny">{fill(w.node.yourKind, { kind: w.node.kindShwarm })} <span>{w.node.onlyYou}</span></h2>
      <div class="in">
        <MarkPassed d={d} open />
      </div>
    </div>
  )
}

/** Join or leave as one button. A join button carries `jn-open`: with scripts on it opens the say-hi modal instead of posting. */
const seatForm = (d: NodePageData, act: 'join' | 'leave', label: string, cls: string) => (
  <form method="post" action={nodeHref(d.chain.node.path)} class="seat-act">
    <input type="hidden" name="form_token" value={d.token} />
    <input type="hidden" name="do" value={act} />
    <button class={act === 'join' ? `${cls} jn-open` : cls} type="submit">{label}</button>
  </form>
)

/** The viewer may join here now: verified, not joined yet, and not held back by the beta. */
const canJoin = (d: NodePageData, opensSoon: boolean | undefined) => !!d.me?.verified && !d.mySeat && !opensSoon

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
  const mine = postsOnPage(t).filter(
    // Their own hello, or the hello an agent of theirs sent with the join it made for them (decided Oct 12).
    p =>
      p.is_join === 1 && !p.deleted_at && p.person_id === d.me!.personId && (p.as_name === '@' + d.me!.handle || p.as_name.startsWith('@' + d.me!.handle + '/')),
  )
  return mine.sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.id
}
const myJoinHref = (d: NodePageData) => (myQuietLine(d) ? '#jn-row' : (id => (id ? `#${id}` : null))(myJoinPost(d)))

/**
 * The join button on the node's own post, under its status badge (shwarm.html, branch.html: `.head .state`). Signed out it goes
 * to sign-in and back; joined, it says "✿ joined". Not shown where the people card only has a note (the beta,
 * an unverified email).
 */
const HeadJoin: FC<{ d: NodePageData }> = ({ d }) => {
  const opensSoon = useContext(PageContext).opensSoon
  if (d.mySeat) return <span id="jn-state"><span class="joined" tabindex={-1}>{w.node.joined}</span></span>
  if (opensSoon) return null
  if (!d.me) return <span id="jn-state"><a class="btn" href={signInHref(d.here)}>{w.node.join}</a></span>
  if (!d.me.verified) return null
  return <span id="jn-state">{seatForm(d, 'join', w.node.join, 'btn')}</span>
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
        <h2 id="jn-title"><span>{w.node.sayHi}</span><button type="button" id="jn-close" aria-label={w.node.close}>×</button></h2>
        <div class="sec">
          <p>
            {fillx(w.node.joining, { branch: <b>{n.kind === 'branch' ? <Plain text={n.title} /> : w.node.joinRoot}</b>, shwarm: <b><Plain text={root.title} /></b> })}
          </p>
          <label for="jn-hi" class="jn-label">{w.node.hiLabel}</label>
          <textarea id="jn-hi" name="hello" maxlength={MAX_TEXT} aria-describedby={flash ? 'jn-err' : undefined} autofocus={flash ? true : undefined}>{flash?.draft ?? ''}</textarea>
          {flash && <p class="err" id="jn-err" role="alert">{flash.text}</p>}
        </div>
        <div class="sec go">
          <span></span>
          <button class="btn" type="submit" id="jn-go">{w.node.join}</button>
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
      {j.joined_by
        ? fillx(w.node.joinedLineBy, { name: <b><Name name={j.as} link /></b>, by: <Name name={j.joined_by} /> })
        : fillx(w.node.joinedLine, { name: <b><Name name={j.as} link /></b> })}{' '}
      · <Ago at={j.at} now={d.now} short />
    </div>
  )
  const rest = lines.slice(JOIN_LINES_SHOWN)
  return (
    <>
      {lines.slice(0, JOIN_LINES_SHOWN).map(line)}
      {rest.length > 0 && (
        <details class="c ev more-joins" open={rest.includes(mine!) || undefined}>
          <summary>{w.node.moreJoined}</summary>
          {rest.map(line)}
        </details>
      )}
    </>
  )
}

/**
 * A branch's line under its name in a list: while its status isn't on track, the evidence of the claim behind it (or,
 * a dead end from before Oct 14, its author's note); else its status line.
 */
const ChildSub: FC<{ c: Child }> = ({ c }) => {
  const imp = c.posts_per_day && c.posts_per_day > 0 ? <Imp q={c.impact ?? 0} ppd={c.posts_per_day} /> : null
  const say = c.reason ? c.reason.text : c.status.current === 'dead_end' && c.dead_end_note ? c.dead_end_note : c.status_line ?? ''
  return (
    <div class="sub">
      {imp}
      {imp && say && ' · '}
      {say && <Text inline text={cut(say, 90)} />}
    </div>
  )
}

/** Each status's name in the word list, by its API name. */
const statusName = (s: Status): string =>
  ({ on_track: w.node.statusNames.on_track, blocked: w.node.statusNames.blocked, passed: w.node.statusNames.passed, dead_end: w.node.statusNames.dead_end })[s]

/** A claim's words by its status: its tag in the thread, its form's question and its form's button. */
const claimWords = (c: Claim) =>
  ({
    blocked: { tag: w.node.claimTag.blocked, ask: w.node.claimAsk.blocked, vote: w.node.claimVote.blocked },
    passed: { tag: w.node.claimTag.passed, ask: w.node.claimAsk.passed, vote: w.node.claimVote.passed },
    dead_end: { tag: w.node.claimTag.dead_end, ask: w.node.claimAsk.dead_end, vote: w.node.claimVote.dead_end },
  })[c]

/**
 * The challenger line (decided Oct 14, the rubber band): the status that leads the current one, by how many, and when it
 * takes over at this rate, or the lead it still needs to start counting. Nothing while no other status leads. The time is in whole hours, rounded down as the briefing's (core/status.ts hoursUntil), so a
 * signed-out page cached within the hour (its ETag carries the hour) stays true. OPEN: new words, Claude's drafts of Myra's lines (Oct 14).
 */
export function challengerLine(s: NodeStatus, now: number): string | null {
  const c = s.challenger
  if (!c || c.lead < 1) return null
  const status = statusName(c.status)
  if (!c.changes_at) return fill(w.node.aheadNeeds, { status, n: c.lead, margin: MARGIN })
  const h = hoursUntil(c.changes_at, now)
  const when = h < 1 ? w.node.underAnHour : count(w.node.inHours, h)
  return fill(w.node.aheadCounting, { status, n: c.lead, when })
}

/**
 * A node's backing as small bars (Myra, Oct 13: "little progress bars"): one per status, filled by its share of the
 * people who back anything, with "{n} of {people}", the current status in bold and the viewer's own in yellow; then the
 * challenger line. Only inside the badge's panel (StatusBadge). They sort nothing: activity orders the list.
 */
const BackingBars: FC<{ s: NodeStatus; mine?: Status | null; now: number }> = ({ s, mine, now }) => {
  const t = s.backing
  const line = challengerLine(s, now)
  return (
    <div class="votes">
      {t.people ? (
        <ul>
          {STATUSES.map(st => (
            <li class={[st === s.current && 'cur', !t[st] ? 'none' : mine === st && 'mine'].filter(Boolean).join(' ') || undefined}>
              <span class="vl">{statusName(st)}</span>
              <span class="vb"><i style={`width:${Math.round((t[st] / t.people) * 100)}%`}></i></span>
              <span class="vn">{fill(w.node.statusOf, { n: t[st], people: t.people })}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="vp">{w.node.noStatusVotes}</p>
      )}
      {line && <p class="vp">{line}</p>}
    </div>
  )
}

/**
 * A node's status badge (Myra, Oct 13: "Just show a badge for the branch and a hover/tap shows the values"; decided
 * Oct 14, every node): its current status (core/status.ts), in place of "live" in the head, at the right of the people
 * card's heading and beside a branch in its parent's list. No status yet, no badge (decided Oct 17: "if nobody has voted
 * on a shwarm or branch, why is it on track by default?"). Hover or keyboard focus shows the bars; with scripts on, a
 * tap or click opens and closes them (static/js/node.js). Screen readers get the bars as the badge's description.
 */
const StatusBadge: FC<{ s: NodeStatus; mine?: Status | null; now: number; id: string }> = ({ s, mine, now, id }) =>
  s.current === null ? null : (
    <div class="vote-badge">
      <button type="button" class={`st vs ${s.current.replace('_', '-')}`} aria-expanded="false" aria-controls={id} aria-describedby={id}>
        {statusName(s.current)}
      </button>
      <div class="vb-panel" id={id}>
        <BackingBars s={s} mine={mine} now={now} />
      </div>
    </div>
  )

/** A badge's id in a list of branches: from the branch's path, which is unique. */
const badgeId = (path: string) => `vb-${path.replace(/[^a-z0-9]+/g, '-')}`

/**
 * What sits beside a branch in a list: "quiet" after QUIET_HOURS with no post (unless it passed), then its status badge.
 * No "live" pill (Myra, Oct 13: "What is live? If it exists it's live yeah?").
 */
const BranchPills: FC<{ b: Child; now: number }> = ({ b, now }) => (
  <div class="pills">
    {b.quiet && b.status.current !== 'passed' && <span class="st quiet" title={fill(w.node.quietTitle, { hours: QUIET_HOURS })}>{w.node.quiet}</span>}
    <StatusBadge s={b.status} now={now} id={badgeId(b.path)} />
  </div>
)

const Branches: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  const isBranch = n.kind === 'branch'
  const kinds = isBranch ? w.node.subBranches : w.node.branches
  return (
    <div class="box">
      <h2>{kinds} <span>{w.node.ownThread}</span></h2>
      {d.branches.length ? (
        <ul class="branches">
          {d.branches.map(b => (
            <li>
              <div class="nm">
                <a href={nodeHref(b.path)}><Plain text={b.title} /></a>
                <BranchPills b={b} now={d.now} />
              </div>
              <ChildSub c={b} />
            </li>
          ))}
        </ul>
      ) : (
        <div class="in note">{fill(w.node.noBranches, { kinds })}</div>
      )}
      <div class="in" style="border-top:1px solid var(--ink)">
        {useContext(PageContext).opensSoon ? (
          <p class="note" style="margin:0;text-align:center">{OPENS_SOON.branch}</p>
        ) : (
          <a class="btn plain" href={`/new?parent=${n.path}`} style="display:block;text-align:center">{fill(w.node.startBranch, { kind: isBranch ? w.node.subBranch : w.node.kindBranch })}</a>
        )}
      </div>
    </div>
  )
}

/** Everyone on a node, as a page and as JSON (read/people.ts): where "+ n more" goes. */
export const peopleHref = (path: string) => `/w/${path}/people`

/** One person in the people card (and on the /people page): their name, the agent that joined for them, and what they did here. */
export const PersonRow: FC<{ r: Contributor; n: NodeHead; now: number }> = ({ r, n, now }) => {
  const ppd = postsPerDay(r, n.created_at, now)
  return (
    <li>
      {/* people only, once each; a join an agent made for them says so (decided Oct 12). OPEN (#115): new words. */}
      {r.joined_by ? (
        <span class="who-by">
          <Name name={r.handle} link />
          <span class="jb">{fillx(w.node.joinedBy, { name: <Name name={r.joined_by} /> })}</span>
        </span>
      ) : (
        <Name name={r.handle} link />
      )}
      <small>
        {r.person_id === n.author_id && (r.posts > 0 ? `${w.node.author} · ` : w.node.author)}
        {r.posts > 0 && <Imp q={r.upvotes / r.posts} ppd={ppd} />}
      </small>
    </li>
  )
}

/**
 * The people card (decided Oct 14, "One card for a node's people, status and joining"): "on this branch" or "on this
 * shwarm", a branch's status badge at the heading's right (its backing on hover or tap) and its challenger line; the
 * first PEOPLE_SHOWN people, and "+ n more", which opens everyone in a modal (PeopleModal), or without scripts the
 * /people page; then join with the url for an agent, or the joined block (CardJoin).
 */
const PeopleCard: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  const { rows, total } = d.contributors
  const people = Math.max(n.stats?.people ?? 0, total)
  const line = challengerLine(d.status.now, d.now)
  return (
    <div class="box people" id="people">
      <div class="ph">
        <h2 class="sunny">{n.kind === 'branch' ? w.node.onThisBranch : w.node.onThisShwarm}</h2>
        <StatusBadge s={d.status.now} mine={d.status.myBacking?.status} now={d.now} id="vb-card" />
      </div>
      <div class="in">
        {line && <p class="chal">{line}</p>}
        <p class="note">{count(w.node.peopleImpact, people)}</p>
        <ul class="crew">
          {rows.map(r => <PersonRow r={r} n={n} now={d.now} />)}
        </ul>
        {total > rows.length && <a class="more-people" id="pp-open" href={peopleHref(n.path)}>{fill(w.node.more, { n: total - rows.length })}</a>}
        <CardJoin d={d} />
      </div>
    </div>
  )
}

/**
 * Everyone on the node, opened by "+ n more" (static/js/node.js), which loads the list from /w/<path>/people as JSON
 * when it opens. Closed by ×, Esc or the scrim. Without scripts "+ n more" is a link to the list's page.
 */
const PeopleModal: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  if (d.contributors.total <= d.contributors.rows.length) return null
  return (
    <div class="dn-scrim" id="pp-scrim" hidden>
      <div class="dn pp" role="dialog" aria-modal="true" aria-labelledby="pp-title" data-src={`${peopleHref(n.path)}?format=json`}>
        <h2 id="pp-title">
          <span>{n.kind === 'branch' ? w.node.onThisBranch : w.node.onThisShwarm}</span>
          <button type="button" id="pp-close" aria-label={w.node.close}>×</button>
        </h2>
        <div class="sec">
          <ul class="crew" id="pp-list"></ul>
          <p class="note" id="pp-note" role="status"></p>
        </div>
      </div>
    </div>
  )
}

/**
 * The people card's lower part (decided Oct 14): join (signed out, it goes to sign-in and back), then "or give your
 * agent this branch's url" with the url and "how to join in" folded under it. Joined: "you're working on this branch.",
 * a link to their join in the thread and leave (anyone but a shwarm's author can leave), then the status buttons
 * (StatusPart). Joining changes nothing but this: the joiner shows here and on their profile, gets its notices, and votes
 * on its status; joining a branch counts them in the nodes above it too.
 * OPEN (#115): someone counted here only through a branch they joined shows as joined, with leave and no link.
 */
const CardJoin: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  const opensSoon = useContext(PageContext).opensSoon
  const flash = d.flash?.at === 'seats' && !joinFlash(d) ? d.flash : undefined
  const err = flash && <p class="err" role="alert">{flash.text}</p>
  if (d.mySeat) {
    const href = myJoinHref(d)
    const canLeave = !(n.kind !== 'branch' && d.me?.personId === n.author_id)
    return (
      <div class="late">
        <div class="note">
          <b>{fill(w.node.working, { kind: kindWord(n) })}</b>
          {href && <> <a href={href}>{w.node.yourJoin}</a></>}
          {canLeave && <>{href ? ' · ' : ' '}{seatForm(d, 'leave', w.node.leave, 'linkish')}</>}
        </div>
        {err}
        <StatusPart d={d} />
      </div>
    )
  }
  return (
    <div class="late">
      {opensSoon ? (
        <p class="note">{OPENS_SOON.join}</p>
      ) : !d.me ? (
        <p class="join"><a class="btn plain" href={signInHref(d.here)}>{w.node.join}</a></p>
      ) : !d.me.verified ? (
        <>
          <p class="join"><button class="btn plain" type="button" disabled>{w.node.join}</button></p>
          <p class="note">{w.node.verifyToJoin}</p>
        </>
      ) : (
        <div class="join">{seatForm(d, 'join', w.node.join, 'btn plain')}</div>
      )}
      {err}
      <AgentUrl d={d} />
    </div>
  )
}

/** "or give your agent this branch's url:", the url with copy (static/js/node.js), and "how to join in" folded under it. */
const AgentUrl: FC<{ d: NodePageData }> = ({ d }) => {
  const kind = kindWord(d.chain.node)
  return (
    <div class="agent-url">
      <p class="note">{fill(w.node.agentUrl, { kind })}</p>
      <div class="url"><code id="w-url">{d.url}</code><button class="btn" id="w-copy" type="button">{w.node.copy}</button></div>
      {/* Myra asked for basic steps under the url (Oct 10); the words wait on her yes. */}
      <details class="how-join">
        <summary>{w.node.howToJoin}</summary>
        <ol>
          <li>{w.node.howToJoin1}</li>
          <li>{fillx(w.node.howToJoin2, { keys: <a href="/keys">{w.node.keysLink}</a>, skills: <a href="/skills">{w.node.skillsLink}</a> })}</li>
          <li>{fill(w.node.howToJoin3, { kind })}</li>
        </ol>
        <p class="note">{fillx(w.node.beforeAgent, { guide: <a href="/guide-safety">{w.node.safetyLink}</a> })}</p>
      </details>
    </div>
  )
}

/** The viewer votes on this node's status here: they joined it, signed in and verified, not held back by the beta. */
const hasStatusForm = (d: NodePageData, opensSoon: boolean | undefined) => !!d.mySeat && !!d.me?.verified && !opensSoon

/**
 * "how's it going?" in the people card, on a shwarm or branch the viewer joined (decided Oct 14): on track is a toggle, their
 * plain vote, cast or taken back in one click; blocked, passed and dead end each open a claim form (ClaimForm) under
 * the buttons, with no script needed (the form is the link's target; static/js/node.js opens it in place). Their
 * current backing is the yellow button, and a claim they back is named under them.
 */
const StatusPart: FC<{ d: NodePageData }> = ({ d }) => {
  const opensSoon = useContext(PageContext).opensSoon
  if (!hasStatusForm(d, opensSoon)) return null
  const n = d.chain.node
  const mine = d.status.myBacking
  const flash = d.flash?.at === 'status' ? d.flash : undefined
  const open = flash && isClaim(flash.fields?.status) ? (flash.fields!.status as Claim) : null
  const onTrack = mine?.status === 'on_track'
  const claim = mine?.claim
  const own = claim && humanOf(claim.by) === '@' + d.me!.handle
  return (
    <div class="hows" id="status">
      <p class="note"><b>{w.node.howsItGoing}</b></p>
      <div class="vote-btns">
        <form method="post" action={nodeHref(n.path)} class="status-act">
          <input type="hidden" name="form_token" value={d.token} />
          <input type="hidden" name="do" value="status" />
          <button class={onTrack ? 'btn on' : 'btn plain'} type="submit" name="status" value={onTrack ? '' : 'on_track'} aria-pressed={onTrack ? 'true' : 'false'} title={onTrack ? w.node.onTrackTakeBack : w.node.onTrackTitle}>
            {statusName('on_track')}
          </button>
        </form>
        {CLAIMS.map(c => (
          <a class={mine?.status === c ? 'btn on' : 'btn plain'} href={`#claim-${c}`} aria-controls={`claim-${c}`}>{statusName(c)}</a>
        ))}
      </div>
      {CLAIMS.map(c => <ClaimForm d={d} claim={c} flash={open === c ? flash : undefined} />)}
      {claim && (
        <p class="note">
          {fillx(w.node.youBack, {
            claim: <a href={`#${claim.post}`}>{own ? fill(w.node.yourClaim, { status: statusName(mine!.status) }) : fillx(w.node.theirClaim, { name: <Name name={claim.by} />, status: statusName(mine!.status) })}</a>,
          })}
        </p>
      )}
      {flash && !open && <p class="err" role="alert">{flash.text}</p>}
    </div>
  )
}

/**
 * One claim's form (decided Oct 14): its question, the evidence, and "vote blocked" (or passed, dead end). It posts to
 * the thread as the viewer, a claim that their backing moves to. A passed claim also takes the work it links, one link per
 * line, with why to link it. Hidden until its button opens it: the link's target without scripts, a toggle with them. A
 * refused claim opens it again with the words and the pins kept.
 */
const ClaimForm: FC<{ d: NodePageData; claim: Claim; flash?: Flash }> = ({ d, claim, flash }) => {
  const id = `cl-${claim}`
  return (
    <form id={`claim-${claim}`} class={flash ? 'claim-act open' : 'claim-act'} method="post" action={nodeHref(d.chain.node.path)}>
      <input type="hidden" name="form_token" value={d.token} />
      <input type="hidden" name="do" value="claim" />
      <input type="hidden" name="status" value={claim} />
      <label for={id}>{fill(claimWords(claim).ask, { kind: kindWord(d.chain.node) })}</label>
      <textarea id={id} name="text" required maxlength={MAX_TEXT} aria-describedby={`${id}-n`} autofocus={flash ? true : undefined}>{flash?.draft ?? ''}</textarea>
      {claim === 'passed' && (
        <>
          <label for={`${id}-pins`}>{w.node.pinsLabel} <span class="note">{w.node.optional}</span></label>
          <span class="note" id={`${id}-pins-n`}>{w.node.pinsNote}</span>
          <textarea id={`${id}-pins`} class="pins" name="links" rows={2} aria-describedby={`${id}-pins-n ${id}-pins-h`} placeholder={w.node.pinsPlaceholder}>{flash?.fields?.links ?? ''}</textarea>
          <p class="note hint" id={`${id}-pins-h`}>{w.node.pinsHint}</p>
        </>
      )}
      {flash && <p class="err" role="alert">{flash.text}</p>}
      <p class="note" id={`${id}-n`}>{fillx(w.node.claimNote, { name: <Name name={'@' + d.me!.handle} /> })}</p>
      <div class="row">
        <a href="#status" class="cancel">{w.node.cancel}</a>
        <button class="btn" type="submit">{claimWords(claim).vote}</button>
      </div>
    </form>
  )
}
