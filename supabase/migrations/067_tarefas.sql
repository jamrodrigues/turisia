-- ============================================================
-- 067_tarefas.sql
--
-- Fase 6.3 of the 2026-09 market-gap plan (docs/redesign-2026-plan.md):
-- internal staff tasks/reminders (PaxPro's "Tarefas e lembretes" —
-- deadline tracking for the TEAM, distinct from the AI/Flow automations
-- that already exist for talking to the CUSTOMER). A task can optionally
-- point at a contact or a reserva it's about, but stands on its own too
-- (e.g. "ligar pro fornecedor de combustível").
--
-- Idempotent -- safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS tarefas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  titulo         text NOT NULL,
  descricao      text,
  prazo          date,
  status         text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluida')),
  responsavel_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  contact_id     uuid REFERENCES contacts(id) ON DELETE SET NULL,
  reserva_id     uuid REFERENCES reservas(id) ON DELETE SET NULL,
  created_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tarefas_account_idx ON tarefas (account_id);
CREATE INDEX IF NOT EXISTS tarefas_account_status_prazo_idx ON tarefas (account_id, status, prazo);
CREATE INDEX IF NOT EXISTS tarefas_responsavel_idx ON tarefas (responsavel_id) WHERE responsavel_id IS NOT NULL;

ALTER TABLE tarefas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tarefas_select ON tarefas;
CREATE POLICY tarefas_select ON tarefas FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS tarefas_insert ON tarefas;
CREATE POLICY tarefas_insert ON tarefas FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS tarefas_update ON tarefas;
CREATE POLICY tarefas_update ON tarefas FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS tarefas_delete ON tarefas;
CREATE POLICY tarefas_delete ON tarefas FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON tarefas;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tarefas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
