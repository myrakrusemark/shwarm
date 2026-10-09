-- Expand only (go-live 4.4 review). Adds one column; drops and renames nothing.

-- Whether everyone could read this earlier title and pitch when a re-pitch replaced it (core/nodes.ts repitch): 1 when
-- the node was open then (cleared, or a seeded one still pending, and not hidden), 0 when it was still being checked,
-- held or hidden. Only the open ones show to everyone under "re-pitched"; the others show to the author alone, so words
-- triage never cleared don't reach the public through the history (read/node.ts readPitchEdits). Rows written before
-- this column count as 0.
ALTER TABLE node_edit ADD COLUMN was_public INTEGER NOT NULL DEFAULT 0;
