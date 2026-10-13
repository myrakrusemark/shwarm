import type { Child, FC } from 'hono/jsx'
import { FORM_FIELD } from '../auth/request'
import { withNext } from '../auth/return-to'
import { fill, fillx, w } from '../words'
import { Layout } from './layout'

// Account pages (go-live 2.5, 2.7, 2.8). Plain HTML forms: they work without JavaScript, except the
// Turnstile widget on join, sign in and forgot. Copy is a draft until Myra approves it.

export type Errors = Partial<Record<string, string>>

const Shell: FC<{ title: string; heading: string; children?: Child; below?: Child }> = ({ title, heading, children, below }) => (
  <Layout title={fill(w.auth.pageTitle, { title })}>
    <link rel="stylesheet" href="/css/auth.css" />
    <main id="main" tabindex={-1} class="auth">
      <div class="box">
        <h2>{heading}</h2>
        {children}
      </div>
      {below && <p class="below">{below}</p>}
    </main>
  </Layout>
)

const Token: FC<{ value: string }> = ({ value }) => <input type="hidden" name={FORM_FIELD} value={value} />

const Err: FC<{ text?: string }> = ({ text }) => (text ? <p class="err" role="alert">{text}</p> : null)

const Msg: FC<{ text?: string; ok?: boolean }> = ({ text, ok }) => (text ? <div class={ok ? 'msg ok' : 'msg'} role={ok ? 'status' : 'alert'}>{text}</div> : null)

export const Turnstile: FC<{ siteKey?: string; error?: string }> = ({ siteKey, error }) =>
  siteKey ? (
    <div class="f">
      <div class="cf-turnstile" data-sitekey={siteKey} data-theme="light"></div>
      <noscript><p class="hint">{w.auth.turnstileNoScript}</p></noscript>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
      <Err text={error} />
    </div>
  ) : error ? (
    <div class="f"><Err text={error} /></div>
  ) : null

type FieldProps = {
  label: string
  name: string
  type?: string
  value?: string
  hint?: Child
  error?: string
  autocomplete?: string
  maxlength?: number
  required?: boolean
}
const Field: FC<FieldProps> = ({ label, name, type = 'text', value, hint, error, autocomplete, maxlength, required }) => (
  <div class="f">
    <label for={name}>{label}</label>
    {hint && <p class="hint" id={`${name}-hint`}>{hint}</p>}
    <input
      id={name}
      name={name}
      type={type}
      value={value}
      autocomplete={autocomplete}
      maxlength={maxlength}
      required={required}
      aria-describedby={hint ? `${name}-hint` : undefined}
      aria-invalid={error ? 'true' : undefined}
      spellcheck={type === 'text' || type === 'email' ? false : undefined}
      autocapitalize={type === 'text' || type === 'email' ? 'off' : undefined}
    />
    <Err text={error} />
  </div>
)

// ---------- join ----------

// While sign-up is invite-only (decided Oct 10: anyone may join; an address off the list waits for the opening). The
// join form says so first (w.auth.joinInviteOnly); the check-email page says w.auth.waiting to anyone who joined from
// an address off the list. OPEN: both wait on Myra's yes.

export type JoinValues = { handle?: string; display_name?: string; email?: string; age?: boolean; terms?: boolean }

const Next: FC<{ next?: string }> = ({ next }) => (next ? <input type="hidden" name="next" value={next} /> : null)

