-- ============================================================
-- 064_logistica_operacional.sql
--
-- Fase C v1 of the roadmap (2026-09-08 decision: cadastro + agenda
-- operacional, sem mapa ainda): motoristas, guias, veículos, and the
-- daily "saída operacional" that groups reservations onto one
-- vehicle/driver/guide run — the exact shape the agency's own spec
-- asked for (§15/19/20/21 of the doc): "Van 01, Motorista Carlos,
-- Guia João, 08:00 Pousada A 4 pessoas, ...".
--
-- Also fills a real CRM gap the spec calls out (§11): contacts had no
-- pousada/apartamento, which the daily manifest needs to show.
--
-- 1. contacts.pousada/apartamento — guest's stay location. Contact-
--    level (not per-reserva): the same guest doesn't change hotel
--    between two bookings during one trip, and this avoids re-asking
--    the same thing on every reserva.
-- 2. motoristas / guias / veiculos — simple account-scoped registries.
-- 3. saidas_operacionais — one row per actual vehicle/driver/guide run
--    on one date (optionally tied to a pacote_horarios slot); a
--    reserva is assigned to at most one saída via
--    reservas.saida_operacional_id.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS pousada TEXT,
  ADD COLUMN IF NOT EXISTS apartamento TEXT;

-- ------------------------------------------------------------
-- 1. motoristas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS motoristas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  nome         text NOT NULL,
  telefone     text,
  cnh          text,
  observacoes  text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS motoristas_account_idx ON motoristas (account_id);

ALTER TABLE motoristas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS motoristas_select ON motoristas;
CREATE POLICY motoristas_select ON motoristas FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS motoristas_insert ON motoristas;
CREATE POLICY motoristas_insert ON motoristas FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS motoristas_update ON motoristas;
CREATE POLICY motoristas_update ON motoristas FOR UPDATE USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS motoristas_delete ON motoristas;
CREATE POLICY motoristas_delete ON motoristas FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON motoristas;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON motoristas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 2. guias
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guias (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  nome         text NOT NULL,
  telefone     text,
  credenciais  text,
  observacoes  text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guias_account_idx ON guias (account_id);

ALTER TABLE guias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guias_select ON guias;
CREATE POLICY guias_select ON guias FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS guias_insert ON guias;
CREATE POLICY guias_insert ON guias FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS guias_update ON guias;
CREATE POLICY guias_update ON guias FOR UPDATE USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS guias_delete ON guias;
CREATE POLICY guias_delete ON guias FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON guias;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON guias
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 3. veiculos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS veiculos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  modelo              text NOT NULL,
  placa               text,
  capacidade          integer NOT NULL DEFAULT 1 CHECK (capacidade > 0),
  motorista_padrao_id uuid REFERENCES motoristas(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'disponivel'
                        CHECK (status IN ('disponivel', 'manutencao', 'inativo')),
  observacoes         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS veiculos_account_idx ON veiculos (account_id);

ALTER TABLE veiculos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS veiculos_select ON veiculos;
CREATE POLICY veiculos_select ON veiculos FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS veiculos_insert ON veiculos;
CREATE POLICY veiculos_insert ON veiculos FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS veiculos_update ON veiculos;
CREATE POLICY veiculos_update ON veiculos FOR UPDATE USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS veiculos_delete ON veiculos;
CREATE POLICY veiculos_delete ON veiculos FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON veiculos;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON veiculos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 4. saidas_operacionais — one vehicle/driver/guide run on one date
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saidas_operacionais (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pacote_id          uuid NOT NULL REFERENCES pacotes(id) ON DELETE CASCADE,
  pacote_horario_id  uuid REFERENCES pacote_horarios(id) ON DELETE SET NULL,
  data               date NOT NULL,
  veiculo_id         uuid REFERENCES veiculos(id) ON DELETE SET NULL,
  motorista_id       uuid REFERENCES motoristas(id) ON DELETE SET NULL,
  guia_id            uuid REFERENCES guias(id) ON DELETE SET NULL,
  observacoes        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saidas_operacionais_account_data_idx
  ON saidas_operacionais (account_id, data);

ALTER TABLE saidas_operacionais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saidas_operacionais_select ON saidas_operacionais;
CREATE POLICY saidas_operacionais_select ON saidas_operacionais FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS saidas_operacionais_insert ON saidas_operacionais;
CREATE POLICY saidas_operacionais_insert ON saidas_operacionais FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS saidas_operacionais_update ON saidas_operacionais;
CREATE POLICY saidas_operacionais_update ON saidas_operacionais FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS saidas_operacionais_delete ON saidas_operacionais;
CREATE POLICY saidas_operacionais_delete ON saidas_operacionais FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON saidas_operacionais;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON saidas_operacionais
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 5. reservas.saida_operacional_id — assigns a booking to a run
-- ------------------------------------------------------------
ALTER TABLE reservas
  ADD COLUMN IF NOT EXISTS saida_operacional_id uuid REFERENCES saidas_operacionais(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reservas_saida_operacional_idx
  ON reservas (saida_operacional_id) WHERE saida_operacional_id IS NOT NULL;
