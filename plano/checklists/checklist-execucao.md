# Checklist mestre de execução (sequencial)

> Ordem única, do zero ao produto. Cada item referencia a fase detalhada. Marque à medida que conclui.
> **Não pule etapas** — cada fase valida a anterior.

## Fase 00 — Baseline
- [ ] Repo privado (fork wacrm, MIT preservada), branch `feat/uazapi-provider`.
- [ ] Supabase de teste + migrations `001..030` aplicadas.
- [ ] `.env.local` preenchido; `npm install`; `typecheck` + `test` verdes; `npm run dev` abre o dashboard.
- [ ] Arquivos-chave lidos e premissas de `03-referencia-wacrm.md` confirmadas.

## Fase 01 — Adapter uazapi
- [ ] Migration `031` (provider) aplicada.
- [ ] `src/lib/whatsapp/uazapi-api.ts` (send text/media/react) + `uazapi-api.test.ts` verdes.
- [ ] Dispatcher por provider em `flows/meta-send.ts` e `automations/meta-send.ts` (Meta segue 100%).
- [ ] `processInboundMessage` extraído (`src/lib/whatsapp/process-inbound.ts`); webhook Meta refatorado sem regressão.
- [ ] Rota `src/app/api/uazapi/webhook/route.ts` (autentica segredo → normaliza → `processInboundMessage`).
- [ ] **Payload real do uazapi capturado** (texto + imagem + áudio) e mapeado.
- [ ] Grupos (`@g.us`) e `status@broadcast` ignorados; tipos desconhecidos degradam p/ texto (sem quebrar INSERT).
- [ ] Mídia recebida salva no Supabase Storage (infra 023); dedup por `message_id` (índice 034).
- [ ] `fromMe:true` → grava outbound + cala bot (`handoff_reason='manual_phone'`).
- [ ] Guardas de janela 24h puladas p/ uazapi; broadcast em texto livre + rate-limit.
- [ ] UI de config uazapi + conexão QR (admin).
- [ ] Conversa bidirecional real pelo inbox, sem IA.

## Fase 02 — IA + handoff + n8n
- [ ] Migrations `032`,`033`(,`034`) aplicadas; `loadAiConfig` expõe `aiTier`/n8n.
- [ ] Switch de tier no inbound; `isBotEligible` compartilhado entre simple/advanced.
- [ ] `dispatchInboundToN8n` + endpoint(s) protegidos por `x-crm-secret`.
- [ ] n8n da clínica ajustado: entrada do CRM + Respond to Webhook; tools intactas.
- [ ] Handoff nos 4 gatilhos (sentinela IA / n8n / manual / fromMe) + RPC `return_conversation_to_bot` + botão "devolver ao bot".
- [ ] Debounce por conversa (`ai_debounce_until`): rajada → UMA resposta agregada.
- [ ] Áudio transcrito antes da IA; transcrição visível no inbox; falha degrada.
- [ ] Inbox mostra "aguardando humano" + notifica atendentes.
- [ ] E2E: simple (clube-like) e advanced (clínica-like) com handoff nos dois sentidos.

## Fase 03 — Papéis
- [ ] Papel `agent` definido; guard `requireAdmin` nas rotas sensíveis.
- [ ] RLS não expõe segredos a papel de cliente.
- [ ] UI esconde tubulação para `agent` (só inbox/contatos/pipeline).
- [ ] Convite de atendente funciona; testes de acesso negado passam.

## Fase 03b — Tradução pt-BR
- [ ] Dicionário central `src/lib/i18n/pt-br.ts` criado (objeto `t`, tipado, sem framework).
- [ ] `lang="pt-BR"` no layout; helper de datas com locale `ptBR`; moeda BRL; DDI +55 default.
- [ ] 9 áreas de UI varridas com o glossário → componentes usando `t.*` (ver fase-03b §3b.4).
- [ ] URLs/rotas, tabelas e enums intactos (só superfície visível).
- [ ] Prompt-base da IA em pt-BR + instrução "responda sempre em português do Brasil" (sentinela de handoff intacto).
- [ ] Templates de e-mail do Supabase Auth traduzidos (repetir POR PROJETO — está no checklist por cliente).
- [ ] Testes que asseram texto atualizados; `typecheck` + `test` verdes.
- [ ] Navegação completa como `agent` e como `admin`: zero inglês visível.

## Fase 04 — Provisionamento
- [ ] `deploy/` (Docker Compose ou receita Vercel) parametrizável.
- [ ] `scripts/provision-client` (Supabase + migrations + instância uazapi + webhook + seed + convites).
- [ ] `deploy/UPGRADE.md` (atualização multi-cliente) + inventário de clientes.
- [ ] Piloto provisionado do zero só pelo checklist (< 1h).

## Fase 05 — Onboarding
- [ ] Clínica (advanced/n8n) no ar e validada (agenda reflete no Supabase).
- [ ] Clube (simple/embutido, sem n8n) no ar e validado (regras + handoff cedo).
- [ ] Agência (advanced/n8n + pipeline) no ar e validada (lead → deal no Kanban).

## Fase 06 — Comercial
- [ ] White-label básico; flag active/suspended no login.
- [ ] Painel central com saúde das instâncias.
- [ ] Diretrizes antiban por cliente.

---

## Portões de qualidade (rodar em toda fase)
- [ ] `npm run typecheck` verde.
- [ ] `npm run test` verde (incluindo novos testes do provider uazapi).
- [ ] Provider Meta **nunca** quebra (é o caminho legado; regressão = bug).
- [ ] Nenhum segredo (token/chave) aparece em resposta de API acessível ao papel `agent`.
- [ ] Todo endpoint que envia/recebe WhatsApp valida o segredo correspondente.
