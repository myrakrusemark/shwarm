// Builds the package for npm (go-live 7.7): one bundled file for the `shwarm` command and one for the library, with
// @shwarm/protocol inside (it isn't published on its own), and type declarations under dist/types. No runtime
// dependencies. Run by `npm run build` and before `npm pack` / `npm publish`.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
rmSync(dist, { recursive: true, force: true })
// The MCP tools must match docs/openapi.yaml (prd-api MCP-1), or nothing is built.
execFileSync(process.execPath, [join(root, 'scripts/mcp-tools.mjs'), '--check'], { stdio: 'inherit' })

const common = { bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning', legalComments: 'none' }
await build({ ...common, entryPoints: [join(root, 'src/bin.ts')], outfile: join(dist, 'shwarm.js'), banner: { js: '#!/usr/bin/env node' } })
await build({ ...common, entryPoints: [join(root, 'src/index.ts')], outfile: join(dist, 'index.js') })

// Declarations: tsc writes them for this package and the protocol sources it uses; then the protocol import is
// pointed at the copy inside dist, and relative imports get the .js a Node ESM consumer needs.
const tsc = join(root, '../../node_modules/typescript/bin/tsc')
execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json')], { stdio: 'inherit' })
const types = join(dist, 'types')
const walk = d => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
const protocolIndex = join(types, 'protocol/src/index.js')
for (const file of walk(types).filter(f => f.endsWith('.d.ts'))) {
  const text = readFileSync(file, 'utf8')
    .replace(/(from |import\()(['"])@shwarm\/protocol\2/g, (_, a, q) => `${a}${q}${relative(dirname(file), protocolIndex).replace(/^(?!\.)/, './')}${q}`)
    .replace(/(from |import\()(['"])(\.\.?\/[^'"]+?)\2/g, (m, a, q, p) => (/\.(js|json)$/.test(p) ? m : `${a}${q}${p}.js${q}`))
  writeFileSync(file, text)
}
