-- ============================================================
-- 068_contact_source.sql
--
-- Fase 6.4 of the 2026-09 market-gap plan (docs/redesign-2026-plan.md):
-- lead-source tracking on contacts. This does NOT add a new Facebook/
-- Instagram Ads integration -- the public API (`POST /api/v1/contacts`,
-- already documented in docs/public-api.md) already lets any external
-- system create a contact; a Meta Lead Ads form can already reach it
-- today via Zapier/Make/n8n, no new endpoint needed. What was actually
-- missing: a way to say WHERE a contact came from. This column is that.
--
-- No default, no backfill: existing contacts stay NULL (unknown/legacy)
-- rather than a guessed value -- PRODUCT.md's "real data or nothing".
--
-- Idempotent -- safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source text
    CHECK (source IN ('whatsapp', 'facebook_ads', 'instagram_ads', 'indicacao', 'manual', 'outro'));

CREATE INDEX IF NOT EXISTS contacts_source_idx ON contacts (source) WHERE source IS NOT NULL;
