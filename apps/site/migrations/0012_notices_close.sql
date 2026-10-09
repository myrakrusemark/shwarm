-- Expand only (go-live 6.3, 6.4). Adds one column and two indexes; drops and renames nothing.

-- The daily digest of mentions (jobs/digest.ts): the end of the window the last digest covered. The next digest takes
-- the unread mentions after it, up to that day's digest time. NULL until the first digest: the window is then one day.
ALTER TABLE person ADD COLUMN digest_at TEXT;

-- The digest sweep finds the people with unread mentions in the day's window by when the mentions came in.
CREATE INDEX inbox_mention_created ON inbox_item (created_at) WHERE kind = 'mention';

-- Closing an account (auth/close.ts) deletes its mail rows, which hold its address: by person, with no scan.
CREATE INDEX email_outbox_person ON email_outbox (person_id);
