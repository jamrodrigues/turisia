# Fase 05 — Onboarding dos clientes (clínica / clube / agência)

**Objetivo:** colocar os três clientes no ar, cada um com sua configuração de IA/tier/tools. Usa o kit da Fase 04.

**Depende de:** Fase 04. **Entrega:** 3 clientes atendendo em produção.

Para cada cliente: rodar o **checklist por cliente** (`checklists/checklist-por-cliente.md`), depois aplicar a
configuração específica abaixo.

---

## 5.1 — Clínica (IA "Neuza") — Tier AVANÇADO (n8n)

- `whatsapp_config.provider='uazapi'`, instância própria, QR conectado.
- `ai_config.ai_tier='advanced'`, `n8n_webhook_url` = webhook do workflow da clínica, `n8n_shared_secret` setado.
- **n8n (ajustado, Fase 02):** entrada vinda do CRM; tools Supabase da clínica (agendar/cancelar/reagendar/
  consultar); saída via Respond to Webhook. **Migrar o fluxo atual** que hoje fala direto com o uazapi.
- **Tools** apontam para o **Supabase da clínica** (o mesmo projeto do CRM, ou o que já usam — decidir; ideal
  centralizar no projeto Supabase do cliente).
- **Handoff:** raro. n8n devolve `{handoff:true}` quando fora do escopo (ex.: reclamação, caso clínico). Atendentes
  da clínica recebem no inbox.
- **Base de conhecimento (opcional):** subir FAQ/regras da clínica para complementar.

## 5.2 — Clube de campo — Tier SIMPLES (IA embutida)

- `provider='uazapi'`, instância própria.
- `ai_config.ai_tier='simple'`, `autoReplyEnabled=true`. **Sem n8n.**
- **Base de conhecimento (RAG):** subir as regras do clube, valores, horários (`/api/ai/knowledge`).
- **systemPrompt:** responder dúvidas de regras e, quando o cliente quiser reservar/associar/falar com alguém,
  **emitir o handoff** (passa o contato para um humano). Handoff cedo é o comportamento desejado.
- Poucos atendentes; handoff simples.

## 5.3 — Agência de carro — Tier AVANÇADO (n8n) + Pipeline

- `provider='uazapi'`, instância própria. `ai_tier='advanced'`.
- **n8n:** qualifica o lead (modelo desejado, faixa de preço, troca, etc). Ao qualificar:
  - Criar/atualizar **deal no pipeline Kanban** do wacrm (usar tabelas `deals`/`pipeline_stages`, ou a API v1
    `/api/v1/...`) com os dados do lead.
  - Devolver `{handoff:true}` para passar ao **vendedor**, que assume no inbox e vê o deal ligado à conversa.
- **systemPrompt/tools:** qualificação + escrita no pipeline. Handoff ao fim da qualificação.

## 5.4 — Validação por cliente

Para cada um:
- [ ] Mensagem de teste real recebida e respondida pela IA.
- [ ] Caso de handoff cai no inbox e atendente assume.
- [ ] "Devolver ao bot" funciona.
- [ ] (Clínica) agendar/cancelar via IA reflete no Supabase.
- [ ] (Carro) lead qualificado vira deal no Kanban.
- [ ] Atendentes logam como `agent` e só veem inbox/contatos/pipeline.

## DoD

- [ ] 3 clientes provisionados e configurados conforme seu tier.
- [ ] Cada um validado ponta a ponta (IA + handoff + papéis).
- [ ] Fluxos n8n da clínica e da agência ajustados ao modelo CRM-no-meio.
- [ ] Clube rodando 100% na IA embutida (sem n8n).
