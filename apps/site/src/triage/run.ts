// Triage (go-live 8.1, A8): one model call per new shwarm or branch, and the minute sweep that retries.
//
// A new node is written 'pending' ("being checked", seen only by its author). Then:
//   model says no            → 'clear' (public)
//   model says yes or unsure → 'held' for Myra, with one alert mail. Only Myra ever sets 'blocked'.
//   error, refusal, timeout or a malformed answer → an 'error' row; it stays 'pending' and the sweep tries again.
//   still pending 10 minutes after it was made, or after 5 error rows → 'held', with one alert (fails closed).
//   setting triage = "off" → no call; held at once, with one alert.
// Seeded launch shwarms (seeded = 1) are public while 'pending' (read/visibility.ts), so triage never hides one:
// a no clears it; a yes or unsure leaves it 'pending' and alerts Myra once; 5 errors alert once and stop retrying.
// No node is called again once it has a model answer under the current rubric, in its current round.
// A round starts when the node is made, and again when its author edits a shwarm (core/nodes.ts editNode sets
// triage_since and puts a cleared node back to 'pending'): answers, errors and the 10 minutes count from it, and an
// answer from an earlier round never moves the node.
//
// Each outcome is one D1 batch, outside the shwarm tree (triage only ever moves a node out of 'pending', guarded by
// `AND triage = 'pending'`, so a decision Myra makes while a call is in flight wins). Alerts sit before the UPDATE,
// guarded by the same state, so two runs racing on one node send one alert.
import { ctxAt, moderatedStatement, touchNode, type Ctx } from '../core/context'
import { setting } from '../core/settings'
import { mailWhenStatement } from '../email/outbox'
import { MAX_ERRORS } from './decide'
import { askClef, DEFAULT_MODEL, stateOf, TriageError, type ClefBinding, type NodeForTriage, type Verdict } from './model'
import { CATEGORY_LABEL, RUBRIC_VERSION } from './rubric'

export type TriageEnv = { DB: D1Database; AI?: Ai; TRIAGE_MODEL?: string; ENV?: string }

export { MAX_ERRORS }
export const HOLD_AFTER_MS = 10 * 60_000 // A8: "after a few minutes it goes to Myra's queue"
export const SWEEP_LIMIT = 25 // nodes the sweep sends to the model per run
export const SWEEP_GRACE_MS = 60_000 // a node this new is still with its create hook; the sweep leaves it alone
const SWEEP_PARALLEL = 5 // calls at a time, so 25 slow ones still end well inside the next minute's run
// The model column of an error row when no call went out (no AI binding): never '@…', so the stats job
// (jobs/stats.ts, model LIKE '@%') doesn't count a call that didn't happen. Error counts match on answer alone.
export const NO_CALL = 'none'

export type Outcome =
  | { kind: 'skipped'; why: string }
  | { kind: 'decided'; answer: Verdict['answer']; triage: 'clear' | 'held' | 'pending' }
  | { kind: 'error'; error: string; escalated: boolean }
  | { kind: 'escalated'; why: 'off' | 'overdue' }

type Row = NodeForTriage & {
  id: number
  path: string
  parent_id: number | null
  seeded: number
  triage: string
  created_at: string
  since: string // when this triage round began: created_at, or the last edit
  errors: number // error rows under the current rubric, this round
  decided: number // a model answer under the current rubric exists, this round
}

/** When node `n`'s current triage round began (SQL). */
const SINCE = (n: string) => `COALESCE(${n}.triage_since, ${n}.created_at)`
const MODEL_DECISION = `SELECT 1 FROM triage_decision d WHERE d.node_id = n.id AND d.rubric = ?1 AND d.model LIKE '@%' AND d.answer IN ('yes', 'no', 'unsure') AND d.created_at >= ${SINCE('n')}`

async function loadRow(db: D1Database, nodeId: number): Promise<Row | null> {
  return db
    .prepare(
      `SELECT n.id, n.path, n.kind, n.title, n.what, n.done_when, n.checks, n.builds_on, n.parent_id, n.seeded, n.triage, n.created_at,
              ${SINCE('n')} AS since, par.title AS parent_title,
              (SELECT group_concat(tag, ' ') FROM (SELECT t.tag FROM node_tag t WHERE t.node_id = n.id ORDER BY t.rowid)) AS tags,
              (SELECT COUNT(*) FROM triage_decision d WHERE d.node_id = n.id AND d.rubric = ?1 AND d.answer = 'error' AND d.created_at >= ${SINCE('n')}) AS errors,
              EXISTS (${MODEL_DECISION}) AS decided
       FROM node n LEFT JOIN node par ON par.id = n.parent_id WHERE n.id = ?2`,
    )
    .bind(RUBRIC_VERSION, nodeId)
    .first<Row>()
}

