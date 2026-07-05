-- ============================================================
-- 033_handoff_metadata
--
-- Handoff already works via conversations.ai_autoreply_disabled +
-- assigned_agent_id (029). This adds audit metadata (who/when/why the
-- bot stood down) and the "return to bot" RPC + an index the inbox
-- uses to surface "awaiting human" threads fast.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS handoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS handoff_reason text,   -- 'ai_sentinel'|'n8n'|'manual'|'manual_phone'|'keyword'
  ADD COLUMN IF NOT EXISTS handoff_by text;        -- 'bot' | the agent's user_id

COMMENT ON COLUMN conversations.handoff_reason IS
  'Why the bot stood down: ai_sentinel | n8n | manual | manual_phone | keyword.';

-- Inbox "aguardando atendente" filter: partial index over the flag.
CREATE INDEX IF NOT EXISTS idx_conversations_awaiting_human
  ON conversations (account_id, ai_autoreply_disabled)
  WHERE ai_autoreply_disabled = true;

-- ------------------------------------------------------------
-- return_conversation_to_bot(conversation_id)
--
-- Re-enables the bot on a conversation: clears the handoff flag,
-- unassigns the human, and zeroes the reply counter so the per-
-- conversation cap (claim_ai_reply_slot) starts fresh. Authorization
-- mirrors the account RPCs (018): the caller must be an agent+ member
-- of the conversation's account. SECURITY DEFINER so it can write past
-- RLS once the membership check passes.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.return_conversation_to_bot(
  p_conversation_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '28000';
  END IF;

  SELECT account_id INTO v_account_id
  FROM conversations
  WHERE id = p_conversation_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING errcode = 'P0002';
  END IF;

  IF NOT is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'not authorized for this account' USING errcode = '42501';
  END IF;

  UPDATE conversations
     SET ai_autoreply_disabled = false,
         assigned_agent_id     = NULL,
         ai_reply_count        = 0,
         handoff_at            = NULL,
         handoff_reason        = NULL,
         handoff_by            = NULL,
         updated_at            = now()
   WHERE id = p_conversation_id;
END;
$$;

ALTER FUNCTION public.return_conversation_to_bot(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.return_conversation_to_bot(uuid) TO authenticated, service_role;
