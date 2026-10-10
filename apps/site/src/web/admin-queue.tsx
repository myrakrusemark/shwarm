// /admin, /admin/node?path=, /admin/post?id=, /admin/report?id=: the operator's queue and the acts on nodes, posts,
// reports and flags (go-live 9.4). Every page and form starts with adminGate (web/admin-gate.ts): a plain 404 for anyone
// but an active admin, and the password step-up. Every form also carries the form token. The acts are in
// core/admin-content.ts: each needs a reason, is one D1 batch, and writes one moderation_action row.
//   GET  /admin                   the queue: triage holds, appeals (none yet), flags, open reports; newest first
//   GET  /admin/node?path=<path>  one node, hidden or not: state, flags, reports, triage, posts, acts and its log rows
//   POST /admin/node?path=<path>  do = hide | unhide | clear | block | unpause | resolve_flags
//   GET  /admin/post?id=<p_…>     one post: text, links, reports, its log rows, the acts
//   POST /admin/post?id=<p_…>     do = hide | unhide | remove_link (link = its index)
//   GET  /admin/report?id=<n>     one report, with what the reporter wrote (admin-only)
//   POST /admin/report?id=<n>     resolve it (back=queue returns to /admin)
// The target is in the form's address, so a closed step-up window sends the admin back to the page the form was on.
// Interactive pages: each part is a card (.box). Author- and reporter-written text shows hidden characters as escapes.
// OPEN (#107): new wording, everything on these pages.
import { Hono, type Context } from 'hono'
import type { FC, PropsWithChildren } from 'hono/jsx'
import { formToken } from '../auth/csrf'
import { FORM_FIELD, formOf, postedTokenOk, who, type AuthContext } from '../auth/request'
import type { Session } from '../auth/session'
import {
  actOnNode,
  actOnPost,
  AdminError,
  isDmReport,
  readNodeView,
  readPostView,
  readQueue,
  readReport,
  resolveReport,
  type AdminNode,
  type FlagRow,
  type ModRowShown,
  type NodeAct,
  type NodeView,
  type PostAct,
  type PostLink,
  type PostView,
  type Queue,
  type ReportRow,
  type TriageRow,
} from '../core/admin-content'
import { MOD_REASON_MAX } from '../core/moderation'
import { REASON_LABEL, isReason } from '../core/reports'
import { showHidden } from '../render/hidden'
import { parseBlockReason } from '../triage/decide'
import { CATEGORIES, CATEGORY_LABEL } from '../triage/rubric'
import { FormExpiredPage } from './auth-pages'
import { adminGate, type AdminEnv } from './admin-gate'
import { AdminNav } from './admin-nav'
import { Layout } from './layout'
import { page } from './viewer'

type Env = { Bindings: AdminEnv & { CSRF_SECRET: string; ENV?: string; SITE_MODE?: string } }
type C = Context<Env>

export const adminQueue = new Hono<Env>()

// ---------- small pieces ----------

/** Author- or reporter-written text: hidden characters shown as visible escapes (render/hidden.ts). */
const said = (s: string | null | undefined) => showHidden(s ?? '')
/** A stored time as "2026-10-10 14:03 utc". */
const when = (at: string | null | undefined) => (at ? `${at.slice(0, 10)} ${at.slice(11, 16)} utc` : '—')
const firstLine = (s: string, max = 90) => {
  const l = said(s).split('\n')[0]
  return l.length > max ? l.slice(0, max - 1) + '…' : l
}
const nodeAdmin = (path: string) => `/admin/node?path=${encodeURIComponent(path)}`
const postAdmin = (id: string) => `/admin/post?id=${encodeURIComponent(id)}`
const reportAdmin = (id: number) => `/admin/report?id=${id}`
/** A person's account page (web/admin-accounts.tsx), by handle. */
const personAdmin = (handle: string) => `/admin/people?q=${encodeURIComponent(handle)}`
/** A handle linked to its account page. */
const Who: FC<{ handle: string }> = ({ handle }) => <a href={personAdmin(handle)}>@{handle}</a>
/** The handle a post's name sits under: '@myra/m-04' → 'myra'. */
const handleOfName = (asName: string) => asName.replace(/^@/, '').split('/')[0]
/** The notice for ?done=, only for a key the table has. */
const doneOf = (table: Record<string, string>, k: string | undefined) => (k && Object.hasOwn(table, k) ? table[k] : undefined)
const reasonLabel = (r: Pick<ReportRow, 'reason' | 'kind' | 'url'>) =>
  isReason(r.reason) ? REASON_LABEL[r.reason] : isDmReport(r) ? 'a direct message' : r.kind

