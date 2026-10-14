// The create form, /new (go-live 4.2), ported from mockups/new.html in shwarm mode: title, what, done when, how
// it's checked (at least one check), tags, builds on, license. No lobby (decided Oct 9): it publishes a live shwarm
// with the author down as working on it, through the shwarm tree (core/nodes.ts createNode), counted toward 3 new
// nodes a day, and goes to the new page. New nodes start 'pending' and triage (8.1, triage/run.ts) runs right after the redirect;
// production keeps creation paused (setting pause_new_nodes) until triage is seen running there; the form says so up front.
// In the beta (go-live 3.10) anyone who isn't invited gets "opens soon" (web/opens-soon.tsx) instead of the form.
//
// Builds on: paste the link or path of a shwarm that passed or is a dead end, or any link. GitHub repo links get their name and SPDX license
// from the GitHub API; any other link is stored as its URL and a name, with the license typed in. A builds-on
// license replaces the license picker (protocol §8).
// OPEN: the mockup's live search and the chip with "change" need JavaScript; this first version is a plain form.
//
// Branch mode (go-live 4.3), as mockups/new.html draws it. /new?parent=<path> makes a branch: the parent's done
// test shown as what it helps reach, no tags or builds-on, the parent's license, live at once. It reaches the parent
// only as the node page would show it to this viewer. Variants are dropped (decided Oct 9): there is no ?variant= mode.
// /new?builds_on=<path> fills the builds-on field, and names the shwarm when it's an ended one this viewer can see (the
// result page's and a dead end's "build on this"); its done test then fills "done when", to keep or change (decided Oct 9:
// a passed shwarm is challenged by building on it with the same done test; nothing enforces it).
// /new?parent=<path>&from=<post id> is a post's "make it a branch" (go-live 4.8): the branch form, filled from the post.
//
// No edit mode (decided Oct 12; it superseded "edit replaces re-pitch" of Oct 10): once posted, a shwarm's or a
// branch's words can't be changed, and the form says so next to its button. /new?edit=<path> (the old "edit") and a
// form posted from an old edit tab get that refusal, never the form: nothing is changed and nothing new is made.
import { Hono, type Context } from 'hono'
import type { FC } from 'hono/jsx'
import { ShwarmError } from '@shwarm/protocol'
import { formToken } from '../auth/csrf'
import { formOf, FORM_FIELD, later, postedTokenOk, who, type AuthContext } from '../auth/request'
import { signInHref } from '../auth/return-to'
import { siteActor } from '../core/actor'
import { isId } from '../core/ids'
import { DEFAULT_RUNS } from '../core/checks'
import { ENDED, LICENSES, NO_EDIT, needBranchable, type CreateNodeInput } from '../core/nodes'
import { lockedError } from '../core/context'
import { readSettings } from '../core/settings'
import { MAX_TEXT, MAX_TITLE } from '../core/text'
import { runInTree } from '../do/shwarm-tree'
import { lockedBy, parseNodePath, readChain, type Chain, type NodeHead } from '../read/node'
import { cut, licenseName } from '../render/format'
import { showHidden } from '../render/hidden'
import { Plain, Text } from '../render/text'
import { triageNew } from '../triage/run'
import { fill, fillx, w } from '../words'
import { sendError, waitText } from './errors'
import { AgentResources, Layout } from './layout'
import { nodeHref } from './node-page'
import { OpensSoonPage } from './opens-soon'
import { opensSoon, page } from './viewer'

type Env = { Bindings: { DB: D1Database; TREE: DurableObjectNamespace; AI: Ai; TRIAGE_MODEL?: string; CSRF_SECRET: string; ENV: string; SITE_MODE: string; PASSWORD_PEPPER: string } }
type C = Context<Env>

