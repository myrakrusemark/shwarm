// Go-live 7.9: the api page's Python signing example (packages/protocol/examples/sign.py) makes the published test
// vector's signatures exactly, and the page shows the file unchanged. The Python half runs only where python3 and its
// `cryptography` package are installed; the page check runs everywhere.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SHWARM_V0 } from '@shwarm/protocol/vectors'

const EXAMPLE = fileURLToPath(new URL('../../../packages/protocol/examples/sign.py', import.meta.url))
const DIR = fileURLToPath(new URL('../../../packages/protocol/examples/', import.meta.url))

/** python3 with `cryptography`, or null when this machine has none. */
const PYTHON = (() => {
  try {
    execFileSync('python3', ['-c', 'import cryptography'], { stdio: 'ignore' })
    return 'python3'
  } catch {
    return null
  }
})()

const py = (args: string[], input?: string) => execFileSync(PYTHON!, args, { cwd: DIR, input, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })

describe.skipIf(!PYTHON)('the python signing example', () => {
  it('prints the signature of the vector GET, run as it is', () => {
    expect(py([EXAMPLE]).trim()).toBe(SHWARM_V0.requests[1].signature)
  })

  it('makes every vector request’s three headers exactly, the POST with its idempotency key too', () => {
    const run = `
import json, sys, sign
v = json.load(sys.stdin)
seed = sign.base64.urlsafe_b64decode(v["key"]["seed"] + "=")
print(json.dumps([sign.sign(r["method"], r["url"], r["headers"], r["body"].encode(), v["key"]["keyid"], seed, created=r["created"], nonce=r["nonce"]) for r in v["requests"]]))
`
    const got = JSON.parse(py(['-c', run], JSON.stringify(SHWARM_V0)))
    expect(got).toEqual(SHWARM_V0.requests.map(r => ({ 'content-digest': r.content_digest, 'signature-input': r.signature_input, signature: r.signature })))
  })

  it('reads a secret as the keys page shows it', () => {
    const out = py(['-c', 'import sign; k, s = sign.parse_secret(" shwarm_sk_test-key-shwarm_9bi1LJR2XzrRLsFiqB8eBJh5jALoKcjOEW3Ywv_6GbY\\n"); print(k, sign.base64.urlsafe_b64encode(s).decode())'])
    expect(out.trim()).toBe(`test-key-shwarm ${SHWARM_V0.key.seed}=`)
  })
})

describe('the api page', () => {
  it('shows the example as the file has it', () => {
    const pages = JSON.parse(readFileSync(new URL('../src/content/pages.json', import.meta.url), 'utf8')) as { slug: string; sections: { id: string; body: string }[] }[]
    const body = pages.find(p => p.slug === 'api')!.sections.find(s => s.id === 'sign')!.body
    const shown = /<pre class="code">([\s\S]*?)<\/pre>/.exec(body)![1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    expect(shown).toBe(readFileSync(EXAMPLE, 'utf8').replace(/\n+$/, ''))
  })
})
