// Characters that change how text looks without showing themselves (Trojan Source, CVE-2021-42574):
// bidi embeddings, overrides and isolates, the invisible direction marks, and zero-width characters.
// The renderer shows them as visible escapes (⟦U+202E⟧) in commands, code, logs, names and links;
// handles and done-test commands refuse them at write time (go-live 3.3).

const NAMES: Record<number, string> = {
  0x061c: 'arabic letter mark',
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
  0x2066: 'left-to-right isolate',
  0x2067: 'right-to-left isolate',
  0x2068: 'first strong isolate',
  0x2069: 'pop directional isolate',
  0xfeff: 'zero width no-break space',
}

// Go-live 3.3 names U+202A–202E, U+2066–2069, U+200B–200D, U+2060 and U+FEFF. The marks U+200E, U+200F and
// U+061C are added: they're just as invisible and Trojan Source uses them too.
/** Every hidden character, for code, commands, logs, names and links. */
export const HIDDEN_RE = /[؜​-‏‪-‮⁠⁦-⁩﻿]/g
/** Only the bidi embeddings, overrides and isolates: the ones escaped in prose too. */
// OPEN: in prose, zero-width characters and the direction marks are left alone, since emoji (ZWJ) and
// Persian or Indic text (ZWNJ) need them; only the explicit bidi controls are escaped there.
export const BIDI_RE = /[‪-‮⁦-⁩]/g

const hex = (ch: string) => ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')

/** The visible stand-in for one hidden character, as plain text. */
export const escapeOf = (ch: string) => `⟦U+${hex(ch)}⟧`

/** Plain text with every hidden character replaced by its visible escape (for places that aren't HTML). */
export const showHidden = (s: string) => s.replace(HIDDEN_RE, escapeOf)

export const hasHidden = (s: string) => new RegExp(HIDDEN_RE.source).test(s)

/** The hidden characters in `s`, as "U+202E right-to-left override", without repeats. */
export function hiddenIn(s: string): string[] {
  const out: string[] = []
  for (const ch of s.match(HIDDEN_RE) ?? []) {
    const label = `U+${hex(ch)} ${NAMES[ch.codePointAt(0)!]}`
    if (!out.includes(label)) out.push(label)
  }
  return out
}

/** The name of a hidden character, for a title attribute. */
export const hiddenName = (ch: string) => NAMES[ch.codePointAt(0)!] ?? 'hidden character'

/**
 * Write-time check for handles and done-test commands: null when `s` is clean, else a message naming what
 * was found. Handles also have to match the ASCII handle pattern, which already rules these out.
 */
export function hiddenProblem(s: string, field: string): string | null {
  const found = hiddenIn(s)
  return found.length ? `${field} has hidden characters that can make it read differently than it runs: ${found.join(', ')}` : null
}
