// /report (go-live 9.3, the report half; A7): a form for anyone, signed out too, so a person without an account (a
// copyright holder, someone named in a post) has a way to tell the people who run shwarm. Turnstile, the reasons
// (core/reports.ts REASONS), the address of what's wrong (on this site), what's wrong in their words, and a contact
// address, optional: without one there's no one to reply to. ?url= fills in the address (a post's "report" link sends
// signed-out people here). Every report goes into the operator's queue and mails the admins (core/reports.ts).
// Throttled per network (LIMITS.reportIp). Open in every site mode: the terms and rules name it.
//   GET  /report             the form; ?sent=1 says it went in
//   POST /report             the form, sent
// OPEN (#105): new wording, everything on this page.
import { Hono, type Context } from 'hono'
import type { FC } from 'hono/jsx'
import { ShwarmError } from '@shwarm/protocol'
import { clientIp, FORM_FIELD, formOf, pageToken, postedTokenOk, who, type AuthContext, type AuthEnv } from '../auth/request'
import { ipPrefix } from '../auth/session'
import { bump, LIMITS } from '../auth/throttle'
import { TURNSTILE_FIELD, turnstileOk } from '../auth/turnstile'
import { CONTACT_MAX, REASON_LABEL, REASONS, reportForm, REPORT_TEXT_MAX, REPORT_URL_MAX } from '../core/reports'
import { FormExpiredPage, Turnstile } from './auth-pages'
import { waitText } from './errors'
import { Layout } from './layout'
import { page } from './viewer'
import { fill, fillx, w } from '../words'

type Env = { Bindings: AuthEnv }
type C = Context<Env>

export const report = new Hono<Env>()

type Values = { url?: string; reason?: string; text?: string; contact?: string }
type Errors = Partial<Record<'url' | 'reason' | 'text' | 'contact' | 'turnstile' | 'form', string>>

const Err: FC<{ text?: string }> = ({ text }) => (text ? <p class="err" role="alert">{text}</p> : null)

export const ReportPage: FC<{ token: string; siteKey?: string; handle?: string; sent?: boolean; values?: Values; errors?: Errors; notice?: string }> = ({
  token, siteKey, handle, sent, values = {}, errors = {}, notice,
}) => (
  <Layout title={fill(w.pages.title, { page: w.pages.reportTitle })}>
    <link rel="stylesheet" href="/css/auth.css" />
    <main id="main" tabindex={-1} class="auth report">
      <div class="box">
        <h2>{w.pages.reportTitle}</h2>
        {sent && <div class="msg ok" role="status">{w.pages.reportSent}</div>}
        {notice && <div class="msg ok" role="status">{notice}</div>}
        {errors.form && <div class="msg" role="alert">{errors.form}</div>}
        <div class="in">
          <p>{fillx(w.pages.reportIntro, { rules: <a href="/rules">{w.pages.reportRulesLink}</a> })}</p>
        </div>
        <form method="post" action="/report">
          <input type="hidden" name={FORM_FIELD} value={token} />
          <div class="f">
            <label for="url">{w.pages.reportUrl}</label>
            <p class="hint" id="url-hint">{w.pages.reportUrlHint}</p>
            <input id="url" name="url" type="text" value={values.url} maxlength={REPORT_URL_MAX} required aria-describedby="url-hint" aria-invalid={errors.url ? 'true' : undefined} spellcheck={false} autocapitalize="off" />
            <Err text={errors.url} />
          </div>
          <div class="f">
            <fieldset>
              <legend class="lbl">{w.pages.reportReason}</legend>
              {REASONS.map(r => (
                <label class="chk"><input type="radio" name="reason" value={r} required checked={values.reason === r || undefined} /> <span>{REASON_LABEL[r]}</span></label>
              ))}
            </fieldset>
            <Err text={errors.reason} />
          </div>
          <div class="f">
            <label for="text">{w.pages.reportText}</label>
            <p class="hint" id="text-hint">{fill(w.pages.reportTextHint, { max: REPORT_TEXT_MAX })}</p>
            <textarea id="text" name="text" maxlength={REPORT_TEXT_MAX} aria-describedby="text-hint" aria-invalid={errors.text ? 'true' : undefined}>{values.text ?? ''}</textarea>
            <Err text={errors.text} />
          </div>
          <div class="f">
            <label for="contact">{w.pages.reportContact}</label>
            <p class="hint" id="contact-hint">
              {handle
                ? fill(w.pages.reportContactSignedIn, { handle })
                : w.pages.reportContactSignedOut}
            </p>
            <input id="contact" name="contact" type="email" value={values.contact} maxlength={CONTACT_MAX} autocomplete="email" aria-describedby="contact-hint" aria-invalid={errors.contact ? 'true' : undefined} spellcheck={false} autocapitalize="off" />
            <Err text={errors.contact} />
          </div>
          <Turnstile siteKey={siteKey} error={errors.turnstile} />
          <div class="go"><span class="note">{fillx(w.pages.reportWriteTo, { email: <a href="mailto:abuse@shwarm.org">abuse@shwarm.org</a> })}</span><button class="btn" type="submit">{w.pages.reportSend}</button></div>
        </form>
      </div>
    </main>
  </Layout>
)

