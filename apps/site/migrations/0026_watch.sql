-- Expand only (go-live 11.3, monitoring): adds four indexes; drops and renames nothing.
-- The health check and the watchdog (jobs/watch.ts) read these every few minutes, so each read is an index range, not
-- a scan of a table that only grows. The queries work without them, just slower, so a deploy may land before this does.

-- Nodes triage holds for the operator: few, and read by /healthz.
CREATE INDEX node_held ON node (created_at) WHERE triage = 'held';
-- Sign-ups in the last hour.
CREATE INDEX person_created ON person (created_at);
-- Outbox rows finished without a send ('failed: …' given up, or 'skipped: …'), by when: given up in the last hour or day.
CREATE INDEX email_outbox_unsent_done ON email_outbox (sent_at) WHERE provider_id IS NULL;
-- Bounces and complaints in the last day.
CREATE INDEX email_suppression_created ON email_suppression (created_at);
