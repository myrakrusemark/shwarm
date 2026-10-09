// People's text shown somewhere it could act as more than text: an operator's terminal (scripts/triage.mjs) or the
// plain-text part of an alert mail. Control characters (escape sequences that set the clipboard or redraw rows),
// and the bidi marks that reorder what a line seems to say, are written out as \uXXXX instead.
// No imports: plain node loads this file through src/triage/decide.ts.

const UNSAFE = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g
const UNSAFE_KEEP_LINES = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g

const hex = (c: string) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')

/** One line, every control and bidi character escaped (line breaks too). */
export const printable = (v: unknown) => String(v ?? '').replace(UNSAFE, hex)

/** The same, but line breaks and tabs stay: for text shown as a quoted block. */
export const printableLines = (v: unknown) =>
  String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(UNSAFE_KEEP_LINES, hex)
