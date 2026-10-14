// A closed shwarm's result page, /w/<path> (go-live 5.7), ported from mockups/shwarm-closed.html: what passed, at the
// hash its checks ran against, with its links ("these links leave shwarm"); the proof; who made it, ranked by counted
// upvotes with role tags from recorded events; what's next (build on it); the shwarms challenging it and the rest built
// on it; and the log's key events. A passed shwarm stays passed and is locked (decided Oct 9): no repro reopens it, and
// doubts become a shwarm that builds on it with the same done test, listed here as "challenged by". Its thread stays at ?thread=1 (the live template). Participant text goes through render/text.tsx.
import type { FC } from 'hono/jsx'
import { shortHash } from '@shwarm/protocol'
import type { Link } from '@shwarm/protocol'
import type { Chain } from '../read/node'
import type { LogPage, LogRow } from '../read/log'
import type { BuiltOnThis, Credits, Result } from '../read/result'
import { cut, licenseName, monthDay, q1 } from '../render/format'
import { showHidden } from '../render/hidden'
import { LINK_REL, linkParts, Name, Plain, Text } from '../render/text'
import { count, fill, fillx, w } from '../words'
import { feedHref } from './feed'
import { AgentResources, Layout } from './layout'
import { buildOnHref, previewCard, linkView, nodeHref, parseLinks, Pill, Proof, subHref, type Me, TriageNote, PausedNote } from './node-page'

export type ResultPageData = {
  chain: Chain
  result: Result
  credits: Credits
  builtOnThis: BuiltOnThis[]
  log: LogPage // the newest key events, newest first
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
  // Shwarms that kept this done test are challenging the pass (decided Oct 9); the rest are built on it.
  const challenged = d.builtOnThis.filter(b => b.challenges)
  const builtOn = d.builtOnThis.filter(b => !b.challenges)
  return (
    <Layout title={fill(w.result.pageTitle, { title: showHidden(n.title) })} description={cut(showHidden(n.what), 200)} canonical={nodeHref(n.path)} card={previewCard(n)}>
      <link rel="stylesheet" href="/css/node.css" />
      <link rel="stylesheet" href="/css/result.css" />
      <a class="back" href={feedHref('closed')}>{w.result.backToClosed}</a>
      {n.visibility === 'author' && <TriageNote triage={n.triage} />}
      {/* A passed shwarm can be flagged from its thread (?thread=1) and paused (core/flags.ts): say so here too. */}
      {n.paused === 1 && <PausedNote kind={n.kind} />}
      <DoneHead d={d} />
      <div class="grid">
        <main id="main" tabindex={-1}>
          <ResultBox d={d} />
          <Proof n={n} sub={d.result.sub} checks={d.result.checks} />
          <WhoMadeIt credits={d.credits} />
          <LogBox d={d} />
          <p class="note thread-link">
            {/* OPEN (#92): "it's locked." replaces the mockup's "it stays open for repros…"; it waits on Myra's yes. */}
            {fillx(w.result.threadLine, { link: <a href={threadHref(n.path)}>{fill(w.result.readThread, { posts: count(w.result.posts, d.result.posts) })}</a> })}
          </p>
        </main>
        <aside>
          <div class="box next">
            <h2 class="sunny">{w.result.whatsNext}</h2>
            <div class="in">
              <a class="btn" href={buildOnHref(n.path)}>{w.result.buildOnThis}</a>
              {/* OPEN (#92): the second sentence replaces the mockup's repro line; it waits on Myra's yes. */}
              <p class="note">{w.result.buildOnNote}</p>
            </div>
          </div>
          <NodeList title={w.result.challengedBy} nodes={challenged} now={d.now} />
          <NodeList title={w.result.builtOnThis} nodes={builtOn} now={d.now} />
          <AgentResources />
        </aside>
      </div>
    </Layout>
  )
}

/** A sidebar list of shwarms that build on this one, each with its state; nothing when there are none. */
const NodeList: FC<{ title: string; nodes: BuiltOnThis[]; now: number }> = ({ title, nodes, now }) =>
  nodes.length ? (
    <div class="box">
      <h2>{title} <span>{nodes.length}</span></h2>
      <ul class="tree">
        {nodes.map(b => (
          <li><a href={nodeHref(b.path)}><Plain text={b.title} /></a><Pill n={b} now={now} short /></li>
        ))}
      </ul>
    </div>
  ) : null

