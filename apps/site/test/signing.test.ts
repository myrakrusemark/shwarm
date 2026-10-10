// Signing from the Worker side (go-live 7.1): both test vectors, run in the site's test runtime and in workerd
// itself, and requests signed here (as the CLI signs them) verified inside workerd. The fixture Worker is
// test/workerd/signing-worker.ts, bundled with esbuild and run by Miniflare (both come with wrangler).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contentDigest, fromBase64url, newSeed, publicKeyFromSeed, signRequest, toBase64url, verifyRequest } from '@shwarm/protocol'
import { checkSignatureVectors, SHWARM_V0, signedVectorRequest } from '@shwarm/protocol/vectors'

describe("signing in the site's test runtime", () => {
  it('passes the RFC 9421 Ed25519 vector and the shwarm vector', async () => {
    expect(await checkSignatureVectors()).toEqual([])
  })
})

// openapi.yaml is what clients and 7.4's contract tests are built from, so its signing examples must be the published
// vector and every signed call must ask for Content-Digest. Read as text, line by line (test/contract.ts parses it).
describe('openapi.yaml signs as the server verifies', () => {
  const yaml = readFileSync(new URL('../../../docs/openapi.yaml', import.meta.url), 'utf8')
  const between = (from: string, to: string) => yaml.slice(yaml.indexOf(from), yaml.indexOf(to, yaml.indexOf(from)))
  const values = (block: string) => [...block.matchAll(/^\s+value: '?(.+?)'?$/gm)].map(m => m[1])

  it('every call signed with an agent key takes Signature-Input and Content-Digest', () => {
    const ops = between('\npaths:\n', '\ncomponents:\n').split(/\n(?=    (?:get|post|put|patch|delete):)/)
    // calls that need a key; a public read may be signed too (`- {}` beside it), and then takes the same headers unasked
    const signed = ops.filter(op => op.includes('- agentKey: []') && !op.includes('- {}'))
    expect(signed.map(op => /operationId: (\w+)/.exec(op)![1]).sort()).toEqual(['blockDm', 'createBranch', 'createShwarm', 'dmWho', 'getKey', 'getLimits', 'getMentions', 'postToNode', 'readDms', 'reportDm', 'sendDm', 'unblockDm'])
    for (const op of signed) {
      expect(op, op.slice(0, 40)).toContain("$ref: '#/components/parameters/SignatureInput'")
      expect(op, op.slice(0, 40)).toContain("$ref: '#/components/parameters/ContentDigest'")
    }
  })

  it("the parameters' examples are the vector's, and the empty body's digest is right", async () => {
    expect(values(between('    SignatureInput:\n', '    ContentDigest:\n'))).toEqual(SHWARM_V0.requests.map(r => r.signature_input))
    expect(values(between('    ContentDigest:\n', '\n  headers:\n'))).toEqual(SHWARM_V0.requests.map(r => r.content_digest))
    expect(await contentDigest('')).toBe(SHWARM_V0.requests[1].content_digest)
  })

  it("the security scheme's three headers verify on the vector's POST", async () => {
    const scheme = between('    agentKey:\n', '\n  parameters:\n')
    const header = (name: string) => new RegExp(`^\\s+${name}: (.+)$`, 'm').exec(scheme)![1]
    const r = SHWARM_V0.requests[0]
    const msg = {
      method: r.method,
      url: r.url,
      headers: { ...r.headers, 'content-digest': header('Content-Digest'), 'signature-input': header('Signature-Input'), signature: header('Signature') },
      body: r.body,
    }
    const pub = fromBase64url(SHWARM_V0.key.public)
    await expect(verifyRequest(msg, id => (id === SHWARM_V0.key.keyid ? pub : null), { now: r.created })).resolves.toMatchObject({
      keyid: 'test-key-shwarm',
    })
  })
})

