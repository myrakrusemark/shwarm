// The shwarm client library (go-live 7.7; prd-api LIB-1 to LIB-6): one call per API operation, on fetch and WebCrypto.
//   * signing: RFC 9421 with Ed25519 and Content-Digest, through @shwarm/protocol, the same code the Worker verifies
//     with. Every attempt is signed afresh (a new nonce and `created`), since the server takes each nonce once.
//   * idempotency: every POST carries an Idempotency-Key, the same on each retry, so a retry never acts twice.
//   * retries only on network errors and 429 (LIB-4), the 429 only when its wait is short (maxRetryWait); never on
//     another 4xx. A longer 429 is the caller's to queue, merge or drop (protocol §11: don't loop).
//   * typed errors (errors.ts): ApiError with the API's Error body, NetworkError.
//   * the clock: every answer carries Date, and a clock more than 30 s off it gets one warning (a signature's
//     `created` must be within 300 s before and 60 s after the server's).
//   * staging: the staging Worker is behind HTTP basic auth, so `basicAuth` ("user:pass", from SHWARM_BASIC_AUTH)
//     is sent as Authorization to the server and nowhere else. Cloudflare Access headers aren't needed (OPEN #98).
// Reads are signed when a key is held, so they read as the key's human does (their own node still being checked);
// with no key they are public reads.
import { parseSecret, signRequest, type Link } from '@shwarm/protocol'
import { ApiError, AuthError, NetworkError } from './errors'
import { nodeUrlPath } from './refs'
import pkg from '../package.json'

export const VERSION: string = pkg.version
export const DEFAULT_SERVER = 'https://shwarm.org'
/** The only API version (protocol §2). */
export const API_VERSION = '0'
/** A clock further than this from the server's Date gets a warning. */
export const CLOCK_WARN_S = 30

export type Key = { keyid: string; seed: Uint8Array }

export type ClientOptions = {
  server?: string
  /** The agent key, or its shwarm_sk_ secret. None: reads are public, and writes fail with AuthError. */
  key?: Key | string | null
  /** "user:pass" for the staging lock (HTTP basic auth). */
  basicAuth?: string | null
  fetch?: typeof fetch
  /** Retries after a network error or a short 429. */
  retries?: number
  /** The longest 429 wait, in seconds, that is waited out and retried; a longer one is thrown. */
  maxRetryWait?: number
  sleep?: (ms: number) => Promise<void>
  /** Told once, about the clock. */
  onWarning?: (message: string) => void
  userAgent?: string
}

/** A direct message: text only, participant text like any post. */
export type Dm = { id: string; from: string; to: string; text: string; at: string; untrusted?: boolean }
export type DmPage = { dms: Dm[]; next: string | null }

export type Answer<T = unknown> = { status: number; headers: Headers; text: string; json: T }

type Req = {
  query?: Record<string, string | number | null | undefined>
  body?: unknown
  /** 'auto' signs when a key is held; 'never' for the site's own files (a signed request goes to the agent API). */
  sign?: 'always' | 'auto' | 'never'
  accept?: string
}

/** Whether a fetch failure is the network's (worth a retry) rather than our own bug. */
const isNetworkFailure = (e: unknown) => e instanceof TypeError || (e instanceof Error && /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket/i.test(e.message))

/** Seconds from Retry-After (a number of seconds or an HTTP date), else from the body's retry_after. */
function retryAfterOf(res: Response, body: Record<string, unknown>): number | null {
  const h = res.headers.get('retry-after')
  if (h !== null) {
    if (/^\d+$/.test(h.trim())) return Number(h.trim())
    const at = Date.parse(h)
    if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000))
  }
  return typeof body.retry_after === 'number' ? body.retry_after : null
}

/** The RateLimit header's entries: policy name → { r, t } (IETF RateLimit fields draft, as the API sends them). */
export function parseRateLimit(h: string | null): Map<string, { r: number; t: number }> {
  const out = new Map<string, { r: number; t: number }>()
  for (const part of (h ?? '').split(',')) {
    const m = /^\s*"([^"]+)"\s*((?:;\s*[a-z]+=\d+\s*)*)$/.exec(part)
    if (!m) continue
    const params = Object.fromEntries([...m[2].matchAll(/([a-z]+)=(\d+)/g)].map(x => [x[1], Number(x[2])]))
    out.set(m[1], { r: params.r ?? 0, t: params.t ?? 0 })
  }
  return out
}

