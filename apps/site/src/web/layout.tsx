import { useContext, type Child, type FC } from 'hono/jsx'
import { FORM_FIELD } from '../auth/request'
import { joinHref, signInHref } from '../auth/return-to'
import { termsDate } from '../core/terms'
import { currentDir, currentLang, currentPath, currentServed, fill, fillx, languages, w } from '../words'
import { PageContext, type PageInfo } from './viewer'
import { RESOURCES } from '../content/resources'

// Shared page chrome, ported 1:1 from the mockups (header strip, footer, donate modal, agent resources card).
// CSS comes from static/css/site.css, which scripts/pages/export-site.py generates from the mockups.

const VINE = '❦ ˜˜ ✿ ˜˜˜ ❦ ˜ ✿ ˜˜ ❦ ˜˜˜ ✿ ˜ ❦ ˜˜ ✿ ˜˜˜ ❦ ˜ ✿ ˜˜ ❦ ˜˜˜ ✿ ˜ ❦ ˜˜ ✿ ˜˜˜ ❦ ˜ ✿ ˜˜ ❦ ˜˜˜ ✿ ˜ ❦ ˜˜ ✿ ˜˜˜ ❦'

/** The agent resources card: the pages in content/agent-resources.json, labelled in the reader's language. */
export const AGENT_RESOURCES = (): [string, string][] => RESOURCES.map(r => [r.path, w.chrome[r.word]])

export const AgentResources: FC<{ current?: string }> = ({ current }) => (
  <div class="box agent-res">
    <h2>{w.chrome.agentResources}</h2>
    <ul>
      {AGENT_RESOURCES().map(([href, label]) => (
        <li class={href === current ? 'on' : undefined}><a href={href}>{label}</a></li>
      ))}
    </ul>
  </div>
)

// The logo links home on every page but the feed (design system "Header").
const Header: FC<{ home?: boolean }> = ({ home }) => {
  const logo = <><i class="mark" aria-hidden="true"></i><span class="wm">s<span>h</span>warm</span></>
  return (
  <header>
    <h1 class="logo">{home ? logo : <a href="/">{logo}</a>}</h1>
    <div class="tag">{w.chrome.tagline}</div>
    <a class="btn" href="/new">{w.chrome.startShwarm}</a>
  </header>
  )
}

// Launch mode (decided): stats are counted but hidden; the strip says "welcome new friends!". About and the manifesto sit left of donate.
const Strip: FC<{ showStats?: boolean; stats?: { people: number; posts: number } }> = ({ showStats, stats }) => (
  <div class="strip">
    <span>
      {showStats && stats ? (
        <span class="stats-live">{fillx(w.chrome.stats, { people: <b>{stats.people.toLocaleString('en-US')}</b>, posts: <b>{stats.posts.toLocaleString('en-US')}</b> })} · </span>
      ) : (
        <span class="stats-soon">{w.chrome.welcome} · </span>
      )}
      <a class="mf-link" href="/about">{w.chrome.about}</a> · <a class="mf-link" href="/manifesto">{w.chrome.manifesto}</a> · <a class="dn-link" href="#donate">{w.chrome.donate}</a>
    </span>
    <Me {...useContext(PageContext)} />
  </div>
)

// The strip's right side: sign in and join, or the signed-in viewer as in the mockups ("@myra · for you 3 ·
// keys · sign out"). Unverified accounts see a quiet "verify your email" in place of for you and keys.
// Signed out, sign in and join bring the person back to this page.
const Me: FC<PageInfo> = ({ viewer: v, here }) =>
  !v ? (
    <span class="me"><a href={signInHref(here)}>{w.chrome.signIn}</a><a href={joinHref(here)}>{w.chrome.join}</a></span>
  ) : (
    <span class="me">
      <a class="h" href={`/@${v.handle}`}>@{v.handle}</a>
      {v.verified ? (
        <>
          <a href={`/@${v.handle}#addressed`} title={fill(w.chrome.forYouTitle, { handle: v.handle })}>
            {w.chrome.forYou}{v.unread > 0 && <span class="n">{v.unread >= 100 ? '99+' : v.unread}</span>}
          </a>
          <a href="/keys">{w.chrome.keys}</a>
        </>
      ) : (
        <a class="quiet" href="/check-email">{w.chrome.verifyEmail}</a>
      )}
      <form class="out" method="post" action="/signout">
        <input type="hidden" name={FORM_FIELD} value={v.token} />
        <button type="submit">{w.chrome.signOut}</button>
      </form>
    </span>
  )

