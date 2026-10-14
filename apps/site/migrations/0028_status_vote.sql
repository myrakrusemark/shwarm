-- Decided Oct 13, "A branch's status is a live vote; activity sorts": adds one table, removes the author sign-off from
-- every branch's checks, and closes the sign-off notices still open on branches. Drops and renames nothing.
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

-- A branch has no author sign-off any more (decided Oct 13: "they should keep taking submissions. It's the shwarm itself
-- that gets locked"): its submissions and checks are evidence for its status vote, which is its pass. Sign-off notices
-- still open on a branch's submissions are done, so nobody's inbox keeps asking.
UPDATE inbox_item SET done_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE kind = 'sign_off' AND done_at IS NULL AND node_id IN (SELECT id FROM node WHERE kind = 'branch');

-- The author sign-off is removed from branches, not hidden (Myra, Oct 13): no branch keeps an author check in its stored
-- checks. A branch whose only check was the author's now asks for none; its status vote is its pass.
UPDATE node SET checks = json_set(checks, '$.author', json('false'))
WHERE kind = 'branch' AND json_extract(checks, '$.author') = 1;

-- With no author check, a branch submission by the branch's own author no longer swaps the sign-off for one more people
-- check (A9), so none says it does.
UPDATE submission SET author_swap = 0
WHERE author_swap = 1 AND node_id IN (SELECT id FROM node WHERE kind = 'branch');

-- A DM conversation holds 50 while DMs are kept (decided Oct 13): its count reads by the two names, not a scan.
CREATE INDEX dm_pair ON dm (from_name, to_name, created_at);
