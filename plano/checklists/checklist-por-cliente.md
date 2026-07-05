# Checklist por cliente (provisionamento repetível)

> Repetir para CADA cliente novo. Preencher os valores entre `< >`. Ver Fase 04 para o script que automatiza parte disto.

## Identificação
- Cliente: `<nome>`
- Slug (minúsculo, sem espaço/acento): `<slug>`
- Tier de IA: `simple` (embutido) | `advanced` (n8n)
- Domínio/URL do deploy: `<https://...>`

## 1. Supabase (projeto dedicado)
- [ ] Criar projeto Supabase `<slug>`.
- [ ] Aplicar migrations `001..034` (todas, na ordem).
- [ ] Habilitar **Realtime** nas tabelas `messages` e `conversations` (inbox ao vivo).
- [ ] Traduzir os **templates de e-mail do Auth** (painel Supabase → Auth → Email Templates) para pt-BR —
      todo projeto novo nasce em inglês. Copiar dos templates prontos da Fase 03b.
- [ ] Anotar plano/backup do projeto (clínica: recomendar PITR).
- [ ] Anotar: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## 2. Segredos
- [ ] Gerar `ENCRYPTION_KEY` **único** para este cliente.
- [ ] Gerar `uazapi_webhook_secret`.
- [ ] (advanced) Gerar `n8n_shared_secret`.

## 3. Instância uazapi
- [ ] `POST /instance/init { name: <slug> }` (auth `admintoken`) → guardar `token` da instância.
- [ ] Configurar webhook da instância → `https://<deploy>/api/uazapi/webhook` + `uazapi_webhook_secret`.
- [ ] Eventos: mensagens recebidas (+ enviadas/status se quiser espelhar tudo).

## 4. Deploy
- [ ] Subir o deploy (Docker Compose/Vercel) com `.env`:
      Supabase (3 chaves) + `ENCRYPTION_KEY` + `UAZAPI_BASE_URL` + (LLM key se tier simple).
- [ ] Deploy no ar, `/` abre login.

## 5. Seed no banco (conta + config)
- [ ] Criar conta + usuário **admin** (operador).
- [ ] Linha `whatsapp_config`: `provider='uazapi'`, `uazapi_base_url`, `uazapi_instance_name=<slug>`,
      `uazapi_instance_token` (encrypt), `uazapi_webhook_secret`, `phone_number_id='uazapi:<slug>'` (sintético).
- [ ] `ai_config`: `ai_tier=<simple|advanced>`, `autoReplyEnabled`, `systemPrompt`,
      (advanced) `n8n_webhook_url` + `n8n_shared_secret` (encrypt).

## 6. Conectar WhatsApp (QR)
- [ ] Login como admin → Settings → WhatsApp → Conectar → escanear QR (`/instance/connect`).
- [ ] `/instance/status` = conectado.

## 7. IA / fluxo
- [ ] (simple) Subir base de conhecimento (regras/FAQ) via `/api/ai/knowledge`; ajustar `systemPrompt` (incl. quando fazer handoff).
- [ ] (advanced) Ajustar workflow n8n: entrada do CRM (valida `x-crm-secret`), tools (Supabase do cliente), saída Respond to Webhook `{reply|handoff}`.
- [ ] (agência) Configurar escrita no pipeline (deal ao qualificar).

## 8. Atendentes do cliente
- [ ] Convidar atendentes como papel `agent`.
- [ ] Confirmar que `agent` só vê inbox/contatos/pipeline.

## 9. Validação ponta a ponta
- [ ] Mensagem de teste real → IA responde.
- [ ] Rajada de 3-4 msgs curtas → UMA resposta agregada (debounce).
- [ ] Áudio → transcrito → IA entende; transcrição visível no inbox.
- [ ] Mensagem em GRUPO → ignorada (bot NÃO responde).
- [ ] Dono responde pelo celular (`fromMe`) → bot cala nessa conversa.
- [ ] Handoff → cai no inbox → atendente assume → "devolver ao bot".
- [ ] (clínica) agendar/cancelar reflete no Supabase; TZ America/Sao_Paulo correta.
- [ ] (agência) lead → deal no Kanban.
- [ ] Mídia (imagem/áudio) recebida e enviada OK; mídia salva no Storage (não URL externa).
- [ ] Logs de produção não contêm corpo de mensagens (LGPD).

## 10. Registro
- [ ] Adicionar ao inventário: slug, URL, projeto Supabase, instância uazapi, tier, versão do deploy, data.
