// Account routes (go-live 2.5, 2.7, 2.8), mounted from index.ts with one app.route('/', auth).
// Every form carries a form token; originGuard in index.ts already refuses writes from other sites.
// GET never changes anything: emailed links open a page whose button POSTs.
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { html } from 'hono/html'
import type { Child } from 'hono/jsx'
import {
  CheckEmailPage, ExpiredPage, ForgotPage, FormExpiredPage, InviteOnlyPage, JoinPage, ResetPage, SignInPage, SlowDownPage,
  StepUpPage, VerifiedPage, VerifyPage,
} from '../web/auth-pages'
import { isPwned, passwordProblem } from './password'
import { clientIp, formOf, pageToken, postedTokenOk, safeNext, who, type AuthContext, type AuthEnv, type Who } from './request'
import { clearCookie, endSession, sessionCookie } from './session'
import { applyReset, markVerified, sendReset, signIn, stepUp } from './signin'
import { COPY, PEND_COOKIE, PEND_SECONDS, resendVerify, setting, signUp } from './signup'
import { consumeToken, peekToken } from './tokens'
import { TURNSTILE_FIELD, turnstileOk } from './turnstile'

export const auth = new Hono<{ Bindings: AuthEnv }>()

const render = (c: AuthContext, node: Child, status: 200 | 400 | 403 | 410 | 429 = 200) => {
  c.header('Cache-Control', 'no-store')
  c.header('X-Robots-Tag', 'noindex')
  return c.html(html`<!doctype html>${node}`, status)
}
const origin = (c: AuthContext) => new URL(c.req.url).origin
const slow = (c: AuthContext, seconds: number) => {
  c.header('Retry-After', String(seconds))
  return render(c, <SlowDownPage seconds={seconds} />, 429)
}
const formExpired = (c: AuthContext) => render(c, <FormExpiredPage />, 403)

async function personOf(c: AuthContext, w: Who) {
  if (!w.session) return null
  return c.env.DB.prepare('SELECT handle, email_verified_at FROM person WHERE id = ?')
    .bind(w.session.personId)
    .first<{ handle: string; email_verified_at: string | null }>()
}

// ---------- sign-up (2.5) ----------

auth.get('/join', async c => {
  const w = await who(c)
  const token = await pageToken(c, w)
  const inviteOnly = (await setting<string>(c.env.DB, 'signup')) !== 'open'
  return render(c, <JoinPage token={token} siteKey={c.env.TURNSTILE_SITE_KEY} inviteOnly={inviteOnly} />)
})

auth.post('/join', async c => {
  const w = await who(c)
  const f = await formOf(c)
  if (!(await postedTokenOk(c, w, f))) return formExpired(c)
  const values = { handle: f.handle, display_name: f.display_name, email: f.email, age: !!f.age, terms: !!f.terms }
  const again = async (errors: Record<string, string | undefined>) => {
    const inviteOnly = (await setting<string>(c.env.DB, 'signup')) !== 'open'
    return render(c, <JoinPage token={await pageToken(c, w)} siteKey={c.env.TURNSTILE_SITE_KEY} inviteOnly={inviteOnly} values={values} errors={errors} />, 400)
  }
  if (!(await turnstileOk(c.env, f[TURNSTILE_FIELD], clientIp(c)))) return again({ turnstile: COPY.turnstile })
  const r = await signUp(c.env.DB, c.env, f, { ip: clientIp(c), origin: origin(c), pend: getCookie(c, PEND_COOKIE), sessionPersonId: w.session?.personId })
  if (r.kind === 'errors') return again(r.errors)
  if (r.kind === 'slow') return slow(c, r.seconds)
  if (r.kind === 'invite_only') return render(c, <InviteOnlyPage />, 403)
  c.header('Set-Cookie', `${PEND_COOKIE}=${r.pend}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${PEND_SECONDS}`, { append: true })
  return c.redirect('/check-email', 303)
})

auth.get('/check-email', async c => {
  const w = await who(c)
  const p = await personOf(c, w)
  const kind = c.req.query('r') === 'reset' ? 'reset' : 'verify'
  return render(c, <CheckEmailPage token={await pageToken(c, w)} kind={kind} sent={c.req.query('sent') === '1'} unverified={!!p && !p.email_verified_at} />)
})

auth.post('/check-email', async c => {
  const w = await who(c)
  if (!(await postedTokenOk(c, w, await formOf(c)))) return formExpired(c)
  await resendVerify(c.env.DB, c.env, { origin: origin(c), pend: getCookie(c, PEND_COOKIE), sessionPersonId: w.session?.personId })
  return c.redirect('/check-email?sent=1', 303)
})

// ---------- emailed links: a page with one button ----------

auth.get('/verify', async c => {
  const t = c.req.query('t') ?? ''
  if (!(await peekToken(c.env.DB, t, 'verify'))) return render(c, <ExpiredPage kind="verify" />, 410)
  const w = await who(c)
  return render(c, <VerifyPage token={await pageToken(c, w)} t={t} />)
})

auth.post('/verify', async c => {
  const w = await who(c)
  const f = await formOf(c)
  if (!(await postedTokenOk(c, w, f))) return formExpired(c)
  const personId = await consumeToken(c.env.DB, f.t, 'verify')
  if (!personId) return render(c, <ExpiredPage kind="verify" />, 410)
  await markVerified(c.env.DB, personId, origin(c))
  return c.redirect('/verified', 303)
})

auth.get('/verified', async c => {
  const w = await who(c)
  return render(c, <VerifiedPage signedIn={!!w.session} />)
})

// ---------- sign in and out (2.7) ----------