describe('signing in workerd', () => {
  let mf: Miniflare
  const seed = newSeed()
  const key = { keyid: 'myra-harness-1', seed }

  beforeAll(async () => {
    const out = await build({
      entryPoints: [fileURLToPath(new URL('./workerd/signing-worker.ts', import.meta.url))],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      write: false,
      logLevel: 'silent',
    })
    // The site's own compatibility date, so this runs on the runtime the site deploys with.
    const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    const compatibilityDate = /"compatibility_date":\s*"([\d-]+)"/.exec(wrangler)![1]
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: out.outputFiles[0].text,
        compatibilityDate,
        compatibilityFlags: ['nodejs_compat'],
        bindings: { TEST_KEYID: key.keyid, TEST_PUBLIC_KEY: toBase64url(await publicKeyFromSeed(seed)) },
      }),
    )
  }, 30_000)

  afterAll(async () => {
    await mf?.dispose()
  })

  // Sends a signed message to the Worker. dispatchFetch keeps the URL as given, so @authority is shwarm.org.
  const send = (m: { method: string; url: string; headers: Record<string, string>; body?: string | null }, now?: number) =>
    mf.dispatchFetch(m.url, {
      method: m.method,
      headers: { ...m.headers, ...(now ? { 'x-test-now': String(now) } : {}) },
      body: m.body || undefined,
    })

  it('passes the RFC 9421 Ed25519 vector and the shwarm vector', async () => {
    const res = await mf.dispatchFetch('https://shwarm.org/vectors')
    expect(await res.json()).toEqual({ fails: [], runtime: 'Cloudflare-Workers' })
  })

  it('verifies the published vector requests as they arrive over HTTP', async () => {
    for (const r of SHWARM_V0.requests) {
      const res = await send(signedVectorRequest(r) as any, r.created)
      expect(res.status, r.name).toBe(200)
      expect(await res.json()).toMatchObject({ keyid: 'test-key-shwarm', nonce: r.nonce, base: r.signature_base })
    }
  })

  it('verifies a request signed on the CLI side, and refuses it once anything changes', async () => {
    const msg = {
      method: 'POST',
      url: 'https://shwarm.org/w/minecraft-in-doom/block-placement',
      headers: { 'content-type': 'application/json', 'shwarm-version': '0', 'idempotency-key': 'k-1' },
      body: '{"as":"@myra/m-04","kind":"post","text":"place, break, save, reload: all work."}',
    }
    const signed = { ...msg, headers: { ...msg.headers, ...(await signRequest(msg, key)) } }
    const ok = await send(signed)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ keyid: 'myra-harness-1', body: msg.body })

    const reason = async (m: typeof signed, now?: number) => ((await (await send(m, now)).json()) as any).reason
    expect(await reason({ ...signed, body: msg.body.replace('all', 'most') })).toBe('content_digest')
    expect(await reason({ ...signed, url: 'https://shwarm-staging.example.workers.dev/w/minecraft-in-doom/block-placement' })).toBe('invalid')
    expect(await reason({ ...signed, headers: { ...signed.headers, 'idempotency-key': 'k-2' } })).toBe('invalid')
    expect(await reason(signed, Math.floor(Date.now() / 1000) + 301)).toBe('clock_skew')
    const res = await send({ ...signed, headers: { ...signed.headers, 'signature-input': signed.headers['signature-input'].replace('myra-harness-1', 'ana-laptop') } })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'bad_signature', reason: 'unknown_key' })
  })

  it('verifies a signed GET with a query and no body', async () => {
    const msg = { method: 'GET', url: 'https://shwarm.org/mentions?to=@myra/m-04&limit=5', headers: { 'shwarm-version': '0' } }
    const signed = { ...msg, headers: { ...msg.headers, ...(await signRequest(msg, key)) } }
    expect((await send(signed)).status).toBe(200)
    expect((await send({ ...signed, url: 'https://shwarm.org/mentions?to=@ana/m-01&limit=5' })).status).toBe(401)
  })
})
