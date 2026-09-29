-- ============================================================
-- 074_avaliacoes.sql
--
-- Post-trip satisfaction survey. `avaliacoes` (one row per reserva,
-- UNIQUE on reserva_id so the cron sweep can never double-send) is
-- written by two places:
--   1. /api/surveys/cron — finds confirmed reservas whose trip date
--      was yesterday with no avaliacao yet, sends "de 1 a 5, como foi?"
--      and inserts the row as 'enviado'.
--   2. process-inbound.ts — when an inbound message arrives from a
--      contact with a pending 'enviado' avaliacao and parses as a
--      1-5 rating, marks it 'respondido' with the nota/comentario and
--      replies with a thank-you, WITHOUT handing the message to
--      flows/automations/AI (same "consumed" pattern flows already
--      use — see the dispatch-order comment in process-inbound.ts).
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS avaliacoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reserva_id      uuid NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
  pacote_id       uuid NOT NULL REFERENCES pacotes(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'enviado' CHECK (status IN ('enviado', 'respondido')),
  nota            integer CHECK (nota BETWEEN 1 AND 5),
  comentario      text,
  enviado_em      timestamptz NOT NULL DEFAULT now(),
  respondido_em   timestamptz,
  UNIQUE (reserva_id)
);

CREATE INDEX IF NOT EXISTS avaliacoes_account_id_idx ON avaliacoes (account_id);
-- process-inbound's per-message lookup: "does this contact have a
-- pending survey?" — needs to be cheap, it runs on every inbound text.
CREATE INDEX IF NOT EXISTS avaliacoes_contact_pending_idx
  ON avaliacoes (contact_id, account_id) WHERE status = 'enviado';

ALTER TABLE avaliacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS avaliacoes_select ON avaliacoes;
CREATE POLICY avaliacoes_select ON avaliacoes FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS avaliacoes_insert ON avaliacoes;
CREATE POLICY avaliacoes_insert ON avaliacoes FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS avaliacoes_update ON avaliacoes;
CREATE POLICY avaliacoes_update ON avaliacoes FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS avaliacoes_delete ON avaliacoes;
CREATE POLICY avaliacoes_delete ON avaliacoes FOR DELETE
  USING (is_account_member(account_id, 'agent'));
