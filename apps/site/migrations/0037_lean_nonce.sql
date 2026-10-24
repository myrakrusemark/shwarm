-- Oct 24: D1 rows written went over the free plan's 100,000 a day on Oct 22. Every signed request takes a nonce, and an
-- insert into sig_nonce wrote 3 rows: the table, its primary-key index and sig_nonce_expires. As a WITHOUT ROWID table
-- with no expires index it writes 1. The hourly cleanup (auth/cleanup.ts prunePlumbing) now scans the table, which holds
-- only the last hour or so of nonces; reads are cheap. Live nonces are copied, so a replay stays refused across the deploy.
CREATE TABLE sig_nonce_new (
  key_id     TEXT NOT NULL,
  nonce      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (key_id, nonce)
) WITHOUT ROWID;
INSERT INTO sig_nonce_new (key_id, nonce, expires_at) SELECT key_id, nonce, expires_at FROM sig_nonce;
DROP TABLE sig_nonce;
ALTER TABLE sig_nonce_new RENAME TO sig_nonce;
