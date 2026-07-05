# 04 — Referência do uazapi (endpoints reais)

> Fonte: doc oficial `https://docs.uazapi.com/` (SPA OpenAPI) + node oficial de n8n `n8n-nodes-uazapi` (endpoints e
> campos extraídos do código). **Confirme contra o seu servidor uazapi** — o host varia por contratação.

## Base URL e autenticação

- **Base URL:** o host do seu servidor uazapi, ex. `https://SEU-SERVIDOR.uazapi.com` (o node de exemplo usa
  `https://focus.uazapi.com` como default — **não** assuma esse; use o seu).
- **Autenticação por token** (dois níveis):
  - `admintoken` — token de **administração do servidor**. Cria/lista/gerencia instâncias.
  - `token` — token **da instância** (obtido ao criar a instância). Envia mensagens, consulta status, etc.
- O token pode ser enviado como **header** `token: <instanceToken>` (padrão uazapi) — o node de n8n de exemplo
  também aceita como query param. **Preferir header.** Headers comuns: `Content-Type: application/json`,
  `Accept: application/json`.

## Endpoints de instância (provisionamento / conexão)

| Método | Path | Body | Uso |
|--------|------|------|-----|
| POST | `/instance/init` | `{ name }` (nome curto, minúsculo, sem espaço/acento) | Cria a instância. Auth: `admintoken` |
| POST | `/instance/connect` | `{ phone? }` (opcional) | Inicia conexão; retorna **QR code** (base64/string) para escanear |
| GET | `/instance/status` | — | Estado da conexão (conectado? aguardando QR?) |
| POST | `/instance/disconnect` | — | Desconecta a sessão |
| DELETE | `/instance` | — | Remove a instância |
| GET | `/instance/all` | — | Lista instâncias (auth `admintoken`) |
| POST | `/instance/updateInstanceName` | `{ name }` | Renomeia |

## Endpoints de envio de mensagem (o que substitui o meta-api)

| Método | Path | Body (campos verbatim) | Equivalente wacrm |
|--------|------|------------------------|-------------------|
| POST | `/send/text` | `number`, `text` | `sendTextMessage` |
| POST | `/send/media` | `number`, `type`, `file`, `caption` | `sendMediaMessage` (`type` = image/video/document/audio; `file` = URL ou base64) |
| POST | `/send/contact` | `number`, `fullName`, `phoneNumber` | — |
| POST | `/send/location` | `number`, `name`, `address`, `latitude`, `longitude` | — |
| POST | `/message/react` | `number`, `id`, `text` | `sendReactionMessage` |
| POST | `/message/delete` | (id da msg) | — |
| POST | `/message/edit` | (id, novo texto) | — |
| POST | `/message/download` | (id) | `downloadMedia` (baixar mídia recebida) |
| POST | `/message/markread` | (chat/id) | marcar como lida |

> **`number`** = telefone do destinatário. Confira o formato aceito (com DDI, ex. `5511999999999`, e se aceita/como
> normaliza o `9` extra). O wacrm já tem `phone-utils.ts` com variantes — reutilizar essa lógica ao montar o
> `number`.

### Menus interativos (botões/listas)
O uazapi suporta mensagens interativas, porém o **nome do endpoint/campos difere da Meta**. Confirmar na doc
(`/send/...` interativos ou parâmetros dentro de `/send/media`/`/send/text`). Se não houver equivalente direto,
**degradar botões/listas para texto numerado** no adapter (o tier simples raramente precisa de interativos).

### Resposta dos endpoints de envio
Retornam um objeto com o **id da mensagem** gerada. Mapear esse id para `messages.message_id` (equivalente ao
`wamid` da Meta). **Confirmar o nome do campo** (`id` / `messageid` / `key.id`) capturando uma resposta real.

## Webhook (mensagens recebidas + status) — ⚠️ CONFIRMAR PAYLOAD REAL

