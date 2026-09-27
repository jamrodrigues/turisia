/**
 * uazapi webhook payload normalizer.
 *
 * CALIBRATED AGAINST REAL PAYLOADS (uazapiGO v2, cloudefender server,
 * 2026-07-05 — see plano/04-referencia-uazapi.md):
 *
 *   {
 *     BaseUrl: "https://…", EventType: "messages",
 *     instanceName: "crmia-teste",            // flat
 *     chat: { … CRM-ish lead fields … },
 *     message: {
 *       type: "text" | "media" | "reaction",  // top-level discriminator
 *       messageType: "Conversation" | "ExtendedTextMessage" |
 *                    "ImageMessage" | "AudioMessage" | "VideoMessage" |
 *                    "StickerMessage" | "ReactionMessage",
 *       mediaType: "image" | "ptt" | "gif" | "sticker" |
 *                  "user_created_sticker" | "url" | "",
 *       chatid: "5581…@s.whatsapp.net" | "…@g.us",
 *       sender: "139711…@lid",   // WhatsApp LID — NOT a phone number!
 *       senderName: "…", fromMe: false, isGroup: false,
 *       messageid: "AC…", messageTimestamp: 1783293782000,  // ms
 *       text: "…",
 *       content: { URL (encrypted .enc!), mimetype, caption, mediaKey… }
 *     }
 *   }
 *
 * Hard-won rules:
 *   * `sender` is a @lid id since WhatsApp's LID rollout — the real
 *     phone for a 1:1 chat lives in `chatid`. NEVER derive the phone
 *     from `sender`.
 *   * `content.URL` points at WhatsApp's CDN **encrypted** (.enc) —
 *     useless directly. Media must go through POST /message/download
 *     { id } → { fileURL, mimetype } (server decrypts + hosts).
 *   * The server delivers group traffic even with events:["messages"]
 *     — filtering is OUR job (chatid @g.us + isGroup flag).
 */

export interface UazapiNormalizedEvent {
  kind:
    | 'inbound'        // customer → us: run the full pipeline
    | 'from_me'        // sent from the phone itself: mirror + mute bot
    | 'ignored'        // group / story / reaction / non-message event
  instanceName: string | null
  /** Digits-only phone extracted from the CHAT jid (see LID note). */
  fromPhone: string
  pushName: string
  waMessageId: string
  timestamp: Date
  /** CRM content type, already CHECK-constraint safe. */
  contentType: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location'
  text: string | null
  /** True when the message carries media that must be fetched via
   *  POST /message/download {id: waMessageId}. */
  hasMedia: boolean
  /** ID of the tapped button / list row (`buttonOrListid` on the wire).
   *  Empty on plain text. Lets flows match native menu taps by reply_id
   *  instead of guessing from the (often empty) text field. */
  interactiveReplyId: string | null
  /** Why kind === 'ignored' (for debug logs). */
  ignoredReason?: string
}

type Dict = Record<string, unknown>

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function firstString(obj: Dict, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v) return v
  }
  return ''
}

/** '5511999999999@s.whatsapp.net' | '…@c.us' → '5511999999999' */
export function phoneFromJid(jid: string): string {
  return jid.split('@')[0].split(':')[0]
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us')
}

export function isBroadcastJid(jid: string): boolean {
  return jid === 'status@broadcast' || jid.endsWith('@broadcast')
}

/** Instance name: flat `instanceName` (confirmed) with fallbacks. */
export function extractInstanceName(body: Dict): string | null {
  const flat = firstString(body, ['instanceName', 'instance_name', 'instance'])
  if (flat) return flat
  const inst = body.instance ?? body.Instance
  if (isDict(inst)) {
    const name = firstString(inst, ['name', 'instanceName', 'instance_name', 'id'])
    if (name) return name
  }
  return null
}

const MESSAGE_EVENT_HINTS = ['message', 'messages', 'messages.upsert']

function eventTypeOf(body: Dict): string {
  return firstString(body, ['EventType', 'eventType', 'event']).toLowerCase()
}

/**
 * Resolve the CRM content type + placeholder text from the real
 * discriminators. `type` decides the family; `mediaType` (then
 * `messageType`) decides the media kind.
 */
