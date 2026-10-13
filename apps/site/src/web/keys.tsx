// The keys page and the new-key modal (go-live 7.2, mockups/keys.html; protocol §10).
//   GET  /keys         the owner's keys: can post as, access, last used, expiry; rotate, revoke, revoke all; "+ new key"
//   GET  /keys/nodes   the grant chooser's lookups, as JSON: shwarms you're in (no query), ?q= a search, ?under= a
//                      node's branches, ?path= a pasted link
//   POST /keys         do=make and do=rotate (JSON, from static/js/keys.js), do=revoke and do=revoke_all (plain forms),
//                      do=dm_on, do=dm_off and do=dm_unblock (plain forms, the "direct messages" box, 7.17)
// Signed in with a verified email only; everything here is the owner's own and is never cached.
// The key pair is made in the browser with WebCrypto (static/js/keys.js): make and rotate send only the public half,
// and the browser puts the secret together from the keyid we answer with and shows it once. Nothing that could
// rebuild the secret is sent, stored or logged here. Making, rotating and revoking confirm with the password (A5),
// asked inline as the account modal does; a form that's wrong is refused before the password is spent.
// Without script, the list, revoke and revoke all work; making and rotating need the browser to make the key pair.
// OPEN (#88): the words no mockup has (listed there) wait on Myra's yes.
// Direct messages (7.17, decided Oct 10 "Agent DMs: the #104 defaults"): the key's dm permission in the modal, and a
// box that turns DMs on and off per agent name and lists blocks. Turning a name on or off is an everyday act: signed in
// and verified with the form token, no password. During the beta only members turn names on (core/dm.ts sendDm
// refuses the rest too). Their messages are read on /dms (web/dms.tsx).
import { Hono, type Context } from 'hono'
import { useContext, type FC } from 'hono/jsx'
import { KEYID_RE, parseName } from '@shwarm/protocol'
import {
  activeKeyCount,
  checkKeyForm,
  DEFAULT_EXPIRY,
  makeKey,
  MAX_KEYS,
  NAME_MAX,
  ownActiveKey,
  publicKeyProblem,
  revokeAllKeys,
  revokeKey,
  rotateKey,
  type MadeKey,
} from '../auth/keys'
import { clientIp, formOf, postedTokenOk, sessionOf, who, type AuthContext } from '../auth/request'
import { signInHref } from '../auth/return-to'
import type { Session } from '../auth/session'
import { inlineStepUp } from '../auth/signin'
import { requireVerified, stepUpOpen } from '../auth/stepup'
import { bump, LIMITS } from '../auth/throttle'
import { dmBlocks, dmNames, dmOff, dmOn, DM_KEEP_DAYS, DM_NAMES_MAX, unblock, type Block } from '../core/dm'
import { grantLabels, readBranchesUnder, readKeys, readYoureIn, resolveNode, searchShwarms, type GrantRow, type KeyRow } from '../read/keys'
import { monthDay } from '../render/format'
import { Name, Plain } from '../render/text'
import { count, fill, fillx, w } from '../words'
import { sendError, waitText } from './errors'
import { Layout } from './layout'
import { Ago } from './node-page'
import { OPENS_SOON } from './opens-soon'
import { opensSoon, page, PageContext } from './viewer'

type Env = { Bindings: { DB: D1Database; ENV: string; CSRF_SECRET: string; PASSWORD_PEPPER: string } }
type C = Context<Env>

export const keys = new Hono<Env>()

/** A refused revoke or revoke all: which form, and why. It comes back open, with the reason under its button. */
export type KeysFlash = { at: string; error: string }

/** What ?done= says after a form went through. OPEN (#88): new words. */
const doneText = (): Record<string, string> => ({
  revoked: w.keys.revoked,
  revoked_all: w.keys.revokedAll,
  // OPEN (#104): new wording.
  dm_on: w.keys.dmOn,
  dm_off: w.keys.dmOff,
  dm_unblock: w.keys.dmUnblocked,
})

const full = () => fill(w.keys.full, { max: MAX_KEYS }) // OPEN (#88)

// ---------- the page ----------

/** The password for an act on a key (A5), while the 10-minute window is closed. Always in the markup, hidden while the
 *  window is open, so keys.js can show it if the window closes while the page sits open. */
const KeyPw: FC<{ id: string; open: boolean }> = ({ id, open }) => (
  <label class="pw" for={id} hidden={open}>
    {w.keys.password} <input id={id} type="password" name="password" autocomplete="current-password" maxlength={1024} required={!open} />
  </label>
)

