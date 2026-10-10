// Checks, author sign-off, pass detection and reopening (spec "Checking", "Passing", "Reopening";
// protocol §7; A6, A9, A11; table B #37).
//   * one slot per person per submission, whatever the slot (slot_taken); never your own work (own_work)
//   * a people check needs an established account (not_established; founding accounts count)
//   * a pass needs evidence, a fail needs a repro; a run report must name the submission's hash
//   * the author goes last: only once every other check has passed (or at once when the author is the
//     only check), never on their own work (the A9 swap), and an author fail resets every check on the done test
//     (a submission that already passed keeps its checks: the pass stays on record)
//   * the sign-off is asked for by name (slot 'author'), on the site, with the password re-entered (A5); while the
//     author's account is suspended or closed, the operator signs off in their place (table B "author gone")
//   * a pass closes the node in the same batch; a closed node then takes only a repro on the passing
//     submission (A25, A11), which reopens it
import { hashMatches, shortHash, ShwarmError } from '@shwarm/protocol'
import { authorize, isBare, needHuman, needStepUp, type Actor } from './actor'
import { auditStatement, submissionHref } from './audit'
import { needs, tally, type CheckRow } from './checks'
import {
  isEstablished,
  loadNode,
  loadPerson,
  mentionStatements,
  noticeMailStatement,
  notifyStatement,
  postStatement,
  signOffDoneStatement,
  signOffStatements,
  specOf,
  touchNode,
  type Ctx,
} from './context'
import { newId } from './ids'
import { checkWritable, readSettings } from './settings'
import { byteLength, MAX_LOG_BYTES, needText, optText, parseLinks } from './text'

const bad = (m: string, d: Record<string, unknown> = {}) => new ShwarmError('bad_request', m, d)

export type CheckInput = {
  node: string
  on: string // the submission's post id
  slot?: 'run' | 'people' | 'author' // 'run' for a run report; 'author' for the sign-off (site only, stepped up); else people
  verdict?: 'pass' | 'fail' // a run's verdict comes from its exit code
  text?: string
  log?: string | { url: string; sha256: string } // inline up to 64 KB, or a link
  evidence?: unknown // links
  repro?: string | { steps: string; links?: unknown }
  submissionHash?: string // run reports
  scriptHash?: string
  exit?: number
  env?: string
}

export type CheckResult = {
  id: string
  post: string
  on: string
  slot: 'run' | 'people' | 'author'
  verdict: 'pass' | 'fail'
  submission_state: 'in_review' | 'passed' | 'failed'
  node_state: 'live' | 'closed'
  node_checks?: 'reset'
}

type SubRow = {
  post_id: string
  node_id: number
  number: number
  hash: string
  status: 'in_review' | 'passed' | 'failed' | 'superseded'
  author_swap: number
  person_id: number
}

const MAX_ENV = 200

function parseRepro(v: CheckInput['repro']): { steps: string; links: unknown[] } | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'string') return v.trim() ? { steps: needText(v, 'repro') , links: [] } : null
  if (typeof v !== 'object' || typeof v.steps !== 'string' || !v.steps.trim()) return null
  return { steps: needText(v.steps, 'repro.steps'), links: parseLinks(v.links, 'repro.links') }
}

async function checksOn(ctx: Ctx, subId: string): Promise<CheckRow[]> {
  const { results } = await ctx.db
    .prepare(
      `SELECT c.slot, c.verdict, (p.key_id IS NULL AND instr(p.as_name, '/') = 0) AS human
       FROM check_report c JOIN post p ON p.id = c.post_id WHERE c.submission_id = ? AND c.reset_at IS NULL`,
    )
    .bind(subId)
    .all<{ slot: CheckRow['slot']; verdict: CheckRow['verdict']; human: number }>()
  return results.map(r => ({ slot: r.slot, verdict: r.verdict, human: r.human === 1 }))
}

