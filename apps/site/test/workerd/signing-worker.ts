// A Worker that runs @shwarm/protocol's signing in workerd itself (go-live 7.1), so the Worker side is held to
// the same vectors as the CLI side. test/signing.test.ts bundles it with esbuild and starts it in Miniflare.
//   GET /vectors   → { fails: [...], runtime } from checkSignatureVectors(); no fails means both vectors matched
//   any other call → verifies the request's signature against the shwarm vector key or env.TEST_PUBLIC_KEY,
//                    with the clock at the x-test-now header when sent; 200 with what was read, or the 401 body
import { ShwarmError, fromBase64url, messageOf, verifyRequest } from '@shwarm/protocol'
import { checkSignatureVectors, SHWARM_V0 } from '@shwarm/protocol/vectors'

type Env = { TEST_KEYID: string; TEST_PUBLIC_KEY: string }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/vectors') return Response.json({ fails: await checkSignatureVectors(), runtime: navigator.userAgent })
    const now = req.headers.get('x-test-now')
    const keys: Record<string, string> = { [SHWARM_V0.key.keyid]: SHWARM_V0.key.public, [env.TEST_KEYID]: env.TEST_PUBLIC_KEY }
    try {
      const read = await verifyRequest(await messageOf(req), id => (keys[id] ? fromBase64url(keys[id]) : null), {
        now: now ? Number(now) : undefined,
      })
      return Response.json({ keyid: read.keyid, nonce: read.nonce, base: read.base, body: await req.text() })
    } catch (e) {
      if (e instanceof ShwarmError) return Response.json(e.toJSON(), { status: e.status })
      throw e
    }
  },
}
