-- ============================================================
-- 066_financeiro.sql
--
-- Fase 6.1 of the 2026-09 market-gap plan (docs/redesign-2026-plan.md):
-- a manual financial ledger — accounts (bank/card/machine/cash) plus
-- entries against them. Scoped deliberately narrow for v1: this is a
-- ledger the agency fills in themselves, NOT bank-statement import or
-- automatic reconciliation matching (that's a real, separate, much
-- bigger feature — PaxPro's "conciliação" implies a bank-feed matching
-- engine this migration does not attempt). Every number here is
-- user-entered and traceable, per PRODUCT.md's "real data or nothing" —
-- no auto-generated entries from payment webhooks yet either; that's a
-- natural follow-up once this ledger is live, not bundled in here.
--
-- 1. contas_financeiras — the accounts money moves through.
-- 2. lancamentos_financeiros — one row per entry (entrada/saída),
--    optionally linked to a reserva (so a booking's Pix payment can
--    later be tied to a ledger entry without a schema change).
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. contas_financeiras
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contas_financeiras (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  tipo          text NOT NULL DEFAULT 'banco'
                  CHECK (tipo IN ('banco', 'cartao', 'maquininha', 'caixa')),
  saldo_inicial numeric(12,2) NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  observacoes   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contas_financeiras_account_idx ON contas_financeiras (account_id);

ALTER TABLE contas_financeiras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contas_financeiras_select ON contas_financeiras;
CREATE POLICY contas_financeiras_select ON contas_financeiras FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS contas_financeiras_insert ON contas_financeiras;
CREATE POLICY contas_financeiras_insert ON contas_financeiras FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS contas_financeiras_update ON contas_financeiras;
CREATE POLICY contas_financeiras_update ON contas_financeiras FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS contas_financeiras_delete ON contas_financeiras;
CREATE POLICY contas_financeiras_delete ON contas_financeiras FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON contas_financeiras;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contas_financeiras
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 2. lancamentos_financeiros
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lancamentos_financeiros (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conta_id    uuid NOT NULL REFERENCES contas_financeiras(id) ON DELETE CASCADE,
  reserva_id  uuid REFERENCES reservas(id) ON DELETE SET NULL,
  tipo        text NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  categoria   text NOT NULL DEFAULT 'outro'
                CHECK (categoria IN ('reserva', 'despesa_operacional', 'taxa', 'salario', 'outro')),
  valor       numeric(12,2) NOT NULL CHECK (valor > 0),
  descricao   text,
  data        date NOT NULL DEFAULT current_date,
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lancamentos_financeiros_account_data_idx
  ON lancamentos_financeiros (account_id, data);
CREATE INDEX IF NOT EXISTS lancamentos_financeiros_conta_idx
  ON lancamentos_financeiros (conta_id);

ALTER TABLE lancamentos_financeiros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lancamentos_financeiros_select ON lancamentos_financeiros;
CREATE POLICY lancamentos_financeiros_select ON lancamentos_financeiros FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS lancamentos_financeiros_insert ON lancamentos_financeiros;
CREATE POLICY lancamentos_financeiros_insert ON lancamentos_financeiros FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS lancamentos_financeiros_update ON lancamentos_financeiros;
CREATE POLICY lancamentos_financeiros_update ON lancamentos_financeiros FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS lancamentos_financeiros_delete ON lancamentos_financeiros;
CREATE POLICY lancamentos_financeiros_delete ON lancamentos_financeiros FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON lancamentos_financeiros;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lancamentos_financeiros
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