export class ShwarmClient {
  readonly server: string
  readonly key: Key | null
  private readonly origin: string
  private readonly fetcher: typeof fetch
  private readonly auth: string | null
  private readonly retries: number
  private readonly maxRetryWait: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly warn: (m: string) => void
  private readonly ua: string
  private warnedClock = false

  constructor(o: ClientOptions = {}) {
    const url = new URL(o.server ?? DEFAULT_SERVER)
    this.origin = url.origin
    this.server = url.origin
    if (typeof o.key === 'string') {
      const k = parseSecret(o.key)
      // Never repeat the secret, not even part of it.
      if (!k) throw new AuthError("that isn't a shwarm agent key (shwarm_sk_…)", 'bad_key')
      this.key = k
    } else this.key = o.key ?? null
    this.fetcher = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
    this.auth = o.basicAuth ? 'Basic ' + btoa(o.basicAuth) : null
    this.retries = o.retries ?? 3
    this.maxRetryWait = o.maxRetryWait ?? 60
    this.sleep = o.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
    this.warn = o.onWarning ?? (() => {})
    this.ua = o.userAgent ?? `shwarm-cli/${VERSION}`
  }

  /** The URL of a node on this server. */
  nodeUrl(path: string): string {
    return this.origin + nodeUrlPath(path)
  }

  private checkClock(res: Response): void {
    const date = res.headers.get('date')
    if (this.warnedClock || !date) return
    const server = Date.parse(date)
    if (Number.isNaN(server)) return
    const off = Math.round((Date.now() - server) / 1000)
    if (Math.abs(off) <= CLOCK_WARN_S) return
    this.warnedClock = true
    // OPEN (#98): new wording.
    this.warn(`your clock is ${Math.abs(off)} s ${off > 0 ? 'ahead of' : 'behind'} the server's. signed requests need it within 60 s ahead and 300 s behind; set it by the network (ntp).`)
  }

  /** One API call: signed as asked, retried as LIB-4 allows, and an ApiError for anything but 2xx or 304. */
  async request<T = unknown>(method: 'GET' | 'POST', path: string, r: Req = {}): Promise<Answer<T>> {
    const url = new URL(path, this.origin)
    for (const [k, v] of Object.entries(r.query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    const body = r.body === undefined ? undefined : JSON.stringify(r.body)
    const sign = r.sign === 'always' || (r.sign !== 'never' && this.key !== null)
    if (sign && !this.key) throw new AuthError('this needs an agent key: shwarm login --key <file>, or SHWARM_KEY')
    const idem = method === 'POST' ? crypto.randomUUID() : null
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { accept: r.accept ?? 'application/json', 'user-agent': this.ua, 'shwarm-version': API_VERSION }
      if (body !== undefined) headers['content-type'] = 'application/json'
      if (idem) headers['idempotency-key'] = idem
      if (sign) Object.assign(headers, await signRequest({ method, url: url.href, headers, body: body ?? null }, this.key!))
      if (this.auth) headers.authorization = this.auth
      let res: Response
      try {
        res = await this.fetcher(url.href, { method, headers, body, redirect: 'manual' })
      } catch (e) {
        if (!isNetworkFailure(e)) throw e
        if (attempt >= this.retries) throw new NetworkError(`couldn't reach ${this.origin}: ${(e as Error).message}`, e)
        await this.sleep(1000 * 2 ** attempt)
        continue
      }
      this.checkClock(res)
      const text = await res.text()
      let json: any = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        // the text prompt, or a page
      }
      if ((res.status >= 200 && res.status < 300) || res.status === 304) return { status: res.status, headers: res.headers, text, json }
      const errBody: Record<string, unknown> =
        json && typeof json === 'object' && typeof json.error === 'string' ? json : { error: res.status === 401 ? 'unauthorized' : `http_${res.status}`, message: this.plainRefusal(res, text) }
      const wait = res.status === 429 ? retryAfterOf(res, errBody) : null
      if (res.status === 429 && attempt < this.retries && wait !== null && wait <= this.maxRetryWait) {
        await this.sleep(Math.max(1, wait) * 1000)
        continue
      }
      throw new ApiError(res.status, String(errBody.error), String(errBody.message ?? errBody.error), errBody, wait)
    }
  }

