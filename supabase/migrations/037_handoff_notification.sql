-- ============================================================
-- 037_handoff_notification
--
-- Notify the account's agents when the AI bot stands down on a
-- conversation (handoff → "aguardando atendente"). Until now a handoff
-- only flipped conversations.ai_autoreply_disabled + showed a badge in
-- the inbox; nobody was actively told a human is needed.
--
-- Design (mirrors 027_notifications):
--   * One new notifications.type value: 'conversation_handed_off'.
--   * A SECURITY DEFINER trigger on conversations fires when
--     ai_autoreply_disabled transitions to TRUE. This single hook covers
--     EVERY mute path — markHandoff (ai_sentinel/n8n/keyword/manual), the
--     simple-tier bare update in auto-reply.ts, and the uazapi
--     mirrorFromMe 'manual_phone' path — because they all set that one
--     column.
--   * Recipients: every agent on the account (there may be no assigned
--     agent yet — the whole point is that the thread needs picking up).
--     The actor (a human who manually muted) is skipped; a bot/system
--     handoff runs as service-role so auth.uid() is NULL → everyone is
--     notified.
--   * Existing realtime + unread-badge wiring (027) surfaces it with no
--     frontend changes beyond an icon for the new type.
-- ============================================================

-- 1) Allow the new type value.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'conversation_handed_off'));

-- 2) Trigger function.
CREATE OR REPLACE FUNCTION notify_conversation_handoff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_reason_label TEXT;
BEGIN
  -- Only on a real transition INTO the muted state. An update that
  -- leaves it already-true (or sets it false) is not a new handoff.
  IF NEW.ai_autoreply_disabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF OLD.ai_autoreply_disabled IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  -- Human-readable reason (handoff_reason has no DB CHECK; see 033).
  v_reason_label := CASE NEW.handoff_reason
    WHEN 'manual_phone' THEN ' (atendente respondeu pelo celular)'
    WHEN 'n8n'          THEN ' (bot avançado pediu atendente)'
    WHEN 'ai_sentinel'  THEN ' (bot não soube responder)'
    WHEN 'keyword'      THEN ' (palavra-chave de atendimento)'
    WHEN 'manual'       THEN ' (atendimento assumido manualmente)'
    ELSE ''
  END;

  -- One row per account agent, except the person who triggered it.
  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  )
  SELECT
    NEW.account_id,
    p.user_id,
    'conversation_handed_off',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'Atendimento humano necessário',
    'A conversa com ' || COALESCE(v_contact_name, 'um contato')
      || ' aguarda atendente' || v_reason_label
  FROM profiles p
  WHERE p.account_id = NEW.account_id
    AND (auth.uid() IS NULL OR p.user_id <> auth.uid());

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the handoff itself.
  RAISE WARNING 'Failed to create handoff notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_conversation_handoff() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_conversation_handoff ON conversations;
CREATE TRIGGER on_conversation_handoff
  AFTER UPDATE OF ai_autoreply_disabled ON conversations
  FOR EACH ROW EXECUTE FUNCTION notify_conversation_handoff();