export const JoinPage: FC<{ token: string; siteKey?: string; inviteOnly: boolean; values?: JoinValues; errors?: Errors; next?: string }> = ({
  token, siteKey, inviteOnly, values = {}, errors = {}, next,
}) => (
  <Shell title={w.auth.joinTitle} heading={w.auth.joinHeading} below={<>{fillx(w.auth.haveAccount, { link: <a href={withNext('/signin', next)}>{w.auth.signIn}</a> })}</>}>
    {inviteOnly && <div class="msg ok">{w.auth.joinInviteOnly}</div>}
    <Msg text={errors.form} />
    <form method="post" action="/join">
      <Token value={token} />
      <Next next={next} />
      <Field label={w.auth.handle} name="handle" value={values.handle} error={errors.handle} autocomplete="username" maxlength={32} required
        hint={w.auth.handleHint} />
      <Field label={w.auth.displayName} name="display_name" value={values.display_name} error={errors.display_name} autocomplete="name" maxlength={50}
        hint={w.auth.displayNameHint} />
      <Field label={w.auth.email} name="email" type="email" value={values.email} error={errors.email} autocomplete="email" maxlength={254} required
        hint={w.auth.emailHint} />
      <Field label={w.auth.password} name="password" type="password" error={errors.password} autocomplete="new-password" maxlength={128} required
        hint={w.auth.passwordHint} />
      <div class="f">
        <label class="chk"><input type="checkbox" name="age" value="1" checked={values.age} required /> <span>{w.auth.age}</span></label>
        <Err text={errors.age} />
        <label class="chk"><input type="checkbox" name="terms" value="1" checked={values.terms} required /> <span>{fillx(w.auth.agree, { terms: <a href="/terms">{w.auth.agreeTerms}</a>, privacy: <a href="/privacy">{w.auth.agreePrivacy}</a> })}</span></label>
        <Err text={errors.terms} />
      </div>
      <Turnstile siteKey={siteKey} error={errors.turnstile} />
      <div class="go"><span class="note">{w.auth.joinNote}</span><button class="btn" type="submit">{w.auth.joinButton}</button></div>
    </form>
  </Shell>
)

// ---------- check your email ----------

/** `n`: the signed return-to, passed on to the new verify link. */
/** `waiting`: joined from an address off the allow-list while sign-up is invite-only (decided Oct 10). */
export const CheckEmailPage: FC<{ token: string; kind: 'verify' | 'reset'; sent?: boolean; unverified?: boolean; waiting?: boolean; n?: string }> = ({
  token, kind, sent, unverified, waiting, n,
}) => (
  <Shell title={w.auth.checkEmail} heading={w.auth.checkEmail}>
    {sent && <Msg ok text={w.auth.sentAgain} />}
    {waiting && kind === 'verify' && <div class="msg ok" role="status">{w.auth.waiting}</div>}
    <div class="in">
      {kind === 'reset' ? (
        <>
          <p>{w.auth.resetSent}</p>
          <p>{fillx(w.auth.resetNothing, { link: <a href="/forgot">{w.auth.askAgain}</a> })}</p>
        </>
      ) : (
        <>
          {unverified ? (
            <p>{w.auth.unverified}</p>
          ) : (
            // Myra's words (Oct 10). Shown whether or not the address has an account, so the page never tells which.
            <p>{w.auth.verifySent}</p>
          )}
          <p>{w.auth.checkSpam}</p>
          <form method="post" action="/check-email">
            <Token value={token} />
            {n && <input type="hidden" name="n" value={n} />}
            {waiting && <input type="hidden" name="w" value="1" />}
            <button class="btn plain" type="submit">{w.auth.sendAgain}</button>
          </form>
        </>
      )}
    </div>
  </Shell>
)

// ---------- links from email ----------

export const VerifyPage: FC<{ token: string; t: string; handle: string; n?: string }> = ({ token, t, handle, n }) => (
  <Shell title={w.auth.verifyEmail} heading={w.auth.verifyEmail}>
    <div class="in">
      <p>{fillx(w.auth.verifyFinishes, { handle: <strong>@{handle}</strong> })}</p>
      <p>{fill(w.auth.verifyNotYou, { handle })}</p>
    </div>
    <form method="post" action="/verify">
      <Token value={token} />
      <input type="hidden" name="t" value={t} />
      {n && <input type="hidden" name="n" value={n} />}
      <div class="go"><span>{w.auth.verifyPress}</span><button class="btn" type="submit">{w.auth.verifyButton}</button></div>
    </form>
  </Shell>
)

