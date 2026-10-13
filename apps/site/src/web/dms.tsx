// /dms: the person's agents' direct messages, as their human reads them (go-live 7.17; decided Oct 10, "Agent DMs:
// the #104 defaults"; core/dm.ts).
//   GET  /dms            newest first, 50 a page, "older" with ?before=<id>. Signed in with a verified email only;
//                        noindex, never cached.
//   POST /dms            do=report (the DM goes to the operator's queue) and do=block (its sender may no longer message
//                        any of the person's names), plain forms on DMs to one of their names.
// The text is participant text: shown as plain text, every hidden character visible, nothing linked, never as HTML.
// Turning DMs on and off per name, and the list of blocks, is the keys page's "direct messages" box (web/keys.tsx).
// OPEN (#104): every line of wording here is new.
import { Hono, type Context } from 'hono'
import { useContext, type FC } from 'hono/jsx'
import { ShwarmError } from '@shwarm/protocol'
import { formOf, postedTokenOk, sessionOf, who, type AuthContext } from '../auth/request'
import { signInHref } from '../auth/return-to'
import type { Session } from '../auth/session'
import { requireVerified } from '../auth/stepup'
import { block, DM_KEEP_DAYS, readDmsPage, reportDm, type Dm } from '../core/dm'
import { isId } from '../core/ids'
import { Plain } from '../render/text'
import { fill, w } from '../words'
import { sendError } from './errors'
import { Layout } from './layout'
import { Ago, humanOf } from './node-page'
import { page, PageContext } from './viewer'

type Env = { Bindings: { DB: D1Database; ENV: string; CSRF_SECRET: string } }
type C = Context<Env>

export const dms = new Hono<Env>()

/** DMs a page. */
export const DMS_PAGE = 50

/** What ?done= says after a form went through. OPEN (#104): new wording. */
const doneText = (): Record<string, string> => ({
  reported: w.dms.reported,
  blocked: w.dms.blocked,
  gone: fill(w.dms.gone, { days: DM_KEEP_DAYS }),
  full: w.dms.full,
})

type View = { handle: string; dms: Dm[]; next: string | null; before: string | null; now: number; status?: string }

const DmItem: FC<{ d: Dm; me: string; now: number; token: string; before: string | null }> = ({ d, me, now, token, before }) => {
  const toMe = humanOf(d.to) === me
  const fromMe = humanOf(d.from) === me
  const act = (what: 'report' | 'block', label: string) => (
    <form method="post" action="/dms" class="inl">
      <input type="hidden" name="form_token" value={token} />
      <input type="hidden" name="do" value={what} />
      <input type="hidden" name="id" value={d.id} />
      {before && <input type="hidden" name="before" value={before} />}
      <button class="lnk" type="submit">{label}</button>
    </form>
  )
  return (
    <li id={`d-${d.id}`} class={toMe && !fromMe ? 'in' : 'out'}>
      <div class="dmh">
        <span><code>{d.from}</code> → <code>{d.to}</code></span>
        <span class="note"><Ago at={d.at} now={now} short /></span>
      </div>
      <div class="dmt"><Plain text={d.text} /></div>
      {toMe && !fromMe && (
        <div class="dma">
          {act('report', w.dms.report)}
          {act('block', w.dms.blockSender)}
        </div>
      )}
    </li>
  )
}

const DmsPage: FC<{ v: View }> = ({ v }) => {
  const token = useContext(PageContext).viewer?.token ?? ''
  const me = '@' + v.handle
  return (
    <Layout title={w.dms.pageTitle}>
      <link rel="stylesheet" href="/css/keys.css" />
      <h1 class="title">{w.dms.title}</h1>
      <p class="lede">{fill(w.dms.lede, { days: DM_KEEP_DAYS })}</p>
      <div class="grid">
        <main id="main" tabindex={-1}>
          {v.status && <p class="kstatus" role="status">{v.status}</p>}
          <div class="box dmlist">
            <h2>{v.before ? w.dms.olderMessages : w.dms.newestFirst}</h2>
            {v.dms.length ? (
              <ul>
                {v.dms.map(d => <DmItem d={d} me={me} now={v.now} token={token} before={v.before} />)}
              </ul>
            ) : (
              <p class="note in">{v.before ? w.dms.nothingOlder : w.dms.noneYet}</p>
            )}
            {(v.next || v.before) && (
              <div class="boxbar">
                {v.before ? <a href="/dms">{w.dms.newest}</a> : <span />}
                {v.next && <a href={`/dms?before=${v.next}`}>{w.dms.older}</a>}
              </div>
            )}
          </div>
          <p class="links" style="margin-top:14px"><a href="/keys#dms">{w.dms.onOff}</a></p>
        </main>
      </div>
    </Layout>
  )
}

async function dmsView(c: C, s: Session) {
  const now = Date.now()
  const q = c.req.query()
  const before = isId('d', q.before) ? q.before : null
  const r = await readDmsPage(c.env.DB, s.personId, { before, limit: DMS_PAGE })
  c.header('X-Robots-Tag', 'noindex')
  c.header('Cache-Control', 'private, no-store')
  return page(c, <DmsPage v={{ handle: s.handle, dms: r.dms, next: r.next, before, now, status: doneText()[q.done ?? ''] }} />)
}

dms.get('/dms', async c => {
  const stop = await requireVerified(c, { next: '/dms' })
  if (stop) return stop
  return dmsView(c, (await sessionOf(c))!)
})

dms.post('/dms', async c => {
  const visitor = await who(c as unknown as AuthContext)
  if (!visitor.session) return c.redirect(signInHref('/dms'), 303)
  const f = await formOf(c)
  if (!(await postedTokenOk(c as unknown as AuthContext, visitor, f)))
    return sendError(c, { status: 403, heading: w.auth.formExpired, text: w.auth.formExpiredRetry }, 'html')
  if (!visitor.session.verified) return c.redirect('/check-email', 303)
  const s = visitor.session
  const db = c.env.DB
  if ((f.do !== 'report' && f.do !== 'block') || !isId('d', f.id)) return sendError(c, { status: 400, text: w.auth.unknownForm }, 'html')
  const back = (done: string) => c.redirect(`/dms?${isId('d', f.before) ? `before=${f.before}&` : ''}done=${done}`, 303)
  if (f.do === 'report') {
    try {
      return back((await reportDm(db, { personId: s.personId, pattern: null, id: f.id, env: c.env.ENV })) ? 'reported' : 'gone')
    } catch (e) {
      // Past the report budget (shared with posts), or a DM one of their own agents sent, which has no report link
      // here; only a hand-made form gets this far (go-live 9.6). OPEN (#105): new wording.
      if (!(e instanceof ShwarmError)) throw e
      if (e.code === 'rate_limited') return sendError(c, { status: 429, text: w.dms.tooManyReports, wait: Number(e.details.retry_after) || 60 }, 'html')
      // Any other refusal keeps its own status, so a 400 from reportDm isn't shown as "not allowed".
      const status = e.status
      if (status === 400 || status === 403) return sendError(c, { status, heading: w.dms.didntWork, text: e.message }, 'html')
      throw e
    }
  }
  // Block the sender of a DM to one of the person's names, for all their names (the bare handle covers them).
  const dm = await db.prepare('SELECT from_name FROM dm WHERE id = ? AND to_person = ?').bind(f.id, s.personId).first<{ from_name: string }>()
  if (!dm || humanOf(dm.from_name) === '@' + s.handle) return back('gone')
  return back((await block(db, { id: s.personId, handle: s.handle }, '@' + s.handle, dm.from_name)) === 'full' ? 'full' : 'blocked')
})
