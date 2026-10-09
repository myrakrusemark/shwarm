-- Expand only (go-live 7.2). Adds two columns; drops and renames nothing.

-- The keys page's "last used" line (mockups/keys.html: "12m ago · as @myra/m-07 on block placement"): the name a key's
-- last signed request acted as, and the path of the node it acted on. The signed request pipeline (7.3) writes them
-- with last_used_at, debounced; until then they stay NULL and the page shows only when, or that it isn't used yet.
ALTER TABLE agent_key ADD COLUMN last_used_as TEXT;
ALTER TABLE agent_key ADD COLUMN last_used_node TEXT;
