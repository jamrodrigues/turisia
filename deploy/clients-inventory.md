# Inventário de clientes

Um registro por cliente. Mantenha atualizado a cada provisionamento/upgrade.
**Não** coloque segredos aqui (tokens/senhas ficam no `.env.<slug>` de cada deploy).

| Cliente | Slug | Domínio (deploy) | Supabase (ref) | Instância uazapi | Tier IA | Versão | Provisionado em | Obs |
|---------|------|------------------|----------------|------------------|---------|--------|-----------------|-----|
| _exemplo_ Clínica Neuza | clinica-neuza | crm.clinicaneuza.com.br | abcd1234 | clinica-neuza | advanced (n8n) | v0.7.0-uazapi | 2026-07-05 | agenda via Supabase |
| | | | | | | | | |

## Checklist rápido por cliente (detalhe em `plano/checklists/checklist-por-cliente.md`)
- [ ] Projeto Supabase criado + migrations aplicadas + Realtime em messages/conversations
- [ ] Templates de e-mail do Auth traduzidos (pt-BR) — POR PROJETO
- [ ] Instância uazapi criada + webhook apontado + QR conectado
- [ ] whatsapp_config + ai_configs semeados (script `provision-client.mjs`)
- [ ] Atendentes convidados como `agent`
- [ ] Fluxo IA (simple: base de conhecimento / advanced: n8n) configurado
- [ ] Validação E2E (recebe, IA responde, handoff, devolver ao robô)
