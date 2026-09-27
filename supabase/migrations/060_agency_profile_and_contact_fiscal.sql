-- ============================================================
-- 060_agency_profile_and_contact_fiscal.sql
--
-- Two real gaps flagged by the agency owner after the first live
-- automated-closing test (2026-09-08): there is nowhere to register
-- the AGENCY's own business data (used on the voucher PDF, currently
-- just a bare `accounts.name`), and `contacts` has no CPF/CNPJ or
-- address for customers who need one for their own external nota
-- fiscal process (actual NFe/NFSe issuance is a separate, much bigger
-- integration — out of scope here; this only stores the data).
--
-- 1. accounts — agency business profile fields, all nullable (an
--    agency can keep using the product before filling any of this in;
--    the voucher just omits whatever's empty — see voucher.ts).
-- 2. contacts — cpf_cnpj + endereco. Free-text CPF/CNPJ (not
--    format-validated at the DB level — a partial/foreign document
--    number typed by an agent shouldn't hard-fail the save).
-- 3. agency-logo storage bucket — public (an <img> in a voucher/PDF
--    render needs no auth), writes restricted to admin+ of the
--    account that owns the folder. Same account-scoped path
--    convention as flow-media/pacote-media: account-<account_id>/...
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. accounts — agency profile
-- ------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS cnpj TEXT,
  ADD COLUMN IF NOT EXISTS telefone TEXT,
  ADD COLUMN IF NOT EXISTS endereco TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS pix_key TEXT,
  ADD COLUMN IF NOT EXISTS politica_cancelamento TEXT;

-- ------------------------------------------------------------
-- 2. contacts — fiscal document + address
-- ------------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT,
  ADD COLUMN IF NOT EXISTS endereco TEXT;

-- ------------------------------------------------------------
-- 3. agency-logo storage bucket (public)
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'agency-logo',
  'agency-logo',
  TRUE,
  2097152, -- 2 MB — same cap as avatars (008); a logo never needs more.
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public bucket → no SELECT policy needed (mirrors avatars/008: the
-- public object route bypasses RLS entirely). Writes are restricted to
-- admin+ of the account whose folder is being written, same
-- EXISTS-over-profiles shape as flow-media's account-scoped policies
-- (020), plus the role check deals-settings.tsx/accounts_update rely on.
DROP POLICY IF EXISTS "Admins can upload their agency logo" ON storage.objects;
CREATE POLICY "Admins can upload their agency logo"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'agency-logo'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Admins can replace their agency logo" ON storage.objects;
CREATE POLICY "Admins can replace their agency logo"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'agency-logo'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Admins can delete their agency logo" ON storage.objects;
CREATE POLICY "Admins can delete their agency logo"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'agency-logo'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
