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
| 03b pt-BR | ✅ cliente | Admin (settings/automations/flows/broadcasts/dashboard) ainda em inglês; e-mails Auth por projeto |
| 04 Provisionamento | ✅ | Script não roda criação de projeto Supabase (Management API — manual) |
| 05 Onboarding | ⛔ depende do usuário | Precisa: clientes reais, números WhatsApp, fluxos n8n, domínios |
| 06 Comercial | ⛔ depende do usuário | Precisa: decisão de cobrança (Stripe?), logos, domínios |

## Portões de qualidade (estado atual)
- `npm run typecheck` ✅ · `npm run build` ✅ · `npm run test` → 637 ok / **5 falhas pré-existentes** (locale da máquina: `currency.test.ts` + `date-utils.test.ts` — não são regressão, existem no upstream nesta máquina).
- Provider Meta preservado (dispatcher só desvia quando `provider='uazapi'`).

## Pendências técnicas conhecidas (candidatas a review/fix)
1. **Mídia recebida** usa URL do servidor uazapi (não re-sobe pro Supabase Storage) — TODO em `uazapi/webhook/route.ts` (`fase-01 §1.7.3`).
2. **Broadcast** ainda é template-Meta; falta caminho texto-livre + rate-limit pro uazapi.
3. **Guarda de janela 24h** não revisada para pular no provider uazapi em todos os caminhos de envio.
4. **Transcrição** exige chave OpenAI (Whisper); contas advanced sem chave dependem do n8n transcrever.
5. **Debounce** usa `setTimeout` dentro de `after()` (ok no maxDuration=60); avaliar fila externa se escalar.
6. **Notificação de handoff** (tabela `notifications`) não dispara — só o flag `ai_autoreply_disabled` + badge no inbox. `notifications.type` tem CHECK só `conversation_assigned` (precisaria migration p/ novo tipo).
7. **Tradução admin** (settings/automations/flows/broadcasts/dashboard) pendente.
8. **Teste E2E** do tier avançado (n8n) e do handoff real.

## Como validar localmente
- Supabase + uazapi já conectados (ver memória do projeto / `.env.local`).
- Instância de teste `crmia-teste` no servidor `cloudefender.uazapi.com` (número 558185559888).
- Túnel (ngrok) necessário para o webhook alcançar `localhost` — a URL muda por sessão; reapontar `POST /webhook` da instância.
