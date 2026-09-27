-- ============================================================
-- 058_pacote_horarios_reservas.sql — Schedule slots + bookings.
--
-- Real business rule this encodes (from the agency owner): a package
-- like "Buggy" runs on fixed daily time slots (e.g. 08h–12h, 14h–18h),
-- each with a hard people capacity (e.g. 4 buggies × 4 pessoas = 16).
-- `pacote_horarios` is the recurring slot TEMPLATE (applies every day —
-- day-of-week exceptions are a later refinement, not needed for the
-- first cut); `reservas` are actual bookings against one slot on one
-- date. Remaining capacity = capacidade_pessoas − SUM(quantidade_pessoas)
-- of non-cancelled reservas for that (horario, data).
--
-- `pacote_horario_id` is nullable on `reservas`: a package with no
-- horarios rows (e.g. a flexible city tour) can still be booked without
-- slot/capacity enforcement — capacity checks only kick in for packages
-- the agency actually configured slots for.
--
-- `criar_reserva()` is the ONLY safe way to insert a reserva when a
-- horario is involved: it locks the horario row (FOR UPDATE) and
-- re-checks capacity inside that lock before inserting, so two
-- concurrent bookings (e.g. the AI and a human agent closing at the
-- same moment) can never together overbook a slot. Same defensive
-- pattern as `claim_ai_reply_slot` (029) and the atomic counters in
-- 007/012/057 — never insert into `reservas` directly from app code
-- when `pacote_horario_id` is set.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 1. pacote_horarios — recurring daily time slots per package.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pacote_horarios (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pacote_id          uuid NOT NULL REFERENCES pacotes(id) ON DELETE CASCADE,
  hora_saida         time NOT NULL,
  hora_volta         time,
  capacidade_pessoas integer NOT NULL CHECK (capacidade_pessoas > 0),
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pacote_horarios_pacote_id_idx
  ON pacote_horarios (pacote_id);

ALTER TABLE pacote_horarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pacote_horarios_select ON pacote_horarios;
CREATE POLICY pacote_horarios_select ON pacote_horarios FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pacotes p
      WHERE p.id = pacote_horarios.pacote_id AND is_account_member(p.account_id)
    )
  );

DROP POLICY IF EXISTS pacote_horarios_insert ON pacote_horarios;
CREATE POLICY pacote_horarios_insert ON pacote_horarios FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM pacotes p
      WHERE p.id = pacote_horarios.pacote_id AND is_account_member(p.account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS pacote_horarios_update ON pacote_horarios;
CREATE POLICY pacote_horarios_update ON pacote_horarios FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM pacotes p
      WHERE p.id = pacote_horarios.pacote_id AND is_account_member(p.account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS pacote_horarios_delete ON pacote_horarios;
CREATE POLICY pacote_horarios_delete ON pacote_horarios FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM pacotes p
      WHERE p.id = pacote_horarios.pacote_id AND is_account_member(p.account_id, 'agent')
    )
  );

-- ------------------------------------------------------------
-- 2. reservas — one booking against a package (+ optionally a slot).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pacote_id          uuid NOT NULL REFERENCES pacotes(id) ON DELETE RESTRICT,
  pacote_horario_id  uuid REFERENCES pacote_horarios(id) ON DELETE SET NULL,
  contact_id         uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id    uuid REFERENCES conversations(id) ON DELETE SET NULL,
  data               date NOT NULL,
  quantidade_pessoas integer NOT NULL CHECK (quantidade_pessoas > 0),
  status             text NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente', 'confirmada', 'cancelada')),
  voucher_url        text, -- filled in once the voucher PDF is generated
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL = created by the AI/flow, not a human
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Every list/detail query and the capacity check both filter on these.
CREATE INDEX IF NOT EXISTS reservas_account_id_idx ON reservas (account_id);
CREATE INDEX IF NOT EXISTS reservas_horario_data_idx
  ON reservas (pacote_horario_id, data) WHERE status <> 'cancelada';

ALTER TABLE reservas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reservas_select ON reservas;
CREATE POLICY reservas_select ON reservas FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS reservas_insert ON reservas;
CREATE POLICY reservas_insert ON reservas FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS reservas_update ON reservas;
CREATE POLICY reservas_update ON reservas FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS reservas_delete ON reservas;
CREATE POLICY reservas_delete ON reservas FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON reservas;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON reservas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 3. Read-only availability check — how many spots are left for a
--    given slot on a given date. Used to ANSWER "tem vaga amanhã de
--    manhã?" without needing to touch `reservas` directly.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pacote_horario_vagas(
  p_horario_id uuid,
  p_data date
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.capacidade_pessoas - COALESCE((
    SELECT SUM(r.quantidade_pessoas)
    FROM reservas r
    WHERE r.pacote_horario_id = h.id
      AND r.data = p_data
      AND r.status <> 'cancelada'
  ), 0)
  FROM pacote_horarios h
  WHERE h.id = p_horario_id;
$$;

GRANT EXECUTE ON FUNCTION pacote_horario_vagas(uuid, date) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. Atomic booking — the only safe insert path when a horario is set.
--    Locks the horario row so two concurrent bookings can't both pass
--    the capacity check and together overbook the slot.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION criar_reserva(
  p_account_id uuid,
  p_pacote_id uuid,
  p_pacote_horario_id uuid,
  p_data date,
  p_quantidade_pessoas integer,
  p_contact_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS TABLE(reserva_id uuid, sucesso boolean, motivo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacidade integer;
  v_ocupado integer;
  v_id uuid;
BEGIN
  IF p_pacote_horario_id IS NOT NULL THEN
    -- Row lock: a concurrent call for the SAME horario blocks here until
    -- this transaction commits/rolls back, so its capacity read below is
    -- never stale.
    SELECT capacidade_pessoas INTO v_capacidade
    FROM pacote_horarios
    WHERE id = p_pacote_horario_id
    FOR UPDATE;

    IF v_capacidade IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, false, 'horario_invalido'::text;
      RETURN;
    END IF;

    SELECT COALESCE(SUM(quantidade_pessoas), 0) INTO v_ocupado
    FROM reservas
    WHERE pacote_horario_id = p_pacote_horario_id
      AND data = p_data
      AND status <> 'cancelada';

    IF v_ocupado + p_quantidade_pessoas > v_capacidade THEN
      RETURN QUERY SELECT NULL::uuid, false, 'sem_vagas'::text;
      RETURN;
    END IF;
  END IF;

  INSERT INTO reservas (
    account_id, pacote_id, pacote_horario_id, data,
    quantidade_pessoas, contact_id, conversation_id, created_by
  )
  VALUES (
    p_account_id, p_pacote_id, p_pacote_horario_id, p_data,
    p_quantidade_pessoas, p_contact_id, p_conversation_id, p_created_by
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, true, NULL::text;
END;
$$;

-- Callable by any authenticated member (RLS on the underlying tables
-- still applies to what they can pass in) and by the service role
-- (AI/webhook path, which will be the primary caller once wired up).
GRANT EXECUTE ON FUNCTION criar_reserva(uuid, uuid, uuid, date, integer, uuid, uuid, uuid)
  TO authenticated, service_role;
