-- ============================================================
-- 039_ai_usage
--
-- Metering de consumo de IA por conta. Cada chamada a um provedor
-- (auto-reply simples, cérebro n8n, rascunho, playground, transcrição)
-- grava um evento com tokens e custo estimado em USD (calculado no
-- momento do insert com a tabela de preços de src/lib/ai/pricing.ts —
-- snapshot, não recalculado se o preço mudar depois).
--
-- Design:
--   * INSERT: somente service-role (rotas server-side). Sem policy de
--     INSERT para clients.
--   * SELECT: admins da conta (painel "Consumo de IA" em Configurações).
--   * ai_usage_summary(): agregação server-side (dia/modelo/feature)
--     para o painel — evita puxar milhares de linhas pro browser.
--   * status='error' registra chamadas que falharam (visibilidade de
--     falhas do bot no painel, além do custo).
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  feature TEXT NOT NULL CHECK (feature IN (
    'auto_reply',     -- tier simples (responder built-in)
    'n8n_reply',      -- tier avançado (workflow n8n reportou usage)
    'draft',          -- rascunho sugerido no inbox
    'playground',     -- testes do admin na tela de IA
    'transcription',  -- voz → texto (Whisper/4o-transcribe)
    'embedding'       -- base de conhecimento (ingest/busca)
  )),
  provider TEXT NOT NULL,          -- openai | anthropic | n8n
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_account_created
  ON ai_usage_events(account_id, created_at DESC);

ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_usage_select ON ai_usage_events;
CREATE POLICY ai_usage_select ON ai_usage_events FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- Resumo agregado para o painel. SECURITY DEFINER + gate de admin
-- interno (mesmo padrão de account_integration_status, migration 035).
-- Retorna uma linha por (dia, feature, provider, model).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION ai_usage_summary(
  p_from TIMESTAMPTZ DEFAULT date_trunc('month', NOW()),
  p_to   TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  day DATE,
  feature TEXT,
  provider TEXT,
  model TEXT,
  calls BIGINT,
  errors BIGINT,
  input_tokens BIGINT,
  output_tokens BIGINT,
  cost_usd NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  SELECT account_id INTO v_account_id
  FROM profiles WHERE user_id = auth.uid();

  IF v_account_id IS NULL
     OR NOT is_account_member(v_account_id, 'admin') THEN
    RETURN; -- não-admin: sem linhas
  END IF;

  RETURN QUERY
  SELECT
    (e.created_at AT TIME ZONE 'UTC')::date AS day,
    e.feature,
    e.provider,
    e.model,
    COUNT(*)::bigint AS calls,
    COUNT(*) FILTER (WHERE e.status = 'error')::bigint AS errors,
    COALESCE(SUM(e.input_tokens), 0)::bigint AS input_tokens,
    COALESCE(SUM(e.output_tokens), 0)::bigint AS output_tokens,
    COALESCE(SUM(e.cost_usd), 0)::numeric AS cost_usd
  FROM ai_usage_events e
  WHERE e.account_id = v_account_id
    AND e.created_at >= p_from
    AND e.created_at < p_to
  GROUP BY 1, 2, 3, 4
  ORDER BY 1 DESC, 9 DESC;
END;
$$;

ALTER FUNCTION ai_usage_summary(TIMESTAMPTZ, TIMESTAMPTZ) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION ai_usage_summary(TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated, service_role;
