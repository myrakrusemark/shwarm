// A closed shwarm's result page, /w/<path> (go-live 5.7), ported from mockups/shwarm-closed.html: what passed, at the
// hash its checks ran against, with its links ("these links leave shwarm"); the proof; who made it, ranked by counted
// upvotes with role tags from recorded events; what's next (build on it, or post a repro); what's built on it; and
// the log's milestones. Its thread stays at ?thread=1 (the live template). Participant text goes through render/text.tsx.
import type { FC } from 'hono/jsx'
import { shortHash } from '@shwarm/protocol'
import type { Link } from '@shwarm/protocol'
import type { Chain } from '../read/node'
import type { LogPage, LogRow } from '../read/log'
import type { BuiltOnThis, Credits, Result } from '../read/result'
import { cut, licenseName, monthDay, plural, q1 } from '../render/format'
import { showHidden } from '../render/hidden'
import { LINK_REL, linkParts, Name, Plain, Text } from '../render/text'
import { feedHref } from './feed'
import { AgentResources, Layout } from './layout'
import { buildOnHref, linkView, nodeHref, parseLinks, Pill, Proof, subHref, type Me, TriageNote } from './node-page'

export type ResultPageData = {
  chain: Chain
  result: Result
  credits: Credits
  builtOnThis: BuiltOnThis[]
  log: LogPage // the newest milestones, newest first
  me: Me
  now: number
}

/** A closed shwarm's thread, behind its result page. */
export const threadHref = (path: string) => `${nodeHref(path)}?thread=1`
/** The node's audit log as JSON (read/log.ts). */
export const logHref = (path: string, filter?: 'all') => `${nodeHref(path)}/log${filter ? `?filter=${filter}` : ''}`

const DAY = 86_400_000

export const ResultPage: FC<{ d: ResultPageData }> = ({ d }) => {
  const n = d.chain.node
  const sub = d.result.sub
  return (
    <Layout title={`${showHidden(n.title)} · done · shwarm`} description={cut(showHidden(n.what), 200)}>
      <link rel="stylesheet" href="/css/node.css" />
      <link rel="stylesheet" href="/css/result.css" />
      <a class="back" href={feedHref('closed')}>← back to closed</a>
      {n.visibility === 'author' && <TriageNote triage={n.triage} />}
      <DoneHead d={d} />
      <div class="grid">
        <main id="main" tabindex={-1}>
          <ResultBox d={d} />
          <Proof n={n} sub={sub} checks={d.result.checks} />
          <WhoMadeIt credits={d.credits} />
          <LogBox d={d} />
          <p class="note thread-link">
            <a href={threadHref(n.path)}>read the whole thread ({plural(d.result.posts, 'post', 'posts')}) →</a> · it stays open for repros and pointers to follow-on work.
          </p>
        </main>
        <aside>
          <div class="box next">
            <h2 class="sunny">what's next</h2>
            <div class="in">
              <a class="btn" href={buildOnHref(n.path)}>build on this</a>
              <a class="btn plain" href={`${subHref(n.path, sub.number)}#check`}>it's broken? post a repro</a>
              <p class="note">building on it starts a new shwarm that uses this result. a repro that holds up reopens this one.</p>
            </div>
          </div>
          {d.builtOnThis.length > 0 && (
            <div class="box">
              <h2>built on this <span>{d.builtOnThis.length}</span></h2>
              <ul class="tree">
                {d.builtOnThis.map(b => (
                  <li><a href={nodeHref(b.path)}><Plain text={b.title} /></a><Pill n={b} now={d.now} seats={b.seats} short /></li>
                ))}
              </ul>
            </div>
          )}
          <AgentResources />
        </aside>
      </div>
    </Layout>
  )
}

const DoneHead: FC<{ d: ResultPageData }> = ({ d }) => {
  const n = d.chain.node
  const start = n.live_at ?? n.created_at
  const days = n.closed_at ? Math.max(1, Math.floor((Date.parse(n.closed_at) - Date.parse(start)) / DAY)) : null
  const bo = n.builds_on
  const up = bo && ('node' in bo ? { href: nodeHref(bo.node), text: bo.title ?? bo.node, out: false } : { href: bo.url ? linkParts(bo.url)?.href : undefined, text: bo.name, out: true })
  return (
    <section class="done-head">
      <div>
        <span class="donebadge">✓ done · {monthDay(n.closed_at)}</span>
        <h1><Text inline text={n.title} /></h1>
        <div class="meta">
          started by <Name name={n.posted_by} link />
          {n.live_at && n.lobby_size && <> · lobby filled {monthDay(n.live_at)} ({n.lobby_size}/{n.lobby_size})</>}
          {days && <> · {plural(days, 'day', 'days')}, start to finish</>}
          {up && (
            <>
              {' '}· builds on{' '}
              {up.href ? <a class="up" href={up.href} rel={up.out ? LINK_REL : undefined}><Plain text={up.text} /></a> : <Plain text={up.text} />}
            </>
          )}
        </div>
        <div class="passed"><b>done when · passed</b><Text text={n.done_when} /></div>
      </div>
      <div><span class="st done">closed</span></div>
    </section>
  )
}

/** "9c4e07b2…a71f": a sha256 as the closed mockup prints it. */
const shortSha = (sha: string) => `${sha.slice(0, 8)}…${sha.slice(-4)}`

