-- Expand only (go-live 3.2 review). Adds a column and fills an empty one; drops and renames nothing.

-- The hot badge's ratio (24-hour counted upvotes over the 7-day daily average), stored by the stats job next to hot,
-- so the feed reads it with the card instead of counting a thread's upvotes on every view. NULL when not hot.
ALTER TABLE node_stats ADD COLUMN surge REAL;

-- A dead end now records when it ended in closed_at, as a pass does (core/nodes.ts deadEnd; reopening clears it).
-- Dead ends from before take the time of their dead_end audit event.
UPDATE node SET closed_at = (SELECT MAX(a.at) FROM audit_event a WHERE a.node_id = node.id AND a.event = 'dead_end')
WHERE state = 'dead_end' AND closed_at IS NULL;