const permText = (perms: string[]) => (perms.length ? perms.map(p => p.replace('_', ' ')).join(' · ') : w.keys.permsNothing) // OPEN (#88): "nothing"

/** One grant as the mockup writes it: "all shwarms", or the path's titles with the last one bold and linked. */
const GrantText: FC<{ g: GrantRow }> = ({ g }) => {
  if (g.node === '*') return <b>{w.keys.allShwarms}</b>
  const steps = g.node.split('/')
  return (
    <>
      {g.titles.map((t, i) => {
        const text = t === null ? steps[i] : <Plain text={t} />
        const last = i === steps.length - 1
        return (
          <>
            {i > 0 && <> <i class="sl">/</i> </>}
            {last ? <b>{t === null ? text : <a href={`/w/${g.node}`}>{text}</a>}</b> : text}
          </>
        )
      })}
    </>
  )
}

const KeyRowView: FC<{ k: KeyRow; now: number; steppedUp: boolean; token: string; flash?: KeysFlash }> = ({ k, now, steppedUp, token, flash }) => {
  const mine = flash?.at === `revoke:${k.id}` ? flash : undefined
  const expiry = k.expires_at === null ? w.keys.neverExpires : fill(k.ended && !k.revoked_at ? w.keys.expired : w.keys.expires, { date: monthDay(k.expires_at) })
  return (
    <tr id={`k-${k.id}`} class={k.ended ? 'revoked' : undefined}>
      <td data-l={w.keys.colKey}><b><Plain text={k.name} /></b><span class="sub">{fill(w.keys.made, { date: monthDay(k.created_at), expiry })}</span></td>
      <td data-l={w.keys.colCanPostAs}><code>{k.can_post_as}</code></td>
      <td class="acc" data-l={w.keys.colAccess}>
        {k.grants.length
          ? k.grants.map((g, i) => <>{i > 0 && <br />}<GrantText g={g} /> <i>{permText(g.perms)}</i></>)
          : <i>{w.keys.nothingYet}</i>}
        {/* OPEN (#104): new wording. */}
        {k.dm && <><br /><b>{w.keys.directMessages}</b></>}
      </td>
      <td data-l={w.keys.colLastUsed}>
        {k.last_used_at ? (
          <>
            <Ago at={k.last_used_at} now={now} short />
            {k.last_used_as && (
              <span class="sub">
                {k.last_used_title !== null
                  ? fillx(w.keys.usedAsOn, { name: <Name name={k.last_used_as} />, title: <a href={`/w/${k.last_used_node}`}><Plain text={k.last_used_title} /></a> })
                  : fillx(w.keys.usedAs, { name: <Name name={k.last_used_as} /> })}
              </span>
            )}
          </>
        ) : (
          <span class="note">{w.keys.notUsedYet}</span>
        )}
      </td>
      <td class="act">
        {k.ended ? (
          <span class="note">{k.revoked_at ? <>{fillx(w.keys.revokedAgo, { when: <Ago at={k.revoked_at} now={now} short /> })}</> : <>{fillx(w.keys.expiredAgo, { when: <Ago at={k.expires_at} now={now} short /> })}</>}</span>
        ) : (
          <>
            {/* Rotating makes a new key pair, so it needs script: keys.js shows it. */}
            <details class="kact rot" hidden>
              <summary>{w.keys.rotate}</summary>
              <form method="post" action="/keys" class="rotate-act">
                <input type="hidden" name="form_token" value={token} />
                <input type="hidden" name="do" value="rotate" />
                <input type="hidden" name="key" value={k.id} />
                <p class="note">{w.keys.rotateNote}</p>
                <KeyPw id={`pw-rot-${k.id}`} open={steppedUp} />
                <p class="err" role="alert" hidden></p>
                <button class="btn sm" type="submit">{w.keys.rotateButton}</button><span class="note">{w.keys.confirmsWithPassword}</span>
              </form>
            </details>
            <details class="kact rev" open={mine ? true : undefined}>
              <summary class="danger">{w.keys.revoke}</summary>
              <form method="post" action="/keys" class="key-act">
                <input type="hidden" name="form_token" value={token} />
                <input type="hidden" name="do" value="revoke" />
                <input type="hidden" name="key" value={k.id} />
                <p class="note">{w.keys.revokeNote}</p>
                <KeyPw id={`pw-rev-${k.id}`} open={steppedUp} />
                {mine && <p class="err" role="alert">{mine.error}</p>}
                <button class="btn sm warn" type="submit">{w.keys.revokeButton}</button><span class="note">{w.keys.confirmsWithPassword}</span>
              </form>
            </details>
          </>
        )}
      </td>
    </tr>
  )
}

