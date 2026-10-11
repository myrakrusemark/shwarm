// GET /w/<path> (go-live 3.3, 3.4, 3.6) and /w/<path>/s/<n> (5.2, a submission's page): one URL, three forms. Browsers get the page, agents the text prompt
// (the default, protocol §4) or the Node JSON, picked by ?format=text|json|html or else the Accept header. A closed shwarm's
// page is its result page (5.7), with its thread at ?thread=1. GET /w/<path>/log (5.7) is the audit log, as JSON.
// Signed-out responses carry a weak ETag (the node's version plus its stats' time) and answer If-None-Match with
// 304, and may be cached for 15 seconds; signed-in responses are never stored. Reads are capped per network. A repeat
// signed-out read whose ETag this isolate saw in D1 within those 15 seconds gets its 304 with no D1 read (version-memo.ts).
// The page's activity strip covers the last 14 UTC days, which move at midnight with no write, so a page's ETag and
// memo key also carry the UTC day: the first read after midnight is a miss, and a cached page is a day old 15 seconds at most.
import { Hono, type Context } from 'hono'
import { ShwarmError } from '@shwarm/protocol'
import { formToken } from '../auth/csrf'
import { clientIp, formOf, hasSessionCookie, postedTokenOk, sessionOf, who, type AuthContext } from '../auth/request'
import { signInHref } from '../auth/return-to'
import type { Session } from '../auth/session'
import { inlineStepUp } from '../auth/signin'
import { bump, LIMITS } from '../auth/throttle'
import { stepUpOpen } from '../auth/stepup'
import { siteActor, type Actor } from '../core/actor'
import type { CheckInput, CheckResult } from '../core/checking'
import { peekThreadTokens } from '../core/limits'
import { reportPost } from '../core/reports'
import { flagNode } from '../core/flags'
import { isId } from '../core/ids'
import { runInTree } from '../do/shwarm-tree'
import {
  parseNodePath,
  readBuiltOn,
  readChain,
  readChecks,
  readSubmission,
  readSubmissionHistory,
  readSubmissions,
  SHOWS,
  SORTS,
  type Chain,
  type Show,
  type Sort,
} from '../read/node'
import { renderNodeJson, renderPrompt, renderSubmissionJson, renderSubmissionPrompt } from '../render/prompt'
import type { SubmitInput, SubmitResult } from '../core/posts'
import { loadAgentView, loadPageData, loadResultData } from '../read/views'
import { BAD_FILTER, logFilter, readLog, renderLogJson } from '../read/log'
import { readTreeVersion } from '../read/result'
import { readTombstone } from '../read/tombstone'
import { utcDay } from '../read/activity'
import { sendError, waitText } from './errors'
import { pickFormat, type Format } from './format'
import { editHref, NodePage, type Flash } from './node-page'
import { ResultPage } from './result-page'
import { SubmissionPage, type SubFlash } from './submission-page'
import { overReadCap } from './read-limit'
import { knownVersion, noteVersion } from './version-memo'
import { checkoutOn, page } from './viewer'

export { pickFormat, type Format }

type Env = {
  Bindings: { DB: D1Database; TREE: DurableObjectNamespace; AI?: Ai; TRIAGE_MODEL?: string; ENV: string; SITE_MODE: string; CSRF_SECRET: string; PASSWORD_PEPPER: string }
}
type C = Context<Env>

const TYPES: Record<Format, string> = { html: 'text/html', text: 'text/plain', json: 'application/json' }

/** Bump to change every ETag when the rendering changes (test/render-version.test.ts fails until you do). */
export const RENDER_VERSION = '14' // 2: no lobby or variants (Oct 9). 3: key events, log box classes (Oct 9). 4: the log's `key` field (v0, Oct 9). 5: the activity strip (Oct 10). 6: edit until join, the safety guide link, how to join in (Oct 10). 7: links for agents under how to take part, count wording (Oct 10). 8: npx @shwarm/cli under how to take part (Oct 10). 9: direct messages and who takes them, under how to take part; take_part in the JSON; "report" on every post (Oct 10). 10: "flag this shwarm" in the head, the "paused for review" banner, paused in the text and JSON (Oct 10). 11: the manifesto link in the header strip (Oct 10). 12: the donate modal is a form posting to /donate (Oct 10). 13: the canonical link and link-preview meta tags (go-live 11.7, Oct 11). 14: shwarming safely, how to sign, what impact means and the beta line in the text and JSON (go-live 7.11, 7.14, Oct 11)

// Production's reading pages stay closed in holding mode and open in beta (go-live 3.10); core/site-mode.ts.
import { actsLimited, readingOpen } from '../core/site-mode'
export { readingOpen }

function common(c: C, path: string | null) {
  c.header('Vary', 'Accept, Cookie')
  if (c.env.SITE_MODE !== 'open') c.header('X-Robots-Tag', 'noindex')
  if (path) {
    const base = `${new URL(c.req.url).origin}/w/${path}`
    c.header('Link', (['text', 'json', 'html'] as Format[]).map(f => `<${base}?format=${f}>; rel="alternate"; type="${TYPES[f]}"`).join(', '))
  }
}

