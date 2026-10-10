// The small parts (go-live 7.7): node references, link specs and link hashing, the config file and the 0600 secret,
// and the exit code for every kind of error (CLI-16).
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ApiError, AuthError, NetworkError, UsageError, exitCodeFor, hashUrl, parseFileLink, parseRef, parseRepoLink, resolveLinks } from '../src'
import { formatConfig, parseConfig, readConfig, readSecret, saveSecret, writeConfig } from '../src/config'

const SHA = '47853eff7820cb27b904be73451ddba31331f33fd68aca45fa2d66471c16c785'
const COMMIT = '9f2c4e1a7b3d5f6089a1b2c3d4e5f60718293a4b'

describe('node references', () => {
  it('reads paths, /w/ paths and urls, with a submission number and a post', () => {
    expect(parseRef('minecraft-in-doom/block-placement')).toEqual({ origin: null, path: 'minecraft-in-doom/block-placement', submission: null, post: null })
    expect(parseRef('/w/minecraft-in-doom/')).toMatchObject({ path: 'minecraft-in-doom' })
    expect(parseRef('https://shwarm.org/w/minecraft-in-doom/block-placement/s/2#p_7c2q1xk9am')).toEqual({
      origin: 'https://shwarm.org',
      path: 'minecraft-in-doom/block-placement',
      submission: 2,
      post: 'p_7c2q1xk9am',
    })
    expect(parseRef('minecraft-in-doom#p_abc')).toMatchObject({ path: 'minecraft-in-doom', post: 'p_abc' })
  })

  it('refuses what is not a node', () => {
    for (const bad of ['', 'Minecraft', 'a//b', 'https://shwarm.org/keys', 'minecraft-in-doom/log', 'minecraft-in-doom/s/x', '../etc'])
      expect(() => parseRef(bad), bad).toThrow(UsageError)
  })
})

describe('links', () => {
  it('reads --link and --repo specs, with labels', () => {
    expect(parseFileLink('https://codeberg.org/a/b/raw/x.diff')).toEqual({ url: 'https://codeberg.org/a/b/raw/x.diff', sha256: null })
    expect(parseFileLink(`corner-fix.diff=https://codeberg.org/a/b/raw/x.diff?ref=main#sha256=${SHA.toUpperCase()}`)).toEqual({
      url: 'https://codeberg.org/a/b/raw/x.diff?ref=main',
      sha256: SHA,
      label: 'corner-fix.diff',
    })
    expect(parseFileLink('https://x.org/a?b=c')).toEqual({ url: 'https://x.org/a?b=c', sha256: null })
    expect(parseRepoLink(`source=https://codeberg.org/ana/doom-blocks@${COMMIT}:src/place.c`)).toEqual({
      repo: 'https://codeberg.org/ana/doom-blocks',
      commit: COMMIT,
      path: 'src/place.c',
      label: 'source',
    })
    expect(() => parseFileLink('http://example.org/a.zip')).toThrow(/https addresses only/)
    expect(() => parseFileLink('https://example.org/a.zip#sha256=abc')).toThrow(/64 hex/)
    expect(() => parseRepoLink('https://codeberg.org/ana/doom-blocks@main')).toThrow(/full commit id/)
  })

  it('hashes the bytes at the url, fetched with no credentials, and leaves given hashes alone', async () => {
    const bytes = new TextEncoder().encode('the fix\n')
    const seen: { url: string; init?: RequestInit }[] = []
    const fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init })
      return new Response(bytes)
    }) as unknown as typeof globalThis.fetch
    expect(await hashUrl('https://codeberg.org/x', { fetch })).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(new Headers(seen[0].init?.headers).has('authorization')).toBe(false)
    const links = await resolveLinks([parseFileLink('https://a.org/1'), parseFileLink(`https://a.org/2#sha256=${SHA}`), parseRepoLink(`https://a.org/r@${COMMIT}`)], { fetch })
    expect(links).toEqual([
      { url: 'https://a.org/1', sha256: createHash('sha256').update(bytes).digest('hex') },
      { url: 'https://a.org/2', sha256: SHA },
      { repo: 'https://a.org/r', commit: COMMIT },
    ])
    expect(seen.map(s => s.url)).toEqual(['https://codeberg.org/x', 'https://a.org/1'])
  })

  it('refuses a link that fails or runs past the cap', async () => {
    const notFound = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch
    await expect(hashUrl('https://a.org/gone', { fetch: notFound })).rejects.toThrow(/404/)
    const big = (async () => new Response(new Uint8Array(100))) as unknown as typeof fetch
    await expect(hashUrl('https://a.org/big', { fetch: big, maxBytes: 50 })).rejects.toThrow(/over 50 bytes/)
  })
})

