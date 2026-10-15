// /admin/people: account lookup and the acts on an account (go-live 9.4; the logic is core/admin-accounts.ts).
//   GET  /admin/people?q=<handle or email>   the account: status, verified, founding, established, admin, joined; the mail
//                                             sent to its address (last 20) and its suppression and allow-list rows; its
//                                             sessions (when, never a token), keys, the flags and reports it made, and the
//                                             admin acts on it. An address with no account shows its mail rows only.
//   POST /admin/people?q=…                   one act (do=…), with a required reason; back to the lookup with ?done=
// Behind the admin gate (web/admin-gate.ts: active admins only, everyone else a 404; the password step-up on every page
// and act) and the form token. Each act writes one moderation_action row in its own batch.
// The design is the keys page's: boxes for the parts, a table in each, the acts in the sidebar. OPEN (#107): every word on
// this page is new wording.
import { Hono, type Context } from 'hono'
import type { FC } from 'hono/jsx'
import { formToken } from '../auth/csrf'
import { formOf, postedTokenOk, who, type AuthContext } from '../auth/request'
import { MOD_REASON_MAX, modReason } from '../core/moderation'
import {
  accountAct,
  accountView,
  findTarget,
  isAccountAct,
  newOnce,
  OUTBOX_SHOWN,
  PUBLIC_ACTS,
  type AccountAct,
  type AccountView,
} from '../core/admin-accounts'
import { exact } from '../render/format'
import { adminGate, type AdminEnv } from './admin-gate'
import { AdminNav } from './admin-nav'
import { sendError } from './errors'
import { Layout } from './layout'
import { page } from './viewer'

type Env = { Bindings: AdminEnv & { CSRF_SECRET: string; ENV: string; PASSWORD_PEPPER: string; SITE_MODE?: string } }
type C = Context<Env>

export const adminAccounts = new Hono<Env>()

const PATH = '/admin/people'

// ---------- words (OPEN (#107): new wording, all of them) ----------

/** Each act: its heading, what it does, and its button. */
const ACTS: Record<AccountAct, { title: string; what: string; button: string; warn?: boolean }> = {
  // OPEN (#107): new wording.
  resend_verify: { title: 'resend the verify mail', what: 'a new link, which replaces the old ones. the account mail caps still hold.', button: 'resend' },
  mark_verified: {
    title: 'mark email verified',
    what: 'only when you know the address is theirs. it ends their sessions, and an address on the allow-list makes them founding.',
    button: 'mark verified',
  },
  unsuppress: { title: 'take off the suppression list', what: 'mail goes to this address again. it was stopped after a bounce or a complaint.', button: 'unsuppress' },
  end_sessions: { title: 'end sessions', what: 'signs them out everywhere. a pending email change ends too.', button: 'end sessions' },
  allow_add: { title: 'add to the allow-list', what: 'they can join while sign-up is invite-only, and are founding once verified. the reason is kept as the invite note.', button: 'add' },
  allow_remove: { title: 'remove from the allow-list', what: "an account already made stays as it is.", button: 'remove' },
  founding: { title: 'make founding', what: 'founding accounts are established at once and can act in the beta.', button: 'make founding' },
  unfounding: { title: 'remove founding', what: "they're established again only with an upvoted post and a week since joining.", button: 'remove founding' },
  suspend: {
    title: 'suspend',
    what: 'ends their sessions, revokes their keys and mails them the reason.',
    button: 'suspend',
    warn: true,
  },
  unsuspend: { title: 'unsuspend', what: 'they can sign in again. their keys stay revoked.', button: 'unsuspend' },
}

/** What ?done= says. OPEN (#107): new wording. */
const DONE: Record<AccountAct, string> = {
  resend_verify: 'a new verify mail is queued.',
  mark_verified: 'their email is marked verified.',
  unsuppress: 'the address is off the suppression list.',
  end_sessions: 'their sessions are ended.',
  allow_add: 'the address is on the allow-list.',
  allow_remove: 'the address is off the allow-list.',
  founding: 'they are founding now.',
  unfounding: "they aren't founding now.",
  suspend: 'suspended. their sessions ended, their keys are revoked and the mail is queued.',
  unsuspend: 'unsuspended. they can sign in again.',
}

const REASON_NEEDED = `give a reason: one line, up to ${MOD_REASON_MAX} characters.` // OPEN (#107)

// ---------- the page ----------
// OPEN (#107): new wording: every word in the components below.

type Flash = { act: AccountAct; error: string }
type View = { q: string; me: number; token: string; found: AccountView | null; done?: string; flash?: Flash; now: number }

const When: FC<{ at: string | null; none?: string }> = ({ at, none = '—' }) => <span class="day">{at ? exact(at) : none}</span>