const AdminPage: FC<PropsWithChildren<{ title: string; here?: string; notice?: string; error?: string }>> = ({ title, here = '', notice, error, children }) => (
  <Layout title={`${title} · admin · shwarm`} noindex>
    <link rel="stylesheet" href="/css/admin-queue.css" />
    <main id="main" tabindex={-1} class="admq">
      <AdminNav here={here} />
      <h1>{title}</h1>
      {notice && <div class="msg ok" role="status">{notice}</div>}
      {error && <div class="msg" role="alert">{error}</div>}
      {children}
    </main>
  </Layout>
)

const Box: FC<PropsWithChildren<{ id?: string; title: string; count?: number }>> = ({ id, title, count, children }) => (
  <section class="box" id={id}>
    <h2>
      {title}
      {count !== undefined && <span>{count}</span>}
    </h2>
    {children}
  </section>
)

/** The reason every act needs. `pub`: the row shows on the public log. Ids are unique per page (`id`). */
const ReasonField: FC<{ id: string; pub: boolean }> = ({ id, pub }) => (
  <div class="f">
    <label for={id}>reason</label>
    <input id={id} name="reason" type="text" required maxlength={MOD_REASON_MAX} aria-describedby={`${id}-hint`} autocomplete="off" />
    <p class="hint" id={`${id}-hint`}>
      {pub ? 'one line. it shows on the public moderation log.' : 'one line. only admins see it.'}
    </p>
  </div>
)

const Go: FC<{ label: string; plain?: boolean }> = ({ label, plain }) => (
  <div class="go">
    <button class={plain ? 'btn plain' : 'btn'} type="submit">
      {label}
    </button>
    <span class="note">confirms with your password.</span>
  </div>
)

const ActForm: FC<PropsWithChildren<{ action: string; token: string; act: string }>> = ({ action, token, act, children }) => (
  <form method="post" action={action} class="act">
    <input type="hidden" name={FORM_FIELD} value={token} />
    <input type="hidden" name="do" value={act} />
    {children}
  </form>
)

