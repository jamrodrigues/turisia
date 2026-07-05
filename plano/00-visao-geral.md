# 00 — Visão Geral do Produto

## O que estamos construindo

Um **produto SaaS gerenciado** de CRM para WhatsApp com **atendimento por IA + humano**. O operador (você) monta tudo
para cada cliente — número WhatsApp, fluxo de IA, base de conhecimento, regras — e **cobra mensalidade**. O cliente
final entra apenas como **usuário do CRM** (atendente), enxergando só a caixa de entrada, contatos e pipeline. Toda a
"tubulação" (tokens uazapi, n8n, automações, integrações) fica escondida do cliente e sob controle do operador.

## Base técnica

- **wacrm** (MIT, v0.7.0) — CRM WhatsApp em **Next.js 16 + React 19 + TypeScript + Tailwind v4 + Supabase**.
  Já traz: inbox multi-atendente, contatos/tags/campos custom, pipelines Kanban, broadcasts, automações no-code,
  fluxos visuais, **IA embutida com RAG e handoff**, papéis e multi-usuário.
- **uazapi** — API de WhatsApp não-oficial (baseada em Baileys). Conecta por **QR code**, sem exigir conta Business
  API oficial nem templates aprovados. Ideal para clientes menores que hoje não conseguem usar a API oficial.
- **Supabase online** — banco Postgres + Auth + Storage + RLS. **Um projeto Supabase por cliente** (isolamento total).
- **n8n** (opcional, por cliente) — cérebro de IA com **ferramentas** (consultar/agendar/cancelar no Supabase).
  Já em uso hoje pelo operador conectado direto ao uazapi.

## Modelo de negócio → implicação técnica

Como o cliente é só usuário e o operador é o dono, o **CRM vira o plano de controle**:
- O CRM é o **único destino do webhook** do uazapi (não o n8n direto).
- O CRM decide, por conversa, se o **bot responde** ou se **um humano assumiu** (handoff).
- O CRM guarda todo o histórico (o inbox precisa ver as respostas do bot também).
- O operador administra; o cliente só atende.

> **Por que o CRM no meio e não o n8n direto (como hoje)?** Se o n8n responde direto no uazapi, o CRM não vê as
> respostas do bot e **não consegue pausar o bot** para passar ao humano. Handoff confiável exige o CRM no circuito.
> Ver [`02-arquitetura.md`](02-arquitetura.md).

## Dois "tiers" de IA (o mesmo produto atende os dois)

| Tier | Cérebro | Para quem | Ferramentas |
|------|---------|-----------|-------------|
| **Simples** | IA embutida do wacrm (RAG + handoff) | Clube de campo (só regras + passa contato) | Base de conhecimento (docs), sem tools externas |
| **Avançado** | n8n (chamado pelo CRM) | Clínica (agenda), Agência de carro (qualifica lead) | Tools: Supabase (agendar/cancelar/consultar), APIs |

O tier é **configuração por conta**, não código diferente. Uma coluna decide se o inbound vai para a IA embutida ou
para o n8n.

## Os três clientes-alvo

1. **Clínica (IA "Neuza")** — Tier Avançado. IA agenda, cancela, reagenda, consulta agendamentos via Supabase.
   Handoff raro. Já existe um fluxo n8n funcionando — será adaptado ao modelo com o CRM no meio.
2. **Clube de campo** — Tier Simples. IA responde regras e passa o contato (handoff cedo). Sem n8n; só base de
   conhecimento + automação embutida.
3. **Agência de carro** (prospect) — Tier Avançado. IA qualifica lead → cria **deal no pipeline Kanban** → passa
   ao vendedor. Usa o pipeline nativo do wacrm.

## Decisões-chave (registradas)

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Isolamento entre clientes | **1 projeto Supabase + 1 deploy por cliente** | Simplicidade, isolamento de dados, sem risco de vazamento |
| Provider WhatsApp | **uazapi** (mantendo a opção Meta no código) | Clientes menores sem API oficial |
| Cérebro de IA | **IA embutida (tier simples) + n8n (tier avançado)** | Aproveitar o que já existe; n8n para tools |
| CRM no fluxo | **CRM é o webhook único e o plano de controle** | Handoff confiável, histórico completo |
| n8n hoje | **Ajustar as duas pontas** (entrada vinda do CRM, saída devolvida ao CRM) | Miolo do fluxo permanece |
| Idioma | **pt-BR em toda a superfície visível** (Fase 03b) — original é 100% inglês sem i18n | Clientes brasileiros; tradução direta, sem framework i18n (produto mono-idioma) |

## Glossário

- **Instância uazapi** — uma sessão de WhatsApp conectada por QR, com um `token` próprio. Uma por cliente/número.
- **account_id** — chave de tenancy interna do wacrm (migration 017). Tudo é escopado por conta.
- **Handoff** — passar a conversa do bot para um atendente humano. No wacrm: setar `ai_autoreply_disabled = true`
  e/ou `assigned_agent_id`.
- **Sentinela de handoff** — marcador de texto que o modelo emite para pedir humano (`parseGeneration`).
- **Tier** — nível de IA de uma conta: `simple` (embutido) ou `advanced` (n8n).
