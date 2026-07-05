/**
 * uazapi webhook payload normalizer.
 *
 * uazapi (Baileys-based) webhook bodies vary between server versions —
 * the envelope may be { EventType, message, ... }, { event, data },
 * or a flat message object. This module extracts what the pipeline
 * needs while surviving shape drift, and REFUSES anything that is not
 * a 1:1 customer message (groups, stories, presence, acks).
 *
 * Production note (plano fase-01 §1.6): before go-live, capture real
 * payloads from YOUR uazapi server (set UAZAPI_WEBHOOK_DEBUG=1) and
 * extend the field lists below if your server uses different names.
 */

export interface UazapiNormalizedEvent {
  kind:
    | 'inbound'        // customer → us: run the full pipeline
    | 'from_me'        // sent from the phone itself: mirror + mute bot
    | 'ignored'        // group / story / non-message event / no data
  instanceName: string | null
  /** Digits-only phone extracted from the chat/sender JID. */
  fromPhone: string
  pushName: string
  waMessageId: string
  timestamp: Date
  /** Raw provider type (conversation, imageMessage, ...) — map with
   *  mapToAllowedContentType before inserting. */
  providerType: string
  text: string | null
  /** Direct media URL when the server includes one; null otherwise. */
  mediaUrl: string | null
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

/** '5511999999999@s.whatsapp.net' | '...@c.us' → '5511999999999' */
export function phoneFromJid(jid: string): string {
  return jid.split('@')[0].split(':')[0]
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us')
}

export function isBroadcastJid(jid: string): boolean {
  return jid === 'status@broadcast' || jid.endsWith('@broadcast')
}

/** Locate the message object inside the various envelope shapes. */
function findMessageNode(body: Dict): Dict | null {
  for (const key of ['message', 'data', 'msg']) {
    const v = body[key]
    if (isDict(v)) {
      // { data: { message: {...} } } one level deeper
      const inner = v.message
      if (isDict(inner) && ('chatid' in inner || 'key' in inner || 'messageid' in inner)) {
        return inner
      }
      return v
    }
  }
  // Flat: the body itself carries chatid/messageid
  if ('chatid' in body || 'messageid' in body || 'key' in body) return body
  return null
}

/** Instance name may be flat or nested; used to resolve the account. */
export function extractInstanceName(body: Dict): string | null {
  const flat = firstString(body, ['instance', 'instanceName', 'instance_name'])
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
  return firstString(body, ['EventType', 'eventType', 'event', 'type']).toLowerCase()
}

export function normalizeUazapiWebhook(raw: unknown): UazapiNormalizedEvent {
  const ignored = (reason: string): UazapiNormalizedEvent => ({
    kind: 'ignored',
    instanceName: isDict(raw) ? extractInstanceName(raw) : null,
    fromPhone: '',
    pushName: '',
    waMessageId: '',
    timestamp: new Date(),
    providerType: '',
    text: null,
    mediaUrl: null,
    ignoredReason: reason,
  })

  if (!isDict(raw)) return ignored('body is not an object')
  const body = raw

  // Non-message events (connection, qrcode, presence, contacts sync…)
  // are ignored outright. An empty event type is allowed through —
  // some servers omit it on plain message posts.
  const eventType = eventTypeOf(body)
  if (
    eventType &&
    !MESSAGE_EVENT_HINTS.some((h) => eventType === h || eventType.startsWith(h))
  ) {
    return ignored(`event type '${eventType}' is not a message`)
  }

  const msg = findMessageNode(body)
  if (!msg) return ignored('no message node found')

  // Baileys raw envelope nests routing info under key{}.
  const key = isDict(msg.key) ? msg.key : {}

  const chatJid =
    firstString(msg, ['chatid', 'chatId', 'remoteJid']) ||
    firstString(key, ['remoteJid'])
  if (!chatJid) return ignored('no chat jid')
  if (isGroupJid(chatJid)) return ignored('group message')
  if (isBroadcastJid(chatJid)) return ignored('broadcast/story')

  const senderJid =
    firstString(msg, ['sender', 'participant', 'from']) || chatJid
  const fromMe =
    msg.fromMe === true || msg.fromme === true || key.fromMe === true

  const waMessageId =
    firstString(msg, ['messageid', 'messageId', 'id']) ||
    firstString(key, ['id'])

  const tsRaw = msg.messageTimestamp ?? msg.timestamp ?? msg.t
  let timestamp = new Date()
  if (typeof tsRaw === 'number' || (typeof tsRaw === 'string' && /^\d+$/.test(tsRaw))) {
    const n = Number(tsRaw)
    // seconds vs milliseconds
    timestamp = new Date(n > 1e12 ? n : n * 1000)
  }

  const providerType =
    firstString(msg, ['type', 'messageType', 'mediaType']) || 'conversation'

  // Text lives in different spots depending on type/version.
  const content = isDict(msg.content) ? msg.content : {}
  const text =
    firstString(msg, ['text', 'body', 'caption', 'conversation']) ||
    firstString(content, ['text', 'caption', 'conversation']) ||
    null

  const mediaUrl =
    firstString(msg, ['fileURL', 'fileUrl', 'mediaUrl', 'url']) ||
    firstString(content, ['url', 'fileURL', 'fileUrl', 'mediaUrl', 'directPath']) ||
    null

  const pushName = firstString(msg, ['senderName', 'pushName', 'notifyName'])

  return {
    kind: fromMe ? 'from_me' : 'inbound',
    instanceName: extractInstanceName(body),
    fromPhone: phoneFromJid(fromMe ? chatJid : senderJid || chatJid),
    pushName,
    waMessageId,
    timestamp,
    providerType,
    text,
    mediaUrl,
  }
}

/**
 * Map a uazapi/Baileys message type onto the CRM's content types.
 * Unknowns fall back to text — pair with a placeholder in contentText.
 */
export function uazapiTypeToContentKind(providerType: string): {
  contentType: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location'
  placeholder: string | null
} {
  const t = providerType.toLowerCase()
  if (t.includes('image')) return { contentType: 'image', placeholder: null }
  if (t.includes('video')) return { contentType: 'video', placeholder: null }
  if (t.includes('audio') || t.includes('ptt'))
    return { contentType: 'audio', placeholder: null }
  if (t.includes('document')) return { contentType: 'document', placeholder: null }
  if (t.includes('location')) return { contentType: 'location', placeholder: '[localização]' }
  if (t.includes('sticker')) return { contentType: 'image', placeholder: '[figurinha]' }
  if (t.includes('contact')) return { contentType: 'text', placeholder: '[contato compartilhado]' }
  if (t.includes('poll')) return { contentType: 'text', placeholder: '[enquete]' }
  return { contentType: 'text', placeholder: null }
}
