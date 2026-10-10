// A pretend browser for e2e tests: keeps cookies, sends same-origin headers on POST, finds form tokens.
// Also a fake fetch for Turnstile and Have I Been Pwned.
import { toBase64url } from '@shwarm/protocol'
import app from '../src/index'
import { testDb } from './d1'
import { treeNamespace } from './tree'

export const ORIGIN = 'https://shwarm.org'
export const pepper = toBase64url(new Uint8Array(32).fill(7))

export function testEnv(db = testDb()) {
  return { DB: db, TREE: treeNamespace(db).ns, ENV: 'test', SITE_MODE: 'holding', PASSWORD_PEPPER: pepper, CSRF_SECRET: 'csrf-secret-for-tests', TURNSTILE_SECRET: 'ts-secret', TURNSTILE_SITE_KEY: 'ts-site' }
}
export type TestEnv = ReturnType<typeof testEnv>

type Fetcher = { fetch: (req: Request, env?: any, ctx?: any) => Response | Promise<Response> }

export class Browser {
  jar = new Map<string, string>()
  /** Set to give requests an ExecutionContext; work passed to waitUntil collects in `pending`. */
  ctx?: { waitUntil(p: Promise<unknown>): void; passThroughOnException(): void; pending: Promise<unknown>[] }
  constructor(public env: TestEnv, public ip = '203.0.113.9', public site: Fetcher = app) {}

  /** Requests from now on get an ExecutionContext, as on Workers. */
  withContext(): this {
    const pending: Promise<unknown>[] = []
    this.ctx = { pending, waitUntil: p => void pending.push(p), passThroughOnException() {} }
    return this
  }

  async req(path: string, init: { method?: string; form?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<Response> {
    const method = init.method ?? (init.form ? 'POST' : 'GET')
    const headers: Record<string, string> = { 'cf-connecting-ip': this.ip, 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0' }
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ')
    if (method === 'POST') headers.origin = ORIGIN
    if (init.form) headers['content-type'] = 'application/x-www-form-urlencoded'
    Object.assign(headers, init.headers)
    const body = init.form ? new URLSearchParams(init.form).toString() : undefined
    const res = await this.site.fetch(new Request(ORIGIN + path, { method, headers, body }), this.env, this.ctx)
    for (const sc of (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie()) {
      const [pair, ...attrs] = sc.split(';')
      const i = pair.indexOf('=')
      const name = pair.slice(0, i).trim()
      if (attrs.some((a: string) => a.trim().toLowerCase() === 'max-age=0')) this.jar.delete(name)
      else this.jar.set(name, pair.slice(i + 1).trim())
    }
    return res
  }

  get(path: string) {
    return this.req(path)
  }

  /** The form token this browser gets right now (from the sign-in page). */
  async token(): Promise<string> {
    return formTokenIn(await (await this.get('/signin')).text())
  }

  /** POST a form with a fresh form token and a passing Turnstile answer, unless the fields say otherwise. */
  async post(path: string, fields: Record<string, string> = {}): Promise<Response> {
    const form = { form_token: await this.token(), 'cf-turnstile-response': 'pass', ...fields }
    return this.req(path, { form })
  }
}

/** The page text with HTML entities decoded, for matching copy. */
export async function body(res: Response): Promise<string> {
  return (await res.text()).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

export function formTokenIn(html: string): string {
  const m = /name="form_token" value="([^"]+)"/.exec(html)
  if (!m) throw new Error('no form token on the page')
  return m[1]
}

/** Element ids that appear more than once on the page (a label's `for` would point at the first): [] when none do. */
export const repeatedIds = (html: string) => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
}

/** Strips per-browser values (form tokens) so two pages can be compared. */
export const sameShape = (html: string) => html.replace(/name="form_token" value="[^"]+"/g, 'name="form_token" value=""')

async function sha1Hex(s: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/** Turnstile passes unless the answer is "fail"; HIBP knows the passwords in `pwned`. Records the URLs asked. */
export function fakeFetch(pwned: string[] = []) {
  const calls: string[] = []
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    if (url.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
      const body = init?.body as FormData
      const ok = body.get('secret') === 'ts-secret' && body.get('response') !== 'fail'
      return Response.json({ success: ok })
    }
    if (url.startsWith('https://api.pwnedpasswords.com/range/')) {
      const prefix = url.slice(-5)
      const lines = ['0018A45C4D1DEF81644B54AB7F969B88D65:0']
      for (const p of pwned) {
        const h = await sha1Hex(p)
        if (h.startsWith(prefix)) lines.push(`${h.slice(5)}:42`)
      }
      return new Response(lines.join('\r\n'))
    }
    if (url.startsWith('https://api.github.com/repos/')) {
      const repo = url.slice('https://api.github.com/repos/'.length)
      const known: Record<string, unknown> = {
        'ZDoom/gzdoom': { full_name: 'ZDoom/gzdoom', html_url: 'https://github.com/ZDoom/gzdoom', license: { spdx_id: 'GPL-3.0' } },
        'someone/no-license': { full_name: 'someone/no-license', html_url: 'https://github.com/someone/no-license', license: null },
      }
      return known[repo] ? Response.json(known[repo]) : new Response('{}', { status: 404 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }
  return Object.assign(fn, { calls })
}

export const GOOD_PASSWORD = 'tall green pines at dusk'

export function joinForm(handle: string, email: string, extra: Record<string, string> = {}) {
  return { handle, display_name: handle, email, password: GOOD_PASSWORD, age: '1', terms: '1', ...extra }
}

export async function setSignup(db: D1Database, mode: 'open' | 'allow_list') {
  await db.prepare("UPDATE setting SET value = ? WHERE key = 'signup'").bind(JSON.stringify(mode)).run()
}

export async function allow(db: D1Database, emailNorm: string) {
  await db.prepare("INSERT INTO signup_allow (email_norm, note, added_at) VALUES (?, 'test', '2026-10-08T00:00:00Z')").bind(emailNorm).run()
}

export type Mail = { to_email: string; template: string; stream: string; payload: string; person_id: number | null }
export const mails = (db: D1Database & { raw: any }): Mail[] => db.raw.prepare('SELECT * FROM email_outbox ORDER BY id').all()

/** The link in the newest mail of a template, as a site path. */
export function linkIn(db: D1Database & { raw: any }, template: string): string {
  const m = mails(db).filter(x => x.template === template).at(-1)
  if (!m) throw new Error(`no ${template} mail`)
  return JSON.parse(m.payload).link.replace(ORIGIN, '')
}