const notFound = (c: C, f: Format, text = 'there is no shwarm or branch at this address.') =>
  sendError(c, { status: 404, code: 'no_such_node', text }, f)

const errorOut = (c: C, f: Format, status: 400 | 429, code: string, text: string, extra: Record<string, unknown> = {}) =>
  sendError(c, { status, code, text, extra }, f)

/** 410 for a node the operator hid, or one under it (read/tombstone.ts). */
async function gone(c: C, f: Format, path: string): Promise<Response | null> {
  const t = await readTombstone(c.env.DB, path)
  if (!t) return null
  const text = t.self ? `this ${t.kind} was taken down by the operator.` : `this ${t.kind} is under a shwarm or branch the operator took down.`
  return sendError(c, { status: 410, heading: 'taken down', text: t.reason ? `${text} reason: ${t.reason}` : text, extra: { reason: t.reason } }, f)
}

/**
 * A weak validator over what a signed-out view shows: the node's last write, its stats' last rollup, the last
 * moderation act anywhere, the form. A takedown (a hidden post or branch, a held node, a node that something here
 * builds on or is built on by) can change this page without writing to this node, so every moderation act moves
 * one site-wide version (core/context.ts moderatedStatement) and with it every signed-out ETag. Moderation is rare,
 * so the extra misses cost little. `day` is the UTC date on a page with the activity strip (its window moves at midnight).
 * A post in a branch moves the branch's version, not the parent's; the parent's strip counts it once the stats job
 * rolls the parent up (every 5 minutes, with the changed node's ancestors), which moves its stats' time.
 * `checkout`: the Worker has a Stripe key, so the page's donate modal posts (go-live 10.1). The key goes in or out with
 * `wrangler secret put`, no code deploy and no RENDER_VERSION bump, so the flag joins the ETag: a page cached before
 * would keep a donate button that never posts.
 * `beta`: the text and JSON say only invited testers act (7.14). The mode changes with a deploy that needn't bump
 * RENDER_VERSION, so it joins the ETag too.
 */
export function etagOf(chain: Chain, f: Format, view = '', tree?: string, day?: string, checkout = false, beta = false): string {
  const n = chain.node
  return `W/"${RENDER_VERSION}.${n.last_event_id ?? n.changed_at ?? n.created_at}.${n.stats?.updated_at ?? '-'}.${chain.moderated?.replace(/[^\w-]/g, '') || '-'}.${f}${view ? '.' + view : ''}${tree ? '.' + tree.replace(/[^\w.:-]/g, '') : ''}${day ? '.' + day : ''}${checkout ? '.c' : ''}${beta ? '.b' : ''}"`
}

/**
 * Whether this node's page is its result page (go-live 5.7): a closed shwarm, unless its thread was asked for
 * (?thread=1). A passed branch keeps the live template (OPEN #81). The page falls back to the live template when the
 * passing submission can't be shown (read/result.ts readResult).
 */
export const showsResult = (n: Chain['node'], thread: boolean) => n.state === 'closed' && n.kind !== 'branch' && !thread

/** If-None-Match against our ETag: weak comparison, any entry, or *. */
export function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false
  const bare = (t: string) => t.trim().replace(/^W\//, '')
  return header.split(',').some(t => t.trim() === '*' || bare(t) === bare(etag))
}

export const nodeRoutes = new Hono<Env>()

