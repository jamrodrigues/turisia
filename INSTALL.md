# Instalação e configuração — CRM WhatsApp + IA

Guia passo a passo para subir **um deploy por cliente** num VPS, do zero
até o bot atendendo no WhatsApp.

> **Modelo do produto:** cada cliente tem seu **próprio deploy** + seu
> **próprio projeto Supabase** + seu **próprio número/instância uazapi**.
> Nada de config de cliente vive no código — tudo entra por variáveis de
> ambiente (`.env.local`), pelo banco (Supabase) e, no tier avançado,
> pelo n8n. O repositório é **virgem**: clone o mesmo `main` para cada
> cliente e configure o ambiente.

---

## 1. Visão geral da arquitetura

```
Cliente no WhatsApp
      │
      ▼
uazapi (instância do número)  ──webhook──►  CRM (Next.js, este repo)
                                                │
                                    ┌───────────┼─────────────┐
                                    ▼           ▼             ▼
                              Supabase     IA tier         Inbox
                            (Postgres/     • simples        (agentes
                             Auth/Storage)   (built-in)      humanos)
                                            • avançado
                                              (n8n)
```

- **Provider WhatsApp:** `uazapi` (não-oficial, QR-code) **ou** Meta Cloud API.
- **IA:** `off` · `simples` (responder built-in do CRM, chave OpenAI/Anthropic por conta) · `avançado` (delega a um workflow n8n).
- **Um número = uma instância uazapi = uma conta no CRM.**

---

## 2. Pré-requisitos

| Item | Observação |
|------|-----------|
| VPS Linux | 1 vCPU / 2 GB RAM já roda; Docker OU Node 20+ |
| Domínio/subdomínio | ex.: `crm.cliente.com.br` — o webhook precisa de URL pública estável (HTTPS) |
| Projeto Supabase | 1 por cliente (Free serve para começar) |
| Instância uazapi | número de WhatsApp do cliente conectado num servidor uazapi |
| Chave OpenAI/Anthropic | só se for usar IA (o cliente cola na tela; não é env) |
| n8n | só para o tier avançado |

---

## 3. Passo a passo

### 3.1 Clonar o repositório (via git)

```bash
ssh usuario@seu-vps
git clone https://github.com/jamrodrigues/crmia.git cliente-x
cd cliente-x
```

### 3.2 Criar o projeto Supabase e aplicar as migrations

1. Crie um projeto novo em <https://supabase.com/dashboard> (região mais
   próxima do cliente). Anote `Project URL` e as chaves (Settings → API).
2. Aplique **todas** as migrations, em ordem, `001` → `038`. Elas são a
   fonte de verdade em `supabase/migrations/`.

   **Opção A — painel (SQL Editor):** abra `Authentication → ... → SQL
   Editor`, cole o conteúdo de cada arquivo de `supabase/migrations/` na
   ordem numérica e rode. (Ou concatene todos num só e rode de uma vez.)

   **Opção B — Supabase CLI:**
   ```bash
   npx supabase link --project-ref SEU_PROJECT_REF
   npx supabase db push
   ```

   > O arquivo `deploy/setup-banco-001-031.sql` é **antigo** (para até a
   > 031). **Não use sozinho** — aplique `supabase/migrations/` completo
   > (001→038), senão faltam tier de IA, handoff, RLS lockdown, billing,
   > notificação de handoff e broadcast de texto livre.

### 3.3 Configurar o ambiente

```bash
cp .env.local.example .env.local
nano .env.local
```

Preencha o mínimo obrigatório (detalhes na seção 5):

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...        # anon key
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...            # service_role (secreto!)
ENCRYPTION_KEY=<64 hex>                             # gere abaixo
NEXT_PUBLIC_SITE_URL=https://crm.cliente.com.br
# White-label (opcional):
NEXT_PUBLIC_BRAND_NAME=Loja de Carros Exemplo
NEXT_PUBLIC_BRAND_THEME=emerald
```

Gere a `ENCRYPTION_KEY` (32 bytes, AES-256-GCM):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
> ⚠️ Guarde essa chave. Trocá-la depois **invalida todos os tokens**
> criptografados (uazapi/Meta) — o cliente teria que reconectar o WhatsApp.

### 3.4 Build e execução

**Opção A — Docker (recomendado):**
```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

