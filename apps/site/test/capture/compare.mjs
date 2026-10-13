// Compares a capture run (test/capture/setup.ts) with one or more baseline runs:
//   node test/capture/compare.mjs [--noise <file>] <after> <before> [<before2> …]
// --noise: a file of "<file>.json › <test name>" lines to skip, tests that differ between two baselines by themselves.
// A test is fine when its pages and mails match any one baseline (a second baseline absorbs tests whose order varies
// from run to run). Prints the rest with the first differing stretch, and exits 1 if there are any.
import { readdirSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const ni = args.indexOf('--noise')
const noise = new Set(ni < 0 ? [] : readFileSync(args.splice(ni, 2)[1], 'utf8').split('\n').filter(Boolean))
const [after, ...befores] = args
// Parts that change from run to run by themselves: random tokens, nonces, ids and wall-clock times.
const norm = s =>
  s
    .replaceAll('<script src="/js/words.js" defer=""></script>', '') // added on purpose with the word list (go-live 11.8)
    .replace(/[A-Za-z0-9_-]{22,}/g, '«tok»')
    .replace(/\b[a-z]_[a-z0-9]{10}\b/g, '«id»')
    .replace(/\b[a-z]{20}\b/g, '«keyid»')
    .replace(/"hash":"[0-9a-f]{7}"/g, '"hash":"«hash»"')
    .replace(/(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{8,}/g, '«tok»')
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '«time»')
    .replace(/\.[a-z0-9]{6}\.«tok»/g, '.«t».«tok»')
const load = (d, f) => { try { return JSON.parse(readFileSync(`${d}/${f}`, 'utf8')) } catch { return null } }
const firstDiff = (x, y) => {
  if (x.length !== y.length) return `${x.length} captures before, ${y.length} after`
  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue
    let k = 0
    while (x[i][k] === y[i][k]) k++
    return `[${i}]\n  before: …${x[i].slice(Math.max(0, k - 80), k + 120)}\n  after:  …${y[i].slice(Math.max(0, k - 80), k + 120)}`
  }
  return null
}
let bad = 0
let reordered = 0
for (const f of readdirSync(befores[0])) {
  const B = load(after, f)
  if (!B) { console.log(`${f}: missing in the after run`); bad++; continue }
  const As = befores.map(d => load(d, f)).filter(Boolean)
  for (const t of new Set([...Object.keys(As[0]), ...Object.keys(B)])) {
    if (noise.has(`${f} › ${t}`)) continue
    const y = (B[t] ?? []).map(norm)
    const diffs = As.map(A => firstDiff((A[t] ?? []).map(norm), y))
    if (diffs.some(d => d === null)) continue
    // Rows with the same timestamp come back in either order from run to run. If the same pieces are all there, only
    // reordered, it's that and not a change in the words.
    const bag = xs => xs.flatMap(x => x.split(/(?=<)|(?<=>)/)).sort().join('\n')
    if (As.some(A => bag((A[t] ?? []).map(norm)) === bag(y))) { reordered++; continue }
    console.log(`${f} › ${t} ${diffs[0]}`)
    bad++
  }
}
console.log((bad ? `${bad} differences` : 'identical') + (reordered ? ` (${reordered} only reordered)` : ''))
process.exit(bad ? 1 : 0)