nodeRoutes.get('/*', async c => {
  const url = new URL(c.req.url)
  const format = pickFormat(c.req.query('format'), c.req.header('accept'))
  const f: Format = format ?? 'text'
  common(c, null)
  if (!readingOpen(c.env)) return notFound(c, f)

  const capped = overReadCap(c, f)
  if (capped) return capped
  if (!format) return errorOut(c, f, 400, 'bad_request', 'format is text, json or html')

  const rest = url.pathname.slice('/w/'.length)
  if (rest.length > 1 && rest.endsWith('/') && !rest.endsWith('//')) {
    const to = new URL(url)
    to.pathname = url.pathname.replace(/\/+$/, '')
    return c.redirect(to.pathname + to.search, 301)
  }
  const parsed = parseNodePath(rest)
  // /s/<n> is a submission's page (5.2); /log the audit log (5.7). /branches is only the agent API's createBranch, signed (7.4).
  const subNumber = parsed.kind === 'view' ? submissionNumber(parsed.view) : null
  const isLog = parsed.kind === 'view' && parsed.view === 'log'
  // GET <node>/branches: the address only opens a branch (a signed POST). Say so, and where the branches are listed.
  if (parsed.kind === 'view' && parsed.view === 'branches') {
    c.header('Allow', 'POST')
    const node = `${url.origin}/w/${parsed.path}`
    return sendError(c, { status: 405, text: `to open a branch, POST to this address, signed with your human's agent key. the branches are listed at ${node}` }, f)
  }
  if (parsed.kind === 'bad' || (parsed.kind === 'view' && subNumber === null && !isLog)) return notFound(c, f, parsed.kind === 'view' ? 'nothing is here yet.' : undefined)
  if (isLog) return logView(c, parsed.path)

  // Signed out: publicly cacheable for 15 seconds, with a validator. Signed in: never stored (the strip, own held nodes).
  const view = subNumber === null ? '' : `s${subNumber}`
  const thread = c.req.query('thread') !== undefined
  const now = Date.now()
  // The activity strip's window moves with the UTC day (read/activity.ts): the node page's validator carries the day.
  const day = f === 'html' && subNumber === null ? utcDay(now) : undefined
  // Only an HTML page has the donate modal.
  const checkout = f === 'html' && checkoutOn(c)
  // Only the text and JSON carry the beta line (render/prompt.ts BETA_LINE).
  const beta = f !== 'html' && actsLimited(c.env)
  const memoKey = `${parsed.path}|${f}|${view}${thread ? '|thread' : ''}${day ? '|' + day : ''}${checkout ? '|c' : ''}${beta ? '|b' : ''}`
  const ifNoneMatch = c.req.header('if-none-match')
  const validator = (etag: string) => (c.header('ETag', etag), c.header('Cache-Control', 'public, s-maxage=15'))

  // A repeat read with no session cookie, of a version this isolate read from D1 moments ago: 304 without D1.
  const known = ifNoneMatch && !hasSessionCookie(c) ? knownVersion(memoKey) : null
  if (known && matches(ifNoneMatch, known)) {
    common(c, parsed.path)
    validator(known)
    return c.body(null, 304)
  }

  const session = await sessionOf(c)
  const db = c.env.DB
  const chain = await readChain(db, parsed.path, session?.personId ?? null)
  if (!chain) return (await gone(c, f, parsed.path)) ?? notFound(c, f)
  common(c, parsed.path)

  // A result page also shows its branches' events, its credits and what's built on it: their version joins the ETag.
  const result = subNumber === null && f === 'html' && showsResult(chain.node, thread)
  if (session) c.header('Cache-Control', 'private, no-store')
  else {
    const etag = etagOf(chain, f, view, result ? await readTreeVersion(db, chain) : undefined, day, checkout, beta)
    noteVersion(memoKey, etag)
    validator(etag)
    if (matches(ifNoneMatch, etag)) return c.body(null, 304)
  }

  if (subNumber !== null) return submissionView(c, chain, subNumber, session, f, now, undefined, 200, beta)
  if (result) {
    const me = session ? { personId: session.personId, handle: session.handle, verified: session.verified } : null
    const d = await loadResultData(db, chain, { me, now })
    if (d) return page(c, <ResultPage d={d} />)
  }
  if (f === 'html') return htmlPage(c, chain, parsed.path, session, now)

  const v = await loadAgentView(db, chain, { origin: url.origin, before: c.req.query('before') ?? null, now })
  if (!v) return errorOut(c, f, 400, 'bad_request', 'before is not a post in this thread')
  v.beta = beta
  if (f === 'json') return c.json(renderNodeJson(v))
  return c.body(renderPrompt(v), 200, { 'Content-Type': 'text/plain; charset=utf-8' })
})

const BAD_BEFORE = 'before is not an event in this log'

/**
 * GET /w/<path>/log (go-live 5.7; protocol §4): one page of the audit log as NodeLog JSON, newest first, with ?filter=
 * key|all (milestones, key's old name, too) and ?before=<event id>. Visibility, tombstones, the read cap, the ETag and 304 work as on the node.
 * OPEN (#81): no text or page form of the log is decided, so every Accept and ?format= gets the JSON.
 */
async function logView(c: C, path: string) {
  const filter = logFilter(c.req.query('filter'))
  if (!filter) return errorOut(c, 'json', 400, 'bad_request', BAD_FILTER)
  const before = c.req.query('before') ?? null
  // Checked before it goes into the memo key and the ETag: a header can't carry a newline or a non-Latin-1 character.
  if (before !== null && !isId('e', before)) return errorOut(c, 'json', 400, 'bad_request', BAD_BEFORE)
  const view = `log.${filter}.${before ?? ''}`
  const memoKey = `${path}|json|${view}`
  const ifNoneMatch = c.req.header('if-none-match')
  const validator = (etag: string) => (c.header('ETag', etag), c.header('Cache-Control', 'public, s-maxage=15'))
  const known = ifNoneMatch && !hasSessionCookie(c) ? knownVersion(memoKey) : null
  if (known && matches(ifNoneMatch, known)) {
    common(c, null)
    validator(known)
    return c.body(null, 304)
  }
  const session = await sessionOf(c)
  const db = c.env.DB
  const chain = await readChain(db, path, session?.personId ?? null)
  if (!chain) return (await gone(c, 'json', path)) ?? notFound(c, 'json')
  if (session) c.header('Cache-Control', 'private, no-store')
  else {
    const etag = etagOf(chain, 'json', view, await readTreeVersion(db, chain))
    noteVersion(memoKey, etag)
    validator(etag)
    if (matches(ifNoneMatch, etag)) return c.body(null, 304)
  }
  const page = await readLog(db, chain, { filter, before })
  if (!page) return errorOut(c, 'json', 400, 'bad_request', BAD_BEFORE)
  return c.json(renderLogJson(path, filter, page, new URL(c.req.url).origin))
}

