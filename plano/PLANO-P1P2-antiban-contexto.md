# PLANO P1+P2 — Anti-ban uazapi + contexto do bot

> **Para o executor (sessão nova):** este plano é auto-contido. Leia
> `plano/STATUS-CONSTRUCAO.md` para contexto geral. Rode os portões antes
> de começar (baseline) e depois de cada item:
> `npm run typecheck` · `npm run test` (baseline: 645 pass / 5 falhas
> pré-existentes de locale em `currency.test.ts` + `date-utils.test.ts` —
> NÃO são regressão) · `npm run build`.
> Commits: 1 por item (ou 1+2+3 juntos e 4+5 juntos), mensagem em inglês,
> co-author `Claude`, push em `origin main`
> (github.com/jamrodrigues/crmia). NÃO tocar no provider Meta — tudo
> aqui é uazapi-only ou neutro.

**Motivação:** produto roda em números NÃO-oficiais (uazapi). O maior
risco do negócio é ban do WhatsApp. Assinaturas de bot: resposta em
velocidade de máquina, intervalos fixos, volume alto em número frio.
Itens 1–3 atacam isso. Itens 4–5 corrigem cegueira do bot (áudio/mídia).

---

## Item 1 — "Digitando..." + delay humanizado (bot via uazapi)

**Problema:** o bot responde em <1s com zero indicador de digitação —
o caminho antigo (n8n direto) enviava presença e esperava; o caminho CRM
atual não. Assinatura clássica de automação.

**Endpoint uazapi (confirmado no workflow antigo):**
```
POST {base_url}/message/presence
headers: { token: <instance_token>, Content-Type: application/json }
body: { "number": "<phone|jid>", "presence": "composing", "delay": 2000 }
```

**Implementação:**
1. `src/lib/whatsapp/uazapi-api.ts` — nova função:
   ```ts
   export async function uazapiSendPresence(args: {
     ctx: UazapiContext
     to: string
     presence?: 'composing' | 'recording' | 'paused'
     delayMs?: number
   }): Promise<void>
   ```
   POST `/message/presence` com `{ number: to, presence, delay: delayMs }`.
   Best-effort: try/catch interno, falha vira `console.warn` (presença
   nunca pode derrubar um envio). Seguir o padrão de `uazapiPost` do
   arquivo.
2. `src/lib/whatsapp/sender.ts` — em `providerSendText`, SOMENTE no
   branch uazapi, ANTES do `uazapiSendText`, quando o novo arg opcional
   `humanize: true` for passado:
   ```ts
   const delayMs = Math.min(6000, Math.max(1500, text.length * 50))
   await uazapiSendPresence({ ctx, to, presence: 'composing', delayMs })
   await new Promise((r) => setTimeout(r, delayMs))
   ```
   Adicionar `humanize?: boolean` em `ProviderSendTextArgs` (default
   false — inbox/flows/automações NÃO mudam; humano real já digita).
3. Passar `humanize: true` APENAS nos caminhos de BOT:
   - `src/lib/flows/meta-send.ts` → `engineSendText` ganha arg opcional
     `humanize?: boolean` repassado ao `providerSendText`.
   - `src/lib/ai/n8n-dispatch.ts` (envio do reply) e
     `src/lib/ai/auto-reply.ts` chamam `engineSendText({..., humanize: true})`.
   - Mídia (fotos após o texto) NÃO precisa de presença — o gap natural
     dos uploads já humaniza.
4. **Atenção timeout:** webhook roda com `maxDuration = 60`
   (`src/app/api/uazapi/webhook/route.ts`). Debounce 8s + n8n ≤25s +
   delay ≤6s + retry eventual (3s) cabe. NÃO aumentar tetos.

**Teste:** unit para a fórmula do delay (novo arquivo ou dentro de um
teste existente de sender — clamp 1500/6000). E2E manual: inbound
simulado self-chat → observar "digitando..." no WhatsApp antes da
resposta.

---

## Item 2 — Jitter no broadcast uazapi

**Problema:** `UAZAPI_SEND_DELAY_MS = 700` fixo em
`src/app/api/whatsapp/broadcast/route.ts` — metrônomo perfeito é
assinatura de bot.

