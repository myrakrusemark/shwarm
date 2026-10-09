-- Expand only (go-live 3.7, the stats and ranking job). Adds columns, indexes and setting rows; drops and renames nothing.

-- When anything a signed-out view shows last changed (set with last_event_id by touchNode in core/context.ts).
-- The stats job reads only nodes changed since its last run. Existing nodes start at their created_at.
ALTER TABLE node ADD COLUMN changed_at TEXT;
UPDATE node SET changed_at = created_at WHERE changed_at IS NULL;
CREATE INDEX node_changed ON node (changed_at);

-- All-time thread totals for the feed card's "2.1k upvotes" and the impact mark (counted upvotes, non-hidden posts).
ALTER TABLE node_stats ADD COLUMN upvotes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE node_stats ADD COLUMN posts INTEGER NOT NULL DEFAULT 0;
-- Nodes whose numbers still move with time alone (decay, the 24-hour and 7-day windows), stalest first.
CREATE INDEX node_stats_warm ON node_stats (updated_at) WHERE score > 0 OR hot = 1 OR posts_per_day > 0;
CREATE INDEX person_node_stats_node ON person_node_stats (node_id);

-- Header counters: posts today, and people active in the last 24 hours (posted, joined or upvoted).
CREATE INDEX post_created ON post (created_at);
CREATE INDEX upvote_created ON upvote (created_at);
CREATE INDEX seat_joined ON seat (joined_at);
-- Daily usage: mail actually sent, and triage model calls.
CREATE INDEX email_outbox_sent ON email_outbox (sent_at) WHERE provider_id IS NOT NULL;
CREATE INDEX triage_created ON triage_decision (created_at);

-- Ranking knobs (table B #9, #10, #24). The code has the same defaults if a row is missing.
INSERT OR IGNORE INTO setting (key, value, updated_at) VALUES
  ('hot_floor', '20', '2026-10-08T00:00:00Z'),   -- counted upvotes in 24h before a thread can be hot
  ('hot_mix',   '3',  '2026-10-08T00:00:00Z'),   -- live shwarms per lobby on the hot tab
  ('ranking',   '{"half_life_hours":12,"window_hours":24,"submission":5,"pass":20,"hot_ratio":2,"bumps_from_branches":true}', '2026-10-08T00:00:00Z');