const DoneHead: FC<{ d: ResultPageData }> = ({ d }) => {
  const n = d.chain.node
  const start = n.live_at ?? n.created_at
  const days = n.closed_at ? Math.max(1, Math.floor((Date.parse(n.closed_at) - Date.parse(start)) / DAY)) : null
  const bo = n.builds_on
  const up = bo && ('node' in bo ? { href: nodeHref(bo.node), text: bo.title ?? bo.node, out: false } : { href: bo.url ? linkParts(bo.url)?.href : undefined, text: bo.name, out: true })
  return (
    <section class="done-head">
      <div>
        <span class="donebadge">{fill(w.result.doneBadge, { date: monthDay(n.closed_at) })}</span>
        <h1><Text inline text={n.title} /></h1>
        <div class="meta">
          {fillx(w.result.startedBy, { name: <Name name={n.posted_by} link /> })}
          {days && <> · {fill(w.result.startToFinish, { days: count(w.result.days, days) })}</>}
          {up && (
            <>
              {' '}· {fillx(w.result.buildsOn, { shwarm: up.href ? <a class="up" href={up.href} rel={up.out ? LINK_REL : undefined}><Plain text={up.text} /></a> : <Plain text={up.text} /> })}
            </>
          )}
        </div>
        <div class="passed"><b>{w.result.doneWhenPassed}</b><Text text={n.done_when} /></div>
      </div>
      <div><span class="st done">{w.result.closed}</span></div>
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
      <h2 class="sunny">{w.result.theResult} <span>{fill(w.result.theVersion, { n: sub.number })}</span></h2>
      <div class="in">
        <div>
          <h3><Plain text={sub.release_title || n.title} /></h3>
          <div class="sum"><Text text={sub.text} /></div>
          <div class="src">{fillx(w.result.from, { link: <a href={subHref(n.path, sub.number)}>{fill(w.result.submissionNumber, { n: sub.number })}</a>, name: <Name name={sub.as_name} link /> })}</div>
          <dl class="kv">
            <dt>{w.result.version}</dt>
            <dd>
              {sub.release_version && <><Plain text={sub.release_version} /> · </>}
              {fillx(w.result.exactBuild, { hash: <code title={fill(w.result.hashTitle, { full: sub.hash })}>{shortHash(sub.hash)}</code> })}
            </dd>
            {links.length > 0 && (
              <>
                <dt>{w.result.fingerprint}</dt>
                <dd>{links.map((l, i) => <>{i > 0 && <br />}<Print l={l} /></>)}</dd>
              </>
            )}
            <dt>{w.result.license}</dt>
            <dd><Plain text={licenseName(n.license)} />{from && <>{fillx(w.result.licenseFrom, { name: <Plain text={from} /> })}</>}</dd>
            {sub.release_how_to_use && (
              <>
                <dt>{w.result.howToUse}</dt>
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
                  <a class={i === 0 ? 'btn' : 'btn plain'} href={v.p.href} rel={LINK_REL}>{fillx(w.result.linkButton, { label: <Plain text={v.label} />, host: <Plain text={v.host} /> })}</a>
                ) : null
              })}
            </div>
            <p class="note">{w.result.linksLeave}</p>
          </>
        )}
      </div>
    </div>
  )
}

/** One link's pin: "sha256 9c4e07b2…a71f · of mid-v1.pk3", or "commit e9b41d0 · of kestrel/mcdoom". */
const Print: FC<{ l: Link }> = ({ l }) => {
  const label = <Plain text={linkView(l).label} />
  return 'sha256' in l ? (
    <>{fillx(w.result.printSha, { hash: <code title={l.sha256}>{shortSha(l.sha256)}</code>, name: label })}</>
  ) : (
    <>{fillx(w.result.printCommit, { commit: <code title={l.commit}>{l.commit.slice(0, 7)}</code>, name: label })}</>
  )
}

const WhoMadeIt: FC<{ credits: Credits }> = ({ credits }) => {
  const row = (o: { rank: string; who: unknown; posts: number; upvotes: number }) => {
    const q = o.posts > 0 ? o.upvotes / o.posts : 0
    return (
      <tr>
        <td class="rk">{o.rank}</td>
        <td>{o.who}</td>
        <td class="n">{o.upvotes.toLocaleString('en-US')} ▲</td>
        <td class="n"><span class="imp" style={`--q:${q1(q)}`} title={fill(w.result.impactTitle, { n: q1(q), posts: count(w.result.posts, o.posts) })}>{o.posts.toLocaleString('en-US')}</span></td>
      </tr>
    )
  }
  return (
    <div class="box">
      <h2>{w.result.whoMadeIt} <span>{w.result.rankedByImpact}</span></h2>
      <table class="credit">
        <thead><tr><th></th><th>{w.result.personAndRole}</th><th class="n">{w.result.upvotes}</th><th class="n">{w.result.perPostPosts}</th></tr></thead>
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
          {credits.more && row({ rank: '', posts: credits.more.posts, upvotes: credits.more.upvotes, who: <>{fill(w.result.more, { n: credits.more.people })}</> })}
        </tbody>
      </table>
      <div class="in rule"><p class="note">{w.result.creditNote}</p></div>
    </div>
  )
}

const EV_CLASS: Record<string, string> = { passed: 'ev ok', signed_off: 'ev ok', dead_end: 'ev dead' }

/**
 * The log's key events, oldest first, each linked to its evidence; the JSON has every event (read/log.ts). The node and
 * by cells are classed so the table keeps room for a title's words and a name (result.css).
 */
const LogBox: FC<{ d: ResultPageData }> = ({ d }) => {
  const n = d.chain.node
  const rows: LogRow[] = [...d.log.rows].reverse()
  return (
    <div class="box log-box">
      <h2>{w.result.log} <span>{w.result.everyEvent}</span></h2>
      <table class="log">
        <thead><tr><th>{w.result.logWhen}</th><th>{w.result.logEvent}</th><th>{w.result.logNode}</th><th>{w.result.logBy}</th><th>{w.result.logDetail}</th></tr></thead>
        <tbody>
          {rows.map(e => (
            <tr>
              <td class="when">{monthDay(e.at, true)}</td>
              <td><span class={EV_CLASS[e.event] ?? 'ev'}>{e.event.replace('_', ' ')}</span></td>
              <td class="node"><Plain text={e.title} /></td>
              <td class="by">{e.by ? <Name name={e.by} link /> : e.number !== null ? fill(w.result.submissionNumber, { n: e.number }) : '—'}</td>
              <td><a href={e.evidence}><Plain text={e.detail} /></a></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="in rule foot">
        {/* OPEN (#81): "all" goes to the JSON; an HTML view of every event isn't decided. */}
        <span class="note">
          {fillx(w.result.logShowing, {
            shown: rows.length,
            total: count(w.result.events, d.log.all),
            filter: <b>{w.result.keyEvents}</b>,
            all: <a href={logHref(n.path, 'all')}>{w.result.all}</a>,
          })}
        </span>
        <a href={logHref(n.path, 'all')}>{w.result.fullLog}</a>
      </div>
    </div>
  )
}
