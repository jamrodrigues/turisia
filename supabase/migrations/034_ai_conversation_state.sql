-- ============================================================
-- 034_ai_conversation_state
--
-- Per-conversation AI state:
--   ai_context        — free JSON for the brain (embedded or n8n) to
--                       keep conversational memory (booking step, etc).
--   ai_debounce_until — while now() < this, new inbounds only reschedule;
--                       the bot answers ONCE with the aggregated burst
--                       (avoids 4 short messages → 4 chopped replies).
--
-- Plus the inbound dedup guard: uazapi redelivers webhook events, so a
-- (conversation_id, message_id) unique index makes a double-insert a
-- no-op. Meta effectively never redelivers, so this is free there.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_debounce_until timestamptz;

COMMENT ON COLUMN conversations.ai_context IS
  'Free state for the AI brain (embedded or n8n) to keep per-conversation memory.';
COMMENT ON COLUMN conversations.ai_debounce_until IS
  'While now() < this, new inbounds reschedule; the bot answers once, aggregated.';

-- Dedup: one provider message id per conversation. Partial (message_id
-- is nullable for internal-only rows). If legacy dupes exist this will
-- fail — none in a fresh install; clean before applying on an old DB.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_dedup_wa_id
  ON messages (conversation_id, message_id)
  WHERE message_id IS NOT NULL;
