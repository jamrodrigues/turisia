# Fase 02 — IA + handoff + round-trip n8n

**Objetivo:** o bot atende sozinho e, quando precisa, passa para um humano — de duas formas: **IA embutida (tier
simple)** e **n8n (tier advanced)**. O atendente pode devolver a conversa ao bot.

**Depende de:** Fase 01. **Entrega:** clínica (n8n) e um caso simples (embutido) funcionando ponta a ponta com
handoff nos dois sentidos.

**O que JÁ existe** (não reconstruir — ver `03-referencia-wacrm.md`): `dispatchInboundToAiReply`, elegibilidade,
sentinela de handoff, `claim_ai_reply_slot`, `assigned_agent_id`, `ai_autoreply_disabled`.

---

## 2.1 — Migrations

- `032_ai_tier_and_n8n.sql`: `ai_tier` (`simple|advanced|off`), `n8n_webhook_url`, `n8n_shared_secret`.
- `033_handoff_metadata.sql`: `handoff_at/reason/by` + índice + RPC `return_conversation_to_bot`.
- (opcional) `034_ai_conversation_state.sql`: `conversations.ai_context jsonb`.

Atualizar `loadAiConfig()` (`src/lib/ai/config.ts`) para expor `aiTier`, `n8nWebhookUrl`, `n8nSharedSecret`.

## 2.2 — Roteamento de tier no inbound

No ponto onde o inbound chama a IA (hoje `dispatchInboundToAiReply`, disparado do `after()` do webhook /
`process-inbound.ts`), inserir o switch de tier:

```ts
// dentro de process-inbound, no bloco de IA (depois de flows/automations, como hoje):
const aiConfig = await loadAiConfig(db, accountId)
if (!aiConfig || aiConfig.aiTier === 'off') { /* nada */ }
else if (aiConfig.aiTier === 'simple')   { await dispatchInboundToAiReply({ accountId, conversationId, contactId, configOwnerUserId }) }
else if (aiConfig.aiTier === 'advanced') { await dispatchInboundToN8n({ accountId, conversationId, contactId, configOwnerUserId }) }
```

> As mesmas guardas de elegibilidade (humano dono, `ai_autoreply_disabled`, teto) valem para o tier avançado —
> extrair uma função `isBotEligible(conv, config)` reutilizada pelos dois caminhos (evita bot responder em cima de
> handoff).

## 2.3 — Tier avançado: `dispatchInboundToN8n`

Novo `src/lib/ai/n8n-dispatch.ts`. Espelha o contrato de `auto-reply.ts` (owns try/catch, nunca lança).

```ts
export async function dispatchInboundToN8n(args: DispatchArgs): Promise<void> {
  try {
    const db = supabaseAdmin()
    const config = await loadAiConfig(db, args.accountId)
    if (!config?.n8nWebhookUrl) return

    const conv = await getConversation(db, args.conversationId)
    if (!isBotEligible(conv, config)) return   // humano dono / handoff / teto

    const history = await buildConversationContext(db, args.conversationId)  // reusa context.ts
    const contact = await getContact(db, args.contactId)

    const res = await fetch(config.n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-crm-secret': decrypt(config.n8nSharedSecret) },
      body: JSON.stringify({
        accountId: args.accountId,
        conversationId: args.conversationId,
        contactId: args.contactId,
        contact: { phone: contact.phone, name: contact.name },
        message: latestUserMessage(history),
        history,               // para o n8n dar contexto ao LLM
      }),
    })
    if (!res.ok) return

    // n8n responde via "Respond to Webhook":
    // { reply?: string, handoff?: boolean, reason?: string, media?: {...} }
    const out = await res.json()

    if (out.handoff) {
      await markHandoff(db, args.conversationId, { reason: out.reason ?? 'n8n', by: 'bot' })
      await notifyAgents(db, args.accountId, args.conversationId)   // usa tabela notifications (027)
      return
    }
    if (out.reply) {
      // teto atômico (reusa a RPC existente) para não estourar respostas:
      const claimed = await db.rpc('claim_ai_reply_slot', {
        conversation_id: args.conversationId, max_replies: config.autoReplyMaxPerConversation,
      })
      if (claimed.data !== true) return
      await engineSendText({ accountId: args.accountId, userId: args.configOwnerUserId,
        conversationId: args.conversationId, contactId: args.contactId, text: out.reply })
    }
  } catch (err) { console.error('[n8n dispatch] failed:', err) }
}

// markHandoff: seta ai_autoreply_disabled=true, handoff_at=now, handoff_reason, handoff_by,
// e opcionalmente assigned_agent_id (round-robin dos atendentes online — ver presence, migration 024).
```

**Modelo de resposta síncrona (recomendado):** o CRM chama o n8n e **espera** a resposta no mesmo request
(n8n com nó "Respond to Webhook"). Simples e o CRM controla o envio (histórico único). Timeout defensivo (ex. 25s;
o webhook route já usa `maxDuration=60`).

**Alternativa assíncrona:** n8n responde depois via um endpoint do CRM (`POST /api/uazapi/agent-reply` com o
segredo) que faz `engineSendText`/`markHandoff`. Útil se o fluxo do n8n for longo (>timeout). Deixar como evolução.

## 2.4 — Ajuste no n8n existente (as duas pontas)

Hoje: `uazapi → n8n → uazapi`. Novo: `CRM → n8n → CRM`.

1. **Entrada:** o Webhook node do n8n passa a ser disparado pelo **CRM** (não pelo uazapi). O corpo recebido é o do
   §2.3 (`message`, `history`, `contact`, ids). Validar o header `x-crm-secret`.
