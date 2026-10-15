// Which launch shwarms may go to production (go-live 3.10, 12.1). A shwarm goes only once Myra approved it in
// proofreading, never before, because its done test locks once posted. Pure: scripts/seed-launch.ts --approved reads
// tracker/proof.json, docs/launch-drops.md and the git history of docs/launch-shwarms.json and hands them in.
//
// The rules:
//   * the verdict is the latest message on the card that isn't Claude's (as tracker/proof.html reads it);
//   * "approve" is ready; "change", "question" or no verdict yet is not ready; "no", or a slug listed in
//     docs/launch-drops.md, is dropped and never goes;
//   * an approval counts for the words Myra saw. If the done test (done when, and builds on, which sets the license)
//     changed after she approved, or the slug wasn't in the list yet, it isn't ready until she approves again. checked_by
//     no longer counts: no node keeps checks since Oct 14, so the import doesn't read it.
//     Pitch changes after the approval (title, what, tags, sources, why now) can still be re-pitched on the site, so
//     they don't block; the report names them.

/** What locks once posted: the done test and what it builds on (its license comes from that). */
export const LOCKED_FIELDS = ['slug', 'done_when', 'builds_on'] as const
/** What the import reads that the author can still change on the site (re-pitch, tags, the pinned post). */
export const PITCH_FIELDS = ['title', 'what', 'tags', 'sources', 'why_now'] as const

export type ProofMessage = { from?: string; choice?: string; text?: string; at?: string }
export type Proof = Record<string, ProofMessage[]>
export type LaunchEntry = { slug: string; wave?: number; title?: string; [k: string]: unknown }

export type Readiness = {
  slug: string
  wave: number | null
  title: string
  status: 'ready' | 'not_ready' | 'dropped'
  reason: string
  verdict: string | null
  at: string | null // when the verdict was given
  pitchEdits: string[] // ready ones: pitch fields changed since the approval
}

/**
 * The entry as it stood when Myra gave her verdict at `at`: the entry, null when the slug wasn't in the list then, or
 * undefined when it can't be told (no history to read).
 */
export type AtApproval = (slug: string, at: string) => LaunchEntry | null | undefined

/** The latest verdict on a card: the last message that isn't Claude's. */
export function latestVerdict(thread: ProofMessage[] | undefined): { choice: string; at: string | null } | null {
  for (let i = (thread?.length ?? 0) - 1; i >= 0; i--) {
    const m = thread![i]
    if (m?.from !== 'claude' && typeof m?.choice === 'string') return { choice: m.choice, at: typeof m.at === 'string' ? m.at : null }
  }
  return null
}

/** The slugs listed in docs/launch-drops.md ("- slug (wave 1)"). */
export function parseDrops(md: string): Set<string> {
  return new Set([...md.matchAll(/^- ([a-z0-9]+(?:-[a-z0-9]+)*)\b/gm)].map(m => m[1]))
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function readiness(entries: LaunchEntry[], proof: Proof, o: { dropped: Set<string>; atApproval?: AtApproval; wave?: number | null }): Readiness[] {
  const out: Readiness[] = []
  for (const e of entries) {
    const wave = typeof e.wave === 'number' ? e.wave : null
    if (o.wave != null && wave !== o.wave) continue
    const v = latestVerdict(proof[e.slug])
    const base = { slug: e.slug, wave, title: String(e.title ?? ''), verdict: v?.choice ?? null, at: v?.at ?? null, pitchEdits: [] as string[] }
    if (o.dropped.has(e.slug) || v?.choice === 'no') {
      out.push({ ...base, status: 'dropped', reason: o.dropped.has(e.slug) ? 'dropped in proofreading (docs/launch-drops.md)' : 'Myra said no' })
      continue
    }
    if (!v) {
      out.push({ ...base, status: 'not_ready', reason: 'no verdict yet' })
      continue
    }
    if (v.choice !== 'approve') {
      out.push({ ...base, status: 'not_ready', reason: `latest verdict is "${v.choice}"` })
      continue
    }
    const then = v.at && o.atApproval ? o.atApproval(e.slug, v.at) : undefined
    if (then === null) {
      out.push({ ...base, status: 'not_ready', reason: 'approved before this version was in the list: approve again' })
      continue
    }
    if (then) {
      const locked = LOCKED_FIELDS.filter(k => !same(then[k], e[k]))
      if (locked.length) {
        out.push({ ...base, status: 'not_ready', reason: `${locked.join(', ')} changed after the approval: approve again` })
        continue
      }
    }
    const pitchEdits = then ? PITCH_FIELDS.filter(k => !same(then[k], e[k])) : []
    out.push({ ...base, status: 'ready', reason: then ? 'approved' : 'approved (not checked against the history)', pitchEdits })
  }
  return out
}

export function formatReadiness(rows: Readiness[]): string {
  const by = (s: Readiness['status']) => rows.filter(r => r.status === s)
  const lines: string[] = []
  const section = (name: string, list: Readiness[], detail: (r: Readiness) => string) => {
    lines.push(`${name}: ${list.length}`)
    for (const r of list) lines.push(`  ${r.slug}${r.wave != null ? ` (wave ${r.wave})` : ''}${detail(r) ? ` · ${detail(r)}` : ''}`)
  }
  section('ready to import', by('ready'), r => [r.reason !== 'approved' ? r.reason : '', r.pitchEdits.length ? `pitch edited since: ${r.pitchEdits.join(', ')}` : ''].filter(Boolean).join(' · '))
  section('not ready', by('not_ready'), r => r.reason)
  section('dropped', by('dropped'), r => r.reason)
  return lines.join('\n')
}
