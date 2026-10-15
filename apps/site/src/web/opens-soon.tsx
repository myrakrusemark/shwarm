// "opens soon" (go-live 3.10): what the beta shows anyone who isn't invited (signed out, or not a founding account or
// the operator) where join, post, back and "start a shwarm" would be. Core refuses their acts as well
// (core/context.ts loadPerson), so this is the words, not the lock.
// OPEN: every line here waits on Myra's yes.
import { useContext, type FC } from 'hono/jsx'
import { signInHref } from '../auth/return-to'
import { Layout } from './layout'
import { fill, fillx, w } from '../words'
import { PageContext } from './viewer'

// Getters, so each is read from the word list when a page shows it, not when this module loads.
export const OPENS_SOON = {
  get why() { return w.pages.opensSoonWhy },
  get post() { return w.pages.opensSoonPost },
  get join() { return w.pages.opensSoonJoin },
  get branch() { return w.pages.opensSoonBranch },
  get upvote() { return w.pages.opensSoonUpvote },
  get newTitle() { return w.pages.opensSoonTitle },
  get newText() { return w.pages.opensSoonNew },
  get read() { return w.pages.opensSoonRead },
}

/** "invited? sign in." for a signed-out viewer, back to this page; nothing for a signed-in one. */
export const InvitedSignIn: FC = () => {
  const { viewer, here } = useContext(PageContext)
  if (viewer) return null
  return (
    <>{fillx(w.pages.opensSoonInvited, { signIn: <a href={signInHref(here)}>{w.pages.opensSoonSignIn}</a> })}</>
  )
}

/** /new during the beta, for anyone who isn't invited. */
export const OpensSoonPage: FC = () => (
  <Layout title={fill(w.pages.title, { page: OPENS_SOON.newTitle })}>
    <link rel="stylesheet" href="/css/new.css" />
    <h1 class="title" id="heading">{OPENS_SOON.newTitle}</h1>
    <div class="grid">
      <main id="main" tabindex={-1}>
        <div class="box opens-soon">
          <div class="f">
            <p>{OPENS_SOON.newText} {OPENS_SOON.why}<InvitedSignIn /></p>
            <p class="note" style="margin:0">{OPENS_SOON.read} <a href="/">{w.pages.opensSoonLive}</a></p>
          </div>
        </div>
      </main>
    </div>
  </Layout>
)
