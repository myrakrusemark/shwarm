-- Expand only (go-live 9.3, the flag half; A7): "flag this shwarm" on shwarm and branch pages, one per person per node
-- (core/flags.ts). Adds one index; drops and renames nothing.

-- The flag table's UNIQUE (node_id, post_id, person_id) doesn't hold a node's flags to one per person: SQLite treats
-- the NULL post_id as distinct every time. This does, for flags on a node (post_id NULL). It also serves the count of a
-- node's open flags that pauses it at three from established accounts.
CREATE UNIQUE INDEX flag_one_per_node ON flag (node_id, person_id) WHERE post_id IS NULL;
