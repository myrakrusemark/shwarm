-- Expand only (go-live 11.4, decided Oct 9: "Analytics: our own counts, a funnel first, on an admin page"). Adds one
-- table and two indexes; drops and renames nothing.

-- Server-side traffic counts (web/traffic.ts): one row per day, kind, referring site, country and status class, with a
-- running count. Nothing here names a person or a machine: no IP, no user agent, no path, no account id. Read only by
-- the admin page (/admin/beta) and the daily summary mail (jobs/summary.ts).
CREATE TABLE traffic_daily (
  day           TEXT NOT NULL,                           -- 'YYYY-MM-DD', UTC
  kind          TEXT NOT NULL CHECK (kind IN ('page', 'prompt', 'json', 'api', 'other')),
  referrer      TEXT NOT NULL DEFAULT '',                -- the Referer's host when it's another site, else ''
  country       TEXT NOT NULL DEFAULT '',                -- Cloudflare's two-letter country code, '' when unknown
  status_class  INTEGER NOT NULL CHECK (status_class BETWEEN 1 AND 5),  -- 2 for 2xx, 4 for 4xx, …
  hits          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, referrer, country, status_class)
) WITHOUT ROWID;

-- The admin page's daily activity and the summary's "checks" and "passes" read by time.
CREATE INDEX check_created ON check_report (created_at);
CREATE INDEX audit_event_kind_at ON audit_event (event, at);
