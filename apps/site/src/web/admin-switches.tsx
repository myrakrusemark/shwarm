// /admin/switches: the site switches (go-live 9.4). Three are rows in the `setting` table and flip here, each with a
// required reason; a flip writes the setting and one public moderation_action row ('setting') in the same batch, so
// the public log (/moderation) shows which switch, on or off, the reason and who. Nothing is cached: the next write
// reads the new value (core/settings.ts).
//   read-only:        every write is refused (core/settings.ts checkWritable). The console itself still works.
//   pause new nodes:  new shwarms and branches are refused; posts, claims and backing go on.
//   sign-up:          'allow_list' (the default) or 'open' (auth/signup.ts). Anyone may join either way; while it is
//                     allow-list only, an address off the list is told it waits for the opening (decided Oct 10).
// The site mode is SITE_MODE in wrangler.jsonc, a deploy-time var read synchronously all over (core/site-mode.ts), so
// the page shows it and says how to change it rather than flipping it. OPEN: a deploy that changes it writes no log
// row; the `site_mode` setting row (0002) is still unread.
// The terms box (go-live 10.2) announces the newest bundled terms version (core/terms.ts): with a required reason, one
// batch queues the notice mail to every active, verified account not on it (NOTICE_PER_DAY a day), raises the
// 'terms_version' setting, which puts the banner on their signed-in pages, and writes the public 'setting' row. It
// refuses a version that isn't bundled, isn't newer, or takes effect sooner than the notice period plus the mailing days.
// The opening box (go-live 13.3) sends the one "shwarm is open" mail to everyone who joined while sign-up was allow-list
// only (core/opening.ts): with a required reason, one batch queues it (OPENING_PER_DAY a day), marks their signup_wait
// rows mailed and writes the public 'setting' row. It refuses while sign-up is allow-list only or the site mode isn't
// open, so it can't go before shwarm opens.
import { Hono, type Context } from 'hono'
import type { FC } from 'hono/jsx'
import { formToken } from '../auth/csrf'
import { formOf, postedTokenOk, who, type AuthContext } from '../auth/request'
import { modLog, modReason, MOD_REASON_MAX } from '../core/moderation'
import { siteModeOf, type SiteMode } from '../core/site-mode'
import { isSwitch, parseSwitchReason, parseSwitchValue, readSwitches, settingShown, SWITCHES, switchReason, switchStatement, type SwitchKey } from '../core/switches'
import { openingCount, openingDays, openingMailStatement, openingMarkStatement, openingRefusal, OPENING_PER_DAY, stillWaiting } from '../core/opening'
import { announceRefusal, currentTermsVersion, latestTerms, mailingDays, notAnnounced, NOTICE_DAYS, noticeCount, noticeStatement, termsDate, termsEntry, type TermsVersion } from '../core/terms'
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
  read_only: 'every write is refused: posts, claims, backing, new shwarms and branches, from people and agents alike. reading goes on, and so does this console.',
  pause_new_nodes: 'new shwarms and branches are refused. posts, claims and backing go on.',
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
/** A switch, the terms box or the opening box. */
type BoxKey = SwitchKey | 'terms_version' | 'opening_mail'
const isBoxKey = (k: unknown): k is BoxKey => isSwitch(k) || k === 'terms_version' || k === 'opening_mail'
type View = {
  token: string
  values: Record<SwitchKey, unknown>
  /** The announced terms version, the newest bundled one, and how many accounts announcing it would mail. */
  terms: { current: string; next: TermsVersion; people: number }
  /** How many accounts the opening mail would reach now. */
  opening: number
  mode: SiteMode
  env: string
  recent: Recent[]
  /** After a flip: the switch, and whether it changed or already had that value. */
  flash?: { key: BoxKey; same: boolean }
  /** A refused form: the switch it was for, and why. */
  error?: { key: BoxKey; text: string; reason?: string }
}

