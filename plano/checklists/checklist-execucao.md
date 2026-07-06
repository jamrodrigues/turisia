# Checklist mestre de execução (sequencial)

> Ordem única, do zero ao produto. Cada item referencia a fase detalhada. Marque à medida que conclui.
> **Não pule etapas** — cada fase valida a anterior.

## Fase 00 — Baseline
- [x] Repo privado (fork wacrm, MIT preservada), branch `feat/uazapi-provider`.
- [x] Supabase de teste + migrations `001..030` aplicadas.
- [x] `.env.local` preenchido; `npm install`; `typecheck` + `test` verdes; `npm run dev` abre o dashboard.
- [x] Arquivos-chave lidos e premissas de `03-referencia-wacrm.md` confirmadas.

## Fase 01 — Adapter uazapi
- [x] Migration `031` (provider) aplicada.
- [x] `src/lib/whatsapp/uazapi-api.ts` (send text/media/react) + `uazapi-api.test.ts` verdes.
- [x] Dispatcher por provider em `flows/meta-send.ts` e `automations/meta-send.ts` (Meta segue 100%).
- [x] `processInboundMessage` extraído (`src/lib/whatsapp/process-inbound.ts`); webhook Meta refatorado sem regressão.
- [x] Rota `src/app/api/uazapi/webhook/route.ts` (autentica segredo → normaliza → `processInboundMessage`).
- [x] **Payload real do uazapi capturado** (texto + imagem + áudio) e mapeado.
- [x] Grupos (`@g.us`) e `status@broadcast` ignorados; tipos desconhecidos degradam p/ texto (sem quebrar INSERT).
- [x] Mídia recebida via `/message/download` do uazapi (URL decriptada, validado E2E). *Parcial: re-upload ao Supabase Storage ainda TODO (§1.7.3); dedup por `message_id` implementado no pipeline (índice da 034 vem na Fase 02).*
- [x] `fromMe:true` → grava outbound + cala bot. *Parcial: `handoff_reason` só existe após migration 033 (Fase 02); hoje seta apenas `ai_autoreply_disabled`.*
- [ ] Guardas de janela 24h p/ uazapi + broadcast texto livre + rate-limit. *Pendente — broadcast/24h não exercitados; tratar junto da Fase 02.*
- [x] UI de config uazapi + conexão QR (admin).
- [x] Conversa bidirecional real pelo inbox, sem IA.

## Fase 02 — IA + handoff + n8n
- [x] Migrations `032`,`033`,`034` aplicadas; `loadTierConfig` expõe `aiTier`/n8n.
- [x] Switch de tier no inbound (`dispatchInboundToBrain`); `isBotEligible` compartilhado.
- [x] `dispatchInboundToN8n` (round-trip, `x-crm-secret`, timeout 25s, cap atômico).
- [ ] n8n da clínica ajustado (entrada do CRM + Respond to Webhook). *Lado do usuário — Fase 05.*
- [x] Handoff: sentinela IA (já existia) / n8n / fromMe(`manual_phone`) / manual (assign) + RPC + botão "devolver ao robô".
- [x] Debounce por conversa (`ai_debounce_until`, last-message-wins).
- [x] Áudio transcrito (Whisper best-effort) antes da IA; grava no content_text; falha degrada.
- [x] Inbox mostra "aguardando atendente". *Notificação (tabela notifications) — follow-up.*
- [ ] E2E simple/advanced com handoff. *Pendente teste com chave OpenAI / fluxo n8n real.*

## Fase 03 — Papéis
- [ ] Papel `agent` definido; guard `requireAdmin` nas rotas sensíveis.
- [x] RLS (035): SELECT de whatsapp_config/ai_configs = admin+; RPC de status sem segredos.
- [x] Sidebar esconde tubulação p/ agent/viewer + redirect de rota no dashboard-shell.
- [ ] Convite de atendente (fluxo já existe) + teste de acesso negado E2E. *Validar no onboarding.*

## Fase 03b — Tradução pt-BR
- [x] Dicionário `src/lib/i18n/pt-br.ts` (vocabulário comum) + `src/lib/dates.ts` (locale ptBR).
- [x] `lang="pt-BR"`; datas em ptBR (date-fns + toLocaleDateString, 0 `en-US`); BRL por conta (seed).
- [x] TODAS as telas traduzidas (cliente + admin: inbox, contatos, funis, auth, settings, automations, flows, broadcasts, dashboard, agents, páginas). 0 inglês visível no scan.
- [x] URLs/rotas/tabelas/enums intactos (só superfície visível).
- [x] Prompt IA default pt-BR (sentinela `[[HANDOFF]]` intacto).
- [ ] Templates de e-mail do Auth (pt-BR) — POR PROJETO no painel Supabase. *No checklist por cliente; feito no onboarding.*
- [x] Typecheck/lint/build verdes; nenhum teste quebrado pela tradução.
- [x] Navegação completa (agent + admin): zero inglês visível.

## Fase 04 — Provisionamento
- [ ] `deploy/` (Docker Compose ou receita Vercel) parametrizável.
- [ ] `scripts/provision-client` (Supabase + migrations + instância uazapi + webhook + seed + convites).
- [ ] `deploy/UPGRADE.md` (atualização multi-cliente) + inventário de clientes.
- [ ] Piloto provisionado do zero só pelo checklist (< 1h).

## Fase 05 — Onboarding
- [x] **Base modular**: presets de verticais (clinica/clube/agencia/generico) + `provision-client.mjs --vertical` (prompt, tier, funil+etapas, respostas rápidas, base de conhecimento).
- [ ] Clínica (advanced/n8n) no ar e validada — *depende do número/n8n/domínio reais do cliente*.
- [ ] Clube (simple, sem n8n) no ar e validado — *depende do cliente*.
- [ ] Agência (advanced + pipeline) no ar e validada — *depende do cliente*.
## Fase 06 — Comercial
- [x] White-label por deploy (env: nome/logo/tema) — login + sidebar + título.
- [x] Trava active/suspended/trial no login (migration 036 + `account_billing_status()` + tela bloqueada).
- [x] Cobrança: webhook genérico `/api/billing/webhook` + `set-account-status.mjs`; doc de wiring Stripe/Mercado Pago.
- [ ] Stripe/processador real conectado — *depende de conta/keys do usuário*.
- [ ] Painel central de saúde das instâncias (multi-cliente) — *follow-up opcional*.
- [x] Diretrizes antiban documentadas (fase-06 §6.6).

---

## Portões de qualidade (rodar em toda fase)
- [ ] `npm run typecheck` verde.
- [ ] `npm run test` verde (incluindo novos testes do provider uazapi).
- [ ] Provider Meta **nunca** quebra (é o caminho legado; regressão = bug).
- [ ] Nenhum segredo (token/chave) aparece em resposta de API acessível ao papel `agent`.
- [ ] Todo endpoint que envia/recebe WhatsApp valida o segredo correspondente.
