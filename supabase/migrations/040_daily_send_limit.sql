-- ============================================================
-- 040_daily_send_limit
--
-- Anti-ban (uazapi) + reply-cap ceiling fix. Two independent changes
-- that ship together (P1+P2 plan):
--
--   1. whatsapp_config.daily_send_limit — optional per-day OUTBOUND
--      ceiling for broadcasts on unofficial (uazapi) numbers. NULL =
--      no limit. Warm-up guidance: start ~30-50/day and raise weekly.
--      count_outbound_today() counts a day's agent/bot sends straight
--      from `messages` (no new counter table to keep in sync).
--
--   2. ai_configs.auto_reply_max_per_conversation CHECK raised from
--      1..20 to 1..200. The old 20 ceiling SILENTLY rejected any
--      higher value (a "cap 30" never actually stored — it stayed at
--      the last valid write), so the bot went quiet far sooner than the
--      admin intended. Product default is now 50 (route + UI).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Daily outbound ceiling (uazapi anti-ban)
-- ------------------------------------------------------------
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS daily_send_limit INTEGER; -- NULL = sem teto

COMMENT ON COLUMN whatsapp_config.daily_send_limit IS
  'Teto de envios OUTBOUND por dia (anti-ban p/ uazapi). NULL = ilimitado. Warm-up: começar ~30-50 e subir semanalmente.';

-- Count today's outbound (agent + bot) messages for an account, in the
-- America/Recife business day. SECURITY DEFINER so the broadcast guard
-- (service-role) and dashboards alike can call it past RLS.
CREATE OR REPLACE FUNCTION public.count_outbound_today(p_account_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.account_id = p_account_id
    AND m.sender_type IN ('agent', 'bot')
    AND m.created_at >= (
      date_trunc('day', now() AT TIME ZONE 'America/Recife')
      AT TIME ZONE 'America/Recife'
    );
$$;

ALTER FUNCTION public.count_outbound_today(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.count_outbound_today(UUID)
  TO authenticated, service_role;

-- messages(conversation_id, created_at) is already covered by the
-- inbox's per-conversation ordering index (migration 001/010); the
-- join+filter above rides that + the conversations PK, so no extra
-- index is added here. Revisit only if a high-volume account shows this
-- count as slow.

-- ------------------------------------------------------------
-- 2. Raise the per-conversation reply cap ceiling 20 → 200
-- ------------------------------------------------------------
ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_auto_reply_max_per_conversation_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_auto_reply_max_per_conversation_check
  CHECK (auto_reply_max_per_conversation BETWEEN 1 AND 200);
