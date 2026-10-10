-- Expand only (go-live 8.1, pulled forward by Myra on Oct 9: "No lobby", "Variants are dropped"). Moves rows; drops and
-- renames nothing.

-- A shwarm is live the moment it's posted, so every shwarm still waiting in a lobby goes live now, as if it had been
-- live from its start (live_at = created_at). No 'lobby_filled' event is written: nothing filled. Its seats stay, and
-- now say who joined (is working on it). The code no longer writes 'lobby', and no longer reads lobby_size (a new
-- shwarm still gets 1, which the schema wants) or variant_of_id; both columns and their old values stay. Old variants
-- keep kind 'variant' and read as plain shwarms. Old 'lobby_filled' events stay in the log as history.
-- Their stats were rolled up as lobbies ("1 seat from kickoff.", a lobby score), and the stats job only rolls a node
-- up again once it changes or its stale_at comes, so a quiet one would keep them. Mark them due now (first, while
-- the rows still say 'lobby'), without moving changed_at, which is their last activity.
UPDATE node_stats SET stale_at = '1970-01-01T00:00:00.000Z' WHERE node_id IN (SELECT id FROM node WHERE state = 'lobby');
UPDATE node SET state = 'live', live_at = COALESCE(live_at, created_at) WHERE state = 'lobby';
