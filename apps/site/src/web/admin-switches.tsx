// /admin/switches: the site switches (go-live 9.4). Three are rows in the `setting` table and flip here, each with a
// required reason; a flip writes the setting and one public moderation_action row ('setting') in the same batch, so
// the public log (/moderation) shows which switch, on or off, the reason and who. Nothing is cached: the next write
// reads the new value (core/settings.ts).
//   read-only:        every write is refused (core/settings.ts checkWritable). The console itself still works.
//   pause new nodes:  new shwarms and branches are refused; posts, checks and sign-offs go on.
//   sign-up:          'allow_list' (the default) or 'open' (auth/signup.ts). Anyone may join either way; while it is
//                     allow-list only, an address off the list is told it waits for the opening (decided Oct 10).
// The site mode is SITE_MODE in wrangler.jsonc, a deploy-time var read synchronously all over (core/site-mode.ts), so
// the page shows it and says how to change it rather than flipping it. OPEN: a deploy that changes it writes no log
// row; the `site_mode` setting row (0002) is still unread.
import { Hono, type Context } from 'hono'
import type { FC } from 'hono/jsx'
import { formToken } from '../auth/csrf'
import { formOf, postedTokenOk, who, type AuthContext } from '../auth/request'
import { modLog, modReason, MOD_REASON_MAX } from '../core/moderation'
import { siteModeOf, type SiteMode } from '../core/site-mode'
import { isSwitch, parseSwitchReason, parseSwitchValue, readSwitches, SWITCHES, switchReason, switchStatement, type SwitchKey } from '../core/switches'
import { HANDLE_SHOWN } from '../read/names'
import { adminGate, type AdminEnv } from './admin-gate'
import { AdminNav } from './admin-nav'
import { sendError } from './errors'
import { Layout } from './layout'
import { page } from './viewer'

type Env = { Bindings: AdminEnv & { CSRF_SECRET: string; ENV?: string; SITE_MODE?: string } }
export const adminSwitches = new Hono<Env>()

const PATH = '/admin/switches'
const RECENT = 10

// OPEN (#107): new wording, the whole block.
const ABOUT: Record<SwitchKey, string> = {
  read_only: 'every write is refused: posts, checks, sign-offs, new shwarms and branches, from people and agents alike. reading goes on, and so does this console.',
  pause_new_nodes: 'new shwarms and branches are refused. posts, checks and sign-offs go on.',
  signup:
    'anyone may join either way. while it is allow-list only, an address off the allow-list still gets its account and is told it waits for the opening. in beta only invited accounts act, whatever this says.',
}

// OPEN (#107): new wording.
const MODES: Record<SiteMode, string> = {
  holding: 'production shows the holding page and its reading pages are closed.',
  beta: 'the reading pages are public. only invited accounts and the operator act; everyone else is told it opens soon.',
  open: 'everyone acts, and search engines may index the site.',
}

type Recent = { id: number; reason: string; created_at: string; by: string }
type View = {
  token: string
  values: Record<SwitchKey, unknown>
  mode: SiteMode
  env: string
  recent: Recent[]
  /** After a flip: the switch, and whether it changed or already had that value. */
  flash?: { key: SwitchKey; same: boolean }
  /** A refused form: the switch it was for, and why. */
  error?: { key: SwitchKey; text: string; reason?: string }
}

async function view(c: Context<Env>, sessionId: string, extra: Partial<View> = {}): Promise<View> {
  const db = c.env.DB
  const [values, recent] = await Promise.all([
    readSwitches(db),
    db
      .prepare(
        `SELECT m.id, m.reason, m.created_at, ${HANDLE_SHOWN('p')} AS by
         FROM moderation_action m JOIN person p ON p.id = m.by_person
         WHERE m.action = 'setting' ORDER BY m.id DESC LIMIT ?`,
      )
      .bind(RECENT)
      .all<Recent>()
      .then(r => r.results),
  ])
  return { token: await formToken(c.env.CSRF_SECRET, sessionId), values, mode: siteModeOf(c.env), env: c.env.ENV ?? 'unknown', recent, ...extra }
}

adminSwitches.get(PATH, async c => {
  const g = await adminGate(c)
  if ('stop' in g) return g.stop
  const done = c.req.query('done')
  const same = c.req.query('same')
  const k = done ?? same
  return page(c, <SwitchesPage v={await view(c, g.session.id, isSwitch(k) ? { flash: { key: k, same: !done } } : {})} />)
})

adminSwitches.post(PATH, async c => {
  const g = await adminGate(c)
  if ('stop' in g) return g.stop
  const w = await who(c as unknown as AuthContext)
  const f = await formOf(c)
  if (!(await postedTokenOk(c as unknown as AuthContext, w, f)))
    return sendError(c, { status: 403, heading: 'this form expired', text: 'go back, reload the page and try again.' }, 'html')
  const key = f.key
  if (!isSwitch(key)) return sendError(c, { status: 400, text: 'that form asked for nothing we know.' }, 'html')
  const to = parseSwitchValue(key, f.value)
  if (!to) return sendError(c, { status: 400, text: 'that form asked for nothing we know.' }, 'html')
  const reason = modReason(f.reason)
  if (!reason) {
    // OPEN (#107): new wording.
    const text = (f.reason ?? '').trim() ? `keep the reason to ${MOD_REASON_MAX} characters.` : 'give a reason. it shows in the public log.'
    return page(c, <SwitchesPage v={await view(c, g.session.id, { error: { key, text, reason: f.reason } })} />, 400)
  }
  const db = c.env.DB
  const now = (await readSwitches(db))[key]
  if (now === to.value) return c.redirect(`${PATH}?same=${key}#${key}`, 303)
  const at = new Date().toISOString()
  await db.batch([
    switchStatement(db, key, to.value, at),
    modLog(db, { by: g.session.personId, action: 'setting', reason: switchReason(key, to.value, reason), public: true, at }),
  ])
  return c.redirect(`${PATH}?done=${key}#${key}`, 303)
})

