// The public profile and the name view (go-live 3.5, PRD §6.8, mockups/profile.html), and the owner's inbox (6.1).
//   /@handle            head (handle, display name, joined, about, links, three figures), working on, created,
//                       and the "look up a name" box
//   /@handle?as=@h/x    the same head, then only that name's posts (not its mentions)
//   /@handle?account=1  the owner's account modal (6.2), open (web/account.tsx)
//   POST /@handle       the owner's forms: the inbox's (an inline reply, mark read or unread, mark all read) and the
//                       account modal's (save, change password, sign out everywhere, download your data, close the account)
// Profiles are about the human: no agent profiles, no list of names under a person, no agent counts, no passes.
// The owner, signed in, also sees the private inbox (PROF-5: mentions of the bare handle, sign-off items with their
// live status, system items), "waiting on you" on working on and created (PROF-9), and their own nodes still being
// checked in "created". Nobody else's session ever reads the inbox: the page asks for it only when the session is the
// profile's own, and the POST refuses anyone else.
// The owner also gets the "account" button and its modal (6.2); it reads their private settings only for them.
import { Hono, type Context } from 'hono'
import { useContext, type Child, type FC } from 'hono/jsx'
import { HANDLE_RE, isValidName, ShwarmError } from '@shwarm/protocol'
import { checkAccount, checkNewPassword, saveAccount, type AccountForm } from '../auth/account'
import { closeAccount, confirmsHandle } from '../auth/close'
import { clientIp, formOf, postedTokenOk, sessionOf, who, type AuthContext } from '../auth/request'
import { signInHref } from '../auth/return-to'
import { clearCookie, endAllSessions, type Session } from '../auth/session'
import { inlineStepUp, setPassword } from '../auth/signin'
import { bump, LIMITS } from '../auth/throttle'
import { stepUpOpen } from '../auth/stepup'
import { readAccount } from '../read/account'
import { readExport } from '../read/export'
import { siteActor } from '../core/actor'
import { peekThreadTokensMany } from '../core/limits'
import { MAX_TEXT } from '../core/text'
import { runInTree } from '../do/shwarm-tree'
import { ago } from '../render/ago'
import { cut } from '../render/format'
import { exactTime } from '../render/numbers'
import { Name, Plain, Text } from '../render/text'
import { impactMark, oneDecimal } from '../read/figures'
import { markAllRead, markRead, readInbox, readReplyTarget, UNREAD_CAP, type InboxItem } from '../read/inbox'
import {
  findPerson,
  linksOf,
  LIST_MAX,
  readNamePosts,
  readProfile,
  type CreatedRow,
  type Head,
  type NamePost,
  type Person,
  type Profile,
  type WorkingRow,
} from '../read/profile'
import { fill, fillx, w } from '../words'
import { accountStatus, AccountModal, type AccountFlash, type AccountView } from './account'
import { formatFor, sendError, waitText, type ErrorStatus } from './errors'
import { Layout } from './layout'
import { limitLine } from './node-page'
import { justPosted, threadHref } from './node-routes'
import { overReadCap } from './read-limit'
import { pillOf, PillView } from './submission-page'
import { page, PageContext } from './viewer'

type Env = { DB: D1Database; TREE: DurableObjectNamespace; ENV: string; SITE_MODE: string; CSRF_SECRET: string; PASSWORD_PEPPER: string }

/** Rows each list shows before "show all". */
export const SHOWN = 25

// ---------- small parts ----------

const nodeHref = (path: string) => `/w/${path}`
/** A relative time with the exact one on hover (go-live 3.8). */
const Ago: FC<{ at: string; now: number }> = ({ at, now }) => <time datetime={at} title={exactTime(at)}>{ago(at, now)}</time>
/** "a · b · c", skipping empty parts. */
const dotted = (parts: (Child | false | null | undefined)[]) =>
  parts.filter(p => p !== false && p !== null && p !== undefined && p !== '').flatMap((p, i) => (i ? [' · ', p] : [p]))

// A variant made before they were dropped (Oct 9) reads as a shwarm.
const kindLabel = (r: { kind: string; up_title: string | null }, branchOf = false): Child =>
  r.kind !== 'branch' ? w.profile.kindShwarm : r.up_title === null ? w.profile.kindBranch : (
    <>
      {branchOf ? fillx(w.profile.branchOf, { name: <Name name={r.up_title} /> }) : <Name name={r.up_title} />}
    </>
  )

/**
 * The node's state as the profile says it. OPEN (#18): a passed node says "passed" here, "closed" in the feed.
 * To the owner, a node whose submission waits on their sign-off says "waiting on you" (PROF-9, as the mockup).
 */
function stateLabel(r: { state: string; in_review: number; waiting?: number }): string {
  if (r.state === 'closed') return w.profile.passed
  if (r.state === 'dead_end') return w.profile.deadEnd
  if (r.waiting) return w.profile.waitingOnYou
  return r.in_review ? w.profile.inReview : ''
}

