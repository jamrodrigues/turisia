-- ============================================================
-- 057_conversations_unread_race_fixes.sql
-- (ported from the esclinic branch's 052_conversations_unique_per_contact.sql —
-- both fixes are generic concurrency bugs, not clinic-specific)
--
-- Invariante: UMA conversa por (account_id, contact_id).
--
-- Todo o código já assume isso. Os dois find-or-create —
-- `findOrCreateConversation` (src/lib/whatsapp/process-inbound.ts) e
-- `resolveConversationByPhone` (src/lib/whatsapp/resolve-conversation.ts)
-- — buscam por (account_id, contact_id) com `.single()` / `.maybeSingle()`.
-- Nada no banco garantia a unicidade.
--
-- A corrida: duas mensagens do mesmo contato chegando quase juntas (o
-- WhatsApp entrega em paralelo, e a Meta ainda REENVIA o webhook em
-- retry). Os dois handlers fazem o SELECT, os dois não acham nada, os
-- dois inserem. A partir daí existem 2 conversas para o contato e o
-- `.single()` passa a devolver ERRO (múltiplas linhas) — a caixa de
-- entrada daquele contato quebra de vez, e as mensagens se dividem entre
-- as duas conversas.
--
-- O código foi corrigido para tratar a violação de unicidade re-resolvendo
-- (mesmo padrão do `findOrCreateContact`), mas isso só funciona se o banco
-- de fato rejeitar a duplicata — daí este índice.
--
-- ⚠️ ORDEM DE APLICAÇÃO: rode este arquivo DEPOIS de subir o código.
-- Índice antes do código = a corrida passa a dar erro 23505 sem ninguém
-- tratando (mensagem perdida). Código antes do índice = comportamento
-- atual, nada piora.
--
-- Idempotente — seguro re-rodar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. DIAGNÓSTICO — duplicatas já existentes.
--
-- Se a corrida já aconteceu em produção, o CREATE UNIQUE INDEX abaixo
-- falha. Este bloco antecipa isso com uma mensagem legível, listando os
-- pares afetados, em vez do erro cru do índice.
--
-- Se ele levantar a exceção: NÃO force o índice. Rode a consulta do passo
-- 2 e decida a fusão com calma (é dado real de conversa de cliente).
-- ------------------------------------------------------------
DO $$
DECLARE
  v_dups INTEGER;
  v_amostra TEXT;
BEGIN
  SELECT COUNT(*), STRING_AGG(t.account_id || '/' || t.contact_id, ', ')
    INTO v_dups, v_amostra
  FROM (
    SELECT account_id, contact_id
    FROM conversations
    WHERE account_id IS NOT NULL AND contact_id IS NOT NULL
    GROUP BY account_id, contact_id
    HAVING COUNT(*) > 1
    LIMIT 20
  ) t;

  IF COALESCE(v_dups, 0) > 0 THEN
    RAISE EXCEPTION
      'Existem % par(es) (account_id, contact_id) com mais de uma conversa. '
      'O índice único NÃO foi criado. Resolva a duplicidade primeiro — veja o '
      'passo 2 deste arquivo. Pares (até 20): %', v_dups, v_amostra;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. FUSÃO MANUAL — só se o passo 1 acusou duplicatas.