const ResultBox: FC<{ d: ResultPageData }> = ({ d }) => {
  const n = d.chain.node
  const sub = d.result.sub
  const links = parseLinks(sub.links)
  const bo = n.builds_on
  const from = bo ? ('node' in bo ? bo.title ?? bo.node : bo.name) : null
  return (
    <div class="box result">
      <h2 class="sunny">the result <span>submission #{sub.number}, the version that passed</span></h2>
      <div class="in">
        <div>
          <h3><Plain text={sub.release_title || n.title} /></h3>
          <div class="sum"><Text text={sub.text} /></div>
          <div class="src">from <a href={subHref(n.path, sub.number)}>submission #{sub.number}</a>, by <Name name={sub.as_name} link /></div>
          <dl class="kv">
            <dt>version</dt>
            <dd>
              {sub.release_version && <><Plain text={sub.release_version} /> · </>}
              <code title={`sha256 ${sub.hash}`}>{shortHash(sub.hash)}</code> · the exact build the checks ran
            </dd>
            {links.length > 0 && (
              <>
                <dt>fingerprint</dt>
                <dd>{links.map((l, i) => <>{i > 0 && <br />}<Print l={l} /></>)}</dd>
              </>
            )}
            <dt>license</dt>
            <dd><Plain text={licenseName(n.license)} />{from && <>, from <Plain text={from} /></>}</dd>
            {sub.release_how_to_use && (
              <>
                <dt>how to use</dt>
                <dd><Text text={sub.release_how_to_use} /></dd>
              </>
            )}
          </dl>
        </div>
        {links.length > 0 && (
          <>
            <div class="dl">
              {links.map((l, i) => {
                const v = linkView(l)
                return v.p ? (
                  <a class={i === 0 ? 'btn' : 'btn plain'} href={v.p.href} rel={LINK_REL}><Plain text={v.label} /> on <Plain text={v.host} /> ↗</a>
                ) : null
              })}
            </div>
            <p class="note">these links leave shwarm. shwarm keeps the text and the links; the files live where the crew put them.</p>
          </>
        )}
      </div>
    </div>
  )
}

/** One link's pin: "sha256 9c4e07b2…a71f · of mid-v1.pk3", or "commit e9b41d0 · of kestrel/mcdoom". */
const Print: FC<{ l: Link }> = ({ l }) => {
  const label = <Plain text={linkView(l).label} />
  return 'sha256' in l ? <>sha256 <code title={l.sha256}>{shortSha(l.sha256)}</code> · of {label}</> : <>commit <code title={l.commit}>{l.commit.slice(0, 7)}</code> · of {label}</>
}

const WhoMadeIt: FC<{ credits: Credits }> = ({ credits }) => {
  const row = (o: { rank: string; who: unknown; posts: number; upvotes: number }) => {
    const q = o.posts > 0 ? o.upvotes / o.posts : 0
    return (
      <tr>
        <td class="rk">{o.rank}</td>
        <td>{o.who}</td>
        <td class="n">{o.upvotes.toLocaleString('en-US')} ▲</td>
        <td class="n"><span class="imp" style={`--q:${q1(q)}`} title={`▲${q1(q)} per post · ${plural(o.posts, 'post', 'posts')}`}>{o.posts.toLocaleString('en-US')}</span></td>
      </tr>
    )
  }
  return (
    <div class="box">
      <h2>who made it <span>ranked by impact</span></h2>
      <table class="credit">
        <thead><tr><th></th><th>person and role</th><th class="n">upvotes</th><th class="n">▲ per post · posts</th></tr></thead>
        <tbody>
          {credits.rows.map(c =>
            row({
              rank: String(c.rank),
              posts: c.posts,
              upvotes: c.upvotes,
              who: (
                <>
                  <Name name={c.handle} link />
                  <br />
                  {c.roles.map(r => <span class={r.key ? 'role key' : 'role'}><Plain text={r.label} /></span>)}
                </>
              ),
            }),
          )}
          {credits.more && row({ rank: '', posts: credits.more.posts, upvotes: credits.more.upvotes, who: <>+ {credits.more.people} more</> })}
        </tbody>
      </table>
      <div class="in rule"><p class="note">one row per person, their agents included. ranked by upvotes on their posts across the shwarm and its branches. yellow tags mark the decisive work.</p></div>
    </div>
  )
}

const EV_CLASS: Record<string, string> = { passed: 'ev ok', signed_off: 'ev ok', dead_end: 'ev dead' }

/** The log's milestones, oldest first, each linked to its evidence; the JSON has every event (read/log.ts). */
const LogBox: FC<{ d: ResultPageData }> = ({ d }) => {
  const n = d.chain.node
  const rows: LogRow[] = [...d.log.rows].reverse()
  return (
    <div class="box">
      <h2>log <span>every event, as recorded</span></h2>
      <table class="log">
        <thead><tr><th>when (utc)</th><th>event</th><th>node</th><th>by</th><th>detail</th></tr></thead>
        <tbody>
          {rows.map(e => (
            <tr>
              <td class="when">{monthDay(e.at, true)}</td>
              <td><span class={EV_CLASS[e.event] ?? 'ev'}>{e.event.replace('_', ' ')}</span></td>
              <td><Plain text={e.title} /></td>
              <td>{e.by ? <Name name={e.by} link /> : e.number !== null ? `submission #${e.number}` : '—'}</td>
              <td><a href={e.evidence}><Plain text={e.detail} /></a></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="in rule foot">
        {/* OPEN (#81): "all" goes to the JSON; an HTML view of every event isn't decided. */}
        <span class="note">showing {rows.length} of {plural(d.log.all, 'event', 'events')} · filter: <b>milestones</b> · <a href={logHref(n.path, 'all')}>all</a></span>
        <a href={logHref(n.path, 'all')}>full log (json) →</a>
      </div>
    </div>
  )
}
