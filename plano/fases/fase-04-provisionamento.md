# Fase 04 — Kit de provisionamento (1 projeto Supabase por cliente)

**Objetivo:** subir um cliente novo (deploy + Supabase + instância uazapi + fluxo) de forma **repetível e rápida**
(meta: < 1h). É o que transforma o projeto em produto escalável sem virar caos operacional.

**Depende de:** Fase 03. **Entrega:** um roteiro/script que provisiona um cliente do zero e um checklist repetível.

## 4.1 — Decisão de topologia (já tomada)

1 cliente = **1 deploy Next.js + 1 projeto Supabase + 1 instância uazapi + (opcional) 1 workflow n8n**. Isolamento
total. O custo de operar N deploys é mitigado por automação + Docker.

## 4.2 — Empacotar o deploy

Escolher **um** padrão e padronizar:
- **VPS + Docker Compose (recomendado para controle/custo):** um `docker-compose.yml` no repo-template com o
  serviço Next.js (build do wacrm-fork) parametrizado por `.env`. Um cliente = uma stack compose com seu `.env`.
- **Vercel/Railway (mais simples, menos controle):** um projeto por cliente, deploy do mesmo repo com env vars
  diferentes.

Criar no repo `deploy/` com o Compose/Dockerfile e um `.env.template` do cliente.

## 4.3 — Script de provisionamento

Criar `scripts/provision-client.*` (Node/TS ou shell) que executa, para um `CLIENT_SLUG`:

1. **Supabase** — criar projeto (via Supabase Management API se disponível, senão manual no painel) e **aplicar
   todas as migrations** (`001..034`). Guardar URL/anon/service_role.
2. **uazapi** — `POST /instance/init { name: CLIENT_SLUG }` usando `UAZAPI_ADMIN_TOKEN`; guardar o `token` da
   instância retornado; configurar o **webhook da instância** para `https://<deploy>/api/uazapi/webhook` com o
   `uazapi_webhook_secret` gerado.
3. **Deploy** — subir o serviço com `.env` preenchido (Supabase + `ENCRYPTION_KEY` novo + `UAZAPI_*`).
4. **Seed inicial no banco** — criar a conta, o usuário admin (operador), e a linha `whatsapp_config` com
   `provider='uazapi'`, `uazapi_base_url`, `uazapi_instance_name`, `uazapi_instance_token` (encrypt), tier de IA e
   config n8n conforme o cliente.
5. **Conectar QR** — abrir a tela de conexão (admin) e escanear o QR (`/instance/connect`). Passo manual.
6. **Convidar atendentes** do cliente como `agent`.

> Onde a Management API do Supabase / o `admintoken` do uazapi não permitirem automação total, o script imprime o
> **passo manual** exato (link do painel + valores a colar). O objetivo é zero ambiguidade, não 100% headless.

## 4.4 — Gestão de versões (atualizar N clientes)

- Todo cliente roda o **mesmo** repo-template numa tag/versão. Definir processo: `git pull` da tag nova + `npm ci` +
  `npm run build` + **aplicar migrations novas** em cada Supabase. Documentar em `deploy/UPGRADE.md`.
- Manter um registro (planilha/tabela) dos clientes: slug, URL do deploy, projeto Supabase, instância uazapi, tier,
  versão implantada.

## 4.5 — Segredos e rotação

- `ENCRYPTION_KEY` **único por cliente** (nunca reusar entre clientes).
- Tokens uazapi/n8n criptografados no banco. Documentar rotação (trocar token na instância → atualizar
  `whatsapp_config`).

## DoD

- [ ] `deploy/` com Docker Compose (ou receita Vercel) parametrizável por cliente.
- [ ] `scripts/provision-client` cria Supabase (ou guia manual) + aplica migrations + instância uazapi + webhook +
      seed + convites.
- [ ] `deploy/UPGRADE.md` com o processo de atualização multi-cliente.
- [ ] Registro/inventário de clientes definido.
- [ ] Um cliente-piloto provisionado do zero seguindo só o checklist (validação real de < 1h).