O uazapi envia eventos para uma **URL de webhook** configurada na instância. Eventos incluem: **mensagem recebida**,
**mensagem enviada (fromMe)**, **status de conexão**, **QR code**. (Fonte: doc uazapi.)

O formato exato do corpo **não está documentado publicamente de forma estável** (SPA). Por isso, a Fase 01 tem um
passo obrigatório: **capturar um webhook real** e mapear os campos. Estrutura *esperada* (baseada em uazapi v2 /
Baileys — TRATAR COMO HIPÓTESE ATÉ CONFIRMAR):

```jsonc
{
  "EventType": "messages",            // ou "messages_update", "connection", "presence", "qrcode"
  "instance": { "name": "...", "token": "..." },   // identifica a instância → mapeia para account_id
  "message": {
    "id": "…",                        // id interno
    "messageid": "…",                 // id no WhatsApp → messages.message_id
    "chatid": "5511999999999@s.whatsapp.net",  // conversa
    "sender": "5511999999999@s.whatsapp.net",  // remetente
    "senderName": "Fulano",           // push name → nome do contato
    "fromMe": false,                  // true = enviada por nós (espelhar como sender_type='bot'/'agent')
    "type": "conversation",           // conversation/text | imageMessage | audioMessage | ...
    "text": "Olá",                    // texto (quando type texto)
    "content": { /* mídia: url/base64, mimetype, caption */ }
  }
}
```

**Passo de confirmação (Fase 01):**
1. Apontar o webhook da instância para `POST /api/uazapi/webhook`.
2. Numa primeira versão, a rota apenas `console.log(JSON.stringify(body))` e retorna 200.
3. Enviar uma mensagem de teste de um celular para o número conectado.
4. Ler o corpo real e **preencher o mapeamento** (`sender` → telefone, `text` → conteúdo, `messageid` →
   `message_id`, `fromMe` → ignorar/gravar como outbound, `type` → `content_type`).
5. Testar mídia (imagem/áudio) para mapear `content`.

## Como configurar o webhook da instância

Há endpoint(s) de webhook no uazapi (a busca mostrou "Ver Webhook" na coleção Postman v2). Confirmar o path exato
(algo como `POST /instance/updatewebhook` ou config no painel). Campos típicos: **URL**, **eventos habilitados**
(receber mensagens, fromMe, status), e às vezes um **segredo**. Configurar:
- URL = `https://DEPLOY-DO-CLIENTE/api/uazapi/webhook`
- Eventos = mensagens recebidas (+ enviadas/status se quiser espelhar tudo no inbox)
- Segredo = valor guardado no `whatsapp_config` do cliente para validar no CRM.

## Diferenças-chave vs Meta Cloud API (impacto no código)

| Aspecto | Meta Cloud | uazapi | Impacto |
|---------|-----------|--------|---------|
| Conexão | Business API + número verificado | **QR code** | Nova UI de conexão (mostra QR) |
| Templates aprovados | Obrigatórios fora da janela 24h | **Não exige** | Broadcast/HSM livre (respeitar antiban) |
| Auth | `access_token` + `phone_number_id` | `token` de instância + base URL | Novas colunas em `whatsapp_config` |
| Webhook | `entry/changes/value/messages` + HMAC | `EventType/message` + segredo simples | Nova rota + normalização |
| Mídia recebida | `getMediaUrl`+`downloadMedia` (2 passos) | url/base64 no payload ou `/message/download` | Novo caminho de mídia |
| Interativos | buttons/list nativos | confirmar suporte; senão texto numerado | Degradação graciosa |
| Assinatura webhook | HMAC SHA256 | segredo compartilhado | Validação mais simples |

## Fontes

- Doc oficial: https://docs.uazapi.com/ e https://docs.uazapi.com/tag/Enviar%20Mensagem
- Node n8n oficial (endpoints/campos): https://www.npmjs.com/package/n8n-nodes-uazapi
- Coleção Postman uazapi v2: https://www.postman.com/augustofcs/uazapi-v2
