// Which nodes the reading pages show (A8, A18). One place, as SQL fragments, so every page hides the same things.
//
// A node shows when it isn't hidden and triage cleared it, or it's one of the seeded launch shwarms (Myra cleared
// those by proofreading them). A node still being checked ('pending'), held or blocked shows only to its author,
// and a hidden one never shows. A branch shows only while its parent and its root show too.
// OPEN: the parent and root are checked, not every node between them; a hidden middle branch leaves its
// sub-branches showing. Variants stand alone: a hidden original doesn't hide its variants.

/** SQL: node alias `n` itself is open to everyone (no ancestors checked). */
export const OPEN_NODE = (n: string) => `(${n}.hidden = 0 AND (${n}.triage = 'clear' OR ${n}.seeded = 1))`

/** SQL: node alias `n`, its parent and its root are all open to everyone. */
export const PUBLIC_NODE = (n: string) => {
  const up = `vis_${n}`
  return `(${OPEN_NODE(n)} AND NOT EXISTS (SELECT 1 FROM node ${up} WHERE ${up}.id IN (${n}.parent_id, ${n}.root_id) AND NOT ${OPEN_NODE(up)}))`
}
