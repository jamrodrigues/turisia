# Status da construção — para revisão do Fable 5

Branch: `feat/uazapi-provider` · base: wacrm 0.7.0 (`upstream/main`) · Supabase `jtmdbwtpjqqgmxbhfrkk` (migrations 001–035 aplicadas).

## O que revisar (ordem sugerida)

1. **Adapter uazapi** — `src/lib/whatsapp/uazapi-api.ts`, `uazapi-normalize.ts`, `sender.ts` (dispatcher por provider), `process-inbound.ts` (pipeline compartilhado), rota `src/app/api/uazapi/webhook/route.ts`.
2. **Cérebro IA** — `src/lib/ai/dispatch.ts` (tier switch + debounce + transcrição), `n8n-dispatch.ts`, `eligibility.ts`, `config.ts` (`loadTierConfig`).
3. **Segurança/papéis** — migration `035`, `requireRole('admin')` nas rotas uazapi, gating no `sidebar.tsx` + `dashboard-shell.tsx`.
4. **Migrations** `031`–`035`.
5. **Provisionamento** — `scripts/provision-client.mjs`, `deploy/`.
6. **i18n** — `src/lib/i18n/pt-br.ts`, `src/lib/dates.ts`, componentes traduzidos.

## Estado por fase

| Fase | Estado | Nota |
|------|--------|------|
| 00 Baseline | ✅ | E2E validado |
| 01 Adapter uazapi | ✅ | Recebe/envia real validado (texto/imagem/áudio/handoff). Pendências: mídia→Storage, broadcast texto-livre, guarda 24h |
| 02 IA+handoff+n8n | ✅ código | E2E com chave OpenAI real / fluxo n8n real ainda não exercitado |
| 03 Papéis | ✅ | Falta teste E2E de acesso negado |
| 03b pt-BR | ✅ COMPLETO | Todas as telas (cliente + admin) traduzidas; falta só e-mails Auth (por projeto, no onboarding) |
| 04 Provisionamento | ✅ | Script não roda criação de projeto Supabase (Management API — manual) |
| 05 Onboarding | ✅ base modular | Presets de verticais + `--vertical` no script. Onboarding dos clientes REAIS depende do usuário (números/n8n/domínios) |
| 06 Comercial | ✅ base | White-label (env), trava de cobrança, webhook billing genérico, docs. Conectar Stripe real depende do usuário |

## Portões de qualidade (estado atual)
- `npm run typecheck` ✅ · `npm run build` ✅ · `npm run test` → 637 ok / **5 falhas pré-existentes** (locale da máquina: `currency.test.ts` + `date-utils.test.ts` — não são regressão, existem no upstream nesta máquina).
- Provider Meta preservado (dispatcher só desvia quando `provider='uazapi'`).

## Code-review (Fable 5, high) — 10 findings CORRIGIDOS (commit 82bdcf8)
Todos os 10 achados resolvidos e portões verdes. Resumo: #1 fromMe não
renomeia contato com nome do dono; #2 áudio chega no cérebro IA; #3 dedup
de echo com retry (sem duplicar/mutar bot em race); #4 config uazapi não
destrói creds Meta; #5 uazapi sem janela 24h no composer; #6 broadcast/react
guardam por provider; #7 `message_id` NULL (não `''`) evita colisão no índice
034; #8 n8n stand-down vs automations; #9 tier avançado respeita
`auto_reply_enabled`; #10 debounce monotônico (vencedor único).

