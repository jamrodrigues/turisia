# 03 — Referência do wacrm (mapa REAL do código)

> Base: `git clone https://github.com/ArnasDon/wacrm` — versão **0.7.0**. Caminhos relativos à raiz do repo.
> Stack: Next.js 16.2.6 (App Router) · React 19.2 · TypeScript · Tailwind v4 · Supabase (`@supabase/ssr`,
> `@supabase/supabase-js`) · `@xyflow/react` (flows) · `recharts`, `shadcn`, `sonner`.

## Estrutura de diretórios (essencial)

```
src/
  app/
    (auth)/            login, signup, forgot-password
    (dashboard)/       agents, automations, broadcasts, contacts, dashboard,
                       flows, inbox, notifications, pipelines, settings
    api/
      whatsapp/        webhook, send, config, broadcast, media, react, templates   ← integração WhatsApp
      ai/              config, draft, knowledge, playground, test                   ← IA embutida
      automations/     engine, cron, [id]
      flows/           [id], cron, templates
      account/         members, invitations, api-keys, transfer-ownership           ← multi-usuário/papéis
      v1/              API pública (contacts, conversations, messages, webhooks)
  lib/
    whatsapp/          meta-api.ts, send-message.ts, resolve-conversation.ts,
                       encryption.ts, phone-utils.ts, webhook-signature.ts, templates*
    ai/                auto-reply.ts, generate.ts, providers/{anthropic,openai}.ts,
                       knowledge.ts, embeddings.ts, config.ts, context.ts, defaults.ts
    automations/       engine.ts, meta-send.ts, trigger-meta.ts
    flows/             engine.ts, meta-send.ts, validate.ts
    webhooks/          deliver.ts   (fan-out de webhooks de saída p/ integrações do cliente)
    supabase/          clients server/browser
  components/          inbox, contacts, pipelines, flows, automations, settings, ...
supabase/migrations/   001..030 (schema completo)
```

## Tabelas principais (SQL real, migration 001 + evoluções)

### `whatsapp_config` (001, alterada por 013/015/017)
```
id, user_id → auth.users, phone_number_id TEXT, waba_id TEXT,
access_token TEXT (criptografado), verify_token TEXT (criptografado),
status ('connected'|'disconnected'), connected_at, created_at, updated_at
-- migration 017 adiciona account_id (tenancy). 013 põe UNIQUE em phone_number_id.
```
**Aqui adicionamos as colunas de provider uazapi** (ver `05-schema-supabase.md`).

### `conversations` (001)
```
id, user_id, contact_id → contacts, status ('open'|'pending'|'closed'),
assigned_agent_id UUID, last_message_text, last_message_at, unread_count,
created_at, updated_at
-- + colunas de IA já presentes via migrations 029/030:
--   ai_autoreply_disabled BOOLEAN, ai_reply_count INTEGER
-- migration 017 adiciona account_id.
```

### `messages` (001, +010 interactive, +023 chat_media)
```
id, conversation_id → conversations,
sender_type ('customer'|'agent'|'bot'),  sender_id UUID,
content_type ('text'|'image'|'document'|'audio'|'video'|'location'|'template'|'interactive'),
content_text, media_url, template_name,
message_id TEXT,           -- id da mensagem no WhatsApp (wamid no Meta; usar o id do uazapi)
status ('sending'|'sent'|'delivered'|'read'|'failed'),
created_at
```

### Outras relevantes
`profiles`, `contacts` (+dedupe 022), `tags`/`contact_tags`, `custom_fields`,
`pipelines`/`pipeline_stages`/`deals`, `broadcasts`/`broadcast_recipients`,
`message_templates`, `automations`, `flows`/`flow_runs`, `api_keys`, `notifications`,
`webhook_endpoints`, e as de IA (`ai_*`, knowledge/embeddings).

## Camada de IA embutida (já pronta — REAPROVEITAR)

- `src/lib/ai/auto-reply.ts` — `dispatchInboundToAiReply({accountId, conversationId, contactId, configOwnerUserId})`.
  Chamado do webhook. **Contém toda a lógica de elegibilidade e handoff** (ver abaixo). Nunca lança exceção.
- `src/lib/ai/generate.ts` — `generateReply()` → `{ text, handoff }`; `parseGeneration(raw)` detecta o
  `HANDOFF_SENTINEL` no texto do modelo e separa `{text, handoff}`.
- `src/lib/ai/providers/{anthropic,openai}.ts` — adapters de LLM.
- `src/lib/ai/knowledge.ts` + `embeddings.ts` — RAG (base de conhecimento por conta).
- `src/lib/ai/config.ts` — `loadAiConfig(db, accountId)` → `{autoReplyEnabled, systemPrompt, provider,
  autoReplyMaxPerConversation, ...}`.

**Lógica de handoff/elegibilidade já implementada (auto-reply.ts):**
```
- config off / autoReply off            → no-op
- existe automação new_message/keyword  → no-op (evita resposta dupla)
- conversa.assigned_agent_id setado     → no-op (humano é dono)
- conversa.ai_autoreply_disabled        → no-op (handoff ativo)
- ai_reply_count >= max                 → no-op (teto)
- generateReply → handoff|texto vazio   → seta ai_autoreply_disabled=true e PARA (surge no inbox p/ humano)
- senão                                 → claim_ai_reply_slot (RPC atômico) + engineSendText(...)
```

## Pontos EXATOS de troca (Meta → uazapi)

