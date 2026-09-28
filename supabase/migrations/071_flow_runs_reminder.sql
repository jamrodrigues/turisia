-- ============================================================
-- 071_flow_runs_reminder.sql
--
-- Tracks whether the abandonment-nudge (sent by /api/flows/cron, see
-- that route) has already fired for a run, so the sweep sends it at
-- most once per run instead of on every cron tick between the nudge
-- window and the timeout cutoff.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
