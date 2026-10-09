// Signed requests (go-live 7.1; protocol §10; table B, A17): RFC 9421 HTTP message signatures with Ed25519,
// over an RFC 9530 Content-Digest of the body. Two layers. The generic one builds the signature base and
// signs or verifies any covered components, which is what the RFC's own Ed25519 test vector exercises.
// The shwarm profile on top says what every request must carry, and how the server reads it:
//   covers  @method @authority @path @query content-digest (+ idempotency-key when sent)
//   params  created, nonce, keyid, alg="ed25519", tag="shwarm" (expires allowed)
//   created from 300 s in the past to 60 s in the future.
// Key lookup, revocation, the nonce replay cache and idempotency are the request pipeline's (7.3), not this file's.
import { sha256, toBase64, toBase64url, fromBase64url, utf8 } from './bytes'
import { ShwarmError } from './errors'
import { KEYID_RE } from './secret'
import {
  type BareItem,
  type Dictionary,
  type InnerList,
  isInnerList,
  parseDictionary,
  serializeBare,
  serializeInnerList,
} from './sfv'

export type HttpMessage = {
  method: string
  /** The full target URI: https://shwarm.org/w/minecraft-in-doom?x=1 */
  url: string
  headers: Headers | Record<string, string>
  body?: Uint8Array | string | null
}

const buf = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>
const bodyBytes = (b: HttpMessage['body']) => (b == null ? new Uint8Array() : typeof b === 'string' ? utf8(b) : b)

/** Lowercase name → value, with repeated fields joined by ", " as RFC 9421 §2.1 says. */
function headerMap(h: HttpMessage['headers']): Map<string, string> {
  const m = new Map<string, string>()
  const add = (k: string, v: string) => {
    const name = k.toLowerCase()
    const prev = m.get(name)
    m.set(name, prev === undefined ? v.trim() : `${prev}, ${v.trim()}`)
  }
  if (typeof (h as Headers).forEach === 'function' && typeof (h as Headers).get === 'function')
    (h as Headers).forEach((v, k) => add(k, v))
  else for (const [k, v] of Object.entries(h)) add(k, v)
  return m
}

// ---- the generic layer: RFC 9421 §2 and §3 ----

/** The value of one covered component (RFC 9421 §2.1, §2.2). Only the components shwarm and the RFC's vector use. */
function componentValue(msg: HttpMessage, url: URL, headers: Map<string, string>, name: string): string {
  switch (name) {
    // fetch uppercases the common methods on the way out, so both sides do the same.
    case '@method':
      return msg.method.toUpperCase()
    case '@authority':
      return url.host // lowercased, default port dropped (WHATWG URL)
    case '@scheme':
      return url.protocol.slice(0, -1)
    case '@target-uri':
      return url.href
    case '@request-target':
      return url.pathname + url.search
    case '@path':
      return url.pathname || '/'
    case '@query':
      return url.search || '?'
  }
  if (name.startsWith('@')) throw new TypeError(`unsupported component ${name}`)
  if (name !== name.toLowerCase()) throw new TypeError(`component names are lowercase: ${name}`)
  const v = headers.get(name)
  if (v === undefined) throw new TypeError(`${name} is covered but not sent`)
  if (/[\r\n]/.test(v)) throw new TypeError(`${name} has a line break`)
  return v
}

/** The signature base (RFC 9421 §2.5): one line per covered component, then "@signature-params". */
export function signatureBase(msg: HttpMessage, input: InnerList): string {
  const url = new URL(msg.url)
  const headers = headerMap(msg.headers)
  const seen = new Set<string>()
  const lines: string[] = []
  for (const it of input.items) {
    if (typeof it.value !== 'string') throw new TypeError('components are strings')
    if (it.params.size) throw new TypeError(`unsupported component parameter on ${it.value}`)
    if (seen.has(it.value)) throw new TypeError(`${it.value} is covered twice`)
    seen.add(it.value)
    lines.push(`"${it.value}": ${componentValue(msg, url, headers, it.value)}`)
  }
  lines.push(`"@signature-params": ${serializeInnerList(input)}`)
  return lines.join('\n')
}

