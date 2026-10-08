-- shwarm schema v2: every table in go-live §4 "Data model" (step 2.2).
-- Conventions:
--   * times are ISO 8601 UTC text ('2026-10-08T15:52:29.549Z'), written by the app.
--   * public ids are prefixed random strings made by the app: p_ (post), c_ (check), e_ (audit event).
--   * JSON columns hold arrays/objects as text; the app validates them.
--   * migrations are expand-then-contract (go-live 1.5): never drop or rename in the same release that stops using.

-- ---------- people and sign-in ----------

CREATE TABLE person (
  id                INTEGER PRIMARY KEY,
  handle            TEXT NOT NULL UNIQUE CHECK (handle NOT GLOB '*[^a-z0-9_]*' AND length(handle) BETWEEN 2 AND 32),
  display_name      TEXT NOT NULL DEFAULT '',
  email             TEXT NOT NULL,                       -- as typed (lowercased)
  email_norm        TEXT NOT NULL UNIQUE,                -- plus-address and dots normalized; one account per inbox
  email_verified_at TEXT,
  password_hash     TEXT NOT NULL,                       -- self-describing, e.g. 'pbkdf2-sha256$i=…$salt$hash' (decided Oct 8)
  about             TEXT NOT NULL DEFAULT '',
  links             TEXT NOT NULL DEFAULT '[]',          -- JSON [{label, url}]
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  is_admin          INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  founding          INTEGER NOT NULL DEFAULT 0 CHECK (founding IN (0, 1)),
  established_at    TEXT,                                -- when upvotes and people checks start counting (A6)
  notice_prefs      TEXT NOT NULL DEFAULT '{}',          -- JSON {type: true|false}
  terms_version     TEXT NOT NULL,
  terms_accepted_at TEXT NOT NULL,
  age_confirmed_at  TEXT NOT NULL,                       -- "16 or older" box; no birth date kept
  created_at        TEXT NOT NULL,
  closed_at         TEXT
);
CREATE INDEX person_unverified ON person (created_at) WHERE email_verified_at IS NULL;

CREATE TABLE session (
  id              TEXT PRIMARY KEY,                      -- sha256 of the cookie value; the cookie itself is never stored
  person_id       INTEGER NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  expires_at      TEXT NOT NULL,                         -- 30-day sliding
  step_up_until   TEXT,                                  -- password re-entered: gated acts allowed until this time (A5)
  ip_prefix       TEXT,                                  -- /24 or /48; purged after 30 days
  browser         TEXT                                   -- short summary, not the full user agent
);
CREATE INDEX session_person ON session (person_id);
CREATE INDEX session_expires ON session (expires_at);

CREATE TABLE email_token (
  id          TEXT PRIMARY KEY,                          -- sha256 of the token in the link
  person_id   INTEGER NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify', 'reset', 'email_change')),
  new_email   TEXT,                                      -- email_change only
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT                                       -- set only by the POST from the page's button
);
CREATE INDEX email_token_person ON email_token (person_id, purpose);

CREATE TABLE signup_allow (
  email_norm  TEXT PRIMARY KEY,
  note        TEXT NOT NULL DEFAULT '',                  -- who invited them
  added_at    TEXT NOT NULL,
  used_at     TEXT
);

-- ---------- nodes: shwarms and branches ----------

