// The account modal (go-live 6.2, PRD PROF-8, the account modal in mockups/profile.html), on the owner's own profile.
// It works without script: "account" is a link to /@handle?account=1, which renders the modal open, and × is a link
// back to the profile. With script (static/js/account.js) the link opens it in place, and ×, Esc and a click on the
// scrim close it, with focus kept inside while it's open.
// Three forms: save (everything but the password, behind the password step-up; its fields sit across the modal and
// join the form by its id), change password (also behind the step-up), and sign out everywhere. They post to
// /@handle (web/profile.tsx); a refusal comes back here with the reason at its field and the draft kept.
// OPEN (#84): no mockup draws the display name field, the pending email note, the change password form, "sign out
// everywhere" or the saved lines; their words wait on Myra's yes.
// "your data" (go-live 6.4): download your data and close your account, both behind the step-up; closing also asks for
// the handle typed out. OPEN (#86): no mockup draws them; their words wait on Myra's yes.
import { useContext, type FC } from 'hono/jsx'
import { ABOUT_MAX, LINK_FIELDS, LINK_MAX, type AccountErrors, type AccountForm } from '../auth/account'
import { DISPLAY_NAME_MAX } from '../auth/signup'
import { groupOn, INBOX_EVERY, inboxEvery, NOTICE_GROUPS } from '../email/notices'
import type { Account } from '../read/account'
import { linksOf } from '../read/profile'
import { fullDate } from '../render/format'
import { fill, fillx, w } from '../words'
import { StepUpField } from './node-page'
import { PageContext } from './viewer'

/** A refused form: which one, the reason at each field or at its button, and the draft. */
export type AccountFlash = { at: 'save' | 'password' | 'export' | 'close'; errors?: AccountErrors; error?: string; values?: AccountForm }

export type AccountView = {
  account: Account
  open: boolean
  steppedUp: boolean // the password was entered in the last 10 minutes: the forms don't ask again
  status?: string // after a save or a password change
  flash?: AccountFlash
}

/** What ?account= says after a form went through (web/profile.tsx redirects there). */
export const accountStatus = (asked: string | null): string | undefined =>
  asked === 'saved' ? w.profile.saved : asked === 'password' ? w.profile.passwordChanged : undefined

export const SAVE_FORM = 'acct-save'

type FldProps = {
  label: string
  name: string
  value?: string
  error?: string
  hint?: string
  type?: string
  maxlength?: number
  placeholder?: string
  autocomplete?: string
  required?: boolean
  form?: string
  badge?: string
}
const Fld: FC<FldProps> = ({ label, name, value, error, hint, type = 'text', maxlength, placeholder, autocomplete, required, form, badge }) => (
  <label class="fld">
    <span>{label}{badge && <b class="ev">{badge}</b>}</span>
    <input
      type={type}
      name={name}
      value={value}
      form={form}
      maxlength={maxlength}
      placeholder={placeholder}
      autocomplete={autocomplete}
      required={required}
      aria-invalid={error ? 'true' : undefined}
      spellcheck={type === 'password' ? undefined : false}
    />
    {hint && <small>{hint}</small>}
    {error && <small class="err" role="alert">{error}</small>}
  </label>
)

