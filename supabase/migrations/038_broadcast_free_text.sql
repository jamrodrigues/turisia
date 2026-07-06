-- ============================================================
-- 038_broadcast_free_text
--
-- Adds a free-text broadcast kind alongside the existing Meta-template
-- kind. Motivation: uazapi accounts have NO template registry, so the
-- template-only broadcast path (broadcasts.template_name NOT NULL) made
-- broadcasting impossible for them. A free-text broadcast sends a plain
-- text message (via the provider dispatcher → uazapi anytime, or Meta
-- inside the 24h window) to each recipient.
--
-- Changes:
--   * template_name / template_language become nullable (a text
--     broadcast has neither).
--   * `kind` discriminates 'template' vs 'text'.
--   * `message_body` holds the free-text content.
--   * A CHECK keeps each kind's required payload present.
--
-- The recipient/aggregate-count machinery (003/005 triggers) keys only
-- off broadcast_recipients.status, which is provider- and kind-agnostic,
-- so it needs no changes.
-- ============================================================

ALTER TABLE broadcasts
  ALTER COLUMN template_name DROP NOT NULL,
  ALTER COLUMN template_language DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'template'
    CHECK (kind IN ('template', 'text')),
  ADD COLUMN IF NOT EXISTS message_body TEXT;

COMMENT ON COLUMN broadcasts.kind IS
  'template = Meta approved-template send; text = free-form text (uazapi, or Meta within the 24h window).';
COMMENT ON COLUMN broadcasts.message_body IS
  'Free-text content for kind=text broadcasts. NULL for template broadcasts.';

-- Each kind must carry its own payload. Existing rows are all templates
-- with template_name set, so they satisfy the constraint.
ALTER TABLE broadcasts
  DROP CONSTRAINT IF EXISTS broadcasts_kind_payload_check;
ALTER TABLE broadcasts
  ADD CONSTRAINT broadcasts_kind_payload_check CHECK (
    (kind = 'template' AND template_name IS NOT NULL)
    OR (kind = 'text' AND message_body IS NOT NULL)
  );