export const inputList = (components: readonly string[], params: Record<string, number | string>): InnerList => ({
  items: components.map(c => ({ value: c, params: new Map() })),
  params: new Map<string, BareItem>(Object.entries(params)),
})

// ---- Ed25519 through WebCrypto (Workers, Node 22+, browsers) ----

// A PKCS #8 wrapper for a raw 32-byte Ed25519 seed (RFC 8410): WebCrypto imports private keys only this way or as JWK.
const PKCS8_ED25519 = Uint8Array.of(0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20)
const ED25519 = { name: 'Ed25519' }

function privateKey(seed: Uint8Array, extractable = false): Promise<CryptoKey> {
  if (seed.length !== 32) throw new TypeError('seed must be 32 bytes')
  const der = new Uint8Array(48)
  der.set(PKCS8_ED25519)
  der.set(seed, 16)
  return crypto.subtle.importKey('pkcs8', buf(der), ED25519, extractable, ['sign'])
}

/** A fresh 32-byte private seed. Only its public half ever reaches the server. */
export const newSeed = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32))

export async function publicKeyFromSeed(seed: Uint8Array): Promise<Uint8Array> {
  const jwk = (await crypto.subtle.exportKey('jwk', await privateKey(seed, true))) as JsonWebKey
  return fromBase64url(jwk.x!)
}

export async function ed25519Sign(seed: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign(ED25519, await privateKey(seed), buf(data)))
}

export async function ed25519Verify(publicKey: Uint8Array, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false
  try {
    const key = await crypto.subtle.importKey('raw', buf(publicKey), ED25519, false, ['verify'])
    return await crypto.subtle.verify(ED25519, key, buf(signature), buf(data))
  } catch {
    return false
  }
}

export type SignatureHeaders = { 'signature-input': string; signature: string }

/** Signs any set of components under one label. The shwarm profile is signRequest below. */
export async function signMessage(
  msg: HttpMessage,
  o: { label: string; components: readonly string[]; params: Record<string, number | string>; seed: Uint8Array },
): Promise<SignatureHeaders> {
  if (!/^[a-z*][a-z0-9_\-.*]*$/.test(o.label)) throw new TypeError('bad signature label')
  const input = inputList(o.components, o.params)
  const sig = await ed25519Sign(o.seed, utf8(signatureBase(msg, input)))
  return { 'signature-input': `${o.label}=${serializeInnerList(input)}`, signature: `${o.label}=${serializeBare(sig)}` }
}

/** Verifies the signature under one label, with no profile rules. False on anything malformed. */
export async function verifyMessage(msg: HttpMessage, label: string, publicKey: Uint8Array): Promise<boolean> {
  try {
    const h = headerMap(msg.headers)
    const input = parseDictionary(h.get('signature-input') ?? '').get(label)
    const sig = parseDictionary(h.get('signature') ?? '').get(label)
    if (!input || !isInnerList(input) || !sig || isInnerList(sig) || !(sig.value instanceof Uint8Array)) return false
    return await ed25519Verify(publicKey, sig.value, utf8(signatureBase(msg, input)))
  } catch {
    return false
  }
}

// ---- Content-Digest (RFC 9530) ----

/** sha-256=:<base64>: over the body as sent. A request with no body digests the empty string. */
export async function contentDigest(body: HttpMessage['body']): Promise<string> {
  return `sha-256=:${toBase64(await sha256(bodyBytes(body)))}:`
}

/** Needs a matching sha-256; a sha-512 alongside it must match too; other algorithms are ignored. */
export async function contentDigestMatches(field: string | null | undefined, body: HttpMessage['body']): Promise<boolean> {
  let d: Dictionary
  try {
    d = parseDictionary(field ?? '')
  } catch {
    return false
  }
  const bytes = bodyBytes(body)
  const want = { 'sha-256': 'SHA-256', 'sha-512': 'SHA-512' } as const
  if (!d.has('sha-256')) return false
  for (const [alg, name] of Object.entries(want)) {
    const m = d.get(alg)
    if (m === undefined) continue
    if (isInnerList(m) || !(m.value instanceof Uint8Array)) return false
    const got = new Uint8Array(await crypto.subtle.digest(name, buf(bytes)))
    if (toBase64(got) !== toBase64(m.value)) return false
  }
  return true
}

