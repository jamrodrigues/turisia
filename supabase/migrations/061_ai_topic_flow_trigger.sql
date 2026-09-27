-- ============================================================
-- 061_ai_topic_flow_trigger.sql
--
-- Lets the AI auto-reply hand off DIRECTLY into an automated-closing
-- Flow (058/059/060) once the customer confirms a booking, instead of
-- requiring them to type an exact trigger phrase like "fechar buggy".
--
-- `ai_topic` is an admin-set slug (matches a pacotes.category value,
-- e.g. 'buggy') identifying which package this flow closes. The
-- system prompt tells the AI which topics are bookable
-- (src/lib/ai/booking-topics.ts); when the customer confirms, the AI
-- emits `[[RESERVAR:<topic>]]` and `startFlowByAiTopic`
-- (src/lib/flows/engine.ts) starts THIS flow directly — no keyword
-- matching involved for this path (the keyword trigger stays as a
-- second, independent way to enter the same flow for a customer who
-- types the phrase unprompted).
--
-- The partial unique index prevents ambiguity: at most one ACTIVE
-- flow per (account, topic), so `startFlowByAiTopic`'s lookup is
-- always unambiguous. A draft/archived flow with the same topic
-- doesn't count — an admin can freely draft a v2 alongside the live
-- one.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS ai_topic TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_flows_one_active_per_ai_topic
  ON flows (account_id, ai_topic)
  WHERE status = 'active' AND ai_topic IS NOT NULL;

-- Wire up the flow authored + tested live on 2026-09-08.
UPDATE flows SET ai_topic = 'buggy'
WHERE id = 'b8d7e4ac-8098-4160-b737-c649567eeb3a' AND ai_topic IS NULL;
