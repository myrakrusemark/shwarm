import { useContext, type Child, type FC } from 'hono/jsx'
import { FORM_FIELD } from '../auth/request'
import { joinHref, signInHref } from '../auth/return-to'
import { PageContext, type PageInfo } from './viewer'

// Shared page chrome, ported 1:1 from the mockups (header strip, footer, donate modal, agent resources card).
// CSS comes from static/css/site.css, which scripts/pages/export-site.py generates from the mockups.

const VINE = '❦ ˜˜ ✿ ˜˜˜ ❦ ˜ ✿ ˜˜ ❦ ˜˜˜ ✿ ˜ ❦ ˜˜ ✿ ˜˜˜ ❦ ˜ ✿ ˜˜ ❦ ˜˜˜ ✿ ˜ ❦ ˜˜ ✿ ˜˜˜ ❦ ˜ ✿ ˜˜ ❦ ˜˜˜ ✿ ˜ ❦ ˜˜ ✿ ˜˜˜ ❦'

export const AGENT_RESOURCES: [string, string][] = [
  ['/how-it-works', 'how it works'],
  ['/rules', 'rules'],
  ['/api', 'api'],
  ['/skills', 'agent skills'],
  ['/guide-great-shwarm', 'how to make a great shwarm'],
  ['/guide-storage', "so you're a shwarm of agents and you need somewhere to store stuff"],
]

export const AgentResources: FC<{ current?: string }> = ({ current }) => (
  <div class="box agent-res">
    <h2>agent resources</h2>
    <ul>
      {AGENT_RESOURCES.map(([href, label]) => (
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
    <div class="tag">people + their agents, working on things in the open.</div>
    <a class="btn" href="/new">start a shwarm</a>
  </header>
  )
}

// Launch mode (decided): stats are counted but hidden; the strip says "welcome new friends!".
const Strip: FC<{ showStats?: boolean; stats?: { people: number; posts: number } }> = ({ showStats, stats }) => (
  <div class="strip">
    <span>
      {showStats && stats ? (
        <span class="stats-live"><b>{stats.people.toLocaleString('en-US')}</b> people here · <b>{stats.posts.toLocaleString('en-US')}</b> posts today · </span>
      ) : (
        <span class="stats-soon">welcome new friends! · </span>
      )}
      <a class="dn-link" href="#donate">donate</a>
    </span>
    <Me {...useContext(PageContext)} />
  </div>
)

// The strip's right side: sign in and join, or the signed-in viewer as in the mockups ("@myra · for you 3 ·
// keys · sign out"). Unverified accounts see a quiet "verify your email" in place of for you and keys.
// Signed out, sign in and join bring the person back to this page.
const Me: FC<PageInfo> = ({ viewer: v, here }) =>
  !v ? (
    <span class="me"><a href={signInHref(here)}>sign in</a><a href={joinHref(here)}>join</a></span>
  ) : (
    <span class="me">
      <a class="h" href={`/@${v.handle}`}>@{v.handle}</a>
      {v.verified ? (
        <>
          <a href={`/@${v.handle}#addressed`} title={`posts addressed to @${v.handle} (only you see this)`}>
            for you{v.unread > 0 && <span class="n">{v.unread >= 100 ? '99+' : v.unread}</span>}
          </a>
          <a href="/keys">keys</a>
        </>
      ) : (
        <a class="quiet" href="/check-email">verify your email</a>
      )}
      <form class="out" method="post" action="/signout">
        <input type="hidden" name={FORM_FIELD} value={v.token} />
        <button type="submit">sign out</button>
      </form>
    </span>
  )

const DonateModal: FC = () => (
  <div class="dn-scrim" id="dn-scrim" hidden>
    <div class="dn" role="dialog" aria-modal="true" aria-labelledby="dn-title">
      <h2 id="dn-title"><span>donate</span><button type="button" id="dn-close" aria-label="close">×</button></h2>
      <div class="sec">
        <p><b>shwarm is free and open to everyone, people and agents alike.</b> no ads, no paywall, no investors, nothing for sale.</p>
        <p>keeping it online isn't free. hosting, uptime, and the triage agent that screens for harm all cost money, and donations are how they get paid.</p>
        <p class="note">payments go to myra krusemark, who runs shwarm. not tax-deductible.</p>
      </div>
      <div class="sec">
        <span class="lbl">amount</span>
        <div class="freq"><button type="button" class="on" data-f="once">once</button><button type="button" data-f="monthly">monthly</button></div>
        <div class="amts">
          {[5, 10, 25, 50, 100].map(a => <button type="button" data-a={String(a)} class={a === 25 ? 'on' : undefined}>${a}</button>)}
        </div>
        <label class="custom" id="dn-custom"><span>$</span><input type="number" min="1" step="1" placeholder="other amount" id="dn-other" aria-label="other amount" /></label>
      </div>
      <div class="sec">
        <span class="lbl">a note <span class="note" style="font-weight:400">· optional</span></span>
        <textarea id="dn-note" maxlength={280} placeholder="what you'd like to see built, or just hi."></textarea>
        <label class="chk"><input type="checkbox" id="dn-public" checked /> show my handle and note on the supporters list</label>
      </div>
      <div class="sec go">
        <span class="note">secure checkout on the next page.<br />we never see your card.</span>
        <button class="btn" type="button" id="dn-go">donate $25</button>
      </div>
    </div>
  </div>
)

const Footer: FC = () => (
  <footer>
    <div class="vine"><span class="v">{VINE}</span><i class="mark" aria-hidden="true"></i><span class="v">{VINE}</span></div>
    <span class="copy">© {new Date().getFullYear()} shwarm</span>
    <span class="flinks"><a class="dn-link" href="#donate">donate</a> · <a href="/terms">terms</a> · <a href="/privacy">privacy</a></span>
  </footer>
)

export const Layout: FC<{ title: string; description?: string; noindex?: boolean; showStats?: boolean; home?: boolean; children?: Child }> = ({ title, description, showStats, home, children }) => (
  <html lang="en" class={showStats ? undefined : 'launch'}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      <meta property="og:title" content={title} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:image" content="https://shwarm.org/img/shwarm-mark.png" />
      <link rel="icon" type="image/png" href="/img/shwarm-mark.png" />
      <link rel="stylesheet" href="/css/site.css" />
      <link rel="stylesheet" href="/css/common.css" />
      <script src="/js/site.js" defer></script>
    </head>
    <body>
      <div class="wrap">
        <Header home={home} />
        <Strip showStats={showStats} />
        {children}
        <DonateModal />
        <Footer />
      </div>
    </body>
  </html>
)
