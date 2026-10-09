// Which nodes the reading pages show (A8, A18). One place, as SQL fragments, so every page hides the same things.
//
// A node shows when it isn't hidden and triage cleared it, or it's one of the seeded launch shwarms (Myra cleared
// those by proofreading them). A node still being checked ('pending'), held or blocked shows only to its author,
// and a hidden one never shows. A branch shows only while every node above it shows too: its root and each branch
// between (a hidden middle branch takes its whole subtree down). Variants stand alone: a hidden original doesn't
// hide its variants, but its title isn't shown on them (see PUBLIC_NODE on the joined original).

/** SQL: node alias `n` itself is open to everyone (no ancestors checked). */
// A seeded shwarm counts as cleared only while its triage is still 'pending'; once held or blocked it hides like any other.
export const OPEN_NODE = (n: string) => `(${n}.hidden = 0 AND (${n}.triage = 'clear' OR (${n}.seeded = 1 AND ${n}.triage = 'pending')))`

/**
 * SQL: node alias `n` and every node above it are open to everyone.
 * Ancestors are the root (by id) and the branches in the same tree whose path is a prefix of n's ("a/b" above
 * "a/b/c"); paths are fixed once posted. The prefix test is exact (substr, not LIKE, so '_' and '%' in a slug
 * don't match anything else) and only reads the tree's own rows through node_root.
 */
export const PUBLIC_NODE = (n: string) => {
  const up = `vis_${n}`
  return `(${OPEN_NODE(n)}
    AND NOT EXISTS (SELECT 1 FROM node ${up} WHERE ${up}.id = ${n}.root_id AND NOT ${OPEN_NODE(up)})
    AND NOT EXISTS (SELECT 1 FROM node ${up} WHERE ${up}.root_id = ${n}.root_id AND ${up}.id <> ${n}.id
      AND substr(${n}.path, 1, length(${up}.path) + 1) = ${up}.path || '/' AND NOT ${OPEN_NODE(up)}))`
}
