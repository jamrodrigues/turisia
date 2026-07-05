# Fase 01 — Adapter uazapi (enviar + receber)

**Objetivo:** o CRM envia e recebe WhatsApp pela **uazapi**, mantendo o provider Meta intacto. Um número real,
conectado por QR, troca mensagens ponta a ponta pelo inbox.

**Depende de:** Fase 00. **Entrega:** conta com `provider='uazapi'` recebendo e respondendo no inbox.

**Pontos de troca** (ver `03-referencia-wacrm.md` §"Pontos EXATOS de troca"): `meta-api.ts` (cliente HTTP),
`flows/meta-send.ts` + `automations/meta-send.ts` (camada de envio), `whatsapp/webhook/route.ts` (entrada),
`whatsapp-config.tsx`/`config/route.ts` (UI).

---

## 1.1 — Migration do provider

Aplicar `031_whatsapp_provider_uazapi.sql` (ver `05-schema-supabase.md`): colunas `provider`, `uazapi_base_url`,
`uazapi_instance_name`, `uazapi_instance_token`, `uazapi_webhook_secret` + índice.

## 1.2 — Cliente HTTP uazapi (espelho do meta-api)

Criar `src/lib/whatsapp/uazapi-api.ts` com as **mesmas assinaturas** que a camada de envio já consome, mas falando
com o uazapi. Endpoints e campos: ver `04-referencia-uazapi.md`.

```ts
// src/lib/whatsapp/uazapi-api.ts   (esboço — revisar tipos/erros contra meta-api.ts)
interface UazapiCtx { baseUrl: string; token: string }

async function uazapiFetch(ctx: UazapiCtx, path: string, body: unknown) {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      token: ctx.token,            // auth de instância (confirmar header vs query no seu servidor)
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`uazapi ${path} ${res.status}: ${text}`)
  }
  return res.json()
}

export async function uazapiSendText(
  ctx: UazapiCtx, args: { to: string; text: string },
): Promise<{ messageId: string }> {
  const r = await uazapiFetch(ctx, '/send/text', { number: args.to, text: args.text })
  return { messageId: extractMessageId(r) }   // confirmar campo do id na resposta real
}

export async function uazapiSendMedia(
  ctx: UazapiCtx,
  args: { to: string; kind: 'image'|'video'|'document'|'audio'; link: string; caption?: string; filename?: string },
): Promise<{ messageId: string }> {
  const r = await uazapiFetch(ctx, '/send/media', {
    number: args.to, type: args.kind, file: args.link, caption: args.caption,
  })
  return { messageId: extractMessageId(r) }
}

// Interativos: se o servidor uazapi não expor botões/listas equivalentes, degradar para
// texto numerado aqui (montar o corpo com as opções em linhas). Manter a assinatura.
```

- **Espelhar testes**: criar `uazapi-api.test.ts` como o `meta-api.test.ts` (mock de fetch, asserts de body/headers).
- `extractMessageId` — implementar após capturar uma resposta real (§1.6).

## 1.3 — Dispatcher por provider na camada de envio

Editar `src/lib/flows/meta-send.ts` (e replicar em `src/lib/automations/meta-send.ts`): antes de chamar o
`meta-api`, checar `whatsapp_config.provider` e rotear. **A persistência em `messages`/`conversations` NÃO muda** —
só a chamada de rede.

```ts
// dentro de engineSendText (flows/meta-send.ts), no lugar do attempt() atual:
const provider = config.provider ?? 'meta'
const attempt = async (phone: string): Promise<string> => {
  if (provider === 'uazapi') {
    const r = await uazapiSendText(
      { baseUrl: config.uazapi_base_url, token: decrypt(config.uazapi_instance_token) },
      { to: phone, text: args.text },
    )
    return r.messageId
  }
  // caminho Meta atual:
  const r = await sendTextMessage({ phoneNumberId: config.phone_number_id, accessToken, to: phone, text: args.text })
  return r.messageId
}
```

- Fazer o mesmo em `engineSendMedia` e nos interativos (`sendInteractiveViaMeta`) — no uazapi, cair para
  `uazapiSendMedia` / texto numerado.
