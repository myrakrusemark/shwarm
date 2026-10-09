// The public profile and the name view (go-live 3.5, PRD §6.8, mockups/profile.html).
//   /@handle            head (handle, display name, joined, about, links, three figures), working on, created,
//                       and the "look up a name" box
//   /@handle?as=@h/x    the same head, then only that name's posts (not its mentions)
// Profiles are about the human: no agent profiles, no list of names under a person, no agent counts, no passes.
// The private parts of the mockup (the inbox and the account modal) come in phase 6.
// OPEN: the owner sees the same page as everyone else for now, plus their own nodes still being checked in
// "created"; no account button, inbox or "waiting on you" (PROF-9) until phase 6.
import { Hono, type Context } from 'hono'
import type { Child, FC } from 'hono/jsx'
import { HANDLE_RE, isValidName } from '@shwarm/protocol'
import { sessionOf } from '../auth/request'
import { ago } from '../render/ago'
import { exactTime } from '../render/numbers'
import { Name, Text } from '../render/text'
import { impactMark, oneDecimal } from '../read/figures'
import {
  findPerson,
  linksOf,
  readNamePosts,
  readProfile,
  type CreatedRow,
  type Head,
  type NamePost,
  type Person,
  type Profile,
  type WorkingRow,
} from '../read/profile'
import { formatFor, sendError, type ErrorStatus } from './errors'
import { Layout } from './layout'
import { overReadCap } from './read-limit'
import { page } from './viewer'

type Env = { DB: D1Database; ENV: string; SITE_MODE: string; CSRF_SECRET: string }

/** Rows each list shows before "show all". */
export const SHOWN = 25

// ---------- small parts ----------

const nodeHref = (path: string) => `/w/${path}`
/** A relative time with the exact one on hover (go-live 3.8). */
const Ago: FC<{ at: string; now: number }> = ({ at, now }) => <time datetime={at} title={exactTime(at)}>{ago(at, now)}</time>
/** "a · b · c", skipping empty parts. */
const dotted = (parts: (Child | false | null | undefined)[]) =>
  parts.filter(p => p !== false && p !== null && p !== undefined && p !== '').flatMap((p, i) => (i ? [' · ', p] : [p]))

const kindLabel = (r: { kind: string; up_title: string | null }, branchOf = false): Child =>
  r.kind === 'shwarm' ? 'shwarm' : r.up_title === null ? r.kind : (
    <>
      {r.kind === 'variant' ? 'variant of ' : branchOf ? 'branch of ' : ''}
      <Name name={r.up_title} />
    </>
  )

/** The node's state as the profile says it. OPEN (#18): a passed node says "passed" here, "closed" in the feed. */
function stateLabel(r: { state: string; in_review: number; lobby_size: number | null; seats: number | null }): string {
  if (r.state === 'lobby') return `lobby ${r.seats ?? 0}/${r.lobby_size ?? 0}`
  if (r.state === 'closed') return 'passed'
  if (r.state === 'dead_end') return 'dead end'
  return r.in_review ? 'submission in review' : ''
}

function badge(r: CreatedRow): { cls: string; text: string } {
  // Only the owner sees nodes that aren't public yet (A8).
  if (!r.public) return r.triage === 'blocked' ? { cls: 'st dead', text: 'blocked' } : { cls: 'st wait', text: 'being checked' }
  if (r.state === 'lobby') return { cls: 'st', text: `${r.seats ?? 0}/${r.lobby_size ?? 0}` }
  if (r.state === 'closed') return { cls: 'st done', text: 'passed' }
  if (r.state === 'dead_end') return { cls: 'st dead', text: 'dead end' }
  return { cls: 'st live', text: 'live' }
}

const Imp: FC<{ figures: WorkingRow['figures'] }> = ({ figures }) => {
  if (!figures) return null
  const m = impactMark(figures)
  return <span class="imp" style={`--q:${m.q}`} title={m.title}>{m.text}</span>
}

// ---------- the page ----------

const WhoHead: FC<{ person: Person; head: Head; now: number }> = ({ person: p, head, now }) => {
  const links = linksOf(p.links)
  return (
    <section class="who-head">
      <div>
        <h1 class="path"><Name name={`@${p.handle}`} /></h1>
        {/* OPEN: no "verified human" mark at launch; the owner's account button comes with the account modal (phase 6). */}
        <div class="meta">{dotted([p.display_name ? <Name name={p.display_name} /> : null, <>joined <Ago at={p.created_at} now={now} /></>])}</div>
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
        <div>{head.workingMore ? `${head.workingOn}+` : head.workingOn}<small>working on</small></div>
        <div>{head.postsThisWeek}<small>posts this week</small></div>
        <div>
          ▲{head.perPost === null ? '–' : oneDecimal(head.perPost)}
          <small>per post · site avg ▲{head.siteAvg === null ? '–' : oneDecimal(head.siteAvg)}</small>
        </div>
      </div>
    </section>
  )
}