function badge(r: CreatedRow): { cls: string; text: string } {
  // Only the owner sees nodes that aren't public yet (A8).
  if (!r.public) return r.triage === 'blocked' ? { cls: 'st dead', text: w.profile.blocked } : { cls: 'st wait', text: w.profile.beingChecked }
  if (r.state === 'closed') return { cls: 'st done', text: w.profile.passed }
  if (r.state === 'dead_end') return { cls: 'st dead', text: w.profile.deadEnd }
  if (r.waiting) return { cls: 'st live', text: w.profile.waitingOnYou }
  return { cls: 'st live', text: w.profile.live }
}

const Imp: FC<{ figures: WorkingRow['figures'] }> = ({ figures }) => {
  if (!figures) return null
  const m = impactMark(figures)
  return <span class="imp" style={`--q:${m.q}`} title={m.title}>{m.text}</span>
}

// ---------- the page ----------

const WhoHead: FC<{ person: Person; head: Head; now: number; owner?: boolean }> = ({ person: p, head, now, owner }) => {
  const links = linksOf(p.links)
  return (
    <section class="who-head">
      <div>
        <h1 class="path"><Name name={`@${p.handle}`} /></h1>
        {/* OPEN: no "verified human" mark at launch. The account button is a link, so the modal opens without script too. */}
        <div class="meta">
          {dotted([p.display_name ? <Name name={p.display_name} /> : null, <>{fillx(w.profile.joined, { when: <Ago at={p.created_at} now={now} /> })}</>])}
          {owner && <a class="acct" id="acct" href={`/@${p.handle}?account=1`} aria-haspopup="dialog">{w.profile.accountLink}</a>}
        </div>
        {p.about && <p class="about"><Text inline text={p.about} /></p>}
        {links.length > 0 && (
          <p class="plinks">
            {links.map(l => (
              <span>{l.label && <><span class="lb"><Name name={l.label} /></span> </>}<Text inline text={l.url} /></span>
            ))}
          </p>
        )}
      </div>
      <div class="stats">
        <div>{head.workingMore ? `${head.workingOn}+` : head.workingOn}<small>{w.profile.statWorkingOn}</small></div>
        <div>{head.postsThisWeek}<small>{w.profile.statPostsThisWeek}</small></div>
        <div>
          ▲{head.perPost === null ? '–' : oneDecimal(head.perPost)}
          <small>{fill(w.profile.statPerPost, { avg: head.siteAvg === null ? '–' : oneDecimal(head.siteAvg) })}</small>
        </div>
      </div>
    </section>
  )
}