/** The form's fields, as posted (and as shown again after a refusal). `edit` only marks a form from an old edit tab. */
export type CreateForm = Partial<Record<
  'title' | 'what' | 'done_when' | 'c_runs' | 'command' | 'runs' | 'c_people' | 'people' | 'human' | 'instructions' | 'c_author' | 'tags' | 'license' | 'builds_on' | 'builds_on_name' | 'builds_on_license' | 'parent' | 'edit',
  string
>>

/**
 * What the form makes (go-live 4.3): a shwarm, with `upstream` when ?builds_on= names an ended shwarm (passed or a dead
 * end) this viewer can see; or a branch under `chain.node`.
 */
export type Mode = { kind: 'shwarm'; upstream?: NodeHead | null } | { kind: 'branch'; chain: Chain }

const FRESH: CreateForm = { c_author: 'on', runs: String(DEFAULT_RUNS), people: '2', license: LICENSES[0] }

const place = () => ({
  title: w.create.placeTitle,
  what: w.create.placeWhat,
  done: w.create.placeDone,
  command: w.create.placeCommand,
  look: w.create.placeLook,
})
// mockups/new.html's branch placeholders
const branchPlace = (): ReturnType<typeof place> => ({
  title: w.create.branchPlaceTitle,
  what: w.create.branchPlaceWhat,
  done: w.create.branchPlaceDone,
  command: w.create.branchPlaceCommand,
  look: w.create.branchPlaceLook,
})

/**
 * "make it a branch" (go-live 4.8, mockups/shwarm.html): a plain post in the parent's thread fills the branch form, its
 * first line as the title (cut to fit) and its whole text as the what. Any other id (a submission, a check, a hidden or
 * deleted post, a post elsewhere) is ignored and the form starts empty.
 * OPEN (#79): the branch doesn't record the post it came from, so the post can't show "became sub-branch" (THREAD-9) yet.
 */
export async function fieldsFromPost(db: D1Database, nodeId: number, id: string | undefined): Promise<CreateForm | null> {
  if (!isId('p', id)) return null
  const p = await db
    .prepare("SELECT text FROM post WHERE id = ? AND node_id = ? AND kind = 'post' AND hidden = 0 AND deleted_at IS NULL")
    .bind(id, nodeId)
    .first<{ text: string }>()
  if (!p) return null
  const first = p.text.split('\n').find(l => l.trim()) ?? ''
  return { ...FRESH, title: cut(first, MAX_TITLE), what: p.text }
}

/**
 * Said next to the button on both forms (decided Oct 12): once posted, a shwarm's or a branch's words can't be changed.
 * OPEN: the words wait on Myra's yes.
 */
const fixedNote = () => w.create.fixedNote
/**
 * The note under the checks (decided Oct 12, no editing): the done test is fixed once posted. OPEN: the words wait on
 * Myra's yes; they replace "the done test locks once someone else joins or anything is submitted" (shwarm) and "the
 * done test locks once it goes live … not editing this one" (branch).
 */
const lockNote = () => <>{fillx(w.create.lockNote, { newShwarm: <b>{w.create.lockNoteNew}</b> })}</>

/** The page's words that change with the mode, from mockups/new.html. */
function wordsOf(mode: Mode) {
  if (mode.kind === 'branch') {
    const n = mode.chain.node
    const root = mode.chain.ancestors[0] ?? n
    return {
      page: fill(w.create.branchPageTitle, { title: showHidden(n.title) }),
      heading: w.create.branchHeading,
      sub: w.create.branchSub, // OPEN: mockups/new.html's "no lobby:" dropped; waits on Myra's yes
      pitchHint: w.create.branchPitchHint,
      oneTest: w.create.branchOneTest,
      licHint: w.create.branchLicHint,
      // OPEN (#77): the mockup's "goes live right away" predates triage; the check-first sentence is the shwarm form's.
      goNote: fill(w.create.branchGoNote, { title: showHidden(n.title) }),
      go: w.create.branchGo,
      place: branchPlace(),
      root,
      lockNote: lockNote(),
    }
  }
  // OPEN (decided Oct 9, "No lobby"): the sub line, the license hint's "locks once you post it", the go note's last
  // sentence and the button lost their lobby words; the new words wait on Myra's yes.
  return {
    page: w.create.pageTitle,
    heading: w.create.heading,
    sub: w.create.sub,
    pitchHint: w.create.pitchHint,
    oneTest: w.create.oneTest,
    // OPEN (decided Oct 12, once posted it can't be changed): "it can't be changed once you post it" replaces "it locks
    // once someone else joins or anything is submitted"; the words wait on Myra's yes.
    licHint: w.create.licHint,
    goNote: w.create.goNote,
    go: w.create.go,
    place: place(),
    root: null,
    lockNote: lockNote(),
  }
}

