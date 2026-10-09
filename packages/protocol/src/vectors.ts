// The signing test vectors (go-live 7.1): RFC 9421's own Ed25519 example and shwarm's published one.
// Both suites run checkSignatureVectors, the package's in Node and the site's in Node and in workerd,
// so the CLI and the Worker are held to the same bytes. Imported as @shwarm/protocol/vectors, not from the
// package root, so the Worker bundle doesn't carry them.
import rfcJson from '../vectors/rfc9421-b26.json'
import oursJson from '../vectors/shwarm-v0.json'
import { fromBase64url, sha256, toBase64url, utf8 } from './bytes'
import {
  type HttpMessage,
  contentDigest,
  inputList,
  publicKeyFromSeed,
  signatureBase,
  signMessage,
  signRequest,
  verifyMessage,
  verifyRequest,
} from './signature'

type VectorKey = { keyid: string; seed: string; public: string }
type VectorMessage = { method: string; url: string; headers: Record<string, string>; body: string }
export type VectorRequest = VectorMessage & {
  name: string
  created: number
  nonce: string
  content_digest: string
  signature_base: string
  signature_input: string
  signature: string
}

export const RFC9421_B26: {
  key: VectorKey
  request: VectorMessage
  label: string
  components: string[]
  params: Record<string, number | string>
  signature_base: string
  signature_input: string
  signature: string
} = rfcJson
export const SHWARM_V0: { key: VectorKey & { seed_from: string }; requests: VectorRequest[] } = oursJson as any
const rfc = RFC9421_B26
const ours = SHWARM_V0

/** A vector request with its signature headers added, as the server would receive it. */
export const signedVectorRequest = (r: VectorRequest): HttpMessage => ({
  method: r.method,
  url: r.url,
  headers: {
    ...r.headers,
    'content-digest': r.content_digest,
    'signature-input': r.signature_input,
    signature: r.signature,
  },
  body: r.body,
})

/** Runs both vectors, signing and verifying. Returns what failed; an empty list means everything matched. */
export async function checkSignatureVectors(): Promise<string[]> {
  const fails: string[] = []
  const expect = (ok: boolean, what: string) => ok || fails.push(what)

  // RFC 9421 B.2.6
  {
    const seed = fromBase64url(rfc.key.seed)
    const msg: HttpMessage = rfc.request
    expect(toBase64url(await publicKeyFromSeed(seed)) === rfc.key.public, 'rfc: public key from seed')
    expect(signatureBase(msg, inputList(rfc.components, rfc.params)) === rfc.signature_base, 'rfc: signature base')
    const s = await signMessage(msg, { label: rfc.label, components: rfc.components, params: rfc.params, seed })
    expect(s['signature-input'] === rfc.signature_input, 'rfc: signature-input')
    expect(s.signature === rfc.signature, 'rfc: signature')
    const signed = { ...msg, headers: { ...msg.headers, 'signature-input': rfc.signature_input, signature: rfc.signature } }
    const pub = fromBase64url(rfc.key.public)
    expect(await verifyMessage(signed, rfc.label, pub), 'rfc: verifies')
    expect(!(await verifyMessage({ ...signed, method: 'PUT' }, rfc.label, pub)), 'rfc: a changed method fails')
  }

  // shwarm v0
  const seed = fromBase64url(ours.key.seed)
  expect(toBase64url(await sha256(utf8(ours.key.seed_from))) === ours.key.seed, 'shwarm: seed from seed_from')
  expect(toBase64url(await publicKeyFromSeed(seed)) === ours.key.public, 'shwarm: public key from seed')
  for (const r of ours.requests) {
    const msg: HttpMessage = { method: r.method, url: r.url, headers: r.headers, body: r.body }
    expect((await contentDigest(r.body)) === r.content_digest, `shwarm ${r.name}: content-digest`)
    const h = await signRequest(msg, { keyid: ours.key.keyid, seed }, { created: r.created, nonce: r.nonce })
    expect(h['content-digest'] === r.content_digest, `shwarm ${r.name}: signed content-digest`)
    expect(h['signature-input'] === r.signature_input, `shwarm ${r.name}: signature-input`)
    expect(h.signature === r.signature, `shwarm ${r.name}: signature`)
    try {
      const read = await verifyRequest(
        signedVectorRequest(r),
        id => (id === ours.key.keyid ? fromBase64url(ours.key.public) : null),
        { now: r.created },
      )
      expect(read.base === r.signature_base, `shwarm ${r.name}: signature base`)
      expect(read.nonce === r.nonce && read.keyid === ours.key.keyid, `shwarm ${r.name}: nonce and keyid`)
    } catch (e) {
      fails.push(`shwarm ${r.name}: verify threw ${(e as Error).message}`)
    }
  }
  return fails
}