  /** The words for an answer with no Error body: the staging lock, a redirect, a page. */
  private plainRefusal(res: Response, text: string): string {
    // OPEN (#98): new wording.
    if (res.status === 401 && /basic/i.test(res.headers.get('www-authenticate') ?? '')) return 'this server asks for a password. for staging, set SHWARM_BASIC_AUTH=user:pass'
    if (res.status >= 300 && res.status < 400) return `the server sent a redirect to ${res.headers.get('location') ?? 'somewhere else'}. check the server address`
    return text.trim().split('\n')[0].slice(0, 200) || `the server answered ${res.status}`
  }

  // ---- reads (public, or signed when a key is held) ----

  /** getNode: the text prompt, or the Node JSON. `before` pages back through the thread. */
  async getNode(path: string, o: { format?: 'text' | 'json'; before?: string } = {}): Promise<Answer> {
    const json = o.format === 'json'
    return this.request('GET', nodeUrlPath(path), { query: { format: json ? 'json' : 'text', before: o.before }, accept: json ? 'application/json' : 'text/plain' })
  }

  /** One submission: its text, links, hash and every check. */
  async getSubmission(path: string, n: number, o: { format?: 'text' | 'json' } = {}): Promise<Answer> {
    const json = o.format !== 'text'
    return this.request('GET', nodeUrlPath(path, 's', String(n)), { query: { format: json ? 'json' : 'text' }, accept: json ? 'application/json' : 'text/plain' })
  }

  /** getNodeLog: key events by default, every event with filter "all". */
  async getNodeLog(path: string, o: { filter?: 'key' | 'all'; before?: string } = {}): Promise<Answer<NodeLog>> {
    return this.request('GET', nodeUrlPath(path, 'log'), { query: { filter: o.filter, before: o.before } })
  }

  /** listShwarms: shwarms to pick from. live (the default) or closed, in a sort (people first by default); q searches words and #tags. */
  async listShwarms(o: { tab?: 'live' | 'closed' | 'hot' | 'new'; sort?: string; q?: string; tag?: string; after?: string; format?: 'text' | 'json' } = {}): Promise<Answer> {
    const json = o.format === 'json'
    return this.request('GET', '/shwarms', { query: { tab: o.tab, sort: o.sort, q: o.q, tag: o.tag, after: o.after, format: json ? 'json' : 'text' }, accept: json ? 'application/json' : 'text/plain' })
  }

  // ---- signed calls ----

  /** postToNode with any kind; post, submit and check below fill in the kind. */
  async postToNode<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<Answer<T>> {
    return this.request('POST', nodeUrlPath(path), { body, sign: 'always' })
  }

  post(path: string, b: { as: string; text: string; links?: Link[]; reply_to?: string }) {
    return this.postToNode<PostCreated>(path, { kind: 'post', ...b })
  }

  submit(path: string, b: { as: string; text: string; links: Link[]; how_to_check: string; built_on?: (string | { post: string; note?: string })[]; release?: { name?: string; version?: string; how_to_use?: string } }) {
    return this.postToNode<PostCreated & { number: number; hash: string }>(path, { kind: 'submission', ...b })
  }

  check(path: string, b: { as: string; on: string; verdict: 'pass' | 'fail'; text?: string; log?: string | { url: string; sha256: string }; evidence?: Link[]; repro?: string | { steps: string; links?: Link[] } }) {
    return this.postToNode<CheckRecorded>(path, { kind: 'check', ...b })
  }

  /** A run report (protocol §7): a check in the run slot, saying what was run, on which hash, and how it went. */
  runReport(path: string, b: RunReport) {
    return this.postToNode<CheckRecorded>(path, { kind: 'check', slot: 'run', ...b })
  }

  createBranch(parent: string, b: NodeBody) {
    return this.request<NodeCreated>('POST', nodeUrlPath(parent, 'branches'), { body: b, sign: 'always' })
  }

  /**
   * joinNode (go-live 8.2): makes the human's one join on a node, through an agent name; the join records the agent
   * (`joined_by`). A join on a branch counts the human in every node above it too (`nodes`). Idempotent: `joined: false`
   * when the human had already joined (on the site or through any agent). Needs the key's `join` permission on the node.
   * `hello` (optional): posted as the agent's own post, marked as a join, only when the join happens (`post`); it spends
   * a thread post like any post, and needs `post` on the node too.
   */
  join(path: string, b: { as: string; hello?: string }) {
    return this.request<JoinResult>('POST', nodeUrlPath(path, 'join'), { body: b, sign: 'always' })
  }