const Crumbs: FC<{ mode: Mode }> = ({ mode }) => {
  if (mode.kind === 'shwarm') return null
  const up = [...mode.chain.ancestors, mode.chain.node]
  return (
    <nav class="crumbs" aria-label={w.create.crumbsLabel}>
      {up.map(n => (
        <>
          <a href={nodeHref(n.path)}><Plain text={n.title} /></a>
          <span>/</span>
        </>
      ))}
      {w.create.branchHeading}
    </nav>
  )
}

/**
 * The form in its mode. `refused`: why this parent takes no branch right now (a closed or dead-end node), or why
 * nothing can be edited (an old edit link), shown in place of the form.
 */
export const NewPage: FC<{ token?: string; v?: CreateForm; error?: string; refused?: string; verified: boolean; mode?: Mode }> = ({
  token,
  v = FRESH,
  error,
  refused,
  verified,
  mode = { kind: 'shwarm' },
}) => {
  const on = (k: keyof CreateForm) => v[k] === 'on'
  const t = wordsOf(mode)
  const branch = mode.kind === 'branch' ? mode.chain.node : null
  const upstream = mode.kind !== 'branch' ? mode.upstream : null
  return (
    <Layout title={t.page}>
      <link rel="stylesheet" href="/css/new.css" />
      <Crumbs mode={mode} />
      <h1 class="title" id="heading">{t.heading}</h1>
      <div class="note" id="sub">{t.sub}</div>
      <div class="grid">
        <main id="main" tabindex={-1}>
          {(error || refused) && <p class="err top" role="alert">{error ?? refused}</p>}
          {refused ? null : !verified ? (
            <div class="box"><div class="f"><p class="note" style="margin:0">{w.create.verifyFirst}</p></div></div>
          ) : (
            <form method="post" action="/new" class="new">
              <input type="hidden" name={FORM_FIELD} value={token} />
              {branch && <input type="hidden" name="parent" value={branch.path} />}
              <div class="box">
                {branch && (
                  <div class="f" id="f-parent">
                    <span class="lbl">{w.create.helpingReach}</span>
                    <div class="parent"><b>{fillx(w.create.parentDoneWhen, { title: <Plain text={branch.title} /> })}</b><Text inline text={branch.done_when} /></div>
                    <p class="hint">{w.create.helpingReachHint}</p>
                  </div>
                )}
                <div class="f">
                  <label for="title">{w.create.title}</label>
                  <input type="text" id="title" name="title" class="big" required maxlength={MAX_TITLE} placeholder={t.place.title} value={v.title ?? ''} />
                </div>
              </div>
              <div class="box">
                <div class="halves">
                  <div class="f">
                    <label for="pitch">{w.create.what}</label>
                    <p class="hint" id="pitch-hint">{t.pitchHint}</p>
                    <textarea id="pitch" name="what" required maxlength={MAX_TEXT} aria-describedby="pitch-hint" placeholder={t.place.what}>{v.what ?? ''}</textarea>
                  </div>
                  <div class="f dt">
                    <label for="done">{w.create.doneWhen}</label>
                    <p class="hint" id="done-hint">{w.create.doneHint}</p>
                    <textarea id="done" name="done_when" required maxlength={2000} aria-describedby="done-hint" placeholder={t.place.done}>{v.done_when ?? ''}</textarea>
                  </div>
                </div>
              </div>
              <div class="box">
                <h2 class="sunny">{w.create.howChecked} <span>{t.oneTest}</span></h2>
                <div class="f">
                  {/* OPEN (#92): the mockup's "anyone can reopen a pass with a failing repro." is dropped (decided Oct 9: nothing reopens). */}
                  <p class="hint">{branch ? w.create.branchChecksHint : w.create.checksHint}</p>
                  <div class="chk">
                    <input type="checkbox" id="c-machine" name="c_runs" checked={on('c_runs')} />
                    <div class="body">
                      <label for="c-machine"><b>{w.create.runs}</b></label>
                      <span class="note">{w.create.runsNote}</span>
                      <div class="row">
                        {/* A one-line field drops line breaks, so a command stored with them (agent API) is shown whole. */}
                        {(v.command ?? '').includes('\n') ? (
                          <textarea id="cmd" name="command" aria-label={w.create.runCommandLabel} maxlength={2000} style="min-height:52px" placeholder={t.place.command}>{v.command}</textarea>
                        ) : (
                          <input type="text" id="cmd" name="command" aria-label={w.create.runCommandLabel} maxlength={2000} placeholder={t.place.command} value={v.command ?? ''} />
                        )}
                      </div>
                      <div class="row">{fillx(w.create.runsCount, { number: <input type="number" id="n-runs" name="runs" min={1} max={50} aria-label={w.create.runsCountLabel} value={v.runs ?? String(DEFAULT_RUNS)} /> })}</div>
                    </div>
                  </div>
                  <div class="chk">
                    <input type="checkbox" id="c-people" name="c_people" checked={on('c_people')} />
                    <div class="body">
                      <label for="c-people"><b>{w.create.people}</b></label>
                      <span class="note">{w.create.peopleNote}</span>
                      <div class="row">
                        {fillx(w.create.peopleCount, { number: <input type="number" id="n-people" name="people" min={1} max={50} aria-label={w.create.peopleCountLabel} value={v.people ?? '2'} /> })}
                        <label><input type="checkbox" id="human" name="human" checked={on('human')} />{w.create.atLeastOneHuman}</label>
                      </div>
                      <div class="row"><textarea id="look" name="instructions" aria-label={w.create.whatCheckersDo} maxlength={4000} style="min-height:52px" placeholder={t.place.look}>{v.instructions ?? ''}</textarea></div>
                    </div>
                  </div>
                  {/* A branch has no author sign-off (decided Oct 13): its pass is its status vote. */}
                  {!branch && (
                    <div class="chk">
                      <input type="checkbox" id="c-author" name="c_author" checked={on('c_author')} />
                      <div class="body">
                        <label for="c-author"><b>{w.create.author}</b></label>
                        <span class="note">{w.create.authorNote}</span>
                      </div>
                    </div>
                  )}
                </div>
                <div class="f">
                  {/* OPEN (#69): variants are dropped, so this no longer says "starting a variant"; the words wait on Myra's yes. */}
                  <p class="note" style="margin:0">{t.lockNote}</p>
                </div>
              </div>
              {!branch && (
                <div class="box" id="f-shwarm">
                  <div class="f">
                    <label for="tags">{w.create.tags}</label>
                    <p class="hint" id="tags-hint">{w.create.tagsHint}</p>
                    <input type="text" id="tags" name="tags" required aria-describedby="tags-hint" placeholder={w.create.tagsPlaceholder} value={v.tags ?? ''} />
                  </div>
                </div>
              )}
              {!branch && (
                <div class="box" id="f-builds">
                  <div class="f">
                    <label for="upstream">{w.create.buildsOn} <span class="note" style="font-weight:400">{w.create.optional}</span></label>
                    <p class="hint" id="up-hint">{w.create.buildsOnHint}</p>
                    <input type="text" id="upstream" name="builds_on" aria-describedby="up-hint" placeholder={w.create.buildsOnPlaceholder} autocomplete="off" value={v.builds_on ?? ''} />
                    {upstream && (
                      <div class="picked" id="picked"><div><b><Plain text={upstream.title} /></b> <span>{fill(w.create.pickedLine, { path: upstream.path, license: licenseName(upstream.license) })}</span></div></div>
                    )}
                    <div class="row two">
                      <input type="text" name="builds_on_name" aria-label={w.create.buildsOnName} placeholder={w.create.buildsOnName} maxlength={200} value={v.builds_on_name ?? ''} />
                      <input type="text" name="builds_on_license" aria-label={w.create.buildsOnLicenseLabel} placeholder={w.create.buildsOnLicensePlaceholder} maxlength={100} value={v.builds_on_license ?? ''} />
                    </div>
                    <p class="hint" style="margin:6px 0 0">{w.create.buildsOnFillHint}</p>
                  </div>
                </div>
              )}
              <div class="box" id="f-license">
                <div class="f">
                  <label for="license">{w.create.license}</label>
                  <p class="hint" id="lic-hint">{t.licHint}</p>
                  {branch ? (
                    // Branches inherit the license, so nothing is sent: the select is shown, not posted.
                    <select id="license" aria-describedby="lic-hint" disabled>
                      <option>{licenseName(branch.license)}</option>
                    </select>
                  ) : (
                    <select id="license" name="license" aria-describedby="lic-hint" hidden={upstream ? true : undefined}>
                      {LICENSES.map((l, i) => <option value={l} selected={(v.license ?? LICENSES[0]) === l}>{i === 0 ? fill(w.create.licenseDefault, { license: licenseName(l) }) : licenseName(l)}</option>)}
                    </select>
                  )}
                  {branch && t.root && (
                    <p class="note" id="lic-up" style="margin:6px 0 0">{fillx(w.create.inheritsFrom, { shwarm: <Plain text={t.root.title} />, license: licenseName(branch.license) })}</p>
                  )}
                  {upstream && (
                    <p class="note" id="lic-up" style="margin:6px 0 0">{fillx(w.create.takesUpstream, { shwarm: <Plain text={upstream.title} /> })}</p>
                  )}
                </div>
              </div>
              <div class="go">
                <span class="note" id="go-note">{t.goNote} <b id="fixed-note">{fixedNote()}</b></span>
                <button class="btn" type="submit" id="go">{t.go}</button>
              </div>
            </form>
          )}
        </main>
        <aside>
          <div class="box">
            <h2>{w.create.rules} <span>{w.create.rulesAll}</span></h2>
            <div class="in">
              <ol class="rules">
                <li><b>{w.create.ruleCheckable}</b>{w.create.ruleCheckableText}</li>
                <li><b>{w.create.ruleOpen}</b>{w.create.ruleOpenText}</li>
                <li><b>{w.create.ruleHarmless}</b>{w.create.ruleHarmlessText}</li>
              </ol>
              {/* OPEN: new wording, the link. */}
              <p class="note">{fillx(w.create.triageNote, { rubric: <a href="/triage">{w.create.triageRubric}</a> })}</p>
            </div>
          </div>
          <AgentResources />
        </aside>
      </div>
      <script src="/js/new.js" defer></script>
    </Layout>
  )
}

