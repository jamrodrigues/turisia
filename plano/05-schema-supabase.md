# 05 — Schema Supabase (migrations novas)

> Continuação numérica a partir de `030_ai_knowledge.sql` (última do wacrm 0.7.0). Colocar em
> `supabase/migrations/`. Aplicar via Supabase CLI (`supabase db push`) ou colando no SQL Editor do painel.
> **Confirmar nomes de coluna reais** (`account_id` existe desde a 017; `ai_autoreply_disabled`/`ai_reply_count`
> desde 029) antes de aplicar — estas migrations assumem esse estado.

---

## 031 — Provider uazapi em `whatsapp_config`

Adiciona suporte a múltiplos providers sem quebrar o Meta existente. O `provider` decide qual cliente HTTP usar.

```sql
-- supabase/migrations/031_whatsapp_provider_uazapi.sql
alter table whatsapp_config
  add column if not exists provider text not null default 'meta'
    check (provider in ('meta', 'uazapi')),
  add column if not exists uazapi_base_url text,
  add column if not exists uazapi_instance_name text,
  add column if not exists uazapi_instance_token text,   -- criptografado (encrypt())
  add column if not exists uazapi_webhook_secret text;    -- valida webhook de entrada

-- phone_number_id é NOT NULL na 001 e tem UNIQUE (013). No provider uazapi não há
-- phone_number_id. Estratégia recomendada: preencher phone_number_id com um valor
-- sintético estável e único por instância, ex. 'uazapi:'||uazapi_instance_name,
-- para satisfazer o NOT NULL/UNIQUE e permitir o lookup por instância no webhook.
-- (Alternativa: dropar o NOT NULL — porém mexe em mais lugares. Preferir o sintético.)

comment on column whatsapp_config.provider is
  'Qual API de WhatsApp esta conta usa: meta (Cloud API) ou uazapi (não-oficial via QR).';
```

**Lookup no webhook uazapi:** a rota resolve a conta por `uazapi_instance_name` (ou pelo `phone_number_id`
sintético). Índice:

```sql
create index if not exists idx_whatsapp_config_uazapi_instance
  on whatsapp_config (uazapi_instance_name)
  where uazapi_instance_name is not null;
```

---

## 032 — Tier de IA e integração n8n por conta

Onde fica a decisão "IA embutida (simple) vs n8n (advanced)" e a config do n8n.

```sql
-- supabase/migrations/032_ai_tier_and_n8n.sql

-- Reusa a tabela de config de IA existente (criada na 029). Confirmar o nome real
-- da tabela de ai config (ex.: ai_config / ai_reply_config). Ajustar o nome abaixo.
alter table ai_config
  add column if not exists ai_tier text not null default 'simple'
    check (ai_tier in ('simple', 'advanced', 'off')),
  add column if not exists n8n_webhook_url text,
  add column if not exists n8n_shared_secret text;         -- criptografado

comment on column ai_config.ai_tier is
  'simple = IA embutida (RAG) do wacrm; advanced = delega ao n8n via webhook; off = sem bot.';
```

> Se a tabela de config de IA tiver outro nome, mover estas 3 colunas para lá. O importante: `loadAiConfig()`
> (`src/lib/ai/config.ts`) deve passar a expor `aiTier`, `n8nWebhookUrl`, `n8nSharedSecret`.

---

## 033 — Estado de handoff explícito (opcional, melhora auditoria)

O handoff já funciona com `ai_autoreply_disabled` + `assigned_agent_id`. Esta migration adiciona metadados úteis
para o produto (quem/quando/por quê passou para humano) e o botão "devolver ao bot".

```sql
-- supabase/migrations/033_handoff_metadata.sql
alter table conversations
  add column if not exists handoff_at timestamptz,
  add column if not exists handoff_reason text,           -- 'ai_sentinel' | 'n8n' | 'manual' | 'keyword'
  add column if not exists handoff_by text;               -- 'bot' | user_id do atendente

-- Índice para o inbox filtrar "aguardando humano" rapidamente.
create index if not exists idx_conversations_awaiting_human
  on conversations (account_id, ai_autoreply_disabled)
  where ai_autoreply_disabled = true;
```

**RPC para "devolver ao bot"** (reabilita a IA na conversa):

```sql
-- também na 033
create or replace function return_conversation_to_bot(p_conversation_id uuid)
returns void
language sql
security definer
as $$
  update conversations
     set ai_autoreply_disabled = false,
         assigned_agent_id = null,
         ai_reply_count = 0,               -- zera o teto para o bot voltar a responder
         handoff_at = null,
         handoff_reason = null,
         handoff_by = null,
         updated_at = now()
   where id = p_conversation_id;
$$;
-- Conceder execução ao role autenticado com RLS conferindo a conta (seguir o padrão
-- das RPCs existentes em 018/019).
```

---

## 034 — Estado de IA por conversa: contexto + debounce

```sql
-- supabase/migrations/034_ai_conversation_state.sql
alter table conversations
  add column if not exists ai_context jsonb not null default '{}'::jsonb,
  add column if not exists ai_debounce_until timestamptz;   -- agrupamento de rajadas (Fase 02 §2.5)
comment on column conversations.ai_context is
  'Estado livre para o cérebro de IA (embutido ou n8n) manter memória por conversa.';
comment on column conversations.ai_debounce_until is
  'Enquanto now() < ai_debounce_until, novos inbounds só reagendam; a IA responde uma vez, agregada.';
```

**Dedup de webhook (Fase 01 §1.7.8):** garantir unicidade do id do WhatsApp por conversa:

```sql
-- também na 034
create unique index if not exists idx_messages_dedup_wa_id
  on messages (conversation_id, message_id)
  where message_id is not null;
```
> Conferir antes se o webhook Meta atual nunca insere `message_id` duplicado de propósito (reações/edits vão em
> tabelas próprias — migration 009 — então deve ser seguro). Se houver duplicatas legadas, limpar antes.

> Muitos fluxos n8n guardam estado no próprio Supabase do cliente (tabelas de agendamento). Só use `ai_context`
> se precisar de memória conversacional genérica.

---

## Ordem de aplicação e reversão

1. `031` → `032` → `033` → `034` (nesta ordem).
2. Todas usam `if not exists` / `add column`, então são **idempotentes e não-destrutivas**.
3. Reversão: `alter table ... drop column ...` (as colunas novas). Nenhuma migration remove dado existente.

## Impacto em RLS

As colunas novas herdam as policies das tabelas (todas já têm RLS por `account_id` desde a 017). Os **segredos**
(`uazapi_instance_token`, `n8n_shared_secret`) só devem ser lidos por código server-side (`supabaseAdmin()` /
service role) — **nunca** expor via a policy do cliente anon. Conferir que nenhuma view/policy exponha essas
colunas ao papel "atendente" (relacionado à Fase 03).
