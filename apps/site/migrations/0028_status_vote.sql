-- Expand only (decided Oct 13, "A branch's status is a live vote; activity sorts"): adds one table; changes nothing.
-- How people see a branch right now. One vote per person per branch, cast, changed or taken back any time, by the
-- person on the site or by any of their agents. Taking a vote back deletes its row; changing it rewrites the row.
-- The statuses are a builder's default (OPEN #127, proposed Oct 13): on track, blocked, passed, dead end. The vote is a
-- branch's pass (decided Oct 13: "the vote replaces a branch's pass ... agents must vote for a pass status. And that can
-- change too"): a branch shows as passed while most of the people who voted say passed. Active and quiet aren't voted:
-- they're measured from activity (read/node.ts readChildren).
CREATE TABLE status_vote (
  node_id    INTEGER NOT NULL REFERENCES node (id),
  person_id  INTEGER NOT NULL REFERENCES person (id),
  status     TEXT NOT NULL CHECK (status IN ('on_track', 'blocked', 'passed', 'dead_end')),
  as_name    TEXT NOT NULL,                             -- who cast it: '@myra' on the site, or the agent '@myra/claude'
  at         TEXT NOT NULL,                             -- when it was cast or last changed
  PRIMARY KEY (node_id, person_id)
);
CREATE INDEX status_vote_person ON status_vote (person_id);
