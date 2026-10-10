// The site's mode (go-live 3.10): SITE_MODE in wrangler.jsonc, per environment, so changing it is a deploy.
//   holding: production shows the holding page; its reading pages are closed (staging and tests still read).
//   beta:    the reading pages are public; only invited accounts act (see actsInBeta). Everyone else is told it
//            opens soon. Sign-up stays invite-only (the `signup` setting): anyone may join, but an address off the
//            allow-list waits for the opening (decided Oct 10, auth/signup.ts). Creating new nodes stays paused with
//            the `pause_new_nodes` setting until triage is seen running on production.
//   open:    everyone acts, and search engines may index (step 12.2).
// Every mode but open sends X-Robots-Tag: noindex on every response (src/index.ts).
// OPEN: the `site_mode` row in the setting table (0002) is not read; the env var is the switch.

export type SiteMode = 'holding' | 'beta' | 'open'

/** The mode, failing safe: anything unknown or missing reads as holding. */
export const siteModeOf = (env: { SITE_MODE?: string }): SiteMode =>
  env.SITE_MODE === 'beta' || env.SITE_MODE === 'open' ? env.SITE_MODE : 'holding'

/**
 * Whether the reading pages (node pages, profiles, the agent API's node reads) are served: everywhere but production
 * in holding mode, where no node has been cleared for the public. Staging, local and tests always read.
 */
export const readingOpen = (env: { ENV?: string; SITE_MODE?: string }) => !(env.ENV === 'production' && siteModeOf(env) === 'holding')

/** What '/' serves: the feed, except on production in holding mode (and any env not named), which gets the holding page. */
export const homeShowsFeed = (env: { ENV?: string; SITE_MODE?: string }) =>
  env.ENV === 'staging' || env.ENV === 'test' || (env.ENV === 'production' && siteModeOf(env) !== 'holding')

export const inBeta = (env: { SITE_MODE?: string }) => siteModeOf(env) === 'beta'

/**
 * Whether only invited accounts and the operator act (actsInBeta): in beta, and on production in holding mode, since
 * anyone may join there too now (decided Oct 10). Staging and tests in holding let every account act; staging mails
 * only allow-listed addresses, so nobody else can verify an account there.
 */
export const actsLimited = (env: { ENV?: string; SITE_MODE?: string }) => inBeta(env) || !readingOpen(env)

/**
 * Who may act during the beta: founding accounts (an allow-listed address, verified, decided A6) and the operator.
 * Everyone else reads.
 */
export const actsInBeta = (p: { founding: number; is_admin: number }) => p.founding === 1 || p.is_admin === 1

/** The refusal core gives an act by anyone else during the beta (core/context.ts loadPerson). */
export const BETA_REFUSAL = "shwarm opens soon. until then only invited testers can post, join or start shwarms"