const bad = (m: string) => new ShwarmError('bad_request', m)

/** A whole number from a form field, or the fallback when it's blank. */
function whole(v: string | undefined, what: string, fallback?: number): number {
  if ((v === undefined || v.trim() === '') && fallback !== undefined) return fallback
  const n = Number(v)
  if (!Number.isInteger(n)) throw bad(fill(w.create.wholeNumber, { field: what }))
  return n
}

/** "#weird #games, gzdoom" → ['weird', 'games', 'gzdoom']. createNode checks each one. */
export const parseTagField = (s: string | undefined) => (s ?? '').split(/[\s,]+/).map(t => t.replace(/^#+/, '')).filter(Boolean)

/** The form's check boxes as a check spec for parseCheckSpec. */
export function checkFromForm(f: CreateForm): Record<string, unknown> {
  const check: Record<string, unknown> = { author: f.c_author === 'on' }
  if (f.c_runs === 'on') check.runs = { command: f.command ?? '', count: whole(f.runs, w.create.runs, DEFAULT_RUNS) }
  if (f.c_people === 'on') check.people = { count: whole(f.people, w.create.people, 2), human: f.human === 'on', instructions: f.instructions ?? '' }
  return check
}

type Fetch = typeof fetch

/** A github.com/<owner>/<repo> link's name and SPDX license, from the GitHub API; null when it isn't one or has none. */
export async function githubRepo(url: URL, get: Fetch = fetch): Promise<{ name: string; url: string; license: string | null } | null> {
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null
  const m = /^\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?(?:$|\/)/.exec(url.pathname)
  if (!m) return null
  let res: Response
  try {
    res = await get(`https://api.github.com/repos/${m[1]}/${m[2]}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'shwarm.org (builds-on lookup)' },
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  const r = await res.json<{ full_name?: string; html_url?: string; license?: { spdx_id?: string } | null }>()
  const spdx = r.license?.spdx_id
  return { name: r.full_name ?? `${m[1]}/${m[2]}`, url: r.html_url ?? url.toString(), license: spdx && spdx !== 'NOASSERTION' ? spdx : null }
}

const asUrl = (raw: string): URL | null => {
  try {
    return new URL(raw)
  } catch {
    return null // not a link: a shwarm path, if anything
  }
}

/** A shwarm path as typed in builds-on: a bare path, or a link to /w/<path> here or on shwarm.org. Null for anything else. */
export function shwarmPathOf(raw: string, origin: string): string | null {
  const url = asUrl(raw)
  if (!url) return /^[a-z0-9][a-z0-9/-]*$/.test(raw) ? raw.replace(/^\/+|\/+$/g, '') : null
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const here = new URL(origin)
  if (!((url.host === here.host || url.hostname === 'shwarm.org') && url.pathname.startsWith('/w/'))) return null
  try {
    return decodeURIComponent(url.pathname.slice(3)).replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** The builds-on fields as createNode takes them: a shwarm path, an outside {name, url, license}, or null. */
export async function buildsOnFromForm(f: CreateForm, origin: string, get: Fetch = fetch): Promise<CreateNodeInput['buildsOn']> {
  const raw = (f.builds_on ?? '').trim()
  const typed = (f.builds_on_license ?? '').trim()
  const name = (f.builds_on_name ?? '').trim()
  if (!raw) return null
  const path = shwarmPathOf(raw, origin)
  if (path !== null) return path
  const url = asUrl(raw)
  if (!url) throw bad(w.create.buildsOnNotLink)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw bad(w.create.buildsOnNotWeb)
  const gh = await githubRepo(url, get)
  const license = gh?.license ?? typed
  if (!license) throw new ShwarmError('bad_license', gh ? fill(w.create.githubNoLicense, { name: gh.name }) : w.create.typeLicense)
  return { name: gh?.name ?? (name || url.hostname + url.pathname.replace(/\/+$/, '')), url: gh?.url ?? url.toString(), license }
}

export const create = new Hono<Env>()

const formFields = (f: Record<string, string>): CreateForm => {
  const keep: CreateForm = {}
  for (const k of ['title', 'what', 'done_when', 'c_runs', 'command', 'runs', 'c_people', 'people', 'human', 'instructions', 'c_author', 'tags', 'license', 'builds_on', 'builds_on_name', 'builds_on_license', 'parent', 'edit'] as const)
    if (typeof f[k] === 'string') keep[k] = f[k]
  return keep
}

/** A refusal as the page shows it: core's message as one sentence. */
const sentence = (e: ShwarmError) => e.message.replace(/\.?$/, '.')

/** Why `check` refuses this node, as the page says it; nothing when it doesn't. */
function refusal(check: () => void): string | undefined {
  try {
    check()
  } catch (e) {
    if (e instanceof ShwarmError) return sentence(e)
    throw e
  }
  return undefined
}

/** The node at a ?parent= path as the node page would show it to this viewer; null when it wouldn't. */
async function shownNode(db: D1Database, raw: string, viewerId: number): Promise<Chain | null> {
  const p = parseNodePath(raw.trim().replace(/^\/?(w\/)?|\/+$/g, ''))
  return p.kind === 'node' ? readChain(db, p.path, viewerId) : null
}

/** builds on as typed: the ended shwarm it names, when this viewer can see one. */
async function upstreamOf(db: D1Database, raw: string | undefined, viewerId: number, origin: string): Promise<NodeHead | null> {
  const path = raw ? shwarmPathOf(raw.trim(), origin) : null
  const up = path ? await shownNode(db, path, viewerId) : null
  return up && ENDED.includes(up.node.state) ? up.node : null
}

/**
 * The form's mode from ?parent= (or the posted parent field), with why it's refused, if it is. Null when the parent
 * isn't there for this viewer: a 404, as on its own page. A ?variant= is ignored: variants are dropped (decided Oct 9).
 */
async function modeOf(
  db: D1Database,
  q: { parent?: string; builds_on?: string },
  viewerId: number,
  origin: string,
): Promise<{ mode: Mode; refused?: string } | null> {
  if (q.parent) {
    const chain = await shownNode(db, q.parent, viewerId)
    return (
      chain && {
        mode: { kind: 'branch', chain },
        refused: refusal(() => {
          needBranchable(chain.node)
          const by = lockedBy(chain) // a node above it ended: locked with it (core's needLive)
          if (by) throw lockedError(chain.node, by)
        }),
      }
    )
  }
  // ?builds_on= names an ended shwarm (the result page's or a dead end's "build on this"): the field shows its path and
  // the chip its name.
  return { mode: { kind: 'shwarm', upstream: await upstreamOf(db, q.builds_on, viewerId, origin) } }
}

/** Where this form lives: /new, or /new in its branch mode. */
const formHref = (mode: Mode) => (mode.kind === 'branch' ? `/new?parent=${encodeURIComponent(mode.chain.node.path)}` : '/new')

const paused = () => w.create.paused

const noNode = (c: C) => sendError(c, { status: 404, code: 'no_such_node', text: w.create.noNode }, 'html')

/** The refusal for a fourth new node today, read out here: in the handlers `w` is the viewer, not the word list. */
const tooMany = (wait: number) => fill(w.create.rateLimited, { wait: waitText(wait) })

create.get('/new', async c => {
  c.header('Cache-Control', 'private, no-store')
  // The beta (go-live 3.10): anyone who isn't invited, signed out too, gets "opens soon" instead of the form.
  if (await opensSoon(c)) return page(c, <OpensSoonPage />)
  const w = await who(c as unknown as AuthContext)
  const url = new URL(c.req.url)
  if (!w.session) return c.redirect(signInHref(url.pathname + url.search), 303)
  // The old "edit" link (retired Oct 12): no form, just why. Nothing is read from the node it names.
  if (c.req.query('edit') !== undefined) return noEdit(c as C, w.session.verified)
  const q = { parent: c.req.query('parent'), builds_on: c.req.query('builds_on') }
  const m = await modeOf(c.env.DB, q, w.session.personId, url.origin)
  if (!m) return noNode(c as C)
  // Paused (setting pause_new_nodes, kept on in production until triage runs there): say so before the form is filled.
  if (!m.refused && (await readSettings(c.env.DB, ['pause_new_nodes'])).pause_new_nodes === true)
    return page(c, <NewPage refused={paused()} verified={w.session.verified} mode={m.mode} />)
  const token = await formToken(c.env.CSRF_SECRET, w.session.id)
  // Building on an ended shwarm starts from its done test (decided Oct 9): kept word for word, the new shwarm shows on the
  // result page as challenging the pass; changed, it's built on it. OPEN (#92): only "done when" is filled, not its checks.
  const upstream = m.mode.kind === 'shwarm' ? m.mode.upstream : null
  const v: CreateForm =
    m.mode.kind === 'branch'
      ? ((await fieldsFromPost(c.env.DB, m.mode.chain.node.id, c.req.query('from'))) ?? FRESH)
      : q.builds_on
        ? { ...FRESH, builds_on: q.builds_on.trim().slice(0, 600), ...(upstream ? { done_when: upstream.done_when } : {}) }
        : FRESH
  return page(c, <NewPage token={token} v={v} refused={m.refused} verified={w.session.verified} mode={m.mode} />)
})

/** An old edit link or edit form (decided Oct 12): refused, 410, with why. Nothing is changed and nothing is made. */
const noEdit = (c: C, verified: boolean) => page(c, <NewPage refused={NO_EDIT} verified={verified} />, 410)

create.post('/new', async (c: C) => {
  if (await opensSoon(c)) return page(c, <OpensSoonPage />, 403)
  const w = await who(c as unknown as AuthContext)
  if (!w.session) return c.redirect(signInHref('/new'), 303)
  const raw = await formOf(c)
  const f = formFields(raw)
  const session = w.session
  // A form from an old edit tab (retired Oct 12) changes nothing, and never falls through to making a new shwarm.
  if (f.edit !== undefined) return noEdit(c, session.verified)
  const origin = new URL(c.req.url).origin
  // builds_on too, so a refused form that builds on an ended shwarm comes back with its chip and the license picker hidden.
  const m = await modeOf(c.env.DB, { parent: f.parent, builds_on: f.builds_on }, session.personId, origin)
  if (!m) return noNode(c)
  const mode = m.mode
  if (!(await postedTokenOk(c as unknown as AuthContext, w, raw))) return c.redirect(formHref(mode), 303)
  const again = async (error: string, status: 400 | 429) =>
    page(c, <NewPage token={await formToken(c.env.CSRF_SECRET, session.id)} v={f} error={error} verified={session.verified} mode={mode} />, status)
  // The parent changed since the form was shown (live, now closed): the page says so, without the form.
  if (m.refused) return page(c, <NewPage refused={m.refused} verified={session.verified} mode={mode} />, 400)
  try {
    const text = { title: (f.title ?? '').trim(), what: (f.what ?? '').trim(), doneWhen: (f.done_when ?? '').trim(), check: checkFromForm(f) }
    let input: CreateNodeInput
    if (mode.kind === 'branch') {
      // A branch takes its parent's license and builds-on, and has no tags: none are sent.
      input = { kind: 'branch', parent: mode.chain.node.path, ...text }
    } else {
      const buildsOn = await buildsOnFromForm(f, origin)
      input = {
        kind: 'shwarm',
        ...text,
        tags: parseTagField(f.tags),
        license: buildsOn ? undefined : f.license,
        buildsOn,
      }
    }
    const r = await runInTree<{ path: string }>(c.env.TREE, { type: 'createNode', actor: siteActor({ id: session.personId, handle: session.handle }), input })
    // After the response (waitUntil), so the redirect doesn't wait on the model. The author sees "being checked" until then.
    await later(c, () => triageNew(c.env, r.path))
    return c.redirect(`/w/${r.path}`, 303)
  } catch (e) {
    if (!(e instanceof ShwarmError)) throw e
    if (e.code === 'rate_limited') {
      const wait = Number(e.details.retry_after) || 3600
      c.header('Retry-After', String(wait))
      return again(tooMany(wait), 429)
    }
    return again(sentence(e), 400)
  }
})
