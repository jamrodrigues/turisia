-- ============================================================
-- 031_whatsapp_provider_uazapi
--
-- Adds multi-provider support to whatsapp_config so an account
-- can run on the official Meta Cloud API (legacy, default) OR on
-- uazapi (unofficial, QR-code based — no Business API required).
--
-- Design notes:
--   * provider drives every send/receive code path via a dispatcher
--     (src/lib/whatsapp/sender.ts). Existing rows keep 'meta' and
--     behave exactly as before — this migration is non-breaking.
--   * phone_number_id is NOT NULL + UNIQUE (001 + 013). uazapi has
--     no phone_number_id, so uazapi rows store a synthetic stable
--     value 'uazapi:<instance_name>' to satisfy both constraints
--     and to allow webhook lookup by instance.
--   * uazapi_instance_token is stored encrypted with the same
--     encrypt()/decrypt() helpers used for access_token
--     (src/lib/whatsapp/encryption.ts). Never expose via RLS to
--     client roles — server-side (service role) reads only.
--   * uazapi_webhook_secret authenticates inbound webhook calls
--     (uazapi does not HMAC-sign payloads like Meta does).
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'uazapi')),
  ADD COLUMN IF NOT EXISTS uazapi_base_url TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_instance_name TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_instance_token TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_webhook_secret TEXT;

COMMENT ON COLUMN whatsapp_config.provider IS
  'Which WhatsApp API this account uses: meta (Cloud API) or uazapi (unofficial, QR-based).';
COMMENT ON COLUMN whatsapp_config.uazapi_base_url IS
  'Base URL of the uazapi server, e.g. https://xxx.uazapi.com. Provider=uazapi only.';
COMMENT ON COLUMN whatsapp_config.uazapi_instance_name IS
  'uazapi instance name (short, lowercase). Webhook resolves the account by this.';
COMMENT ON COLUMN whatsapp_config.uazapi_instance_token IS
  'uazapi instance token, encrypted with encrypt(). Service-role reads only.';
COMMENT ON COLUMN whatsapp_config.uazapi_webhook_secret IS
  'Shared secret validated on POST /api/uazapi/webhook (uazapi does not sign payloads).';

-- Webhook lookup path: resolve account by instance name. UNIQUE so one
-- instance maps to exactly one account (mirrors the phone_number_id
-- guarantee from migration 013); the index also serves the lookup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_uazapi_instance
  ON whatsapp_config (uazapi_instance_name)
  WHERE uazapi_instance_name IS NOT NULL;
