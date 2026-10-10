#!/usr/bin/env node
// Export the API docs into the live site (go-live 7.5). docs/ stays the source:
//   node scripts/pages/export-api-docs.mjs
// Writes apps/site/src/content/api-docs.json: docs/openapi.yaml as written, the same spec parsed (so the Worker needs
// no YAML parser) and docs/protocol.md. The Worker serves them at /openapi.yaml, /docs/reference and /docs/protocol;
// apps/site/test/docs.test.ts fails until this has run. mockups/openapi.yaml is a symlink to docs/openapi.yaml.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const yaml = readFileSync(join(ROOT, 'docs', 'openapi.yaml'), 'utf8')
const protocol = readFileSync(join(ROOT, 'docs', 'protocol.md'), 'utf8')
const out = { openapi_yaml: yaml, openapi: parse(yaml), protocol_md: protocol }
writeFileSync(join(ROOT, 'apps', 'site', 'src', 'content', 'api-docs.json'), JSON.stringify(out) + '\n')
console.log('exported apps/site/src/content/api-docs.json')