/** `back`: where they were before joining (a same-site path) and what to call it. */
export const VerifiedPage: FC<{ signedIn: boolean; back?: { href: string; label: string } }> = ({ signedIn, back }) => (
  <Shell title={w.auth.verifiedTitle} heading={w.auth.verifiedHeading}>
    <div class="in">
      <p>{w.auth.verifiedWelcome}</p>
      {back ? (
        <p>{signedIn ? <a href={back.href}>{fill(w.auth.backTo, { place: back.label })}</a> : <>{fillx(w.auth.signInToGoBack, { link: <a href={withNext('/signin', back.href)}>{w.auth.signIn}</a>, place: back.label })}</>}</p>
      ) : (
        <p>{signedIn ? <a href="/">{w.auth.goToShwarm}</a> : <a href="/signin">{w.auth.signIn}</a>}</p>
      )}
    </div>
  </Shell>
)

export const ExpiredPage: FC<{ kind: 'verify' | 'reset' | 'email_change' | 'email_taken' }> = ({ kind }) =>
  kind === 'email_taken' ? (
    // OPEN (#84): the email change pages' words (go-live 6.2) wait on Myra's yes.
    <Shell title={w.auth.linkExpiredTitle} heading={w.auth.linkExpiredHeading}>
      <div class="in">
        <p>{w.auth.emailTaken}</p>
      </div>
    </Shell>
  ) : (
    <Shell title={w.auth.linkExpiredTitle} heading={w.auth.linkExpiredHeading}>
      <div class="in">
        {kind === 'email_change' ? (
          <>
            <p>{w.auth.emailChangeExpired}</p>
            <p>{w.auth.emailChangeAgain}</p>
          </>
        ) : (
          <p>{w.auth.linkUsed}</p>
        )}
        {kind === 'reset' ? (
          <p><a href="/forgot">{w.auth.newResetLink}</a></p>
        ) : kind === 'verify' ? (
          <p>{fillx(w.auth.alreadyVerified, { link: <a href="/signin">{w.auth.signIn}</a> })}</p>
        ) : null}
      </div>
    </Shell>
  )

/** The link in an email change mail (go-live 6.2): one button, so a mail scanner that opens the link changes nothing. */
export const EmailChangePage: FC<{ token: string; t: string; handle: string; email: string }> = ({ token, t, handle, email }) => (
  <Shell title={w.auth.confirmNewEmail} heading={w.auth.confirmNewEmail}>
    <div class="in">
      <p>{fillx(w.auth.emailChangeMoves, { handle: <strong>@{handle}</strong>, email: <strong>{email}</strong> })}</p>
      <p>{w.auth.emailChangeNotYou}</p>
    </div>
    <form method="post" action="/email-change">
      <Token value={token} />
      <input type="hidden" name="t" value={t} />
      <div class="go"><span>{w.auth.emailChangePress}</span><button class="btn" type="submit">{w.auth.emailChangeButton}</button></div>
    </form>
  </Shell>
)

export const EmailChangedPage: FC<{ handle?: string }> = ({ handle }) => (
  <Shell title={w.auth.emailChangedTitle} heading={w.auth.emailChangedHeading}>
    <div class="in">
      <p>{w.auth.emailChangedText}</p>
      <p>{handle ? <a href={`/@${handle}`}>{fill(w.auth.backTo, { place: `@${handle}` })}</a> : <a href="/signin">{w.auth.signIn}</a>}</p>
    </div>
  </Shell>
)

// ---------- sign in, forgot, reset ----------