async function view(c: Context<Env>, sessionId: string, extra: Partial<View> = {}): Promise<View> {
  const db = c.env.DB
  const next = latestTerms()
  const [values, current, people, opening, recent] = await Promise.all([
    readSwitches(db),
    currentTermsVersion(db),
    noticeCount(db, next.version),
    openingCount(db),
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
  return { token: await formToken(c.env.CSRF_SECRET, sessionId), values, terms: { current, next, people }, opening, mode: siteModeOf(c.env), env: c.env.ENV ?? 'unknown', recent, ...extra }
}

adminSwitches.get(PATH, async c => {
  const g = await adminGate(c)
  if ('stop' in g) return g.stop
  const done = c.req.query('done')
  const same = c.req.query('same')
  const k = done ?? same
  return page(c, <SwitchesPage v={await view(c, g.session.id, isBoxKey(k) ? { flash: { key: k, same: !done } } : {})} />)
})

adminSwitches.post(PATH, async c => {
  const g = await adminGate(c)
  if ('stop' in g) return g.stop
  const w = await who(c as unknown as AuthContext)
  const f = await formOf(c)
  if (!(await postedTokenOk(c as unknown as AuthContext, w, f)))
    return sendError(c, { status: 403, heading: 'this form expired', text: 'go back, reload the page and try again.' }, 'html')
  const key = f.key
  if (key === 'terms_version') return announceTerms(c, g.session, f)
  if (key === 'opening_mail') return sendOpening(c, g.session, f)
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

/** The terms box's form: announce the newest bundled version (go-live 10.2). */
async function announceTerms(c: Context<Env>, session: { id: string; personId: number }, f: Record<string, string>) {
  const db = c.env.DB
  const version = f.value ?? ''
  const reason = modReason(f.reason)
  const current = await currentTermsVersion(db)
  const people = await noticeCount(db, version)
  // OPEN (#110): new wording.
  const refused =
    announceRefusal(version, current, people) ??
    (reason ? null : (f.reason ?? '').trim() ? `keep the reason to ${MOD_REASON_MAX} characters.` : 'give a reason. it shows in the public log.')
  const entry = termsEntry(version)
  if (refused || !entry || !reason)
    return page(c, <SwitchesPage v={await view(c, session.id, { error: { key: 'terms_version', text: refused ?? '', reason: f.reason } })} />, 400)
  const at = new Date().toISOString()
  // The mail and the log row go only while the setting isn't this version yet, and before it changes: a form sent twice
  // at once mails and logs once.
  await db.batch([
    noticeStatement(db, entry, at),
    modLog(db, { by: session.personId, action: 'setting', reason: switchReason('terms_version', version, reason), public: true, at }, notAnnounced(version)),
    switchStatement(db, 'terms_version', version, at),
  ])
  return c.redirect(`${PATH}?done=terms_version#terms_version`, 303)
}

/** The opening box's form: the one "shwarm is open" mail to everyone waiting (go-live 13.3). */
async function sendOpening(c: Context<Env>, session: { id: string; personId: number }, f: Record<string, string>) {
  const db = c.env.DB
  const reason = modReason(f.reason)
  const [values, people] = await Promise.all([readSwitches(db), openingCount(db)])
  // OPEN (#114): new wording.
  const refused =
    openingRefusal(values.signup, siteModeOf(c.env), people) ??
    (reason ? null : (f.reason ?? '').trim() ? `keep the reason to ${MOD_REASON_MAX} characters.` : 'give a reason. it shows in the public log.')
  if (refused || !reason)
    return page(c, <SwitchesPage v={await view(c, session.id, { error: { key: 'opening_mail', text: refused ?? '', reason: f.reason } })} />, 400)
  const at = new Date().toISOString()
  // The mail and the log row go only while sign-up is open and someone is still unmarked, and before the marks: a form
  // sent twice at once mails and logs once.
  await db.batch([
    openingMailStatement(db, at),
    modLog(db, { by: session.personId, action: 'setting', reason: switchReason('opening_mail', String(people), reason), public: true, at }, stillWaiting()),
    openingMarkStatement(db, at),
  ])
  return c.redirect(`${PATH}?done=opening_mail#opening_mail`, 303)
}

// ---------- the page ----------

const Flash: FC<{ f: NonNullable<View['flash']>; v: View }> = ({ f, v }) => {
  // OPEN (#114): new wording.
  if (f.key === 'opening_mail')
    return (
      <p class="sw-flash" role="status">
        the opening mail is queued, {OPENING_PER_DAY} a day. it's in the public log.
      </p>
    )
  const s = settingShown(f.key, f.key === 'terms_version' ? v.terms.current : v.values[f.key])
  // OPEN (#107): new wording.
  return (
    <p class="sw-flash" role="status">
      {f.same ? `${s.name} was already ${s.words}. nothing changed.` : `${s.name} is now ${s.words}. it's in the public log.`}
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
          <input id={`r-${k}`} name="reason" type="text" required maxlength={MOD_REASON_MAX} autocomplete="off" value={err?.reason ?? ''} aria-invalid={err ? 'true' : undefined} aria-describedby={err ? `e-${k}` : undefined} />
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

const TermsBox: FC<{ v: View }> = ({ v }) => {
  const { current, next, people } = v.terms
  const err = v.error?.key === 'terms_version' ? v.error : undefined
  const due = next.version !== current
  const days = mailingDays(people)
  return (
    <section class="box sw" id="terms_version">
      {/* OPEN (#110): new wording, this box's copy. */}
      <h2>terms version <span>· v{current}</span></h2>
      <div class="sw-in">
        <p>
          people accept v{current}. the newest version in this deploy is v{next.version}, in effect from {termsDate(next.effective)}.
        </p>
        {due ? (
          <>
            <p>
              announcing it emails {people === 1 ? '1 account' : `${people} accounts`}
              {days > 1 ? ` over ${days} days` : ''}, and shows a banner to everyone signed in until they accept. it has to go out
              at least {NOTICE_DAYS} days before it takes effect.
            </p>
            <form method="post" action={PATH}>
              <input type="hidden" name="form_token" value={v.token} />
              <input type="hidden" name="key" value="terms_version" />
              <input type="hidden" name="value" value={next.version} />
              <label for="r-terms_version">reason <span class="note">(shows in the public log)</span></label>
              <input id="r-terms_version" name="reason" type="text" required maxlength={MOD_REASON_MAX} autocomplete="off" value={err?.reason ?? ''} aria-invalid={err ? 'true' : undefined} aria-describedby={err ? 'e-terms_version' : undefined} />
              {err && <p class="err" id="e-terms_version">{err.text}</p>}
              <div class="sw-go">
                <span class="note">confirms with your password.</span>
                <button class="btn" type="submit">announce v{next.version}</button>
              </div>
            </form>
          </>
        ) : (
          <>
            <p>nothing to announce. to change the terms, add a version to <code>TERMS_VERSIONS</code> in <code>scripts/pages/content.py</code>, export and deploy.</p>
            {err && <p class="err" id="e-terms_version">{err.text}</p>}
          </>
        )}
      </div>
    </section>
  )
}

const OpeningBox: FC<{ v: View }> = ({ v }) => {
  const people = v.opening
  const err = v.error?.key === 'opening_mail' ? v.error : undefined
  const blocked = openingRefusal(v.values.signup, v.mode, people)
  const days = openingDays(people)
  const accounts = people === 1 ? '1 account' : `${people} accounts`
  return (
    <section class="box sw" id="opening_mail">
      {/* OPEN (#114): new wording, this box's copy. */}
      <h2>opening mail <span>· {people} waiting</span></h2>
      <div class="sw-in">
        <p>
          people who joined while sign-up was allow-list only were told we'd email them when shwarm opens. this sends that one
          mail: shwarm is open, sign in and find a shwarm to join. it goes to active, verified accounts that haven't had it.
        </p>
        {blocked ? (
          <>
            <p>{blocked}</p>
            {err && <p class="err" id="e-opening_mail">{err.text}</p>}
          </>
        ) : (
          <>
            <p>
              sending it emails {accounts}
              {days > 1 ? ` over ${days} days, ${OPENING_PER_DAY} a day` : ''}.
            </p>
            <form method="post" action={PATH}>
              <input type="hidden" name="form_token" value={v.token} />
              <input type="hidden" name="key" value="opening_mail" />
              <label for="r-opening_mail">reason <span class="note">(shows in the public log)</span></label>
              <input id="r-opening_mail" name="reason" type="text" required maxlength={MOD_REASON_MAX} autocomplete="off" value={err?.reason ?? ''} aria-invalid={err ? 'true' : undefined} aria-describedby={err ? 'e-opening_mail' : undefined} />
              {err && <p class="err" id="e-opening_mail">{err.text}</p>}
              <div class="sw-go">
                <span class="note">confirms with your password.</span>
                <button class="btn" type="submit">send the opening mail</button>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  )
}

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
              {p ? <>{settingShown(p.key, p.value).name} {settingShown(p.key, p.value).words}. {p.reason}</> : r.reason}
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
        <TermsBox v={v} />
        <OpeningBox v={v} />
      </main>
      <aside>
        <RecentBox rows={v.recent} />
      </aside>
    </div>
  </Layout>
)
