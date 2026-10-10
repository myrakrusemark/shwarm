// "opens soon" (go-live 3.10): what the beta shows anyone who isn't invited (signed out, or not a founding account or
// the operator) where join, post, check and "start a shwarm" would be. Core refuses their acts as well
// (core/context.ts loadPerson), so this is the words, not the lock.
// OPEN: every line here waits on Myra's yes.
import { useContext, type FC } from 'hono/jsx'
import { signInHref } from '../auth/return-to'
import { Layout } from './layout'
import { PageContext } from './viewer'

export const OPENS_SOON = {
  why: "shwarm is read-only for now, while a few invited testers try it out. it opens to everyone soon.",
  post: 'posting opens soon',
  join: 'joining opens soon.',
  check: 'checking opens soon.',
  branch: 'starting a branch opens soon.',
  upvote: 'upvotes open soon',
  newTitle: 'opens soon',
  newText: 'starting a shwarm or a branch opens soon.',
  read: 'everything here is open to read in the meantime.',
} as const

/** "invited? sign in." for a signed-out viewer, back to this page; nothing for a signed-in one. */
export const InvitedSignIn: FC = () => {
  const { viewer, here } = useContext(PageContext)
  if (viewer) return null
  return (
    <>
      {' '}invited? <a href={signInHref(here)}>sign in</a>.
    </>
  )
}

/** /new during the beta, for anyone who isn't invited. */
export const OpensSoonPage: FC = () => (
  <Layout title="opens soon · shwarm">
    <link rel="stylesheet" href="/css/new.css" />
    <h1 class="title" id="heading">{OPENS_SOON.newTitle}</h1>
    <div class="grid">
      <main id="main" tabindex={-1}>
        <div class="box opens-soon">
          <div class="f">
            <p>{OPENS_SOON.newText} {OPENS_SOON.why}<InvitedSignIn /></p>
            <p class="note" style="margin:0">{OPENS_SOON.read} <a href="/">see what's live</a></p>
          </div>
        </div>
      </main>
    </div>
  </Layout>
)
