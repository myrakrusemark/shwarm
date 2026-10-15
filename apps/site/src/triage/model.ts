// The model call (go-live 8.1): Cloudflare's Clef decision model through the Workers AI binding. Clef is not a chat
// model: it takes the node as a `state` object and answers typed questions. The node's text goes only in `state`;
// the questions (rubric.ts) say the state is user-submitted data. The installed workers-types don't know Clef, so the
// request and answer shapes are declared here and the answer is checked at run time: anything else is an error,
// and an error never clears a node.
import type { CheckSpec } from '../core/checks'
import { CATEGORIES, triageQuestions, type Category, type ChoiceQuestion, type NoulQuestion } from './rubric'

export const DEFAULT_MODEL = '@cf/cloudflare/clef-flash' // decided Oct 9; '@cf/cloudflare/clef' (27B) is the fallback
export const TIMEOUT_MS = 10_000

export type Answer = 'yes' | 'no' | 'unsure'
const ANSWERS: Answer[] = ['yes', 'no', 'unsure']

export type ClefRequest = {
  model: string
  state: Record<string, unknown>
  questions: Record<string, ChoiceQuestion | NoulQuestion>
}
export type ClefChoice = { type: 'choice'; choice: Answer; probabilities: Record<Answer, number>; confidence: number }
export type ClefNoul = { type: 'noul'; noul: number }
export type ClefResponse = { model: string; answers: Record<string, ClefChoice | ClefNoul>; usage?: { input_tokens: number; output_tokens: number } }

/** The part of the AI binding triage uses. env.AI is cast to this, since its typings list only known models. */
export type ClefBinding = { run(model: string, input: ClefRequest, options?: { signal?: AbortSignal }): Promise<unknown> }

/** What a good call gives back. */
export type Verdict = { answer: Answer; probabilities: Record<Answer, number>; confidence: number; category: Category; scores: Record<Category, number> }

/** A call that gave no usable answer. `called` is false when no call went out at all (no binding). */
export class TriageError extends Error {
  readonly called: boolean
  constructor(message: string, called = true) {
    super(message)
    this.called = called
  }
}

/** '@cf/cloudflare/clef-flash' → 'clef-flash', the body's model selector. */
export const selectorOf = (modelId: string) => modelId.split('/').pop() ?? modelId

/** The node as the model sees it. Text is copied as is: it is data in `state`, never pasted into a question. */
export type NodeForTriage = {
  kind: string
  title: string
  what: string
  done_when: string
  checks: string // JSON CheckSpec
  builds_on: string | null // JSON
  tags: string | null // space-separated
  parent_title: string | null
}

export function stateOf(n: NodeForTriage): Record<string, unknown> {
  let spec: Partial<CheckSpec> = {}
  try {
    spec = JSON.parse(n.checks) as CheckSpec
  } catch {
    // shown as no checks; the text fields are what triage reads
  }
  let buildsOn: unknown = null
  try {
    buildsOn = n.builds_on ? JSON.parse(n.builds_on) : null
  } catch {
    buildsOn = n.builds_on
  }
  return {
    kind: n.kind,
    ...(n.parent_title !== null ? { branch_of: n.parent_title } : {}),
    title: n.title,
    what: n.what,
    done_when: n.done_when,
    // How a node opened before Oct 14 was checked: the run command and the checkers' instructions are text people
    // wrote too. A node opened since keeps no checks (its done test is the sentence), so it has none to show.
    ...(spec.runs || spec.people || spec.author
      ? {
          checked_by: {
            runs: spec.runs ? { command: spec.runs.command, count: spec.runs.count, ...(spec.runs.description ? { description: spec.runs.description } : {}) } : null,
            people: spec.people ? { count: spec.people.count, human: spec.people.human, instructions: spec.people.instructions ?? '' } : null,
            author: spec.author === true,
          },
        }
      : {}),
    tags: n.tags ? n.tags.split(' ').filter(Boolean) : [],
    builds_on: buildsOn,
  }
}

export function clefRequest(modelId: string, n: NodeForTriage): ClefRequest {
  return { model: selectorOf(modelId), state: stateOf(n), questions: triageQuestions() }
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Checks the answer's shape; throws TriageError on anything unexpected (a refusal comes back as one of these). */
export function parseVerdict(raw: unknown): Verdict {
  const answers = (raw as ClefResponse | null)?.answers
  if (!answers || typeof answers !== 'object') throw new TriageError('malformed answer: no answers')
  const hb = answers.hard_block as ClefChoice | undefined
  if (!hb || hb.type !== 'choice' || !ANSWERS.includes(hb.choice)) throw new TriageError('malformed answer: hard_block')
  const p = hb.probabilities
  if (!p || typeof p !== 'object' || !ANSWERS.every(a => num(p[a]))) throw new TriageError('malformed answer: probabilities')
  if (!num(hb.confidence)) throw new TriageError('malformed answer: confidence')
  const scores = {} as Record<Category, number>
  for (const c of CATEGORIES) {
    const a = answers[c] as ClefNoul | undefined
    if (!a || a.type !== 'noul' || !num(a.noul)) throw new TriageError(`malformed answer: ${c}`)
    scores[c] = a.noul
  }
  // The likely category: the highest score (the first listed wins a tie).
  const category = CATEGORIES.reduce((best, c) => (scores[c] > scores[best] ? c : best), CATEGORIES[0])
  return { answer: hb.choice, probabilities: { yes: p.yes, no: p.no, unsure: p.unsure }, confidence: hb.confidence, category, scores }
}

/** One call, with a hard timeout even if the binding ignores the signal. */
export async function askClef(ai: ClefBinding | undefined, modelId: string, n: NodeForTriage, timeoutMs = TIMEOUT_MS): Promise<Verdict> {
  if (!ai || typeof ai.run !== 'function') throw new TriageError('no AI binding', false)
  const signal = AbortSignal.timeout(timeoutMs)
  const timedOut = new Promise<never>((_, reject) => {
    const fail = () => reject(new TriageError(`timed out after ${timeoutMs} ms`))
    if (signal.aborted) fail()
    else signal.addEventListener('abort', fail, { once: true })
  })
  timedOut.catch(() => {}) // the race takes it; once the call wins, its later rejection goes nowhere
  let raw: unknown
  try {
    raw = await Promise.race([ai.run(modelId, clefRequest(modelId, n), { signal }), timedOut])
  } catch (e) {
    if (e instanceof TriageError) throw e
    throw new TriageError(`model error: ${e instanceof Error ? e.message : String(e)}`)
  }
  return parseVerdict(raw)
}
