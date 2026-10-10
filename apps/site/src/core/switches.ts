// The site switches the admin console flips (go-live 9.4, /admin/switches): rows in the `setting` table, read where
// each one acts (core/settings.ts for read_only and pause_new_nodes, auth/signup.ts and auth/routes.tsx for signup).
// A flip writes the setting and one public moderation_action row ('setting') in one batch. That row has no column for
// the switch, so its reason starts with "<key>=<value>: " and the public log (web/moderation-log.tsx) reads it back.
// The site mode is not here: SITE_MODE is a deploy-time var in wrangler.jsonc (core/site-mode.ts).

export type SwitchKey = 'read_only' | 'pause_new_nodes' | 'signup'

type Switch = {
  /** The switch's name in the console and the public log. OPEN (#107): new wording. */
  name: string
  /** Its two values, as stored (JSON), the default first: what the site does while the row is missing or unreadable. */
  values: readonly [unknown, unknown]
  /** A value in words. OPEN (#107): new wording. */
  words: (v: unknown) => string
}

const onOff = (v: unknown) => (v === true ? 'on' : 'off')

export const SWITCHES: Record<SwitchKey, Switch> = {
  read_only: { name: 'read-only', values: [false, true], words: onOff },
  pause_new_nodes: { name: 'pause new shwarms and branches', values: [false, true], words: onOff },
  // auth/signup.ts: anything but 'open' is invite-only, so the default (a missing row) is the allow-list.
  signup: { name: 'sign-up', values: ['allow_list', 'open'], words: v => (v === 'open' ? 'open to anyone' : 'allow-list only') },
}

export const isSwitch = (k: unknown): k is SwitchKey => typeof k === 'string' && Object.hasOwn(SWITCHES, k)

/** A switch's value as the code that reads it sees it: one of its two values, else the default. */
export function switchValue(key: SwitchKey, stored: unknown): unknown {
  const [dflt, other] = SWITCHES[key].values
  return stored === other ? other : dflt
}

/** The value a form field names ('true', 'false', 'open', 'allow_list'), if it is one of the switch's two. */
export function parseSwitchValue(key: SwitchKey, raw: unknown): { value: unknown } | null {
  for (const v of SWITCHES[key].values) if (String(v) === raw) return { value: v }
  return null
}

/** The current value of every switch, from one read of the setting table. */
export async function readSwitches(db: D1Database): Promise<Record<SwitchKey, unknown>> {
  const keys = Object.keys(SWITCHES) as SwitchKey[]
  const { results } = await db
    .prepare(`SELECT key, value FROM setting WHERE key IN (${keys.map(() => '?').join(', ')})`)
    .bind(...keys)
    .all<{ key: string; value: string }>()
  const stored = new Map<string, unknown>()
  for (const r of results) {
    try {
      stored.set(r.key, JSON.parse(r.value))
    } catch {
      // unreadable: the code that reads it keeps the default, and so does this
    }
  }
  return Object.fromEntries(keys.map(k => [k, switchValue(k, stored.get(k))])) as Record<SwitchKey, unknown>
}

/** The setting row write for a flip (an upsert: a missing row is made). */
export function switchStatement(db: D1Database, key: SwitchKey, value: unknown, at: string): D1PreparedStatement {
  return db
    .prepare('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, JSON.stringify(value), at)
}

/** The moderation_action reason for a flip: "read_only=true: <the admin's reason>". */
export const switchReason = (key: SwitchKey, value: unknown, reason: string) => `${key}=${JSON.stringify(value)}: ${reason}`

/** A 'setting' row's reason read back: the switch, its new value and the admin's reason. Null when it isn't one. */
export function parseSwitchReason(r: string): { key: SwitchKey; value: unknown; reason: string } | null {
  const m = /^([a-z_]+)=("[a-z_]+"|true|false): ([\s\S]*)$/.exec(r)
  if (!m || !isSwitch(m[1])) return null
  return { key: m[1], value: JSON.parse(m[2]), reason: m[3] }
}
