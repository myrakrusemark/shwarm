-- Decided Oct 15, "'Pin' means only pinning a post: 'pinned work' is renamed 'the work', and a passed node's claim is
-- pinned to the top of its thread", and "a status change notifies the people on a node in their inbox" (#138). Expand
-- only: adds three columns, drops and renames nothing; then one data step.

-- Who pinned a pinned post: NULL is its node's author, by hand (every pin before today); 'site' is the site, which pins
-- the claim a pass cites when a node's status becomes passed (core/status.ts flipStatements) and unpins it, only if it
-- still has this mark, when the status moves away from passed. Pinning or unpinning by hand clears the mark.
ALTER TABLE post ADD COLUMN pinned_by TEXT CHECK (pinned_by IS NULL OR pinned_by = 'site');

-- A status-change notice (kind 'system'): the node's new status, so the inbox writes its words when it shows them
-- (web/profile.tsx), with the claimant's name as it reads then. NULL on every other item.
ALTER TABLE inbox_item ADD COLUMN status_to TEXT CHECK (status_to IS NULL OR status_to IN ('on_track', 'blocked', 'passed', 'dead_end'));

-- The shwarm author's own approval as the feed card shows it ("✓ author approved", decided Oct 15): JSON {at, claim:
-- {post, by} | null}, or NULL; rolled up by the stats job (jobs/stats.ts), as the hot badge is, so the feed never reads a
-- thread's posts.
ALTER TABLE node_stats ADD COLUMN author_approved TEXT;

-- A node that is passed now gets the claim its latest crowd pass cites pinned, as the site does from today on: when it
-- still shows, isn't a reply, and isn't pinned already (a pin by hand stays the author's).
UPDATE post SET pinned_at = (
    SELECT r.at FROM pass_record r WHERE r.claim_id = post.id AND r.kind = 'crowd' ORDER BY r.at DESC LIMIT 1),
  pinned_by = 'site'
WHERE pinned_at IS NULL AND hidden = 0 AND deleted_at IS NULL AND reply_to IS NULL AND claim = 'passed'
  AND id IN (
    SELECT (SELECT r.claim_id FROM pass_record r WHERE r.node_id = b.node_id AND r.kind = 'crowd' AND r.status = 'passed'
            ORDER BY r.at DESC, r.rowid DESC LIMIT 1)
    FROM branch_status b WHERE b.current = 'passed');

-- Their status lines, and every approved shwarm's card, are rolled up again by the next stats runs (jobs/stats.ts).
UPDATE node_stats SET stale_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE node_id IN (SELECT node_id FROM post WHERE pinned_by = 'site')
   OR node_id IN (SELECT node_id FROM pass_record WHERE kind = 'author' AND status = 'passed');
