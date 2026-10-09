// The create form, /new (go-live 4.2), ported from mockups/new.html in shwarm mode: title, what, done when, how
// it's checked (at least one check), tags, lobby (min 2, default 10), builds on, license. It publishes a lobby with
// the author in seat 1 through the shwarm tree (core/nodes.ts createNode), counted toward 3 new nodes a day, and
// goes to the new page. New nodes start 'pending' and triage (8.1, triage/run.ts) runs right after the redirect;
// production keeps creation paused (setting pause_new_nodes) until the seeds are checked.
//
// Builds on: paste a passed shwarm's link or path, or any link. GitHub repo links get their name and SPDX license
// from the GitHub API; any other link is stored as its URL and a name, with the license typed in. A builds-on
// license replaces the license picker (protocol §8).
// OPEN: the mockup's live search and the chip with "change" need JavaScript; this first version is a plain form.
import { Hono, type Context } from 'hono'
import type { FC } from 'hono/jsx'
import { ShwarmError } from '@shwarm/protocol'
import { formToken } from '../auth/csrf'
import { formOf, FORM_FIELD, later, postedTokenOk, who, type AuthContext } from '../auth/request'
import { signInHref } from '../auth/return-to'
import { siteActor } from '../core/actor'
import { DEFAULT_RUNS } from '../core/checks'
import { DEFAULT_LOBBY, LICENSES, type CreateNodeInput } from '../core/nodes'
import { MAX_TEXT, MAX_TITLE } from '../core/text'
import { runInTree } from '../do/shwarm-tree'
import { licenseName } from '../render/format'
import { triageNew } from '../triage/run'
import { waitText } from './errors'
import { AgentResources, Layout } from './layout'
import { page } from './viewer'

type Env = { Bindings: { DB: D1Database; TREE: DurableObjectNamespace; AI: Ai; TRIAGE_MODEL?: string; CSRF_SECRET: string; ENV: string; SITE_MODE: string } }
type C = Context<Env>

export const MIN_LOBBY = 2 // go-live 4.2: a lobby is at least 2 people

/** The form's fields, as posted (and as shown again after a refusal). */
export type CreateForm = Partial<Record<
  'title' | 'what' | 'done_when' | 'c_runs' | 'command' | 'runs' | 'c_people' | 'people' | 'human' | 'instructions' | 'c_author' | 'tags' | 'lobby' | 'license' | 'builds_on' | 'builds_on_name' | 'builds_on_license',
  string
>>

const FRESH: CreateForm = { c_author: 'on', runs: String(DEFAULT_RUNS), people: '2', lobby: String(DEFAULT_LOBBY), license: LICENSES[0] }

const PLACE = {
  title: 'minecraft in doom',
  what: "doom's engine is 30 years old and still the most hackable shooter there is…",
  done: 'a downloadable gzdoom mod where you can dig, place blocks and build while imps attack, at 60 fps on the reference rig, using only open assets.',
  command: './bench.sh --fps 60 && ./license-scan.sh',
  look: 'what checkers do and what they should see: play the demo build for 10 minutes, dig and build while being chased, no crash, no stutter.',
}

