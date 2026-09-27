-- ============================================================
-- 056_pacote_media.sql — Photos/videos on tour packages.
--
-- Adds a private `pacote-media` Storage bucket (photos/videos of each
-- tour) and the `pacote_media` table that orders them per package.
-- Created private from the start — post-054 the account owns this
-- product, no reason to ship a new bucket publicly readable. Follows
-- the same account-scoped path convention as chat-media/flow-media:
--   pacote-media/account-<account_id>/<timestamp>-<basename>.<ext>
--
-- `position` orders the gallery; position 0 is the cover photo/video
-- used both in the Pacotes UI and by the AI auto-reply's "send a
-- photo when a specific package comes up" behavior
-- (src/lib/ai/pacotes.ts).
--
-- RLS on `pacote_media` mirrors `pacotes` itself (017/055): any
-- account member reads, agent+ writes — via an EXISTS join since the
-- table has no account_id column of its own (same pattern as
-- automation_steps in 017).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 1. pacote-media storage bucket (private)
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pacote-media',
  'pacote-media',
  FALSE,
  16777216, -- 16 MB, same universal cap as chat-media/flow-media
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp',
    'video/mp4', 'video/3gpp'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Members can read pacote media" ON storage.objects;
CREATE POLICY "Members can read pacote media"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'pacote-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can upload pacote media" ON storage.objects;
CREATE POLICY "Members can upload pacote media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'pacote-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update pacote media" ON storage.objects;
CREATE POLICY "Members can update pacote media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'pacote-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete pacote media" ON storage.objects;
CREATE POLICY "Members can delete pacote media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'pacote-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- ------------------------------------------------------------
-- 2. pacote_media table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pacote_media (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pacote_id  uuid NOT NULL REFERENCES pacotes(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
  url        text NOT NULL, -- stored public-form URL; signed at read/send time
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pacote_media_pacote_id_idx
  ON pacote_media (pacote_id, position);

ALTER TABLE pacote_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pacote_media_select ON pacote_media;
CREATE POLICY pacote_media_select ON pacote_media FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pacotes p
      WHERE p.id = pacote_media.pacote_id AND is_account_member(p.account_id)
    )
  );

DROP POLICY IF EXISTS pacote_media_insert ON pacote_media;
CREATE POLICY pacote_media_insert ON pacote_media FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM pacotes p
      WHERE p.id = pacote_media.pacote_id AND is_account_member(p.account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS pacote_media_delete ON pacote_media;
CREATE POLICY pacote_media_delete ON pacote_media FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM pacotes p
      WHERE p.id = pacote_media.pacote_id AND is_account_member(p.account_id, 'agent')
    )
  );