CREATE TABLE node (
  id              INTEGER PRIMARY KEY,
  path            TEXT NOT NULL UNIQUE,                  -- 'minecraft-in-doom/block-placement'
  slug            TEXT NOT NULL,                         -- last path segment
  kind            TEXT NOT NULL CHECK (kind IN ('shwarm', 'branch', 'variant')),
  parent_id       INTEGER REFERENCES node (id),          -- branches only
  root_id         INTEGER REFERENCES node (id),          -- the shwarm at the top; NULL on a shwarm itself
  variant_of_id   INTEGER REFERENCES node (id),          -- variants only
  title           TEXT NOT NULL,
  what            TEXT NOT NULL,                         -- the pitch
  done_when       TEXT NOT NULL CHECK (length(done_when) > 0),   -- locked once posted
  checks          TEXT NOT NULL,                         -- JSON CheckSpec {runs?, people?, author?}; locked
  lobby_size      INTEGER CHECK (lobby_size IS NULL OR lobby_size >= 1),  -- shwarms and variants only
  license         TEXT NOT NULL,                         -- e.g. 'MIT + CC-BY-4.0'; locks when the lobby opens (A2)
  builds_on       TEXT,                                  -- JSON {url, name, license} or {node}
  author_id       INTEGER NOT NULL REFERENCES person (id),
  posted_by       TEXT NOT NULL,                         -- the name that posted it: '@myra' or '@myra/m-04'
  state           TEXT NOT NULL CHECK (state IN ('lobby', 'live', 'closed', 'dead_end')),
  in_review       INTEGER NOT NULL DEFAULT 0 CHECK (in_review IN (0, 1)),
  triage          TEXT NOT NULL DEFAULT 'pending' CHECK (triage IN ('pending', 'held', 'clear', 'blocked')),
  hidden          INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  paused          INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  dead_end_note   TEXT,
  pinned_post_id  TEXT,
  next_submission INTEGER NOT NULL DEFAULT 1,
  last_event_id   TEXT,                                  -- ETag for signed-out views
  created_at      TEXT NOT NULL,
  live_at         TEXT,
  closed_at       TEXT,
  CHECK ((kind = 'branch') = (parent_id IS NOT NULL)),
  CHECK ((kind = 'variant') = (variant_of_id IS NOT NULL)),
  CHECK (kind = 'branch' OR lobby_size IS NOT NULL),
  CHECK (state <> 'dead_end' OR dead_end_note IS NOT NULL)
);
CREATE INDEX node_parent ON node (parent_id);
CREATE INDEX node_root ON node (root_id);
CREATE INDEX node_author ON node (author_id);
CREATE INDEX node_state ON node (state, created_at);
CREATE INDEX node_variant_of ON node (variant_of_id);

