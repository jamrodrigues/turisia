-- ============================================================
-- 073_waitlist.sql
--
-- Adds the 'join_waitlist' flow node type + the `lista_espera` table
-- it writes to. Reached from `create_reservation`'s `failure_next`
-- when a horario+data is full — instead of (or before) handing off to
-- a human, the customer can ask to be notified if a spot opens up.
--
-- No capacity check here (unlike criar_reserva/058) — a waitlist entry
-- doesn't reserve anything, it's a queue position. The actual notify
-- sweep is a cron job (src/app/api/waitlist/cron/route.ts, same
-- pattern as flows/cron's abandonment reminder — see that route's own
-- header comment) that re-checks real capacity via the existing
-- pacote_horario_vagas() function (058) before notifying anyone, so
-- even if this table over-promises, nobody gets told "you're in" who
-- isn't.
--
-- Same drop-and-recreate CHECK pattern every prior node-type addition
-- has used (010/016/059/063).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'set_var',
    'create_reservation',
    'create_payment',
    'send_voucher',
    'join_waitlist',
    'handoff',
    'http_fetch',
    'end'
  ));

CREATE TABLE IF NOT EXISTS lista_espera (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pacote_id          uuid NOT NULL REFERENCES pacotes(id) ON DELETE CASCADE,
  pacote_horario_id  uuid NOT NULL REFERENCES pacote_horarios(id) ON DELETE CASCADE,
  data               date NOT NULL,
  quantidade_pessoas integer NOT NULL CHECK (quantidade_pessoas > 0),
  contact_id         uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id    uuid REFERENCES conversations(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'aguardando'
                        CHECK (status IN ('aguardando', 'notificado', 'reservado', 'expirado', 'cancelado')),
  notified_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- The cron sweep groups by (horario, data) and walks 'aguardando' rows
-- oldest-first within each group.
CREATE INDEX IF NOT EXISTS lista_espera_horario_data_idx
  ON lista_espera (pacote_horario_id, data, created_at) WHERE status = 'aguardando';
CREATE INDEX IF NOT EXISTS lista_espera_account_id_idx ON lista_espera (account_id);

ALTER TABLE lista_espera ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lista_espera_select ON lista_espera;
CREATE POLICY lista_espera_select ON lista_espera FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS lista_espera_insert ON lista_espera;
CREATE POLICY lista_espera_insert ON lista_espera FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS lista_espera_update ON lista_espera;
CREATE POLICY lista_espera_update ON lista_espera FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS lista_espera_delete ON lista_espera;
CREATE POLICY lista_espera_delete ON lista_espera FOR DELETE
  USING (is_account_member(account_id, 'agent'));