// ---- the shwarm profile ----

export const SIGNATURE_LABEL = 'sig1'
export const SIGNATURE_TAG = 'shwarm'
export const SIGNATURE_ALG = 'ed25519'
export const SIGNED_COMPONENTS = ['@method', '@authority', '@path', '@query', 'content-digest'] as const
/** created is accepted from this many seconds in the past … */
export const CREATED_MAX_AGE = 300
/** … to this many in the future. */
export const CREATED_MAX_AHEAD = 60
// OPEN (#87): the nonce's form, the extra parameters allowed and the empty-body digest aren't in table B.
const NONCE_RE = /^[\x21-\x7e]{8,128}$/
const PARAMS = new Set(['created', 'nonce', 'keyid', 'alg', 'tag', 'expires'])

/** The components a request signs: idempotency-key joins them whenever the header is sent. */
const componentsFor = (headers: Map<string, string>): string[] => [
  ...SIGNED_COMPONENTS,
  ...(headers.has('idempotency-key') ? ['idempotency-key'] : []),
]

export type SignedRequestHeaders = SignatureHeaders & { 'content-digest': string }

/**
 * Signs a request with an agent key (the seed from its shwarm_sk_ secret). Returns the three headers to add;
 * any Content-Digest already in msg.headers is replaced by one computed from the body.
 * created and nonce default to now and 16 random bytes; pass them only for test vectors.
 */
export async function signRequest(
  msg: HttpMessage,
  key: { keyid: string; seed: Uint8Array },
  at: { created?: number; nonce?: string } = {},
): Promise<SignedRequestHeaders> {
  if (!KEYID_RE.test(key.keyid)) throw new TypeError('bad keyid')
  const nonce = at.nonce ?? toBase64url(crypto.getRandomValues(new Uint8Array(16)))
  if (!NONCE_RE.test(nonce)) throw new TypeError('bad nonce')
  const digest = await contentDigest(msg.body)
  const headers = headerMap(msg.headers)
  headers.set('content-digest', digest)
  const signed = await signMessage(
    { ...msg, headers: Object.fromEntries(headers) },
    {
      label: SIGNATURE_LABEL,
      components: componentsFor(headers),
      params: {
        created: at.created ?? Math.floor(Date.now() / 1000),
        nonce,
        keyid: key.keyid,
        alg: SIGNATURE_ALG,
        tag: SIGNATURE_TAG,
      },
      seed: key.seed,
    },
  )
  return { 'content-digest': digest, ...signed }
}

/** Why a signature was refused; sent as `reason` in the 401 bad_signature body. */
export type SignatureFailure =
  | 'missing'
  | 'malformed'
  | 'components'
  | 'clock_skew'
  | 'expired'
  | 'content_digest'
  | 'unknown_key'
  | 'invalid'

function refuse(reason: SignatureFailure, message: string, extra: Record<string, unknown> = {}): never {
  throw new ShwarmError('bad_signature', message, { reason, ...extra })
}

export type ReadSignature = {
  label: string
  keyid: string
  created: number
  nonce: string
  expires?: number
  components: string[]
  /** The exact signature base the signature must verify over. */
  base: string
  signature: Uint8Array
}

/**
 * Reads and checks everything about a request's signature that doesn't need the key: the tag="shwarm" entry,
 * its parameters and covered components, freshness, and the Content-Digest against the body. Throws
 * ShwarmError bad_signature with a `reason` (clock_skew adds `server_time`). Then look up `keyid` and call
 * checkSignature.
 */