**Opção B — Node direto:**
```bash
npm ci
npm run build
npm run start          # sobe na porta 3000
# produção: use pm2/systemd para manter de pé
# pm2 start "npm run start" --name crm-cliente-x
```

### 3.5 Domínio + HTTPS (proxy reverso)

O webhook do uazapi precisa alcançar a app por **HTTPS público estável**.
Aponte seu domínio para o VPS e ponha um proxy (nginx/Caddy) na frente da
porta 3000. Exemplo Caddy (`/etc/caddy/Caddyfile`):

```
crm.cliente.com.br {
    reverse_proxy localhost:3000
}
```
Caddy emite o certificado sozinho. Confirme:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://crm.cliente.com.br/login   # 200
```

### 3.6 Criar a conta admin

Acesse `https://crm.cliente.com.br/signup` e crie o primeiro usuário — ele
vira **owner** da conta automaticamente (migration 017). Depois convide a
equipe em Configurações → Membros.

### 3.7 Conectar o WhatsApp (uazapi)

1. No servidor uazapi, tenha a instância do número do cliente conectada
   (QR-code escaneado, status `connected`).
2. No CRM: **Configurações → uazapi**. Informe:
   - **base_url** do servidor uazapi (ex.: `https://SEU-SERVIDOR.uazapi.com`)
   - **instance name** (curto, minúsculo)
   - **instance token**
3. Salve. O CRM valida o token, gera o **webhook secret** e tenta
   configurar o webhook automaticamente. Se aparecer a URL para colar
   manualmente, cole-a no painel do uazapi (campo webhook, eventos =
   `messages`).
4. Teste: mande uma mensagem para o número → deve aparecer no inbox.

> A partir daqui, **respostas devem sair pelo CRM** (inbox ou bot).
> Responder pelo celular conectado **silencia o bot** naquela conversa
> (o CRM entende "humano assumiu"; use "voltar para o robô" para religar).

### 3.8 Configurar a IA

**Tier simples (sem n8n)** — Configurações → Assistente de IA:
- Provider (OpenAI/Anthropic) + a **chave do próprio cliente** (fica
  criptografada com a `ENCRYPTION_KEY`).
- Prompt do sistema + (opcional) base de conhecimento.
- Ligue o master switch e o "auto-reply".

**Tier avançado (n8n)** — para lógica com ferramentas externas (estoque,
agenda, etc.): ver o exemplo completo na seção 4.

Pronto: o bot responde 24/7 enquanto a conversa não estiver mutada, sem
agente atribuído e dentro do teto de respostas por conversa.

---

## 4. Exemplo completo — Loja de Carros (tier avançado + n8n)

Cenário: concessionária cujo estoque vive num site de terceiros. Um
scraper diário salva o estoque num banco; o bot consulta e responde com
texto **+ fotos** dos carros, tudo dentro do CRM.

**Fluxo:**
```
Cliente → uazapi → CRM → (debounce) → n8n "Cérebro"
                                        ├─ lê estoque (Supabase/API)
                                        ├─ OpenAI (prompt do vendedor)
                                        └─ responde {reply, media[]}
                          CRM ← {reply, media[]} ──┘
                          └→ envia texto + fotos via uazapi → inbox
```

**Contrato CRM ↔ n8n** (o CRM é o control plane; o n8n **nunca** envia
direto pro WhatsApp — envio direto voltaria como eco e mutaria o bot):

O CRM faz `POST` no `n8n_webhook_url` com header `x-crm-secret`:
```json
{
  "accountId": "...", "conversationId": "...", "contactId": "...",
  "contact": { "phone": "5581...", "name": "Cliente" },
  "message": "tem onix automático? manda foto",
  "history": [ { "role": "user", "content": "..." }, { "role": "assistant", "content": "..." } ]
}
```
O n8n responde (Respond to Webhook):
```json
{
  "reply": "Temos sim! Onix 2018 por R$ 59.990...",
  "media": [ { "url": "https://.../foto1.jpg", "caption": "Onix 2018 — R$ 59.990", "kind": "image" } ],
  "handoff": false
}
```
- `reply` — texto (opcional). `media[]` — até 5 anexos (`kind`: image/video/document/audio; default image).
- `handoff: true` — o n8n pede atendente humano; o CRM muta o bot.
- Texto + mídias contam **1 slot** do teto por turno. O CRM tolera
  mojibake herdado do n8n (repara acentos/emoji antes de enviar).

