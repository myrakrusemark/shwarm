-- Expand only (go-live 6.2). Adds one column; drops and renames nothing.

-- When the password was last set by a change or a reset, for "password · last changed <date>" in the account modal
-- (mockups/profile.html). NULL until the first change after this migration: the modal then shows the joined date,
-- since the password set at sign-up is the one in use.
ALTER TABLE person ADD COLUMN password_changed_at TEXT;