auth.get('/signin', async c => {
  const w = await who(c)
  const p = await personOf(c, w)
  const notice = c.req.query('done') === 'reset' ? 'your new password is set. sign in with it.' : undefined
  return render(c, <SignInPage token={await pageToken(c, w)} siteKey={c.env.TURNSTILE_SITE_KEY} next={safeNext(c.req.query('next')) ?? undefined} notice={notice} signedInAs={p?.handle} />)
})

auth.post('/signin', async c => {
  const w = await who(c)
  const f = await formOf(c)
  if (!(await postedTokenOk(c, w, f))) return formExpired(c)
  const next = safeNext(f.next) ?? undefined
  const again = async (error: string) =>
    render(c, <SignInPage token={await pageToken(c, w)} siteKey={c.env.TURNSTILE_SITE_KEY} email={f.email} next={next} error={error} />, 400)
  // OPEN: a Turnstile outage lets sign-in through (the throttles still hold); sign-up and forgot fail closed.
  if (!(await turnstileOk(c.env, f[TURNSTILE_FIELD], clientIp(c), { failOpen: true }))) return again(COPY.turnstile)
  const r = await signIn(c.env.DB, c.env.PASSWORD_PEPPER, f.email ?? '', f.password ?? '', { ip: clientIp(c), ua: c.req.header('user-agent') ?? null })
  if (r.kind === 'slow') return slow(c, r.seconds)
  if (r.kind === 'bad') return again("that email and password don't match.")
  await endSession(c.env.DB, w.token) // rotate: the old cookie's session ends
  c.header('Set-Cookie', sessionCookie(r.token), { append: true })
  return c.redirect(r.verified ? next ?? '/' : '/check-email', 303)
})

auth.post('/signout', async c => {
  const w = await who(c)
  if (!(await postedTokenOk(c, w, await formOf(c)))) return formExpired(c)
  await endSession(c.env.DB, w.token)
  c.header('Set-Cookie', clearCookie(), { append: true })
  return c.redirect('/', 303)
})

// ---------- forgot and reset ----------

auth.get('/forgot', async c => {
  const w = await who(c)
  return render(c, <ForgotPage token={await pageToken(c, w)} siteKey={c.env.TURNSTILE_SITE_KEY} />)
})

auth.post('/forgot', async c => {
  const w = await who(c)
  const f = await formOf(c)
  if (!(await postedTokenOk(c, w, f))) return formExpired(c)
  const again = async (error: string) => render(c, <ForgotPage token={await pageToken(c, w)} siteKey={c.env.TURNSTILE_SITE_KEY} email={f.email} error={error} />, 400)
  if (!(await turnstileOk(c.env, f[TURNSTILE_FIELD], clientIp(c)))) return again(COPY.turnstile)
  await sendReset(c.env.DB, f.email ?? '', origin(c))
  return c.redirect('/check-email?r=reset', 303)
})

auth.get('/reset', async c => {
  const t = c.req.query('t') ?? ''
  if (!(await peekToken(c.env.DB, t, 'reset'))) return render(c, <ExpiredPage kind="reset" />, 410)
  const w = await who(c)
  return render(c, <ResetPage token={await pageToken(c, w)} t={t} />)
})

auth.post('/reset', async c => {
  const w = await who(c)
  const f = await formOf(c)
  if (!(await postedTokenOk(c, w, f))) return formExpired(c)
  const t = f.t ?? ''
  if (!(await peekToken(c.env.DB, t, 'reset'))) return render(c, <ExpiredPage kind="reset" />, 410)
  const password = f.password ?? ''
  const problem = passwordProblem(password)
  const errors = problem
    ? { password: problem === 'too_short' ? COPY.tooShort : COPY.tooLong }
    : password !== f.password2
      ? { password2: "the two passwords don't match." }
      : (await isPwned(password))
        ? { password: COPY.pwned }
        : null
  if (errors) return render(c, <ResetPage token={await pageToken(c, w)} t={t} errors={errors} />, 400)
  const personId = await consumeToken(c.env.DB, t, 'reset')
  if (!personId) return render(c, <ExpiredPage kind="reset" />, 410)
  await applyReset(c.env.DB, c.env.PASSWORD_PEPPER, personId, password)
  c.header('Set-Cookie', clearCookie(), { append: true })
  return c.redirect('/signin?done=reset', 303)
})

// ---------- step-up (2.8) ----------

auth.get('/step-up', async c => {
  const w = await who(c)
  const next = safeNext(c.req.query('next')) ?? '/'
  const p = await personOf(c, w)
  if (!p) return c.redirect(`/signin?next=${encodeURIComponent(`/step-up?next=${encodeURIComponent(next)}`)}`, 303)
  return render(c, <StepUpPage token={await pageToken(c, w)} next={next} handle={p.handle} />)
})

auth.post('/step-up', async c => {
  const w = await who(c)
  const f = await formOf(c)
  const next = safeNext(f.next) ?? '/'
  const p = await personOf(c, w)
  if (!w.session || !p) return c.redirect(`/signin?next=${encodeURIComponent(`/step-up?next=${encodeURIComponent(next)}`)}`, 303)
  if (!(await postedTokenOk(c, w, f))) return formExpired(c)
  const r = await stepUp(c.env.DB, c.env.PASSWORD_PEPPER, w.session.personId, w.session.id, f.password ?? '', clientIp(c))
  if (r.kind === 'slow') return slow(c, r.seconds)
  if (r.kind === 'bad') return render(c, <StepUpPage token={await pageToken(c, w)} next={next} handle={p.handle} error="that password doesn't match." />, 400)
  return c.redirect(next, 303)
})