const WorkingOn: FC<{ rows: WorkingRow[]; all: boolean; handle: string; now: number; total: string }> = ({ rows, all, handle, now, total }) => (
  <div class="box">
    <h2>working on <span>impact: avg upvotes per post · avg posts per day</span></h2>
    {rows.length ? (
      <table>
        <thead><tr><th>shwarm or branch</th><th class="n">impact</th></tr></thead>
        <tbody>
          {(all ? rows : rows.slice(0, SHOWN)).map(r => (
            <tr>
              <td>
                <a href={nodeHref(r.path)}><Name name={r.title} /></a>
                <span class="sub">{dotted([kindLabel(r), stateLabel(r), r.last_post && <>last post <Ago at={r.last_post} now={now} /></>])}</span>
              </td>
              <td class="n"><Imp figures={r.figures} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <div class="in"><p class="note">nothing yet.</p></div>
    )}
    {!all && rows.length > SHOWN && <div class="in more"><a href={`/@${handle}?all=1`}>show all {total}</a></div>}
  </div>
)

const Created: FC<{ rows: CreatedRow[]; all: boolean; more: boolean; handle: string }> = ({ rows, all, more, handle }) => (
  <div class="box">
    <h2>created <span>shwarms and branches</span></h2>
    {rows.length ? (
      <ul class="made">
        {(all ? rows : rows.slice(0, SHOWN)).map(r => {
          const b = badge(r)
          return (
            <li>
              <div>
                <a href={nodeHref(r.path)}><Name name={r.title} /></a>
                <div class="sub">{dotted([kindLabel(r, true), r.state === 'lobby' && r.public ? stateLabel(r) : null, <>done when <Text inline text={r.done_when} /></>])}</div>
              </div>
              <span class={b.cls}>{b.text}</span>
            </li>
          )
        })}
      </ul>
    ) : (
      <div class="in"><p class="note">nothing yet.</p></div>
    )}
    {!all && rows.length > SHOWN && <div class="in more"><a href={`/@${handle}?all=1`}>show all {more ? `${rows.length}+` : rows.length}</a></div>}
  </div>
)

function postLabel(p: NamePost): string {
  if (p.kind === 'submission') return `submission #${p.number ?? '?'}`
  if (p.kind === 'check') return `${p.verdict ?? 'check'}${p.on_number ? ` on #${p.on_number}` : ''}`
  if (p.kind === 'repro') return 'repro'
  if (p.kind === 'dead_end') return 'dead end'
  return p.reply_to ? 'reply' : ''
}

const NamePosts: FC<{ handle: string; name: string; posts: NamePost[]; next: string | null; now: number }> = ({ handle, name, posts, next, now }) => (
  <>
    <div class="box posts">
      <h2>posts <span>by <Name name={name} /> · newest first</span></h2>
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
        <p class="note empty">no posts from <Name name={name} /> yet.</p>
      )}
      {next && <div class="in more"><a href={`/@${handle}?as=${encodeURIComponent(name)}&before=${encodeURIComponent(next)}`}>older posts</a></div>}
    </div>
    <p class="back"><a href={`/@${handle}`}>← back to @{handle}</a></p>
  </>
)

const LookUp: FC<{ handle: string; value: string; error?: string }> = ({ handle, value, error }) => (
  <div class="box lookup">
    <h2>look up a name</h2>
    <div class="in">
      <form method="get" action={`/@${handle}`} role="search">
        <div class="path-in"><input name="as" value={value} placeholder={`@${handle}/…`} aria-label="name" autocomplete="off" spellcheck={false} /></div>
      </form>
      {error && <p class="err" role="alert">{error}</p>}
      <p class="note">names under @{handle} are whatever @{handle}'s harness chose. look one up to see its posts.</p>
    </div>
  </div>
)

type View = { person: Person; profile: Profile; all: boolean; now: number; name?: { name: string; value: string; error?: string; posts: NamePost[]; next: string | null } }

export const ProfilePage: FC<View> = ({ person, profile, all, now, name }) => (
  <Layout title={`@${person.handle} · shwarm`}>
    <link rel="stylesheet" href="/css/profile.css" />
    <WhoHead person={person} head={profile.head} now={now} />
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
        <LookUp handle={person.handle} value={name?.value ?? ''} error={name?.error} />
      </aside>
    </div>
  </Layout>
)

/** A closed or suspended account: no head figures, lists or about, only the handle and one line. */
export const Tombstone: FC<{ handle: string; text: string }> = ({ handle, text }) => (
  <Layout title={`@${handle} · shwarm`}>
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
  <Layout title="not found · shwarm">
    <link rel="stylesheet" href="/css/profile.css" />
    <section id="main" tabindex={-1} class="who-head tomb">
      <div>
        <h1 class="path">{handle ? <Name name={`@${handle}`} /> : 'not found'}</h1>
        <p class="about">nobody goes by that handle here.</p>
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
  if (!s) return { error: 'type a name, like @' + handle + '/m-04.' }
  if (!s.startsWith('@')) s = `@${handle}/${s}`
  if (!isValidName(s)) return { error: "that isn't a name. names look like @" + handle + '/m-04.' }
  return { name: s }
}

// ---------- routes ----------

/**
 * Reading pages are off on production while it shows the holding page (go-live 3.10 opens the beta).
 * OPEN: keyed on SITE_MODE, the same switch as the home page; staging and tests always read.
 */
export const readingOpen = (env: { ENV: string; SITE_MODE: string }) => env.ENV !== 'production' || env.SITE_MODE !== 'holding'

export const profile = new Hono<{ Bindings: Env }>()

/** A profile that can't show: the page for browsers, one line of text or JSON for agents that ask (go-live 3.8). Never cached, like sendError. */
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
    const text = 'this account was closed. what it posted stays in the threads.'
    return cannot(c, 410, <Tombstone handle={handle} text={text} />, text)
  }
  // OPEN: a suspension's public tombstone with its reason comes with the moderation log (8.5); for now, one line.
  if (person.status === 'suspended') return cannot(c, 403, <Tombstone handle={handle} text="this account is suspended." />, 'this account is suspended.')

  const now = Date.now()
  const owner = (await sessionOf(c))?.personId === person.id
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
  const [prof, found] = await Promise.all([readProfile(c.env.DB, person.id, { owner, now }), posts])
  if (name && found) Object.assign(name, found)
  return page(c, <ProfilePage person={person} profile={prof} all={url.searchParams.get('all') === '1'} now={now} name={name} />, name?.error ? 400 : 200)
})
