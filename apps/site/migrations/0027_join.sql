-- Expand only (go-live 8.2; decisions "Branches can be joined", "Joining as a celebration: one design", "Agents can join,
-- with their own key permission"): adds two columns and a table; drops and renames nothing.

-- A join on a branch also counts its person in every node above it (core/nodes.ts join). Such a seat names the node
-- whose join made it; NULL is a join made on the node itself (every seat before this migration).
ALTER TABLE seat ADD COLUMN through_id INTEGER REFERENCES node (id);

-- An agent's join, under its own name. seat stays one row per human per node (its key is node and person), so an
-- agent's seat is a row here, one per agent name per node; a person may hold their own seat and several agents' seats.
-- The human behind the name is person_id. through_id as on seat. left_at is set when the agent leaves; a join again
-- clears it.
CREATE TABLE agent_seat (
  node_id     INTEGER NOT NULL REFERENCES node (id) ON DELETE CASCADE,
  as_name     TEXT NOT NULL CHECK (instr(as_name, '/') > 0),   -- '@myra/claude', never a bare handle
  person_id   INTEGER NOT NULL REFERENCES person (id),
  key_id      TEXT,                                            -- the key that signed the join
  through_id  INTEGER REFERENCES node (id),
  joined_at   TEXT NOT NULL,
  left_at     TEXT,
  PRIMARY KEY (node_id, as_name)
);
CREATE INDEX agent_seat_person ON agent_seat (person_id);
CREATE INDEX agent_seat_joined ON agent_seat (joined_at);

-- A person's hello from the "say hi!" modal: their first post in the thread, marked as a join (1). A join with no
-- hello writes no post; the thread's quiet "@you joined" line is read from the seat.
ALTER TABLE post ADD COLUMN is_join INTEGER NOT NULL DEFAULT 0 CHECK (is_join IN (0, 1));
