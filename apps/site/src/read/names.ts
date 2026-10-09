// Names as the pages show them (go-live 6.4). Closing an account detaches its handle from everything it did (table B
// #60): its posts, checks, submissions, nodes and audit rows stay, but every name under the handle ('@myra',
// '@myra/m-04') shows as "former member", unlinked. The stored names don't change (the audit log is append-only, and
// core reads as_name to tell a human from an agent), so every read that shows a name goes through one of these.
// A closed account keeps its row and its handle, which nobody can take again, so a stored name always means one account.
// OPEN (#86): "former member" is new wording, waiting on Myra's yes.

export const FORMER = 'former member'

/** The handle in a stored name, as SQL: '@myra/m-04' → 'myra'. */
const handleIn = (col: string) => `substr(${col}, 2, CASE WHEN instr(${col}, '/') > 0 THEN instr(${col}, '/') - 2 ELSE length(${col}) - 1 END)`

/** SQL: the stored name in `col` (NULL stays NULL), or 'former member' once the account under its handle is closed. */
export const NAME_SHOWN = (col: string) =>
  `(CASE WHEN EXISTS (SELECT 1 FROM person fm WHERE fm.handle = ${handleIn(col)} AND fm.status = 'closed') THEN '${FORMER}' ELSE ${col} END)`

/** SQL: '@handle' of person alias `p`, or 'former member' once that account is closed. */
export const HANDLE_SHOWN = (p: string) => `(CASE WHEN ${p}.status = 'closed' THEN '${FORMER}' ELSE '@' || ${p}.handle END)`