## Pendências técnicas conhecidas (candidatas a review/fix)
1. ✅ **Mídia recebida → Storage** — FEITO. `store-inbound-media.ts` baixa a mídia do servidor uazapi e re-sobe pro bucket `chat-media` (durável); fallback pra URL do provider se falhar. Wired em `uazapi/webhook/route.ts`.
2. ✅ **Broadcast texto-livre uazapi** — FEITO. Migration `038` (kind template|text + `message_body`, template cols nullable); rota `/api/whatsapp/broadcast` com branch free-text provider-aware + throttle uazapi (700ms/envio); hook `createAndSendTextBroadcast`; UI nova `/broadcasts/simple`. **Requer aplicar migration 038.**
3. ✅ **Guarda de janela 24h** — AUDITADO. Único ponto que calcula a janela é `message-thread` (corrigido em #5, prop `sessionWindowApplies`); `MessageComposer` só é renderizado lá e não calcula sozinho; nenhum caminho server-side/API (`send-message`, `auto-reply`, v1) aplica 24h. Sem vazamento pro uazapi.
4. **Transcrição** exige chave OpenAI (Whisper); contas advanced sem chave dependem do n8n transcrever.
5. **Debounce** usa `setTimeout` dentro de `after()` (ok no maxDuration=60); avaliar fila externa se escalar.
6. ✅ **Notificação de handoff** — FEITO. Migration `037`: novo `notifications.type='conversation_handed_off'` + trigger em `conversations` (dispara ao `ai_autoreply_disabled` virar true — cobre todos os caminhos de mute; notifica todos os agentes da conta). Frontend: type + ícone. **Requer aplicar migration 037.**
7. 🟡 **Tradução e-mails Auth** — telas 100% pt-BR. Templates de e-mail Auth prontos pra colar em `plano/onboarding-auth-emails-ptbr.md` (confirmação, reset, magic link, troca de e-mail, OTP). Falta o passo manual: colar no painel de cada projeto (Authentication → Emails) e trocar `[MARCA]`.
8. **Teste E2E** do tier avançado (n8n), handoff real, e da trava de cobrança.
9. **Fase 05/06 código** presente (verticais, white-label, billing gate/webhook) mas não exercitado com cliente/processador real.

> ✅ Migrations 036/037/038 **aplicadas** no Supabase (037/038 em 2026-07-06, verificadas via REST).

## E2E uazapi (2026-07-06) — 15/15 asserts ✅
Suite em self-chat (instância `crmia-teste`, sem terceiros), servidor local + REST:
- Pipeline inbound: webhook 200 → contato/conversa/mensagem criados ✅
- Dedup de reentrega (mesmo messageid → 1 linha) ✅
- **Mídia→Storage REAL**: envio real → `/message/download` real → re-upload → `media_url` no bucket `chat-media`, público e baixável ✅
- **Handoff**: fromMe real → bot mutado (`manual_phone`) + notificação `conversation_handed_off` criada pelo trigger 037 (corpo pt-BR) ✅
- Review #1 validado: contato NÃO renomeado pro nome do dono ✅
- fromMe espelhado como `sender_type='agent'` ✅
- 038: CHECK rejeita `kind='text'` sem corpo; aceita com corpo ✅
- Primitivo de envio texto (broadcast free-text) real ✅

UI do Envio simples validada pelo usuário no navegador (1 destinatário, kind=text, sent 1/1). Mídia real do celular (áudio+imagem) confirmada indo pro bucket. Falta só broadcast multi-destinatário (throttle em volume).

## Cliente L2 Multimarcas — tier avançado LIGADO (2026-07-06)
Primeiro cliente real conectado ao cérebro n8n via contrato CRM:
- **Contrato estendido**: n8n pode responder `{reply, media[], handoff}` — CRM envia texto + fotos (carros) via provider; 1 slot de cap por turno; máx 5 mídias (`n8n-dispatch.ts`).
- **Workflow novo `L2 — Cérebro CRM`** (id `gYCWLBTnE4wrNvTf`, ativo) criado via API n8n ao lado do antigo (intacto): Webhook `l2-crm-brain` + guard `x-crm-secret` → estoque (`estoque_veiculos` no Supabase do L2, alimentado pelo scraper diário 6h) → OpenAI (credencial n8n `OpenAI L2`, gpt-4.1-mini, prompt Letícia) → `{reply, media[]}` → registrar_lead. Sem envio direto uazapi (CRM é o control plane; envio direto mutaria o bot via eco fromMe).
- **`ai_configs`**: ai_tier=advanced, n8n_webhook_url, secret encriptado, is_active=true, auto_reply_enabled=true.
- **E2E validado**: inbound → debounce → n8n (~6s) → resposta da Letícia + 2 fotos reais do Kicks no WhatsApp, persistidas como `bot` no inbox. Handoff por resposta no celular também validado ao vivo (mutou o bot durante o teste — comportamento correto).
- **Cutover produção** (pendente, decisão do usuário): apontar webhook da instância do número REAL da loja pro CRM (deploy) e desativar o workflow antigo `L2 Multimarcas — Atendente IA`.
- Limitação conhecida: `buildConversationContext` só inclui `content_type='text'` — áudio transcrito (content_type audio) não entra no history do n8n; cliente que só manda áudio não chega ao cérebro avançado com o texto transcrito.
Nota: uazapi `/send/media` recusa PNG 1x1 ("unsupported image format" na conversão JPEG) — limitação do servidor com imagens minúsculas, irrelevante em uso real.

## Como validar localmente
- Supabase + uazapi já conectados (ver memória do projeto / `.env.local`).
- Instância de teste `crmia-teste` no servidor `cloudefender.uazapi.com` (número 558185559888).
- Túnel (ngrok) necessário para o webhook alcançar `localhost` — a URL muda por sessão; reapontar `POST /webhook` da instância.
