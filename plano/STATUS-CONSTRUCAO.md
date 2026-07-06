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
3. **Guarda de janela 24h** — resolvida no composer do inbox (review #5); revisar se algum outro caminho de envio ainda aplica a regra Meta em uazapi.
4. **Transcrição** exige chave OpenAI (Whisper); contas advanced sem chave dependem do n8n transcrever.
5. **Debounce** usa `setTimeout` dentro de `after()` (ok no maxDuration=60); avaliar fila externa se escalar.
6. ✅ **Notificação de handoff** — FEITO. Migration `037`: novo `notifications.type='conversation_handed_off'` + trigger em `conversations` (dispara ao `ai_autoreply_disabled` virar true — cobre todos os caminhos de mute; notifica todos os agentes da conta). Frontend: type + ícone. **Requer aplicar migration 037.**
7. **Tradução** — 100% das telas em pt-BR; falta só traduzir os templates de e-mail do Supabase Auth (por projeto, no painel — passo do onboarding).
8. **Teste E2E** do tier avançado (n8n), handoff real, e da trava de cobrança.
9. **Fase 05/06 código** presente (verticais, white-label, billing gate/webhook) mas não exercitado com cliente/processador real.

> ⚠️ **Migrations 037 e 038 ainda NÃO aplicadas** no Supabase — aplicar antes de usar handoff-notification e broadcast free-text. (036 também, conferir.)

## Como validar localmente
- Supabase + uazapi já conectados (ver memória do projeto / `.env.local`).
- Instância de teste `crmia-teste` no servidor `cloudefender.uazapi.com` (número 558185559888).
- Túnel (ngrok) necessário para o webhook alcançar `localhost` — a URL muda por sessão; reapontar `POST /webhook` da instância.
