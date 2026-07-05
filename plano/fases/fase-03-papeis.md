# Fase 03 — Papéis: admin (operador) vs atendente (cliente)

**Objetivo:** o cliente entra e vê **só** inbox + contatos + pipeline. Toda a tubulação (tokens uazapi, config
WhatsApp, IA/n8n, automações, flows, integrações, membros, API keys) fica **restrita ao operador**. Esse corte é o
que permite cobrar mensalidade com segurança.

**Depende de:** Fase 02. **Entrega:** login de cliente sem acesso à tubulação; operador com acesso total.

**Base existente** (ver `03-referencia-wacrm.md`): multi-usuário/convites/membros já existem
(`src/app/api/account/*`, migrations 017-020) e há `role-meta.ts`. Falta o **corte de permissão** por papel.

## 3.1 — Modelo de papéis

Definir (ou confirmar os existentes) 2 papéis mínimos por conta:
- `admin` / `owner` — o operador (você). Vê tudo.
- `agent` — o cliente/atendente. Vê inbox, contatos, pipeline. **Não** vê Settings/Integrações/IA/Automations/
  Flows/API keys/Membros.

Confirmar em `role-meta.ts` e nas RPCs de membros (018) quais papéis já existem. Se faltar `agent`, adicionar.

## 3.2 — Enforcement em 3 camadas (defense in depth)

1. **RLS (banco)** — garantir que policies não exponham colunas de segredo (`uazapi_instance_token`,
   `access_token`, `n8n_shared_secret`, `verify_token`) a nenhum papel do cliente. Idealmente essas colunas só via
   service role. Revisar policies das tabelas `whatsapp_config`, `ai_config`.
2. **Rotas/API (server)** — nas rotas sensíveis (`/api/whatsapp/config`, `/api/ai/*`, `/api/automations/*`,
   `/api/flows/*`, `/api/account/members`, `/api/account/api-keys`), exigir papel `admin`. Criar um guard
   `requireAdmin(session)` reutilizável em `src/lib/auth/`.
3. **UI (navegação)** — esconder itens de menu e páginas para `agent`. Ajustar o layout do dashboard
   (`src/components/layout/*`) para renderizar só inbox/contatos/pipeline quando `role==='agent'`.

## 3.3 — Onboarding de usuário do cliente

- O operador cria a conta do cliente e convida os atendentes como `agent` (fluxo de convites já existe:
  `/join/[token]`, `invitations`).
- O cliente define senha e entra direto no inbox.

## 3.4 — Testes

- Logar como `agent`: menu só mostra inbox/contatos/pipeline; acessar `/settings` ou `/api/whatsapp/config`
  diretamente → **negado** (403/redirect). Nenhum token aparece em respostas de API.
- Logar como `admin`: acesso total.

## DoD

- [ ] Papel `agent` sem acesso a tubulação (RLS + rota + UI).
- [ ] Segredos nunca retornados a papel de cliente (auditar respostas de API).
- [ ] Convite de atendente funcionando ponta a ponta.
- [ ] `guard requireAdmin` aplicado a todas as rotas sensíveis (listar quais no PR).
