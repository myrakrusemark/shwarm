// Myra's hand decisions on triage (go-live 8.1), until the 8.4 admin console makes the same writes from a page:
// clear a node (it goes public) or block it (only its author sees it, with the category, her reason and how to
// appeal). The statements are built here, so tests run them against the test D1 and scripts/triage.mjs renders
// them as one SQL file for `wrangler d1 execute --file`, which runs the whole file or none of it.
// Plain node loads this file (scripts/triage.mjs), so its imports name .ts files and import nothing with deps.
//
// One decision writes: a moderation_action (clear_triage or block_triage, with her reason; 8.5 shows it publicly),
// a triage_decision with model 'myra' (never '@…', so the stats job doesn't count it as a model call), the node's
// triage, the node's and its parent's version and changed_at (as core/context.ts touchNode does), and the site-wide
// moderation version (core/context.ts moderatedStatement), so no cached signed-out page outlives it.
import { printable, printableLines } from '../core/printable.ts'
import { renderStatement } from '../seed/sql.ts'
import { CATEGORIES, isCategory, RUBRIC_VERSION, type Category } from './rubric.ts'

export const HAND_MODEL = 'myra'
export const MAX_ERRORS = 5 // error rows before a node goes to Myra (A8); the sweep in run.ts uses the same cap
export const MAX_REASON = 500

export type Stmt = { sql: string; args: unknown[] }
export type HandDecision =
  | { action: 'clear'; path: string; reason: string; by?: string; at?: string }
  | { action: 'block'; path: string; category: Category | string; reason: string; by?: string; at?: string }

export class DecideError extends Error {}

const PATH = /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/
const HANDLE = /^[a-z0-9_]{2,32}$/

// Same alphabet as core/ids.ts newId('v'): a node version is any token that changes.
function versionId(): string {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789'
  return 'v_' + [...crypto.getRandomValues(new Uint8Array(10))].map(b => a[b & 31]).join('')
}

/** What a block's reason column holds: the category first, so the blocked banner can show both. */
export const blockReason = (category: Category, reason: string) => `${category}: ${reason}`

/** The category and Myra's words from a block's reason, or null when it isn't one. */
export function parseBlockReason(s: string | null | undefined): { category: Category; reason: string } | null {
  if (!s) return null
  const i = s.indexOf(': ')
  const category = i < 0 ? s : s.slice(0, i)
  if (!isCategory(category)) return null
  return { category, reason: i < 0 ? '' : s.slice(i + 2) }
}

