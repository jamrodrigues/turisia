-- ============================================================
-- 069_messages_media_mime_type.sql
--
-- Code-review fix (2026-09-27, Fase 7): `process-inbound.ts` has
-- captured `mediaMimeType` from the uazapi download since the inbound
-- media persistence work, but the `messages` insert never wrote it —
-- it was computed and immediately dropped. This column gives it
-- somewhere to land. NOT yet consumed by the flow engine (ParsedInbound
-- still degrades media to text there) — see the comment on
-- `NormalizedInbound.mediaMimeType` in process-inbound.ts.
--
-- Idempotent -- safe to re-run.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_mime_type text;