/** "s/12" → 12; anything else (s, s/0, s/012, s/1/x) → null. */
export function submissionNumber(view: string): number | null {
  const m = /^s\/([1-9]\d{0,8})$/.exec(view)
  return m ? Number(m[1]) : null
}

/**
 * /w/<path>/s/<n>: the page, or the submission for agents. A number with no submission, or a hidden one, is a 404.
 * Also the page for a refused check or sign-off, with the refusal at its form and the draft kept.
 */
async function submissionView(c: C, chain: Chain, number: number, session: Session | null, f: Format, now: number, flash?: SubFlash, status: 200 | 400 | 429 = 200, beta = false) {
  const db = c.env.DB
  const n = chain.node
  const sub = await readSubmission(db, n.id, number)
  if (!sub) return notFound(c, f, `there is no submission #${number} here.`)
  const [checks, links, history, subs] = await Promise.all([
    readChecks(db, [sub.post_id], { includeReset: true, withLog: true }),
    readBuiltOn(db, [sub.post_id]),
    f === 'html' ? readSubmissionHistory(db, n.id, sub.post_id) : Promise.resolve([]),
    f === 'html' ? readSubmissions(db, n.id) : Promise.resolve([]),
  ])
  const v = { chain, sub, checks: checks.get(sub.post_id) ?? [], builtOn: links.builtOn.get(sub.post_id) ?? [], now, beta }
  if (f === 'json') return c.json(renderSubmissionJson({ ...v, origin: new URL(c.req.url).origin }))
  if (f === 'text') return c.body(renderSubmissionPrompt({ ...v, origin: new URL(c.req.url).origin }), 200, { 'Content-Type': 'text/plain; charset=utf-8' })
  const me = session ? { personId: session.personId, handle: session.handle, verified: session.verified } : null
  const forms = session
    ? { token: await formToken(c.env.CSRF_SECRET, session.id), steppedUp: stepUpOpen(session, now), operator: await isOperatorFor(db, n, session.personId) }
    : {}
  return page(c, <SubmissionPage d={{ ...v, subs, history, me, ...forms, flash }} />, status)
}

/** Author gone (table B): the viewer signs off in the author's place when the author isn't active and the viewer is an admin. */
async function isOperatorFor(db: D1Database, n: Chain['node'], personId: number): Promise<boolean> {
  if (n.author_status === 'active' || personId === n.author_id) return false
  const p = await db.prepare('SELECT is_admin FROM person WHERE id = ?').bind(personId).first<{ is_admin: number }>()
  return p?.is_admin === 1
}

/** The inline step-up (A5, auth/signin.ts inlineStepUp) for acts with the author's authority: the sign-off, a dead end (an edit asks on /new, web/create.tsx). */
async function steppedUp(c: C, session: Session, password: string | undefined, now: number): Promise<{ actor: Actor } | { refuse: string; status: 400 | 429; wait?: number }> {
  const s = await inlineStepUp(c.env.DB, c.env.PASSWORD_PEPPER, session, password, clientIp(c), now)
  if ('refuse' in s) return s
  return { actor: siteActor({ id: session.personId, handle: session.handle }, { steppedUp: true }) }
}

/** The page itself, for a GET or for a refused form (with the refusal shown where it happened and the draft kept). */
async function htmlPage(c: C, chain: Chain, path: string, session: Session | null, now: number, flash?: Flash, status: 200 | 400 | 429 = 200) {
  const sort = (SORTS as string[]).includes(c.req.query('sort') ?? '') ? (c.req.query('sort') as Sort) : 'active'
  const show = (SHOWS as string[]).includes(c.req.query('show') ?? '') ? (c.req.query('show') as Show) : 'all'
  const pg = Math.min(1000, Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1))
  const url = new URL(c.req.url)
  const d = await loadPageData(c.env.DB, chain, {
    sort,
    show,
    page: pg,
    url: `${url.origin}/w/${path}`,
    here: `/w/${path}${url.search}`,
    me: session ? { personId: session.personId, handle: session.handle, verified: session.verified } : null,
    now,
  })
  if (session) {
    d.token = await formToken(c.env.CSRF_SECRET, session.id)
    if (session.verified) d.limit = await peekThreadTokens(c.env.DB, { personId: session.personId, nodeId: chain.node.id }, now)
  }
  d.flash = flash
  d.steppedUp = stepUpOpen(session, now)
  // A closed shwarm's thread sits behind its result page (5.7); a refused form there comes back here, on the thread.
  d.threadView = chain.node.state === 'closed' && chain.node.kind !== 'branch' && (flash !== undefined || c.req.query('thread') !== undefined)
  return page(c, <NodePage d={d} />, status)
}

/**
 * POST /w/<path>/s/<n>: a people check and the author's sign-off, each run in the
 * tree as one check command. The sign-off asks for the password inline when the step-up window is closed. A refusal
 * re-renders the submission page with the reason at the form and the draft kept; a double click goes to the first.
 */
