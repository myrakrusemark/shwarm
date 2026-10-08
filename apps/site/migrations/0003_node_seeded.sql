-- Expand only: mark nodes made by the launch seed import (A18), so they don't count against
-- the seeder's 3-a-day limit (table B #4). Existing rows were all made on the site: 0.
ALTER TABLE node ADD COLUMN seeded INTEGER NOT NULL DEFAULT 0 CHECK (seeded IN (0, 1));
CREATE INDEX node_author_created ON node (author_id, created_at);