// ---------- the page ----------

const Flash: FC<{ f: NonNullable<View['flash']>; v: View }> = ({ f, v }) => {
  const s = SWITCHES[f.key]
  const now = s.words(v.values[f.key])
  // OPEN (#107): new wording.
  return (
    <p class="sw-flash" role="status">
      {f.same ? `${s.name} was already ${now}. nothing changed.` : `${s.name} is now ${now}. it's in the public log.`}
    </p>
  )
}

const SwitchBox: FC<{ k: SwitchKey; v: View }> = ({ k, v }) => {
  const s = SWITCHES[k]
  const cur = v.values[k]
  const next = cur === s.values[0] ? s.values[1] : s.values[0]
  const err = v.error?.key === k ? v.error : undefined
  return (
    <section class="box sw" id={k}>
      {/* OPEN (#107): new wording, this box's copy. */}
      <h2>{s.name} <span>· {s.words(cur)}</span></h2>
      <div class="sw-in">
        <p>{ABOUT[k]}</p>
        <form method="post" action={PATH}>
          <input type="hidden" name="form_token" value={v.token} />
          <input type="hidden" name="key" value={k} />
          <input type="hidden" name="value" value={String(next)} />
          <label for={`r-${k}`}>reason <span class="note">(shows in the public log)</span></label>
          <input id={`r-${k}`} name="reason" type="text" required maxlength={MOD_REASON_MAX} value={err?.reason ?? ''} aria-invalid={err ? 'true' : undefined} aria-describedby={err ? `e-${k}` : undefined} />
          {err && <p class="err" id={`e-${k}`}>{err.text}</p>}
          <div class="sw-go">
            <span class="note">confirms with your password.</span>
            <button class="btn" type="submit">{typeof next === 'boolean' ? `turn ${s.words(next)}` : `make it ${s.words(next)}`}</button>
          </div>
        </form>
      </div>
    </section>
  )
}

const ModeBox: FC<{ v: View }> = ({ v }) => (
  <section class="box sw" id="site_mode">
    {/* OPEN (#107): new wording, this box's copy. */}
    <h2>site mode <span>· {v.mode}</span></h2>
    <div class="sw-in">
      <p>this is the {v.env} site, in {v.mode} mode: {MODES[v.mode]}</p>
      <p>the mode is set when the site is deployed, so it doesn't change here. to change it:</p>
      <ol>
        <li>in <code>apps/site/wrangler.jsonc</code>, set <code>SITE_MODE</code> under <code>env.{v.env === 'staging' ? 'staging' : 'production'}.vars</code> to <code>holding</code>, <code>beta</code> or <code>open</code>.</li>
        <li>from <code>apps/site</code>, run <code>npx wrangler deploy --env {v.env === 'staging' ? 'staging' : 'production'}</code>.</li>
        <li>reload this page to see the new mode. a deploy writes no row in the public log, so say what changed and why in the commit.</li>
      </ol>
      <ul class="sw-modes">
        {(Object.keys(MODES) as SiteMode[]).map(m => <li><b>{m}:</b> {MODES[m]}</li>)}
      </ul>
    </div>
  </section>
)

const RecentBox: FC<{ rows: Recent[] }> = ({ rows }) => (
  <div class="box">
    {/* OPEN (#107): new wording. */}
    <h2>recent changes</h2>
    {rows.length ? (
      <ol class="sw-recent">
        {rows.map(r => {
          const p = parseSwitchReason(r.reason)
          return (
            <li>
              <span class="day">{r.created_at.slice(0, 16).replace('T', ' ')}</span> {r.by}:{' '}
              {p ? <>{SWITCHES[p.key].name} {SWITCHES[p.key].words(p.value)}. {p.reason}</> : r.reason}
            </li>
          )
        })}
      </ol>
    ) : (
      <p class="sw-recent">no switch has been changed here yet.</p>
    )}
    <p class="sw-recent"><a href="/moderation">the public log</a></p>
  </div>
)

const SwitchesPage: FC<{ v: View }> = ({ v }) => (
  <Layout title="switches · shwarm" noindex>
    <link rel="stylesheet" href="/css/admin-switches.css" />
    <div class="dochead">
      <h1>switches</h1>
      {/* OPEN (#107): new wording. */}
      <p>site-wide switches. each change needs a reason and goes in the public log. only admins see this page.</p>
    </div>
    <div class="grid">
      <main id="main" tabindex={-1}>
        <AdminNav here={PATH} />
        {v.flash && <Flash f={v.flash} v={v} />}
        <SwitchBox k="read_only" v={v} />
        <SwitchBox k="pause_new_nodes" v={v} />
        <SwitchBox k="signup" v={v} />
        <ModeBox v={v} />
      </main>
      <aside>
        <RecentBox rows={v.recent} />
      </aside>
    </div>
  </Layout>
)
