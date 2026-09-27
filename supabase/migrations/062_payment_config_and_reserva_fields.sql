-- ============================================================
-- 062_payment_config_and_reserva_fields.sql
--
-- Fase B of the roadmap (2026-09-08 decision): real Pix payment via
-- Mercado Pago's Orders API v2, so a reservation can be charged and
-- confirmed automatically — no human checking a bank app.
--
-- 1. `payment_config` — one row per account, same shape/security
--    posture as `ai_configs`/`whatsapp_config` (035): SELECT/INSERT/
--    UPDATE/DELETE all admin+, secrets encrypted at rest with the
--    existing AES-256-GCM helper (src/lib/whatsapp/encryption.ts —
--    generic despite the file name, already reused by ai_configs).
--    Two secrets: the API access_token (creates/reads orders) and the
--    webhook signature secret (validates notifications are really
--    from Mercado Pago — see src/lib/payments/mercadopago.ts).
--
-- 2. `reservas` — payment tracking fields. `pagamento_status` starts
--    'nao_iniciado' for every existing row (no payment flow existed
--    before this migration) and only reservations booked through a
--    flow with a `create_payment` node ever move past it.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_config (
  account_id               uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  provider                 text NOT NULL DEFAULT 'mercadopago' CHECK (provider = 'mercadopago'),
  access_token_encrypted   text,
  webhook_secret_encrypted text,
  is_active                boolean NOT NULL DEFAULT false,
  created_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_config_select ON payment_config;
CREATE POLICY payment_config_select ON payment_config FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS payment_config_insert ON payment_config;
CREATE POLICY payment_config_insert ON payment_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS payment_config_update ON payment_config;
CREATE POLICY payment_config_update ON payment_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS payment_config_delete ON payment_config;
CREATE POLICY payment_config_delete ON payment_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON payment_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON payment_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- reservas — payment tracking
-- ------------------------------------------------------------
ALTER TABLE reservas
  ADD COLUMN IF NOT EXISTS pagamento_status text NOT NULL DEFAULT 'nao_iniciado'
    CHECK (pagamento_status IN ('nao_iniciado', 'pendente', 'pago', 'falhou')),
  ADD COLUMN IF NOT EXISTS mp_order_id text,
  -- Mercado Pago's webhook `data.id` may reference either the order or
  -- the payment depending on notification type/topic — storing both
  -- lets the webhook match on whichever it gets, then always re-fetch
  -- authoritative status via mp_order_id (see payments webhook route).
  ADD COLUMN IF NOT EXISTS mp_payment_id text,
  ADD COLUMN IF NOT EXISTS pagamento_valor numeric(10,2),
  ADD COLUMN IF NOT EXISTS pagamento_pix_copia_cola text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- The webhook looks reservations up by mp_order_id/mp_payment_id —
-- needs to be fast and, since these are the reconciliation keys,
-- unique whenever set.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservas_mp_order_id
  ON reservas (mp_order_id) WHERE mp_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservas_mp_payment_id
  ON reservas (mp_payment_id) WHERE mp_payment_id IS NOT NULL;
