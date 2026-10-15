// The author edits of live launch shwarms (Myra's chat yes, Oct 11: docs/card-fixes-oct11.md). Runs core's editNode
// (core/nodes.ts) as @myra on the site, exactly as if she pressed edit on /new?edit=, against a local copy of the target
// database, records each committed batch, and writes the batches out as one .sql file to apply with
// `wrangler d1 execute --file`. The one thing it skips is the password step-up: an operator script has no session, so
// the actor comes stepped up. Every other check is core's own: author only, refused once someone else joined or
// anything was submitted (editLock, and EDITABLE inside the batch), the posting pace, triage back to 'pending'.
// Nothing here talks to Cloudflare; scripts/edit-launch.ts does.
//
// The copy holds the target's real rows (with their real ids) for what editNode reads: @myra, each node and its
// branches, their tags, seats and submissions, @myra's thread rate buckets and the settings. So the recorded SQL
// names real ids and needs no stand-ins. Foreign keys are off in the copy: the people behind other seats and
// submissions aren't copied, only the rows that say they're there.
import { siteActor, type Actor } from '../core/actor'
import { TreeEngine } from '../core/engine'
import type { EditNodeInput, EditNodeResult } from '../core/nodes'
import { mapLaunchShwarm, type Note } from './launch'
import type { PersonState } from './plan'
import { recordingDb, type Recorded } from './recorder'
import { renderStatement, sqlString } from './sql'

export type EditTarget = 'local' | 'staging' | 'production'
type Row = Record<string, unknown>

/** What the plan reads from the target first. */
export type EditState = {
  myra: (PersonState & { is_admin: number }) | null
  nodes: Row[] // SELECT * FROM node: the named shwarms and every branch under them
  tags: Row[] // node_tag rows of those nodes
  seats: Row[] // seat rows of those nodes
  submissions: Row[] // submission rows of those nodes
  buckets: Row[] // @myra's thread rate buckets on those nodes
  settings: { key: string; value: string }[]
}

export type FieldChange = { field: string; before: string; after: string }
export type EditReport = {
  slug: string
  status: 'edit' | 'unchanged' | 'refused' | 'missing' | 'failed'
  changes: FieldChange[]
  notes: Note[]
  error?: string
}

export type EditPlan = {
  target: EditTarget
  reports: EditReport[]
  problems: string[]
  sql: string // the whole file; empty when nothing changes or anything failed
  statements: number
  edited: string[] // paths the file edits
  after: Map<string, Row> // each edited node's row as the copy holds it after the edit, for the read-back
}

const COMPARED = ['title', 'what', 'done_when', 'license', 'builds_on'] as const

const errText = (e: unknown) => {
  const x = e as { code?: string; message?: string }
  return x?.code ? `${x.code}: ${x.message}` : String(x?.message ?? e)
}

async function insertRows(db: D1Database, table: string, rows: Row[]): Promise<void> {
  if (!rows.length) return
  const stmts = rows.map(r => {
    const cols = Object.keys(r)
    return db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map(c => r[c]))
  })
  await db.batch(stmts)
}