export const AccountModal: FC<{ v: AccountView }> = ({ v }) => {
  const a = v.account
  const save = v.flash?.at === 'save' ? v.flash : undefined
  const pw = v.flash?.at === 'password' ? v.flash : undefined
  const exp = v.flash?.at === 'export' ? v.flash : undefined
  const cl = v.flash?.at === 'close' ? v.flash : undefined
  const e = save?.errors ?? {}
  const links = Object.fromEntries(linksOf(a.links).map(l => [l.label, l.url]))
  const val = (k: string, stored: string) => save?.values?.[k] ?? stored
  const ticked = (key: string, stored: boolean) => (save?.values ? save.values[`n_${key}`] === '1' : stored)
  const every = save?.values?.inbox_every ?? inboxEvery(a.prefs)
  const action = `/@${a.handle}`
  const token = useContext(PageContext).viewer?.token ?? '' // the strip's sign-out token: the same session's
  const linkLabel = { website: w.profile.website, code: w.profile.code }
  return (
    <div class="scrim" id="ascrim" hidden={!v.open}>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="atitle">
        <h2 id="atitle"><span>{w.profile.account}</span><a href={action} id="aclose" aria-label={w.profile.close}>×</a></h2>
        <form id={SAVE_FORM} method="post" action={action} class="acct-act">
          <input type="hidden" name="form_token" value={token} />
          <input type="hidden" name="do" value="account" />
        </form>
        {v.status && <p class="astatus" role="status">{v.status}</p>}

        <div class="sec">
          <h3>{w.profile.setWhenJoined}</h3>
          <dl class="fixed">
            <dt>{w.profile.handle}</dt><dd>@{a.handle}</dd>
            <dt>{w.profile.joinedLabel}</dt><dd>{fullDate(a.created_at)}</dd>
          </dl>
          <p class="note" style="margin:8px 0 0">{fillx(w.profile.fixedNote, { email: <a href="mailto:support@shwarm.org">support@shwarm.org</a> })}</p>
        </div>

        <div class="sec">
          <h3>{w.profile.aboutYou} <span class="note">{w.profile.public}</span></h3>
          <Fld label={w.profile.displayName} name="display_name" value={val('display_name', a.display_name)} error={e.display_name} form={SAVE_FORM}
            maxlength={DISPLAY_NAME_MAX} autocomplete="name" hint={w.profile.displayNameHint} />
          <label class="fld">
            <span>{w.profile.about} <span class="count" id="acount"></span></span>
            <textarea id="about-in" name="about" form={SAVE_FORM} maxlength={ABOUT_MAX} aria-invalid={e.about ? 'true' : undefined}>{val('about', a.about)}</textarea>
            {e.about && <small class="err" role="alert">{e.about}</small>}
          </label>
          {LINK_FIELDS.map(k => (
            <Fld label={linkLabel[k]} name={k} value={val(k, links[k] ?? '')} error={e[k]} form={SAVE_FORM} maxlength={LINK_MAX} autocomplete="url"
              placeholder={k === 'code' ? w.profile.codePlaceholder : undefined} />
          ))}
        </div>

        <div class="sec">
          <h3>{w.profile.email} <span class="note">{w.profile.private}</span></h3>
          <Fld label={w.profile.address} badge={w.profile.verified} name="email" type="email" value={val('email', a.email)} error={e.email} form={SAVE_FORM} maxlength={254}
            autocomplete="email" required hint={w.profile.emailHint} />
          {a.pending && <p class="note pending">{fillx(w.profile.pending, { pending: <b>{a.pending.email}</b>, email: a.email })}</p>}
          {NOTICE_GROUPS.map(g => (
            <div class="tog">
              <input type="checkbox" id={`n-${g.key}`} name={`n_${g.key}`} value="1" form={SAVE_FORM} checked={ticked(g.key, groupOn(a.prefs, g))} />
              <label for={`n-${g.key}`}>{g.label}</label>
              {g.key === 'inbox' && (
                <select name="inbox_every" form={SAVE_FORM} aria-label={w.profile.howOften}>
                  {INBOX_EVERY.map(o => <option value={o.value} selected={o.value === every}>{o.label}</option>)}
                </select>
              )}
            </div>
          ))}
          <div class="tog locked"><input type="checkbox" id="n-key" checked disabled /><label for="n-key">{w.profile.keyNotice} <span class="note">{w.profile.alwaysOn}</span></label></div>
        </div>

        <div class="sec">
          <h3>{w.profile.signIn}</h3>
          <div class="pwline">
            <span>{fill(w.profile.passwordLastChanged, { date: fullDate(a.password_changed_at ?? a.created_at) })}</span>
            <details class="chpw" open={pw ? true : undefined}>
              <summary class="btn plain">{w.profile.changePassword}</summary>
              <form method="post" action={action} class="acct-act">
                <input type="hidden" name="form_token" value={token} />
                <input type="hidden" name="do" value="password" />
                <input type="hidden" name="username" value={a.handle} autocomplete="username" />
                <Fld label={w.profile.newPassword} name="new_password" type="password" error={pw?.errors?.new_password} maxlength={128} autocomplete="new-password" required
                  hint={w.profile.passwordHint} />
                <Fld label={w.profile.newPasswordAgain} name="new_password2" type="password" error={pw?.errors?.new_password2} maxlength={128} autocomplete="new-password" required />
                <StepUpField id="pw-change" open={v.steppedUp} />
                {pw?.error && <p class="err" role="alert">{pw.error}</p>}
                <div class="row">
                  <span class="note">{w.profile.passwordNote}</span>
                  <button class="btn" type="submit">{w.profile.changePassword}</button>
                </div>
              </form>
            </details>
          </div>
          <p class="note" style="margin:0">{fillx(w.profile.forgotNote, { keys: <a href="/keys">{w.profile.keysPage}</a> })}</p>
          <form method="post" action={action} class="acct-act out-all">
            <input type="hidden" name="form_token" value={token} />
            <input type="hidden" name="do" value="signout_all" />
            <span class="note">{w.profile.signOutAllNote}</span>
            <button class="btn plain" type="submit">{w.profile.signOutEverywhere}</button>
          </form>
        </div>

        <div class="sec">
          <h3>{w.profile.yourData}</h3>
          <form method="post" action={action} class="acct-dl">
            <input type="hidden" name="form_token" value={token} />
            <input type="hidden" name="do" value="export" />
            <StepUpField id="pw-export" open={v.steppedUp} />
            {exp?.error && <p class="err" role="alert">{exp.error}</p>}
            <div class="row">
              <span class="note">{w.profile.downloadNote}</span>
              <button class="btn plain" type="submit">{w.profile.download}</button>
            </div>
          </form>
          <details class="closeacct" open={cl ? true : undefined}>
            <summary class="btn plain">{w.profile.closeAccount}</summary>
            <form method="post" action={action} class="acct-act">
              <input type="hidden" name="form_token" value={token} />
              <input type="hidden" name="do" value="close" />
              <p class="note">{w.profile.closeNote}</p>
              <Fld label={fill(w.profile.typeToConfirm, { handle: a.handle })} name="confirm" error={cl?.errors?.confirm} maxlength={40} autocomplete="off" required />
              <StepUpField id="pw-close" open={v.steppedUp} />
              {cl?.error && <p class="err" role="alert">{cl.error}</p>}
              <div class="row">
                <span class="note">{w.profile.confirmsWithPassword}</span>
                <button class="btn" type="submit">{w.profile.closeButton}</button>
              </div>
            </form>
          </details>
        </div>

        <div class="mfoot">
          <div class="mstep">
            <StepUpField id="pw-save" open={v.steppedUp} form={SAVE_FORM} />
            {save?.error && <p class="err" role="alert">{save.error}</p>}
            <span class="note">{w.profile.savingConfirms}</span>
          </div>
          <button class="btn" type="submit" form={SAVE_FORM} id="asave">{w.profile.save}</button>
        </div>
      </div>
    </div>
  )
}
