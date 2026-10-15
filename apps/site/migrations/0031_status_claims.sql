-- Decided Oct 14, "A branch's status: on track by vote, the rest by claims people back, with a rubber band" and "Only
-- people on a branch vote on its status". Expand only: adds two columns, one table and two indexes, drops and renames
-- nothing. Then four data steps.
-- A claim is a thread post on a branch that says the branch is blocked, passed or a dead end, with the claimant's
-- evidence as its text. It stays kind 'post' (kind already has 'dead_end', a shwarm's dead-end note); the claim is a
-- marker beside it, as is_join and pinned_at are.
ALTER TABLE post ADD COLUMN claim TEXT CHECK (claim IS NULL OR claim IN ('blocked', 'passed', 'dead_end'));
CREATE INDEX post_claim ON post (node_id, claim) WHERE claim IS NOT NULL;

-- status_vote holds each person's one backing on a branch (the primary key keeps it one): status 'on_track' with no
-- claim_id is their on-track vote; blocked, passed or dead_end with claim_id set backs that claim post.
ALTER TABLE status_vote ADD COLUMN claim_id TEXT REFERENCES post (id); -- the claim backed; NULL for an on-track vote
CREATE INDEX status_vote_claim ON status_vote (claim_id) WHERE claim_id IS NOT NULL;

-- The rubber band's state as of `at` (core/status.ts advance): the branch's current status, the challenger gathering
-- lead-hours, how many, and since when its lead has been 2 or more. Every write that changes a branch's backing first
-- advances it to then with the backing as it was, and saves it here. A branch with no row is on track, nothing gathered.
CREATE TABLE branch_status (
  node_id        INTEGER PRIMARY KEY REFERENCES node (id),
  current        TEXT NOT NULL DEFAULT 'on_track' CHECK (current IN ('on_track', 'blocked', 'passed', 'dead_end')),
  challenger     TEXT CHECK (challenger IS NULL OR challenger IN ('on_track', 'blocked', 'passed', 'dead_end')),
  lead_hours     REAL NOT NULL DEFAULT 0,
  leading_since  TEXT,                                  -- when the challenger's lead last reached 2; NULL below 2
  changed_at     TEXT,                                  -- when the current status became current; NULL: on track from the start
  at             TEXT NOT NULL                          -- the moment this state is true at
);

-- Blocked, passed and dead-end votes carried no evidence: they go (a builder's default, Oct 14). On-track votes stay,
-- but only from people who joined the branch (an active seat, made there or through a sub-branch).
DELETE FROM status_vote WHERE status <> 'on_track';
DELETE FROM status_vote WHERE NOT EXISTS (
  SELECT 1 FROM seat s WHERE s.node_id = status_vote.node_id AND s.person_id = status_vote.person_id AND s.left_at IS NULL
);

-- A branch takes no submissions or checks any more: one left in review is history, superseded by the branch's claims
-- (with no later submission to name), so neither the branch nor the submission reads "in review" (a builder's default).
UPDATE submission SET status = 'superseded'
WHERE status = 'in_review' AND node_id IN (SELECT id FROM node WHERE kind = 'branch');
UPDATE node SET in_review = 0 WHERE kind = 'branch' AND in_review <> 0;