async function setUpCopy(copy: D1Database & { raw?: { exec(sql: string): void } }, s: EditState, at: string): Promise<void> {
  copy.raw?.exec('PRAGMA foreign_keys = OFF')
  const m = s.myra!
  await copy.batch([
    copy
      .prepare(
        `INSERT INTO person (id, handle, email, email_norm, email_verified_at, password_hash, status, founding, established_at, is_admin, terms_version, terms_accepted_at, age_confirmed_at, created_at)
         VALUES (?, ?, 'copy@example.invalid', 'copy@example.invalid', ?, '!', ?, ?, ?, ?, '0.1', ?, ?, ?)`,
      )
      .bind(m.id, m.handle, m.email_verified_at, m.status, m.founding, m.established_at, m.is_admin, at, at, at),
    ...s.settings.map(x =>
      copy.prepare('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(x.key, x.value, at),
    ),
  ])
  // Roots before branches, so parent rows are there first (foreign keys are off anyway).
  await insertRows(copy, 'node', [...s.nodes].sort((a, b) => Number(a.root_id !== null) - Number(b.root_id !== null)))
  await insertRows(copy, 'node_tag', s.tags)
  await insertRows(copy, 'seat', s.seats)
  await insertRows(copy, 'submission', s.submissions)
  await insertRows(copy, 'rate_bucket', s.buckets)
}

/** The edit input for one launch entry: its full content as the import maps it (the /new form's fields). No checks: editNode ignores any (decided Oct 14). */
export function editInputOf(entry: unknown): { slug: string; input: EditNodeInput | null; notes: Note[] } {
  const m = mapLaunchShwarm(entry)
  if (m.notes.some(n => n.kind === 'failed')) return { slug: m.slug, input: null, notes: m.notes }
  const i = m.input
  return {
    slug: m.slug,
    input: { node: m.slug, title: i.title, what: i.what, doneWhen: i.doneWhen, check: null, tags: i.tags, license: i.buildsOn ? undefined : (i.license ?? undefined), buildsOn: i.buildsOn ?? null },
    notes: m.notes,
  }
}

/** Where two texts differ, with a little context either side. */
export function diffText(a: string, b: string, ctx = 30): { before: string; after: string } {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  let j = 0
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++
  const from = Math.max(0, i - ctx)
  const cut = (s: string) => (from > 0 ? '…' : '') + s.slice(from, s.length - j + Math.min(ctx, j)) + (j > ctx ? '…' : '')
  return { before: cut(a), after: cut(b) }
}

export async function planEdits(copy: D1Database, entries: unknown[], state: EditState, o: { target: EditTarget; now: number; slugs: string[] }): Promise<EditPlan> {
  const at = new Date(o.now).toISOString()
  const plan: EditPlan = { target: o.target, reports: [], problems: [], sql: '', statements: 0, edited: [], after: new Map() }
  if (!state.myra) plan.problems.push(`there is no @myra account on ${o.target}`)
  else if (state.myra.handle !== 'myra' || state.myra.status !== 'active' || !state.myra.email_verified_at) plan.problems.push('@myra must be active and verified on the target')
  const bySlug = new Map<string, unknown>()
  for (const e of entries) {
    const slug = (e as { slug?: unknown })?.slug
    if (typeof slug === 'string') {
      if (bySlug.has(slug)) plan.problems.push(`${slug} is in the launch list twice`)
      bySlug.set(slug, e)
    }
  }
  for (const s of o.slugs) if (!bySlug.has(s)) plan.problems.push(`${s} is not in the launch list`)
  if (plan.problems.length) return plan

  await setUpCopy(copy, state, at)
  const db = recordingDb(copy)
  const engine = new TreeEngine(db, () => o.now, { beta: true }) // the strictest site mode: @myra is founding, so it passes as on the site
  const myra: Actor = siteActor({ id: state.myra!.id, handle: 'myra' }, { steppedUp: true }) // the password step-up is the one check skipped
  const chunks: { label: string; batches: Recorded[][] }[] = []
  const read = (path: string) => copy.prepare('SELECT * FROM node WHERE path = ?').bind(path).first<Row>()

  for (const slug of o.slugs) {
    const { input, notes } = editInputOf(bySlug.get(slug))
    const r: EditReport = { slug, status: 'edit', changes: [], notes: notes.filter(n => n.kind === 'failed' || n.kind === 'warning') }
    plan.reports.push(r)
    if (!input) {
      r.status = 'failed'
      continue
    }
    const before = await read(slug)
    if (!before) {
      r.status = 'missing'
      continue
    }
    try {
      const res = (await engine.run({ type: 'editNode', actor: myra, input })) as EditNodeResult
      if (!res.edited) {
        r.status = 'unchanged'
        db.take()
        continue
      }
      const after = (await read(slug))!
      for (const f of COMPARED) {
        const a = String(before[f] ?? '')
        const b = String(after[f] ?? '')
        if (a !== b) r.changes.push({ field: f, ...diffText(a, b) })
      }
      const tags = async () => (await copy.prepare('SELECT tag FROM node_tag WHERE node_id = ? ORDER BY rowid').bind(before.id).all<{ tag: string }>()).results.map(t => t.tag).join(' ')
      const tagsNow = await tags()
      const tagsWas = state.tags.filter(t => t.node_id === before.id).map(t => String(t.tag)).join(' ')
      if (tagsNow !== tagsWas) r.changes.push({ field: 'tags', before: tagsWas, after: tagsNow })
      plan.edited.push(slug)
      plan.after.set(slug, after)
      chunks.push({ label: slug, batches: db.take() })
    } catch (e) {
      db.take()
      const msg = errText(e)
      r.status = /joined|submission|blocked|is (closed|dead end)|only the author/.test(msg) ? 'refused' : 'failed'
      r.error = msg
    }
  }
  // A slug that isn't on the target is reported; the script refuses it unless told to skip it (staging lacks some).
  if (plan.reports.some(r => r.status === 'failed') || !plan.edited.length) return plan

  // Guards first, as the seed's: each writes a NULL into meta.value (NOT NULL) when the target moved since the plan read
  // it, so the file stops at its first statement and nothing is written. Any post, join or submission moves a node's
  // last_event_id, so a node that changed in any way since the read stops the whole file.
  const lines: string[] = []
  const guard = (why: string, cond: string) => {
    lines.push(`INSERT INTO meta (key, value) SELECT ${sqlString('edit guard: ' + why)}, NULL WHERE ${cond};`)
    plan.statements++
  }
  guard('@myra changed', `(SELECT id FROM person WHERE handle = 'myra' AND status = 'active') IS NOT ${Number(state.myra!.id)}`)
  for (const slug of plan.edited) {
    const n = state.nodes.find(x => x.path === slug)!
    const lit = (v: unknown) => (v === null || v === undefined ? 'NULL' : sqlString(String(v)))
    guard(`${slug} changed since it was read`, `NOT EXISTS (SELECT 1 FROM node WHERE id = ${Number(n.id)} AND path = ${sqlString(slug)} AND last_event_id IS ${lit(n.last_event_id)} AND changed_at IS ${lit(n.changed_at)})`)
  }
  for (const c of chunks) {
    lines.push(`-- ${c.label.replace(/[^\w @().-]/g, '')}`)
    for (const b of c.batches)
      for (const s of b) {
        lines.push(renderStatement(s.sql, s.args))
        plan.statements++
      }
  }
  const head = [
    `-- shwarm launch edits (card fixes, Oct 11). target ${o.target}, planned ${at}, ${plan.edited.length} shwarms, ${plan.statements} statements.`,
    "-- written by scripts/edit-launch.ts from core's editNode run as @myra on the site. do not edit by hand: plan again.",
  ]
  plan.sql = [...head, ...lines, ''].join('\n')
  return plan
}

export function formatEditReport(p: EditPlan): string {
  const out: string[] = [`edit plan for ${p.target}: ${p.reports.length} shwarms`]
  for (const x of p.problems) out.push(`problem: ${x}`)
  for (const r of p.reports) {
    out.push('')
    out.push(`${r.slug}: ${r.status}${r.error ? ` (${r.error})` : ''}`)
    for (const n of r.notes) out.push(`  ${n.kind.padEnd(10)} ${n.field.padEnd(12)} ${n.text}`)
    for (const c of r.changes) {
      out.push(`  ${c.field}:`)
      out.push(`    - ${c.before}`)
      out.push(`    + ${c.after}`)
    }
  }
  const count = (s: EditReport['status']) => p.reports.filter(r => r.status === s).length
  out.push('')
  out.push(`${count('edit')} to edit, ${count('unchanged')} unchanged, ${count('refused')} refused, ${count('missing')} missing, ${count('failed')} failed.`)
  return out.join('\n')
}
