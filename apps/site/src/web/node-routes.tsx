// GET /w/<path> (go-live 3.3, 3.4, 3.6) and /w/<path>/s/<n> (5.2, an old submission's page): one URL, three forms. Browsers get the page, agents the text prompt
// (the default, protocol §4) or the Node JSON, picked by ?format=text|json|html or else the Accept header. A node that
// passed shows its pass box on its own page (decided Oct 14: the result page retired; its ?thread=1 address is the page
// itself). GET /w/<path>/log (5.7) is the audit log, as JSON.
// GET /w/<path>/people (decided Oct 14) is everyone on the node: a page, or JSON for the page's modal and for agents.
// Signed-out responses carry a weak ETag (the node's version plus its stats' time) and answer If-None-Match with
// 304, and may be cached for 15 seconds; signed-in responses are never stored. Reads are capped per network. A repeat
// signed-out read whose ETag this isolate saw in D1 within those 15 seconds gets its 304 with no D1 read (version-memo.ts).
// The page's activity strip covers the last 14 UTC days, which move at midnight with no write, so a page's ETag and
// memo key also carry the UTC day: the first read after midnight is a miss, and a cached page is a day old 15 seconds at most.
import { currentLang, fill, w, WORDS_VERSION } from '../words'
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
import { peekThreadTokens } from '../core/limits'
import type { MarkResult } from '../core/records'
import { NO_CHECKS, NO_DEAD_END, NO_SUBMISSIONS } from '../core/status'
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
import type { JoinResult } from '../core/nodes'
import { loadAgentView, loadPageData } from '../read/views'
import { BAD_FILTER, isLogId, logFilter, readLog, readTreeVersion, renderLogJson } from '../read/log'
import { PASS_BOX } from '../read/status'
import { readTombstone } from '../read/tombstone'
import { readPeople, renderPeopleJson } from '../read/people'
import { PeoplePage } from './people-page'
import { sendError, waitText } from './errors'
import { pickFormat, type Format } from './format'
import { NodePage, type Flash } from './node-page'
import { NO_EDIT } from '../core/nodes'
import { SubmissionPage } from './submission-page'
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
export const RENDER_VERSION = '28' // 2: no lobby or variants (Oct 9). 3: key events, log box classes (Oct 9). 4: the log's `key` field (v0, Oct 9). 5: the activity strip (Oct 10). 6: edit until join, the safety guide link, how to join in (Oct 10). 7: links for agents under how to take part, count wording (Oct 10). 8: npx @shwarm/cli under how to take part (Oct 10). 9: direct messages and who takes them, under how to take part; take_part in the JSON; "report" on every post (Oct 10). 10: "flag this shwarm" in the head, the "paused for review" banner, paused in the text and JSON (Oct 10). 11: the manifesto link in the header strip (Oct 10). 12: the donate modal is a form posting to /donate (Oct 10). 13: the canonical link and link-preview meta tags (go-live 11.7, Oct 11). 14: shwarming safely, how to sign, what impact means and the beta line in the text and JSON (go-live 7.11, 7.14, Oct 11). 15: the 7.14 review: the beta line before the keys page, a run's pass rule and where it runs, a license off the list, the note in the JSON, "shwarms or branches" (Oct 11). 16: joins (go-live 8.2): CONTRIBUTORS with each person's joined agents, the join line under how to take part, join posts marked, contributors and take_part.join/leave in the JSON (Oct 12). 17: the join page (go-live 8.2): join in the head and on branches, the say-hi modal, "✿ joined" posts and quiet join lines, agents under their person in contributors (Oct 12). 18: one join per person (Myra, Oct 12): contributors are people only, with "joined by @you/agent" when an agent made the join; the join rule says an agent joins for its human (Oct 12). 19: the join rule names an agent's optional hello and that it leaves only a join it made (Myra, Oct 12); no "edit" on a shwarm's own words (Myra, Oct 12; signed-in only, so the signed-out fingerprint doesn't move). 20: "status" in the footer's links (go-live 11.3, Oct 12). 21: /js/words.js before site.js, the word list (go-live 11.8, Oct 13); from here a changed word moves the ETag by itself (WORDS_VERSION), no bump. 22: a branch's status votes (a badge with its bars on hover or tap, the vote box), quiet branches and the activity order, the pin permission and the status vote in how to take part, YOUR JOB and WHAT NEEDS DOING first in the text and JSON (Oct 13). 23: pages in the reader's language: lang and dir on <html>, the footer's language switch where more than English is served (Oct 13). 24: START HERE, WHERE THE WORK LIVES and WHO'S HERE in the text, start_here, work and agents_here in the JSON (#128, Oct 13). 25: YOUR JOB is one piece, not the whole goal; WHAT NEEDS DOING names who's on each branch, on_it in the JSON; the join hello says what you bring (Oct 13). 26: several pinned posts, pin and unpin on a post (Oct 14). 27: a branch's status by claims and a rubber band, claims in the thread, no "in review" on a branch, /people (Oct 14). 28: one model for every node: a shwarm's status, pass records and their box, pinned work, status history, nothing locks, no submissions or checks, the result page retired (Oct 14)