**Implementação:** substituir a constante por função:
```ts
/** 900–2400ms aleatório — humano não envia em intervalo fixo. */
const uazapiSendDelayMs = () => 900 + Math.floor(Math.random() * 1500)
```
Usar em `sendFreeTextBroadcast` (o `await sleep(...)` entre destinatários).

**Teste:** ajustar/estender teste existente se houver; senão unit
trivial do range. Não precisa E2E.

---

## Item 3 — Teto diário de envio + warm-up (uazapi)

**Problema:** número frio enviando volume alto no dia 1 = ban. Nenhum
limite hoje além do rate-limit por request.

**Implementação:**
1. **Migration `040_daily_send_limit.sql`:**
   ```sql
   ALTER TABLE whatsapp_config
     ADD COLUMN IF NOT EXISTS daily_send_limit INTEGER; -- NULL = sem teto
   COMMENT ON COLUMN whatsapp_config.daily_send_limit IS
     'Teto de envios OUTBOUND por dia (anti-ban p/ uazapi). NULL = ilimitado. Warm-up: começar ~30-50 e subir semanalmente.';
   ```
   Contagem do dia: **não criar tabela nova** — contar de `messages`:
   ```sql
   CREATE OR REPLACE FUNCTION count_outbound_today(p_account_id UUID)
   RETURNS BIGINT ... SECURITY DEFINER ...
   -- SELECT COUNT(*) FROM messages m
   --   JOIN conversations c ON c.id = m.conversation_id
   --  WHERE c.account_id = p_account_id
   --    AND m.sender_type IN ('agent','bot')
   --    AND m.created_at >= date_trunc('day', now() AT TIME ZONE 'America/Recife') AT TIME ZONE 'America/Recife';
   ```
   (índice: verificar se `messages(conversation_id, created_at)` já
   cobre; se lento, adicionar índice parcial.)
2. **Guard no broadcast** (`sendFreeTextBroadcast` na rota +
   `createBroadcast` em `src/lib/whatsapp/broadcast-core.ts`): se
   provider uazapi e `daily_send_limit` setado, checar
   `count_outbound_today + destinatários > limite` → erro claro
   (`daily_limit_exceeded`, mensagem em pt-BR informando o restante).
   **NÃO bloquear** replies do inbox/bot (1:1 responde inbound = risco
   baixo; bloquear atendimento seria pior que o risco). Broadcast é o
   vetor perigoso.
3. **UI:** campo "Teto diário de envios" na tela de config uazapi
   (`src/components/settings/` — achar o componente uazapi) + persistir
   via rota `src/app/api/uazapi/config/route.ts` (aceitar
   `daily_send_limit` opcional no POST; validar inteiro > 0 ou null).
4. **Doc warm-up:** seção curta no `INSTALL.md` (§3.7): semana 1:
   30–50/dia · semana 2: 80 · semana 3: 120 · semana 4+: 150–200;
   responder inbound sempre ok; broadcast só depois da semana 2.

**Teste:** unit do guard (mock count) + E2E: setar limite 1 na conta de
teste, broadcast de 2 → erro claro; limite null → passa.

---

## Item 4 — Áudio transcrito chega ao cérebro (contexto)

**Problema:** `buildConversationContext`
(`src/lib/ai/context.ts`) filtra `content_type = 'text'`. A transcrição
(`maybeTranscribeLatestAudio` em `src/lib/ai/dispatch.ts`) grava
`content_text = '[áudio] ...'` na PRÓPRIA row de áudio → o texto
transcrito NUNCA entra no history (nem no tier simples além da última
msg, nem no n8n). Cliente que só manda áudio = bot avançado cego.

**Implementação:** em `buildConversationContext`, trocar o filtro:
```ts
.in('content_type', ['text', 'audio'])
```
e no map, filtrar audio SEM transcript:
- manter row de áudio somente se `content_text` existir e NÃO for um
  placeholder puro tipo `[áudio não baixado]` — regra prática: incluir
  se `content_text.trim()` não-vazio E (não começa com '[' OU começa com
  `'[áudio]'` — o prefixo da transcrição). Conteúdo enviado ao modelo:
  o próprio `content_text` (`[áudio] blábláblá` é legível pro LLM).

