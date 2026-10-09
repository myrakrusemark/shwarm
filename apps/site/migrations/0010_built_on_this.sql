-- Expand only (go-live 5.7). Adds one index; drops and renames nothing.

-- "built on this" on a closed shwarm's result page (read/result.ts readBuiltOnThis) and its ETag (readTreeVersion) find
-- the shwarms whose builds_on names it ({node: <path>}). Without this, each read scanned every node.
CREATE INDEX node_builds_on_node ON node (json_extract(builds_on, '$.node'));