const WorkingOn: FC<{ rows: WorkingRow[]; all: boolean; handle: string; now: number; total: string }> = ({ rows, all, handle, now, total }) => (
  <div class="box">
    <h2>{w.profile.workingOn} <span>{w.profile.workingOnKey}</span></h2>
    {rows.length ? (
      <table>
        <thead><tr><th>{w.profile.colShwarmOrBranch}</th><th class="n">{w.profile.colImpact}</th></tr></thead>
        <tbody>
          {(all ? rows : rows.slice(0, SHOWN)).map(r => (
            <tr>
              <td>
                <a href={nodeHref(r.path)}><Name name={r.title} /></a>
                <span class="sub">{dotted([kindLabel(r), stateLabel(r), r.last_post && <>{fillx(w.profile.lastPost, { when: <Ago at={r.last_post} now={now} /> })}</>])}</span>
              </td>
              <td class="n"><Imp figures={r.figures} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <div class="in"><p class="note">{w.profile.nothingYet}</p></div>
    )}
    {!all && rows.length > SHOWN && <div class="in more"><a href={`/@${handle}?all=1`}>{fill(w.profile.showAllCount, { n: total })}</a></div>}
  </div>
)

const Created: FC<{ rows: CreatedRow[]; all: boolean; more: boolean; handle: string }> = ({ rows, all, more, handle }) => (
  <div class="box">
    <h2>{w.profile.created} <span>{w.profile.createdKey}</span></h2>
    {rows.length ? (
      <ul class="made">
        {(all ? rows : rows.slice(0, SHOWN)).map(r => {
          const b = badge(r)
          return (
            <li>
              <div>
                <a href={nodeHref(r.path)}><Name name={r.title} /></a>
                <div class="sub">{dotted([kindLabel(r, true), <>{fillx(w.profile.doneWhen, { text: <Text inline text={r.done_when} /> })}</>])}</div>
              </div>
              <span class={b.cls}>{b.text}</span>
            </li>
          )
        })}
      </ul>
    ) : (
      <div class="in"><p class="note">{w.profile.nothingYet}</p></div>
    )}
    {!all && rows.length > SHOWN && <div class="in more"><a href={`/@${handle}?all=1`}>{fill(w.profile.showAllCount, { n: more ? `${rows.length}+` : rows.length })}</a></div>}
  </div>
)

function postLabel(p: NamePost): string {
  if (p.kind === 'submission') return fill(w.profile.postSubmission, { n: p.number ?? '?' })
  if (p.kind === 'check') {
    const what = p.verdict === 'pass' ? w.profile.verdictPass : p.verdict === 'fail' ? w.profile.verdictFail : w.profile.postCheck
    return p.on_number ? fill(w.profile.postCheckOn, { what, n: p.on_number }) : what
  }
  if (p.kind === 'repro') return w.profile.postRepro
  if (p.kind === 'dead_end') return w.profile.deadEnd
  return p.reply_to ? w.profile.postReply : ''
}

const NamePosts: FC<{ handle: string; name: string; posts: NamePost[]; next: string | null; now: number }> = ({ handle, name, posts, next, now }) => (
  <>
    <div class="box posts">
      <h2>{w.profile.posts} <span>{fillx(w.profile.postsBy, { name: <Name name={name} /> })}</span></h2>
      {posts.length ? (
        posts.map(p => {
          const label = postLabel(p)
          return (
            <div class={p.kind === 'submission' ? 'c subm' : 'c'}>
              {/* Thread posts carry their id as an anchor (node-page.tsx PostView). OPEN: a post past the thread's
                  first page isn't on the page the link opens. */}
              <div class="who">
                <b><Name name={name} /></b>
                {label && <span class={p.kind === 'check' && p.verdict === 'fail' ? 'sb x' : 'sb'}>{label}</span>}
                {' · '}<a href={`${nodeHref(p.path)}#${p.id}`}><Name name={p.title} /></a>{' · '}<Ago at={p.created_at} now={now} />
              </div>
              <Text text={p.text} />
            </div>
          )
        })
      ) : (
        <p class="note empty">{fillx(w.profile.noPostsFrom, { name: <Name name={name} /> })}</p>
      )}
      {next && <div class="in more"><a href={`/@${handle}?as=${encodeURIComponent(name)}&before=${encodeURIComponent(next)}`}>{w.profile.olderPosts}</a></div>}
    </div>
    <p class="back"><a href={`/@${handle}`}>{fill(w.profile.backToHandle, { handle })}</a></p>
  </>
)

const LookUp: FC<{ handle: string; value: string; error?: string }> = ({ handle, value, error }) => (
  <div class="box lookup">
    <h2>{w.profile.lookUp}</h2>
    <div class="in">
      <form method="get" action={`/@${handle}`} role="search">
        <div class="path-in"><input name="as" value={value} placeholder={`@${handle}/…`} aria-label={w.profile.lookUpField} autocomplete="off" spellcheck={false} /></div>
      </form>
      {error && <p class="err" role="alert">{error}</p>}
      <p class="note">{fill(w.profile.lookUpNote, { handle })}</p>
    </div>
  </div>
)

// ---------- the owner's inbox (go-live 6.1) ----------

/** A refused inline reply: shown under its item, with the draft kept. */
export type ReplyFlash = { item: number; text: string; draft: string }

/** The owner's inbox: the items, whether there are more, the newest id ("mark all read" stops there), each thread's reply pace. */
export type InboxView = { items: InboxItem[]; more: boolean; upto: number; limits: Map<number, { left: number; wait: number }>; flash?: ReplyFlash }

/** A sign-off item's words, after its link and who submitted. As the mockup while there were checks before the author's. */
function signOffWords(i: InboxItem): string {
  // OPEN (#83): no mockup draws an author-only item, the operator's, or the operator's once the author is back (#75); their words wait on Myra's yes.
  if (i.operator) return i.others ? w.profile.signOffOperatorChecked : w.profile.signOffOperator
  if (i.theirs) return i.others ? w.profile.signOffTheirsChecked : w.profile.signOffTheirs
  return i.others ? w.profile.signOffYoursChecked : w.profile.signOffYours
}

/** A small form in an item's action line: mark it read or unread, or mark all read. One submit per click (static/js/node.js). */
const InboxAct: FC<{ action: string; token: string; act: string; fields?: Record<string, string | number>; label: string }> = ({ action, token, act, fields, label }) => (
  <form method="post" action={action} class="inbox-act">
    <input type="hidden" name="form_token" value={token} />
    <input type="hidden" name="do" value={act} />
    {Object.entries(fields ?? {}).map(([k, v]) => <input type="hidden" name={k} value={String(v)} />)}
    <button type="submit">{label}</button>
  </form>
)

/**
 * "reply" on a mention: posts as the bare handle, as a reply to the post that named them, in its thread (the pace
 * limit is that thread's). No script needed: a details box, open again with the reason and the draft after a refusal.
 */
const Reply: FC<{ i: InboxItem; handle: string; action: string; token: string; limit?: { left: number; wait: number }; flash?: ReplyFlash }> = ({ i, handle, action, token, limit, flash }) => (
  <details class="rep" open={flash ? true : undefined}>
    <summary>{w.profile.reply}</summary>
    <form method="post" action={action} class="rbox inbox-act">
      <input type="hidden" name="form_token" value={token} />
      <input type="hidden" name="do" value="reply" />
      <input type="hidden" name="item" value={String(i.id)} />
      <textarea name="text" required maxlength={MAX_TEXT} aria-label={i.as_name ? fill(w.profile.replyTo, { name: i.as_name }) : w.profile.replyToPost} placeholder={fill(w.profile.replyAs, { handle })}>{flash?.draft ?? ''}</textarea>
      {flash && <p class="err" role="alert">{flash.text}</p>}
      <div class="rrow">
        <span class="note">{limitLine(limit)}</span>
        <button class="btn plain" type="submit">{w.profile.replyPost}</button>
      </div>
    </form>
  </details>
)

const InboxEntry: FC<{ i: InboxItem; inbox: InboxView; handle: string; action: string; token: string; now: number }> = ({ i, inbox, handle, action, token, now }) => {
  const isNew = !i.read && <span class="newb">{w.profile.newBadge}</span>
  const toggle = <InboxAct action={action} token={token} act={i.read ? 'unread' : 'read'} fields={{ item: i.id }} label={i.read ? w.profile.markUnread : w.profile.markRead} />
  const cls = ['c', !i.read && 'new', i.kind === 'sign_off' && 'signoff'].filter(Boolean).join(' ')
  if (i.kind === 'sign_off') {
    // The pill is the submission's state now; the item itself has no pass or fail (the author decides on the submission page).
    const pill = pillOf(i.status ?? 'in_review', i.waiting, !i.theirs, i.reopened)
    return (
      <div class={cls} id={`i${i.id}`}>
        <div class="who"><PillView p={pill} />{isNew} · <Ago at={i.created_at} now={now} /></div>
        <a href={i.href}><b>{fillx(w.profile.signOffTitle, { title: i.title ? <Name name={i.title} /> : w.profile.aShwarm, n: i.number ?? '?' })}</b></a>
        {i.as_name && <>{fillx(w.profile.signOffBy, { name: <Name name={i.as_name} /> })}</>} {signOffWords(i)}
        <div class="acts"><a href={i.href}>{w.profile.open}</a> · {toggle}</div>
      </div>
    )
  }
  if (i.kind === 'mention')
    return (
      <div class={cls} id={`i${i.id}`}>
        <div class="who">
          {i.as_name && <b><Name name={i.as_name} link /></b>}{isNew} · <Ago at={i.created_at} now={now} />
          {i.path && i.title && <> · <a href={nodeHref(i.path)}><Name name={i.title} /></a></>}
        </div>
        {/* OPEN (#83): a long post shows its first 400 characters here, on one line; "see thread" has the rest. */}
        <Text text={cut(i.post_text ?? '', 400)} addressed />
        <div class="acts">
          {/* An ended thread is locked (decided Oct 9): no reply box on it, as on its page. */}
          <a href={i.href}>{w.profile.seeThread}</a>
          {!i.locked && <> · <Reply i={i} handle={handle} action={action} token={token} limit={i.node_id === null ? undefined : inbox.limits.get(i.node_id)} flash={inbox.flash?.item === i.id ? inbox.flash : undefined} /></>} · {toggle}
        </div>
        {/* a reply sent from a page drawn before it ended: the refusal shows under the item */}
        {i.locked && inbox.flash?.item === i.id && <p class="err" role="alert">{inbox.flash.text}</p>}
      </div>
    )
  // A system item (table B): core's words about a node they're in. No reply.
  return (
    <div class={cls} id={`i${i.id}`}>
      <div class="who"><Ago at={i.created_at} now={now} />{isNew}</div>
      <div class="txt"><Plain text={i.text} /></div>
      <div class="acts"><a href={i.href}>{w.profile.open}</a> · {toggle}</div>
    </div>
  )
}

/**
 * The private inbox (PROF-5), in the sidebar as the mockup: "N new" (the strip's count, so the two always agree) and
 * "mark all read", then the items, newest first. Only rendered for the signed-in owner.
 */
const Inbox: FC<{ inbox: InboxView; handle: string; all: boolean; now: number }> = ({ inbox, handle, all, now }) => {
  const viewer = useContext(PageContext).viewer
  const unread = viewer?.unread ?? 0
  const token = viewer?.token ?? ''
  const action = `/@${handle}${all ? '?all=1' : ''}`
  return (
    <div class="box inbox">
      <h2 id="addressed">{w.profile.inbox} <span>{w.profile.inboxOnlyYou}</span></h2>
      <div class="abar">
        <span id="newcount">{unread ? fill(w.profile.newCount, { n: unread >= UNREAD_CAP ? '99+' : unread }) : w.profile.allRead}</span>
        {unread > 0 && <InboxAct action={action} token={token} act="all_read" fields={{ upto: inbox.upto }} label={w.profile.markAllRead} />}
      </div>
      {inbox.items.map(i => <InboxEntry i={i} inbox={inbox} handle={handle} action={action} token={token} now={now} />)}
      {!inbox.items.length && <div class="in"><p class="note">{w.profile.nothingYet}</p></div>}
      {inbox.more && <div class="in more">{all ? fill(w.profile.showingNewest, { n: inbox.items.length }) : <a href={`/@${handle}?all=1#addressed`}>{w.profile.showAll}</a>}</div>}
    </div>
  )
}

type View = {
  person: Person
  profile: Profile
  all: boolean
  now: number
  name?: { name: string; value: string; error?: string; posts: NamePost[]; next: string | null }
  inbox?: InboxView // the owner's own, signed in
  account?: AccountView // the owner's account modal, open or not
}

export const ProfilePage: FC<View> = ({ person, profile, all, now, name, inbox, account }) => (
  <Layout title={fill(w.profile.pageTitle, { handle: person.handle })}>
    <link rel="stylesheet" href="/css/profile.css" />
    <WhoHead person={person} head={profile.head} now={now} owner={!!account} />
    <div class="grid">
      <main id="main" tabindex={-1}>
        {name && !name.error ? (
          <NamePosts handle={person.handle} name={name.name} posts={name.posts} next={name.next} now={now} />
        ) : (
          <>
            <WorkingOn rows={profile.working} all={all} handle={person.handle} now={now} total={profile.head.workingMore ? `${profile.working.length}+` : String(profile.working.length)} />
            <Created rows={profile.created} all={all} more={profile.createdMore} handle={person.handle} />
          </>
        )}
      </main>
      <aside>
        {/* OPEN: profile sidebars have no agent resources card (CHROME-6: keys and profile are human-only pages). */}
        {inbox && <Inbox inbox={inbox} handle={person.handle} all={all} now={now} />}
        <LookUp handle={person.handle} value={name?.value ?? ''} error={name?.error} />
      </aside>
    </div>
    {account && <AccountModal v={account} />}
    {inbox && <script src="/js/node.js" defer></script>}
    {account && <script src="/js/account.js" defer></script>}
  </Layout>
)

/** A closed or suspended account: no head figures, lists or about, only the handle and one line. */
export const Tombstone: FC<{ handle: string; text: string }> = ({ handle, text }) => (
  <Layout title={fill(w.profile.pageTitle, { handle })}>
    <link rel="stylesheet" href="/css/profile.css" />
    <section id="main" tabindex={-1} class="who-head tomb">
      <div>
        <h1 class="path"><Name name={`@${handle}`} /></h1>
        <p class="about">{text}</p>
      </div>
    </section>
  </Layout>
)

/** Nobody has this handle (or the account isn't verified yet). */
export const NoOne: FC<{ handle: string | null }> = ({ handle }) => (
  <Layout title={w.profile.notFoundTitle}>
    <link rel="stylesheet" href="/css/profile.css" />
    <section id="main" tabindex={-1} class="who-head tomb">
      <div>
        <h1 class="path">{handle ? <Name name={`@${handle}`} /> : w.profile.notFound}</h1>
        <p class="about">{w.profile.nobody}</p>
      </div>
    </section>
  </Layout>
)

// ---------- the name in ?as= ----------

/**
 * What someone typed in the look-up box, as a full name: "m-04" and "@myra/m-04/" both mean @myra/m-04.
 * Returns the name, or why it isn't one.
 */
export function lookUpName(raw: string, handle: string): { name: string } | { error: string } {
  let s = raw.trim().toLowerCase().replace(/\/+$/, '')
  if (!s) return { error: fill(w.profile.lookUpEmpty, { handle }) }
  if (!s.startsWith('@')) s = `@${handle}/${s}`
  if (!isValidName(s)) return { error: fill(w.profile.lookUpBad, { handle }) }
  return { name: s }
}

// ---------- routes ----------

// Reading pages are off on production in holding mode and public in beta (go-live 3.10); core/site-mode.ts.
import { readingOpen } from '../core/site-mode'
export { readingOpen }

export const profile = new Hono<{ Bindings: Env }>()

/** A profile that can't show: the page for browsers, one line of text or JSON for agents that ask (go-live 3.8). Never cached, like sendError.
 *  `text` is the agents' line, so it stays here in code; the page has its own words (w.profile). */
function cannot(c: Context<{ Bindings: Env }>, status: ErrorStatus, node: Child, text: string) {
  if (formatFor(c) !== 'html') return sendError(c, { status, text })
  c.header('Cache-Control', 'no-store')
  return page(c, node, status)
}
const NOBODY = 'nobody goes by that handle here.'

profile.get('/:at{@[A-Za-z0-9_]+}', async c => {
  if (!readingOpen(c.env)) return c.notFound()
  if (c.env.SITE_MODE !== 'open') c.header('X-Robots-Tag', 'noindex')
  const capped = overReadCap(c)
  if (capped) return capped
  const url = new URL(c.req.url)
  const handle = c.req.param('at').slice(1)
  if (handle !== handle.toLowerCase()) return c.redirect(`/@${handle.toLowerCase()}${url.search}`, 301)
  if (!HANDLE_RE.test(handle)) return cannot(c, 404, <NoOne handle={null} />, NOBODY)

  const person = await findPerson(c.env.DB, handle)
  if (!person || !person.verified) return cannot(c, 404, <NoOne handle={handle} />, NOBODY)
  // Closing detaches the handle and keeps the work (table B #60): the posts stay in their threads; the page goes.
  if (person.status === 'closed') {
    return cannot(c, 410, <Tombstone handle={handle} text={w.profile.closed} />, 'this account was closed. what it posted stays in the threads.')
  }
  // OPEN: a suspension's public tombstone with its reason comes with the moderation log (8.5); for now, one line.
  if (person.status === 'suspended') return cannot(c, 403, <Tombstone handle={handle} text={w.profile.suspended} />, 'this account is suspended.')

  return profileView(c, person, url, (await sessionOf(c))?.personId === person.id)
})

/**
 * The profile as `url` asks for it (the name view, ?all=1), with the owner's inbox when `owner`. Also the page for a
 * refused inline reply, with the reason under its item and the draft kept (`flash`).
 */
async function profileView(
  c: Context<{ Bindings: Env }>,
  person: Person,
  url: URL,
  owner: boolean,
  flash?: ReplyFlash,
  status: 200 | 400 | 429 = 200,
  accountFlash?: AccountFlash,
) {
  const now = Date.now()
  const handle = person.handle
  const all = url.searchParams.get('all') === '1'
  const asRaw = url.searchParams.get('as')
  let name: View['name']
  let posts: ReturnType<typeof readNamePosts> | undefined
  if (asRaw !== null) {
    const n = lookUpName(asRaw, handle)
    if ('error' in n) name = { name: '', value: asRaw.slice(0, 200), error: n.error, posts: [], next: null }
    else {
      const owned = n.name.slice(1).split('/')[0]
      // A name under someone else: their profile is where its posts are.
      if (owned !== handle) return c.redirect(`/@${owned}?${new URLSearchParams({ as: n.name })}`, 302)
      name = { name: n.name, value: n.name, posts: [], next: null }
      posts = readNamePosts(c.env.DB, person.id, n.name, url.searchParams.get('before'))
    }
  }
  const [prof, found, inbox, account] = await Promise.all([
    readProfile(c.env.DB, person.id, { owner, now }),
    posts,
    owner ? ownInbox(c.env.DB, person.id, all, now) : undefined,
    owner ? ownAccount(c, person.id, url, now, accountFlash) : undefined,
  ])
  if (name && found) Object.assign(name, found)
  if (inbox) inbox.flash = flash
  return page(c, <ProfilePage person={person} profile={prof} all={all} now={now} name={name} inbox={inbox} account={account} />, name?.error ? 400 : status)
}

/** The owner's inbox, and the reply pace in each thread a mention is in (one read for all of them). */
async function ownInbox(db: D1Database, personId: number, all: boolean, now: number): Promise<InboxView> {
  const box = await readInbox(db, personId, { all, max: LIST_MAX })
  const threads = box.items.filter(i => i.kind === 'mention' && i.node_id !== null).map(i => i.node_id as number)
  return { ...box, limits: await peekThreadTokensMany(db, personId, threads, now) }
}

/** The owner's account modal (6.2): open on ?account= (no script needed) or after a refused form, with what ?account= says. */
async function ownAccount(c: Context<{ Bindings: Env }>, personId: number, url: URL, now: number, flash?: AccountFlash): Promise<AccountView | undefined> {
  const [session, account] = await Promise.all([sessionOf(c), readAccount(c.env.DB, personId, now)])
  if (!session || !account) return undefined
  const asked = url.searchParams.get('account')
  return { account, open: asked !== null || flash !== undefined, steppedUp: stepUpOpen(session, now), status: flash ? undefined : accountStatus(asked), flash }
}

/** An inbox item id from a form field, or null. */
const itemId = (v: string | undefined) => (/^[1-9]\d{0,15}$/.test(v ?? '') ? Number(v) : null)

/**
 * POST /@handle: the owner's inbox forms, picked by `do`. read, unread: one item. all_read: every unread item up to the
 * newest one the page showed (`upto`). reply: an inline reply to a mention, run in its tree as a post with reply_to,
 * which reads the item and lands on the reply in its thread; a refusal re-renders the profile with the reason under
 * the item and the draft kept. Signed out, it goes to sign-in and back; anyone but the owner is refused.
 */
profile.post('/:at{@[A-Za-z0-9_]+}', async c => {
  if (!readingOpen(c.env)) return c.notFound()
  const url = new URL(c.req.url)
  const handle = c.req.param('at').slice(1).toLowerCase()
  const back = `/@${handle}${url.searchParams.get('all') === '1' ? '?all=1' : ''}`
  const visitor = await who(c as unknown as AuthContext)
  if (!visitor.session) return c.redirect(signInHref(`/@${handle}`), 303)
  const f = await formOf(c)
  if (!(await postedTokenOk(c as unknown as AuthContext, visitor, f))) return sendError(c, { status: 403, heading: w.auth.formExpired, text: w.auth.formExpiredRetry }, 'html')
  // Nobody acts on someone else's inbox or account.
  if (visitor.session.handle !== handle || !visitor.session.verified) return sendError(c, { status: 403 }, 'html')
  const s = visitor.session
  const db = c.env.DB
  const at = new Date().toISOString()
  if (f.do === 'read' || f.do === 'unread') {
    const id = itemId(f.item)
    if (id === null) return sendError(c, { status: 400 }, 'html')
    await markRead(db, s.personId, id, f.do === 'read', at)
    return c.redirect(`${back}#i${id}`, 303)
  }
  if (f.do === 'all_read') {
    const upto = itemId(f.upto)
    if (upto === null) return sendError(c, { status: 400 }, 'html')
    await markAllRead(db, s.personId, upto, at)
    return c.redirect(`${back}#addressed`, 303)
  }
  if (f.do === 'reply') return reply(c, s, url, f)
  if (f.do === 'account' || f.do === 'password') return accountForm(c, s, f.do, f)
  if (f.do === 'export') return exportData(c, s, f)
  if (f.do === 'close') return closeForm(c, s, f)
  if (f.do === 'signout_all') {
    // Every session ends, this one too (sign-in's notice says so). No password: it can only sign the person out.
    // OPEN (#84): "every other browser only" is the other choice.
    await endAllSessions(db, s.personId)
    c.header('Set-Cookie', clearCookie(), { append: true })
    return c.redirect('/signin?done=everywhere', 303)
  }
  return sendError(c, { status: 400, text: w.auth.unknownForm }, 'html')
})

/**
 * The account modal's save and change password (6.2), both behind the password step-up (A5), asked inline as the
 * sign-off does. Each form is checked first, so a draft with a mistake doesn't spend the password; a refusal re-renders
 * the profile with the modal open, the reason at its field and the draft kept (never the passwords).
 */
async function accountForm(c: Context<{ Bindings: Env }>, s: Session, act: 'account' | 'password', f: AccountForm) {
  const db = c.env.DB
  const person = await findPerson(db, s.handle)
  const cur = await readAccount(db, s.personId)
  if (!person || !cur) return sendError(c, { status: 404 }, 'html')
  const at = act === 'account' ? 'save' : 'password'
  const values = act === 'account' ? Object.fromEntries(Object.entries(f).filter(([k]) => !/password|form_token/.test(k))) : undefined
  const refuse = (flash: Omit<AccountFlash, 'at' | 'values'>, status: 400 | 429 = 400) =>
    profileView(c, person, new URL(`/@${s.handle}`, c.req.url), true, undefined, status, { at, values, ...flash })
  const now = Date.now()
  const me = { id: s.personId, handle: s.handle, email: cur.email, prefs: cur.prefs }
  const checked = act === 'account' ? await checkAccount(db, f, me) : null
  if (checked && 'errors' in checked) return refuse({ errors: checked.errors })
  const pwErrors = act === 'password' ? await checkNewPassword(f) : null
  if (pwErrors) return refuse({ errors: pwErrors })
  const up = await inlineStepUp(db, c.env.PASSWORD_PEPPER, s, f.password, clientIp(c), now)
  if ('refuse' in up) {
    if (up.wait) c.header('Retry-After', String(up.wait))
    return refuse({ error: up.refuse }, up.status)
  }
  if (checked) {
    // Each email change mails an address the account picks, so it has a pace of its own (counted once the password is in).
    const wait = checked.save.email ? await bump(db, `emailchange:person:${s.personId}`, LIMITS.emailChangePerson, now) : 0
    if (wait) {
      c.header('Retry-After', String(wait))
      // OPEN (#84): new words.
      return refuse({ errors: { email: fill(w.profile.emailChangesWait, { wait: waitText(wait) }) } }, 429)
    }
    await saveAccount(db, me, checked.save, now)
    return c.redirect(`/@${s.handle}?account=saved`, 303)
  }
  await setPassword(db, c.env.PASSWORD_PEPPER, s.personId, f.new_password ?? '', { keepSession: s.id, now })
  return c.redirect(`/@${s.handle}?account=password`, 303)
}

/** The modal again, open, with the reason at the form that was refused (export or close). */
async function refuseIn(c: Context<{ Bindings: Env }>, s: Session, flash: AccountFlash, status: 400 | 429 = 400) {
  const person = await findPerson(c.env.DB, s.handle)
  if (!person) return sendError(c, { status: 404 }, 'html')
  return profileView(c, person, new URL(`/@${s.handle}`, c.req.url), true, undefined, status, flash)
}

/**
 * "download your data" (6.4): everything held about them as one JSON file (read/export.ts), behind the password
 * step-up (A5), at most 5 an hour. Never cached. A refusal comes back in the modal, under the button.
 */
async function exportData(c: Context<{ Bindings: Env }>, s: Session, f: AccountForm) {
  const db = c.env.DB
  const now = Date.now()
  const up = await inlineStepUp(db, c.env.PASSWORD_PEPPER, s, f.password, clientIp(c), now)
  if ('refuse' in up) {
    if (up.wait) c.header('Retry-After', String(up.wait))
    return refuseIn(c, s, { at: 'export', error: up.refuse }, up.status)
  }
  const wait = await bump(db, `export:person:${s.personId}`, LIMITS.exportPerson, now)
  if (wait) {
    c.header('Retry-After', String(wait))
    // OPEN (#86): new words.
    return refuseIn(c, s, { at: 'export', error: fill(w.profile.downloadsWait, { wait: waitText(wait) }) }, 429)
  }
  const data = await readExport(db, s.personId, now)
  if (!data) return sendError(c, { status: 404 }, 'html')
  return c.body(JSON.stringify(data, null, 2) + '\n', 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="shwarm-${s.handle}-${new Date(now).toISOString().slice(0, 10)}.json"`,
    'Cache-Control': 'no-store',
  })
}

/**
 * "close my account" (6.4): the handle typed out, then the password step-up, then auth/close.ts closes it in one batch
 * and this browser's cookie goes too. It lands on the profile, which now says the account was closed.
 */
async function closeForm(c: Context<{ Bindings: Env }>, s: Session, f: AccountForm) {
  // OPEN (#86): new words.
  if (!confirmsHandle(f.confirm, s.handle)) return refuseIn(c, s, { at: 'close', errors: { confirm: fill(w.profile.closeConfirm, { handle: s.handle }) } })
  const now = Date.now()
  const up = await inlineStepUp(c.env.DB, c.env.PASSWORD_PEPPER, s, f.password, clientIp(c), now)
  if ('refuse' in up) {
    if (up.wait) c.header('Retry-After', String(up.wait))
    return refuseIn(c, s, { at: 'close', error: up.refuse }, up.status)
  }
  await closeAccount(c.env.DB, s.personId, now)
  c.header('Set-Cookie', clearCookie(), { append: true })
  return c.redirect(`/@${s.handle}`, 303)
}

async function reply(c: Context<{ Bindings: Env }>, s: Session, url: URL, f: Record<string, string>) {
  const db = c.env.DB
  const id = itemId(f.item)
  const target = id === null ? null : await readReplyTarget(db, s.personId, id)
  // An item that isn't theirs, isn't a mention, or no longer shows (its post deleted or hidden).
  if (id === null || !target) return sendError(c, { status: 404 }, 'html')
  const person = await findPerson(db, s.handle)
  if (!person) return sendError(c, { status: 404 }, 'html')
  const draft = f.text ?? ''
  const refuse = (text: string, status: 400 | 429 = 400) => profileView(c, person, url, true, { item: id, text, draft }, status)
  const text = draft.trim()
  if (!text) return refuse(w.profile.writeFirst)
  const actor = siteActor({ id: s.personId, handle: s.handle })
  const now = Date.now()
  const to = threadHref(target.path, target)
  const dup = await justPosted(db, { nodeId: target.node_id, personId: s.personId, as: actor.as, text, now, replyTo: target.post_id })
  // OPEN (#83): replying reads the item, as "mark read" would.
  if (dup) {
    await markRead(db, s.personId, id, true, new Date(now).toISOString())
    return c.redirect(`${to}#${dup}`, 303)
  }
  try {
    const r = await runInTree<{ id: string }>(c.env.TREE, { type: 'post', actor, input: { node: target.path, text, replyTo: target.post_id } })
    await markRead(db, s.personId, id, true, new Date(now).toISOString())
    return c.redirect(`${to}#${r.id}`, 303)
  } catch (e) {
    if (!(e instanceof ShwarmError)) throw e
    if (e.code === 'rate_limited') {
      const wait = Number(e.details.retry_after) || 60
      c.header('Retry-After', String(wait))
      return refuse(fill(w.profile.replySlowDown, { wait: waitText(wait) }), 429)
    }
    return refuse(e.message.replace(/\.?$/, '.'))
  }
}
