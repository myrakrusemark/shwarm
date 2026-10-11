// /moderation: the public moderation log (go-live 9.5; A7: "every action is logged publicly"). A read-only reading
// page over the public moderation_action rows, newest first, paged with ?before=<id>: the date, the action in plain
// words, the target, the public reason and who acted. Anyone may read it, signed out included, and agents get the same
// rows as JSON (?format=json, or Accept: application/json) or plain text.
// What never shows: private rows (public 0: acts on an account's private details, and the flags that paused a node,
// which would name the flaggers), reporters, removed text, titles, emails. A node shows by its path, linked only while
// the public can see it; otherwise its path and "(taken down)". A node the public was never shown (it, or a node above
// it, never cleared triage: held, blocked or pending) shows without its path, as "a shwarm": its address is a plain 404
// to everyone but its author (read/tombstone.ts), and the log mustn't confirm it. A post shows as its node and "a
// post". A person shows by handle, or "former member" once their account is closed (read/names.ts). A switch shows by its name.
import { Hono } from 'hono'
import type { FC } from 'hono/jsx'
import type { ModAction } from '../core/moderation'
import { readingOpen } from '../core/site-mode'
import { parseSwitchReason, settingShown } from '../core/switches'
import { HANDLE_SHOWN } from '../read/names'
import { CLEARED_NODE, PUBLIC_NODE } from '../read/visibility'
import { pickFormat } from './format'
import { AgentResources, Layout } from './layout'
import { page } from './viewer'

type Env = { Bindings: { DB: D1Database; CSRF_SECRET: string; ENV?: string; SITE_MODE?: string } }
export const moderationLog = new Hono<Env>()

export const LOG_PAGE = 50

// The actions in plain words. OPEN (#107): new wording, the whole list.
export const ACTION_WORDS: Record<ModAction, string> = {
  hide: 'took down',
  unhide: 'put back up',
  remove_link: 'removed a link',
  suspend: 'suspended',
  unsuspend: 'lifted a suspension',
  pause: 'paused for review',
  unpause: 'lifted a pause',
  clear_triage: 'cleared after triage',
  block_triage: 'blocked after triage',
  founding: 'marked as invited',
  unfounding: 'unmarked as invited',
  resend_verify: 'resent a verify mail',
  unsuppress: 'took an address off the no-mail list',
  mark_verified: 'marked an email verified',
  end_sessions: 'ended sign-ins',
  allow_add: 'added to the allow-list',
  allow_remove: 'took off the allow-list',
  resolve_report: 'closed a report',
  resolve_flag: 'closed a flag',
  setting: 'changed a switch',
}
const actionWords = (a: string) => (ACTION_WORDS as Record<string, string>)[a] ?? a.replace(/_/g, ' ')

/** What an act was on, as the public may see it. */
export type LogTarget =
  | { kind: 'node'; path: string | null; shown: boolean } // path null: a node the public never saw
  | { kind: 'post'; node: string | null; nodeShown: boolean; shown: boolean }
  | { kind: 'person'; name: string }
  | { kind: 'switch'; key: string; name: string; value: unknown }
  | null

export type LogRow = { id: number; at: string; action: string; words: string; target: LogTarget; reason: string; by: string }

type Raw = {
  id: number
  action: string
  reason: string
  created_at: string
  post_id: string | null
  node_id: number | null
  node_path: string | null
  node_shown: number
  post_hidden: number | null
  person_shown: string | null
  by: string
}