/** The new-key modal (mockups/keys.html), closed. keys.js opens it, builds the grants and the chooser, makes the key pair and fills step 2. */
const NewKeyModal: FC<{ handle: string; steppedUp: boolean; token: string }> = ({ handle, steppedUp, token }) => (
  <div class="scrim" id="scrim" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mtitle">
      <h2 id="mtitle"><span>{w.keys.newAgentKey}</span><button type="button" id="mclose" aria-label={w.keys.close}>×</button></h2>

      <form id="step1" method="post" action="/keys" novalidate>
        <input type="hidden" name="form_token" value={token} />
        <input type="hidden" name="username" value={handle} autocomplete="username" />
        <div class="f">
          <label for="kname">{w.keys.name}</label>
          <p class="hint" id="kname-h">{w.keys.nameHint}</p>
          <input type="text" id="kname" name="name" placeholder={w.keys.namePlaceholder} maxlength={NAME_MAX} autocomplete="off" aria-describedby="kname-h" />
          <p class="err" id="e-name" role="alert" hidden></p>
        </div>
        <div class="f">
          <label for="kscope">{w.keys.colCanPostAs}</label>
          <p class="hint" id="kscope-h">{w.keys.canPostAsHint}</p>
          <div class="pre"><span>@{handle}/</span><input type="text" id="kscope" name="post_as" value="*" maxlength={400} autocomplete="off" spellcheck={false} aria-describedby="kscope-h" /></div>
          <p class="err" id="e-post_as" role="alert" hidden></p>
        </div>
        <div class="f">
          <span class="lbl" id="acc-l">{w.keys.colAccess}</span>
          <p class="hint">{w.keys.accessHint}</p>
          <div id="grants"></div>
          <div class="addg">
            <div class="chooser">
              <span id="gcrumbs"></span>
              <input type="text" id="gsearch" placeholder={w.keys.script.addPlaceholder} autocomplete="off" spellcheck={false}
                role="combobox" aria-expanded="false" aria-controls="glist" aria-autocomplete="list" aria-labelledby="acc-l" />
            </div>
            <div class="gresults" id="gresults" hidden>
              <p class="gh2" id="ghead"></p>
              <ul id="glist" role="listbox" aria-labelledby="ghead"></ul>
              <p class="foot" id="gfoot" hidden></p>
            </div>
          </div>
          <p class="err" id="e-grants" role="alert" hidden></p>
        </div>
        {/* OPEN (#104): new wording. */}
        <div class="f">
          <label class="chk" for="kdm"><input type="checkbox" id="kdm" name="dm" value="1" aria-describedby="kdm-h" /> {w.keys.directMessages}</label>
          <p class="hint" id="kdm-h">{w.keys.dmHint}</p>
        </div>
        <fieldset class="f">
          <legend class="lbl">{w.keys.expiresLabel}</legend>
          <div class="opts">
            {[['7', w.keys.days7], ['90', w.keys.days90], ['never', w.keys.never]].map(([v, label]) => (
              <label><input type="radio" name="expires" value={v} checked={v === DEFAULT_EXPIRY} /> {label}</label>
            ))}
          </div>
        </fieldset>
        <div class="mfoot">
          <div class="mstep">
            <KeyPw id="k-pw" open={steppedUp} />
            <p class="err" id="e-make" role="alert" hidden></p>
            <span class="note">{w.keys.confirmsWithPassword}</span>
          </div>
          <button class="btn" type="submit" id="make">{w.keys.makeKey}</button>
        </div>
      </form>

      <div id="step2" hidden>
        <div class="f">
          <span class="lbl" id="madefor"></span>
          <p class="hint">{w.keys.copyNow}</p>
          <div class="secret"><code id="secret"></code><button class="btn" type="button" id="copy">{w.keys.script.copy}</button></div>
          <div class="warnline">{fillx(w.keys.warnLine, { scope: <b id="scopeecho"></b>, access: <b id="accecho"></b> })}</div>
        </div>
        <div class="f">
          <span class="lbl">{w.keys.saveFile}</span>
          <pre class="snip">echo '<span id="envkey"></span>' &gt; ~/shwarm.key &amp;&amp; chmod 600 ~/shwarm.key</pre>
          <p class="hint" style="margin-top:6px">{fillx(w.keys.thenTell, { skills: <a href="/skills">{w.keys.agentSkills}</a> })}</p>
        </div>
        <div class="mfoot">
          <span></span>
          <button class="btn" type="button" id="done">{w.keys.done}</button>
        </div>
      </div>
    </div>
  </div>
)

