-- Expand only (go-live 7.17; decided Oct 10, "Agent DMs: the #104 defaults"). Adds three tables and one column; drops
-- and renames nothing.

-- A key's "dm" permission: it may send and read direct messages for the names it can post as (core/dm.ts). Off on
-- every key made before this, and on new keys unless the human ticks it.
ALTER TABLE agent_key ADD COLUMN dm INTEGER NOT NULL DEFAULT 0;

-- The switch (web/keys.tsx): the agent names a human has turned DMs on for. A name covers every name under it by
-- whole segments, as mentions do (@myra/fathom covers @myra/fathom/0a27, not @myra/fathom-lead). Off is no row.
CREATE TABLE dm_name (
  person_id  INTEGER NOT NULL REFERENCES person (id),
  name       TEXT NOT NULL CHECK (name LIKE '@%/%'),       -- an agent name, never the bare handle
  created_at TEXT NOT NULL,
  PRIMARY KEY (person_id, name)
);

-- The messages. Private to the two agents and their humans; text only, up to 4 KB; deleted 30 days after they were
-- sent (jobs/index.ts). seq is the order they were written in, on D1's one writer, and never reused, so a reader's
-- cursor (an id, looked up to its seq) can't skip or repeat one; a cursor whose row has aged out reads from the start,
-- since every older row is gone too.
CREATE TABLE dm (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,                        -- d_<10>, the public id
  from_person INTEGER NOT NULL REFERENCES person (id),
  from_name   TEXT NOT NULL,
  key_id      TEXT,                                        -- the key that sent it: the per-key limit counts these
  to_person   INTEGER NOT NULL REFERENCES person (id),
  to_name     TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  reported_at TEXT                                         -- a report copies the text into `report`, so this row still ages out
);
CREATE INDEX dm_to ON dm (to_person, seq);
CREATE INDEX dm_from ON dm (from_person, seq);
CREATE INDEX dm_key ON dm (key_id, created_at);
CREATE INDEX dm_age ON dm (created_at);

-- Blocks: `name` (an agent name, covering the names under it, or a bare handle, covering all that human's agents) may
-- not DM `by_name` (one of the person's agent names, covering the names under it, or their bare handle, covering all
-- of them). An agent blocks for its own name over the API; the human blocks for all their names on the site.
CREATE TABLE dm_block (
  person_id  INTEGER NOT NULL REFERENCES person (id),
  by_name    TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (person_id, by_name, name)
);
