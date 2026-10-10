// Which nodes the reading pages show (A8, A18). One place, as SQL fragments, so every page hides the same things.
//
// A node shows when it isn't hidden and triage cleared it, or it's one of the seeded launch shwarms (Myra cleared
// those by proofreading them). A node still being checked ('pending'), held or blocked shows only to its author,
// and a hidden one never shows. A branch shows only while every node above it shows too: its root and each branch
// between (a hidden middle branch takes its whole subtree down). The variants made before they were dropped (Oct 9)
// stand alone, as shwarms.

/** SQL: node alias `n` itself is open to everyone (no ancestors checked). */
// A seeded shwarm counts as cleared only while its triage is still 'pending'; once held or blocked it hides like any other.
export const OPEN_NODE = (n: string) => `(${n}.hidden = 0 AND (${n}.triage = 'clear' OR (${n}.seeded = 1 AND ${n}.triage = 'pending')))`

/**
 * SQL: node alias `n` and every node above it are open to everyone.
 * Ancestors are the root (by id) and the branches in the same tree whose path is a prefix of n's ("a/b" above
 * "a/b/c"); paths are fixed once posted. The prefix test is exact (substr, not LIKE, so '_' and '%' in a slug
 * don't match anything else) and only reads the tree's own rows through node_root.
 */
export const PUBLIC_NODE = (n: string) => chainOk(n, OPEN_NODE)

/**
 * SQL: node alias `n` shows to the person whose id is the SQL expression `me`: it and every node above it are open to
 * everyone or, not hidden, written by that person (as readChain decides for a page: their own node still being checked
 * shows to them, under nodes that show).
 */
export const SEEN_NODE = (n: string, me: string) => chainOk(n, x => `(${OPEN_NODE(x)} OR (${x}.hidden = 0 AND ${x}.author_id = ${me}))`)

/**
 * SQL: node alias `n` and every node above it may still come to show: none hidden or blocked, only waiting on triage
 * ('pending', or 'held' for Myra). For mail about a node that doesn't show yet (jobs/mail.ts), which waits for it.
 */
export const UNBLOCKED_NODE = (n: string) => chainOk(n, x => `(${x}.hidden = 0 AND ${x}.triage <> 'blocked')`)

function chainOk(n: string, ok: (alias: string) => string): string {
  const up = `vis_${n}`
  return `(${ok(n)}
    AND NOT EXISTS (SELECT 1 FROM node ${up} WHERE ${up}.id = ${n}.root_id AND NOT ${ok(up)})
    AND NOT EXISTS (SELECT 1 FROM node ${up} WHERE ${up}.root_id = ${n}.root_id AND ${up}.id <> ${n}.id
      AND substr(${n}.path, 1, length(${up}.path) + 1) = ${up}.path || '/' AND NOT ${ok(up)}))`
}