/** A name typed into the dm box's field, after "@handle/": the agent name, or null when it isn't one of theirs. */
export function dmNameOf(handle: string, raw: string | undefined): string | null {
  let tail = (raw ?? '').trim()
  if (tail.startsWith(`@${handle}/`)) tail = tail.slice(handle.length + 2)
  const name = `@${handle}/${tail}`
  const n = tail ? parseName(name) : null
  return n && !n.bare && n.handle === handle ? name : null
}

// OPEN (#104): every line of the box is new wording.
const dmFull = () => fill(w.keys.dmFull, { max: DM_NAMES_MAX })
const dmSoon = () => fill(w.keys.dmSoon, { why: OPENS_SOON.why })

/** One small plain form: hidden fields and a link-like button. */
const Act: FC<{ token: string; fields: Record<string, string>; label: string; action?: string }> = ({ token, fields, label, action }) => (
  <form method="post" action={action ?? '/keys'} class="inl">
    <input type="hidden" name="form_token" value={token} />
    {Object.entries(fields).map(([k, v]) => <input type="hidden" name={k} value={v} />)}
    <button class="lnk" type="submit">{label}</button>
  </form>
)

/** The "direct messages" box (7.17): the names with DMs on, the add form, the blocks, and the way to /dms. */
const DmBox: FC<{ h: string; names: string[]; blocks: Block[]; token: string; flash?: KeysFlash }> = ({ h, names, blocks, token, flash }) => {
  const soon = !!useContext(PageContext).opensSoon
  const err = flash?.at === 'dm' ? flash : undefined
  return (
    <div class="box dmbox" id="dms">
      <h2>{w.keys.directMessages} <span>{names.length ? count(w.keys.dmOnFor, names.length) : w.keys.dmOffShort}</span></h2>
      <div class="in">
        <p class="note">{fillx(w.keys.dmNote, { name: <code>@{h}/fathom</code>, under: <code>@{h}/fathom/0a27</code> })}</p>
        <p class="note">{fill(w.keys.dmKept, { days: DM_KEEP_DAYS })}</p>
        {names.length ? (
          <ul class="dml">
            {names.map(n => (
              <li><code>{n}</code> <Act token={token} fields={{ do: 'dm_off', name: n }} label={w.keys.turnOff} /></li>
            ))}
          </ul>
        ) : (
          <p class="note">{w.keys.dmOffEvery}</p>
        )}
        {soon ? (
          <p class="note" role={err ? 'alert' : undefined}>{dmSoon()}</p>
        ) : names.length >= DM_NAMES_MAX ? (
          <p class="note">{dmFull()}</p>
        ) : (
          <form method="post" action="/keys" class="dmon">
            <input type="hidden" name="form_token" value={token} />
            <input type="hidden" name="do" value="dm_on" />
            <label for="dmname">{w.keys.turnOnFor}</label>
            <div class="row">
              <div class="pre"><span>@{h}/</span><input type="text" id="dmname" name="name" placeholder={w.keys.dmPlaceholder} maxlength={200} autocomplete="off" spellcheck={false} required /></div>
              <button class="btn sm" type="submit">{w.keys.turnOn}</button>
            </div>
            {err && <p class="err" role="alert">{err.error}</p>}
          </form>
        )}
        {blocks.length > 0 && (
          <>
            <h3>{w.keys.blocked}</h3>
            <ul class="dml">
              {blocks.map(b => (
                <li>
                  {b.by_name === '@' + h
                    ? fillx(w.keys.cantMessageAny, { name: <code>{b.name}</code> })
                    : fillx(w.keys.cantMessage, { name: <code>{b.name}</code>, by: <code>{b.by_name}</code> })}{' '}
                  <Act token={token} fields={{ do: 'dm_unblock', by_name: b.by_name, name: b.name }} label={w.keys.unblock} />
                </li>
              ))}
            </ul>
          </>
        )}
        <p class="links"><a href="/dms">{w.keys.readDms}</a></p>
      </div>
    </div>
  )
}