export const NewPage: FC<{ token?: string; v?: CreateForm; error?: string; verified: boolean }> = ({ token, v = FRESH, error, verified }) => {
  const on = (k: keyof CreateForm) => v[k] === 'on'
  return (
    <Layout title="new shwarm · shwarm">
      <link rel="stylesheet" href="/css/new.css" />
      <h1 class="title" id="heading">new shwarm</h1>
      <div class="note" id="sub">a goal worth a crowd. your shwarm starts when enough people join.</div>
      <div class="grid">
        <main id="main" tabindex={-1}>
          {error && <p class="err top" role="alert">{error}</p>}
          {!verified ? (
            <div class="box"><div class="f"><p class="note" style="margin:0">verify your email to start a shwarm. the link is in your inbox.</p></div></div>
          ) : (
            <form method="post" action="/new" class="new">
              <input type="hidden" name={FORM_FIELD} value={token} />
              <div class="box">
                <div class="f">
                  <label for="title">title</label>
                  <input type="text" id="title" name="title" class="big" required maxlength={MAX_TITLE} placeholder={PLACE.title} value={v.title ?? ''} />
                </div>
              </div>
              <div class="box">
                <div class="halves">
                  <div class="f">
                    <label for="pitch">what</label>
                    <p class="hint" id="pitch-hint">what is this, why does it matter, and why now?</p>
                    <textarea id="pitch" name="what" required maxlength={MAX_TEXT} aria-describedby="pitch-hint" placeholder={PLACE.what}>{v.what ?? ''}</textarea>
                  </div>
                  <div class="f dt">
                    <label for="done">done when</label>
                    <p class="hint" id="done-hint">what is true when it's finished. people join for this as much as for the idea.</p>
                    <textarea id="done" name="done_when" required maxlength={2000} aria-describedby="done-hint" placeholder={PLACE.done}>{v.done_when ?? ''}</textarea>
                  </div>
                </div>
              </div>
              <div class="box">
                <h2 class="sunny">how it's checked <span>one done test per shwarm</span></h2>
                <div class="f">
                  <p class="hint">a submission passes when every check you pick passes. by default that's just you. each person can submit once a day here; one check per person per submission; anyone can reopen a pass with a failing repro.</p>
                  <div class="chk">
                    <input type="checkbox" id="c-machine" name="c_runs" checked={on('c_runs')} />
                    <div class="body">
                      <label for="c-machine"><b>runs</b></label>
                      <span class="note">a command that exits 0 when the work is done. people other than the submitter run it on their own machines and post a signed run report: what they ran, on which version, and the log.</span>
                      <div class="row"><input type="text" id="cmd" name="command" aria-label="run command" maxlength={2000} placeholder={PLACE.command} value={v.command ?? ''} /></div>
                      <div class="row"><input type="number" id="n-runs" name="runs" min={1} max={50} aria-label="number of runs" value={v.runs ?? String(DEFAULT_RUNS)} /> runs, by different people</div>
                    </div>
                  </div>
                  <div class="chk">
                    <input type="checkbox" id="c-people" name="c_people" checked={on('c_people')} />
                    <div class="body">
                      <label for="c-people"><b>people</b></label>
                      <span class="note">humans or agents post pass or fail, with evidence. one check per person, never on their own work.</span>
                      <div class="row">
                        <input type="number" id="n-people" name="people" min={1} max={50} aria-label="number of people" value={v.people ?? '2'} /> people
                        <label><input type="checkbox" id="human" name="human" checked={on('human')} /> at least one human</label>
                      </div>
                      <div class="row"><textarea id="look" name="instructions" aria-label="what checkers do" maxlength={4000} style="min-height:52px" placeholder={PLACE.look}>{v.instructions ?? ''}</textarea></div>
                    </div>
                  </div>
                  <div class="chk">
                    <input type="checkbox" id="c-author" name="c_author" checked={on('c_author')} />
                    <div class="body">
                      <label for="c-author"><b>author</b></label>
                      <span class="note">you have the final say. you're notified only when a submission has passed everything else, and you never sign off on your own agents' work.</span>
                    </div>
                  </div>
                </div>
                <div class="f">
                  <p class="note" style="margin:0">the done test locks once it goes live. people join for this finish line, so changing it means <b>starting a variant</b>, not editing this one.</p>
                </div>
              </div>
              <div class="box" id="f-shwarm">
                <div class="f">
                  <label for="tags">tags</label>
                  <p class="hint" id="tags-hint">how people find it. no categories, just tags.</p>
                  <input type="text" id="tags" name="tags" required aria-describedby="tags-hint" placeholder="#weird #games #gzdoom" value={v.tags ?? ''} />
                </div>
                <div class="f">
                  <label for="seats">lobby</label>
                  <p class="hint" id="seats-hint">how many people need to join before it opens. 10 is a good start; a small proof might need 5, a citywide map far more. people count, not agents.</p>
                  <div class="row"><input type="number" id="seats" name="lobby" min={MIN_LOBBY} max={10000} aria-describedby="seats-hint" value={v.lobby ?? String(DEFAULT_LOBBY)} /> people</div>
                </div>
              </div>
              <div class="box" id="f-builds">
                <div class="f">
                  <label for="upstream">builds on <span class="note" style="font-weight:400">· optional</span></label>
                  <p class="hint" id="up-hint">an existing open project this extends: a passed shwarm, a github repo, or any other link. its license becomes this shwarm's.</p>
                  <input type="text" id="upstream" name="builds_on" aria-describedby="up-hint" placeholder="https://github.com/… or a passed shwarm's link" autocomplete="off" value={v.builds_on ?? ''} />
                  <div class="row two">
                    <input type="text" name="builds_on_name" aria-label="its name (other links)" placeholder="its name (other links)" maxlength={200} value={v.builds_on_name ?? ''} />
                    <input type="text" name="builds_on_license" aria-label="its license (other links)" placeholder="its license (other links), e.g. GPL-3.0" maxlength={100} value={v.builds_on_license ?? ''} />
                  </div>
                  <p class="hint" style="margin:6px 0 0">github and shwarm links fill in their name and license by themselves.</p>
                </div>
              </div>
              <div class="box" id="f-license">
                <div class="f">
                  <label for="license">license</label>
                  <p class="hint" id="lic-hint">everything made here is open. the default is MIT for code and CC BY 4.0 for everything else. it locks when the lobby opens, and branches inherit it.</p>
                  <select id="license" name="license" aria-describedby="lic-hint">
                    {LICENSES.map((l, i) => <option value={l} selected={(v.license ?? LICENSES[0]) === l}>{licenseName(l)}{i === 0 ? ' (default)' : ''}</option>)}
                  </select>
                </div>
              </div>
              <div class="go">
                <span class="note" id="go-note">a quick automatic check runs first. until it's done, usually within a minute, only you can see it. you start in seat 1 of its lobby.</span>
                <button class="btn" type="submit" id="go">start shwarm + open lobby</button>
              </div>
            </form>
          )}
        </main>
        <aside>
          <div class="box">
            <h2>the rules <span>that's all of them</span></h2>
            <div class="in">
              <ol class="rules">
                <li><b>checkable.</b> say how anyone can tell it's done.</li>
                <li><b>open.</b> everything made is published under an open license.</li>
                <li><b>harmless.</b> nothing here hurts people.</li>
              </ol>
              <p class="note">an automatic check reads every new shwarm and branch before anyone else sees it. it only looks for harm, never at whether an idea is good.</p>
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
  if (!Number.isInteger(n)) throw bad(`${what} is a whole number`)
  return n
}

/** "#weird #games, gzdoom" → ['weird', 'games', 'gzdoom']. createNode checks each one. */
export const parseTagField = (s: string | undefined) => (s ?? '').split(/[\s,]+/).map(t => t.replace(/^#+/, '')).filter(Boolean)

/** The form's check boxes as a check spec for parseCheckSpec. */
export function checkFromForm(f: CreateForm): Record<string, unknown> {
  const check: Record<string, unknown> = { author: f.c_author === 'on' }
  if (f.c_runs === 'on') check.runs = { command: f.command ?? '', count: whole(f.runs, 'runs', DEFAULT_RUNS) }
  if (f.c_people === 'on') check.people = { count: whole(f.people, 'people', 2), human: f.human === 'on', instructions: f.instructions ?? '' }
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

/** The builds-on fields as createNode takes them: a shwarm path, an outside {name, url, license}, or null. */
export async function buildsOnFromForm(f: CreateForm, origin: string, get: Fetch = fetch): Promise<CreateNodeInput['buildsOn']> {
  const raw = (f.builds_on ?? '').trim()
  if (!raw) return null
  const typed = (f.builds_on_license ?? '').trim()
  let url: URL | null = null
  try {
    url = new URL(raw)
  } catch {
    // not a link: a shwarm path, if anything
  }
  if (!url) {
    if (/^[a-z0-9][a-z0-9/-]*$/.test(raw)) return raw.replace(/^\/+|\/+$/g, '')
    throw bad('builds on is a link, or the path of a passed shwarm')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw bad('builds on is a web link')
  const here = new URL(origin)
  if ((url.host === here.host || url.hostname === 'shwarm.org') && url.pathname.startsWith('/w/')) return decodeURIComponent(url.pathname.slice(3)).replace(/\/+$/, '')
  const gh = await githubRepo(url, get)
  const license = gh?.license ?? typed
  if (!license) throw new ShwarmError('bad_license', gh ? `${gh.name} doesn't name a license on github. type the license it uses` : 'type the license the project you build on uses')
  const name = gh?.name ?? ((f.builds_on_name ?? '').trim() || url.hostname + url.pathname.replace(/\/+$/, ''))
  return { name, url: gh?.url ?? url.toString(), license }
}

export const create = new Hono<Env>()

const formFields = (f: Record<string, string>): CreateForm => {
  const keep: CreateForm = {}
  for (const k of ['title', 'what', 'done_when', 'c_runs', 'command', 'runs', 'c_people', 'people', 'human', 'instructions', 'c_author', 'tags', 'lobby', 'license', 'builds_on', 'builds_on_name', 'builds_on_license'] as const)
    if (typeof f[k] === 'string') keep[k] = f[k]
  return keep
}

create.get('/new', async c => {
  c.header('Cache-Control', 'private, no-store')
  const w = await who(c as unknown as AuthContext)
  if (!w.session) return c.redirect(signInHref('/new'), 303)
  // OPEN: ?parent= (branch) and ?variant= are go-live 4.3; until then /new makes shwarms only.
  return page(c, <NewPage token={await formToken(c.env.CSRF_SECRET, w.session.id)} verified={w.session.verified} />)
})

create.post('/new', async (c: C) => {
  const w = await who(c as unknown as AuthContext)
  if (!w.session) return c.redirect(signInHref('/new'), 303)
  const raw = await formOf(c)
  if (!(await postedTokenOk(c as unknown as AuthContext, w, raw))) return c.redirect('/new', 303)
  const f = formFields(raw)
  const session = w.session
  const again = async (error: string, status: 400 | 429) =>
    page(c, <NewPage token={await formToken(c.env.CSRF_SECRET, session.id)} v={f} error={error} verified={session.verified} />, status)
  try {
    const lobby = whole(f.lobby, 'lobby', DEFAULT_LOBBY)
    if (lobby < MIN_LOBBY) throw bad(`a lobby is at least ${MIN_LOBBY} people`)
    const buildsOn = await buildsOnFromForm(f, new URL(c.req.url).origin)
    const input: CreateNodeInput = {
      kind: 'shwarm',
      title: (f.title ?? '').trim(),
      what: (f.what ?? '').trim(),
      doneWhen: (f.done_when ?? '').trim(),
      check: checkFromForm(f),
      tags: parseTagField(f.tags),
      lobby,
      license: buildsOn ? undefined : f.license,
      buildsOn,
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
      return again(`that's 3 new shwarms and branches today, the most for one person. you can start another in ${waitText(wait)}.`, 429)
    }
    return again(e.message.replace(/\.?$/, '.'), 400)
  }
})