--
-- DELIBERADAMENTE COMENTADO. Isto mexe em conversas reais: revise antes
-- de rodar, de preferência com backup do período.
--
-- Estratégia: a conversa MAIS ANTIGA de cada par vira a sobrevivente
-- (preserva o histórico e o id que já circula em notificações/links);
-- tudo que aponta para as demais é repontado para ela, e as vazias são
-- removidas. As 6 tabelas com FK para conversations estão cobertas:
-- messages, message_actions, flow_runs, notifications, ai_usage_events e
-- a de migration 001 L273.
--
-- Comece SÓ olhando (não altera nada):
--
--   SELECT account_id, contact_id, COUNT(*) AS qtd,
--          ARRAY_AGG(id ORDER BY created_at) AS conversas,
--          MIN(created_at) AS primeira, MAX(created_at) AS ultima
--   FROM conversations
--   WHERE account_id IS NOT NULL AND contact_id IS NOT NULL
--   GROUP BY account_id, contact_id
--   HAVING COUNT(*) > 1;
--
-- Depois, se concordar com a estratégia:
--
-- BEGIN;
--   CREATE TEMP TABLE _fusao AS
--   SELECT c.id AS perdedora, s.sobrevivente
--   FROM conversations c
--   JOIN (
--     SELECT DISTINCT ON (account_id, contact_id)
--            account_id, contact_id, id AS sobrevivente
--     FROM conversations
--     WHERE account_id IS NOT NULL AND contact_id IS NOT NULL
--     ORDER BY account_id, contact_id, created_at ASC, id ASC
--   ) s ON s.account_id = c.account_id AND s.contact_id = c.contact_id
--   WHERE c.id <> s.sobrevivente;
--
--   UPDATE messages        m SET conversation_id = f.sobrevivente FROM _fusao f WHERE m.conversation_id = f.perdedora;
--   UPDATE message_actions a SET conversation_id = f.sobrevivente FROM _fusao f WHERE a.conversation_id = f.perdedora;
--   UPDATE flow_runs       r SET conversation_id = f.sobrevivente FROM _fusao f WHERE r.conversation_id = f.perdedora;
--   UPDATE notifications   n SET conversation_id = f.sobrevivente FROM _fusao f WHERE n.conversation_id = f.perdedora;
--   UPDATE ai_usage_events e SET conversation_id = f.sobrevivente FROM _fusao f WHERE e.conversation_id = f.perdedora;
--
--   -- Reflete na sobrevivente o estado da última mensagem e soma os não-lidos.
--   UPDATE conversations s
--   SET unread_count = COALESCE(s.unread_count, 0) + COALESCE(x.somado, 0)
--   FROM (
--     SELECT f.sobrevivente, SUM(COALESCE(c.unread_count, 0)) AS somado
--     FROM _fusao f JOIN conversations c ON c.id = f.perdedora
--     GROUP BY f.sobrevivente
--   ) x
--   WHERE s.id = x.sobrevivente;
--
--   UPDATE conversations s
--   SET last_message_at   = m.created_at,
--       last_message_text = m.content_text
--   FROM (
--     SELECT DISTINCT ON (conversation_id) conversation_id, created_at, content_text
--     FROM messages ORDER BY conversation_id, created_at DESC
--   ) m
--   WHERE s.id = m.conversation_id
--     AND s.id IN (SELECT sobrevivente FROM _fusao);
--
--   DELETE FROM conversations WHERE id IN (SELECT perdedora FROM _fusao);
--
--   -- Confira o resultado ANTES do commit; se algo estranho, ROLLBACK.
--   SELECT account_id, contact_id, COUNT(*)
--   FROM conversations GROUP BY account_id, contact_id HAVING COUNT(*) > 1;
-- COMMIT;
--
-- Feita a fusão, re-rode este arquivo inteiro.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 3. O índice.
--
-- Parcial em (account_id IS NOT NULL AND contact_id IS NOT NULL): linhas
-- legadas anteriores à migration 017 podem ter account_id nulo, e no
-- Postgres NULLs num índice único são todos distintos entre si — o
-- predicado deixa explícito que essas linhas ficam de fora.
--
-- Sem status no predicado DE PROPÓSITO: a convenção do código é uma
-- conversa por contato para sempre (uma conversa fechada é REABERTA, não
-- substituída). Um índice "só uma ABERTA por contato" deixaria o
-- find-or-create — que busca sem filtrar status — ainda podendo achar
-- duas linhas e estourar no `.single()`.
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_unique_per_contact
  ON conversations (account_id, contact_id)
  WHERE account_id IS NOT NULL AND contact_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. Incremento atômico de unread_count.
--
-- O webhook fazia read-modify-write:
--   UPDATE conversations SET unread_count = <valor lido antes> + 1
-- Duas mensagens do mesmo contato no mesmo instante liam o mesmo N e as
-- duas gravavam N+1 — o contador some com uma delas, e a bolinha de
-- não-lidas no inbox fica menor que a realidade.
--
-- Mesma forma e mesma postura de segurança das migrations 007/012.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_conversation_unread(
  p_conversation_id UUID,
  p_last_message_text TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE conversations
  SET
    unread_count      = COALESCE(unread_count, 0) + 1,
    last_message_text = p_last_message_text,
    last_message_at   = NOW(),
    updated_at        = NOW()
  WHERE id = p_conversation_id;
$$;

-- Só o service role chama (o webhook usa o client service-role). anon /
-- authenticated ficam de fora para que um usuário logado não consiga
-- inflar o contador de outra conta via RPC.
REVOKE ALL ON FUNCTION increment_conversation_unread(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_conversation_unread(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION increment_conversation_unread(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_conversation_unread(UUID, TEXT) TO service_role;