export function decideStatements(d: HandDecision): Stmt[] {
  if (!PATH.test(d.path) || d.path.length > 600) throw new DecideError(`not a node path: ${d.path}`)
  const by = d.by ?? 'myra'
  if (!HANDLE.test(by)) throw new DecideError(`not a handle: ${by}`)
  const reason = d.reason.replace(/\s+/g, ' ').trim()
  if (!reason) throw new DecideError('say why: the reason goes in the public moderation log')
  if (reason.length > MAX_REASON) throw new DecideError(`the reason is at most ${MAX_REASON} characters`)
  let action: 'clear_triage' | 'block_triage'
  let text: string
  if (d.action === 'block') {
    if (!isCategory(d.category)) throw new DecideError(`the category is one of: ${CATEGORIES.join(', ')}`)
    action = 'block_triage'
    text = blockReason(d.category, reason)
  } else if (d.action === 'clear') {
    action = 'clear_triage'
    text = reason
  } else throw new DecideError('clear or block')
  const at = d.at ?? new Date().toISOString()
  const node = '(SELECT id FROM node WHERE path = ?)'
  return [
    // First the two rows whose NOT NULL columns refuse a path (node_id) or a handle (by_person) that isn't there,
    // so a typo stops the file before the node is touched.
    {
      sql: `INSERT INTO triage_decision (node_id, model, rubric, answer, reason, created_at) VALUES (${node}, ?, ?, ?, ?, ?)`,
      args: [d.path, HAND_MODEL, RUBRIC_VERSION, d.action === 'block' ? 'yes' : 'no', text, at],
    },
    {
      sql: `INSERT INTO moderation_action (by_person, action, node_id, reason, created_at) VALUES ((SELECT id FROM person WHERE handle = ?), ?, ${node}, ?, ?)`,
      args: [by, action, d.path, text, at],
    },
    { sql: 'UPDATE node SET triage = ? WHERE path = ?', args: [d.action === 'block' ? 'blocked' : 'clear', d.path] },
    // As core/context.ts touchNode: the review flag, a new version (the signed-out ETag) and changed_at (the stats job).
    ...[`path = ?`, `id = (SELECT parent_id FROM node WHERE path = ?)`].map(where => ({
      sql: `UPDATE node SET in_review = (state = 'live' AND EXISTS (SELECT 1 FROM submission s WHERE s.node_id = node.id AND s.status = 'in_review')),
            last_event_id = ?, changed_at = ? WHERE ${where}`,
      args: [versionId(), at, d.path],
    })),
    // As core/context.ts moderatedStatement.
    {
      sql: `INSERT INTO setting (key, value, updated_at) VALUES ('moderated_at', ?, ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [JSON.stringify(versionId()), at],
    },
  ]
}

/** The statements as one SQL text with quoted literals, for `wrangler d1 execute --file`. */
export const toSqlScript = (stmts: Stmt[]) => stmts.map(s => renderStatement(s.sql, s.args)).join('\n') + '\n'

/** One node's current state and everything the model saw, for the script to show before it writes. */
export const nodeSql = (path: string) => {
  if (!PATH.test(path)) throw new DecideError(`not a node path: ${path}`)
  return renderStatement(
    `SELECT n.path, n.kind, n.title, n.triage, n.seeded, n.hidden, n.what, n.done_when, n.checks, n.builds_on, par.title AS parent_title,
            (SELECT group_concat(tag, ' ') FROM (SELECT t.tag FROM node_tag t WHERE t.node_id = n.id ORDER BY t.rowid)) AS tags,
            (SELECT json_group_array(json_object('title', e.title, 'what', e.what, 'was_public', e.was_public, 'done_when', e.done_when,
                                                 'checks', e.checks, 'tags', e.tags, 'license', e.license, 'builds_on', e.builds_on))
             FROM (SELECT * FROM node_edit e WHERE e.node_id = n.id ORDER BY e.edited_at DESC, e.id DESC) e) AS earlier
     FROM node n LEFT JOIN node par ON par.id = n.parent_id WHERE n.path = ?`,
    [path],
  )
}

export { printable }

type NodeShown = { path: string; kind: string; title: string; triage: string; seeded: number; hidden: number; what?: string; done_when?: string; checks?: string; builds_on?: string | null; parent_title?: string | null; tags?: string | null; earlier?: string | null }

/**
 * The node as the script prints it before clear or block: every field the model was given (triage/model.ts
 * stateOf), since a hold can come from the check command, the checkers' instructions, the tags or builds-on, and
 * the page is a 404 to Myra; then any earlier versions an edit (or a re-pitch, before Oct 10) replaced, and who sees
 * each. Each author-written line is quoted with '| ' and run through printableLines, so none of it can pass for the
 * script's own output or reach the terminal as an escape sequence.
 */
export function describeNode(n: NodeShown): string {
  const quote = (label: string, v: unknown) => `  ${label}:\n` + printableLines(v).split('\n').map(l => `    | ${l}`).join('\n')
  let spec: { runs?: { command?: string; count?: number; description?: string }; people?: { count?: number; human?: boolean; instructions?: string }; author?: boolean } = {}
  try {
    spec = JSON.parse(n.checks ?? '{}')
  } catch {
    // shown as no checks
  }
  const out = [`${printable(n.path)} (${printable(n.kind)}) is ${printable(n.triage)}${n.seeded ? ' (seeded)' : ''}${n.hidden ? ', hidden' : ''}`, quote('title', n.title)]
  if (n.parent_title) out.push(quote('branch of', n.parent_title))
  if (n.what !== undefined) out.push(quote('what', n.what))
  if (n.done_when !== undefined) out.push(quote('done when', n.done_when))
  if (spec.runs) {
    const runs = Number(spec.runs.count) || 0
    out.push(`  checked by ${runs} run report${runs === 1 ? '' : 's'}:`, quote('run command', spec.runs.command))
    if (spec.runs.description) out.push(quote('run description', spec.runs.description))
  }
  if (spec.people) {
    // as the alert mail says it (email/templates.ts): the node page's words, and no empty instructions block
    const people = Number(spec.people.count) || 0
    const human = spec.people.human ? (people === 1 ? ', a human' : ', at least one of them human') : ''
    const said = typeof spec.people.instructions === 'string' && spec.people.instructions.trim() !== ''
    out.push(`  checked by ${people} ${people === 1 ? 'person' : 'people'}${human}${said ? ':' : '.'}`)
    if (said) out.push(quote('checker instructions', spec.people.instructions))
  }
  if (spec.author) out.push('  and by its author.')
  if (n.tags) out.push(quote('tags', n.tags))
  if (n.builds_on) out.push(quote('builds on', n.builds_on))
  // Earlier versions from edits (and re-pitches before Oct 10): the model saw only the current words. A version public
  // when it was replaced stays in the page's history for everyone; the others only its author sees (read/node.ts
  // readNodeEdits). A re-pitch kept only the title and what; an edit keeps the rest too.
  type Earlier = { title?: unknown; what?: unknown; was_public?: unknown; done_when?: unknown; checks?: unknown; tags?: unknown; license?: unknown; builds_on?: unknown }
  let earlier: Earlier[] = []
  try {
    earlier = JSON.parse(n.earlier ?? '[]')
  } catch {
    // shown as none
  }
  earlier.forEach((e, i) => {
    out.push(`  earlier version ${i + 1}, newest first (${e.was_public === 1 ? 'shown to everyone' : 'shown to its author only'}):`, quote('title', e.title), quote('what', e.what))
    if (e.done_when === null || e.done_when === undefined) return // a re-pitch's: the rest was as the version after it
    out.push(quote('done when', e.done_when), quote('checks', e.checks), quote('tags', e.tags), quote('license', e.license))
    if (e.builds_on !== null && e.builds_on !== undefined) out.push(quote('builds on', e.builds_on))
  })
  return out.join('\n')
}

/**
 * Myra's queue: held nodes, and launch shwarms the model flagged (yes or unsure under this rubric) or couldn't
 * check (5 errors), which stay public while she decides. Newest first, each with its latest decision.
 */
export function queueSql(): string {
  return renderStatement(
    `SELECT n.path, n.kind, n.title, n.triage, n.seeded, n.created_at, d.model, d.answer, d.reason, d.created_at AS decided_at
     FROM node n
     LEFT JOIN triage_decision d ON d.id = (SELECT MAX(x.id) FROM triage_decision x WHERE x.node_id = n.id)
     WHERE n.triage = 'held'
        OR (n.seeded = 1 AND n.triage = 'pending' AND (
              EXISTS (SELECT 1 FROM triage_decision y WHERE y.node_id = n.id AND y.rubric = ? AND y.model LIKE '@%' AND y.answer IN ('yes', 'unsure'))
              OR (SELECT COUNT(*) FROM triage_decision z WHERE z.node_id = n.id AND z.rubric = ? AND z.answer = 'error') >= ?))
     ORDER BY n.created_at DESC, n.id DESC`,
    [RUBRIC_VERSION, RUBRIC_VERSION, MAX_ERRORS],
  )
}

// ---------- flags and the pause (go-live 9.3, the flag half; core/flags.ts) ----------
// Three open flags on a node from established accounts pause it (core/flags.ts flagNode); only the operator lifts it.

export type Unpause = { path: string; reason: string; by?: string; at?: string }

/**
 * Lifting a pause: a moderation_action 'unpause' with the operator's reason (public, as clear and block are; the pause
 * row itself is kept private, since it names the flagger whose flag made the third), every open flag on the node
 * resolved (so the count starts over), the node unpaused, and its version and changed_at moved, as core/context.ts
 * touchNode does, so no cached signed-out page keeps the banner. Every statement finds the node by its path, so a path
 * that isn't there changes nothing (the script says so first); the moderation_action goes first, and its NOT NULL
 * by_person refuses a handle that isn't there, so that typo stops the file before anything changes.
 */
export function unpauseStatements(d: Unpause): Stmt[] {
  if (!PATH.test(d.path) || d.path.length > 600) throw new DecideError(`not a node path: ${d.path}`)
  const by = d.by ?? 'myra'
  if (!HANDLE.test(by)) throw new DecideError(`not a handle: ${by}`)
  const reason = d.reason.replace(/\s+/g, ' ').trim()
  if (!reason) throw new DecideError('say why: the reason goes in the public moderation log')
  if (reason.length > MAX_REASON) throw new DecideError(`the reason is at most ${MAX_REASON} characters`)
  const at = d.at ?? new Date().toISOString()
  const node = '(SELECT id FROM node WHERE path = ?)'
  return [
    {
      sql: `INSERT INTO moderation_action (by_person, action, node_id, reason, public, created_at) SELECT (SELECT id FROM person WHERE handle = ?), 'unpause', id, ?, 1, ? FROM node WHERE path = ? AND paused = 1`,
      args: [by, reason, at, d.path],
    },
    { sql: `UPDATE flag SET resolved_at = ? WHERE node_id = ${node} AND post_id IS NULL AND resolved_at IS NULL`, args: [at, d.path] },
    { sql: 'UPDATE node SET paused = 0, last_event_id = ?, changed_at = ? WHERE path = ?', args: [versionId(), at, d.path] },
  ]
}

/**
 * The flags queue: every node with open flags, or paused, paused first, then the newest flag first. `established`
 * counts the open flags from accounts established when they flagged (the pause counts the same, core/flags.ts), `by` names everyone.
 */
export function flagsSql(): string {
  return renderStatement(
    `SELECT n.path, n.kind, n.title, n.paused,
            COUNT(f.id) AS open,
            COALESCE(SUM(CASE WHEN p.status = 'active' AND (p.founding = 1 OR (p.established_at IS NOT NULL AND p.established_at <= f.created_at)) THEN 1 ELSE 0 END), 0) AS established,
            group_concat(DISTINCT f.reason) AS reasons,
            group_concat('@' || p.handle, ' ') AS by_handles,
            MAX(f.created_at) AS last
     FROM node n
     LEFT JOIN flag f ON f.node_id = n.id AND f.post_id IS NULL AND f.resolved_at IS NULL
     LEFT JOIN person p ON p.id = f.person_id
     WHERE n.paused = 1 OR f.id IS NOT NULL
     GROUP BY n.id
     ORDER BY n.paused DESC, last DESC, n.id DESC`,
    [],
  )
}

/** One node's pause state, for the script to show before and after unpause. */
export const pauseSql = (path: string) => {
  if (!PATH.test(path)) throw new DecideError(`not a node path: ${path}`)
  return renderStatement(
    `SELECT n.path, n.kind, n.title, n.paused,
            (SELECT COUNT(*) FROM flag f WHERE f.node_id = n.id AND f.post_id IS NULL AND f.resolved_at IS NULL) AS open
     FROM node n WHERE n.path = ?`,
    [path],
  )
}
