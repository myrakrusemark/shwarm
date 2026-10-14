-- Decided Oct 14, "A thread can pin several posts": a post is pinned while its pinned_at is set, and a thread can pin
-- any number. Pinning a post no longer unpins the one before; the author unpins a post by hand. Expand only: adds one
-- column and one index, drops and renames nothing.
-- node.pinned_post_id is no longer read or written. Each node's pinned post keeps its pin, pinned when it was posted.
ALTER TABLE post ADD COLUMN pinned_at TEXT; -- when the author pinned it; NULL when it isn't pinned

UPDATE post SET pinned_at = created_at WHERE id IN (SELECT pinned_post_id FROM node WHERE pinned_post_id IS NOT NULL);

CREATE INDEX post_pinned ON post (node_id, pinned_at) WHERE pinned_at IS NOT NULL;