async function submissionPost(c: C, path: string, number: number, session: Session, f: Record<string, string>) {
  const db = c.env.DB
  const chain = await readChain(db, path, session.personId)
  if (!chain) return (await gone(c, 'html', path)) ?? notFound(c, 'html')
  const n = chain.node
  const sub = await readSubmission(db, n.id, number)
  if (!sub) return notFound(c, 'html', `there is no submission #${number} here.`)
  const act = f.do === 'check' || f.do === 'signoff' ? f.do : null
  if (!act) return errorOut(c, 'html', 400, 'bad_request', 'that form asked for nothing we know.')
  const back = `/w/${path}/s/${number}`
  const now = Date.now()
  const flash = (text: string): SubFlash => ({ at: act, text, fields: { verdict: f.verdict ?? '', text: f.text ?? '', links: f.links ?? '' } })
  const refuse = (text: string, status: 400 | 429 = 400) => submissionView(c, chain, number, session, 'html', now, flash(text), status)
  const verdict = f.verdict === 'pass' || f.verdict === 'fail' ? (f.verdict as 'pass' | 'fail') : null
  if (!verdict) return refuse('pick pass or fail.')
  // A double click repeats the same act: a sign-off matches only a sign-off, a check only a check, so a sign-off sent
  // right after the person's own people check reaches core and is refused there (slot_taken), not taken for a repeat.
  const dup = await db
    .prepare(
      `SELECT id FROM check_report WHERE submission_id = ? AND person_id = ? AND reset_at IS NULL AND created_at > ?
       AND (slot = 'author') = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(sub.post_id, session.personId, new Date(now - DOUBLE_POST_MS).toISOString(), act === 'signoff' ? 1 : 0)
    .first<{ id: string }>()
  if (dup) return c.redirect(`${back}#${dup.id}`, 303)
  const text = (f.text ?? '').trim()
  const base = { node: path, on: sub.post_id, verdict }
  let actor: Actor = siteActor({ id: session.personId, handle: session.handle })
  let input: CheckInput
  if (act === 'signoff') {
    // Only someone who may sign off is asked for the password; anyone else is refused by core (only the author signs off).
    if (session.personId === n.author_id || (await isOperatorFor(db, n, session.personId))) {
      const s = await steppedUp(c, session, f.password, now)
      if ('refuse' in s) {
        if (s.wait) c.header('Retry-After', String(s.wait))
        return refuse(s.refuse, s.status)
      }
      actor = s.actor
    }
    // A pass says what was checked; a fail is a repro, and resets every check (core/checking.ts).
    input = { ...base, slot: 'author', ...(verdict === 'pass' ? { text } : { repro: text }) }
  } else {
    // A people check: a pass backed by links, or a fail whose text is its repro, with any links beside it.
    const links = linksFromForm(f.links ?? '')
    input = verdict === 'pass' ? { ...base, text, evidence: links } : { ...base, text, repro: { steps: text, links } }
  }
  try {
    const r = await runInTree<CheckResult>(c.env.TREE, { type: 'check', actor, input })
    return c.redirect(act === 'signoff' ? `${back}#checks` : `${back}#${r.id}`, 303)
  } catch (e) {
    if (!(e instanceof ShwarmError)) throw e
    return refuse(e.message.replace(/\.?$/, '.'))
  }
}

// POST /w/<path> (go-live 4.4–4.8, 5.1, 5.6): the page's forms, picked by the `do` field. post: a thread post or reply
// as the bare handle, pinned as "status update" when the author ticks it. edit, delete: one of your own plain posts.
// upvote: the ▲ on a post, either way. submit: the compose box's submit mode, which lands on the new submission's page.
// join, leave: say you're working on a live shwarm, or stop. dead_end (with a note): the author's own box, behind the
// password. Editing a shwarm is the /new form's (web/create.tsx, /new?edit=<path>; re-pitch is retired, decided Oct 10).
// Nothing reopens (decided Oct 9). Each runs in the shwarm's tree (do/shwarm-tree.ts), then goes back to the page (303). A refusal re-renders the page with the reason next to the form and the draft kept.
// Signed out, it goes to sign-in and back.
// POST /w/<path>/s/<n> (5.3, 5.5): check (a people check) and signoff (the author's, behind the password).
const ACTS = ['post', 'edit', 'delete', 'upvote', 'submit', 'join', 'leave', 'dead_end'] as const
type Act = (typeof ACTS)[number]

/** Same person, same thread, same text within this long: a double click, so the first post stands. */
const DOUBLE_POST_MS = 30_000

/**
 * The id of the same post, by the same person as the same name in the same thread, answering the same post (or none),
 * sent within DOUBLE_POST_MS: a double click, so the first post stands (the compose box here, the inbox's inline reply in
 * web/profile.tsx). The same words to a different post are a new reply. With `pin` ticked, only the pinned post itself
 * counts as the first click; an earlier unpinned copy is posted again, pinned, so the pin is never dropped.
 */
export async function justPosted(db: D1Database, o: { nodeId: number; personId: number; as: string; text: string; now: number; replyTo: string | null; pin?: boolean }): Promise<string | null> {
  const dup = await db
    .prepare(
      `SELECT p.id FROM post p WHERE p.node_id = ?1 AND p.person_id = ?2 AND p.as_name = ?3 AND p.text = ?4 AND p.created_at > ?5 AND p.reply_to IS ?7
       AND (?6 = 0 OR p.id = (SELECT pinned_post_id FROM node WHERE id = ?1)) ORDER BY p.created_at DESC LIMIT 1`,
    )
    .bind(o.nodeId, o.personId, o.as, o.text, new Date(o.now - DOUBLE_POST_MS).toISOString(), o.pin ? 1 : 0, o.replyTo)
    .first<{ id: string }>()
  return dup?.id ?? null
}

/** Where a node's thread is: on a closed shwarm it's behind the result page (5.7), so a new post lands there. */
export const threadHref = (path: string, n: { state: string; kind: string }) => (n.state === 'closed' && n.kind !== 'branch' ? `/w/${path}?thread=1` : `/w/${path}`)

nodeRoutes.post('/*', async c => {
  const url = new URL(c.req.url)
  const parsed = parseNodePath(url.pathname.slice('/w/'.length).replace(/\/+$/, ''))
  const subNumber = parsed.kind === 'view' ? submissionNumber(parsed.view) : null
  if (!readingOpen(c.env) || parsed.kind === 'bad' || (parsed.kind === 'view' && subNumber === null)) return notFound(c, 'html')
  const back = subNumber === null ? `/w/${parsed.path}` : `/w/${parsed.path}/s/${subNumber}`
  const w = await who(c as unknown as AuthContext)
  if (!w.session) return c.redirect(signInHref(back), 303)
  const f = await formOf(c)
  if (!(await postedTokenOk(c as unknown as AuthContext, w, f))) return sendError(c, { status: 403, heading: 'this form expired', text: 'go back, reload the page and try again.' }, 'html')
  if (subNumber !== null) return submissionPost(c, parsed.path, subNumber, w.session, f)
  // Re-pitch is retired (decided Oct 10, '"edit" replaces re-pitch'): a re-pitch form from an old tab goes to the edit
  // form, which says whether this viewer may still edit it.
  if (f.do === 'repitch') return c.redirect(editHref(parsed.path), 303)
  if (f.do === 'report') return reportAct(c, parsed.path, w.session, f, url)
  if (f.do === 'flag') return flagAct(c, parsed.path, w.session, f, url)
  const act = (ACTS as readonly string[]).includes(f.do) ? (f.do as Act) : null
  if (!act) return errorOut(c, 'html', 400, 'bad_request', 'that form asked for nothing we know.')

  const db = c.env.DB
  const session = w.session
  const chain = await readChain(db, parsed.path, session.personId)
  if (!chain) return (await gone(c, 'html', parsed.path)) ?? notFound(c, 'html')
  const n = chain.node
  const actor = siteActor({ id: session.personId, handle: session.handle })
  const now = Date.now()
  // A refused submission reopens the submit form with every field as typed.
  const kept: Partial<Flash> = act === 'submit' ? { mode: 'submit' as const, fields: Object.fromEntries(SUBMIT_FIELDS.map(k => [k, f[k] ?? ''])) } : {}
  try {
    if (act === 'dead_end') {
      const refuse = (text: string, status: 400 | 429 = 400) => htmlPage(c, chain, parsed.path, session, now, { at: 'owner', text, draft: f.note }, status)
      // A second click lands after the first did it: back to the page, as the first click went.
      if (n.state === 'dead_end') return c.redirect(back, 303)
      const note = (f.note ?? '').trim()
      // OPEN (#76): the words for a missing note wait on Myra's yes. Said before the password is checked, so it isn't spent.
      if (!note) return refuse('say why it stops here, so nobody repeats it.')
      // Only the author is asked for the password; anyone else is refused by core (only the author marks a dead end).
      const s = n.author_id === session.personId ? await steppedUp(c, session, f.password, now) : { actor }
      if ('refuse' in s) {
        if (s.wait) c.header('Retry-After', String(s.wait))
        return refuse(s.refuse, s.status)
      }
      await runInTree(c.env.TREE, { type: 'deadEnd', actor: s.actor, input: { node: parsed.path, note } })
      return c.redirect(back, 303)
    }
    if (act === 'post') {
      const text = (f.text ?? '').trim()
      const pin = f.pin === '1'
      if (!text) return htmlPage(c, chain, parsed.path, session, now, { at: 'compose', text: 'write something first.', pin }, 400)
      const replyTo = f.reply_to || null
      const dup = await justPosted(db, { nodeId: n.id, personId: session.personId, as: actor.as, text, now, replyTo, pin })
      const to = threadHref(parsed.path, n)
      if (dup) return c.redirect(`${to}#${dup}`, 303)
      const r = await runInTree<{ id: string }>(c.env.TREE, { type: 'post', actor, input: { node: parsed.path, text, replyTo, ...(pin ? { pin } : {}) } })
      return c.redirect(`${to}#${r.id}`, 303)
    }
    // Upvotes, edits and deletes go back to the post, on the page (sort, filter, page) the form was on.
    const at = `${back}${url.search}${isId('p', f.post) ? `#${f.post}` : ''}`
    if (act === 'upvote') {
      await runInTree(c.env.TREE, { type: 'upvote', actor, input: { node: parsed.path, post: f.post ?? '', up: f.up !== '0' } })
      return c.redirect(at, 303)
    }
    if (act === 'edit') {
      const text = (f.text ?? '').trim()
      if (!text) return htmlPage(c, chain, parsed.path, session, now, { at: 'post', post: f.post, text: 'write something first.', draft: '' }, 400)
      // The same text twice (a double click) changes nothing in core.
      await runInTree(c.env.TREE, { type: 'editPost', actor, input: { node: parsed.path, post: f.post ?? '', text } })
      return c.redirect(at, 303)
    }
    if (act === 'delete') {
      // Deleting it twice (a double click) changes nothing in core; the second lands on the tombstone too.
      await runInTree(c.env.TREE, { type: 'deletePost', actor, input: { node: parsed.path, post: f.post ?? '' } })
      return c.redirect(at, 303)
    }
    if (act === 'submit') {
      const refuse = (text: string) => htmlPage(c, chain, parsed.path, session, now, { at: 'compose', text, draft: f.text, ...kept }, 400)
      const text = (f.text ?? '').trim()
      if (!text) return refuse('say what you did in the text box first.')
      // Only a post is pinned (core post), so a ticked pin box isn't dropped quietly.
      // OPEN (#78): the words wait on Myra's yes.
      if (f.pin === '1') return refuse("a submission can't be pinned. submit it without the pin, or post it to pin it.")
      const builtOn = await builtOnFromForm(db, n.id, f.built_on ?? '')
      if (typeof builtOn === 'string') return refuse(builtOn)
      const dup = await db
        .prepare(
          `SELECT s.number FROM submission s JOIN post p ON p.id = s.post_id
           WHERE s.node_id = ? AND p.person_id = ? AND p.as_name = ? AND p.text = ? AND p.created_at > ? ORDER BY p.created_at DESC LIMIT 1`,
        )
        .bind(n.id, session.personId, actor.as, text, new Date(now - DOUBLE_POST_MS).toISOString())
        .first<{ number: number }>()
      if (dup) return c.redirect(`${back}/s/${dup.number}`, 303)
      const release = { name: f.release_name ?? '', version: f.release_version ?? '', howToUse: f.release_how_to_use ?? '' }
      const input: SubmitInput = {
        node: parsed.path,
        text,
        links: linksFromForm(f.links ?? ''),
        howToCheck: f.how_to_check ?? '',
        builtOn,
        ...(release.name.trim() || release.version.trim() || release.howToUse.trim() ? { release } : {}),
      }
      const r = await runInTree<SubmitResult>(c.env.TREE, { type: 'submit', actor, input })
      return c.redirect(`${back}/s/${r.number}`, 303)
    }
    await runInTree(c.env.TREE, { type: act, actor, input: { node: parsed.path } })
    return c.redirect(back, 303)
  } catch (e) {
    if (!(e instanceof ShwarmError)) throw e
    const at =
      act === 'post' || act === 'submit' ? 'compose' : act === 'dead_end' ? 'owner' : act === 'edit' || act === 'delete' || act === 'upvote' ? 'post' : 'seats'
    const draft = act === 'post' || act === 'submit' || act === 'edit' ? f.text ?? '' : act === 'dead_end' ? f.note : undefined
    // A refused upvote, edit or delete shows under its post; a refused pinned post keeps its box ticked.
    if (act === 'edit' || act === 'delete' || act === 'upvote') Object.assign(kept, { post: f.post })
    if (act === 'post' && f.pin === '1') Object.assign(kept, { pin: true })
    if (e.code === 'rate_limited') {
      const wait = Number(e.details.retry_after) || 60
      c.header('Retry-After', String(wait))
      // OPEN: the submissions wording isn't in a mockup; it waits on Myra's yes.
      const text =
        e.details.limit === 'submissions'
          ? `one submission per person per day here. next in ${waitText(wait)}.`
          : `slow down: you can post here again in ${waitText(wait)}.`
      return htmlPage(c, chain, parsed.path, session, now, { at, text, draft, ...kept }, 429)
    }
    return htmlPage(c, chain, parsed.path, session, now, { at, text: e.message.replace(/\.?$/, '.'), draft, ...kept }, 400)
  }
})

/**
 * "report" on a thread post (go-live 9.3, core/reports.ts): into the operator's queue with a mail to the admins, then
 * back to the post, whose control now says "reported". A second report of the same post says so under it. A refusal
 * reopens the form with the reason and the words kept. On any node, live or ended: reporting isn't locked.
 */
async function reportAct(c: C, path: string, session: Session, f: Record<string, string>, url: URL) {
  const db = c.env.DB
  const chain = await readChain(db, path, session.personId)
  if (!chain) return (await gone(c, 'html', path)) ?? notFound(c, 'html')
  const now = Date.now()
  const post = f.post ?? ''
  const refuse = (text: string, o: { status?: 200 | 400 | 429; keep?: boolean } = {}) =>
    htmlPage(c, chain, path, session, now, { at: 'post', post, text, ...(o.keep === false ? {} : { report: true, draft: f.text ?? '', fields: { reason: f.reason ?? '' } }) }, o.status ?? 400)
  try {
    const by = { personId: session.personId, handle: session.handle, verified: session.verified }
    // Every try counts (30 an hour), so a run of reports can't flood the admins' mail.
    const wait = by.verified ? await bump(db, `report:person:${session.personId}`, LIMITS.reportPerson, now) : 0
    if (wait) {
      c.header('Retry-After', String(wait))
      // OPEN (#105): new wording.
      return refuse(`slow down: you can report again in ${waitText(wait)}.`, { status: 429 })
    }
    const r = await reportPost(db, { by, nodeId: chain.node.id, path, post, reason: f.reason, text: f.text, env: c.env.ENV, now })
    // OPEN (#105): new wording.
    if (r === 'already') return refuse('you already reported this post.', { status: 200, keep: false })
    return c.redirect(`/w/${path}${url.search}${isId('p', post) ? `#${post}` : ''}`, 303)
  } catch (e) {
    if (!(e instanceof ShwarmError)) throw e
    // A post that isn't there, was deleted or is the viewer's own has no form to reopen.
    const keep = e.details.field === 'reason' || e.details.field === 'text'
    return refuse(e.message, { keep })
  }
}

/**
 * "flag this shwarm" / "flag this branch" (go-live 9.3, core/flags.ts): a flag and a mail to the admins, then back to the
 * page, whose control now says "you flagged this" (and, at the third flag from established accounts, "paused for
 * review"). A second flag by the same person says "you already flagged this." where the control is. A refusal reopens
 * the form with the reason. On any node, live, ended or paused: flagging isn't locked, and the beta doesn't limit it.
 */
async function flagAct(c: C, path: string, session: Session, f: Record<string, string>, url: URL) {
  const db = c.env.DB
  const chain = await readChain(db, path, session.personId)
  if (!chain) return (await gone(c, 'html', path)) ?? notFound(c, 'html')
  const now = Date.now()
  const refuse = (text: string, status: 200 | 400 | 429 = 400) => htmlPage(c, chain, path, session, now, { at: 'flag', text, fields: { reason: f.reason ?? '' } }, status)
  try {
    // Every try counts (10 an hour), so a run of flags across nodes can't flood the admins' mail.
    const wait = session.verified ? await bump(db, `flag:person:${session.personId}`, LIMITS.flagPerson, now) : 0
    if (wait) {
      c.header('Retry-After', String(wait))
      // OPEN (#106): new wording.
      return refuse(`slow down: you can flag again in ${waitText(wait)}.`, 429)
    }
    const r = await flagNode(db, { by: { personId: session.personId }, nodeId: chain.node.id, path, reason: f.reason, env: c.env.ENV, now })
    // OPEN (#106): new wording.
    if (r === 'already') return refuse('you already flagged this.', 200)
    return c.redirect(`/w/${path}${url.search}`, 303)
  } catch (e) {
    if (!(e instanceof ShwarmError)) throw e
    return refuse(e.message)
  }
}

/** The submit form's fields besides the text, kept as typed when a submission is refused. */
const SUBMIT_FIELDS = ['links', 'built_on', 'how_to_check', 'release_name', 'release_version', 'release_how_to_use'] as const

const formLines = (s: string) => s.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

/**
 * Linked work as typed in the submit form, one per line: "url sha256" for a file, "repo commit [path]" for a repo at a
 * commit (a 40-character commit id, or any line with a path after it). Shapes only: core checks every link, so an
 * unpinned or badly pinned one is refused there with its reason.
 */
export function linksFromForm(s: string): Record<string, string>[] {
  return formLines(s).map((line): Record<string, string> => {
    const [first, second, ...rest] = line.split(/\s+/)
    if (second === undefined) return { url: first } // no fingerprint: core refuses it
    const pin = /^[0-9a-f]+$/i.test(second) ? second.toLowerCase() : second
    if (rest.length || /^[0-9a-f]{40}$/.test(pin)) return { repo: first, commit: pin, ...(rest.length ? { path: rest.join(' ') } : {}) }
    return { url: first, sha256: pin }
  })
}

/**
 * "Built on" as typed, one per line: a post id (p_…, or a link that ends in one) or a submission on this node (#2),
 * then why it was used. Returns the list for core, or the refusal to show.
 */
export async function builtOnFromForm(db: D1Database, nodeId: number, s: string): Promise<{ post: string; note?: string }[] | string> {
  const out: { post: string; note?: string }[] = []
  const lines = formLines(s)
  for (let i = 0; i < lines.length; i++) {
    const [ref, ...why] = lines[i].split(/\s+/)
    const note = why.join(' ').replace(/^[-–—:·]\s*/, '') || undefined
    const num = /^#(\d{1,9})$/.exec(ref)
    if (num) {
      const row = await db.prepare('SELECT post_id FROM submission WHERE node_id = ? AND number = ?').bind(nodeId, Number(num[1])).first<{ post_id: string }>()
      if (!row) return `built on: there is no #${num[1]} here.`
      out.push({ post: row.post_id, ...(note ? { note } : {}) })
      continue
    }
    const id = /(?:^|[^a-z0-9_])(p_[a-z0-9]{8,32})$/.exec(ref)?.[1]
    if (!id) return `built on, line ${i + 1}: start with a post id (p_…) or a submission number (#1).`
    out.push({ post: id, ...(note ? { note } : {}) })
  }
  return out
}