**Cuidado:** `maybeTranscribeLatestAudio` roda ANTES do dispatch
(dispatch.ts chama transcrição → depois tier). Ordem já correta — a
transcrição ficará visível no context build que acontece DENTRO de
auto-reply/n8n-dispatch (eles re-buscam o contexto). Confirmar isso no
código; se o n8n-dispatch montar history antes da transcrição, mover a
chamada de transcrição para antes (já está: dispatch.ts transcreve antes
de chamar dispatchInboundToN8n/dispatchInboundToAiReply).

**Teste:** unit de `buildConversationContext` com mix
text/audio-transcrito/audio-placeholder (mock supabase como nos testes
vizinhos). Verificar: transcrito entra, placeholder não.

---

## Item 5 — Placeholder de mídia no contexto

**Problema:** cliente manda foto/documento → mensagem invisível pro
modelo → bot responde ignorando ("mandei a foto!" / "que foto?").

**Implementação:** ainda em `buildConversationContext`, incluir também
`image`/`video`/`document` como turns `user` com conteúdo sintético
quando não houver caption:
- com caption (`content_text` não-vazio): usar o caption prefixado, ex.
  `[imagem] <caption>`.
- sem caption: `[cliente enviou uma imagem]` / `[... um vídeo]` /
  `[... um documento]`.
Manter o limite de N mensagens (`aiContextMessageLimit`) inalterado.
Só `sender_type='customer'` precisa disso (mídia enviada pelo bot/agente
não agrega contexto útil; manter fora para não gastar tokens).

**Teste:** estender o unit do item 4 (casos imagem com/sem caption).

---

## Item 6 — Reset do teto de respostas por "sessão" de conversa

**Problema (visto em produção 2x):** `ai_reply_count` NUNCA reseta
sozinho — só via `return_conversation_to_bot`. Cliente recorrente numa
conversa antiga estoura o cap e o bot cala PARA SEMPRE naquela conversa,
silenciosamente. Com cap 30 demora mais, mas acontece. Além disso a UI
de Configuração (Agentes → Configuração) regrava
`auto_reply_max_per_conversation` com o valor do form — foi o que
rebaixou 30→3 em teste.

**Implementação:**
1. Em `dispatchInboundToBrain` (`src/lib/ai/dispatch.ts`), ANTES do
   pre-check de elegibilidade: se `conversations.last_message_at` (ou a
   última msg do customer) for há MAIS de 24h, zerar `ai_reply_count`
   (UPDATE direto, best-effort). Nova conversa "do dia" = cota nova.
   Cuidado: usar o valor de last_message_at ANTES do insert da mensagem
   atual — o pipeline atualiza last_message_at no processamento; buscar
   a penúltima mensagem: `messages` da conversa, 2ª mais recente,
   `created_at < now()-24h` → reset. Simples e sem migration.
2. UI `ai-config.tsx`: garantir que o campo "máx. respostas por
   conversa" carrega o valor ATUAL do banco no load (e não um default
   hardcoded tipo 3) — verificar; se já carrega, apenas subir o default
   do form para 30 quando não houver valor.

**Teste:** unit do reset (mock: penúltima msg >24h → update chamado;
<24h → não).

## Fora de escopo (NÃO fazer)
Fila externa p/ debounce, retry exponencial, dashboards extras,
spintax/variação de texto em broadcast, multi-idioma. Cortados por
decisão de produto (simplicidade).

## Validação E2E final (ambiente de teste)
Instância `crmia-teste` + dev server + ngrok (a URL do ngrok muda por
sessão — reapontar o webhook da instância: script no histórico, ou
POST `{base}/webhook` com `{url, events:['messages'], enabled:true}` e
token da instância). Conta de teste: `ed0bd1f2-…0405`, self-chat no
número conectado. Checklist:
- [ ] Bot responde COM "digitando..." visível e delay natural
- [ ] Broadcast 3 destinatários → intervalos variáveis (log)
- [ ] `daily_send_limit=1` → broadcast de 2 falha com msg clara; null → ok
- [ ] Mandar áudio → transcrição aparece no history do n8n (ver payload
      no n8n Executions) e bot responde ao conteúdo do áudio
- [ ] Mandar foto sem caption → bot reconhece que recebeu imagem
- [ ] `plano/STATUS-CONSTRUCAO.md` atualizado + migration 040 apontada
      como pendente de aplicar (usuário aplica no painel)
