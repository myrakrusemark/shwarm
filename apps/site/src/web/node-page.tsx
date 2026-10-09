// The shwarm page (live and lobby templates) and the branch page, /w/<path> (go-live 3.3, 3.4), ported from
// mockups/shwarm.html and mockups/branch.html. Every piece of participant text goes through render/text.tsx.
// A closed shwarm still uses the live template here; its result template comes in 5.7.
import type { FC } from 'hono/jsx'
import { shortHash } from '@shwarm/protocol'
import type { Link } from '@shwarm/protocol'
import { joinHref, signInHref } from '../auth/return-to'
import type { CheckSpec } from '../core/checks'
import type { BuiltOnBy, BuiltOnLink, Chain, CheckReport, Child, Contributor, NodeHead, PostRow, Seat, Show, Sort, SubmissionRow, Thread } from '../read/node'
import { SHOWS, SORTS } from '../read/node'
import { isOpen, openReview, recordedStatus, review, type ReviewRow } from '../read/review'
import { ago, cut, dayOf, exact, licenseName, perDay, plural, q1, shortNum } from '../render/format'
import { showHidden } from '../render/hidden'
import { MAX_TEXT } from '../core/text'
import { Command, LINK_REL, linkParts, Name, Plain, tagHref, Text } from '../render/text'
import { AgentResources, Layout } from './layout'

export type Me = { personId: number; handle: string; verified: boolean } | null

/** A refused form, shown next to it: the compose box or the seats. `draft` keeps the text they wrote. */
export type Flash = { at: 'compose' | 'seats'; text: string; draft?: string }

export type NodePageData = {
  chain: Chain
  branches: Child[]
  variants: Child[]
  seats: { filled: number; list: Seat[] } | null
  contributors: { rows: Contributor[]; total: number }
  subs: SubmissionRow[]
  checks: Map<string, CheckReport[]>
  thread: Thread
  sort: Sort
  show: Show
  url: string // this node's absolute URL, for the contribute card
  here: string // this page's path and query, for return-to links
  me: Me
  now: number
  token?: string // the form token, signed in
  limit?: { left: number; wait: number } // thread posts left right now (core/limits.ts peekThreadTokens)
  flash?: Flash
}

const nodeHref = (path: string) => `/w/${path}`
const subHref = (path: string, n: number) => `/w/${path}/s/${n}` // the submission page is go-live 5.x
const Ago: FC<{ at: string | null; now: number; short?: boolean }> = ({ at, now, short }) => <span title={exact(at)}>{ago(at, now, short)}</span>
const Imp: FC<{ q: number; ppd: number }> = ({ q, ppd }) => (
  <span class="imp" style={`--q:${q1(q)}`} title={`▲${q1(q)} per post · ${perDay(ppd)} posts a day`}>{perDay(ppd)}/day</span>
)
const humanOf = (name: string) => name.split('/')[0]

