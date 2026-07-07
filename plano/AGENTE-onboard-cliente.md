# Agente `onboard-cliente` — como usar e o que ele entrega

Agente do projeto em `.claude/agents/onboard-cliente.md`. Disponível em
qualquer sessão do Claude Code aberta neste repositório (ou num clone).

## Como acionar

```
use o agente onboard-cliente: novo cliente é uma clínica odonto em Olinda,
quer bot que tira dúvidas e agenda avaliação, tem chave OpenAI, número novo
```
```
use o agente onboard-cliente: traga o workflow n8n "XYZ" pra dentro do CRM
```
```
use o agente onboard-cliente: audite a config do cliente atual e otimize
```

Quanto mais contexto no briefing, melhor: ramo, cidade, o que o bot deve
fazer, se tem chave OpenAI/Anthropic, se o número é novo (warm-up), se
existe n8n/dados externos.

## Divisão de trabalho

### O agente APLICA sozinho (via REST/API, você não faz nada)
- `ai_configs` — tier, prompt do atendente (persona), chave cifrada,
  cap de respostas (default 50), toggles
- `whatsapp_config` — teto diário de envios, ajustes uazapi
- Flows, automations, pipelines/kanban, tags, campos customizados,
  base de conhecimento
- Workflow n8n novo (só quando o tier avançado se justifica) — criado e
  ativado via API, já no contrato CRM (`{reply, media[], handoff, usage}`,
  guard `x-crm-secret`, sem envio direto)
- Validação: simula inbound em self-chat e confere no banco que o bot
  respondeu certo

### O agente ENTREGA para VOCÊ (checklist final, só o que ele não alcança)
1. **SQL pra colar** — DDL/migrations novas: ele gera o arquivo e o bloco
   pronto ("cole no SQL Editor do projeto X"). Projeto virgem: bundle
   `deploy/setup-banco-completo-001-0NN.sql` inteiro, 1 colada.
2. **Passos de painel** (sem API):
   - aplicar migrations no Supabase do cliente
   - colar e-mails Auth pt-BR (`plano/onboarding-auth-emails-ptbr.md`,
     Authentication → Emails, trocar `[MARCA]`)
   - escanear QR-code da instância uazapi (pareamento físico)
3. **Conta/credenciais** (agentes não mexem em credencial):
   - criar projeto Supabase novo (se deploy novo)
   - chave OpenAI/Anthropic do cliente (colar na tela de IA)
4. **Material de operação** — resumo pra equipe do cliente:
   - inbox, o que muta o bot, botão "voltar para o robô"
   - **NUNCA responder pelo celular do número conectado**
   - warm-up do número (30–50/dia na semana 1, subir gradual) + onde
     fica o teto diário
5. **Teste de aceite** — 3–4 mensagens pra mandar do celular e conferir
   (dúvida comum, pedido de foto/mídia, áudio, handoff).

## Formato da entrega final (modelo)

```
✅ Aplicado: conta vertical=clinica · IA simples gpt-4.1-mini, prompt
   "Dra. Ana", cap 50 · KB com 12 docs · Flow "menu agendamento" ·
   pipeline "Avaliações" · teto diário 40

📋 Você:
1. SQL Editor do projeto abc123: colar <arquivo> (link)
2. Authentication → Emails: colar templates pt-BR ([MARCA] → Clínica X)
3. Escanear QR na instância "clinica-x"
4. Teste de aceite: "oi" · "quanto custa avaliação?" · 1 áudio ·
   responder pelo CRM e clicar "voltar para o robô"
```

## Regras que o agente nunca quebra
- Nativo primeiro (Flows → Automations → IA simples+KB → Kanban);
  n8n só para dado vivo externo (estoque scraped, agenda, ERP)
- n8n nunca envia direto pro WhatsApp (eco fromMe mutaria o bot)
- Handoff/caps/anti-ban são features — dimensiona, não desliga
- Valida só em self-chat; nunca mensageia terceiros
- Segredos: nunca imprime chaves; nunca usa SUPABASE_PWD