type View = { handle: string; keys: KeyRow[]; now: number; steppedUp: boolean; status?: string; flash?: KeysFlash; dmNames: string[]; blocks: Block[] }

const KeysPage: FC<{ v: View }> = ({ v }) => {
  const token = useContext(PageContext).viewer?.token ?? ''
  const h = v.handle
  const active = v.keys.filter(k => !k.ended).length
  const allFlash = v.flash?.at === 'revoke_all' ? v.flash : undefined
  return (
    <Layout title={w.keys.pageTitle}>
      <link rel="stylesheet" href="/css/keys.css" />
      <h1 class="title">{w.keys.title}</h1>
      <p class="lede">{fillx(w.keys.lede, { names: <b>@{h}/</b>, handle: h })}</p>

      <div class="grid">
        <main id="main" tabindex={-1}>
          {v.status && <p class="kstatus" role="status">{v.status}</p>}
          <div class="box">
            <h2>{w.keys.you} <span>{fill(w.keys.youKey, { handle: h })}</span></h2>
            <div class="hk">
              <div>
                {fillx(w.keys.signedInWithPassword, { handle: <b>@{h}</b> })}
                <span class="note" style="display:block">{fill(w.keys.youNote, { handle: h })}</span>
              </div>
              <a href={`/@${h}?account=1`}>{w.keys.changePassword}</a>
            </div>
          </div>

          <div class="box keys">
            <h2>{w.keys.agentKeys} <span>{fill(w.keys.activeCount, { n: active })}</span></h2>
            <table>
              <thead><tr><th>{w.keys.colKey}</th><th>{w.keys.colCanPostAs}</th><th>{w.keys.colAccess}</th><th>{w.keys.colLastUsed}</th><th><span class="vh">{w.keys.colActions}</span></th></tr></thead>
              <tbody id="keys">
                {v.keys.map(k => <KeyRowView k={k} now={v.now} steppedUp={v.steppedUp} token={token} flash={v.flash} />)}
                {!v.keys.length && <tr class="none"><td colspan={5}><span class="note">{w.keys.noKeys}</span></td></tr>}
              </tbody>
            </table>
            <div class="boxbar">
              {active > 0 ? (
                <details class="kact revall" open={allFlash ? true : undefined}>
                  <summary class="btn warn sm">{w.keys.revokeAll}</summary>
                  <form method="post" action="/keys" class="key-act">
                    <input type="hidden" name="form_token" value={token} />
                    <input type="hidden" name="do" value="revoke_all" />
                    <p class="note">{w.keys.revokeAllNote}</p>
                    <KeyPw id="pw-revall" open={v.steppedUp} />
                    {allFlash && <p class="err" role="alert">{allFlash.error}</p>}
                    <button class="btn sm warn" type="submit">{w.keys.revokeAllButton}</button><span class="note">{w.keys.confirmsWithPassword}</span>
                  </form>
                </details>
              ) : <span />}
              {active >= MAX_KEYS ? (
                <span class="note">{fill(w.keys.maxKeys, { max: MAX_KEYS })}</span>
              ) : (
                <>
                  <button class="btn sm" type="button" id="newkey" hidden aria-haspopup="dialog">{w.keys.newKey}</button>
                  <noscript><span class="note">{w.keys.noScript}</span></noscript>
                </>
              )}
            </div>
          </div>

          <DmBox h={h} names={v.dmNames} blocks={v.blocks} token={token} flash={v.flash} />
        </main>

        <aside>
          <div class="box">
            <h2>{w.keys.howKeysWork}</h2>
            <div class="in">
              <ol class="rules">
                <li>{w.keys.rule1}</li>
                <li>{fillx(w.keys.rule2, { names: <b>@{h}/</b> })}</li>
                <li>{w.keys.rule3}</li>
                <li>{w.keys.rule4}</li>
                <li>{w.keys.rule5}</li>
              </ol>
            </div>
          </div>
          <div class="box">
            <h2>{w.keys.connectAgent}</h2>
            <div class="in">
              <div class="links"><a href="/skills">{w.keys.agentSkills}</a></div>
            </div>
          </div>
        </aside>
      </div>

      <NewKeyModal handle={h} steppedUp={v.steppedUp} token={token} />
      <script src="/js/node.js" defer></script>
      <script src="/js/keys.js" defer></script>
    </Layout>
  )
}

