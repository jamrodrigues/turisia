-- ============================================================
-- 054_private_media_buckets.sql
--
-- Fecha os buckets de mídia. Hoje `chat-media` e `flow-media` são
-- PÚBLICOS e a policy de leitura é, literalmente:
--
--     CREATE POLICY "Chat media is publicly readable"
--       ON storage.objects FOR SELECT
--       USING (bucket_id = 'chat-media');      -- sem NENHUM escopo
--
-- (023_chat_media.sql linhas 42 e 84-87; mesmo padrão em
-- 016_flow_media.sql linha 60.)
--
-- Ou seja: as policies de INSERT/UPDATE/DELETE exigem que o primeiro
-- segmento do caminho seja `account-<uuid>` de uma conta do usuário, mas a
-- de SELECT libera o bucket inteiro — e, como o bucket é público, nem
-- login é necessário. Qualquer pessoa com a URL baixa o arquivo, e as URLs
-- são previsíveis (`account-<uuid>/<timestamp>-<nome-original>`).
--
-- O que está nesses buckets: documentos, comprovantes, áudio e imagem
-- enviados por clientes no WhatsApp. Num CRM MULTI-TENANT, é dado sensível
-- de um cliente exposto a
-- qualquer um — inclusive a outro tenant.
--
-- Esta migração:
--   1. Marca os dois buckets como privados.
--   2. Recria as policies de SELECT com o MESMO escopo por conta das
--      demais operações (inclusive o caminho legado `<auth.uid()>/…` do
--      flow-media, preservado pela migration 020).
--
-- ------------------------------------------------------------
-- ⚠️⚠️ ORDEM DE APLICAÇÃO — NÃO INVERTER ⚠️⚠️
-- ------------------------------------------------------------
-- 1º) SUBA O CÓDIGO. Ele passa a assinar as URLs no momento do uso
--     (src/lib/storage/media-url.ts). Com o bucket ainda público, a URL
--     assinada continua funcionando normalmente — nada quebra.
-- 2º) SÓ DEPOIS aplique este SQL.
--
-- Se aplicar o SQL ANTES do código: toda mídia some do inbox e todo envio
-- de mídia falha, porque o provedor/navegador vai buscar uma URL pública
-- que passou a devolver 400.
--
-- ------------------------------------------------------------
-- O que NÃO muda
-- ------------------------------------------------------------
-- As URLs já gravadas em `messages.media_url`, na config dos flows e em
-- `message_templates.header_media_url` continuam válidas como
-- IDENTIFICADOR: o código extrai (bucket, path) delas e assina na hora.
-- Não há migração de dados.
--
-- ------------------------------------------------------------
-- Como voltar atrás (se algo escapar)
-- ------------------------------------------------------------
--   UPDATE storage.buckets SET public = TRUE
--    WHERE id IN ('chat-media', 'flow-media');
-- (reabre a leitura; as policies novas não atrapalham bucket público)
--
-- Idempotente — seguro re-rodar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Buckets privados
-- ------------------------------------------------------------
UPDATE storage.buckets
SET public = FALSE
WHERE id IN ('chat-media', 'flow-media');

-- ------------------------------------------------------------
-- 2. chat-media — leitura escopada por conta
--
-- Mesmo predicado das policies de escrita da migration 023: o primeiro
-- segmento do caminho tem que ser `account-<account_id>` de uma conta em
-- que o chamador tem profile.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Members can read chat media" ON storage.objects;
CREATE POLICY "Members can read chat media"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- ------------------------------------------------------------
-- 3. flow-media — leitura escopada por conta (+ caminho legado)
--
-- A migration 020 passou a ESCRITA para `account-<uuid>/…` mas manteve
-- gravável o caminho antigo `<auth.uid()>/…` de quem o criou. A leitura
-- precisa aceitar os dois, senão a mídia de flows antigos some da tela.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Flow media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Members can read flow media" ON storage.objects;
CREATE POLICY "Members can read flow media"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'flow-media'
    AND (
      -- Convenção atual: pasta da conta.
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
      )
      -- Legado (pré-020): pasta do próprio usuário que subiu.
      OR auth.uid()::text = (storage.foldername(name))[1]
    )
  );

-- ------------------------------------------------------------
-- Conferência depois de aplicar (só leitura):
--
--   SELECT id, public FROM storage.buckets
--    WHERE id IN ('chat-media','flow-media');       -- ambos devem vir false
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname ILIKE '%media%'
--    ORDER BY policyname;
-- ------------------------------------------------------------
