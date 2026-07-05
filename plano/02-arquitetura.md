# 02 — Arquitetura

## Princípio central: o CRM é o plano de controle

Todo o WhatsApp entra e sai **pelo CRM**. O n8n (quando existe) é chamado **pelo CRM** e devolve a resposta **ao CRM**.
Isso garante: histórico completo no inbox, controle de bot on/off por conversa, e handoff confiável.

## Fluxo de uma mensagem recebida

```
Cliente no WhatsApp
      │
      ▼
   uazapi  ──(webhook: mensagem recebida)──►  CRM  POST /api/uazapi/webhook
                                                │
                                                │ 1. resolve conta pela instância uazapi
                                                │ 2. resolve/cria contato + conversa
                                                │ 3. grava mensagem inbound (sender_type='customer')
                                                │ 4. dispara os "consumidores" na ordem do wacrm:
                                                │      a) flows (determinísticos) ── se algum consumir, para
                                                │      b) automações (keyword / new_message)
                                                │      c) IA:
                                                │
                                       conversa.assigned_agent_id?  ──► SIM ─► humano dono; bot calado (fim)
                                                │ NÃO
                                       conversa.ai_autoreply_disabled? ─► SIM ─► já em handoff; bot calado (fim)
                                                │ NÃO
                                       tier da conta?
                                          ├─ simple  ─► IA embutida (RAG) gera resposta
                                          │             ├─ handoff sentinel? ─► seta ai_autoreply_disabled=true (surge no inbox)
                                          │             └─ senão ─► engineSend* → uazapi → grava outbound (sender_type='bot')
                                          └─ advanced ─► POST n8n webhook {conversa, contato, msg, histórico}
                                                          n8n usa tools (Supabase: agenda etc)
                                                          n8n responde (Respond to Webhook) {reply?, handoff?, ...}
                                                          CRM: handoff? → ai_autoreply_disabled=true + notifica
                                                               reply?   → engineSend* → uazapi → grava outbound
```

> **Ordem "flows ganham do LLM":** o wacrm já implementa isso — `dispatchInboundToAiReply` só roda se nenhum flow
> consumiu a mensagem e se não há automação de mensagem ativa. Ver `src/lib/ai/auto-reply.ts` linhas 50-65.

## Fluxo de uma mensagem enviada (humano OU bot)

```
Origem (atendente no inbox  |  IA embutida  |  n8n via CRM)
      │
      ▼
engineSendText / engineSendMedia / engineSendInteractive*   (src/lib/flows/meta-send.ts)
      │  (HOJE chama meta-api.ts → graph.facebook.com)
      │  (DEPOIS: dispatcher por provider → uazapi.ts → /send/text | /send/media)
      ▼
   uazapi ──► WhatsApp do cliente
      │
      └─ grava row em `messages` (sender_type='bot' ou 'agent') + atualiza `conversations.last_message_*`
```

## Handoff (já existe no wacrm — só ligar os fios)

Estado por conversa (`conversations`):
- `assigned_agent_id` — quando setado, um humano é dono; a IA embutida se cala (auto-reply.ts:73).
- `ai_autoreply_disabled` — quando `true`, o bot para nessa conversa (handoff pegajoso até reabilitar).
- `ai_reply_count` + RPC `claim_ai_reply_slot` — teto de respostas automáticas por conversa (anti-loop).

Gatilhos de handoff:
1. **IA embutida decide** — o modelo emite o **sentinela** (`HANDOFF_SENTINEL`), `parseGeneration` detecta,
   `dispatchInboundToAiReply` seta `ai_autoreply_disabled=true` (auto-reply.ts:102-110). **Já funciona.**
2. **n8n decide** (novo) — o n8n devolve `{handoff:true}`; o endpoint do CRM seta `ai_autoreply_disabled=true`,
   atribui atendente e notifica. **A construir (Fase 02).**
3. **Atendente assume manualmente** — ao responder/atribuir no inbox, `assigned_agent_id` é setado. **Já funciona.**

"Devolver para o bot": setar `ai_autoreply_disabled=false` e limpar/zerar o que for necessário. Precisa de um botão
no inbox (Fase 02) — a coluna já existe.

## Multi-tenant vs multi-instância (decisão deste produto)

- **Escolhido agora:** 1 deploy + 1 projeto Supabase + 1 instância uazapi **por cliente**. Isolamento máximo.
  Simples de raciocinar; zero risco de vazar dados entre clientes.
- **Observação:** o wacrm internamente já é multi-conta (`account_id`, migration 017). Poderíamos rodar vários
  clientes num só deploy multi-tenant no futuro — mas **não agora**. O kit de provisionamento (Fase 04) automatiza a
  criação de N deploys para manter isso barato operacionalmente.

## Componentes por cliente

```
┌── Deploy Next.js (wacrm-fork) ── Vercel/Railway/VPS
│      env: SUPABASE_*, ENCRYPTION_KEY, UAZAPI_*, (LLM key)
│
├── Projeto Supabase (Postgres+Auth+Storage+RLS)  ── dados do cliente
│
├── Instância uazapi (QR conectado)  ── token próprio
│      webhook → https://deploy-do-cliente/api/uazapi/webhook
│
└── (tier avançado) Workflow n8n  ── tools Supabase do cliente
       webhook-in ← chamado pelo CRM ; Respond to Webhook → CRM
```

## Segurança do webhook

- O webhook do uazapi deve ser **autenticado**: validar um segredo compartilhado (query/header configurado na
  instância) antes de processar. O wacrm já valida assinatura no webhook Meta (`webhook-signature.ts`); replicar
  o conceito para uazapi (segredo simples, já que o uazapi não assina HMAC como a Meta).
- Chamada CRM→n8n e resposta n8n→CRM: proteger com `n8n_shared_secret` (header). Nunca aceitar handoff/send sem o
  segredo.
