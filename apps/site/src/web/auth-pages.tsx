import type { Child, FC } from 'hono/jsx'
import { FORM_FIELD } from '../auth/request'
import { withNext } from '../auth/return-to'
import { Layout } from './layout'

// Account pages (go-live 2.5, 2.7, 2.8). Plain HTML forms: they work without JavaScript, except the
// Turnstile widget on join, sign in and forgot. Copy is a draft until Myra approves it.

export type Errors = Partial<Record<string, string>>

const Shell: FC<{ title: string; heading: string; children?: Child; below?: Child }> = ({ title, heading, children, below }) => (
  <Layout title={`${title} · shwarm`}>
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

const Turnstile: FC<{ siteKey?: string; error?: string }> = ({ siteKey, error }) =>
  siteKey ? (
    <div class="f">
      <div class="cf-turnstile" data-sitekey={siteKey} data-theme="light"></div>
      <noscript><p class="hint">this check needs javascript.</p></noscript>
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

export type JoinValues = { handle?: string; display_name?: string; email?: string; age?: boolean; terms?: boolean }

const Next: FC<{ next?: string }> = ({ next }) => (next ? <input type="hidden" name="next" value={next} /> : null)

export const JoinPage: FC<{ token: string; siteKey?: string; inviteOnly: boolean; values?: JoinValues; errors?: Errors; next?: string }> = ({
  token, siteKey, inviteOnly, values = {}, errors = {}, next,
}) => (
  <Shell title="join" heading="join shwarm" below={<>have an account? <a href={withNext('/signin', next)}>sign in</a></>}>
    {inviteOnly && <div class="msg ok">shwarm is invite-only for now. join with the address your invite came to.</div>}
    <Msg text={errors.form} />
    <form method="post" action="/join">
      <Token value={token} />
      <Next next={next} />
      <Field label="handle" name="handle" value={values.handle} error={errors.handle} autocomplete="username" maxlength={32} required
        hint="your name here, like @myra. 2 to 32 lowercase letters, numbers or underscores. it can't change later." />
      <Field label="display name" name="display_name" value={values.display_name} error={errors.display_name} autocomplete="name" maxlength={50}
        hint="optional. shown next to your handle." />
      <Field label="email" name="email" type="email" value={values.email} error={errors.email} autocomplete="email" maxlength={254} required
        hint="we send a link to check it. it's never shown." />
      <Field label="password" name="password" type="password" error={errors.password} autocomplete="new-password" maxlength={128} required
        hint="10 to 128 characters." />
      <div class="f">
        <label class="chk"><input type="checkbox" name="age" value="1" checked={values.age} required /> <span>i'm 16 or older.</span></label>
        <Err text={errors.age} />
        <label class="chk"><input type="checkbox" name="terms" value="1" checked={values.terms} required /> <span>i agree to the <a href="/terms">terms</a> and the <a href="/privacy">privacy notice</a>.</span></label>
        <Err text={errors.terms} />
      </div>
      <Turnstile siteKey={siteKey} error={errors.turnstile} />
      <div class="go"><span class="note">you can read everything without an account.</span><button class="btn" type="submit">join</button></div>
    </form>
  </Shell>
)

// ---------- check your email ----------

/** `n`: the signed return-to, passed on to the new verify link. */
export const CheckEmailPage: FC<{ token: string; kind: 'verify' | 'reset'; sent?: boolean; unverified?: boolean; inviteOnly?: boolean; n?: string }> = ({
  token, kind, sent, unverified, inviteOnly, n,
}) => (
  <Shell title="check your email" heading="check your email">
    {sent && <Msg ok text="sent again. it can take a minute or two." />}
    <div class="in">
      {kind === 'reset' ? (
        <>
          <p>if that address has an account, a link to set a new password is on its way. it works for 1 hour.</p>
          <p>nothing there? look in spam, or <a href="/forgot">ask again</a>.</p>
        </>
      ) : (
        <>
          {unverified ? (
            <p>your email isn't verified yet. until it is, you can read and sign in, nothing else.</p>
          ) : inviteOnly ? (
            <>
              <p>if that address can join, we sent the next step to it. a link to verify it works for 7 days.</p>
              <p>shwarm is invite-only while it's new. if you got an invite, join with the address it came to.</p>
            </>
          ) : (
            <p>we sent the next step to that address. a link to verify it works for 7 days.</p>
          )}
          <p>nothing there? look in spam, or send it again.</p>
          <form method="post" action="/check-email">
            <Token value={token} />
            {n && <input type="hidden" name="n" value={n} />}
            <button class="btn plain" type="submit">send it again</button>
          </form>
        </>
      )}
    </div>
  </Shell>
)

// ---------- links from email ----------

export const VerifyPage: FC<{ token: string; t: string; handle: string; n?: string }> = ({ token, t, handle, n }) => (
  <Shell title="verify your email" heading="verify your email">
    <div class="in">
      <p>this link finishes joining as <strong>@{handle}</strong>.</p>
      <p>didn't sign up as @{handle}? don't press the button. an account that's never verified is deleted after 7 days.</p>
    </div>
    <form method="post" action="/verify">
      <Token value={token} />
      <input type="hidden" name="t" value={t} />
      {n && <input type="hidden" name="n" value={n} />}
      <div class="go"><span>press the button to finish joining.</span><button class="btn" type="submit">verify my email</button></div>
    </form>
  </Shell>
)

/** `back`: where they were before joining (a same-site path) and what to call it. */
export const VerifiedPage: FC<{ signedIn: boolean; back?: { href: string; label: string } }> = ({ signedIn, back }) => (
  <Shell title="verified" heading="you're in">
    <div class="in">
      <p>your email is verified. welcome to shwarm.</p>
      {back ? (
        <p>{signedIn ? <a href={back.href}>back to {back.label}</a> : <><a href={withNext('/signin', back.href)}>sign in</a> to go back to {back.label}.</>}</p>
      ) : (
        <p>{signedIn ? <a href="/">go to shwarm</a> : <a href="/signin">sign in</a>}</p>
      )}
    </div>
  </Shell>
)

export const ExpiredPage: FC<{ kind: 'verify' | 'reset' | 'email_change' | 'email_taken' }> = ({ kind }) =>
  kind === 'email_taken' ? (
    // OPEN (#84): the email change pages' words (go-live 6.2) wait on Myra's yes.
    <Shell title="link expired" heading="this link doesn't work anymore">
      <div class="in">
        <p>that address is on another shwarm account now, so this one can't move to it. your old address stays.</p>
      </div>
    </Shell>
  ) : (
    <Shell title="link expired" heading="this link doesn't work anymore">
      <div class="in">
        {kind === 'email_change' ? (
          <>
            <p>it was already used, or it ran out of time. email change links last 24 hours.</p>
            <p>to try again, open "account" on your profile and change the address there.</p>
          </>
        ) : (
          <p>it was already used, or it ran out of time. verify links last 7 days and reset links 1 hour.</p>
        )}
        {kind === 'reset' ? (
          <p><a href="/forgot">ask for a new reset link</a></p>
        ) : kind === 'verify' ? (
          <p>already verified? <a href="/signin">sign in</a>. if not, sign in and send a new link from there.</p>
        ) : null}
      </div>
    </Shell>
  )

/** The link in an email change mail (go-live 6.2): one button, so a mail scanner that opens the link changes nothing. */
export const EmailChangePage: FC<{ token: string; t: string; handle: string; email: string }> = ({ token, t, handle, email }) => (
  <Shell title="confirm your new email" heading="confirm your new email">
    <div class="in">
      <p>this link moves <strong>@{handle}</strong> to <strong>{email}</strong>. until you press the button, the old address stays on the account.</p>
      <p>didn't ask for this? don't press the button.</p>
    </div>
    <form method="post" action="/email-change">
      <Token value={token} />
      <input type="hidden" name="t" value={t} />
      <div class="go"><span>press the button to use this address.</span><button class="btn" type="submit">use this address</button></div>
    </form>
  </Shell>
)

export const EmailChangedPage: FC<{ handle?: string }> = ({ handle }) => (
  <Shell title="email changed" heading="your new email is set">
    <div class="in">
      <p>shwarm sends your mail here from now on, and you sign in with it.</p>
      <p>{handle ? <a href={`/@${handle}`}>back to @{handle}</a> : <a href="/signin">sign in</a>}</p>
    </div>
  </Shell>
)

// ---------- sign in, forgot, reset ----------

export const SignInPage: FC<{ token: string; siteKey?: string; email?: string; next?: string; error?: string; notice?: string; signedInAs?: string }> = ({
  token, siteKey, email, next, error, notice, signedInAs,
}) => (
  <Shell title="sign in" heading="sign in" below={<>new here? <a href={withNext('/join', next)}>join</a></>}>
    <Msg ok text={notice} />
    {signedInAs && (
      <div class="msg ok">
        you're signed in as @{signedInAs}.{' '}
        <form method="post" action="/signout" class="inline"><Token value={token} /><button class="link" type="submit">sign out</button></form>
      </div>
    )}
    <Msg text={error} />
    <form method="post" action="/signin">
      <Token value={token} />
      <Next next={next} />
      <Field label="email" name="email" type="email" value={email} autocomplete="email" maxlength={254} required />
      <Field label="password" name="password" type="password" autocomplete="current-password" maxlength={128} required
        hint={<a href="/forgot">forgot it?</a>} />
      <Turnstile siteKey={siteKey} />
      <div class="go"><span></span><button class="btn" type="submit">sign in</button></div>
    </form>
  </Shell>
)

export const ForgotPage: FC<{ token: string; siteKey?: string; email?: string; error?: string }> = ({ token, siteKey, email, error }) => (
  <Shell title="forgot your password" heading="forgot your password?" below={<><a href="/signin">back to sign in</a></>}>
    <Msg text={error} />
    <form method="post" action="/forgot">
      <Token value={token} />
      <Field label="email" name="email" type="email" value={email} autocomplete="email" maxlength={254} required
        hint="if it has an account, we'll send a link to set a new password." />
      <Turnstile siteKey={siteKey} />
      <div class="go"><span></span><button class="btn" type="submit">send the link</button></div>
    </form>
  </Shell>
)

export const ResetPage: FC<{ token: string; t: string; errors?: Errors }> = ({ token, t, errors = {} }) => (
  <Shell title="set a new password" heading="set a new password">
    <form method="post" action="/reset">
      <Token value={token} />
      <input type="hidden" name="t" value={t} />
      <Field label="new password" name="password" type="password" error={errors.password} autocomplete="new-password" maxlength={128} required
        hint="10 to 128 characters." />
      <Field label="new password again" name="password2" type="password" error={errors.password2} autocomplete="new-password" maxlength={128} required />
      <div class="go"><span class="note">this signs you out everywhere.</span><button class="btn" type="submit">set new password</button></div>
    </form>
  </Shell>
)

// ---------- step-up ----------

export const StepUpPage: FC<{ token: string; next: string; handle: string; error?: string }> = ({ token, next, handle, error }) => (
  <Shell title="confirm it's you" heading="confirm it's you">
    <Msg text={error} />
    <form method="post" action="/step-up">
      <Token value={token} />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="username" value={handle} autocomplete="username" />
      <Field label="password" name="password" type="password" autocomplete="current-password" maxlength={128} required
        hint="enter your password to go on. it stays confirmed for 10 minutes." />
      <div class="go"><span class="note">signed in as @{handle}</span><button class="btn" type="submit">confirm</button></div>
    </form>
  </Shell>
)

// ---------- refusals ----------

export const SlowDownPage: FC<{ seconds: number }> = ({ seconds }) => (
  <Shell title="too many tries" heading="too many tries">
    <div class="in">
      <p>there have been too many tries from here. wait about {Math.max(1, Math.ceil(seconds / 60))} minutes, then try again.</p>
      <p><a href="/">back to shwarm</a></p>
    </div>
  </Shell>
)

export const FormExpiredPage: FC = () => (
  <Shell title="this form expired" heading="this form expired">
    <div class="in">
      <p>go back, reload the page, and try again.</p>
    </div>
  </Shell>
)
