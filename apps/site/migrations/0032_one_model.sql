-- Decided Oct 14, "One model for every node: claims and the rubber band decide a shwarm too; a pass is a dated record
-- with pinned work; nothing locks", and "With nothing locking: build on any shwarm, a pass box in place of the result
-- page, a passed tab". Expand only: adds two tables, their indexes and two triggers, drops and renames nothing; then
-- the data steps, in order. branch_status keeps its name and now holds shwarms' bands too.

-- Every change of a node's status, as a dated line: the exact moment the rubber band moved it (core/status.ts
-- advance), from what to what, the most-backed claim of the new status then (none for on track) and both sides'
-- backers. Written by whoever first advances the band past that moment: an act in the node's tree, the stats job, or
-- this migration; keyed on (node, moment), so it's written once. Append-only, like audit_event, and it holds no text.
CREATE TABLE status_change (
  id           TEXT PRIMARY KEY,                     -- h_…
  node_id      INTEGER NOT NULL REFERENCES node (id),
  at           TEXT NOT NULL,                        -- the moment the status changed, not when this row was written
  from_status  TEXT NOT NULL CHECK (from_status IN ('on_track', 'blocked', 'passed', 'dead_end')),
  to_status    TEXT NOT NULL CHECK (to_status IN ('on_track', 'blocked', 'passed', 'dead_end')),
  claim_id     TEXT REFERENCES post (id),            -- the most-backed claim of to_status then; NULL for on track
  backers      INTEGER NOT NULL,                     -- of to_status then
  against      INTEGER NOT NULL,                     -- of from_status then
  written_at   TEXT NOT NULL,
  written_by   TEXT NOT NULL CHECK (written_by IN ('act', 'job', 'migration')),
  UNIQUE (node_id, at)
);
CREATE TRIGGER status_change_no_update BEFORE UPDATE ON status_change BEGIN
  SELECT RAISE(ABORT, 'status_change is append-only');
END;
CREATE TRIGGER status_change_no_delete BEFORE DELETE ON status_change BEGIN
  SELECT RAISE(ABORT, 'status_change is append-only');
END;

-- A pass, as a dated record that locks nothing (core/records.ts): the crowd's, when a node's status becomes passed
-- (change_id, its claim, its backers then); the shwarm author's own mark, citing a passed claim (by_name, person_id);
-- or, from this migration, an author's pass or dead end from before Oct 14 (submission_id: the passed submission;
-- note_post_id: the dead-end note). pins is a copy of the claim's (or that submission's) links as they were, never the
-- claim's text, so the record outlives the claim (a builder's default).
CREATE TABLE pass_record (
  id            TEXT PRIMARY KEY,                    -- r_…
  node_id       INTEGER NOT NULL REFERENCES node (id),
  kind          TEXT NOT NULL CHECK (kind IN ('crowd', 'author')),
  status        TEXT NOT NULL CHECK (status IN ('passed', 'dead_end')),  -- dead_end only on a migrated author's record
  at            TEXT NOT NULL,                       -- "passed as of"
  change_id     TEXT REFERENCES status_change (id),  -- the crowd's: the change it records
  claim_id      TEXT REFERENCES post (id),           -- the crowd's: the most-backed passed claim then; the author's: the one cited
  submission_id TEXT REFERENCES post (id),           -- migrated: the passed submission
  note_post_id  TEXT REFERENCES post (id),           -- migrated: the dead-end note
  backers       INTEGER NOT NULL DEFAULT 0,
  pins          TEXT NOT NULL DEFAULT '[]',          -- JSON Link[] (core/text.ts parsePins)
  by_name       TEXT,                                -- the author's: '@myra'
  person_id     INTEGER REFERENCES person (id),
  UNIQUE (node_id, kind, at)
);
CREATE INDEX pass_record_node ON pass_record (node_id, at);
CREATE INDEX pass_record_claim ON pass_record (claim_id) WHERE claim_id IS NOT NULL;
CREATE INDEX pass_record_submission ON pass_record (submission_id) WHERE submission_id IS NOT NULL;

