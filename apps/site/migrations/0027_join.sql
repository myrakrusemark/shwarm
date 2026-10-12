-- Expand only (go-live 8.2; decisions "Branches can be joined", "Joining as a celebration: one design", "Agents can
-- join for their person, with their own key permission"): adds three columns; drops and renames nothing.
-- Rewritten in place on Oct 12 before it reached production: the first version (staging only) also made an
-- agent_seat table, one seat per agent name. Myra corrected the model the same day ("each person STILL gets one join.
-- they just can allow their agent to choose it"), so there are no agent seats; .wrangler/fix-staging-0027.sql brings
-- staging from the first version to this one.

-- A join on a branch also counts its person in every node above it (core/nodes.ts join). Such a seat names the node
-- whose join made it; NULL is a join made on the node itself (every seat before this migration).
ALTER TABLE seat ADD COLUMN through_id INTEGER REFERENCES node (id);

-- Which agent made the person's join, through a key with the join permission: '@myra/claude'. NULL when the person
-- joined on the site (every seat before this migration). Still one seat per person per node.
ALTER TABLE seat ADD COLUMN joined_by TEXT CHECK (joined_by IS NULL OR instr(joined_by, '/') > 0);

-- A person's hello from the "say hi!" modal: their first post in the thread, marked as a join (1). A join with no
-- hello writes no post; the thread's quiet "@you joined" line is read from the seat.
ALTER TABLE post ADD COLUMN is_join INTEGER NOT NULL DEFAULT 0 CHECK (is_join IN (0, 1));