/** Who gets alerts: every active admin; while nobody has is_admin set, the operator's account, @myra. */
async function admins(db: D1Database): Promise<{ id: number; email: string; handle: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT id, email, handle FROM person WHERE status = 'active' AND (is_admin = 1
         OR (handle = 'myra' AND NOT EXISTS (SELECT 1 FROM person WHERE is_admin = 1 AND status = 'active')))
       ORDER BY id`,
    )
    .all<{ id: number; email: string; handle: string }>()
  return results
}

const triageOff = async (db: D1Database) => (await setting<unknown>(db, 'triage', 'on')) === 'off'

type AlertFacts = { why: 'answer' | 'error' | 'off'; verdict?: Verdict; error?: string; model: string }

async function alertStatements(ctx: Ctx, env: TriageEnv, n: Row, f: AlertFacts, when: string, whenArgs: unknown[]): Promise<D1PreparedStatement[]> {
  const v = f.verdict
  // Everything the model saw, since the page is a 404 to Myra too: a hold can come from the check command,
  // the checkers' instructions, the tags or builds-on as much as from the title.
  const state = stateOf(n)
  const payload = {
    path: n.path,
    kind: n.kind,
    title: n.title,
    what: n.what,
    done_when: n.done_when,
    branch_of: n.parent_title,
    checked_by: state.checked_by,
    tags: state.tags,
    builds_on: state.builds_on,
    seeded: n.seeded === 1,
    why: f.why,
    rubric: RUBRIC_VERSION,
    model: f.model,
    env: env.ENV,
    ...(v ? { answer: v.answer, probabilities: v.probabilities, confidence: v.confidence, category: v.category, category_label: CATEGORY_LABEL[v.category] } : {}),
    ...(f.error ? { error: f.error } : {}),
  }
  return (await admins(ctx.db)).map(a =>
    mailWhenStatement(ctx.db, { to: a.email, personId: a.id, template: 'triage_alert', stream: 'account', payload: { handle: a.handle, ...payload } }, when, whenArgs, ctx.at),
  )
}

// Moves a non-seeded node from 'pending' to 'held' (or 'clear'), with the version and moderation bumps every
// visibility change carries (core/context.ts moderatedStatement). The guarded UPDATE comes first: runMove reads it.
// Guarded on the round too, so an answer about words the author edited meanwhile moves nothing.
function moveStatements(ctx: Ctx, n: Row, to: 'clear' | 'held'): D1PreparedStatement[] {
  const out = [
    ctx.db.prepare(`UPDATE node SET triage = ? WHERE id = ? AND triage = 'pending' AND ${SINCE('node')} = ?`).bind(to, n.id, n.since),
    touchNode(ctx, n.id, null),
  ]
  if (n.parent_id !== null) out.push(touchNode(ctx, n.parent_id, null))
  out.push(moderatedStatement(ctx))
  return out
}

/** A batch, and the move in it (if any), so runMove can tell whether the node actually moved. */
type Plan = { stmts: D1PreparedStatement[]; move?: D1PreparedStatement }
function addMove(p: Plan, ctx: Ctx, n: Row, to: 'clear' | 'held') {
  const m = moveStatements(ctx, n, to)
  p.move = m[0]
  p.stmts.push(...m)
}

// Written only while the node is still in the round the call was about: an answer about words the author edited
// meanwhile would otherwise count as this round's answer, and the new words would never be checked.
const decisionStatement = (ctx: Ctx, n: Row, model: string, answer: string, reason: string) =>
  ctx.db
    .prepare(
      `INSERT INTO triage_decision (node_id, model, rubric, answer, reason, created_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM node x WHERE x.id = ? AND ${SINCE('x')} = ?)`,
    )
    .bind(n.id, model, RUBRIC_VERSION, answer, reason.slice(0, 500), ctx.at, n.id, n.since)

/** Still pending, in the same round (binds the node id, then its round's start). */
const STILL_PENDING = `EXISTS (SELECT 1 FROM node x WHERE x.id = ? AND x.triage = 'pending' AND ${SINCE('x')} = ?)`

/** Holds a non-seeded pending node without a model answer (triage off, or it ran out of time or tries). */
async function escalate(p: Plan, ctx: Ctx, env: TriageEnv, n: Row, why: 'off' | 'overdue', error: string | undefined, model: string) {
  p.stmts.push(...(await alertStatements(ctx, env, n, { why: why === 'off' ? 'off' : 'error', error: error ?? 'no answer in time', model }, STILL_PENDING, [n.id, n.since])))
  addMove(p, ctx, n, 'held')
}

/** Runs the batch; says whether its guarded UPDATE moved the node (false when Myra decided while the call was out). */
async function runMove(db: D1Database, p: Plan): Promise<boolean> {
  const results = await db.batch(p.stmts)
  return p.move === undefined || (results[p.stmts.indexOf(p.move)]?.meta?.changes ?? 0) > 0
}

const overdue = (n: Row, now: number) => now - Date.parse(n.since) >= HOLD_AFTER_MS

/**
 * Triage one node by id: a shwarm or branch (or a variant made before they were dropped). Never throws for a model problem (that's an 'error' row);
 * a database failure does throw, and the node stays 'pending' for the sweep.
 */
export async function triageNode(env: TriageEnv, nodeId: number, o: { now?: number; timeoutMs?: number } = {}): Promise<Outcome> {
  const db = env.DB
  const n = await loadRow(db, nodeId)
  if (!n) return { kind: 'skipped', why: 'no such node' }
  if (n.triage !== 'pending') return { kind: 'skipped', why: n.triage }
  if (n.decided) return { kind: 'skipped', why: 'already answered' }
  const model = env.TRIAGE_MODEL || DEFAULT_MODEL
  if (await triageOff(db)) {
    if (n.seeded) return { kind: 'skipped', why: 'off' }
    const ctx = ctxAt(db, o.now ?? Date.now())
    const p: Plan = { stmts: [] }
    await escalate(p, ctx, env, n, 'off', undefined, model)
    return (await runMove(db, p)) ? { kind: 'escalated', why: 'off' } : MEANWHILE
  }
  if (n.seeded && n.errors >= MAX_ERRORS) return { kind: 'skipped', why: 'out of tries' }

  let verdict: Verdict
  try {
    verdict = await askClef(env.AI as unknown as ClefBinding | undefined, model, n, o.timeoutMs)
  } catch (e) {
    const error = e instanceof TriageError ? e.message : `error: ${e instanceof Error ? e.message : String(e)}`
    const called = !(e instanceof TriageError && !e.called)
    // The clock is read after the call: a call can take its whole timeout.
    const ctx = ctxAt(db, o.now ?? Date.now())
    const p: Plan = { stmts: [] }
    let escalated = false
    if (n.seeded) {
      // The fifth error on a launch shwarm: one alert (it stays public), and the sweep stops trying it. Built on
      // every error and left to the SQL guard, not to the count read before the call: two runs racing on one seed
      // both read a stale count, but each batch adds exactly one error row, so exactly one sees four before its own.
      p.stmts.push(
        ...(await alertStatements(
          ctx,
          env,
          n,
          { why: 'error', error, model },
          `${STILL_PENDING} AND (SELECT COUNT(*) FROM triage_decision WHERE node_id = ? AND rubric = ? AND answer = 'error' AND created_at >= ?) = ?`,
          [n.id, n.since, n.id, RUBRIC_VERSION, n.since, MAX_ERRORS - 1],
        )),
      )
    } else if (n.errors + 1 >= MAX_ERRORS || overdue(n, ctx.now)) {
      await escalate(p, ctx, env, n, 'overdue', error, model)
      escalated = true
    }
    p.stmts.push(decisionStatement(ctx, n, called ? model : NO_CALL, 'error', error))
    if (escalated) escalated = await runMove(db, p)
    else await db.batch(p.stmts)
    console.warn('triage', JSON.stringify({ node: n.path, error, escalated }))
    return { kind: 'error', error, escalated }
  }

  const ctx = ctxAt(db, o.now ?? Date.now())
  const p: Plan = { stmts: [] }
  let triage: 'clear' | 'held' | 'pending'
  if (verdict.answer === 'no') {
    triage = 'clear'
    p.stmts.push(decisionStatement(ctx, n, model, 'no', verdict.category))
    addMove(p, ctx, n, 'clear')
  } else if (n.seeded) {
    // A launch shwarm stays public: the answer is recorded and Myra hears about it once.
    triage = 'pending'
    const firstFlag = `${STILL_PENDING} AND NOT EXISTS (SELECT 1 FROM triage_decision WHERE node_id = ? AND rubric = ? AND model LIKE '@%' AND answer IN ('yes', 'unsure') AND created_at >= ?)`
    p.stmts.push(
      ...(await alertStatements(ctx, env, n, { why: 'answer', verdict, model }, firstFlag, [n.id, n.since, n.id, RUBRIC_VERSION, n.since])),
      decisionStatement(ctx, n, model, verdict.answer, verdict.category),
    )
  } else {
    triage = 'held'
    p.stmts.push(
      ...(await alertStatements(ctx, env, n, { why: 'answer', verdict, model }, STILL_PENDING, [n.id, n.since])),
      decisionStatement(ctx, n, model, verdict.answer, verdict.category),
    )
    addMove(p, ctx, n, 'held')
  }
  // The model's row is kept either way; when Myra decided while the call was out, hers stands and is reported.
  return (await runMove(db, p)) ? { kind: 'decided', answer: verdict.answer, triage } : MEANWHILE
}

const MEANWHILE: Outcome = { kind: 'skipped', why: 'decided meanwhile' }

export type SweepTriageResult = { escalated: number; decided: number; errors: number }

/**
 * The minute sweep (jobs/index.ts): first holds every non-seeded node that ran out of time or tries (or all of
 * them while triage is off), then sends up to 25 pending nodes with no answer under this rubric to the model,
 * people's new nodes first, then seeds, each oldest first: a backlog of launch shwarms (first deploy, a rubric
 * bump) must not use up a new node's retries before its 10 minutes run out. Nodes newer than a minute are left
 * to their create hook.
 */
export async function sweepTriage(env: TriageEnv, o: { now?: number; timeoutMs?: number } = {}): Promise<SweepTriageResult> {
  const db = env.DB
  const now = o.now ?? Date.now()
  const out: SweepTriageResult = { escalated: 0, decided: 0, errors: 0 }
  const off = await triageOff(db)
  const model = env.TRIAGE_MODEL || DEFAULT_MODEL
  const { results: late } = await db
    .prepare(
      `SELECT n.id FROM node n WHERE n.triage = 'pending' AND n.seeded = 0
         AND (?1 OR ${SINCE('n')} <= ?2
              OR (SELECT COUNT(*) FROM triage_decision d WHERE d.node_id = n.id AND d.rubric = ?3 AND d.answer = 'error' AND d.created_at >= ${SINCE('n')}) >= ?4)
         AND NOT EXISTS (SELECT 1 FROM triage_decision d WHERE d.node_id = n.id AND d.rubric = ?3 AND d.model LIKE '@%' AND d.answer IN ('yes', 'no', 'unsure') AND d.created_at >= ${SINCE('n')})
       ORDER BY n.created_at, n.id LIMIT 100`,
    )
    .bind(off ? 1 : 0, new Date(now - HOLD_AFTER_MS).toISOString(), RUBRIC_VERSION, MAX_ERRORS)
    .all<{ id: number }>()
  for (const { id } of late) {
    const n = await loadRow(db, id)
    if (!n || n.triage !== 'pending') continue
    const p: Plan = { stmts: [] }
    await escalate(p, ctxAt(db, now), env, n, off ? 'off' : 'overdue', off ? undefined : n.errors ? `${n.errors} errors` : undefined, model)
    if (await runMove(db, p)) out.escalated++
  }
  if (off) return out

  const { results: due } = await db
    .prepare(
      `SELECT n.id FROM node n WHERE n.triage = 'pending' AND ${SINCE('n')} <= ?2
         AND NOT EXISTS (${MODEL_DECISION})
         AND (n.seeded = 0 OR (SELECT COUNT(*) FROM triage_decision d WHERE d.node_id = n.id AND d.rubric = ?1 AND d.answer = 'error' AND d.created_at >= ${SINCE('n')}) < ?3)
       ORDER BY n.seeded, n.created_at, n.id LIMIT ?4`,
    )
    .bind(RUBRIC_VERSION, new Date(now - SWEEP_GRACE_MS).toISOString(), MAX_ERRORS, SWEEP_LIMIT)
    .all<{ id: number }>()
  const queue = due.map(r => r.id)
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        const r = await triageNode(env, id, { now: o.now, timeoutMs: o.timeoutMs })
        if (r.kind === 'decided') out.decided++
        else if (r.kind === 'error') {
          out.errors++
          if (r.escalated) out.escalated++
        } else if (r.kind === 'escalated') out.escalated++
      } catch (e) {
        out.errors++
        console.error('triage sweep: node', id, e)
      }
    }
  }
  await Promise.all(Array.from({ length: SWEEP_PARALLEL }, worker))
  return out
}

/**
 * The hook after a create (web/create.tsx; branches in 4.3 call it the same way) and after an edit (web/create.tsx,
 * edit mode), run after the response. A failure here is only logged: the node stays 'pending' and the sweep picks it up.
 */
export async function triageNew(env: TriageEnv, path: string): Promise<Outcome | null> {
  try {
    const row = await env.DB.prepare('SELECT id FROM node WHERE path = ?').bind(path).first<{ id: number }>()
    return row ? await triageNode(env, row.id) : null
  } catch (e) {
    console.error('triage after create failed', path, e)
    return null
  }
}
