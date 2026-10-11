// "i accept v<n>" (go-live 10.2): the terms banner's button (web/layout.tsx TermsBanner). It records that the signed-in
// person accepted the announced terms version: person.terms_version and terms_accepted_at, and a terms_acceptance row
// (how 'banner'), in one batch, then goes back to the page they were on.
//   POST /terms/accept   form_token, version (the one the banner showed), next (a same-site path)
// A bare-handle act on the site, like joining: a signed-in session is enough, with no password step-up. It works for
// unverified accounts, while read-only is on, and in every site mode. A version that is no longer the announced one
// records nothing, so the banner shows the newer one. OPEN (#110): these are the builder's defaults.
import { Hono } from 'hono'
import { formOf, postedTokenOk, safeNext, who, type AuthContext, type AuthEnv } from '../auth/request'
import { signInHref } from '../auth/return-to'
import { currentTermsVersion } from '../core/terms'
import { FormExpiredPage } from './auth-pages'
import { page } from './viewer'

type Env = { Bindings: AuthEnv }
export const termsAccept = new Hono<Env>()

termsAccept.post('/terms/accept', async c => {
  const w = await who(c as unknown as AuthContext)
  const f = await formOf(c)
  if (!(await postedTokenOk(c as unknown as AuthContext, w, f))) {
    c.header('Cache-Control', 'no-store')
    return page(c, <FormExpiredPage />, 403)
  }
  const next = safeNext(f.next) ?? '/'
  if (!w.session) return c.redirect(signInHref(next), 303)
  const db = c.env.DB
  const version = await currentTermsVersion(db)
  if (f.version !== version) return c.redirect(next, 303) // the banner moved on: it shows the newer version now
  const at = new Date().toISOString()
  await db.batch([
    db.prepare('UPDATE person SET terms_version = ?1, terms_accepted_at = ?2 WHERE id = ?3 AND terms_version IS NOT ?1').bind(version, at, w.session.personId),
    db.prepare("INSERT OR IGNORE INTO terms_acceptance (person_id, version, accepted_at, how) VALUES (?, ?, ?, 'banner')").bind(w.session.personId, version, at),
  ])
  return c.redirect(next, 303)
})