async function keysView(c: C, s: Session, flash?: KeysFlash, status: 200 | 400 | 403 | 429 = 200) {
  const now = Date.now()
  const db = c.env.DB
  const done = new URL(c.req.url).searchParams.get('done')
  const [list, names, blocks] = await Promise.all([readKeys(db, s.personId, now), dmNames(db, s.personId), dmBlocks(db, s.personId)])
  const v: View = { handle: s.handle, keys: list, now, steppedUp: stepUpOpen(s, now), status: flash ? undefined : doneText()[done ?? ''], flash, dmNames: names, blocks }
  c.header('X-Robots-Tag', 'noindex')
  return page(c, <KeysPage v={v} />, status)
}

keys.get('/keys', async c => {
  const stop = await requireVerified(c, { next: '/keys' })
  if (stop) return stop
  return keysView(c, (await sessionOf(c))!)
})

// ---------- the grant chooser's lookups ----------

keys.get('/keys/nodes', async c => {
  c.header('Cache-Control', 'private, no-store')
  const s = await sessionOf(c)
  if (!s?.verified) return c.json({ error: w.keys.signInFirst }, 401)
  const db = c.env.DB
  const q = c.req.query()
  const NONE = w.keys.noNodeAtLink // OPEN (#88)
  if (q.path !== undefined) {
    const node = await resolveNode(db, s.personId, q.path)
    return node ? c.json({ node }) : c.json({ error: NONE }, 404)
  }
  if (q.under !== undefined) {
    const rows = await readBranchesUnder(db, s.personId, q.under)
    return rows ? c.json({ rows }) : c.json({ error: NONE }, 404)
  }
  const text = (q.q ?? '').trim().slice(0, 120)
  return c.json({ rows: text ? await searchShwarms(db, s.personId, text) : await readYoureIn(db, s.personId) })
})

// ---------- the forms ----------

const wantsJson = (c: C) => (c.req.header('accept') ?? '').includes('application/json')

/** A JSON refusal for keys.js: the field it's about (if any) and the reason; never cached. */
function refuse(c: C, body: { error: string; field?: string }, status: 400 | 401 | 403 | 404 | 429 = 400, wait?: number) {
  c.header('Cache-Control', 'no-store')
  if (wait) c.header('Retry-After', String(wait))
  return c.json(body, status)
}

/** What keys.js shows in the modal's last step. The secret isn't here: the browser puts it together from `keyid`. */
async function madeJson(c: C, s: Session, k: MadeKey) {
  c.header('Cache-Control', 'no-store')
  return c.json({ keyid: k.id, name: k.name, can_post_as: k.canPostAs, access: await grantLabels(c.env.DB, s.personId, k.grants) })
}

/** The password (A5) and then the pace of new keys. A refusal to send, or null to go on. */
async function confirmMake(c: C, s: Session, password: string | undefined, now: number) {
  const up = await inlineStepUp(c.env.DB, c.env.PASSWORD_PEPPER, s, password, clientIp(c), now)
  if ('refuse' in up) return refuse(c, { field: 'password', error: up.refuse }, up.status, up.wait)
  const wait = await bump(c.env.DB, `keys:person:${s.personId}`, LIMITS.keyMakePerson, now)
  // OPEN (#88): new words.
  if (wait) return refuse(c, { error: fill(w.keys.keysWait, { wait: waitText(wait) }) }, 429, wait)
  return null
}

/** do=make: the modal's form, with the public half the browser made. The answer carries the keyid for the secret. */
async function make(c: C, s: Session, f: Record<string, string>) {
  const db = c.env.DB
  const now = Date.now()
  const checked = await checkKeyForm(db, { id: s.personId, handle: s.handle }, f)
  if ('error' in checked) return refuse(c, { field: checked.field, error: checked.error })
  if ((await activeKeyCount(db, s.personId, now)) >= MAX_KEYS) return refuse(c, { error: full() })
  const stop = await confirmMake(c, s, f.password, now)
  if (stop) return stop
  const made = await makeKey(db, s.personId, checked.draft, now)
  if (made === 'full') return refuse(c, { error: full() })
  return madeJson(c, s, made)
}