export async function check(ctx: Ctx, a: Actor, inp: CheckInput): Promise<CheckResult> {
  if (inp?.slot === 'author' && a.via === 'key')
    throw new ShwarmError('bare_handle_needs_human', 'the author signs off only on the site, on the submission page')
  authorize(a, 'check', String(inp?.node))

  // Shapes first: they don't depend on anything stored.
  const inlineLog = typeof inp.log === 'string' ? inp.log : null
  if (inlineLog !== null && byteLength(inlineLog) > MAX_LOG_BYTES)
    throw new ShwarmError('log_too_large', 'the inline log is over 64 KB. link it with its sha256 instead', { cap: MAX_LOG_BYTES })
  const logLink = inp.log && typeof inp.log === 'object' ? parseLinks([inp.log], 'log')[0] : null
  if (logLink && !('sha256' in logLink)) throw bad('a linked log is {url, sha256}')
  const evidence = parseLinks(inp.evidence, 'evidence')
  const text = optText(inp.text, 'text') ?? ''

  const person = await loadPerson(ctx, a)
  checkWritable(await readSettings(ctx.db, ['read_only']))
  const n = await loadNode(ctx, inp.node)
  // OPEN: checks on a dead end aren't described; refused until the author reopens it.
  if (n.state === 'dead_end') throw new ShwarmError('shwarm_closed', `${n.path} is a dead end`, { node: n.path })
  const sub =
    typeof inp.on === 'string'
      ? await ctx.db
          .prepare(
            `SELECT s.post_id, s.node_id, s.number, s.hash, s.status, s.author_swap, p.person_id
             FROM submission s JOIN post p ON p.id = s.post_id WHERE s.post_id = ? AND s.node_id = ?`,
          )
          .bind(inp.on, n.id)
          .first<SubRow>()
      : null
  if (!sub) throw new ShwarmError('not_a_submission', `${String(inp.on)} is not a submission on ${n.path}`, { on: inp.on ?? null })
  // A closed node takes only a repro on the submission that closed it (A25, A11); a pass there is checked below, once
  // the verdict is known. Anything else would change nothing the pass hasn't settled.
  // OPEN (#72): a repro is an ordinary fail check, so the slot rules below hold for it too (own_work, slot_taken,
  // not_established): someone who checked the passing submission can't later post a repro on it.
  const closing =
    n.state === 'closed'
      ? await ctx.db
          .prepare("SELECT post_id, number FROM submission WHERE node_id = ? AND status = 'passed' ORDER BY decided_at DESC, number DESC LIMIT 1")
          .bind(n.id)
          .first<{ post_id: string; number: number }>()
      : null
  const closedTo = (c: { number: number }) =>
    new ShwarmError('shwarm_closed', `${n.path} passed on #${c.number}. it takes only a repro on #${c.number}, which reopens it`, { node: n.path })
  if (closing && closing.post_id !== sub.post_id) throw closedTo(closing)
  // OPEN: checks on a superseded or failed submission aren't described; refused, since nothing they say can change it.
  if (sub.status === 'superseded' || sub.status === 'failed') throw bad(`#${sub.number} is ${sub.status}. check the newest submission`)
  if (sub.person_id === person.id) throw new ShwarmError('own_work', `#${sub.number} is work posted under @${person.handle}`)

  const spec = specOf(n)
  const need = needs(spec, sub.author_swap === 1)
  let slot: CheckResult['slot']
  const isAuthor = need.author && person.id === n.author_id
  // Author gone (table B): while the author's account is suspended or closed, the operator (any admin) takes the author's
  // slot, asked for by name and behind the password like the author's own. OPEN (open-questions #75): the usual refusals
  // stand, so an operator who submitted it or already checked it can't sign off; the rule covers branch authors too, but
  // only the sign-off (not dead ends or reopening); and the slot goes back to the author once their account is active.
  const byOperator = need.author && !isAuthor && inp.slot === 'author' && n.author_status !== 'active' && person.is_admin === 1
  if ((isAuthor || byOperator) && inp.slot === 'author') {
    // The author's one slot on someone else's submission is the sign-off, made on the site behind the password.
    needHuman(a, 'the author sign-off')
    needStepUp(a, 'the author sign-off')
    // A passed submission only takes repros; its sign-off is on record and can't be redone.
    if (sub.status !== 'in_review') throw bad(`#${sub.number} already ${sub.status}. the author signs off on a submission in review`)
    slot = 'author'
  } else if (isAuthor && sub.status === 'in_review') {
    // Never an implicit sign-off: a check the author sends without asking for the author slot is refused, so no form
    // can sign off without the step-up. OPEN: an author who also wants to post a run report isn't described.
    throw new ShwarmError('not_permitted', 'your check here is the sign-off, on the submission page', { reason: 'sign_off', node: n.path })
  } else if (inp.slot === 'author') {
    throw new ShwarmError('not_permitted', 'only the author signs off', { need: 'author', node: n.path })
  } else if (inp.slot === 'run') {
    // OPEN: a run report on a done test that names no runs isn't described; refused.
    if (!spec.runs) throw bad("this done test doesn't ask for runs")
    slot = 'run'
  } else slot = 'people'

  if (slot === 'people' && !isEstablished(person, ctx.now))
    throw new ShwarmError('not_established', 'people checks count from established accounts. yours is new')
  if (await ctx.db.prepare('SELECT 1 FROM check_report WHERE submission_id = ? AND person_id = ? AND reset_at IS NULL').bind(sub.post_id, person.id).first())
    throw new ShwarmError('slot_taken', `@${person.handle} already has a check on #${sub.number}. one slot per person`)

  // The verdict and what backs it.
  let verdict: 'pass' | 'fail'
  let repro: { steps: string; links: unknown[] } | null = null
  const run: { submissionHash: string; scriptHash: string; exit: number; env: string } | null = slot === 'run' ? (() => {
    if (typeof inp.submissionHash !== 'string') throw bad('a run report names the submission hash it ran')
    if (typeof inp.scriptHash !== 'string' || !/^[0-9a-f]{7,64}$/i.test(inp.scriptHash)) throw bad('a run report names the check script hash (hex)')
    if (!Number.isInteger(inp.exit)) throw bad('a run report gives the exit code')
    if (!inlineLog && !logLink) throw bad('a run report carries the full log, inline or linked')
    const env = needText(inp.env, 'env', MAX_ENV)
    return { submissionHash: inp.submissionHash.toLowerCase(), scriptHash: inp.scriptHash.toLowerCase(), exit: inp.exit as number, env }
  })() : null
  if (run) {
    if (!hashMatches(sub.hash, run.submissionHash))
      throw new ShwarmError('hash_mismatch', `that run was against ${run.submissionHash.slice(0, 7)}, not #${sub.number} (${shortHash(sub.hash)})`, {
        expected: shortHash(sub.hash),
      })
    verdict = run.exit === 0 ? 'pass' : 'fail'
    if (inp.verdict !== undefined && inp.verdict !== verdict) throw bad(`exit ${run.exit} is a ${verdict}`)
    // A nonzero exit is a fail, with the log as its repro (protocol §7, proposed).
    if (verdict === 'fail') repro = parseRepro(inp.repro) ?? { steps: `exit ${run.exit}. see the log.`, links: logLink ? [logLink] : [] }
  } else {
    if (inp.verdict !== 'pass' && inp.verdict !== 'fail') throw bad('verdict is pass or fail')
    verdict = inp.verdict
    if (verdict === 'pass') {
      // "looks good" doesn't count: a people pass needs a log or links; the author's pass says what they checked.
      const backed = slot === 'author' ? !!text || !!inlineLog || evidence.length > 0 : !!inlineLog || evidence.length > 0
      if (!backed) throw new ShwarmError('missing_evidence', slot === 'author' ? 'say what you checked' : 'a pass needs evidence: a log or links to a rerun or recording')
    } else {
      repro = parseRepro(inp.repro)
      if (!repro) throw new ShwarmError('missing_repro', 'a fail needs a repro: steps that show it failing')
    }
  }
  if (closing && verdict === 'pass') throw closedTo(closing)

  const before = await checksOn(ctx, sub.post_id)
  const wasReady = tally(need, before).othersDone // the author was already asked to sign off
  if (slot === 'author' && !wasReady)
    // OPEN: no error code names "not your turn yet"; not_permitted with need: other_checks.
    throw new ShwarmError('not_permitted', 'the author signs off last, once every other check has passed', { need: 'other_checks', node: n.path })

  const postId = newId('p')
  const checkId = newId('c')
  const m = await mentionStatements(ctx, { postId, text, node: n, actor: a })
  const stmts: D1PreparedStatement[] = [postStatement(ctx, { id: postId, nodeId: n.id, actor: a, kind: 'check', text, links: evidence })]
  const authorFail = slot === 'author' && verdict === 'fail'
  if (authorFail)
    // An author's fail resets every check on the done test: runs and people start over (decided). Checks on a
    // submission that passed before (the node closed, then a repro reopened it) stay as they are, repro included.
    stmts.push(
      ctx.db
        .prepare(
          `UPDATE check_report SET reset_at = ? WHERE reset_at IS NULL
           AND submission_id IN (SELECT post_id FROM submission WHERE node_id = ? AND status <> 'passed')`,
        )
        .bind(ctx.at, n.id),
    )
  stmts.push(
    ctx.db
      .prepare(
        `INSERT INTO check_report (id, post_id, submission_id, person_id, slot, verdict, evidence, repro, submission_hash, script_hash,
           exit_code, log_inline, log_link, machine, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        checkId,
        postId,
        sub.post_id,
        person.id,
        slot,
        verdict,
        evidence.length ? JSON.stringify(evidence) : null,
        repro ? JSON.stringify(repro) : null,
        run?.submissionHash ?? null,
        run?.scriptHash ?? null,
        run?.exit ?? null,
        inlineLog,
        logLink ? JSON.stringify(logLink) : null,
        run?.env ?? null,
        ctx.at,
      ),
  )
  const runDetail = run ? ` · exit ${run.exit} on #${sub.number} (${shortHash(sub.hash)}) · ${run.env}` : ` on #${sub.number}`
  const subHref = submissionHref(n.path, sub.number)
  let last = auditStatement(
    ctx.db,
    {
      event: slot === 'author' ? 'signed_off' : 'check',
      node: n.id,
      by: a.as,
      submissionId: sub.post_id,
      number: sub.number,
      detail: `${verdict} · ${slot}${runDetail}${byOperator ? ' · author gone, signed off by the operator' : ''}`,
      evidence: submissionHref(n.path, sub.number, checkId),
    },
    ctx.at,
  )
  stmts.push(last.stmt, ...m.stmts)

  // Passes, fails and reopenings are mailed to the people in the node who turned that on (go-live 6.3, notice 'pass_fail').
  const news = { notice: 'pass_fail', title: n.title, path: n.path, number: sub.number, link: subHref }
  let subState: CheckResult['submission_state'] = sub.status as 'in_review' | 'passed'
  let nodeState = n.state as 'live' | 'closed'
  const isHuman = a.via !== 'key' && isBare(a)
  const after = tally(need, [...before, { slot, verdict, human: isHuman }])
  if (authorFail) {
    subState = 'failed'
    stmts.push(
      ctx.db.prepare("UPDATE submission SET status = 'failed', decided_at = ? WHERE post_id = ? AND status = 'in_review'").bind(ctx.at, sub.post_id),
      signOffDoneStatement(ctx, n.id, { on: sub.post_id }),
    )
    last = auditStatement(
      ctx.db,
      { event: 'failed', node: n.id, by: null, submissionId: sub.post_id, number: sub.number, detail: `#${sub.number} failed the author check. every check starts over`, evidence: subHref },
      ctx.at,
    )
    stmts.push(
      last.stmt,
      notifyStatement(ctx, n.id, `#${sub.number} on ${n.title} failed the author check. every check starts over.`, 'involved'),
      noticeMailStatement(ctx, n.id, 'involved', { template: 'node_news', payload: { ...news, event: 'failed' } }),
    )
  } else if (sub.status === 'in_review' && after.passed) {
    // The pass, in one batch: the submission passes, the node closes, anything else in review is superseded, and
    // nothing is left waiting on the author. Its release fields came with it at submit. A branch passing never
    // touches its parent.
    subState = 'passed'
    nodeState = 'closed'
    stmts.push(
      ctx.db.prepare("UPDATE submission SET status = 'passed', decided_at = ? WHERE post_id = ?").bind(ctx.at, sub.post_id),
      ctx.db
        .prepare("UPDATE submission SET status = 'superseded', superseded_by = ? WHERE node_id = ? AND status = 'in_review' AND post_id <> ?")
        .bind(sub.post_id, n.id, sub.post_id),
      signOffDoneStatement(ctx, n.id, { on: sub.post_id }),
      signOffDoneStatement(ctx, n.id, { replacedBy: sub.post_id }),
      ctx.db.prepare("UPDATE node SET state = 'closed', closed_at = ? WHERE id = ?").bind(ctx.at, n.id),
    )
    last = auditStatement(
      ctx.db,
      { event: 'passed', node: n.id, by: null, submissionId: sub.post_id, number: sub.number, detail: `#${sub.number} (${shortHash(sub.hash)}) passed`, evidence: subHref },
      ctx.at,
    )
    stmts.push(
      last.stmt,
      notifyStatement(ctx, n.id, `${n.title} passed on #${sub.number}.`, 'involved'),
      noticeMailStatement(ctx, n.id, 'involved', { template: 'node_news', payload: { ...news, event: 'passed' } }),
    )
  } else if (sub.status === 'in_review' && slot !== 'author' && need.author && after.othersDone && !wasReady) {
    // Ready for the author (go-live 5.4): their inbox gets the sign-off notice, and they get a mail.
    stmts.push(...signOffStatements(ctx, n, { postId: sub.post_id, number: sub.number }, false))
  } else if (sub.status === 'in_review' && need.author && wasReady && verdict === 'fail') {
    // OPEN (#73): a fail after the author was asked (checks past the count still land) blocks the sign-off, so nothing waits on
    // them for this submission any more. The submission stays in review until a newer one replaces it.
    stmts.push(signOffDoneStatement(ctx, n.id, { on: sub.post_id }))
  } else if (closing && verdict === 'fail') {
    // A repro on the passing submission (the only check a closed node takes) reopens the node; the pass stays on record.
    nodeState = 'live'
    stmts.push(ctx.db.prepare("UPDATE node SET state = 'live', closed_at = NULL WHERE id = ?").bind(n.id))
    last = auditStatement(
      ctx.db,
      { event: 'reopened', node: n.id, by: a.as, submissionId: sub.post_id, number: sub.number, detail: `repro on #${sub.number}`, evidence: submissionHref(n.path, sub.number, checkId) },
      ctx.at,
    )
    stmts.push(
      last.stmt,
      notifyStatement(ctx, n.id, `${n.title} reopened: a repro on #${sub.number}.`, 'involved'),
      noticeMailStatement(ctx, n.id, 'involved', { template: 'node_news', payload: { ...news, event: 'reopened', link: submissionHref(n.path, sub.number, checkId) } }),
    )
  }
  stmts.push(touchNode(ctx, n.id, last.id))
  await ctx.db.batch(stmts)
  return {
    id: checkId,
    post: postId,
    on: sub.post_id,
    slot,
    verdict,
    submission_state: subState,
    node_state: nodeState,
    ...(authorFail ? { node_checks: 'reset' as const } : {}),
  }
}
