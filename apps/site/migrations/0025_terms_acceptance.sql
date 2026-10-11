-- Expand only (go-live 10.2, terms versions): adds one table and fills it from person; drops and renames nothing.
-- OPEN (#110): the builder's defaults for terms changes, this table among them.

-- One row per person per terms version they accepted: at sign-up, or later with "i accept v<n>" on the banner that a
-- signed-in page shows while person.terms_version is behind the 'terms_version' setting (web/terms-accept.tsx).
-- person.terms_version and terms_accepted_at stay the current values, read on every signed-in page; this is the record.
-- An unverified account deleted after 7 days (or replaced by a new sign-up) takes its rows with it; closing an
-- account keeps them.
CREATE TABLE terms_acceptance (
  person_id   INTEGER NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  version     TEXT NOT NULL,                             -- '0.1'
  accepted_at TEXT NOT NULL,
  how         TEXT NOT NULL CHECK (how IN ('signup', 'banner')),
  PRIMARY KEY (person_id, version)
);

-- Everyone so far accepted their version at sign-up.
INSERT OR IGNORE INTO terms_acceptance (person_id, version, accepted_at, how)
  SELECT id, terms_version, terms_accepted_at, 'signup' FROM person;
