-- Expand only (decided Oct 16, Myra: "add an analyitics for which shwarms are being looked at the most? most popular
-- shwarms in the past 24 hours"). Adds one table; drops and renames nothing.

-- Views of each shwarm or branch page by hour (web/traffic.ts): an answer to GET /w/<path> that found the node (200 or
-- 304), in any format, counted by who sent it as traffic_count is. As there: no IP, no user agent, no account id; the
-- path is the node's own public address, never a query. Kept 8 days (the hourly cleanup, web/traffic.ts
-- pruneNodeViews). Read only by the admin analytics page (/admin/analytics).
CREATE TABLE node_view (
  hour  TEXT NOT NULL,                                   -- 'YYYY-MM-DDTHH', UTC
  path  TEXT NOT NULL,                                   -- the node's path, 'minecraft-in-doom/block-placement'
  who   TEXT NOT NULL CHECK (who IN ('person', 'crawler', 'script', 'agent')),
  hits  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour, path, who)
) WITHOUT ROWID;