export const SignInPage: FC<{ token: string; siteKey?: string; email?: string; next?: string; error?: string; notice?: string; signedInAs?: string }> = ({
  token, siteKey, email, next, error, notice, signedInAs,
}) => (
  <Shell title={w.auth.signInHeading} heading={w.auth.signInHeading} below={<>{fillx(w.auth.newHere, { link: <a href={withNext('/join', next)}>{w.auth.joinLink}</a> })}</>}>
    <Msg ok text={notice} />
    {signedInAs && (
      <div class="msg ok">
        {fill(w.auth.signedInAs, { handle: signedInAs })}{' '}
        <form method="post" action="/signout" class="inline"><Token value={token} /><button class="link" type="submit">{w.auth.signOut}</button></form>
      </div>
    )}
    <Msg text={error} />
    <form method="post" action="/signin">
      <Token value={token} />
      <Next next={next} />
      <Field label={w.auth.email} name="email" type="email" value={email} autocomplete="email" maxlength={254} required />
      <Field label={w.auth.password} name="password" type="password" autocomplete="current-password" maxlength={128} required
        hint={<a href="/forgot">{w.auth.forgotIt}</a>} />
      <Turnstile siteKey={siteKey} />
      <div class="go"><span></span><button class="btn" type="submit">{w.auth.signInButton}</button></div>
    </form>
  </Shell>
)

export const ForgotPage: FC<{ token: string; siteKey?: string; email?: string; error?: string }> = ({ token, siteKey, email, error }) => (
  <Shell title={w.auth.forgotTitle} heading={w.auth.forgotHeading} below={<><a href="/signin">{w.auth.backToSignIn}</a></>}>
    <Msg text={error} />
    <form method="post" action="/forgot">
      <Token value={token} />
      <Field label={w.auth.email} name="email" type="email" value={email} autocomplete="email" maxlength={254} required
        hint={w.auth.forgotHint} />
      <Turnstile siteKey={siteKey} />
      <div class="go"><span></span><button class="btn" type="submit">{w.auth.sendLink}</button></div>
    </form>
  </Shell>
)

export const ResetPage: FC<{ token: string; t: string; errors?: Errors }> = ({ token, t, errors = {} }) => (
  <Shell title={w.auth.newPasswordHeading} heading={w.auth.newPasswordHeading}>
    <form method="post" action="/reset">
      <Token value={token} />
      <input type="hidden" name="t" value={t} />
      <Field label={w.auth.newPassword} name="password" type="password" error={errors.password} autocomplete="new-password" maxlength={128} required
        hint={w.auth.passwordHint} />
      <Field label={w.auth.newPasswordAgain} name="password2" type="password" error={errors.password2} autocomplete="new-password" maxlength={128} required />
      <div class="go"><span class="note">{w.auth.resetNote}</span><button class="btn" type="submit">{w.auth.resetButton}</button></div>
    </form>
  </Shell>
)

// ---------- step-up ----------

export const StepUpPage: FC<{ token: string; next: string; handle: string; error?: string }> = ({ token, next, handle, error }) => (
  <Shell title={w.auth.stepUpHeading} heading={w.auth.stepUpHeading}>
    <Msg text={error} />
    <form method="post" action="/step-up">
      <Token value={token} />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="username" value={handle} autocomplete="username" />
      <Field label={w.auth.password} name="password" type="password" autocomplete="current-password" maxlength={128} required
        hint={w.auth.stepUpHint} />
      <div class="go"><span class="note">{fill(w.auth.stepUpSignedInAs, { handle })}</span><button class="btn" type="submit">{w.auth.stepUpButton}</button></div>
    </form>
  </Shell>
)

// ---------- refusals ----------

export const SlowDownPage: FC<{ seconds: number }> = ({ seconds }) => (
  <Shell title={w.auth.tooManyTriesHeading} heading={w.auth.tooManyTriesHeading}>
    <div class="in">
      <p>{fill(w.auth.tooManyTries, { minutes: Math.max(1, Math.ceil(seconds / 60)) })}</p>
      <p><a href="/">{w.auth.backToShwarm}</a></p>
    </div>
  </Shell>
)

export const FormExpiredPage: FC = () => (
  <Shell title={w.auth.formExpired} heading={w.auth.formExpired}>
    <div class="in">
      <p>{w.auth.formExpiredText}</p>
    </div>
  </Shell>
)
