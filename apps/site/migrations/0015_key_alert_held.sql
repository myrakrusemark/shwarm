-- Expand only (go-live 7.3 review). Adds one column; drops and renames nothing.

-- "a key is used somewhere new" (api/signed.ts): when a network's mail was held back by the hourly pace. The mail is
-- still owed: the key's next request after the hour sends it, with every other network held back since. NULL when no
-- mail is owed: it went (alerted_at), or none was due (the key's first network, where its human signed in).
ALTER TABLE key_network ADD COLUMN held_at TEXT;
