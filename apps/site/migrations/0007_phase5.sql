-- Expand only (go-live phase 5, slice S1). Adds two columns and an index; drops and renames nothing.

-- Why a submission used an earlier post: the protocol's built_on {post, note} (protocol §7). NULL when none was given.
ALTER TABLE built_on ADD COLUMN note TEXT;

-- The optional release fields a submitter fills (table B #64: name, version, how to use). Name and version go in the
-- existing release_title and release_version; how to use had no column. The result page reads them from the passing one.
ALTER TABLE submission ADD COLUMN release_how_to_use TEXT;

-- A submission's sign-off items are marked done when it passes, fails or is replaced (core/context.ts signOffDoneStatement).
CREATE INDEX inbox_sign_off ON inbox_item (post_id) WHERE kind = 'sign_off';