### 1. Cliente HTTP de baixo nível — `src/lib/whatsapp/meta-api.ts` (1036 linhas)
Único lugar que fala com a Graph API:
```
linha 12:  const META_API_VERSION = 'v21.0'
linha 13:  const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`
```
Funções exportadas (assinaturas a espelhar no adapter uazapi):
```
sendTextMessage({phoneNumberId, accessToken, to, text}) → {messageId}
sendMediaMessage({phoneNumberId, accessToken, to, kind, link, caption?, filename?}) → {messageId}
sendTemplateMessage(...)                    -- Meta-específico (templates aprovados); no uazapi não precisa
sendReactionMessage({...})                  → {messageId}
sendInteractiveButtons({phoneNumberId, accessToken, to, bodyText, buttons, headerText?, footerText?}) → {messageId}
sendInteractiveList({phoneNumberId, accessToken, to, bodyText, buttonLabel, sections, ...}) → {messageId}
getMediaUrl(...) / downloadMedia(...)       -- baixar mídia recebida (Meta); uazapi entrega diferente
verifyPhoneNumber / registerPhoneNumber / subscribeWabaToApp / getSubscribedApps  -- só Meta; ignorar no uazapi
```

### 2. Camadas de envio que chamam o meta-api (envolvem retry + persistência no banco)
- `src/lib/flows/meta-send.ts` — `engineSendText`, `engineSendMedia`, `engineSendInteractiveButtons`,
  `engineSendInteractiveList`. **É a camada que a IA embutida e os flows usam.** Lê `whatsapp_config`
  (`phone_number_id`, `decrypt(access_token)`), tenta variantes de telefone, e **grava em `messages` +
  atualiza `conversations`**.
- `src/lib/automations/meta-send.ts` — `engineSendText` / `engineSendTemplate` (versão das automações).
- `src/lib/whatsapp/broadcast-core.ts` — envio de broadcasts.
- `src/lib/whatsapp/send-message.ts` — envio manual do inbox (atendente).
- `src/app/api/whatsapp/send/route.ts` — rota HTTP do send manual.

> **Estratégia de troca (Fase 01):** introduzir um **dispatcher por provider**. As funções `engineSend*` passam a
> checar `whatsapp_config.provider`; se `'uazapi'`, chamam `src/lib/whatsapp/uazapi-api.ts` (novo, mesmas
> assinaturas do meta-api); se `'meta'`, seguem como hoje. A persistência em `messages`/`conversations` **não muda**.

### 3. Webhook de entrada — `src/app/api/whatsapp/webhook/route.ts` (1068 linhas)
- `GET` — verificação do webhook Meta (`hub.challenge`). **Não usado no uazapi.**
- `POST` → `processWebhook(body)` → por `entry/changes/value`:
  - `value.statuses` → `handleStatusUpdate` (delivery/read).
  - `value.messages` + `value.contacts` → resolve `whatsapp_config` por `phone_number_id`, depois
    `processMessage(message, contact, config.account_id, config.user_id, accessToken)` por mensagem.
- `processMessage` resolve contato/conversa (via `src/lib/whatsapp/resolve-conversation.ts`), grava a mensagem
  inbound e, no bloco `after()`, dispara em ordem:
  ```
  runAutomationsForTrigger   (src/lib/automations/engine.ts)
  dispatchInboundToFlows     (src/lib/flows/engine.ts)      -- flows ganham
  dispatchInboundToAiReply   (src/lib/ai/auto-reply.ts)     -- IA embutida
  dispatchWebhookEvent       (src/lib/webhooks/deliver.ts)  -- webhooks de saída do cliente
  ```

> **Estratégia de troca (Fase 01):** criar rota nova `src/app/api/uazapi/webhook/route.ts` que (a) autentica o
> segredo, (b) **normaliza o payload uazapi** para o formato `{message, contact, phoneNumberId→instância}`, (c)
> reusa a MESMA `processMessage`/resolução/dispatch. Extrair `processMessage` para um módulo compartilhado
> (`src/lib/whatsapp/process-inbound.ts`) para os dois providers chamarem. **Não duplicar a lógica de dispatch.**

### 4. Config UI — `src/components/settings/whatsapp-config.tsx` + `src/app/api/whatsapp/config/route.ts`
Tela onde hoje se salva `phone_number_id`/`access_token` (Meta). Adicionar aba/modo uazapi (base URL, token da
instância, conectar QR). No produto, isso fica **restrito ao admin/operador** (Fase 03).

## Papéis e multi-usuário (já pronto)

- `src/app/api/account/members/*`, `invitations/*`, `transfer-ownership` — convites e membros por conta.
- `src/components/settings/role-meta.ts` — metadados de papéis.
- Migrations `017_account_sharing`, `018_account_member_rpcs`, `019_invitation_rpcs`, `020_account_sharing_followups`.
- **Gap para o produto:** garantir que o papel "atendente" **não veja** Settings/Integrações/Automações/tokens
  (Fase 03). A base de papéis existe; falta o corte de UI/rota.

## Criptografia de segredos

- `src/lib/whatsapp/encryption.ts` — `encrypt()` / `decrypt()` / `isLegacyFormat()`. Tokens ficam criptografados no
  banco. **Reusar para os tokens uazapi e o segredo do n8n.** Confirmar o nome da env de chave.

## Testes

O repo tem cobertura Vitest extensa (`*.test.ts`) em `src/lib/whatsapp/`, `src/lib/ai/`, etc. **Ao criar o
`uazapi-api.ts`, espelhar os testes de `meta-api.test.ts`** para as mesmas garantias.
