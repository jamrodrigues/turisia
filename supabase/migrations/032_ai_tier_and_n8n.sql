-- ============================================================
-- 032_ai_tier_and_n8n
--
-- Adds the "brain selector" to ai_configs:
--   ai_tier = 'off'      → no bot
--             'simple'   → wacrm's built-in LLM auto-reply (RAG)
--             'advanced' → delegate each inbound to an n8n workflow
--                          that owns the LLM + tools (Supabase agenda…)
--
-- For an ADVANCED-only account the operator has no BYO LLM key here
-- (the LLM lives in n8n), so provider/model/api_key must be allowed to
-- be NULL. Existing rows keep their values. App layer enforces "simple
-- requires a usable key" (loadAiConfig already returns null without one).
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS ai_tier text NOT NULL DEFAULT 'simple'
    CHECK (ai_tier IN ('off', 'simple', 'advanced')),
  ADD COLUMN IF NOT EXISTS n8n_webhook_url text,
  ADD COLUMN IF NOT EXISTS n8n_shared_secret text;   -- encrypted (encrypt())

-- Relax the LLM columns so an advanced-only (n8n) account can have a
-- config row without a BYO key. The provider CHECK from 029 already
-- permits NULL (CHECK passes on NULL); we only drop the NOT NULLs.
ALTER TABLE ai_configs ALTER COLUMN provider DROP NOT NULL;
ALTER TABLE ai_configs ALTER COLUMN model    DROP NOT NULL;
ALTER TABLE ai_configs ALTER COLUMN api_key  DROP NOT NULL;

COMMENT ON COLUMN ai_configs.ai_tier IS
  'off = no bot; simple = built-in LLM (RAG); advanced = delegate inbound to n8n.';
COMMENT ON COLUMN ai_configs.n8n_webhook_url IS
  'Advanced tier: the n8n webhook the CRM POSTs each inbound to.';
COMMENT ON COLUMN ai_configs.n8n_shared_secret IS
  'Advanced tier: encrypted secret sent as x-crm-secret to n8n and required back.';
