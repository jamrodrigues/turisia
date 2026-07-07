# Templates de e-mail (Supabase Auth) em pt-BR — passo de onboarding

Os e-mails de autenticação do Supabase (confirmação de cadastro, redefinição
de senha, etc.) NÃO são lidos do código do app — vivem no painel do projeto.
Como cada cliente tem **um projeto Supabase próprio**, este é um passo manual
do onboarding, feito **uma vez por projeto**.

## Onde colar

Painel do projeto → **Authentication → Emails** (aba "Templates").
Para cada template abaixo: cole o **Assunto** e o **corpo (Message body / HTML)**.

## Antes de colar — substitua

- `[MARCA]` → nome comercial do cliente (o mesmo de `NEXT_PUBLIC_BRAND_NAME`).
- Confira **Authentication → URL Configuration → Site URL** apontando pro
  domínio do cliente (as variáveis `{{ .ConfirmationURL }}` usam essa base).

Variáveis disponíveis (Supabase): `{{ .ConfirmationURL }}`, `{{ .Token }}`,
`{{ .TokenHash }}`, `{{ .SiteURL }}`, `{{ .Email }}`, `{{ .RedirectTo }}`.

---

## 1. Confirmar cadastro (Confirm signup)

**Assunto:**
```
Confirme seu cadastro na [MARCA]
```

**Corpo:**
```html
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111;line-height:1.6">
  <h2 style="margin:0 0 16px">Bem-vindo(a) à [MARCA] 👋</h2>
  <p>Falta um passo para ativar sua conta. Clique no botão abaixo para confirmar seu e-mail:</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#16a34a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Confirmar e-mail</a>
  </p>
  <p style="color:#666;font-size:14px">Se você não criou esta conta, pode ignorar este e-mail.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">Enviado por [MARCA]</p>
</div>
```

---

## 2. Redefinir senha (Reset password)

**Assunto:**
```
Redefinir sua senha — [MARCA]
```

**Corpo:**
```html
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111;line-height:1.6">
  <h2 style="margin:0 0 16px">Redefinição de senha</h2>
  <p>Recebemos um pedido para redefinir a senha da sua conta na [MARCA]. Clique abaixo para criar uma nova senha:</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#16a34a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Redefinir senha</a>
  </p>
  <p style="color:#666;font-size:14px">Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">Enviado por [MARCA]</p>
</div>
```

---

## 3. Link mágico (Magic Link)

**Assunto:**
```
Seu link de acesso à [MARCA]
```

**Corpo:**
```html
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111;line-height:1.6">
  <h2 style="margin:0 0 16px">Entrar na [MARCA]</h2>
  <p>Use o botão abaixo para acessar sua conta. O link é válido por tempo limitado.</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#16a34a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Acessar minha conta</a>
  </p>
  <p style="color:#666;font-size:14px">Se você não pediu este acesso, pode ignorar este e-mail.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">Enviado por [MARCA]</p>
</div>
```

---

## 4. Alterar e-mail (Change Email Address)

**Assunto:**
```
Confirme seu novo e-mail — [MARCA]
```

**Corpo:**
```html
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111;line-height:1.6">
  <h2 style="margin:0 0 16px">Confirmação de novo e-mail</h2>
  <p>Você pediu para alterar o e-mail da sua conta na [MARCA] para <strong>{{ .Email }}</strong>. Confirme clicando abaixo:</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#16a34a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Confirmar novo e-mail</a>
  </p>
  <p style="color:#666;font-size:14px">Se você não fez este pedido, ignore este e-mail.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">Enviado por [MARCA]</p>
</div>
```

---

## 5. Reautenticação (Reauthentication) — código OTP

**Assunto:**
```
Seu código de verificação — [MARCA]
```

**Corpo:**
```html
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111;line-height:1.6">
  <h2 style="margin:0 0 16px">Código de verificação</h2>
  <p>Use o código abaixo para confirmar esta ação na [MARCA]:</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:24px 0">{{ .Token }}</p>
  <p style="color:#666;font-size:14px">O código expira em alguns minutos. Se você não solicitou, ignore este e-mail.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">Enviado por [MARCA]</p>
</div>
```

---

## Observações

- **Convite de equipe** (compartilhamento de conta) NÃO usa e-mail do Supabase:
  o app tem fluxo próprio em `/join/[token]` (migrations 018/019). Não há
  template do Supabase para traduzir aqui.
- Os fluxos que o app realmente dispara hoje são **cadastro** (`/signup`) e
  **redefinição de senha** (`/forgot-password`). Os demais templates ficam
  traduzidos por precaução, caso sejam ativados depois.
- A cor `#16a34a` (verde) é um padrão neutro; ajuste para a cor da marca do
  cliente se quiser casar com `NEXT_PUBLIC_BRAND_THEME`.