- **Não** reintroduzir `decrypt(access_token)` quando provider é uazapi (esse campo pode estar vazio). Guardar o
  decrypt do token certo por provider.
- **Alternativa mais limpa (recomendada):** extrair um módulo `src/lib/whatsapp/sender.ts` com
  `sendTextViaProvider(config, to, text)` que encapsula o switch, e ambos os `meta-send.ts` chamam ele. Reduz
  duplicação entre flows e automations.

## 1.4 — Normalizador + rota de webhook uazapi

1. **Extrair a lógica de inbound compartilhada.** Mover `processMessage` (hoje dentro de
   `src/app/api/whatsapp/webhook/route.ts`) para `src/lib/whatsapp/process-inbound.ts`, recebendo já normalizado:
   ```ts
   processInboundMessage({
     accountId, configOwnerUserId,
     from,           // telefone E.164 do cliente
     pushName,       // nome do contato (senderName)
     waMessageId,    // id no WhatsApp → messages.message_id
     contentType,    // 'text'|'image'|'audio'|...
     text,           // quando texto
     media,          // {url|base64, mimetype, caption, filename} quando mídia
   })
   ```
   Dentro dele: resolver contato/conversa (reusar `resolve-conversation.ts`), gravar `messages`
   (`sender_type='customer'`), e no `after()` disparar **os mesmos** consumidores: automations → flows → IA →
   webhooks de saída (ver `03-referencia-wacrm.md`). O webhook Meta atual passa a chamar `processInboundMessage`
   também (refactor sem mudança de comportamento — rodar os testes).

2. **Criar a rota** `src/app/api/uazapi/webhook/route.ts`:
   ```ts
   export async function POST(request: Request) {
     const raw = await request.text()
     // 1) validar segredo (query ?secret= ou header) contra whatsapp_config.uazapi_webhook_secret
     // 2) parse
     const body = JSON.parse(raw)
     // 3) (PRIMEIRA VERSÃO) console.log('[uazapi webhook]', raw); return 200  ← ver §1.6
     // 4) (DEPOIS) normalizar e chamar processInboundMessage(...)
     return new Response('ok', { status: 200 })
   }
   ```
   - **Resolver a conta**: buscar `whatsapp_config` por `uazapi_instance_name` (vindo do payload `instance.name`)
     ou pelo `phone_number_id` sintético.
   - **Ignorar `fromMe`** (mensagens enviadas por nós) na primeira versão — ou gravá-las como outbound para
     espelhar tudo no inbox (decisão de produto; recomendação: gravar para o histórico ficar completo).
   - **Sempre responder 200 rápido** e processar no `after()` (mesmo padrão do webhook Meta — não segurar o uazapi).

## 1.5 — UI de configuração (modo uazapi + QR)

- Em `src/components/settings/whatsapp-config.tsx` + `src/app/api/whatsapp/config/route.ts`: adicionar modo
  `provider='uazapi'` com campos base URL + token da instância e um botão **Conectar (QR)** que chama
  `/instance/connect` e mostra o QR retornado. Status via `/instance/status`.
- Guardar o token com `encrypt()`. No produto (Fase 03) essa tela é **só do admin**.
- Para o MVP da Fase 01, pode-se configurar a instância manualmente no painel uazapi e só colar o token aqui.

## 1.6 — CONFIRMAR o payload real do webhook (passo obrigatório)

1. Subir o deploy (ou usar túnel, ex. `ngrok`/`cloudflared`, apontando para `localhost:3000`).
2. Configurar o webhook da instância uazapi para `.../api/uazapi/webhook` (ver `04-referencia-uazapi.md`
   §"Como configurar o webhook").
3. Deixar a rota só logando o corpo cru.
4. Enviar do celular: um **texto**, uma **imagem**, um **áudio**.
5. Ler os corpos reais e preencher o mapeamento em `process-inbound` (`sender`→telefone, `messageid`→`message_id`,
   `type`→`content_type`, `content`→mídia). Ajustar `extractMessageId` da resposta de envio também.

## 1.7 — Casos obrigatórios que o adapter DEVE tratar (produção real)