describe('the config file', () => {
  it('reads and writes profiles, keeping keys it does not know', () => {
    const text = `# mine
default_profile = "staging"

[profile.staging]
server = "https://shwarm-staging.myrakrusemark.workers.dev" # the staging copy
keyid = "k7m2q9x4ab"
as = "@myra/m-04"
secret_file = "keys/staging.key"
note = "a \\"quoted\\" word"
`
    const cfg = parseConfig(text)
    expect(cfg).toEqual({
      default_profile: 'staging',
      profiles: { staging: { server: 'https://shwarm-staging.myrakrusemark.workers.dev', keyid: 'k7m2q9x4ab', as: '@myra/m-04', secret_file: 'keys/staging.key', note: 'a "quoted" word' } },
    })
    expect(parseConfig(formatConfig(cfg))).toEqual(cfg)
    expect(() => parseConfig('[other]\n')).toThrow(UsageError)
    expect(() => parseConfig('[profile.a]\nkeyid = 12\n')).toThrow(/quoted strings/)
  })

  it('keeps the secret in a 0600 file, and the config without it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shwarm-cli-'))
    const rel = await saveSecret(dir, 'default', 'shwarm_sk_k7m2q9x4ab_' + 'A'.repeat(43))
    expect(rel).toBe(join('keys', 'default.key'))
    expect((await stat(join(dir, rel))).mode & 0o777).toBe(0o600)
    await writeConfig(dir, { profiles: { default: { keyid: 'k7m2q9x4ab', secret_file: rel } } })
    expect(await readFile(join(dir, 'config.toml'), 'utf8')).not.toContain('shwarm_sk_')
    expect(await readConfig(dir)).toEqual({ profiles: { default: { keyid: 'k7m2q9x4ab', secret_file: rel } } })
    expect(await readConfig(join(dir, 'none'))).toEqual({ profiles: {} })
    // a key file others can read still works, with a warning
    const loose = join(dir, 'loose.key')
    await writeFile(loose, 'shwarm_sk_x\n', { mode: 0o644 })
    const warnings: string[] = []
    expect(await readSecret(loose, w => void warnings.push(w))).toBe('shwarm_sk_x')
    expect(warnings[0]).toContain('chmod 600')
  })
})

describe('exit codes (CLI-16)', () => {
  it('maps every kind of error', () => {
    const api = (status: number) => new ApiError(status, 'x', 'x', {})
    expect(exitCodeFor(new UsageError('x'))).toBe(2)
    expect(exitCodeFor(new AuthError('x'))).toBe(3)
    expect([401, 403].map(s => exitCodeFor(api(s)))).toEqual([3, 3])
    expect([409, 422].map(s => exitCodeFor(api(s)))).toEqual([4, 4])
    expect(exitCodeFor(api(429))).toBe(5)
    expect([400, 413].map(s => exitCodeFor(api(s)))).toEqual([2, 2])
    expect([404, 410, 500, 502].map(s => exitCodeFor(api(s)))).toEqual([1, 1, 1, 1])
    expect(exitCodeFor(new NetworkError('x'))).toBe(1)
    expect(exitCodeFor(new Error('x'))).toBe(1)
  })
})