**Passos:**
1. No CRM → Configurações → Assistente de IA → **tier avançado**; informe
   o `n8n_webhook_url` e o `n8n_shared_secret` (o mesmo do header). Ligue.
2. No n8n, o workflow do "Cérebro" precisa: **Webhook** (valida o
   `x-crm-secret`) → busca estoque → OpenAI → devolve `{reply, media[]}`.
3. O scraper diário (ex.: n8n Schedule 6h → HTTP → grava estoque) roda à
   parte, alimentando o banco que o Cérebro consulta. **Não muda nada no
   CRM.**

> Dica: comece pelo **tier simples** (base de conhecimento com o estoque
> em texto) e migre pro avançado quando precisar de ferramentas/dados
> vivos. O tier simples dispensa n8n e usa a chave OpenAI direto no CRM.

---

## 5. Referência de variáveis de ambiente

Ver `.env.local.example` (comentado). Resumo:

| Variável | Obrigatória | Para quê |
|----------|:----------:|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | chave pública (cliente) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | chave server-side (webhook, API). **Secreta** |
| `ENCRYPTION_KEY` | ✅ | 64 hex; cripto dos tokens WhatsApp |
| `NEXT_PUBLIC_SITE_URL` | ⭐ | URL pública canônica do deploy |
| `NEXT_PUBLIC_BRAND_NAME/LOGO_URL/THEME` | ⬜ | white-label |
| `META_APP_SECRET` / `META_APP_ID` | ⬜ | só se usar Meta Cloud API |
| `AUTOMATION_CRON_SECRET` | ⬜ | só se usar passos "Wait" em automações |
| `BILLING_WEBHOOK_SECRET` | ⬜ | só se gatear acesso por assinatura |
| `AI_DEBOUNCE_SECONDS` | ⬜ | agrupamento de rajada (default 8) |

> A chave de IA **não** é env: cada conta cola a sua na tela (fica
> criptografada). O `n8n_webhook_url`/`secret` também ficam no banco por
> conta, não no env.

---

## 6. Operação

**Atualizar o código (novo release):**
```bash
cd cliente-x
git pull origin main
# aplique migrations novas, se houver (confira supabase/migrations/)
npm ci && npm run build && pm2 restart crm-cliente-x
# ou: docker compose -f deploy/docker-compose.yml up -d --build
```

**Logs:** `pm2 logs crm-cliente-x` (ou `docker compose logs -f`).

**Backup:** o Supabase faz backup do Postgres; garanta também um backup
seguro da `ENCRYPTION_KEY` e das chaves (fora do repositório).

**E-mails de Auth em pt-BR:** passo manual por projeto — cole os
templates de `plano/onboarding-auth-emails-ptbr.md` em Authentication →
Emails do Supabase e troque `[MARCA]`.

---

## 7. Checklist de go-live

- [ ] Migrations 001→038 aplicadas no Supabase do cliente
- [ ] `.env.local` completo (Supabase, `ENCRYPTION_KEY`, `SITE_URL`, marca)
- [ ] App no ar via HTTPS no domínio do cliente (`/login` → 200)
- [ ] Conta admin criada + equipe convidada
- [ ] uazapi conectado (status connected) e webhook recebendo (teste real)
- [ ] IA configurada (simples ou avançado) e respondendo
- [ ] Envio de mídia recebida indo pro Storage (bucket `chat-media`)
- [ ] Handoff testado (responder pelo celular muta o bot; botão "voltar")
- [ ] Templates de e-mail Auth em pt-BR colados no painel
- [ ] `ENCRYPTION_KEY` e chaves guardadas em local seguro (fora do git)

---

Dúvidas de arquitetura/decisões estão em `plano/` e `deploy/`.