// The terms banner (go-live 10.2): on every page for a signed-in viewer who hasn't accepted the announced terms
// version (PageInfo.terms). It can't be dismissed; "i accept" (POST /terms/accept, web/terms-accept.tsx) clears it and
// comes back to this page. Nothing is gated on it. OPEN (#110): new wording, the whole banner.
const TermsBanner: FC = () => {
  const { viewer, terms } = useContext(PageContext)
  if (!viewer || !terms) return null
  const on = terms.effective ? fill(Date.parse(`${terms.effective}T00:00:00Z`) > Date.now() ? w.chrome.termsWillChange : w.chrome.termsChanged, { date: termsDate(terms.effective) }) : w.chrome.termsChange
  return (
    <div class="terms-due" role="region" aria-label={w.chrome.termsRegion}>
      <p>{fill(w.chrome.termsDue, { when: on, version: terms.version })} <a href="/terms#changelog">{w.chrome.termsWhatChanged}</a></p>
      <form method="post" action="/terms/accept">
        <input type="hidden" name={FORM_FIELD} value={viewer.token} />
        <input type="hidden" name="version" value={terms.version} />
        <input type="hidden" name="next" value={terms.next} />
        <button class="btn plain" type="submit">{fill(w.chrome.termsAccept, { version: terms.version })}</button>
      </form>
    </div>
  )
}

// The modal is a form (go-live 10.1): static/js/site.js keeps the hidden freq and amount in step with the buttons, and
// POST /donate opens Stripe Checkout. data-checkout is there only when the Worker has a Stripe key (PageInfo.checkout);
// without it the script keeps the form from posting and the button says checkout opens soon.
const DonateModal: FC = () => {
  const { checkout } = useContext(PageContext)
  return (
  <div class="dn-scrim" id="dn-scrim" hidden>
    <form class="dn" role="dialog" aria-modal="true" aria-labelledby="dn-title" method="post" action="/donate" data-checkout={checkout ? 'on' : undefined}>
      <input type="hidden" name="freq" id="dn-freq" value="once" />
      <input type="hidden" name="amount" id="dn-amount" value="25" />
      <h2 id="dn-title"><span>{w.chrome.donateTitle}</span><button type="button" id="dn-close" aria-label={w.chrome.close}>×</button></h2>
      <div class="sec">
        <p><b>{w.chrome.donatePitch}</b>{w.chrome.donatePitchMore}</p>
        <p>{w.chrome.donateWhy}</p>
        <p class="note">{w.chrome.donateWho}</p>
      </div>
      <div class="sec">
        <span class="lbl">{w.chrome.donateAmount}</span>
        <div class="freq"><button type="button" class="on" data-f="once">{w.chrome.donateOnce}</button><button type="button" data-f="monthly">{w.chrome.donateMonthly}</button></div>
        <div class="amts">
          {[5, 10, 25, 50, 100].map(a => <button type="button" data-a={String(a)} class={a === 25 ? 'on' : undefined}>{fill(w.chrome.donateAmountButton, { amount: a })}</button>)}
        </div>
        <label class="custom" id="dn-custom"><span>$</span><input type="number" min="1" step="1" placeholder={w.chrome.donateOther} id="dn-other" aria-label={w.chrome.donateOther} /></label>
      </div>
      <div class="sec">
        <span class="lbl">{w.chrome.donateNote} <span class="note" style="font-weight:400">{w.chrome.donateNoteOptional}</span></span>
        <textarea id="dn-note" name="note" maxlength={280} placeholder={w.chrome.donateNotePlaceholder}></textarea>
        <label class="chk"><input type="checkbox" id="dn-public" name="public" value="1" checked />{w.chrome.donatePublic}</label>
      </div>
      <div class="sec go">
        <span class="note">{w.chrome.donateSecure}<br />{w.chrome.donateNoCard}</span>
        <button class="btn" type="submit" id="dn-go">{w.chrome.donateGo}</button>
      </div>
    </form>
  </div>
  )
}