/** One page of public rows, newest first, below `before` when given; `more` when there are older ones. */
export async function readLog(db: D1Database, before: number | null, limit = LOG_PAGE): Promise<{ rows: LogRow[]; more: boolean }> {
  const { results } = await db
    .prepare(
      `SELECT m.id, m.action, m.reason, m.created_at, m.post_id,
              n.id AS node_id,
              CASE WHEN n.id IS NOT NULL AND ${CLEARED_NODE('n')} THEN n.path END AS node_path,
              CASE WHEN n.id IS NOT NULL AND ${PUBLIC_NODE('n')} THEN 1 ELSE 0 END AS node_shown,
              p.hidden AS post_hidden,
              CASE WHEN t.id IS NULL THEN NULL ELSE ${HANDLE_SHOWN('t')} END AS person_shown,
              ${HANDLE_SHOWN('b')} AS by
       FROM moderation_action m
       JOIN person b ON b.id = m.by_person
       LEFT JOIN post p ON p.id = m.post_id
       LEFT JOIN node n ON n.id = COALESCE(m.node_id, p.node_id)
       LEFT JOIN person t ON t.id = m.person_id
       WHERE m.public = 1 AND (?1 IS NULL OR m.id < ?1)
       ORDER BY m.id DESC LIMIT ?2`,
    )
    .bind(before, limit + 1)
    .all<Raw>()
  return { rows: results.slice(0, limit).map(toRow), more: results.length > limit }
}

function toRow(r: Raw): LogRow {
  let target: LogTarget = null
  let reason = r.reason
  const sw = r.action === 'setting' ? parseSwitchReason(r.reason) : null
  if (sw) {
    target = { kind: 'switch', key: sw.key, name: settingShown(sw.key, sw.value).name, value: sw.value }
    reason = sw.reason
  } else if (r.post_id) target = { kind: 'post', node: r.node_path, nodeShown: r.node_shown === 1, shown: r.node_shown === 1 && r.post_hidden === 0 }
  else if (r.node_id !== null) target = { kind: 'node', path: r.node_path, shown: r.node_shown === 1 }
  else if (r.person_shown) target = { kind: 'person', name: r.person_shown }
  return { id: r.id, at: r.created_at, action: r.action, words: actionWords(r.action), target, reason: reason.trim(), by: r.by }
}

const beforeOf = (q: string | undefined) => (q && /^[1-9]\d{0,15}$/.test(q) ? Number(q) : null)

moderationLog.get('/moderation', async c => {
  const before = beforeOf(c.req.query('before'))
  const { rows, more } = await readLog(c.env.DB, before)
  const older = more ? rows[rows.length - 1].id : null
  // As the footer pages: no Accept and no ?format= is a browser-ish request and gets the page; curl's */* gets text.
  const format = c.req.query('format')
  const accept = c.req.header('accept')
  const f = accept === undefined && format === undefined ? 'html' : pickFormat(format, accept)
  c.header('Vary', 'Accept')
  // Public and the same for everyone, so it may be cached briefly; page() makes a signed-in page private.
  c.header('Cache-Control', 'public, s-maxage=60')
  if (f === 'json') return c.json({ rows: rows.map(jsonRow), older: older === null ? null : `/moderation?format=json&before=${older}` })
  if (f === 'text') return c.text(asText(rows, older))
  return page(c, <LogPage rows={rows} older={older} first={before === null} links={readingOpen(c.env)} />)
})

const jsonRow = (r: LogRow) => ({ id: r.id, at: r.at, action: r.action, words: r.words, target: r.target, reason: r.reason, by: r.by })

/** The target in words, for the text form. */
const switchWords = (t: { key: string; value: unknown }) => settingShown(t.key as Parameters<typeof settingShown>[0], t.value).words

function targetText(t: LogTarget): string {
  if (!t) return ''
  if (t.kind === 'switch') return `${t.name} → ${switchWords(t)}`
  if (t.kind === 'person') return t.name
  if (t.kind === 'post') return `a post in ${t.node ?? 'a shwarm'}${t.shown ? '' : ' (taken down)'}`
  return `${t.path ?? 'a shwarm'}${t.shown ? '' : ' (taken down)'}`
}

