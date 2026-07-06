# Domínios, white-label e cobrança (Fase 06)

Modelo: **1 deploy por cliente**. Marca e domínio são por deploy; cobrança é por conta no banco.

## 1. Domínio próprio por cliente

Cada cliente aponta o domínio dele para o container do deploy dele. Use um reverse proxy (Caddy/Traefik/nginx)
para TLS + roteamento.

Exemplo Caddy (`Caddyfile`):
```
crm.clinicaneuza.com.br {
    reverse_proxy localhost:3001      # HOST_PORT do compose desse cliente
}
clube.exemplo.com.br {
    reverse_proxy localhost:3002
}
```
- DNS do cliente: registro A/CNAME → IP do servidor.
- `NEXT_PUBLIC_SITE_URL` no `.env.<slug>` = o domínio (usado no webhook do uazapi e nos links).

## 2. White-label (marca)

Por env do deploy (renderiza inclusive na tela de login, antes de autenticar):
```
NEXT_PUBLIC_BRAND_NAME=Clínica da Neuza
NEXT_PUBLIC_BRAND_LOGO_URL=https://.../logo.png   # opcional
NEXT_PUBLIC_BRAND_THEME=emerald                    # opcional; tema de acento
```
Aplica em: título da aba, logo/nome na sidebar, tema padrão (o usuário ainda pode trocar). Sem env → cai no
padrão neutro "CRM WhatsApp" / tema violet. Código: `src/lib/brand.ts`.

Temas disponíveis: ver `src/lib/themes.ts` (violet, emerald, rose, ...). Para uma cor totalmente custom da marca,
adicionar um bloco `html[data-theme="<marca>"]` em `globals.css` (seguindo o violet) e usar esse id no env.

## 3. Cobrança (mensal/anual)

Estado por conta em `accounts`: `plan` (trial|monthly|annual), `subscription_status`
(trialing|active|past_due|suspended|canceled), `trial_ends_at`, `current_period_end`.

**Trava de acesso:** `subscription_status` em `suspended`/`canceled`, ou trial vencido, bloqueia o app inteiro
(tela "Conta suspensa"). `past_due` = período de graça (ainda entra). RPC `account_billing_status()` +
`src/components/billing/account-blocked.tsx`.

### 3a. Controle manual (agora)
```bash
node scripts/set-account-status.mjs \
  --supabase-url $URL --service-key $KEY \
  --account-id <uuid> --status active --plan monthly \
  --period-end 2026-08-05T00:00:00Z
```

### 3b. Automático — webhook de cobrança (provider-agnóstico)
`POST /api/billing/webhook` (header `x-billing-secret: $BILLING_WEBHOOK_SECRET`):
```json
{ "account_id": "uuid", "status": "active", "plan": "monthly",
  "current_period_end": "2026-08-05T00:00:00Z" }
```
Atualiza a conta. Funciona com **qualquer** processador — basta mapear os eventos dele para esse corpo.

### 3c. Ligando o Stripe (quando quiser)
1. Criar 2 preços no Stripe (mensal, anual) + Checkout/Payment Link por cliente.
2. Um pequeno tradutor (Stripe webhook → nosso webhook): numa Edge Function/n8n, ao receber
   `customer.subscription.created/updated/deleted` ou `invoice.payment_failed`, mapear:
   - `active`/`trialing` → status igual; `past_due` → `past_due`; `canceled` → `canceled`;
     falha de pagamento persistente → `suspended`.
   - incluir `account_id` (guardar o account_id no `metadata` da subscription do Stripe no checkout).
   - POST para `/api/billing/webhook` com o `x-billing-secret`.
> Mantido desacoplado de propósito (sem SDK do Stripe no app) — troca de processador não mexe no CRM, e atende
> "vários públicos"/mercados (ex.: Mercado Pago) com o mesmo contrato.

## 4. Trial padrão
Novas contas nascem `plan=trial`, `subscription_status=trialing`. Para dar X dias de teste, o provisionamento/
onboarding seta `trial_ends_at = agora + X dias` (ou via `set-account-status.mjs --status trialing --trial-end ...`).