// The footer's languages (decided Oct 13): each in its own name, the current one plain. A link sets the `lang` cookie
// (index.ts /language/:code) and comes back to this page. Only where the environment serves more than English.
const LanguageSwitch: FC = () => {
  const served = currentServed()
  if (!served.length) return null
  const lang = currentLang()
  const back = encodeURIComponent(currentPath())
  const list = ['en', ...served].map(code => languages.find(l => l.code === code)!).filter(Boolean)
  return (
    <nav class="langs" aria-label={w.chrome.languageSwitch}>
      {list.map((l, i) => (
        <>
          {i > 0 && ' · '}
          {l.code === lang ? <span lang={l.code} aria-current="true">{l.native ?? l.name}</span> : <a href={`/language/${l.code}?to=${back}`} lang={l.code} hreflang={l.code}>{l.native ?? l.name}</a>}
        </>
      ))}
    </nav>
  )
}

const Footer: FC = () => (
  <footer>
    <div class="vine"><span class="v">{VINE}</span><i class="mark" aria-hidden="true"></i><span class="v">{VINE}</span></div>
    <span class="copy">{fill(w.chrome.copyright, { year: new Date().getFullYear() })}</span>
    <LanguageSwitch />
    <span class="flinks"><a href="/about">{w.chrome.about}</a> · <a class="dn-link" href="#donate">{w.chrome.donate}</a> · <a href="/terms">{w.chrome.terms}</a> · <a href="/privacy">{w.chrome.privacy}</a> · <a href="https://status.shwarm.org">{w.chrome.status}</a></span>
  </footer>
)

// Link previews and canonical links (go-live 11.7). `canonical` is the page's own path with only the query that makes
// it a different page; it becomes <link rel=canonical> and og:url on the site's origin (PageInfo.origin). `card` is
// what a link preview in a chat or social app shows, when it isn't the title and description: a shwarm's title and its
// pitch. Text only: no image is made per page, and the one og:image is the site's mark.
const Social: FC<{ title: string; description?: string; canonical?: string; card?: { title: string; description: string } }> = ({ title, description, canonical, card }) => {
  const { origin } = useContext(PageContext)
  const href = canonical && origin ? origin + canonical : undefined
  const blurb = card?.description ?? description
  return (
    <>
      {href && <link rel="canonical" href={href} />}
      <meta property="og:site_name" content="shwarm" />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={card?.title ?? title} />
      {blurb && <meta property="og:description" content={blurb} />}
      {href && <meta property="og:url" content={href} />}
      <meta name="twitter:card" content="summary" />
    </>
  )
}

export const Layout: FC<{ title: string; description?: string; noindex?: boolean; showStats?: boolean; home?: boolean; canonical?: string; card?: { title: string; description: string }; children?: Child }> = ({ title, description, showStats, home, canonical, card, children }) => (
  <html lang={currentLang()} dir={currentDir()} class={showStats ? undefined : 'launch'}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      <Social title={title} description={description} canonical={canonical} card={card} />
      <meta property="og:image" content="https://shwarm.org/img/shwarm-mark.png" />
      <link rel="icon" type="image/png" href="/img/shwarm-mark.png" />
      <link rel="stylesheet" href="/css/site.css" />
      <link rel="stylesheet" href="/css/common.css" />
      <script src={currentLang() === 'en' ? '/js/words.js' : `/js/words.js?l=${currentLang()}`} defer></script>
      <script src="/js/site.js" defer></script>
    </head>
    <body>
      <a class="skip" href="#main">{w.chrome.skip}</a>
      <div class="wrap">
        <Header home={home} />
        <Strip showStats={showStats} />
        <TermsBanner />
        {children}
        <DonateModal />
        <Footer />
      </div>
    </body>
  </html>
)
