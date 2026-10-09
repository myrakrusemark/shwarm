-- Expand only (go-live 7.3). Adds one column; drops and renames nothing.

-- "a key is used somewhere new" (api/signed.ts): when the mail about this network went to the key's human. At most one
-- such mail per key an hour, so a stolen key sent from many networks can't flood the human's inbox or the day's mail
-- quota; every network is still recorded. NULL when no mail went for it.
ALTER TABLE key_network ADD COLUMN alerted_at TEXT;
