-- Decided Oct 17, "No badge until someone votes" (Myra: "if nobody has voted on a shwarm or branch, why is it on track
-- by default? i think it should be no badge at all"). A node has no status until someone backs one: the first status
-- anyone backs becomes the status at once while no one backs another, and the rubber band runs from there
-- (core/status.ts advance). Two tables take a NULL status, and the nodes that were on track only by default lose it.
-- SQLite can't drop a NOT NULL in place, so both tables are rebuilt with every row kept; nothing else changes. Not
-- expand-only: code from before this can't read a NULL status, so a rollback past it restores the data with D1 time
-- travel too (docs/runbook.md).
PRAGMA defer_foreign_keys = true;

-- The band: `current` NULL while the node has no status.
CREATE TABLE branch_status_new (
  node_id        INTEGER PRIMARY KEY REFERENCES node (id),
  current        TEXT CHECK (current IS NULL OR current IN ('on_track', 'blocked', 'passed', 'dead_end')),  -- NULL: no status yet
  challenger     TEXT CHECK (challenger IS NULL OR challenger IN ('on_track', 'blocked', 'passed', 'dead_end')),
  lead_hours     REAL NOT NULL DEFAULT 0,
  leading_since  TEXT,                                  -- when the challenger's lead last reached 2; NULL below 2
  changed_at     TEXT,                                  -- when the current status became current; NULL while there's none
  at             TEXT NOT NULL                          -- the moment this state is true at
);
INSERT INTO branch_status_new (node_id, current, challenger, lead_hours, leading_since, changed_at, at)
SELECT node_id, current, challenger, lead_hours, leading_since, changed_at, at FROM branch_status;
DROP TABLE branch_status;
ALTER TABLE branch_status_new RENAME TO branch_status;

-- The history: `from_status` NULL on a node's first status ("no status → on track"). Append-only as before. A crowd
-- pass record points at its change (pass_record.change_id): the link is set aside while the table is rebuilt, since
-- dropping the old table would count against it even once the new one has the same rows, and put back after.
CREATE TABLE pass_record_change_0036 (record_id TEXT PRIMARY KEY, change_id TEXT NOT NULL);
INSERT INTO pass_record_change_0036 SELECT id, change_id FROM pass_record WHERE change_id IS NOT NULL;
UPDATE pass_record SET change_id = NULL WHERE change_id IS NOT NULL;
CREATE TABLE status_change_new (
  id           TEXT PRIMARY KEY,                     -- h_…
  node_id      INTEGER NOT NULL REFERENCES node (id),
  at           TEXT NOT NULL,                        -- the moment the status changed, not when this row was written
  from_status  TEXT CHECK (from_status IS NULL OR from_status IN ('on_track', 'blocked', 'passed', 'dead_end')),  -- NULL: its first status
  to_status    TEXT NOT NULL CHECK (to_status IN ('on_track', 'blocked', 'passed', 'dead_end')),
  claim_id     TEXT REFERENCES post (id),            -- the most-backed claim of to_status then; NULL for on track
  backers      INTEGER NOT NULL,                     -- of to_status then
  against      INTEGER NOT NULL,                     -- of from_status then (of the next most-backed status, for a first)
  written_at   TEXT NOT NULL,
  written_by   TEXT NOT NULL CHECK (written_by IN ('act', 'job', 'migration')),
  UNIQUE (node_id, at)
);
INSERT INTO status_change_new (id, node_id, at, from_status, to_status, claim_id, backers, against, written_at, written_by)
SELECT id, node_id, at, from_status, to_status, claim_id, backers, against, written_at, written_by FROM status_change;
DROP TRIGGER status_change_no_update;
DROP TRIGGER status_change_no_delete;
DROP TABLE status_change;
ALTER TABLE status_change_new RENAME TO status_change;
CREATE TRIGGER status_change_no_update BEFORE UPDATE ON status_change BEGIN
  SELECT RAISE(ABORT, 'status_change is append-only');
END;
CREATE TRIGGER status_change_no_delete BEFORE DELETE ON status_change BEGIN
  SELECT RAISE(ABORT, 'status_change is append-only');
END;
UPDATE pass_record SET change_id = (SELECT c.change_id FROM pass_record_change_0036 c WHERE c.record_id = pass_record.id)
WHERE id IN (SELECT record_id FROM pass_record_change_0036);
DROP TABLE pass_record_change_0036;

-- A node that never changed status was on track only by default: it has none now. Its band keeps its moment and what
-- a challenger gathered; the next read, act or stats job run gives it a status at once if exactly one status is backed.
UPDATE branch_status SET current = NULL WHERE changed_at IS NULL;

-- Every node's numbers are due now: the stats job (jobs/stats.ts) writes those first statuses and redoes every status
-- line, which counted branches with no status as on track, a batch at a time.
UPDATE node_stats SET stale_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