// Production's reading pages stay closed in holding mode and open in beta (go-live 3.10); core/site-mode.ts.
import { actsLimited, readingOpen } from '../core/site-mode'
export { readingOpen }

function common(c: C, path: string | null) {
  c.header('Vary', 'Accept, Cookie, User-Agent') // User-Agent: a link-preview fetcher gets the page (web/format.ts)
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
 * so the extra misses cost little. `day` is the UTC hour on a node's page, text and JSON: the activity strip's window moves
 * at midnight, and a branch turns quiet once QUIET_HOURS pass with no write (read/node.ts readChildren).
 * A post in a branch moves the branch's version, not the parent's; the parent's strip counts it once the stats job
 * rolls the parent up (every 5 minutes, with the changed node's ancestors), which moves its stats' time.
 * `checkout`: the Worker has a Stripe key, so the page's donate modal posts (go-live 10.1). The key goes in or out with
 * `wrangler secret put`, no code deploy and no RENDER_VERSION bump, so the flag joins the ETag: a page cached before
 * would keep a donate button that never posts.
 * `beta`: the text and JSON say only invited testers act (7.14). The mode changes with a deploy that needn't bump
 * RENDER_VERSION, so it joins the ETag too.
 * `lang`: the page's language (words/index.ts), so a reader who switches language never gets a 304 for the other one.
 */
export function etagOf(chain: Chain, f: Format, view = '', tree?: string, day?: string, checkout = false, beta = false, lang = 'en'): string {
  const n = chain.node
  return `W/"${RENDER_VERSION}.${WORDS_VERSION}.${n.last_event_id ?? n.changed_at ?? n.created_at}.${n.stats?.updated_at ?? '-'}.${chain.moderated?.replace(/[^\w-]/g, '') || '-'}.${f}${view ? '.' + view : ''}${tree ? '.' + tree.replace(/[^\w.:-]/g, '') : ''}${day ? '.' + day : ''}${checkout ? '.c' : ''}${beta ? '.b' : ''}${lang !== 'en' ? '.' + lang : ''}"`
}

/** If-None-Match against our ETag: weak comparison, any entry, or *. */
export function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false
  const bare = (t: string) => t.trim().replace(/^W\//, '')
  return header.split(',').some(t => t.trim() === '*' || bare(t) === bare(etag))
}

export const nodeRoutes = new Hono<Env>()

nodeRoutes.get('/*', async c => {
  const url = new URL(c.req.url)
  const format = pickFormat(c.req.query('format'), c.req.header('accept'), c.req.header('user-agent'))
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
  const isPeople = parsed.kind === 'view' && parsed.view === 'people'
  // GET <node>/branches: the address only opens a branch (a signed POST). Say so, and where the branches are listed.
  if (parsed.kind === 'view' && parsed.view === 'branches') {
    c.header('Allow', 'POST')
    const node = `${url.origin}/w/${parsed.path}`
    return sendError(c, { status: 405, text: `to open a branch, POST to this address, signed with your human's agent key. the branches are listed at ${node}` }, f)
  }
  if (parsed.kind === 'bad' || (parsed.kind === 'view' && subNumber === null && !isLog && !isPeople)) return notFound(c, f, parsed.kind === 'view' ? 'nothing is here yet.' : undefined)
  if (isLog) return logView(c, parsed.path)
  if (isPeople) return peopleView(c, parsed.path, f)

  // Signed out: publicly cacheable for 15 seconds, with a validator. Signed in: never stored (the strip, own held nodes).
  // The retired result page's ?thread=1 is the page itself: it changes nothing here.
  const view = subNumber === null ? '' : `s${subNumber}`
  const now = Date.now()
  // The activity strip's window moves with the UTC day (read/activity.ts), and a branch turns quiet with no write at all
  // once QUIET_HOURS pass (read/node.ts readChildren; the page, the text and the JSON say so): the node's validator
  // carries the UTC hour, so a cached copy is at most an hour behind.
  const day = subNumber === null ? new Date(now).toISOString().slice(0, 13) : undefined
  // Only an HTML page has the donate modal.
  const checkout = f === 'html' && checkoutOn(c)
  // Only the text and JSON carry the beta line (render/prompt.ts BETA_LINE).
  const beta = f !== 'html' && actsLimited(c.env)
  // A page is in the reader's language (words/index.ts); text and JSON are always English.
  const lang = f === 'html' ? currentLang() : 'en'
  const memoKey = `${parsed.path}|${f}|${view}${day ? '|' + day : ''}${checkout ? '|c' : ''}${beta ? '|b' : ''}${lang !== 'en' ? '|' + lang : ''}`
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

  if (session) c.header('Cache-Control', 'private, no-store')
  else {
    const etag = etagOf(chain, f, view, undefined, day, checkout, beta, lang)
    noteVersion(memoKey, etag)
    validator(etag)
    if (matches(ifNoneMatch, etag)) return c.body(null, 304)
  }

  if (subNumber !== null) return submissionView(c, chain, subNumber, session, f, now, beta)
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
  if (before !== null && !isLogId(before)) return errorOut(c, 'json', 400, 'bad_request', BAD_BEFORE)
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

/**
 * GET /w/<path>/people (decided Oct 14): everyone on the node, in the card's order (read/people.ts). A page for a
 * browser (where "+ n more" goes without scripts), JSON for everything else: the card's modal and agents. Visibility,
 * tombstones, the read cap, the ETag (with the UTC hour, as the node's: posts a day move with time) and 304 work as on
 * the node.
 */
async function peopleView(c: C, path: string, f: Format) {
  const html = f === 'html'
  const lang = html ? currentLang() : 'en'
  const checkout = html && checkoutOn(c) // only a page has the donate modal
  const now = Date.now()
  const day = new Date(now).toISOString().slice(0, 13)
  const form: Format = html ? 'html' : 'json'
  const memoKey = `${path}|${form}|people|${day}${checkout ? '|c' : ''}${lang !== 'en' ? '|' + lang : ''}`
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
  if (!chain) return (await gone(c, form, path)) ?? notFound(c, form)
  common(c, null)
  if (session) c.header('Cache-Control', 'private, no-store')
  else {
    const etag = etagOf(chain, form, 'people', undefined, day, checkout, false, lang)
    noteVersion(memoKey, etag)
    validator(etag)
    if (matches(ifNoneMatch, etag)) return c.body(null, 304)
  }
  const people = await readPeople(db, chain)
  if (html) return page(c, <PeoplePage chain={chain} people={people} now={now} />)
  return c.json(renderPeopleJson(chain, people, new URL(c.req.url).origin, now))
}

/** "s/12" → 12; anything else (s, s/0, s/012, s/1/x) → null. */
export function submissionNumber(view: string): number | null {
  const m = /^s\/([1-9]\d{0,8})$/.exec(view)
  return m ? Number(m[1]) : null
}

/**
 * /w/<path>/s/<n>: an old submission's page (history: nothing takes submissions or checks since Oct 14), or the
 * submission for agents. A number with no submission, or a hidden one, is a 404.
 */
async function submissionView(c: C, chain: Chain, number: number, session: Session | null, f: Format, now: number, beta = false) {
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
  return page(c, <SubmissionPage d={{ ...v, subs, history, me }} />)
}

/** The inline step-up (A5, auth/signin.ts inlineStepUp) for acts with the author's authority: marking a shwarm passed (an edit asks on /new, web/create.tsx). */
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
  return page(c, <NodePage d={d} />, status)
}

// POST /w/<path> (go-live 4.4–4.8): the page's forms, picked by the `do` field. post: a thread post or reply as the bare
// handle, pinned when the author ticks it. edit, delete: one of your own plain posts. pin (pin=0 unpins): the author's,
// on any top-level post or old submission (decided Oct 14, "A thread can pin several posts"). upvote: the ▲ on a post,
// either way. join (with the say-hi modal's optional hello), leave: say you're working on a shwarm or branch, or stop.
// On a node they joined (decided Oct 14, core/status.ts): status, the viewer's on-track vote (status=on_track, or empty
// to take it back); claim, a thread post that says the node is blocked, passed or a dead end (status) with its evidence
// (text) and, on a passed claim, its pinned work (links, one per line); back, the "back" on a claim (post, on=1|0).
// mark_passed: the shwarm's author marks it passed, citing a passed claim (post), behind the password (core/records.ts).
// Nobody edits a shwarm's or a branch's own words (decided Oct 12): once posted, they're fixed. Thread posts keep edit
// and delete. Nothing locks (decided Oct 14), and nothing takes submissions, checks or a dead end: an old form for one
// is refused with why. Each runs in the shwarm's tree (do/shwarm-tree.ts), then goes back to the page (303). A refusal
// re-renders the page with the reason next to the form and the draft kept. Signed out, it goes to sign-in and back.
// POST /w/<path>/s/<n>: an old submission page's check or sign-off form, refused with why.
const ACTS = ['post', 'edit', 'delete', 'pin', 'upvote', 'back', 'join', 'leave', 'status', 'claim', 'mark_passed'] as const
/** Old forms for what retired (decided Oct 14), each refused with why. */
const RETIRED: Record<string, string> = { submit: NO_SUBMISSIONS, dead_end: NO_DEAD_END }
type Act = (typeof ACTS)[number]

/** Same person, same thread, same text within this long: a double click, so the first post stands. */
const DOUBLE_POST_MS = 30_000

/**
 * The id of the same post, by the same person as the same name in the same thread, answering the same post (or none),
 * sent within DOUBLE_POST_MS: a double click, so the first post stands (the compose box here, the inbox's inline reply in
 * web/profile.tsx, a claim's form). The same words to a different post are a new reply, and as a claim a new claim. With `pin` ticked, only the pinned post itself
 * counts as the first click; an earlier unpinned copy is posted again, pinned, so the pin is never dropped.
 */
export async function justPosted(
  db: D1Database,
  o: { nodeId: number; personId: number; as: string; text: string; now: number; replyTo: string | null; pin?: boolean; claim?: string | null },
): Promise<string | null> {
  const dup = await db
    .prepare(
      `SELECT p.id FROM post p WHERE p.node_id = ?1 AND p.person_id = ?2 AND p.as_name = ?3 AND p.text = ?4 AND p.created_at > ?5 AND p.reply_to IS ?7
       AND (?6 = 0 OR p.pinned_at IS NOT NULL) AND p.claim IS ?8 ORDER BY p.created_at DESC LIMIT 1`,
    )
    .bind(o.nodeId, o.personId, o.as, o.text, new Date(o.now - DOUBLE_POST_MS).toISOString(), o.pin ? 1 : 0, o.replyTo, o.claim ?? null)
    .first<{ id: string }>()
  return dup?.id ?? null
}

nodeRoutes.post('/*', async c => {
  const url = new URL(c.req.url)
  const parsed = parseNodePath(url.pathname.slice('/w/'.length).replace(/\/+$/, ''))
  const subNumber = parsed.kind === 'view' ? submissionNumber(parsed.view) : null
  if (!readingOpen(c.env) || parsed.kind === 'bad' || (parsed.kind === 'view' && subNumber === null)) return notFound(c, 'html')
  const back = subNumber === null ? `/w/${parsed.path}` : `/w/${parsed.path}/s/${subNumber}`
  const signedIn = await who(c as unknown as AuthContext)
  if (!signedIn.session) return c.redirect(signInHref(back), 303)
  const f = await formOf(c)
  if (!(await postedTokenOk(c as unknown as AuthContext, signedIn, f))) return sendError(c, { status: 403, heading: w.auth.formExpired, text: w.auth.formExpiredRetry }, 'html')
  if (subNumber !== null) return errorOut(c, 'html', 400, 'bad_request', `${NO_CHECKS}.`)
  // Re-pitch is retired (decided Oct 10), and so is editing a shwarm (decided Oct 12: once posted, a shwarm's or a
  // branch's words are fixed): a re-pitch form from an old tab is refused with why. OPEN: the words wait on Myra's yes.
  if (f.do === 'repitch') return errorOut(c, 'html', 400, 'bad_request', NO_EDIT)
  if (Object.hasOwn(RETIRED, f.do ?? '')) return errorOut(c, 'html', 400, 'bad_request', `${RETIRED[f.do]}.`)
  if (f.do === 'report') return reportAct(c, parsed.path, signedIn.session, f, url)
  if (f.do === 'flag') return flagAct(c, parsed.path, signedIn.session, f, url)
  const act = (ACTS as readonly string[]).includes(f.do) ? (f.do as Act) : null
  if (!act) return errorOut(c, 'html', 400, 'bad_request', w.auth.unknownForm)

  const db = c.env.DB
  const session = signedIn.session
  const chain = await readChain(db, parsed.path, session.personId)
  if (!chain) return (await gone(c, 'html', parsed.path)) ?? notFound(c, 'html')
  const n = chain.node
  const actor = siteActor({ id: session.personId, handle: session.handle })
  const now = Date.now()
  // A refused claim reopens its form with its status and its pinned work as typed; a refused mark, its pick.
  const kept: Partial<Flash> =
    act === 'claim' ? { fields: { status: f.status ?? '', links: f.links ?? '' } } : act === 'mark_passed' ? { fields: { post: f.post ?? '' } } : {}
  try {
    if (act === 'mark_passed') {
      const refuse = (text: string, status: 400 | 429 = 400) => htmlPage(c, chain, parsed.path, session, now, { at: 'owner', text, ...kept }, status)
      // Only the author is asked for the password; anyone else, and a branch, is refused by core without asking for one.
      const s = n.author_id === session.personId && n.kind !== 'branch' ? await steppedUp(c, session, f.password, now) : { actor }
      if ('refuse' in s) {
        if (s.wait) c.header('Retry-After', String(s.wait))
        return refuse(s.refuse, s.status)
      }
      // The same claim twice (a double click) changes nothing in core.
      await runInTree<MarkResult>(c.env.TREE, { type: 'markPassed', actor: s.actor, input: { node: parsed.path, post: f.post ?? '' } })
      return c.redirect(`${back}#${PASS_BOX}`, 303)
    }
    if (act === 'post') {
      const text = (f.text ?? '').trim()
      const pin = f.pin === '1'
      if (!text) return htmlPage(c, chain, parsed.path, session, now, { at: 'compose', text: w.node.writeFirst, pin }, 400)
      const replyTo = f.reply_to || null
      const dup = await justPosted(db, { nodeId: n.id, personId: session.personId, as: actor.as, text, now, replyTo, pin })
      if (dup) return c.redirect(`${back}#${dup}`, 303)
      const r = await runInTree<{ id: string }>(c.env.TREE, { type: 'post', actor, input: { node: parsed.path, text, replyTo, ...(pin ? { pin } : {}) } })
      return c.redirect(`${back}#${r.id}`, 303)
    }
    // Upvotes, backs, edits, deletes and pins go back to the post, on the page (sort, filter, page) the form was on.
    const at = `${back}${url.search}${isId('p', f.post) ? `#${f.post}` : ''}`
    if (act === 'upvote') {
      await runInTree(c.env.TREE, { type: 'upvote', actor, input: { node: parsed.path, post: f.post ?? '', up: f.up !== '0' } })
      return c.redirect(at, 303)
    }
    if (act === 'back') {
      // Backing a claim it already backs (a double click) changes nothing in core. on=0 takes the backing off.
      await runInTree(c.env.TREE, { type: 'back', actor, input: { node: parsed.path, post: f.post ?? '', on: f.on !== '0' } })
      return c.redirect(at, 303)
    }
    if (act === 'edit') {
      const text = (f.text ?? '').trim()
      if (!text) return htmlPage(c, chain, parsed.path, session, now, { at: 'post', post: f.post, text: w.node.writeFirst, draft: '' }, 400)
      // The same text twice (a double click) changes nothing in core.
      await runInTree(c.env.TREE, { type: 'editPost', actor, input: { node: parsed.path, post: f.post ?? '', text } })
      return c.redirect(at, 303)
    }
    if (act === 'delete') {
      // Deleting it twice (a double click) changes nothing in core; the second lands on the tombstone too.
      await runInTree(c.env.TREE, { type: 'deletePost', actor, input: { node: parsed.path, post: f.post ?? '' } })
      return c.redirect(at, 303)
    }
    if (act === 'pin') {
      // Pinning a pinned post (a double click) changes nothing in core. pin=0 unpins.
      await runInTree(c.env.TREE, { type: 'pinPost', actor, input: { node: parsed.path, post: f.post ?? '', pin: f.pin !== '0' } })
      return c.redirect(at, 303)
    }
    if (act === 'status') {
      // The on-track toggle sends on_track, or an empty status to take the vote back (core/status.ts). The same twice
      // changes nothing.
      const status = f.status ? f.status : null
      await runInTree(c.env.TREE, { type: 'status', actor, input: { node: parsed.path, status } })
      return c.redirect(back, 303)
    }
    if (act === 'claim') {
      // Blocked, passed or dead end, with the evidence (core/posts.ts post): a thread post that backs its claimant's
      // status. A passed claim's pinned work comes one per line (pinsFromForm); core refuses anything unpinned.
      const text = (f.text ?? '').trim()
      if (!text) return htmlPage(c, chain, parsed.path, session, now, { at: 'status', text: w.node.writeFirst, ...kept }, 400)
      const claim = f.status ?? ''
      const dup = await justPosted(db, { nodeId: n.id, personId: session.personId, as: actor.as, text, now, replyTo: null, claim })
      if (dup) return c.redirect(`${back}#${dup}`, 303)
      const links = claim === 'passed' ? pinsFromForm(f.links ?? '') : []
      const r = await runInTree<{ id: string }>(c.env.TREE, { type: 'post', actor, input: { node: parsed.path, text, claim, ...(links.length ? { links } : {}) } })
      return c.redirect(`${back}#${r.id}`, 303)
    }
    if (act === 'join') {
      // The say-hi modal's words (go-live 8.2): core posts them as a join post; empty, the thread shows a quiet line.
      const hello = (f.hello ?? '').trim()
      const r = await runInTree<JoinResult>(c.env.TREE, { type: 'join', actor, input: { node: parsed.path, ...(hello ? { hello } : {}) } })
      return c.redirect(r.post ? `${back}#${r.post}` : back, 303)
    }
    await runInTree(c.env.TREE, { type: act, actor, input: { node: parsed.path } })
    return c.redirect(back, 303)
  } catch (e) {
    if (!(e instanceof ShwarmError)) throw e
    const at =
      act === 'post'
        ? 'compose'
        : act === 'mark_passed'
          ? 'owner'
          : act === 'edit' || act === 'delete' || act === 'pin' || act === 'upvote' || act === 'back'
            ? 'post'
            : act === 'status' || act === 'claim'
              ? 'status'
              : 'seats'
    // A refused join keeps the say-hi words, and the page opens the modal again with them.
    const draft = act === 'post' || act === 'edit' || act === 'claim' ? f.text ?? '' : act === 'join' && (f.hello ?? '').trim() ? f.hello : undefined
    // A refused upvote, back, edit, delete or pin shows under its post; a refused pinned post keeps its box ticked.
    if (act === 'edit' || act === 'delete' || act === 'pin' || act === 'upvote' || act === 'back') Object.assign(kept, { post: f.post })
    if (act === 'post' && f.pin === '1') Object.assign(kept, { pin: true })
    if (e.code === 'rate_limited') {
      const wait = Number(e.details.retry_after) || 60
      c.header('Retry-After', String(wait))
      return htmlPage(c, chain, parsed.path, session, now, { at, text: fill(w.node.slowPost, { wait: waitText(wait) }), draft, ...kept }, 429)
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
      return refuse(fill(w.node.slowReport, { wait: waitText(wait) }), { status: 429 })
    }
    const r = await reportPost(db, { by, nodeId: chain.node.id, path, post, reason: f.reason, text: f.text, env: c.env.ENV, now })
    // OPEN (#105): new wording.
    if (r === 'already') return refuse(w.node.alreadyReported, { status: 200, keep: false })
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
      return refuse(fill(w.node.slowFlag, { wait: waitText(wait) }), 429)
    }
    const r = await flagNode(db, { by: { personId: session.personId }, nodeId: chain.node.id, path, reason: f.reason, env: c.env.ENV, now })
    // OPEN (#106): new wording.
    if (r === 'already') return refuse(fill(w.node.alreadyFlagged, { kind: chain.node.kind === 'branch' ? w.node.kindBranch : w.node.kindShwarm }), 200)
    return c.redirect(`/w/${path}${url.search}`, 303)
  } catch (e) {
    if (!(e instanceof ShwarmError)) throw e
    return refuse(e.message)
  }
}

const formLines = (s: string) => s.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

/**
 * A passed claim's pinned work as typed in its form, one per line: "url sha256" for a file, "repo commit [path]" for a
 * repo at a commit (a 40-character commit id, or any line with a path after it; the repo may be a rad: id), an
 * ipfs:// address or a magnet: link on its own. Shapes only: core checks every pin (core/text.ts parsePins), so an
 * unpinned or badly pinned one is refused there with its reason, in the words the submission form used.
 */
export function pinsFromForm(s: string): Record<string, string>[] {
  return formLines(s).map((line): Record<string, string> => {
    const [first, second, ...rest] = line.split(/\s+/)
    if (second === undefined) return /^ipfs:\/\//i.test(first) ? { ipfs: first } : /^magnet:/i.test(first) ? { magnet: first } : { url: first } // no fingerprint: core refuses it
    const pin = /^[0-9a-f]+$/i.test(second) ? second.toLowerCase() : second
    if (rest.length || /^[0-9a-f]{40}$/.test(pin) || /^rad:/.test(first)) return { repo: first, commit: pin, ...(rest.length ? { path: rest.join(' ') } : {}) }
    return { url: first, sha256: pin }
  })
}