1. **Grupos — IGNORAR.** O uazapi entrega mensagens de grupo (`chatid` termina em `@g.us`). O CRM é 1:1: a rota
   de webhook deve **descartar** qualquer evento de grupo antes de processar (checar `@g.us` / flag de grupo no
   payload). Sem isso o bot responde dentro de grupos — inaceitável. Também ignorar `status@broadcast` (stories).
2. **Tipos fora do CHECK constraint.** `messages.content_type` aceita só
   `text|image|document|audio|video|location|template|interactive`. O uazapi entrega também `sticker`, `contact`,
   `poll`, etc. Estratégia: mapear tipos conhecidos; desconhecidos → gravar como `text` com
   `content_text='[sticker]'`/`'[tipo não suportado]'` (nunca deixar o INSERT falhar por constraint).
3. **Mídia recebida → Supabase Storage.** O uazapi entrega mídia como URL (do servidor dele) ou base64. Não
   confiar na URL externa para sempre: baixar e subir para o bucket de chat do wacrm (migration
   `023_chat_media.sql` já criou a infra; ver como o webhook Meta faz com `downloadMedia`) e gravar `media_url`
   apontando pro Storage.
4. **Status delivered/read.** O uazapi emite eventos de update de mensagem (`messages_update`/ack). Mapear ack →
   `handleStatusUpdate` existente (`sent→delivered→read`), casando por `messages.message_id`. Se os acks do seu
   servidor forem instáveis, aceitar degradar (mensagens ficam em `sent`) — funcional, só perde o "lido".
5. **Janela 24h — REMOVER para uazapi.** A Meta impõe janela de 24h (fora dela, só template). O wacrm pode ter
   guardas dessa janela no envio manual/broadcast (`send-message.ts`, `broadcast-core.ts`). Com
   `provider='uazapi'` **não existe janela**: pular essas guardas quando o provider for uazapi.
6. **Broadcasts.** `broadcast-core.ts` é 100% template-Meta. Para uazapi: enviar **texto livre** com substituição
   de variáveis (a lógica de variáveis por destinatário já existe) via `/send/text`, com **rate-limit/intervalo
   aleatório entre envios** (antiban — ver Fase 06.5). Pode ficar num passo 1.9 separado se atrasar o E2E; o core
   (inbox) não depende de broadcast.
7. **`fromMe` (dono responde pelo celular).** Se um humano do cliente responder direto pelo WhatsApp do aparelho,
   chega evento `fromMe:true`. Política do produto: gravar como outbound (`sender_type='agent'`, sem `sender_id`)
   **e** setar `ai_autoreply_disabled=true` na conversa (humano assumiu por fora — o bot deve calar). Registrar
   `handoff_reason='manual_phone'`. Sem isso, bot e dono falam por cima um do outro.
8. **Dedup de webhook.** O uazapi pode reentregar eventos. Antes de inserir, checar se `messages.message_id` já
   existe na conversa (índice/unique parcial ajuda). Nunca duplicar inbound.

## 1.8 — Teste ponta a ponta

- Conta de teste com `provider='uazapi'`, IA desligada (`ai_tier='off'`).
- Cliente manda "oi" → aparece no inbox como `customer`.
- Atendente responde no inbox → `engineSendText` → uazapi → chega no WhatsApp → grava `sender_type='agent'`.
- Enviar/receber imagem. Verificar `messages.message_id` preenchido dos dois lados.

## DoD

- [ ] `031` aplicada. `uazapi-api.ts` + testes verdes.
- [ ] Dispatcher por provider em flows/automations; Meta continua funcionando (testes 100%).
- [ ] `processInboundMessage` extraído; webhook Meta refatorado sem regressão.
- [ ] Rota `/api/uazapi/webhook` recebendo, autenticando o segredo, normalizando.
- [ ] Payload real do uazapi capturado e mapeado (texto + mídia).
- [ ] Grupos/`status@broadcast` ignorados; tipos desconhecidos degradam sem quebrar INSERT.
- [ ] Mídia recebida salva no Supabase Storage; dedup por `message_id`.
- [ ] `fromMe:true` grava outbound + cala o bot (`handoff_reason='manual_phone'`).
- [ ] Guardas de janela 24h puladas quando `provider='uazapi'`.
- [ ] Conversa bidirecional real funcionando pelo inbox, sem IA ainda.