-- (a) A band under a locked node froze when it locked. Unlocked, it would take credit for the whole locked time and
-- could change the moment it's read: it starts again from now, keeping its status and its backing.
UPDATE branch_status
SET at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), challenger = NULL, lead_hours = 0, leading_since = NULL
WHERE node_id IN (
  SELECT n.id FROM node n JOIN node up ON up.state <> 'live' AND (up.id = n.id OR substr(n.path, 1, length(up.path) + 1) = up.path || '/'));

-- (b) A node that passed or was marked a dead end keeps that as its status and as a record of its author's: the
-- passed submission's links are its pins; the dead-end note is its note. The line in its history comes first, from the
-- status it had before.
INSERT INTO status_change (id, node_id, at, from_status, to_status, claim_id, backers, against, written_at, written_by)
SELECT 'h_' || lower(hex(randomblob(5))), n.id, COALESCE(n.closed_at, n.changed_at, n.created_at),
       COALESCE(b.current, 'on_track'), CASE n.state WHEN 'closed' THEN 'passed' ELSE 'dead_end' END,
       NULL, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migration'
FROM node n LEFT JOIN branch_status b ON b.node_id = n.id
WHERE n.state IN ('closed', 'dead_end') AND COALESCE(b.current, 'on_track') <> CASE n.state WHEN 'closed' THEN 'passed' ELSE 'dead_end' END;

INSERT INTO pass_record (id, node_id, kind, status, at, submission_id, note_post_id, backers, pins, by_name, person_id)
SELECT 'r_' || lower(hex(randomblob(5))), x.id, 'author', x.status, x.at, x.sub, x.note, 0,
       COALESCE((SELECT p.links FROM post p WHERE p.id = x.sub), '[]'), '@' || pr.handle, x.author_id
FROM (
  SELECT n.id, n.author_id, CASE n.state WHEN 'closed' THEN 'passed' ELSE 'dead_end' END AS status,
         COALESCE(n.closed_at, n.changed_at, n.created_at) AS at,
         CASE WHEN n.state = 'closed' THEN
           (SELECT s.post_id FROM submission s WHERE s.node_id = n.id AND s.status = 'passed' ORDER BY s.decided_at DESC, s.number DESC LIMIT 1)
         END AS sub,
         CASE WHEN n.state = 'dead_end' THEN
           (SELECT d.id FROM post d WHERE d.node_id = n.id AND d.kind = 'dead_end' ORDER BY d.created_at DESC, d.id DESC LIMIT 1)
         END AS note
  FROM node n WHERE n.state IN ('closed', 'dead_end')) x
JOIN person pr ON pr.id = x.author_id;

INSERT INTO branch_status (node_id, current, challenger, lead_hours, leading_since, changed_at, at)
SELECT n.id, CASE n.state WHEN 'closed' THEN 'passed' ELSE 'dead_end' END, NULL, 0, NULL,
       COALESCE(n.closed_at, n.changed_at, n.created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM node n WHERE n.state IN ('closed', 'dead_end')
ON CONFLICT (node_id) DO UPDATE SET current = excluded.current, challenger = NULL, lead_hours = 0, leading_since = NULL,
  changed_at = excluded.changed_at, at = excluded.at;

-- (c) Nothing locks: every node is live. closed_at and dead_end_note stay, as history.
UPDATE node SET state = 'live' WHERE state <> 'live';

-- (d) Nothing takes submissions, checks or a sign-off: one left in review is history, superseded by the claims (with
-- no later submission to name), as 0031 did on branches; nothing reads "in review"; no sign-off waits on anyone, and
-- no sign-off mail still goes out.
UPDATE submission SET status = 'superseded' WHERE status = 'in_review';
UPDATE node SET in_review = 0 WHERE in_review <> 0;
UPDATE inbox_item SET done_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE kind = 'sign_off' AND done_at IS NULL;
DELETE FROM email_outbox WHERE template = 'sign_off_ready' AND sent_at IS NULL;

-- (e) Every node's numbers and status line are rolled up again by the next stats runs (jobs/stats.ts, a bounded number
-- a run), which also writes any change of status that comes due with time alone.
UPDATE node_stats SET stale_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