export async function readSignature(msg: HttpMessage, opts: { now?: number } = {}): Promise<ReadSignature> {
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const h = headerMap(msg.headers)
  const inputField = h.get('signature-input')
  const sigField = h.get('signature')
  if (!inputField || !sigField) refuse('missing', 'this call needs a signed request')
  let inputs: Dictionary
  let sigs: Dictionary
  try {
    inputs = parseDictionary(inputField)
    sigs = parseDictionary(sigField)
  } catch {
    return refuse('malformed', "the signature headers aren't valid structured fields")
  }
  const ours = [...inputs].filter(([, m]) => isInnerList(m) && m.params.get('tag') === SIGNATURE_TAG)
  if (!ours.length) refuse('missing', 'no signature with tag="shwarm"')
  if (ours.length > 1) refuse('malformed', 'more than one signature with tag="shwarm"')
  const [label, input] = ours[0] as [string, InnerList]
  const sig = sigs.get(label)
  if (!sig || isInnerList(sig) || !(sig.value instanceof Uint8Array) || sig.value.length !== 64)
    refuse('malformed', `no 64-byte ed25519 signature under ${label}`)

  const p = input.params
  for (const k of p.keys()) if (!PARAMS.has(k)) refuse('malformed', `unknown signature parameter ${k}`)
  const created = p.get('created')
  const nonce = p.get('nonce')
  const keyid = p.get('keyid')
  const expires = p.get('expires')
  if (typeof created !== 'number') refuse('malformed', 'created must be a whole number of seconds')
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) refuse('malformed', 'nonce must be 8 to 128 characters')
  if (typeof keyid !== 'string' || !KEYID_RE.test(keyid)) refuse('malformed', 'keyid is malformed')
  if (p.get('alg') !== SIGNATURE_ALG) refuse('malformed', 'alg must be "ed25519"')
  if (expires !== undefined && typeof expires !== 'number') refuse('malformed', 'expires must be a whole number of seconds')

  const components: string[] = []
  for (const it of input.items) {
    if (typeof it.value !== 'string' || it.params.size) refuse('components', 'covered components are plain names')
    components.push(it.value)
  }
  const missing = componentsFor(h).filter(c => !components.includes(c))
  if (missing.length) refuse('components', `the signature must cover ${missing.join(' ')}`)

  if (created < now - CREATED_MAX_AGE || created > now + CREATED_MAX_AHEAD)
    refuse('clock_skew', `created must be within ${CREATED_MAX_AGE} s before and ${CREATED_MAX_AHEAD} s after the server's clock`, {
      server_time: new Date(now * 1000).toISOString(),
    })
  if (expires !== undefined && expires < now) refuse('expired', 'the signature has expired')
  if (!(await contentDigestMatches(h.get('content-digest'), msg.body)))
    refuse('content_digest', "content-digest doesn't match the body")

  let base: string
  try {
    base = signatureBase(msg, input)
  } catch (e) {
    return refuse('components', (e as Error).message)
  }
  return {
    label,
    keyid,
    created,
    nonce,
    ...(expires === undefined ? {} : { expires }),
    components,
    base,
    signature: sig.value as Uint8Array,
  }
}

/** Verifies a read signature with the key's public half (32 raw bytes). Throws bad_signature, reason invalid. */
export async function checkSignature(read: ReadSignature, publicKey: Uint8Array): Promise<void> {
  if (!(await ed25519Verify(publicKey, read.signature, utf8(read.base))))
    refuse('invalid', "the signature doesn't verify")
}

/** readSignature, the key lookup, then checkSignature. Returns what was read; throws bad_signature. */
export async function verifyRequest(
  msg: HttpMessage,
  publicKeyFor: (keyid: string) => Promise<Uint8Array | null> | Uint8Array | null,
  opts: { now?: number } = {},
): Promise<ReadSignature> {
  const read = await readSignature(msg, opts)
  const key = await publicKeyFor(read.keyid)
  if (!key) refuse('unknown_key', 'no such key')
  await checkSignature(read, key)
  return read
}

/** A fetch Request as an HttpMessage. Reads the body from a clone, so the request can still be read. */
export async function messageOf(req: Request): Promise<HttpMessage> {
  const body = req.body ? new Uint8Array(await req.clone().arrayBuffer()) : null
  return { method: req.method, url: req.url, headers: req.headers, body }
}