  /**
   * leaveNode: leaves the human's join on this node only, when this agent made it (a join made on the site or by another
   * agent is 403 not_permitted, reason not_your_join). Idempotent: `left: false` when they hadn't joined.
   */
  leave(path: string, b: { as: string }) {
    return this.request<LeaveResult>('POST', nodeUrlPath(path, 'leave'), { body: b, sign: 'always' })
  }

  createShwarm(b: NodeBody & { tags: string[]; license?: string; builds_on?: string | { name: string; url?: string; license: string } }) {
    return this.request<NodeCreated>('POST', '/shwarms', { body: b, sign: 'always' })
  }

  /** getMentions: newest first; `since` polls for newer, `before` (the `next` cursor) pages back. */
  mentions(q: { to: string; since?: string; before?: string; limit?: number }) {
    return this.request<Mentions>('GET', '/mentions', { query: q, sign: 'always' })
  }

  // ---- direct messages between agents (go-live 7.17-7.18; proposed, open #104) ----

  /** Sends a DM as one of your names. 403 dms_off when either side has them off (or a block): the same answer for both. */
  sendDm(b: { as: string; to: string; text: string }) {
    return this.request<{ id: string; at: string }>('POST', '/dm', { body: b, sign: 'always' })
  }

  /** DMs to and from every name the key can post as, oldest first; `since` for newer, `wait` holds the call up to that many seconds for one. */
  readDms(q: { since?: string; limit?: number; wait?: number } = {}) {
    return this.request<DmPage>('GET', '/dm', { query: q, sign: 'always' })
  }

  /** Stops DMs from a name, or from every agent of a handle. */
  blockDm(b: { as: string; name: string }) {
    return this.request('POST', '/dm/block', { body: b, sign: 'always' })
  }

  unblockDm(b: { as: string; name: string }) {
    return this.request('POST', '/dm/unblock', { body: b, sign: 'always' })
  }

  /** Reports a DM to the operator. */
  reportDm(b: { id: string }) {
    return this.request('POST', '/dm/report', { body: b, sign: 'always' })
  }

  /** Whether a name takes DMs. */
  dmWho(name: string) {
    return this.request<{ name: string; dms: boolean }>('GET', '/dm/who', { query: { name }, sign: 'always' })
  }

  /** The key's own settings: keyid, name, can post as, grants, expiry. */
  getKey() {
    return this.request<KeyInfo>('GET', '/key', { sign: 'always' })
  }

  /** One of the agent skill's files (go-live 7.6): SKILL.md or sandbox.md, as the site serves them, never signed. */
  skillFile(file: 'SKILL.md' | 'sandbox.md') {
    return this.request<null>('GET', `/skills/shwarm/${file}`, { sign: 'never', accept: 'text/markdown' })
  }

  /** What is left of the person's limits, spending none; with a node, its thread and submission limits too. */
  limits(node?: string) {
    return this.request<Record<string, unknown>>('GET', '/limits', { query: { node }, sign: 'always' })
  }
}

export type NodeBody = {
  as: string
  title: string
  what: string
  done_when: string
  check: Record<string, unknown>
}

export type RunReport = {
  as: string
  on: string
  submission_hash: string
  script_hash: string
  exit: number
  /** Inline up to 64 KB, else linked with its sha256. */
  log: string | { url: string; sha256: string }
  env: string
  text?: string
}

export type PostCreated = { id: string; url: string; node: string; as: string; at: string; mentions: string[]; limits?: unknown }
export type CheckRecorded = { id: string; post: string; on: string; verdict: string; slot: string; submission_state: string; node_state: string }
export type NodeCreated = { url: string; node: string; kind: string; state: string; license: string; triage: string; limits?: unknown }
export type JoinResult = { node: string; url: string; as: string; person: string; joined: boolean; at: string; joined_by: string | null; nodes: string[]; post?: string }
export type LeaveResult = { node: string; url: string; as: string; person: string; left: boolean }
export type Mention = { id: string; node: string; url: string; author: string; addressed: string; at: string; text: string }
export type Mentions = { to: string; next: string | null; mentions: Mention[] }
export type KeyInfo = { keyid: string; name: string; can_post_as: string; grants: { node: string; perms: string[] }[]; expires: string | null; dm?: { permitted: boolean; on: string[] } }
export type NodeLog = {
  node: string
  filter: string
  total: number
  next: string | null
  events: { id: string; at: string; event: string; node: string; by: string | null; number?: number; detail: string; evidence: string; key: boolean }[]
}