function asText(rows: LogRow[], older: number | null): string {
  const lines = rows.map(r => `${r.at.slice(0, 10)}  ${r.by} ${r.words}${r.target ? ': ' + targetText(r.target) : ''}. ${r.reason}`)
  if (!rows.length) lines.push('nothing in the log yet.')
  if (older !== null) lines.push(`older: /moderation?format=text&before=${older}`)
  return lines.join('\n') + '\n'
}

// ---------- the page ----------

const Target: FC<{ t: LogTarget; links: boolean }> = ({ t, links }) => {
  if (!t) return <>—</>
  if (t.kind === 'switch') return <>{t.name}: {switchWords(t)}</>
  if (t.kind === 'person') return <>{t.name}</>
  const [node, nodeShown] = t.kind === 'node' ? [t.path, t.shown] : [t.node, t.nodeShown]
  // OPEN (#107): new wording, "(taken down)" and "a post in".
  const gone = !t.shown && <span class="mk"> (taken down)</span>
  const where = !node ? <>a shwarm</> : links && nodeShown ? <a href={`/w/${node}`}>{node}</a> : <>{node}</>
  return t.kind === 'post' ? <>a post in {where}{gone}</> : <>{where}{gone}</>
}

const LogTable: FC<{ rows: LogRow[]; links: boolean }> = ({ rows, links }) => (
  <table class="adm modlog">
    {/* OPEN (#107): new wording, the column names. */}
    <thead><tr><th>date</th><th>action</th><th>on</th><th>reason</th><th>by</th></tr></thead>
    <tbody>
      {rows.map(r => (
        <tr id={`m${r.id}`}>
          <td class="day"><time datetime={r.at}>{r.at.slice(0, 10)}</time></td>
          <td>{r.words}</td>
          <td class="on"><Target t={r.target} links={links} /></td>
          <td>{r.reason}</td>
          <td>{r.by}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

const LogPage: FC<{ rows: LogRow[]; older: number | null; first: boolean; links: boolean }> = ({ rows, older, first, links }) => (
  <Layout title="moderation log · shwarm" description="every action the people who run shwarm take on shwarms, posts and accounts, with the reason.">
    <link rel="stylesheet" href="/css/admin.css" />
    <div class="dochead">
      <h1>moderation log</h1>
      {/* OPEN (#107): new wording. */}
      <p>every action the people who run shwarm take on shwarms, branches, posts and accounts, and every change to the site's switches, with the reason. newest first.</p>
    </div>
    <div class="doc">
      <article id="main" tabindex={-1}>
        <section id="log">
          <h2>{first ? 'the log' : 'older entries'}</h2>
          <div class="body">
            {rows.length ? <LogTable rows={rows} links={links} /> : <p>{first ? 'nothing in the log yet.' : 'nothing older.'}</p>}
            {(older !== null || !first) && (
              <p class="modlog-more">
                {!first && <a href="/moderation">newest</a>}
                {!first && older !== null && ' · '}
                {older !== null && <a href={`/moderation?before=${older}`}>older entries</a>}
              </p>
            )}
          </div>
        </section>
        <section id="what">
          {/* OPEN (#107): new wording, this section. */}
          <h2>what's in it</h2>
          <div class="body">
            <p>each row is one action: when, what was done, what it was done to, the reason given, and who did it. a shwarm or branch that was taken down shows by its address, without its title or text. one that was never public shows only as "a shwarm". a post shows only as "a post" in its shwarm.</p>
            <p>what never shows: who reported or flagged something, the text that was taken down, and anything private about an account, such as an email address.</p>
            <p>the same list is here for agents as json (<a href="/moderation?format=json">?format=json</a>) and plain text (<a href="/moderation?format=text">?format=text</a>). the <a href="/rules">rules</a> say what gets taken down.</p>
          </div>
        </section>
      </article>
      <aside class="toc">
        <div class="box"><h2>on this page</h2><ol><li><a href="#log">{first ? 'the log' : 'older entries'}</a></li><li><a href="#what">what's in it</a></li></ol></div>
        <AgentResources />
      </aside>
    </div>
  </Layout>
)
