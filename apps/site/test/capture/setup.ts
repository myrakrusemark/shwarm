// The word-list move (go-live 11.8) must not change a single byte people see. With CAPTURE_DIR set, every string
// body the app answers with and every mail it renders during the unit run is written to CAPTURE_DIR, one JSON file
// per test file, keyed by test name. Run it before and after, then compare with test/capture/compare.mjs.
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { afterAll, expect, vi } from 'vitest'

const dir = process.env.CAPTURE_DIR!
const out: Record<string, string[]> = {}
const record = (s: string) => {
  const name = expect.getState().currentTestName ?? '(outside a test)'
  ;(out[name] ??= []).push(s)
}

const Orig = globalThis.Response
class Captured extends Orig {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init)
    if (typeof body === 'string' || body instanceof String) record(String(body))
  }
}
globalThis.Response = Captured as typeof Response

vi.mock('../../src/email/templates', async orig => {
  const m = (await orig()) as typeof import('../../src/email/templates')
  return {
    ...m,
    renderMail: (...a: Parameters<typeof m.renderMail>) => {
      const r = m.renderMail(...a)
      record(`MAIL ${a[0]}\n${r.subject}\n---\n${r.text}\n---\n${r.html}`)
      return r
    },
  }
})

afterAll(() => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/${basename(expect.getState().testPath ?? 'unknown')}.json`, JSON.stringify(out, null, 1))
})
