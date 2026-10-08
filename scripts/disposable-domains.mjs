#!/usr/bin/env node
// Writes a D1 migration that loads the public disposable-email blocklist into disposable_domain.
// Source: https://github.com/disposable-email-domains/disposable-email-domains (CC0).
//
//   node scripts/disposable-domains.mjs apps/site/migrations/0003_disposable_domains.sql
//
// Migrations never change once applied, so a later refresh writes a NEW migration file (next number);
// INSERT OR IGNORE makes it add only the new domains. Removals, if ever needed, go in by hand.
import { writeFileSync } from 'node:fs'

const URL = 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf'
const out = process.argv[2]
if (!out) {
  console.error('usage: node scripts/disposable-domains.mjs <migration.sql>')
  process.exit(1)
}

const res = await fetch(URL)
if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
const domains = [...new Set((await res.text()).split('\n').map(l => l.trim().toLowerCase()).filter(l => l && !l.startsWith('#')))].sort()
const bad = domains.filter(d => !/^[a-z0-9.-]+$/.test(d))
if (bad.length) throw new Error(`unexpected characters in: ${bad.slice(0, 5).join(', ')}`)

const day = new Date().toISOString().slice(0, 10)
const lines = [
  `-- Disposable email domains, refused at sign-up (go-live 2.5). Generated ${day} by scripts/disposable-domains.mjs`,
  `-- from ${URL} (CC0), ${domains.length} domains. Expand-only: it only adds rows.`,
]
const CHUNK = 500 // keeps each statement well under D1's 100 KB statement limit
for (let i = 0; i < domains.length; i += CHUNK) {
  const rows = domains.slice(i, i + CHUNK).map(d => `('${d}')`)
  lines.push(`INSERT OR IGNORE INTO disposable_domain (domain) VALUES\n${rows.join(',\n')};`)
}
writeFileSync(out, lines.join('\n') + '\n')
console.log(`wrote ${domains.length} domains to ${out}`)
