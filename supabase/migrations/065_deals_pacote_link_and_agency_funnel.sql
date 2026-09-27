-- ============================================================
-- 065_deals_pacote_link_and_agency_funnel.sql
--
-- "Ajuste os funis pra funis de agência também" (2026-09-09): Funis
-- (deals/pipelines) was the last generic-CRM surface — the
-- auto-seeded default pipeline was literally named "Sales Pipeline"
-- with English SaaS stages (New Lead → Qualified → Proposal Sent →
-- Negotiation → Won), and a "negócio" had no link to which passeio it
-- was actually about.
--
-- 1. deals.pacote_id — optional link from a deal to the package it's
--    for. Nullable: not every deal (e.g. a custom multi-day itinerary
--    request) maps to one catalog package, but most do, and showing
--    "Passeio de Buggy — R$ 180" on a kanban card instead of a bare
--    title is the same "agency, not CRM" fix already applied to
--    Reservas/Pacotes.
--
-- 2. Renames THIS account's already-seeded default pipeline + stages
--    to the new agency-flavored PT-BR defaults (src/app/(dashboard)/
--    pipelines/page.tsx SPEC_DEFAULT_STAGES, updated alongside this
--    migration) — a fresh account seeds correctly from code already;
--    this is a one-time data fix so the account that's been live-
--    tested all session doesn't stay stuck on the old English seed.
--
-- Idempotent — safe to re-run (the rename only fires when the old
-- English names are still present).
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS pacote_id uuid REFERENCES pacotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS deals_pacote_id_idx ON deals (pacote_id) WHERE pacote_id IS NOT NULL;

-- ------------------------------------------------------------
-- One-time rename of the already-seeded "Sales Pipeline" (only
-- touches rows still holding the old default names/colors — never
-- touches a pipeline/stage an admin has since customized).
-- ------------------------------------------------------------
UPDATE pipelines SET name = 'Funil de Vendas' WHERE name = 'Sales Pipeline';

UPDATE pipeline_stages s SET name = 'Novo Contato'
  FROM pipelines p WHERE p.id = s.pipeline_id AND p.name = 'Funil de Vendas' AND s.name = 'New Lead' AND s.color = '#3b82f6';
UPDATE pipeline_stages s SET name = 'Interessado'
  FROM pipelines p WHERE p.id = s.pipeline_id AND p.name = 'Funil de Vendas' AND s.name = 'Qualified' AND s.color = '#eab308';
UPDATE pipeline_stages s SET name = 'Orçamento Enviado'
  FROM pipelines p WHERE p.id = s.pipeline_id AND p.name = 'Funil de Vendas' AND s.name = 'Proposal Sent' AND s.color = '#f97316';
UPDATE pipeline_stages s SET name = 'Negociando'
  FROM pipelines p WHERE p.id = s.pipeline_id AND p.name = 'Funil de Vendas' AND s.name = 'Negotiation' AND s.color = '#8b5cf6';
UPDATE pipeline_stages s SET name = 'Fechado'
  FROM pipelines p WHERE p.id = s.pipeline_id AND p.name = 'Funil de Vendas' AND s.name = 'Won' AND s.color = '#22c55e';
