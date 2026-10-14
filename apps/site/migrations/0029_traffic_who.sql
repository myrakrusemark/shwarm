-- Expand only (decided Oct 13, Myra: "id like you to separate these out in admin analytics"). Adds one table; drops
-- and renames nothing.

-- Server-side traffic counts (web/traffic.ts) with who sent each request and the browser's language. The key of
-- traffic_daily can't grow, so counting moves here; traffic_daily keeps the counts from before and reads as who = ''
-- (unknown). As there: no IP, no user agent, no path, no account id. The user agent is read to pick `who` and never
-- kept. Read only by the admin page (/admin/beta) and the daily summary mail (jobs/summary.ts).
CREATE TABLE traffic_count (
  day           TEXT NOT NULL,                           -- 'YYYY-MM-DD', UTC
  kind          TEXT NOT NULL CHECK (kind IN ('page', 'prompt', 'json', 'api', 'other')),
  referrer      TEXT NOT NULL DEFAULT '',                -- the Referer's host when it's another site, else ''
  country       TEXT NOT NULL DEFAULT '',                -- Cloudflare's two-letter country code, '' when unknown
  status_class  INTEGER NOT NULL CHECK (status_class BETWEEN 1 AND 5),  -- 2 for 2xx, 4 for 4xx, …
  who           TEXT NOT NULL CHECK (who IN ('person', 'crawler', 'script', 'agent')),
  lang          TEXT NOT NULL DEFAULT '',                -- the browser's first language ('ja'), people only, else ''
  hits          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, referrer, country, status_class, who, lang)
) WITHOUT ROWID;
