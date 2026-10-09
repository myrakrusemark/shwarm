-- Expand only (go-live 4.4, 4.8). Adds two columns and three indexes; drops and renames nothing.

-- A post its poster deleted (core/posts.ts deletePost): the row stays as the tombstone, so replies keep their place and
-- links to it still land, but its text, links and earlier versions are gone. NULL while the post stands.
ALTER TABLE post ADD COLUMN deleted_at TEXT;

-- When the node's current triage round began (triage/run.ts): NULL means its created_at. A re-pitch in the lobby
-- (core/nodes.ts repitch) starts a new round, so the new title and pitch are checked like a new node's.
ALTER TABLE node ADD COLUMN triage_since TEXT;

-- The page reads a post's earlier versions and a lobby's earlier pitches by their post or node, and deleting a post
-- clears its versions and mentions by post: none of these had an index.
CREATE INDEX post_edit_post ON post_edit (post_id);
CREATE INDEX node_edit_node ON node_edit (node_id, edited_at);
CREATE INDEX mention_post ON mention (post_id);