export function resolveContentKind(msg: {
  type: string
  mediaType: string
  messageType: string
}): {
  contentType: UazapiNormalizedEvent['contentType']
  placeholder: string | null
  hasMedia: boolean
} {
  if (msg.type !== 'media') {
    return { contentType: 'text', placeholder: null, hasMedia: false }
  }
  const t = (msg.mediaType || msg.messageType).toLowerCase()
  if (t.includes('ptt') || t.includes('audio'))
    return { contentType: 'audio', placeholder: null, hasMedia: true }
  if (t.includes('gif') || t.includes('video'))
    return { contentType: 'video', placeholder: null, hasMedia: true }
  if (t.includes('sticker'))
    return { contentType: 'image', placeholder: '[figurinha]', hasMedia: true }
  if (t.includes('image'))
    return { contentType: 'image', placeholder: null, hasMedia: true }
  if (t.includes('document'))
    return { contentType: 'document', placeholder: null, hasMedia: true }
  if (t.includes('location'))
    return { contentType: 'location', placeholder: '[localização]', hasMedia: false }
  if (t.includes('contact'))
    return { contentType: 'text', placeholder: '[contato compartilhado]', hasMedia: false }
  // 'url' = link preview: the link itself is in `text`. Unknowns → text.
  return { contentType: 'text', placeholder: null, hasMedia: false }
}

export function normalizeUazapiWebhook(raw: unknown): UazapiNormalizedEvent {
  const ignored = (reason: string): UazapiNormalizedEvent => ({
    kind: 'ignored',
    instanceName: isDict(raw) ? extractInstanceName(raw) : null,
    fromPhone: '',
    pushName: '',
    waMessageId: '',
    timestamp: new Date(),
    contentType: 'text',
    text: null,
    hasMedia: false,
    interactiveReplyId: null,
    ignoredReason: reason,
  })

  if (!isDict(raw)) return ignored('body is not an object')
  const body = raw

  const eventType = eventTypeOf(body)
  if (
    eventType &&
    !MESSAGE_EVENT_HINTS.some((h) => eventType === h || eventType.startsWith(h))
  ) {
    return ignored(`event type '${eventType}' is not a message`)
  }

  const msg = isDict(body.message) ? body.message : null
  if (!msg) return ignored('no message node found')

  const chatJid = firstString(msg, ['chatid', 'chatId', 'remoteJid'])
  if (!chatJid) return ignored('no chat jid')
  if (msg.isGroup === true || isGroupJid(chatJid)) return ignored('group message')
  if (isBroadcastJid(chatJid)) return ignored('broadcast/story')

  const topType = firstString(msg, ['type']).toLowerCase()
  // Reactions aren't messages — inserting them would spam the inbox
  // with bare emoji rows. (Meta handles reactions via a dedicated
  // table; a uazapi equivalent is a later refinement.)
  if (topType === 'reaction') return ignored('reaction')

  const fromMe = msg.fromMe === true || msg.fromme === true

  const waMessageId = firstString(msg, ['messageid', 'messageId', 'id'])

  const tsRaw = msg.messageTimestamp ?? msg.timestamp ?? msg.t
  let timestamp = new Date()
  if (typeof tsRaw === 'number' || (typeof tsRaw === 'string' && /^\d+$/.test(String(tsRaw)))) {
    const n = Number(tsRaw)
    timestamp = new Date(n > 1e12 ? n : n * 1000) // ms vs s
  }

  const kindInfo = resolveContentKind({
    type: topType || 'text',
    mediaType: firstString(msg, ['mediaType']),
    messageType: firstString(msg, ['messageType']),
  })

  const content = isDict(msg.content) ? msg.content : {}
  const text =
    firstString(msg, ['text', 'body', 'caption']) ||
    firstString(content, ['text', 'caption']) ||
    kindInfo.placeholder ||
    null

  const pushName = firstString(msg, ['senderName', 'pushName', 'notifyName'])

  return {
    kind: fromMe ? 'from_me' : 'inbound',
    instanceName: extractInstanceName(body),
    // LID rule: the phone is ALWAYS the 1:1 chat jid, never `sender`.
    fromPhone: phoneFromJid(chatJid),
    pushName,
    waMessageId,
    timestamp,
    contentType: kindInfo.contentType,
    text,
    hasMedia: kindInfo.hasMedia,
    interactiveReplyId: firstString(msg, ['buttonOrListid']) || null,
  }
}
