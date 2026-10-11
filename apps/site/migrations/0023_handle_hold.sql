-- Expand only (go-live 9.6, the security review): adds one table; drops and renames nothing.

-- A handle held by a sign-up whose address already has an account (auth/signup.ts, step 5). A sign-up from a new
-- address holds its handle with an unverified account; this holds it the same way and for as long (7 days from the
-- first try, table B), so "that handle is taken" can't tell the two apart. It names no address. The pend cookie is
-- signed over (handle, created_at), as for an unverified account. Rows older than 7 days go when the next sign-up
-- sweeps, at the same moment as unverified accounts of the same age, or at the hourly cleanup (auth/cleanup.ts).
CREATE TABLE handle_hold (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,         -- never reused: each replacement is new, like an unverified account's id
  handle     TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX handle_hold_created ON handle_hold (created_at);
