-- Expand only (go-live 9.3, the report half; Myra, Oct 10: "build the report link before testers arrive"). Adds one
-- column and one index; drops and renames nothing.

-- The reason someone picked (core/reports.ts REASONS): the four hard blocks (spam, weapons, surveillance,
-- protected_assets), illegal, copyright, personal_info, other. `kind` stays the legal bucket the queue sorts by. No
-- CHECK, so a new reason needs no migration; the code checks it. NULL on a DM's report (core/dm.ts reportDm) and on
-- rows from before this.
ALTER TABLE report ADD COLUMN reason TEXT;

-- One report per person per post. A signed-out report (person_id NULL) or one with no post (a DM, or an address that
-- isn't a post) is never held to it.
CREATE UNIQUE INDEX report_one_per_post ON report (post_id, person_id) WHERE post_id IS NOT NULL AND person_id IS NOT NULL;