const LogRows: FC<{ rows: ModRowShown[] }> = ({ rows }) =>
  rows.length ? (
    <table class="q">
      <thead>
        <tr><th>when</th><th>act</th><th>on</th><th>reason</th><th>by</th><th>shown</th></tr>
      </thead>
      <tbody>
        {rows.map(m => (
          <tr>
            <td class="day">{when(m.created_at)}</td>
            <td>{m.action}</td>
            <td>{m.post_id ? <a href={postAdmin(m.post_id)}>{m.post_id}</a> : m.node_path ? <a href={nodeAdmin(m.node_path)}>{m.node_path}</a> : '—'}</td>
            <td>{said(m.reason)}</td>
            <td><Who handle={m.by_handle} /></td>
            <td>{m.public ? 'public' : 'private'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <div class="in"><p>nothing yet.</p></div>
  )

/** What a report points at: the node and post (admin pages, and the public page), a DM, or the address as given. */
const ReportTarget: FC<{ r: ReportRow }> = ({ r }) => {
  if (isDmReport(r)) return <span>direct message {r.url!.slice(3)}</span>
  if (r.post_id && r.node_path)
    return (
      <span>
        post <a href={postAdmin(r.post_id)}>{r.post_id}</a> by {said(r.post_by)} in <a href={nodeAdmin(r.node_path)}>{r.node_path}</a>
        {r.post_hidden ? <span class="mk"> hidden</span> : null}
        {r.post_deleted ? <span class="mk"> deleted</span> : null}
      </span>
    )
  if (r.node_path)
    return (
      <span>
        <a href={nodeAdmin(r.node_path)}>{r.node_path}</a>
        {r.node_hidden ? <span class="mk"> hidden</span> : null}
      </span>
    )
  return <code>{said(r.url ?? '—')}</code>
}

const ReportFrom: FC<{ r: ReportRow }> = ({ r }) => (
  <span>
    {r.by_handle ? <Who handle={r.by_handle} /> : 'signed out'}
    {r.contact && <> · <code>{said(r.contact)}</code></>}
  </span>
)

/** One report as the queue and the node and post pages list it: reason, copyright mark, target, who, the words. */
const ReportItem: FC<{ r: ReportRow; token?: string }> = ({ r, token }) => (
  <li class="rep">
    <div class="rhead">
      <a href={reportAdmin(r.id)}>report {r.id}</a> · {reasonLabel(r)}
      {r.kind === 'copyright' && <b class="flag-cr"> copyright notice</b>}
      {r.resolved_at ? <span class="mk"> resolved {when(r.resolved_at)}</span> : <span class="mk"> open</span>}
    </div>
    <div class="meta">
      <ReportTarget r={r} /> · from <ReportFrom r={r} /> · {when(r.created_at)}
    </div>
    {r.text ? <pre class="said">{said(r.text)}</pre> : <p class="note">no words added.</p>}
    {r.resolved_at && r.resolution && <p class="note">resolution: {said(r.resolution)}</p>}
    {token && !r.resolved_at && (
      <ActForm action={reportAdmin(r.id)} token={token} act="resolve">
        <input type="hidden" name="back" value="queue" />
        <ReasonField id={`resolve-${r.id}`} pub={false} />
        <Go label="resolve" plain />
      </ActForm>
    )}
  </li>
)

// ---------- the queue ----------

const triageNote = (t: TriageRow) => {
  if (!t.answer) return 'not checked yet'
  if (t.answer === 'error') return `error: ${t.reason ?? ''}`
  if (t.model === 'myra') return parseBlockReason(t.reason)?.category ?? (t.reason || '')
  return `${t.answer}${t.reason ? `: ${t.reason}` : ''}`
}

const TriageBox: FC<{ rows: TriageRow[] }> = ({ rows }) => (
  <Box id="triage" title="triage" count={rows.length}>
    <div class="in">
      <p>held nodes, and launch shwarms the model flagged or couldn't check. those stay public while they wait.</p>
    </div>
    {rows.length ? (
      <table class="q">
        <thead>
          <tr><th>node</th><th>title</th><th>triage</th><th>model said</th><th>made</th></tr>
        </thead>
        <tbody>
          {rows.map(t => (
            <tr>
              <td><a href={nodeAdmin(t.path)}>{t.path}</a></td>
              <td>{firstLine(t.title, 60)}</td>
              <td>{t.triage}{t.seeded ? ' (launch, public)' : ''}</td>
              <td>{firstLine(triageNote(t), 70)}</td>
              <td class="day">{when(t.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <div class="in"><p>nothing waits on triage.</p></div>
    )}
  </Box>
)

// The schema has no appeal yet: triage_decision.is_appeal exists, but nothing writes it and no page takes an appeal.
const AppealsBox: FC = () => (
  <Box id="appeals" title="appeals">
    <div class="in">
      <p>appeals aren't built yet. when they are, they show here.</p>
    </div>
  </Box>
)

const FlagsBox: FC<{ rows: FlagRow[] }> = ({ rows }) => (
  <Box id="flags" title="flags" count={rows.length}>
    <div class="in">
      <p>nodes with open flags, and paused nodes first. three open flags from established accounts pause a node.</p>
    </div>
    {rows.length ? (
      <table class="q">
        <thead>
          <tr><th>node</th><th>title</th><th>state</th><th class="num">open</th><th class="num">established</th><th>reasons</th><th>by</th><th>last</th></tr>
        </thead>
        <tbody>
          {rows.map(f => (
            <tr>
              <td><a href={nodeAdmin(f.path)}>{f.path}</a></td>
              <td>{firstLine(f.title, 60)}</td>
              <td>{f.paused ? <b>paused</b> : '—'}</td>
              <td class="num">{f.open}</td>
              <td class="num">{f.established}</td>
              <td>{f.reasons ?? '—'}</td>
              <td>{f.by_handles ?? '—'}</td>
              <td class="day">{when(f.last)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <div class="in"><p>no open flags, and nothing is paused.</p></div>
    )}
  </Box>
)

const ReportsBox: FC<{ rows: ReportRow[]; token: string }> = ({ rows, token }) => (
  <Box id="reports" title="reports" count={rows.length}>
    <div class="in">
      <p>open reports: post reports, the report form, direct messages and copyright notices. what the reporter wrote shows only here.</p>
    </div>
    {rows.length ? (
      <ol class="reps">
        {rows.map(r => (
          <ReportItem r={r} token={token} />
        ))}
      </ol>
    ) : (
      <div class="in"><p>no open reports.</p></div>
    )}
  </Box>
)

const QueuePage: FC<{ q: Queue; token: string; notice?: string }> = ({ q, token, notice }) => (
  <AdminPage title="queue" here="/admin" notice={notice}>
    <form method="get" action="/admin/node" class="find">
      <label for="find-path">a node by path</label>
      <input id="find-path" name="path" type="text" placeholder="minecraft-in-doom/block-placement" spellcheck={false} autocapitalize="off" />
      <button class="btn plain" type="submit">open</button>
    </form>
    <TriageBox rows={q.triage} />
    <AppealsBox />
    <FlagsBox rows={q.flags} />
    <ReportsBox rows={q.reports} token={token} />
  </AdminPage>
)

// ---------- one node ----------

const NODE_DONE: Record<NodeAct, string> = {
  hide: 'hidden. its page answers 410 with your reason.',
  unhide: 'restored. it shows as before.',
  clear: 'cleared. it shows to everyone.',
  block: 'blocked. only its author sees it.',
  unpause: 'unpaused. its open flags are resolved.',
  resolve_flags: 'resolved.',
}

const NodeFacts: FC<{ n: AdminNode }> = ({ n }) => (
  <Box title={n.kind === 'branch' ? 'branch' : 'shwarm'}>
    <dl class="facts">
      <dt>path</dt><dd><code>{n.path}</code> · <a href={`/w/${n.path}`}>public page</a></dd>
      <dt>title</dt><dd>{said(n.title)}</dd>
      <dt>author</dt><dd><Who handle={n.author_handle} />{n.author_status !== 'active' && <span class="mk"> {n.author_status}</span>}</dd>
      <dt>state</dt><dd>{n.state}</dd>
      <dt>triage</dt><dd>{n.triage}{n.seeded ? ' (launch shwarm)' : ''}</dd>
      <dt>hidden</dt><dd>{n.hidden ? <b>hidden</b> : 'no'}</dd>
      <dt>paused</dt><dd>{n.paused ? <b>paused</b> : 'no'}</dd>
      <dt>made</dt><dd>{when(n.created_at)}</dd>
    </dl>
    <div class="in">
      <pre class="said">{said(n.what)}</pre>
    </div>
  </Box>
)

const NodeActs: FC<{ v: NodeView; token: string }> = ({ v, token }) => {
  const n = v.node
  const word = n.kind === 'branch' ? 'branch' : 'shwarm'
  const action = nodeAdmin(n.path)
  const open = v.flags.filter(f => !f.resolved_at)
  return (
    <Box id="acts" title="acts">
      <div class="acts-grid">
        <ActForm action={action} token={token} act={n.hidden ? 'unhide' : 'hide'}>
          <h3>{n.hidden ? `restore this ${word}` : `hide this ${word}`}</h3>
          <p class="hint">{n.hidden ? 'it shows again where it did before.' : 'its page and its branches answer 410 with your reason, or 404 if the public never saw it.'}</p>
          <ReasonField id="r-hide" pub />
          <Go label={n.hidden ? 'restore' : 'hide'} />
        </ActForm>
        {n.triage !== 'clear' && (
          <ActForm action={action} token={token} act="clear">
            <h3>clear triage</h3>
            <p class="hint">it shows to everyone.</p>
            <ReasonField id="r-clear" pub />
            <Go label="clear" />
          </ActForm>
        )}
        {n.triage !== 'blocked' && (
          <ActForm action={action} token={token} act="block">
            <h3>block it</h3>
            <p class="hint">only its author sees it, with the category.</p>
            <div class="f">
              <label for="r-category">category</label>
              <select id="r-category" name="category" required>
                <option value="">pick one</option>
                {CATEGORIES.map(k => (
                  <option value={k}>{CATEGORY_LABEL[k]}</option>
                ))}
              </select>
            </div>
            <ReasonField id="r-block" pub />
            <Go label="block" />
          </ActForm>
        )}
        {n.paused ? (
          <ActForm action={action} token={token} act="unpause">
            <h3>unpause</h3>
            <p class="hint">it takes writes again, and its open flags are resolved, so the count starts over.</p>
            <ReasonField id="r-unpause" pub />
            <Go label="unpause" />
          </ActForm>
        ) : null}
        {open.length > 0 && (
          <ActForm action={action} token={token} act="resolve_flags">
            <h3>resolve flags</h3>
            <p class="hint">a pause stays until you unpause.</p>
            <div class="f">
              <label for="r-flag">which</label>
              <select id="r-flag" name="flag">
                <option value="all">all {open.length} open</option>
                {open.map(f => (
                  <option value={String(f.id)}>flag {f.id}: {f.reason}, @{f.by_handle}</option>
                ))}
              </select>
            </div>
            <ReasonField id="r-flags" pub={false} />
            <Go label="resolve" plain />
          </ActForm>
        )}
      </div>
    </Box>
  )
}

const NodePage: FC<{ v: NodeView; token: string; notice?: string; error?: string }> = ({ v, token, notice, error }) => (
  <AdminPage title={v.node.path} notice={notice} error={error}>
    <NodeFacts n={v.node} />
    <NodeActs v={v} token={token} />
    <Box id="flags" title="flags" count={v.flags.length}>
      {v.flags.length ? (
        <table class="q">
          <thead><tr><th>flag</th><th>reason</th><th>by</th><th>when</th><th>resolved</th></tr></thead>
          <tbody>
            {v.flags.map(f => (
              <tr><td>{f.id}</td><td>{f.reason}</td><td><Who handle={f.by_handle} /></td><td class="day">{when(f.created_at)}</td><td class="day">{f.resolved_at ? when(f.resolved_at) : 'open'}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div class="in"><p>no flags.</p></div>
      )}
    </Box>
    <Box id="reports" title="reports" count={v.reports.length}>
      {v.reports.length ? <ol class="reps">{v.reports.map(r => <ReportItem r={r} />)}</ol> : <div class="in"><p>no reports.</p></div>}
    </Box>
    <Box id="decisions" title="triage decisions">
      {v.decisions.length ? (
        <table class="q">
          <thead><tr><th>when</th><th>by</th><th>answer</th><th>reason</th></tr></thead>
          <tbody>
            {v.decisions.map(d => (
              <tr><td class="day">{when(d.created_at)}</td><td>{d.model}</td><td>{d.answer}</td><td>{said(d.reason)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div class="in"><p>no decisions yet.</p></div>
      )}
    </Box>
    <Box id="posts" title="posts" count={v.posts.length}>
      <div class="in"><p>the newest 50, hidden ones too. open one to hide it or remove a link.</p></div>
      {v.posts.length ? (
        <table class="q">
          <thead><tr><th>post</th><th>by</th><th>kind</th><th>text</th><th>when</th></tr></thead>
          <tbody>
            {v.posts.map(p => (
              <tr>
                <td><a href={postAdmin(p.id)}>{p.id}</a>{p.hidden ? <span class="mk"> hidden</span> : null}{p.deleted_at ? <span class="mk"> deleted</span> : null}</td>
                <td><a href={personAdmin(handleOfName(p.as_name))}>{said(p.as_name)}</a></td>
                <td>{p.kind}</td>
                <td>{firstLine(p.text, 70)}</td>
                <td class="day">{when(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div class="in"><p>no posts.</p></div>
      )}
    </Box>
    <Box id="log" title="moderation log">
      <LogRows rows={v.actions} />
    </Box>
  </AdminPage>
)

// ---------- one post ----------

const POST_DONE: Record<PostAct, string> = {
  hide: "hidden. it's gone from the thread.",
  unhide: 'restored. it shows in the thread again.',
  remove_link: 'link removed.',
}

/** A stored link as plain text: never followed from here. */
const linkText = (l: PostLink) =>
  typeof l.url === 'string'
    ? `${l.url}${typeof l.sha256 === 'string' ? ` sha256 ${l.sha256}` : ''}`
    : typeof l.repo === 'string'
      ? `${l.repo} @ ${String(l.commit ?? '')}${typeof l.path === 'string' ? ` ${l.path}` : ''}`
      : JSON.stringify(l)

const PostPage: FC<{ v: PostView; token: string; notice?: string; error?: string }> = ({ v, token, notice, error }) => {
  const p = v.post
  const action = postAdmin(p.id)
  return (
    <AdminPage title={p.id} notice={notice} error={error}>
      <Box title={p.kind === 'post' ? 'post' : p.kind}>
        <dl class="facts">
          <dt>in</dt><dd><a href={nodeAdmin(p.node_path)}>{p.node_path}</a> · <a href={`/w/${p.node_path}#${p.id}`}>public page</a></dd>
          {/* OPEN (#107): new wording, "account". */}
          <dt>by</dt><dd>{said(p.as_name)} · <a href={personAdmin(handleOfName(p.as_name))}>account</a></dd>
          <dt>posted</dt><dd>{when(p.created_at)}</dd>
          <dt>hidden</dt><dd>{p.hidden ? <b>hidden</b> : 'no'}</dd>
          {p.deleted_at && <><dt>deleted</dt><dd>{when(p.deleted_at)} by its poster</dd></>}
        </dl>
        <div class="in">{p.text ? <pre class="said">{said(p.text)}</pre> : <p class="note">no text.</p>}</div>
      </Box>
      <Box id="acts" title="acts">
        <div class="acts-grid">
          <ActForm action={action} token={token} act={p.hidden ? 'unhide' : 'hide'}>
            <h3>{p.hidden ? 'restore this post' : 'hide this post'}</h3>
            <p class="hint">{p.hidden ? 'it shows in the thread again.' : 'it leaves the thread for everyone. its row on the public log says why.'}</p>
            <ReasonField id="r-hide" pub />
            <Go label={p.hidden ? 'restore' : 'hide'} />
          </ActForm>
        </div>
      </Box>
      <Box id="links" title="links" count={p.links.length}>
        {p.links.length ? (
          <ol class="links-list">
            {p.links.map((l, i) => (
              <li>
                <code>{said(linkText(l))}</code>
                <ActForm action={action} token={token} act="remove_link">
                  <input type="hidden" name="link" value={String(i)} />
                  <input type="hidden" name="was" value={JSON.stringify(l)} />
                  <ReasonField id={`r-link-${i}`} pub />
                  <Go label="remove this link" plain />
                </ActForm>
              </li>
            ))}
          </ol>
        ) : (
          <div class="in"><p>no links.</p></div>
        )}
      </Box>
      <Box id="reports" title="reports" count={v.reports.length}>
        {v.reports.length ? <ol class="reps">{v.reports.map(r => <ReportItem r={r} />)}</ol> : <div class="in"><p>no reports.</p></div>}
      </Box>
      <Box id="log" title="moderation log">
        <LogRows rows={v.actions} />
      </Box>
    </AdminPage>
  )
}

// ---------- one report ----------

const ReportPage: FC<{ r: ReportRow; token: string; notice?: string; error?: string }> = ({ r, token, notice, error }) => (
  <AdminPage title={`report ${r.id}`} notice={notice} error={error}>
    <Box title="report">
      <dl class="facts">
        <dt>what's wrong</dt><dd>{reasonLabel(r)}{r.kind === 'copyright' && <b class="flag-cr"> copyright notice</b>}</dd>
        <dt>about</dt><dd><ReportTarget r={r} /></dd>
        {r.url && !isDmReport(r) && <><dt>address</dt><dd><code>{said(r.url)}</code></dd></>}
        <dt>from</dt><dd><ReportFrom r={r} /></dd>
        <dt>sent</dt><dd>{when(r.created_at)}</dd>
        <dt>state</dt><dd>{r.resolved_at ? `resolved ${when(r.resolved_at)}` : 'open'}</dd>
      </dl>
      <div class="in">{r.text ? <pre class="said">{said(r.text)}</pre> : <p class="note">no words added.</p>}</div>
    </Box>
    <Box id="acts" title={r.resolved_at ? 'resolution' : 'resolve'}>
      {r.resolved_at ? (
        <div class="in"><p>{said(r.resolution ?? '')}</p></div>
      ) : (
        <ActForm action={reportAdmin(r.id)} token={token} act="resolve">
          <div class="in"><p>resolving changes nothing public. to hide something, open it above first.</p></div>
          <ReasonField id="r-resolve" pub={false} />
          <Go label="resolve" />
        </ActForm>
      )}
    </Box>
  </AdminPage>
)

// ---------- routes ----------

/** The gate, then the session; `stop` is the response to send instead. */
async function gate(c: C): Promise<{ s: Session; stop?: undefined } | { stop: Response }> {
  const g = await adminGate(c)
  return 'stop' in g ? { stop: g.stop } : { s: g.session }
}

const tokenFor = (c: C, s: Session) => formToken(c.env.CSRF_SECRET, s.id)

/** The posted form, when its token is good. */
async function postedForm(c: C): Promise<Record<string, string> | null> {
  const ac = c as unknown as AuthContext
  const f = await formOf(c)
  return (await postedTokenOk(ac, await who(ac), f)) ? f : null
}

const expired = (c: C) => page(c, <FormExpiredPage />, 403)
const notHere = (c: C, what: string) => page(c, <AdminPage title="not found" error={what} />, 404)

adminQueue.get('/admin', async c => {
  const g = await gate(c)
  if (g.stop) return g.stop
  const q = await readQueue(c.env.DB)
  return page(c, <QueuePage q={q} token={await tokenFor(c, g.s)} notice={c.req.query('done') === 'resolve' ? 'report resolved.' : undefined} />)
})

adminQueue.get('/admin/node', async c => {
  const g = await gate(c)
  if (g.stop) return g.stop
  const path = (c.req.query('path') ?? '').trim().replace(/^\/?(w\/)?/, '').replace(/\/+$/, '')
  const v = await readNodeView(c.env.DB, path)
  if (!v) return notHere(c, 'there is no node at that path.')
  return page(c, <NodePage v={v} token={await tokenFor(c, g.s)} notice={doneOf(NODE_DONE, c.req.query('done'))} />)
})

adminQueue.post('/admin/node', async c => {
  const g = await gate(c)
  if (g.stop) return g.stop
  const f = await postedForm(c)
  if (!f) return expired(c)
  const path = c.req.query('path') ?? ''
  try {
    const act = await actOnNode(c.env.DB, { personId: g.s.personId, handle: g.s.handle }, path, f.do, f)
    return c.redirect(`${nodeAdmin(path)}&done=${act}`, 303)
  } catch (e) {
    if (!(e instanceof AdminError)) throw e
    const v = await readNodeView(c.env.DB, path)
    if (!v) return notHere(c, e.message)
    return page(c, <NodePage v={v} token={await tokenFor(c, g.s)} error={e.message} />, 400)
  }
})

adminQueue.get('/admin/post', async c => {
  const g = await gate(c)
  if (g.stop) return g.stop
  const v = await readPostView(c.env.DB, (c.req.query('id') ?? '').trim())
  if (!v) return notHere(c, 'there is no post with that id.')
  return page(c, <PostPage v={v} token={await tokenFor(c, g.s)} notice={doneOf(POST_DONE, c.req.query('done'))} />)
})

adminQueue.post('/admin/post', async c => {
  const g = await gate(c)
  if (g.stop) return g.stop
  const f = await postedForm(c)
  if (!f) return expired(c)
  const id = c.req.query('id') ?? ''
  try {
    const act = await actOnPost(c.env.DB, { personId: g.s.personId, handle: g.s.handle }, id, f.do, f)
    return c.redirect(`${postAdmin(id)}&done=${act}`, 303)
  } catch (e) {
    if (!(e instanceof AdminError)) throw e
    const v = await readPostView(c.env.DB, id)
    if (!v) return notHere(c, e.message)
    return page(c, <PostPage v={v} token={await tokenFor(c, g.s)} error={e.message} />, 400)
  }
})

const reportId = (c: C) => {
  const raw = c.req.query('id') ?? ''
  return /^\d{1,15}$/.test(raw) ? Number(raw) : 0
}

adminQueue.get('/admin/report', async c => {
  const g = await gate(c)
  if (g.stop) return g.stop
  const r = await readReport(c.env.DB, reportId(c))
  if (!r) return notHere(c, 'there is no report with that number.')
  return page(c, <ReportPage r={r} token={await tokenFor(c, g.s)} notice={c.req.query('done') === 'resolve' ? 'report resolved.' : undefined} />)
})

adminQueue.post('/admin/report', async c => {
  const g = await gate(c)
  if (g.stop) return g.stop
  const f = await postedForm(c)
  if (!f) return expired(c)
  const id = reportId(c)
  try {
    if (f.do !== 'resolve') throw new AdminError('pick an act.')
    await resolveReport(c.env.DB, { personId: g.s.personId, handle: g.s.handle }, id, f)
    return c.redirect(f.back === 'queue' ? '/admin?done=resolve#reports' : `${reportAdmin(id)}&done=resolve`, 303)
  } catch (e) {
    if (!(e instanceof AdminError)) throw e
    const r = await readReport(c.env.DB, id)
    if (!r) return notHere(c, e.message)
    return page(c, <ReportPage r={r} token={await tokenFor(c, g.s)} error={e.message} />, 400)
  }
})
