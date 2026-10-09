// Characters that change how text looks without showing themselves (Trojan Source, CVE-2021-42574):
// bidi embeddings, overrides and isolates, the invisible direction marks, zero-width and other format
// characters, tag characters, and the blank Hangul fillers. The renderer shows them as visible escapes
// (⟦U+202E⟧) in commands, code, logs, names and links; handles and done-test commands refuse them at write
// time (go-live 3.3).

const NAMES: Record<number, string> = {
  0x00ad: 'soft hyphen',
  0x034f: 'combining grapheme joiner',
  0x061c: 'arabic letter mark',
  0x115f: 'hangul choseong filler',
  0x1160: 'hangul jungseong filler',
  0x180e: 'mongolian vowel separator',
  0x200b: 'zero width space',
  0x200c: 'zero width non-joiner',
  0x200d: 'zero width joiner',
  0x200e: 'left-to-right mark',
  0x200f: 'right-to-left mark',
  0x202a: 'left-to-right embedding',
  0x202b: 'right-to-left embedding',
  0x202c: 'pop directional formatting',
  0x202d: 'left-to-right override',
  0x202e: 'right-to-left override',
  0x2060: 'word joiner',
  0x2061: 'function application',
  0x2062: 'invisible times',
  0x2063: 'invisible separator',
  0x2064: 'invisible plus',
  0x2066: 'left-to-right isolate',
  0x2067: 'right-to-left isolate',
  0x2068: 'first strong isolate',
  0x2069: 'pop directional isolate',
  0x3164: 'hangul filler',
  0xfeff: 'zero width no-break space',
  0xffa0: 'halfwidth hangul filler',
}

/**
 * The character class body for every hidden character: all format characters (Cf) and default-ignorable
 * code points, plus the Hangul fillers (blank letters that pass as an invisible variable name). Go-live 3.3
 * names the bidi controls and zero-width characters; this takes the whole Unicode family, so the tag
 * characters (U+E0000–E007F), invisible operators (U+2061–2064) and the soft hyphen are caught too.
 */
// OPEN: variation selectors (U+FE00–FE0F, U+E0100–E01EF) are default-ignorable, so an emoji written with
// U+FE0F shows the escape in a name or command; strict, and easy to narrow if it gets in the way.
export const HIDDEN_CLASS = '\\p{Cf}\\p{Default_Ignorable_Code_Point}\\u115F\\u1160\\u3164\\uFFA0'
/** Every hidden character, for code, commands, logs, names and links. */
export const HIDDEN_RE = new RegExp(`[${HIDDEN_CLASS}]`, 'gu')
/** Only the bidi embeddings, overrides and isolates: the ones escaped in prose too. */
// OPEN: in prose, zero-width characters and the direction marks are left alone, since emoji (ZWJ) and
// Persian or Indic text (ZWNJ) need them; only the explicit bidi controls are escaped there.
export const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/g

const hex = (ch: string) => ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')

/** The visible stand-in for one hidden character, as plain text. */
export const escapeOf = (ch: string) => `⟦U+${hex(ch)}⟧`

/** Plain text with every hidden character replaced by its visible escape (for places that aren't HTML). */
export const showHidden = (s: string) => s.replace(HIDDEN_RE, escapeOf)

export const hasHidden = (s: string) => new RegExp(HIDDEN_RE.source, 'u').test(s)

/** The hidden characters in `s`, as "U+202E right-to-left override", without repeats. */
export function hiddenIn(s: string): string[] {
  const out: string[] = []
  for (const ch of s.match(HIDDEN_RE) ?? []) {
    const label = `U+${hex(ch)} ${hiddenName(ch)}`
    if (!out.includes(label)) out.push(label)
  }
  return out
}

/** The name of a hidden character, for a title attribute. */
export function hiddenName(ch: string): string {
  const cp = ch.codePointAt(0)!
  if (NAMES[cp]) return NAMES[cp]
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'tag character'
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return 'variation selector'
  return 'hidden character'
}

/**
 * Write-time check for handles and done-test commands: null when `s` is clean, else a message naming what
 * was found. Handles also have to match the ASCII handle pattern, which already rules these out.
 */
export function hiddenProblem(s: string, field: string): string | null {
  const found = hiddenIn(s)
  return found.length ? `${field} has hidden characters that can make it read differently than it runs: ${found.join(', ')}` : null
}