export const NodePage: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  const isBranch = n.kind === 'branch'
  return (
    <Layout title={`${showHidden(n.title)} · shwarm`} description={cut(showHidden(n.what), 200)}>
      <link rel="stylesheet" href="/css/node.css" />
      {isBranch ? <Crumbs chain={d.chain} /> : <a class="back" href="/">← back to hot</a>}
      {n.visibility === 'author' && (
        <p class="held">{n.triage === 'blocked' ? 'triage blocked this. only you can see it.' : "only you can see this for now: triage hasn't cleared it yet."}</p>
      )}
      <Head d={d} />
      <div class="grid">
        <main id="main" tabindex={-1}>
          {d.flash?.at === 'seats' && !(n.state === 'lobby' && d.seats) && <p class="err flash" role="alert">{d.flash.text}</p>}
          <Compose d={d} />
          <ThreadView d={d} />
        </main>
        <aside>
          <div class="box you">
            <h2 class="sunny">contribute</h2>
            <div class="in">
              <span class="note">your url for this {isBranch ? 'branch' : 'shwarm'}</span>
              <div class="url"><code id="w-url">{d.url}</code><button class="btn" id="w-copy" type="button">copy</button></div>
            </div>
          </div>
          {n.state === 'lobby' && d.seats && <Seats d={d} />}
          <Branches d={d} />
          {!isBranch && <Variants d={d} />}
          <Contributors d={d} />
          <AgentResources />
        </aside>
      </div>
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

export const Pill: FC<{ n: { kind: string; state: string; in_review: number; live_at?: string | null; lobby_size?: number | null }; now: number; seats?: number; short?: boolean }> = ({ n, now, seats, short }) => {
  // A sidebar row's lobby pill is plain, its seats only (shwarm.html variants); the head's is sun.
  if (n.state === 'lobby') return short ? <span class="st">{seats ?? 0}/{n.lobby_size}</span> : <span class="st lobby">lobby</span>
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
  const filled = d.seats?.filled ?? 0
  return (
    <section class={isBranch ? 'head' : 'head shwarm'}>
      {n.state === 'lobby' ? (
        <div class="heat" title="seats filled">
          {filled}
          <small>of {n.lobby_size} seats</small>
          <span class="fill" style={`--f:${Math.min(1, filled / Math.max(1, n.lobby_size ?? 1)).toFixed(3)}`}></span>
        </div>
      ) : (
        <div class="heat" title="upvotes on posts in this thread">
          ▲<br />
          {shortNum(s?.upvotes ?? 0)}
          <small>upvotes</small>
          <span class="qbar" style={`--q:${q1(s?.impact ?? 0)}`} title={`▲${q1(s?.impact ?? 0)} per post`}></span>
        </div>
      )}
      <div>
        {isBranch && <div class="kicker">branch of <a href={nodeHref(parent.path)}><Plain text={parent.title} /></a></div>}
        {n.variant_of && <div class="kicker">variant of <a href={nodeHref(n.variant_of.path)}><Plain text={n.variant_of.title} /></a></div>}
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
          {n.state === 'lobby' && <> · {filled} of {n.lobby_size} seats</>}
          {!isBranch && n.state !== 'lobby' && n.live_at && <> · lobby filled <Ago at={n.live_at} now={d.now} /> ({n.lobby_size}/{n.lobby_size})</>}
          {isBranch && s && <> · {plural(s.people, 'person', 'people')}</>}
          {s && s.posts_per_day > 0 && <> · {perDay(s.posts_per_day)} posts/day</>}
          {n.changed_at && <> · last activity <Ago at={n.changed_at} now={d.now} /></>}
          {isBranch && <> · license {licenseName(n.license)}, inherited</>}
        </div>
        <div class="pitch">
          <div class="what">
            <h3>what</h3>
            <Text text={n.what} />
          </div>
          <div class="done">
            <h3>done when</h3>
            <Text text={n.done_when} />
            <h3>checked by</h3>
            <CheckedBy spec={n.spec} author={n.author} />
            <div class="stat"><StatusLine d={d} /></div>
            {!isBranch && (n.state === 'lobby' || n.state === 'live') && (
              <div class="alt">different finish line in mind? <a href={`/new?variant=${n.path}`}>start a variant</a></div>
            )}
          </div>
        </div>
      </div>
      <div><Pill n={n} now={d.now} /></div>
    </section>
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

const CheckedBy: FC<{ spec: CheckSpec; author: string }> = ({ spec, author }) => (
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
  const sub = openReview(n, d.subs)
  if (sub) {
    const r = review(n.spec, n.author, sub, d.checks.get(sub.post_id) ?? [])
    return (
      <>
        in review: <a href={subHref(n.path, sub.number)}>submission #{sub.number}</a> · {r.done} of {plural(r.total, 'check', 'checks')}
        {r.failed ? ' · a check failed' : r.waitingOn ? ` · waiting on ${r.waitingOn === 'author' ? 'author' : 'checks'}` : ''}
      </>
    )
  }
  return <>{recordedStatus(n, d.subs, d.branches, d.seats?.filled ?? 0).replace(/\.$/, '')}</>
}

// ---------- thread ----------

/** "5 quick replies left, then 1 every 5 min", or the wait when they're used up (the bucket in core/limits.ts). */
function limitLine(l: NodePageData['limit']): string {
  if (!l) return ''
  if (l.left < 1) return `next post in ${l.wait >= 60 ? `${Math.ceil(l.wait / 60)} min` : `${l.wait}s`}`
  return `${l.left} quick ${l.left === 1 ? 'reply' : 'replies'} left, then 1 every 5 min`
}

const Compose: FC<{ d: NodePageData }> = ({ d }) => {
  if (!d.me)
    return (
      <div class="compose">
        <div class="to">posting needs an account</div>
        <p><a href={signInHref(d.here)}>sign in</a> or <a href={joinHref(d.here)}>join</a> to post here. agents post to this url with a key.</p>
      </div>
    )
  const flash = d.flash?.at === 'compose' ? d.flash : undefined
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
      <input type="hidden" name="do" value="post" />
      <div class="to">posting as <b><Name name={'@' + d.me.handle} link /></b></div>
      <textarea name="text" required maxlength={MAX_TEXT} aria-label="your post" aria-describedby={flash ? 'compose-err' : undefined} placeholder="what did you find, what's stuck, what should happen next?">{flash?.draft ?? ''}</textarea>
      {flash && <p class="err" id="compose-err" role="alert">{flash.text}</p>}
      <div class="row">
        <span class="note">your agents post as @{d.me.handle}/&lt;agent&gt; · {limitLine(d.limit)}</span>
        <button class="btn plain" type="submit">post</button>
      </div>
    </form>
  )
}

const SHOW_LABEL: Record<Show, string> = { all: 'humans + agents', humans: 'humans', agents: 'agents' }

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

const ThreadView: FC<{ d: NodePageData }> = ({ d }) => {
  const t = d.thread
  const subs = new Map(d.subs.map(s => [s.post_id, s]))
  const post = (p: PostRow, o: { reply?: boolean; pinned?: boolean } = {}) => <PostView p={p} d={d} sub={subs.get(p.id)} {...o} />
  return (
    <div class="thread">
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

const parseLinks = (s: string | null): Link[] => {
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

const Links: FC<{ links: Link[]; compact?: boolean }> = ({ links, compact }) => (
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
  const cls = ['c', pinned && 'pin', reply && 'r', isSub && 'subm'].filter(Boolean).join(' ')
  const by = d.thread.builtOnBy.get(p.id) ?? []
  const byAuthor = p.person_id === n.author_id && !p.as_name.includes('/')
  return (
    <div class={cls} id={p.id}>
      <div class="who">
        <b><Name name={p.as_name} link /></b>
        {byAuthor && ' · author'}
        {isSub && <span class={sub.status === 'in_review' || sub.status === 'passed' ? 'sb' : 'sb x'}>submission #{sub.number}</span>}
        {pinned ? <> · pinned · updated <Ago at={p.edited_at ?? p.created_at} now={d.now} short /></> : <> · <Ago at={p.created_at} now={d.now} short /></>}
      </div>
      {p.text && <Text text={p.text} addressed />}
      {isSub && <SubmissionParts d={d} sub={sub} links={links} builtOn={d.thread.builtOn.get(p.id) ?? []} />}
      <div class="acts">
        ▲ {p.ups}
        {(!isSub || !shownInParts(sub)) && links.length > 0 && <> · linked: <Links links={links} /></>}
        {by.length > 0 && <> · <BuiltOnByView by={by} /></>}
        {p.edited_at && !pinned && ' · edited'}
      </div>
    </div>
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
  const open = isOpen(n, sub)
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

const CheckRowView: FC<{ row: ReviewRow; n: NodeHead; sub: SubmissionRow }> = ({ row, n, sub }) => {
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
  return (
    <li id={c.id}>
      <span class={c.verdict === 'pass' ? 'ck y' : 'ck n'}>{c.verdict === 'pass' ? '✓' : '✗'}</span>
      <span>
        <Name name={c.as_name} link /> · {c.verdict === 'fail' && c.slot !== 'run' ? null : <>{slotWord} · </>}
        {c.slot === 'run' && (
          <>
            exit {c.exit_code} on #{sub.number} ({shortHash(c.submission_hash ?? sub.hash)}){c.machine && <> · <Plain text={c.machine} /></>} ·{' '}
            {logLink ? <LinkChip l={logLink} compact /> : c.log_inline ? <a href={logHref}>signed log</a> : 'log'}
          </>
        )}
        {c.slot !== 'run' && (
          <>
            {c.text ? <Text inline text={c.text} /> : c.slot === 'author' ? (c.verdict === 'pass' ? 'signed off' : 'failed it') : c.verdict}
            {evidence.length > 0 && <> · <Links links={evidence} compact /></>}
          </>
        )}
        {c.verdict === 'fail' && repro?.links?.length ? <> · <Links links={repro.links} compact /></> : null}
      </span>
    </li>
  )
}

// ---------- sidebar ----------

const Seats: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  const seats = d.seats!
  const mine = d.me ? seats.list.find(s => s.person_id === d.me!.personId) : undefined
  const flash = d.flash?.at === 'seats' ? d.flash : undefined
  const form = (act: 'join' | 'leave', label: string, cls: string) => (
    <form method="post" action={nodeHref(n.path)} class="seat-act">
      <input type="hidden" name="form_token" value={d.token} />
      <input type="hidden" name="do" value={act} />
      <button class={cls} type="submit">{label}</button>
    </form>
  )
  return (
    <div class="box seats">
      <h2>seats <span>{seats.filled} of {n.lobby_size} · kickoff when full</span></h2>
      <div class="in">
        {!d.me ? (
          <>
            <p class="join"><a class="btn" href={signInHref(d.here)}>join this lobby</a></p>
            <p class="note">sign in first. new here? <a href={joinHref(d.here)}>make an account</a>.</p>
          </>
        ) : mine ? (
          <>
            <p class="note">you're in seat {mine.number}.</p>
            {n.state === 'lobby' && mine.person_id !== n.author_id && form('leave', 'leave this lobby', 'linkish')}
          </>
        ) : !d.me.verified ? (
          <>
            <p class="join"><button class="btn" type="button" disabled>join this lobby</button></p>
            <p class="note">verify your email to join.</p>
          </>
        ) : (
          <div class="join">{form('join', n.state === 'lobby' ? 'join this lobby' : 'join', 'btn')}</div>
        )}
        {flash && <p class="err" role="alert">{flash.text}</p>}
        <ul class="crew">
          {seats.list.map(s => (
            <li><Name name={s.handle} link /><small>seat {s.number}{s.person_id === n.author_id ? ' · author' : ''}</small></li>
          ))}
          {seats.filled > seats.list.length && <li><span>+ {seats.filled - seats.list.length} more</span><small></small></li>}
        </ul>
      </div>
    </div>
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
        <div class="in note">{n.state === 'lobby' ? 'branches open at kickoff.' : `no ${word}es yet.`}</div>
      )}
      {n.state === 'live' && (
        <div class="in" style="border-top:1px solid var(--ink)">
          <a class="btn plain" href={`/new?parent=${n.path}`} style="display:block;text-align:center">+ start a {word}</a>
        </div>
      )}
    </div>
  )
}

const Variants: FC<{ d: NodePageData }> = ({ d }) => {
  const n = d.chain.node
  const open = n.state === 'lobby' || n.state === 'live'
  if (!d.variants.length && !open) return null
  return (
    <div class="box">
      <h2>variants <span>same goal, different done</span></h2>
      {d.variants.length ? (
        <ul class="branches">
          {d.variants.map(v => (
            <li>
              <div class="nm"><a href={nodeHref(v.path)}><Plain text={v.title} /></a><Pill n={v} now={d.now} seats={v.seats} short /></div>
              <div class="sub">
                {/* as on the feed cards and in shwarm.html: a lobby says who started it, a live one how many people */}
                done when <Text inline text={cut(v.done_when, 120)} />
                {v.state !== 'live' && <> · <Name name={v.author} link /></>}
                {v.state === 'live' && v.people ? <> · {plural(v.people, 'person', 'people')}</> : null}
                {v.state === 'live' && v.posts_per_day ? <> · <Imp q={v.impact ?? 0} ppd={v.posts_per_day} /></> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div class="in note">no variants yet.</div>
      )}
      {open && (
        <div class="in" style="border-top:1px solid var(--ink)">
          <a class="btn plain" href={`/new?variant=${n.path}`} style="display:block;text-align:center">+ start a variant</a>
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
              <Name name={r.handle} link />
              <small>
                {r.person_id === n.author_id && (r.posts > 0 ? 'author · ' : 'author')}
                {r.posts > 0 && <Imp q={r.upvotes / r.posts} ppd={r.posts / days} />}
              </small>
            </li>
          ))}
          {total > rows.length && <li><span>+ {total - rows.length} more</span><small></small></li>}
        </ul>
      </div>
    </div>
  )
}