const yesNo = (v: number | boolean) => (v ? 'yes' : 'no')

const AccountBox: FC<{ v: AccountView }> = ({ v }) => {
  const p = v.target.person!
  return (
    <div class="box">
      <h2>account <span>@{p.handle}</span></h2>
      <table class="pt kv">
        <tbody>
          <tr><th scope="row">handle</th><td>{p.status === 'active' ? <a href={`/@${p.handle}`}>@{p.handle}</a> : <>@{p.handle}</>}{p.display_name && <span class="sub">{p.display_name}</span>}</td></tr>
          <tr><th scope="row">status</th><td><b class={p.status === 'active' ? undefined : 'off'}>{p.status}</b>{p.closed_at && <span class="sub">closed <When at={p.closed_at} /></span>}</td></tr>
          <tr><th scope="row">email</th><td>{p.email ? <code>{p.email}</code> : <span class="note">none left</span>}</td></tr>
          <tr><th scope="row">verified</th><td>{p.email_verified_at ? <When at={p.email_verified_at} /> : <b class="off">not verified</b>}</td></tr>
          <tr><th scope="row">founding</th><td>{yesNo(p.founding)}</td></tr>
          <tr><th scope="row">established</th><td><When at={p.established_at} none="not yet" /></td></tr>
          <tr><th scope="row">admin</th><td>{yesNo(p.is_admin)}</td></tr>
          <tr><th scope="row">joined</th><td><When at={p.created_at} />{v.waiting && <span class="sub">joined from off the allow-list: waiting for shwarm to open</span>}</td></tr>
        </tbody>
      </table>
    </div>
  )
}

