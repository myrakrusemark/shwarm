// Notice settings (go-live 6.2): which notices-stream mails a person gets, as person.notice_prefs keeps them.
// notice_prefs is JSON: each notice type (the payload's `notice`, the unsubscribe token's type) maps to true or false,
// and `inbox_every` holds how often inbox mail comes ('digest' or 'now'). A type that isn't there takes its default.
// The account modal shows the types in groups, one checkbox each, as mockups/profile.html draws them. A one-click
// unsubscribe (email/routes.tsx) turns off one type only, so a group's box shows ticked only while all its types are on.
//
// OPEN (go-live 6.2 defaults, open-questions #84): "new in your inbox" covers mentions of the bare handle ('mention',
// sent from 6.3) and sign-off items ('sign_off', sent since 5.4), on by default, a daily digest by default (the mockup's
// first choice); passes and fails of nodes you're in ('pass_fail', sent from 6.3) are off by default, as the mockup
// draws them. "a key is used somewhere new" is a security mail: always on, not a setting.

export type NoticeGroup = { key: 'inbox' | 'pass_fail'; label: string; types: string[]; on: boolean }

export const NOTICE_GROUPS: NoticeGroup[] = [
  { key: 'inbox', label: 'new in your inbox', types: ['mention', 'sign_off'], on: true },
  { key: 'pass_fail', label: "a shwarm or branch you're in passes or fails", types: ['pass_fail'], on: false },
]

/** How often inbox mail comes, in the order the modal lists them; the first is the default. */
export const INBOX_EVERY = [
  { value: 'digest', label: 'daily digest' },
  { value: 'now', label: 'right away' },
] as const
export type InboxEvery = (typeof INBOX_EVERY)[number]['value']

const DEFAULTS: Record<string, boolean> = Object.fromEntries(NOTICE_GROUPS.flatMap(g => g.types.map(t => [t, g.on])))

export function parsePrefs(json: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(json ?? '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

/** Whether this notice type goes to the person: their own setting, else the type's default (on for types not listed). */
export const noticeOn = (prefs: Record<string, unknown>, type: string) =>
  typeof prefs[type] === 'boolean' ? (prefs[type] as boolean) : (DEFAULTS[type] ?? true)

/** A group's box: ticked only while every type in it is on. */
export const groupOn = (prefs: Record<string, unknown>, g: NoticeGroup) => g.types.every(t => noticeOn(prefs, t))

export const inboxEvery = (prefs: Record<string, unknown>): InboxEvery =>
  INBOX_EVERY.some(e => e.value === prefs.inbox_every) ? (prefs.inbox_every as InboxEvery) : INBOX_EVERY[0].value

/**
 * The prefs after a save of the modal. A group's types change only when its box changed from what the modal showed,
 * so saving the about line doesn't turn back on a type the person turned off from a mail's unsubscribe link.
 */
export function nextPrefs(prefs: Record<string, unknown>, ticked: Record<string, boolean>, every: string | undefined): Record<string, unknown> {
  const out = { ...prefs }
  for (const g of NOTICE_GROUPS) {
    const want = !!ticked[g.key]
    if (want !== groupOn(prefs, g)) for (const t of g.types) out[t] = want
  }
  if (INBOX_EVERY.some(e => e.value === every)) out.inbox_every = every
  return out
}
