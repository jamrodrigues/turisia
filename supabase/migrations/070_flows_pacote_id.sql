-- ============================================================
-- 070_flows_pacote_id.sql
--
-- Tracks which pacote a generated closing-flow "belongs" to, so
-- generateClosingFlowForPacote (generate-closing-flow.ts) can refuse
-- to silently steal a flow whose `ai_topic` (category) collides with
-- a DIFFERENT package's — before this, clicking "Gerar" on package B
-- with the same category as package A quietly overwrote A's flow
-- (same unique-active-per-topic row, 061) to point `fazer_reserva` at
-- B's pacote_id instead, with no error and no sign anything changed.
--
-- Nullable + ON DELETE SET NULL: a flow can outlive the package it was
-- generated from (deleted pacote, hand-edited flow, etc.) without
-- taking the flow down with it.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS pacote_id UUID REFERENCES pacotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_flows_pacote_id ON flows (pacote_id) WHERE pacote_id IS NOT NULL;