const render = (c: C, node: ReturnType<FC>, status: 200 | 400 | 403 | 429 = 200) => {
  c.header('Cache-Control', 'no-store')
  return page(c, node, status)
}

/** ?url= as given, when it could be an address at all; anything else leaves the field empty. */
const prefill = (v: string | undefined) => (v && v.length <= REPORT_URL_MAX && !/[\x00-\x1f\x7f]/.test(v) ? v : undefined)

/**
 * Who sent it, as the report row and the mail name them: a signed-in person with a verified email, else nobody (as signed
 * out). An unverified account is deleted after 7 days (auth/cleanup.ts), and report.person_id points at person, so a row
 * naming one would make that delete, and the whole hourly cleanup with it, fail.
 */
const reporterOf = (me: { session: { personId: number; handle: string; verified: boolean } | null }) =>
  me.session?.verified ? { personId: me.session.personId, handle: me.session.handle } : null

report.get('/report', async c => {
  const me = await who(c as unknown as AuthContext)
  const token = await pageToken(c as unknown as AuthContext, me)
  return render(c, <ReportPage token={token} siteKey={c.env.TURNSTILE_SITE_KEY} handle={reporterOf(me)?.handle} sent={c.req.query('sent') === '1'} values={{ url: prefill(c.req.query('url')) }} />)
})

report.post('/report', async c => {
  const ac = c as unknown as AuthContext
  const me = await who(ac)
  const f = await formOf(c)
  if (!(await postedTokenOk(ac, me, f))) return render(c, <FormExpiredPage />, 403)
  const values: Values = { url: f.url, reason: f.reason, text: f.text, contact: f.contact }
  const again = async (errors: Errors, status: 200 | 400 | 429 = 400, notice?: string) =>
    render(c, <ReportPage token={await pageToken(ac, me)} siteKey={c.env.TURNSTILE_SITE_KEY} handle={reporterOf(me)?.handle} values={values} errors={errors} notice={notice} />, status)
  if (!(await turnstileOk(c.env, f[TURNSTILE_FIELD], clientIp(c)))) return again({ turnstile: w.auth.turnstileFailed })
  // Per network, signed in or out: each report mails the admins.
  const wait = await bump(c.env.DB, `report:ip:${ipPrefix(clientIp(c)) ?? 'unknown'}`, LIMITS.reportIp)
  if (wait) {
    c.header('Retry-After', String(wait))
    return again({ form: fill(w.pages.reportTooMany, { wait: waitText(wait) }) }, 429)
  }
  try {
    const by = reporterOf(me)
    const r = await reportForm(c.env.DB, { by, url: f.url, reason: f.reason, text: f.text, contact: f.contact, origin: new URL(c.req.url).origin, env: c.env.ENV })
    if (r === 'already') return again({}, 200, w.pages.reportAlready)
  } catch (e) {
    if (!(e instanceof ShwarmError)) throw e
    const field = e.details.field
    return again(field === 'url' || field === 'reason' || field === 'text' || field === 'contact' ? { [field]: e.message } : { form: e.message })
  }
  return c.redirect('/report?sent=1', 303)
})