const MailBox: FC<{ v: AccountView }> = ({ v }) => (
  <div class="box">
    <h2>mail <span>{v.target.email ?? 'no address'}</span></h2>
    <div class="in">
      <p>
        suppression list:{' '}
        {v.suppression ? <b class="off">on it ({v.suppression.reason}) since <When at={v.suppression.created_at} /></b> : 'not on it.'}
        {v.suppression && <span class="sub">only security mail goes to it. verify mail doesn't.</span>}
      </p>
      <p>
        allow-list:{' '}
        {v.allow ? (
          <>
            on it since <When at={v.allow.added_at} />
            {v.allow.note && <> · <i>{v.allow.note}</i></>}
            {v.allow.used_at && <> · used <When at={v.allow.used_at} /></>}
          </>
        ) : (
          'not on it.'
        )}
      </p>
    </div>
    {v.outbox.length ? (
      <table class="pt">
        <thead><tr><th>mail</th><th>written</th><th>where it stands</th></tr></thead>
        <tbody>
          {v.outbox.map(m => (
            <tr>
              <td><code>{m.template}</code><span class="sub">{m.stream}</span></td>
              <td><When at={m.created_at} /></td>
              <td>
                <b class={m.state === 'sent' ? undefined : 'off'}>{m.state}</b>
                {m.sent_at && m.state !== 'sent' && <> <When at={m.sent_at} /></>}
                {m.state === 'sent' && <> <When at={m.sent_at} /></>}
                {m.attempts > 1 && <span class="sub">{m.attempts} tries</span>}
                {m.last_error && <span class="sub err">{m.last_error}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p class="in note">no mail to this address.</p>
    )}
    {v.outbox.length === OUTBOX_SHOWN && <p class="in note">the newest {OUTBOX_SHOWN}.</p>}
  </div>
)

const SessionsBox: FC<{ v: AccountView }> = ({ v }) => (
  <div class="box">
    <h2>sessions <span>{v.sessions.length ? `${v.sessions.length} signed in` : 'none'}</span></h2>
    {v.sessions.length ? (
      <table class="pt">
        <thead><tr><th>browser</th><th>signed in</th><th>last seen</th></tr></thead>
        <tbody>
          {v.sessions.map(s => (
            <tr><td>{s.browser ?? <span class="note">unknown</span>}</td><td><When at={s.created_at} /></td><td><When at={s.last_seen_at} /></td></tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p class="in note">not signed in anywhere.</p>
    )}
  </div>
)

const KeysBox: FC<{ v: AccountView; now: number }> = ({ v, now }) => (
  <div class="box">
    <h2>agent keys <span>{v.keys.length || 'none'}</span></h2>
    {v.keys.length ? (
      <table class="pt">
        <thead><tr><th>key</th><th>can post as</th><th>last used</th><th>state</th></tr></thead>
        <tbody>
          {v.keys.map(k => {
            const expired = !k.revoked_at && k.expires_at !== null && Date.parse(k.expires_at) <= now
            return (
              <tr class={k.revoked_at || expired ? 'gone' : undefined}>
                <td>{k.name}<span class="sub"><code>{k.id}</code></span></td>
                <td><code>{k.can_post_as}</code></td>
                <td><When at={k.last_used_at} none="not used yet" /></td>
                <td>{k.revoked_at ? <>revoked <When at={k.revoked_at} /></> : expired ? <>expired <When at={k.expires_at} /></> : 'works'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    ) : (
      <p class="in note">no keys.</p>
    )}
  </div>
)

/** Where a flag or report points: the node, the post on it, or the address given. Links go to the queue's admin
 * pages (web/admin-queue.tsx), where the acts on them are. */
const Where: FC<{ path: string | null; post: string | null; url?: string | null }> = ({ path, post, url }) =>
  path ? (
    <>
      <a href={`/admin/node?path=${encodeURIComponent(path)}`}>{path}</a>
      {post && <span class="sub"><a href={`/admin/post?id=${encodeURIComponent(post)}`}><code>{post}</code></a></span>}
    </>
  ) : url ? (
    <code>{url}</code>
  ) : (
    <span class="note">—</span>
  )

const MadeBox: FC<{ v: AccountView }> = ({ v }) => (
  <div class="box">
    <h2>flags and reports they made <span>{v.flags.length + v.reports.length || 'none'}</span></h2>
    {v.flags.length + v.reports.length ? (
      <table class="pt">
        <thead><tr><th>what</th><th>on</th><th>when</th><th>state</th></tr></thead>
        <tbody>
          {v.flags.map(f => (
            <tr><td>flag<span class="sub">{f.reason}</span></td><td><Where path={f.path} post={f.post_id} /></td><td><When at={f.created_at} /></td><td>{f.resolved_at ? 'resolved' : 'open'}</td></tr>
          ))}
          {v.reports.map(r => (
            <tr><td><a href={`/admin/report?id=${r.id}`}>report</a><span class="sub">{r.reason ?? r.kind}</span></td><td><Where path={r.path} post={r.post_id} url={r.url} /></td><td><When at={r.created_at} /></td><td>{r.resolved_at ? 'resolved' : 'open'}</td></tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p class="in note">none.</p>
    )}
  </div>
)

const HistoryBox: FC<{ v: AccountView }> = ({ v }) => (
  <div class="box">
    <h2>admin acts on this account <span>{v.history.length || 'none'}</span></h2>
    {v.history.length ? (
      <table class="pt">
        <thead><tr><th>act</th><th>reason</th><th>by</th><th>when</th></tr></thead>
        <tbody>
          {v.history.map(h => (
            <tr>
              <td>{h.action.replace(/_/g, ' ')}<span class="sub">{h.public ? 'public' : 'private'}</span></td>
              <td>{h.reason}</td>
              <td>{h.by ? `@${h.by}` : '—'}</td>
              <td><When at={h.created_at} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p class="in note">none yet.</p>
    )}
  </div>
)

/** The acts that make sense for what was found right now. */
function actsFor(v: AccountView, me: number): AccountAct[] {
  const p = v.target.person
  const out: AccountAct[] = []
  if (p && p.status !== 'closed') {
    if (!p.email_verified_at && p.status === 'active') out.push('resend_verify')
    if (!p.email_verified_at) out.push('mark_verified')
  }
  if (v.target.email) {
    if (v.suppression) out.push('unsuppress')
    out.push(v.allow ? 'allow_remove' : 'allow_add')
  }
  if (p && p.status !== 'closed') {
    if (v.sessions.length) out.push('end_sessions')
    out.push(p.founding ? 'unfounding' : 'founding')
    if (p.status === 'active' && p.id !== me) out.push('suspend')
    if (p.status === 'suspended') out.push('unsuspend')
  }
  return out
}

const ActForm: FC<{ act: AccountAct; v: View; found: AccountView }> = ({ act, v, found }) => {
  const a = ACTS[act]
  const p = found.target.person
  const err = v.flash?.act === act ? v.flash.error : undefined
  const id = `r-${act}`
  return (
    <details class="pact" open={err ? true : undefined}>
      <summary>{a.title}</summary>
      <form method="post" action={`${PATH}?q=${encodeURIComponent(v.q)}`}>
        <input type="hidden" name="form_token" value={v.token} />
        <input type="hidden" name="do" value={act} />
        <input type="hidden" name="once" value={newOnce()} />
        {p ? <input type="hidden" name="person" value={String(p.id)} /> : <input type="hidden" name="email" value={found.target.email ?? ''} />}
        <p class="note">{a.what}</p>
        <label for={id}>reason</label>
        <input id={id} type="text" name="reason" maxlength={MOD_REASON_MAX} required autocomplete="off" aria-describedby={`${id}-h`} aria-invalid={err ? 'true' : undefined} />
        <p class="note" id={`${id}-h`}>{PUBLIC_ACTS.has(act) ? 'shows on the public moderation log.' : 'kept in the private log.'}</p>
        {err && <p class="err" role="alert">{err}</p>}
        <div class="go">
          <button class={a.warn ? 'btn sm warn' : 'btn sm'} type="submit">{a.button}</button>
          <span class="note">confirms with your password.</span>
        </div>
      </form>
    </details>
  )
}

const PeoplePage: FC<{ v: View }> = ({ v }) => {
  const f = v.found
  const acts = f ? actsFor(f, v.me) : []
  return (
    <Layout title="people · admin · shwarm" noindex>
      <link rel="stylesheet" href="/css/admin-accounts.css" />
      <div class="people">
        <h1 class="title">people</h1>
        <AdminNav here={PATH} />
        <p class="lede">look up an account by handle or email. every act needs a reason and goes to the moderation log.</p>
        {v.done && <p class="msg ok" role="status">{v.done}</p>}
        {v.flash && <p class="msg" role="alert">{ACTS[v.flash.act].title}: {v.flash.error}</p>}
        <div class="grid">
          <main id="main" tabindex={-1}>
            <form class="box plook" method="get" action={PATH} role="search">
              <h2>look up</h2>
              <div class="in">
                <label for="q">handle or email</label>
                <div class="row">
                  <input id="q" type="text" name="q" value={v.q} maxlength={254} autocomplete="off" spellcheck={false} autocapitalize="off" required />
                  <button class="btn sm" type="submit">look up</button>
                </div>
              </div>
            </form>
            {v.q && !f && <p class="msg" role="status">no account has that handle.</p>}
            {f && !f.target.person && <p class="msg" role="status">no account has this address. what shwarm holds for it is below.</p>}
            {f?.target.person && <AccountBox v={f} />}
            {f?.target.email && <MailBox v={f} />}
            {f?.target.person && (
              <>
                <SessionsBox v={f} />
                <KeysBox v={f} now={v.now} />
                <MadeBox v={f} />
                <HistoryBox v={f} />
              </>
            )}
          </main>
          <aside>
            {f && (
              <div class="box pacts">
                <h2>acts <span>{f.target.person ? `@${f.target.person.handle}` : f.target.email}</span></h2>
                {acts.length ? acts.map(a => <ActForm act={a} v={v} found={f} />) : <p class="in note">nothing to do here.</p>}
              </div>
            )}
          </aside>
        </div>
      </div>
    </Layout>
  )
}

// ---------- routes ----------

async function render(c: C, me: { personId: number; id: string }, o: { q: string; done?: string; flash?: Flash }, status: 200 | 400 = 200) {
  const db = c.env.DB
  const target = o.q ? await findTarget(db, o.q) : null
  const found = target ? await accountView(db, target) : null
  const token = await formToken(c.env.CSRF_SECRET, me.id)
  return page(c, <PeoplePage v={{ q: o.q, me: me.personId, token, found, done: o.done, flash: o.flash, now: Date.now() }} />, status)
}

const qOf = (c: C) => (c.req.query('q') ?? '').trim().slice(0, 254)

adminAccounts.get(PATH, async c => {
  const g = await adminGate(c)
  if ('stop' in g) return g.stop
  const done = c.req.query('done')
  return render(c, g.session, { q: qOf(c), done: isAccountAct(done) ? DONE[done] : undefined })
})

adminAccounts.post(PATH, async c => {
  const g = await adminGate(c)
  if ('stop' in g) return g.stop
  const ac = c as unknown as AuthContext
  const f = await formOf(c)
  if (!(await postedTokenOk(ac, await who(ac), f))) return sendError(c, { status: 403, heading: 'this form expired', text: 'go back, reload the page and try again.' }, 'html')
  if (!isAccountAct(f.do)) return sendError(c, { status: 400, text: 'that form asked for nothing we know.' }, 'html')
  const act = f.do
  const q = qOf(c)
  const reason = modReason(f.reason)
  if (!reason) return render(c, g.session, { q, flash: { act, error: REASON_NEEDED } }, 400)
  const personId = /^\d{1,15}$/.test(f.person ?? '') ? Number(f.person) : null
  const r = await accountAct(c.env.DB, {
    by: g.session.personId,
    act,
    personId,
    email: personId ? null : f.email,
    reason,
    once: f.once ?? '',
    origin: new URL(c.req.url).origin,
  })
  if ('refused' in r) return render(c, g.session, { q, flash: { act, error: r.refused } }, 400)
  return c.redirect(`${PATH}?q=${encodeURIComponent(q)}&done=${act}`, 303)
})