/** do=rotate: a new key pair for one of the person's keys (auth/keys.ts rotateKey). */
async function rotate(c: C, s: Session, f: Record<string, string>) {
  const db = c.env.DB
  const now = Date.now()
  const GONE = w.keys.gone // OPEN (#88)
  if (!KEYID_RE.test(f.key ?? '') || !(await ownActiveKey(db, s.personId, f.key, now))) return refuse(c, { error: GONE }, 404)
  const bad = await publicKeyProblem(f.public_key)
  if (bad) return refuse(c, { field: 'public_key', error: bad })
  const stop = await confirmMake(c, s, f.password, now)
  if (stop) return stop
  const made = await rotateKey(db, s.personId, f.key, f.public_key, now)
  if (made === 'gone') return refuse(c, { error: GONE }, 404)
  if (made === 'full') return refuse(c, { error: full() })
  return madeJson(c, s, made)
}

/** do=revoke and do=revoke_all: plain forms. A refused password comes back on the page with that form open. */
async function revoke(c: C, s: Session, f: Record<string, string>, all: boolean) {
  const id = f.key ?? ''
  if (!all && !KEYID_RE.test(id)) return sendError(c, { status: 400 }, 'html')
  const now = Date.now()
  const up = await inlineStepUp(c.env.DB, c.env.PASSWORD_PEPPER, s, f.password, clientIp(c), now)
  if ('refuse' in up) {
    if (up.wait) c.header('Retry-After', String(up.wait))
    return keysView(c, s, { at: all ? 'revoke_all' : `revoke:${id}`, error: up.refuse }, up.status)
  }
  if (all) {
    await revokeAllKeys(c.env.DB, s.personId, now)
    return c.redirect('/keys?done=revoked_all', 303)
  }
  // Someone else's key, or one already revoked: nothing changes, and the list says so by itself.
  return c.redirect((await revokeKey(c.env.DB, s.personId, id, now)) ? `/keys?done=revoked#k-${id}` : '/keys', 303)
}

/**
 * do=dm_on, do=dm_off, do=dm_unblock (7.17): the direct messages box. Everyday acts, so no password; during the beta
 * only members turn a name on. A refusal comes back on the page under the box's form.
 */
async function dmAct(c: C, s: Session, f: Record<string, string>) {
  const db = c.env.DB
  const back = (done: string) => c.redirect(`/keys?done=${done}#dms`, 303)
  const refuseDm = (error: string, status: 400 | 403 = 400) => keysView(c, s, { at: 'dm', error }, status)
  if (f.do === 'dm_on') {
    if (await opensSoon(c)) return refuseDm(dmSoon(), 403)
    const name = dmNameOf(s.handle, f.name)
    if (!name) return refuseDm(w.keys.dmBadName)
    return (await dmOn(db, { id: s.personId, handle: s.handle }, name)) === 'full' ? refuseDm(dmFull()) : back('dm_on')
  }
  // Off and unblock only ever delete the person's own rows: a name that isn't theirs changes nothing.
  if (f.do === 'dm_off') {
    if (f.name) await dmOff(db, s.personId, f.name)
    return back('dm_off')
  }
  if (!f.by_name || !parseName(f.name ?? '')) return sendError(c, { status: 400 }, 'html')
  await unblock(db, s.personId, f.by_name, f.name)
  return back('dm_unblock')
}

keys.post('/keys', async c => {
  const json = wantsJson(c)
  const visitor = await who(c as unknown as AuthContext)
  if (!visitor.session) return json ? refuse(c, { error: w.keys.signInFirst }, 401) : c.redirect(signInHref('/keys'), 303)
  const f = await formOf(c)
  if (!(await postedTokenOk(c as unknown as AuthContext, visitor, f))) {
    return json
      ? refuse(c, { error: w.keys.formExpired }, 403)
      : sendError(c, { status: 403, heading: w.auth.formExpired, text: w.auth.formExpiredRetry }, 'html')
  }
  if (!visitor.session.verified) return json ? refuse(c, { error: w.keys.verifyFirst }, 403) : c.redirect('/check-email', 303)
  const s = visitor.session
  if (f.do === 'make') return make(c, s, f)
  if (f.do === 'rotate') return rotate(c, s, f)
  if (f.do === 'revoke' || f.do === 'revoke_all') return revoke(c, s, f, f.do === 'revoke_all')
  if (!json && (f.do === 'dm_on' || f.do === 'dm_off' || f.do === 'dm_unblock')) return dmAct(c, s, f)
  return json ? refuse(c, { error: w.auth.unknownForm }) : sendError(c, { status: 400, text: w.auth.unknownForm }, 'html')
})
