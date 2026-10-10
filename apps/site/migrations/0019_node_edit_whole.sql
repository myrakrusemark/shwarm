-- Expand only (decided Oct 10, '"edit" replaces re-pitch'). Adds five columns; drops and renames nothing.

-- A shwarm's author can now change everything the /new form holds until someone else joins or anything is submitted
-- (core/nodes.ts editNode), so an earlier version keeps all of it, not only its title and what: the done test, its
-- checks (JSON, as node.checks), the license, builds on (JSON, as node.builds_on) and the tags (a JSON array, in the
-- author's order). On rows written by a re-pitch, which never changed these, all five are NULL: that version had the
-- same ones as the version after it. done_when is never NULL on a row written by an edit, so it tells the two apart
-- (builds_on is NULL there too when the version built on nothing) (read/node.ts readPitchEdits).
ALTER TABLE node_edit ADD COLUMN done_when TEXT;
ALTER TABLE node_edit ADD COLUMN checks TEXT;
ALTER TABLE node_edit ADD COLUMN license TEXT;
ALTER TABLE node_edit ADD COLUMN builds_on TEXT;
ALTER TABLE node_edit ADD COLUMN tags TEXT;
