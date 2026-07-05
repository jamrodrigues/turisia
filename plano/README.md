# Plano — CRM WhatsApp + IA (wacrm → uazapi) — Produto SaaS gerenciado

Este diretório contém o **plano completo e sequencial** para transformar o projeto open-source
[**wacrm**](https://github.com/ArnasDon/wacrm) num **produto comercial de CRM com atendimento por IA + humano**,
rodando com a API **uazapi** (não-oficial, conecta por QR) em vez da Meta Cloud API oficial, usando **Supabase online**
com **um projeto Supabase separado por cliente**.

> **Público deste plano:** um agente de IA (Fable 5) que vai **revisar e construir**. Cada arquivo é auto-contido,
> com caminhos reais de arquivo, SQL pronto, endpoints reais e passos numerados. Leia na ordem abaixo.

---

## Ordem de leitura

| # | Arquivo | O que é |
|---|---------|---------|
| 1 | [`00-visao-geral.md`](00-visao-geral.md) | Produto, modelo de negócio, decisões-chave, glossário |
| 2 | [`01-pre-requisitos.md`](01-pre-requisitos.md) | Contas, ferramentas, variáveis de ambiente |
| 3 | [`02-arquitetura.md`](02-arquitetura.md) | Fluxo de mensagens, plano de controle, bot↔humano, round-trip n8n, tiers |
| 4 | [`03-referencia-wacrm.md`](03-referencia-wacrm.md) | Mapa REAL do repositório: arquivos-chave, tabelas, **pontos exatos de troca** |
| 5 | [`04-referencia-uazapi.md`](04-referencia-uazapi.md) | Endpoints reais, auth, payloads de envio, eventos de webhook, instância/QR |
| 6 | [`05-schema-supabase.md`](05-schema-supabase.md) | Migrations novas (SQL pronto) — provider, modo bot/humano, config n8n, debounce, dedup |
| 7 | [`06-revisao-gaps.md`](06-revisao-gaps.md) | **Revisão crítica**: 9 gaps graves fechados (grupos, áudio, debounce, 24h, fromMe...) + decisões operacionais |
| 8 | [`fases/`](fases/) | **Fases 00→06**, cada uma com passos executáveis |
| 9 | [`checklists/`](checklists/) | Checklist mestre de execução + checklist repetível por cliente |

---

## As fases (resumo)

| Fase | Objetivo | Depende de |
|------|----------|-----------|
| [00](fases/fase-00-fork-baseline.md) | Fork do wacrm + baseline rodando (repo-template) | — |
| [01](fases/fase-01-adapter-uazapi.md) | Adapter uazapi (enviar + receber) — trocar Meta Cloud | 00 |
| [02](fases/fase-02-ia-handoff-n8n.md) | IA + handoff + round-trip n8n (aproveitar o que já existe) | 01 |
| [03](fases/fase-03-papeis.md) | Papéis admin vs atendente — cliente vê só o inbox | 02 |
| [03b](fases/fase-03b-traducao-ptbr.md) | **Tradução completa pt-BR** (original é 100% inglês, sem i18n) | 03 |
| [04](fases/fase-04-provisionamento.md) | Kit de provisionamento (1 projeto Supabase por cliente) | 03b |
| [05](fases/fase-05-onboard-clientes.md) | Onboarding clínica / clube / agência de carro | 04 |
| [06](fases/fase-06-comercial.md) | White-label, cobrança, painel central | 05 |

**Caminho crítico:** Fases 01→02→03 são o grosso do desenvolvimento. Fase 03b traduz tudo para pt-BR
(**nenhum cliente pode ver inglês** — o wacrm original não tem i18n). Fase 04 transforma em produto escalável.
Fase 05 é configuração por cliente. Fase 06 é comercial (depois de faturar).

---

## Descobertas que mudam o plano (leia antes de tudo)

Ao ler o código real do wacrm (v0.7.0), confirmamos que **muito do que planejávamos construir JÁ EXISTE**:

1. **Handoff bot→humano já é nativo.** A tabela `conversations` tem `assigned_agent_id`, `ai_autoreply_disabled`
   e `ai_reply_count`. Quando um humano assume, ou a IA decide passar, o bot cala automaticamente.
   Ver `src/lib/ai/auto-reply.ts`.
2. **IA embutida já existe** (`src/lib/ai/`): provedores Anthropic/OpenAI, base de conhecimento com embeddings (RAG),
   auto-reply, e um **sentinela de handoff** que o próprio modelo emite no texto (`parseGeneration` em
   `src/lib/ai/generate.ts`).
3. **Multi-usuário / multi-agente / papéis já existem** (`src/app/api/account/`, migration `017_account_sharing.sql`).
4. **Construtor de fluxos visual já existe** (`src/app/(dashboard)/flows`, `@xyflow/react`) + automações no-code.

**Consequência:** o trabalho real é **(a) trocar o provider WhatsApp** (Meta→uazapi) e **(b) plugar o n8n como
cérebro opcional** para clientes que precisam de ferramentas (agenda via Supabase). O CRM, o inbox, o handoff e a
IA-com-RAG já estão prontos. Isso reduz o escopo em semanas.

---

## O único ponto a CONFIRMAR contra ambiente vivo

O **formato exato do payload do webhook de mensagem recebida do uazapi** não está 100% documentado publicamente
(a doc é uma SPA OpenAPI). A Fase 01 inclui um passo obrigatório: **capturar um webhook real** (logar o corpo cru
de uma mensagem de teste) e mapear os campos. Todo o resto (endpoints de envio, auth, instância) está confirmado
via a doc e o node oficial de n8n. Ver [`04-referencia-uazapi.md`](04-referencia-uazapi.md) § "Webhook".

---

## Convenções

- Caminhos de arquivo do wacrm são relativos à raiz do repositório clonado (ex.: `src/lib/whatsapp/meta-api.ts`).
- Blocos ` ```sql ` são migrations prontas para `supabase/migrations/`.
- Blocos ` ```ts ` são esboços de implementação — Fable 5 deve revisar tipos/imports contra o código atual.
- "Provider" = qual API de WhatsApp uma conta usa: `'meta'` (legado) ou `'uazapi'` (nosso).
