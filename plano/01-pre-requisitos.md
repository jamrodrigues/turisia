# 01 — Pré-requisitos

## Contas e serviços

| Serviço | Para quê | Observação |
|---------|----------|------------|
| **GitHub** | Hospedar o fork/repo-template | Repo privado (é produto comercial) |
| **Supabase** (online) | Banco por cliente | Plano pago recomendado quando passar do free tier; **1 projeto por cliente** |
| **uazapi** (uazapi.dev / servidor uazapi) | WhatsApp por QR | Cada cliente = 1 instância com `token` próprio. Precisa de um servidor uazapi (SaaS ou self-host) e do `admintoken` do servidor para criar instâncias |
| **Provedor de deploy** | Rodar o Next.js | Vercel, Railway, ou VPS (Docker). 1 deploy por cliente |
| **n8n** (só tier avançado) | Cérebro de IA com tools | Já existe hoje; 1 workflow por cliente avançado |
| **Provedor de LLM** | IA embutida e/ou n8n | Anthropic (Claude) ou OpenAI — chave por conta |

## Ferramentas locais (para desenvolver)

- **Node.js >= 20** (o wacrm exige `>=20.0.0`; `package.json`).
- **Git**.
- **Supabase CLI** (para rodar migrations: `supabase db push` / aplicar SQL) — opcional; dá para colar SQL no
  editor SQL do painel Supabase.
- Editor + o repositório wacrm clonado.

## Variáveis de ambiente (por deploy/cliente)

O wacrm traz um `.env.local.example` (5.7 KB) na raiz. As chaves centrais existentes:

```bash
# Supabase (do projeto do cliente)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...          # usado por supabaseAdmin() nos webhooks/engines

# Segredo de criptografia (tokens são guardados criptografados no banco)
# ver src/lib/whatsapp/encryption.ts
ENCRYPTION_KEY=...                       # confirmar nome exato no .env.local.example

# IA embutida (opcional por conta; também dá pra configurar via UI)
ANTHROPIC_API_KEY=...  # ou OPENAI_API_KEY
```

**Novas variáveis que este plano adiciona** (detalhadas na Fase 01/02):

```bash
# uazapi — nível servidor (para o kit de provisionamento criar instâncias)
UAZAPI_BASE_URL=https://SEU-SERVIDOR.uazapi.com
UAZAPI_ADMIN_TOKEN=...                    # admintoken do servidor uazapi

# Por conta (também podem ficar no banco, tabela whatsapp_config — ver Fase 01):
#   uazapi_instance_token, uazapi_base_url

# n8n (tier avançado, por conta — melhor no banco que em env):
#   n8n_webhook_url, n8n_shared_secret
```

> **Regra de segurança:** tokens de instância uazapi, chaves de LLM e segredos de n8n **nunca** ficam expostos ao
> cliente. Guardar **criptografados** no banco (reaproveitar `encrypt()`/`decrypt()` de
> `src/lib/whatsapp/encryption.ts`) ou em env do deploy — nunca em `NEXT_PUBLIC_*`.

## O que confirmar antes de codar

1. Nome exato da env de criptografia e do algoritmo em `src/lib/whatsapp/encryption.ts`.
2. Nome/host do servidor uazapi contratado (ex.: `focus.uazapi.com` é só o default do node de exemplo).
3. Se o servidor uazapi expõe `admintoken` para criar instâncias via API (necessário para o kit de provisionamento
   automatizado da Fase 04). Se não, a criação de instância é manual no painel uazapi.
