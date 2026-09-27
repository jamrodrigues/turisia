-- ============================================================
-- 055_pacotes.sql — Tour/package catalog (tourism vertical)
--
-- A minimal, account-scoped catalog of sellable packages (e.g. a
-- Porto de Galinhas agency's buggy ride, dive trip, boat tour). MVP
-- scope on purpose: single price, no variations/date-based capacity —
-- those are a later migration once a real booking flow is needed.
--
-- `category` is free text (validated in the app layer, if at all) —
-- tour categories vary too much per agency to justify a CHECK, same
-- reasoning as `automations.trigger_type`.
--
-- The AI auto-reply engine reads the account's active catalog directly
-- (src/lib/ai/pacotes.ts) to ground answers about tours/prices — same
-- "retrieve before generate" pattern as the knowledge base, just
-- structured instead of chunked text, and it returns every active row
-- rather than searching (an agency's catalog is small; correctness
-- beats relevance ranking here).
--
-- RLS mirrors `deals` (operational catalog content): any member reads,
-- agent+ writes.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS pacotes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name             text NOT NULL,
  category         text,
  description      text,
  price            numeric(10,2) NOT NULL DEFAULT 0,
  duration_minutes integer,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- The AI catalog read and the list UI both filter on (account_id, is_active).
CREATE INDEX IF NOT EXISTS pacotes_account_active_idx
  ON pacotes (account_id, is_active);

ALTER TABLE pacotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pacotes_select ON pacotes;
CREATE POLICY pacotes_select ON pacotes FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS pacotes_insert ON pacotes;
CREATE POLICY pacotes_insert ON pacotes FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS pacotes_update ON pacotes;
CREATE POLICY pacotes_update ON pacotes FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS pacotes_delete ON pacotes;
CREATE POLICY pacotes_delete ON pacotes FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON pacotes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pacotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
