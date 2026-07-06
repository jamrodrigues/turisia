-- ============================================================
-- 035_lock_down_secret_configs
--
-- Product security (managed SaaS): the client logs in as the 'agent'
-- role and must NEVER see integration plumbing. But 017/029 let any
-- member (viewer+) SELECT whatsapp_config and ai_configs — rows that
-- carry encrypted secrets (access_token, uazapi_instance_token,
-- uazapi_webhook_secret, api_key, n8n_shared_secret). Encrypted or not,
-- an agent could pull the whole row via the anon client.
--
-- Fix: restrict SELECT on both tables to admin+, and expose a
-- secrets-free status RPC for the couple of places a non-admin UI
-- legitimately needs to know "is WhatsApp connected / is the bot on".
-- ============================================================

-- --- whatsapp_config: SELECT admin+ (INSERT/UPDATE/DELETE already admin+)
DROP POLICY IF EXISTS whatsapp_config_select ON whatsapp_config;
CREATE POLICY whatsapp_config_select ON whatsapp_config
  FOR SELECT USING (is_account_member(account_id, 'admin'));

-- --- ai_configs: SELECT admin+ (INSERT/UPDATE/DELETE already admin+)
DROP POLICY IF EXISTS ai_configs_select ON ai_configs;
CREATE POLICY ai_configs_select ON ai_configs
  FOR SELECT USING (is_account_member(account_id, 'admin'));

-- --- Secrets-free status for member UIs (inbox banner, etc).
-- SECURITY DEFINER so it can read the locked-down tables after the
-- membership check; returns ONLY booleans/enum, never a secret.
CREATE OR REPLACE FUNCTION public.account_integration_status()
RETURNS TABLE (
  whatsapp_connected boolean,
  whatsapp_provider  text,
  ai_active          boolean,
  ai_tier            text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RETURN; -- no rows
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(w.status = 'connected', false),
    w.provider,
    COALESCE(a.is_active, false),
    COALESCE(a.ai_tier, 'off')
  FROM (SELECT v_account_id AS account_id) base
  LEFT JOIN whatsapp_config w ON w.account_id = base.account_id
  LEFT JOIN ai_configs      a ON a.account_id = base.account_id;
END;
$$;

ALTER FUNCTION public.account_integration_status() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.account_integration_status() TO authenticated, service_role;