2. **Miolo:** **inalterado** — o agente de IA e as tools (Supabase: agendar/cancelar/consultar) continuam iguais.
3. **Saída:** trocar o "enviar via uazapi" pelo nó **Respond to Webhook** devolvendo `{reply}` (ou
   `{handoff:true, reason}`). O CRM envia via uazapi e grava no inbox.
4. Reapontar o webhook do **uazapi** para o CRM (`/api/uazapi/webhook`) — não mais para o n8n (já feito na Fase 01).

> Ganho: histórico completo no inbox, o CRM pausa o bot no handoff, e o n8n vira uma "função" de IA sem estado de
> transporte.

## 2.5 — Debounce de mensagens (obrigatório para qualidade da IA)

Clientes reais mandam 3-5 mensagens curtas seguidas ("oi" / "queria marcar" / "pra amanhã"). Sem agrupamento, cada
inbound dispara a IA separadamente → respostas picadas e duplicadas. Implementar **debounce por conversa** antes de
chamar a IA (os dois tiers):

- Ao chegar inbound elegível para bot: gravar `conversations.ai_debounce_until = now() + N segundos` (N
  configurável por conta, default 8-10s) e agendar o processamento.
- Quando o debounce vence, montar o contexto com **todas** as mensagens acumuladas desde a última resposta do bot
  (o `buildConversationContext` já pega o histórico — só garantir que a chamada usa o estado atual) e chamar a IA
  **uma vez**.
- Implementação no Next.js serverless: sem timer confiável. Opções: (a) `after()` com `setTimeout` dentro do
  `maxDuration` — simples, funciona no padrão do wacrm (webhook já usa `after()` e `maxDuration=60`); a cada
  inbound novo, atualizar `ai_debounce_until` e, ao acordar, só processar se `now() >= ai_debounce_until` E esta
  execução for a "dona" (comparar timestamp que ela gravou — o último inbound ganha); (b) fila externa (pg_cron /
  QStash) — evolução se (a) mostrar limite.
- Coluna extra (juntar na migration 034): `ai_debounce_until timestamptz`.

> Hoje o fluxo n8n do operador provavelmente já faz esse agrupamento — ao migrar para o modelo CRM-no-meio, o
> debounce passa a ser responsabilidade do **CRM** (o n8n recebe uma chamada só, já agregada).

## 2.6 — Áudio: transcrição antes da IA

Clientes de clínica mandam **áudio**. A IA precisa do texto:
- No pipeline inbound (após gravar a mensagem `content_type='audio'`), se a conversa é elegível para bot:
  transcrever (OpenAI Whisper API ou provider equivalente; chave por conta) e usar a transcrição como
  `content_text` da mensagem (prefixado ex. `[áudio] ...`) — assim o histórico e o RAG enxergam o conteúdo.
- Tier advanced: alternativa é o n8n transcrever (se o fluxo atual já faz, manter lá e o CRM só manda a URL da
  mídia no payload). Decidir por cliente; recomendação: **transcrever no CRM** para o inbox mostrar o texto ao
  atendente também (ganho para o humano no handoff).
- Falha de transcrição → não travar: gravar `[áudio não transcrito]` e seguir (bot pode pedir para digitar).

## 2.7 — Handoff da IA embutida (já funciona) + prompt

O tier simple já passa para humano via o **sentinela** no texto do modelo. Garantir no `systemPrompt`
(`src/lib/ai/defaults.ts` / config da conta) instruções claras de quando emitir o handoff (ex.: "quando o cliente
pedir atendente, ou fora do escopo de X, emita o handoff"). Preencher a base de conhecimento (RAG) por conta
(`/api/ai/knowledge`).

## 2.8 — "Devolver ao bot" + visibilidade do handoff no inbox

- **Botão no inbox** que chama a RPC `return_conversation_to_bot(conversationId)` (migration 033).
- **Indicador visual**: conversas com `ai_autoreply_disabled=true` marcadas como "Aguardando humano" (usar o índice
  `idx_conversations_awaiting_human`). Reaproveitar `notifications` (027) e `presence` (024) para alertar atendentes.
- Componentes: `src/components/inbox/*` (adicionar o toggle/estado).

## 2.9 — Testes ponta a ponta

- **Simple (clube):** cliente pergunta regra → IA responde do RAG. Cliente pede atendente → sentinela → conversa
  cai como "aguardando humano" → atendente responde → clica "devolver ao bot".
- **Advanced (clínica):** cliente pede agendar → CRM→n8n→tools Supabase agenda→`{reply}`→enviado. Cliente pede algo
  fora do escopo → n8n `{handoff:true}` → atendente assume. Testar teto (`claim_ai_reply_slot`) e "não responder
  quando humano dono".

## DoD

- [ ] `032`/`033`(+`034`) aplicadas; `loadAiConfig` expõe tier + n8n.
- [ ] Switch de tier no inbound; `isBotEligible` compartilhado.
- [ ] `dispatchInboundToN8n` + endpoint(s) protegidos por segredo.
- [ ] n8n da clínica ajustado (entrada do CRM, saída Respond to Webhook), tools intactas.
- [ ] Handoff nos 4 gatilhos (sentinela, n8n, manual no inbox, `fromMe` do celular) + "devolver ao bot".
- [ ] Inbox mostra "aguardando humano" e notifica atendentes.
- [ ] Debounce por conversa: rajada de mensagens → UMA resposta da IA.
- [ ] Áudio transcrito e visível no inbox; falha degrada sem travar.