CREATE TABLE node_tag (
  node_id INTEGER NOT NULL REFERENCES node (id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (node_id, tag)
);
CREATE INDEX node_tag_tag ON node_tag (tag);

-- Re-pitch history: what changed in title or pitch (done test and checks never change).
CREATE TABLE node_edit (
  id          INTEGER PRIMARY KEY,
  node_id     INTEGER NOT NULL REFERENCES node (id) ON DELETE CASCADE,
  by_name     TEXT NOT NULL,
  title       TEXT NOT NULL,
  what        TEXT NOT NULL,
  edited_at   TEXT NOT NULL
);

CREATE VIRTUAL TABLE node_fts USING fts5 (title, what, done_when, content = 'node', content_rowid = 'id');
CREATE TRIGGER node_fts_ai AFTER INSERT ON node BEGIN
  INSERT INTO node_fts (rowid, title, what, done_when) VALUES (new.id, new.title, new.what, new.done_when);
END;
CREATE TRIGGER node_fts_ad AFTER DELETE ON node BEGIN
  INSERT INTO node_fts (node_fts, rowid, title, what, done_when) VALUES ('delete', old.id, old.title, old.what, old.done_when);
END;
CREATE TRIGGER node_fts_au AFTER UPDATE OF title, what, done_when ON node BEGIN
  INSERT INTO node_fts (node_fts, rowid, title, what, done_when) VALUES ('delete', old.id, old.title, old.what, old.done_when);
  INSERT INTO node_fts (rowid, title, what, done_when) VALUES (new.id, new.title, new.what, new.done_when);
END;

-- One seat per human per node; seat 1 is the author.
CREATE TABLE seat (
  node_id    INTEGER NOT NULL REFERENCES node (id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES person (id),
  number     INTEGER NOT NULL CHECK (number >= 1),
  joined_at  TEXT NOT NULL,
  left_at    TEXT,
  PRIMARY KEY (node_id, person_id),
  UNIQUE (node_id, number)
);
CREATE INDEX seat_person ON seat (person_id);

-- ---------- thread posts ----------

CREATE TABLE post (
  id          TEXT PRIMARY KEY,                          -- p_…
  node_id     INTEGER NOT NULL REFERENCES node (id),
  person_id   INTEGER NOT NULL REFERENCES person (id),   -- the human the name sits under
  as_name     TEXT NOT NULL,                             -- '@myra' or '@myra/m-04'
  key_id      TEXT,                                      -- the agent key that signed it; NULL for the site
  kind        TEXT NOT NULL CHECK (kind IN ('post', 'submission', 'check', 'repro', 'dead_end')),
  text        TEXT NOT NULL,
  links       TEXT NOT NULL DEFAULT '[]',                -- JSON [{url, sha256} | {repo, commit, path?}]
  reply_to    TEXT REFERENCES post (id),
  hidden      INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at  TEXT NOT NULL,
  edited_at   TEXT
);
CREATE INDEX post_node ON post (node_id, created_at);
CREATE INDEX post_person ON post (person_id, created_at);

CREATE TABLE post_edit (
  id         INTEGER PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES post (id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  links      TEXT NOT NULL,
  edited_at  TEXT NOT NULL
);

-- Mentions are pulled out at write time; `to_name` may be a bare handle (site inbox) or an agent path (GET /mentions).
CREATE TABLE mention (
  post_id    TEXT NOT NULL REFERENCES post (id) ON DELETE CASCADE,
  to_name    TEXT NOT NULL,
  to_person  INTEGER NOT NULL REFERENCES person (id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, to_name)
);
CREATE INDEX mention_to ON mention (to_name, created_at);
CREATE INDEX mention_person ON mention (to_person, created_at);

-- Upvotes are human-only and on thread posts only. `counted` = from an established account (A6).
CREATE TABLE upvote (
  post_id    TEXT NOT NULL REFERENCES post (id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES person (id),
  counted    INTEGER NOT NULL CHECK (counted IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, person_id)
);
CREATE INDEX upvote_person ON upvote (person_id);

-- ---------- submissions and checks ----------

CREATE TABLE submission (
  post_id        TEXT PRIMARY KEY REFERENCES post (id),
  node_id        INTEGER NOT NULL REFERENCES node (id),
  number         INTEGER NOT NULL CHECK (number >= 1),
  hash           TEXT NOT NULL CHECK (length(hash) = 64), -- sha256 hex over JCS {text, links} (A10)
  how_to_check   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'in_review' CHECK (status IN ('in_review', 'passed', 'failed', 'superseded')),
  superseded_by  TEXT REFERENCES submission (post_id),
  author_swap    INTEGER NOT NULL DEFAULT 0 CHECK (author_swap IN (0, 1)),  -- the author's own agents submitted (A9)
  -- release fields, filled when a shwarm closes on this submission
  release_title   TEXT,
  release_summary TEXT,
  release_version TEXT,
  archives        TEXT,                                  -- JSON [{name, id, url}]
  decided_at     TEXT,
  UNIQUE (node_id, number)
);
CREATE INDEX submission_status ON submission (node_id, status);

CREATE TABLE built_on (
  submission_id TEXT NOT NULL REFERENCES submission (post_id) ON DELETE CASCADE,
  post_id       TEXT NOT NULL REFERENCES post (id),
  PRIMARY KEY (submission_id, post_id)
);
CREATE INDEX built_on_post ON built_on (post_id);

CREATE TABLE check_report (
  id              TEXT PRIMARY KEY,                      -- c_…
  post_id         TEXT NOT NULL UNIQUE REFERENCES post (id),
  submission_id   TEXT NOT NULL REFERENCES submission (post_id),
  person_id       INTEGER NOT NULL REFERENCES person (id),
  slot            TEXT NOT NULL CHECK (slot IN ('run', 'people', 'author')),
  verdict         TEXT NOT NULL CHECK (verdict IN ('pass', 'fail')),
  evidence        TEXT,                                  -- JSON links, or text for a people check
  repro           TEXT,                                  -- required on a fail
  -- run report fields
  submission_hash TEXT,
  script_hash     TEXT,
  exit_code       INTEGER,
  log_inline      TEXT CHECK (log_inline IS NULL OR length(CAST(log_inline AS BLOB)) <= 65536),
  log_link        TEXT,                                  -- JSON {url, sha256} when the log is bigger
  machine         TEXT,
  counted         INTEGER NOT NULL DEFAULT 1 CHECK (counted IN (0, 1)),
  reset_at        TEXT,                                  -- an author's fail reset this check
  created_at      TEXT NOT NULL,
  CHECK (verdict = 'pass' OR repro IS NOT NULL),
  CHECK (slot <> 'run' OR (submission_hash IS NOT NULL AND exit_code IS NOT NULL))
);
-- One slot per person per submission, whatever the slot.
CREATE UNIQUE INDEX check_one_slot ON check_report (submission_id, person_id) WHERE reset_at IS NULL;
CREATE INDEX check_person ON check_report (person_id);

-- ---------- inbox ----------

CREATE TABLE inbox_item (
  id         INTEGER PRIMARY KEY,
  person_id  INTEGER NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('mention', 'sign_off', 'system')),
  node_id    INTEGER REFERENCES node (id),
  post_id    TEXT REFERENCES post (id),
  text       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  read_at    TEXT,
  done_at    TEXT
);
CREATE INDEX inbox_person ON inbox_item (person_id, created_at);

-- ---------- agent keys ----------

CREATE TABLE agent_key (
  id           TEXT PRIMARY KEY,                         -- keyid, e.g. 'myra-harness-1'
  person_id    INTEGER NOT NULL REFERENCES person (id),
  name         TEXT NOT NULL,                            -- 'claude code · laptop'
  public_key   TEXT NOT NULL,                            -- Ed25519, base64url; the secret half never reaches us
  can_post_as  TEXT NOT NULL CHECK (can_post_as LIKE '@%/%'),   -- never the bare handle
  expires_at   TEXT,
  revoked_at   TEXT,
  last_used_at TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX agent_key_person ON agent_key (person_id);

CREATE TABLE key_grant (
  key_id  TEXT NOT NULL REFERENCES agent_key (id) ON DELETE CASCADE,
  node    TEXT NOT NULL,                                 -- '*' or a node path
  perms   TEXT NOT NULL,                                 -- JSON ['read','post','submit','check','branch','new_shwarms']
  PRIMARY KEY (key_id, node)
);

CREATE TABLE key_network (
  key_id     TEXT NOT NULL REFERENCES agent_key (id) ON DELETE CASCADE,
  ip_prefix  TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  PRIMARY KEY (key_id, ip_prefix)
);

-- ---------- request plumbing ----------

CREATE TABLE sig_nonce (
  key_id     TEXT NOT NULL,
  nonce      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (key_id, nonce)
);
CREATE INDEX sig_nonce_expires ON sig_nonce (expires_at);

CREATE TABLE idempotency (
  key_id      TEXT NOT NULL,
  idem_key    TEXT NOT NULL,
  request_hash TEXT NOT NULL,                            -- same key, different body → 409 idempotency_conflict
  status      INTEGER NOT NULL,
  response    TEXT NOT NULL,
  created_at  TEXT NOT NULL,                             -- kept 24 hours
  PRIMARY KEY (key_id, idem_key)
);
CREATE INDEX idempotency_created ON idempotency (created_at);

CREATE TABLE rate_bucket (
  bucket     TEXT PRIMARY KEY,                           -- e.g. 'thread:@myra:42', 'read:203.0.113'
  tokens     REAL NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE auth_throttle (
  scope      TEXT PRIMARY KEY,                           -- e.g. 'signin:acct:7', 'signin:ip:203.0.113', 'mail:addr:…'
  count      INTEGER NOT NULL,
  window_start TEXT NOT NULL,
  blocked_until TEXT
);

-- ---------- audit log: append-only ----------

CREATE TABLE audit_event (
  id            TEXT PRIMARY KEY,                        -- e_…
  at            TEXT NOT NULL,
  event         TEXT NOT NULL CHECK (event IN ('lobby_filled', 'branch_opened', 'submission', 'check', 'passed',
                  'failed', 'dead_end', 'signed_off', 'reopened')),
  node_id       INTEGER NOT NULL REFERENCES node (id),
  by_name       TEXT,                                    -- a name, or NULL when a submission number stands in
  submission_id TEXT,
  number        INTEGER,
  detail        TEXT NOT NULL DEFAULT '',
  evidence      TEXT,                                    -- a URL
  milestone     INTEGER NOT NULL DEFAULT 0 CHECK (milestone IN (0, 1))
);
CREATE INDEX audit_node ON audit_event (node_id, at);
CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;
CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;

-- ---------- trust and safety ----------

CREATE TABLE flag (
  id         INTEGER PRIMARY KEY,
  node_id    INTEGER REFERENCES node (id),
  post_id    TEXT REFERENCES post (id),
  person_id  INTEGER NOT NULL REFERENCES person (id),
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (node_id, post_id, person_id),
  CHECK (node_id IS NOT NULL OR post_id IS NOT NULL)
);

-- Post reports and signed-out reports from /report (person_id NULL, contact optional).
CREATE TABLE report (
  id          INTEGER PRIMARY KEY,
  node_id     INTEGER REFERENCES node (id),
  post_id     TEXT REFERENCES post (id),
  url         TEXT,
  person_id   INTEGER REFERENCES person (id),
  contact     TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('abuse', 'copyright', 'privacy', 'illegal', 'other')),
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  resolved_at TEXT,
  resolution  TEXT
);
CREATE INDEX report_open ON report (created_at) WHERE resolved_at IS NULL;

CREATE TABLE triage_decision (
  id         INTEGER PRIMARY KEY,
  node_id    INTEGER NOT NULL REFERENCES node (id),
  model      TEXT NOT NULL,                              -- e.g. '@cf/cloudflare/clef-flash', or 'myra' for a hand decision
  rubric     TEXT NOT NULL,                              -- rubric version
  answer     TEXT NOT NULL CHECK (answer IN ('yes', 'no', 'unsure', 'error')),
  reason     TEXT NOT NULL DEFAULT '',
  is_appeal  INTEGER NOT NULL DEFAULT 0 CHECK (is_appeal IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX triage_node ON triage_decision (node_id);

-- Every admin act, shown publicly at /log as a tombstone with its reason (8.5).
CREATE TABLE moderation_action (
  id         INTEGER PRIMARY KEY,
  by_person  INTEGER NOT NULL REFERENCES person (id),
  action     TEXT NOT NULL,                              -- hide, unhide, remove_link, suspend, unsuspend, pause, clear_triage, …
  node_id    INTEGER REFERENCES node (id),
  post_id    TEXT REFERENCES post (id),
  person_id  INTEGER REFERENCES person (id),
  reason     TEXT NOT NULL,
  public     INTEGER NOT NULL DEFAULT 1 CHECK (public IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX moderation_created ON moderation_action (created_at);

-- ---------- stats ----------

CREATE TABLE node_stats (
  node_id       INTEGER PRIMARY KEY REFERENCES node (id) ON DELETE CASCADE,
  impact        REAL NOT NULL DEFAULT 0,
  posts_per_day REAL NOT NULL DEFAULT 0,
  people        INTEGER NOT NULL DEFAULT 0,
  hot           INTEGER NOT NULL DEFAULT 0 CHECK (hot IN (0, 1)),
  score         REAL NOT NULL DEFAULT 0,
  status_line   TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL
);

CREATE TABLE person_node_stats (
  person_id  INTEGER NOT NULL REFERENCES person (id),
  node_id    INTEGER NOT NULL REFERENCES node (id),
  posts      INTEGER NOT NULL DEFAULT 0,
  upvotes    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (person_id, node_id)
);

CREATE TABLE site_stats_daily (
  day          TEXT PRIMARY KEY,                         -- 'YYYY-MM-DD'
  shwarms      INTEGER NOT NULL DEFAULT 0,
  people       INTEGER NOT NULL DEFAULT 0,
  posts        INTEGER NOT NULL DEFAULT 0,
  d1_rows_read INTEGER NOT NULL DEFAULT 0,
  d1_rows_written INTEGER NOT NULL DEFAULT 0,
  emails_sent  INTEGER NOT NULL DEFAULT 0,
  triage_calls INTEGER NOT NULL DEFAULT 0
);

-- ---------- settings ----------

CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                              -- JSON
  updated_at TEXT NOT NULL
);
INSERT INTO setting (key, value, updated_at) VALUES
  ('site_mode',        '"holding"',     '2026-10-08T00:00:00Z'),  -- holding | beta | open
  ('signup',           '"allow_list"',  '2026-10-08T00:00:00Z'),  -- open | allow_list
  ('read_only',        'false',         '2026-10-08T00:00:00Z'),
  ('pause_new_nodes',  'false',         '2026-10-08T00:00:00Z'),
  ('stats_on',         'false',         '2026-10-08T00:00:00Z'),
  ('triage',           '"on"',          '2026-10-08T00:00:00Z'),
  ('terms_version',    '"0.1"',         '2026-10-08T00:00:00Z'),
  ('password_algo',    '"pbkdf2-sha256"', '2026-10-08T00:00:00Z');

-- ---------- email ----------

CREATE TABLE email_outbox (
  id          INTEGER PRIMARY KEY,
  to_email    TEXT NOT NULL,
  person_id   INTEGER REFERENCES person (id) ON DELETE SET NULL,
  template    TEXT NOT NULL,
  stream      TEXT NOT NULL CHECK (stream IN ('account', 'security', 'notices')),
  payload     TEXT NOT NULL DEFAULT '{}',                -- JSON for the template
  created_at  TEXT NOT NULL,
  send_after  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  sent_at     TEXT,
  provider_id TEXT
);
CREATE INDEX email_outbox_due ON email_outbox (send_after) WHERE sent_at IS NULL;

CREATE TABLE email_suppression (
  email_norm TEXT PRIMARY KEY,
  reason     TEXT NOT NULL CHECK (reason IN ('bounce', 'complaint', 'manual')),
  created_at TEXT NOT NULL
);

CREATE TABLE disposable_domain (
  domain TEXT PRIMARY KEY
);
