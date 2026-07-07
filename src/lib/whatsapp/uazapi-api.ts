/**
 * uazapi (unofficial WhatsApp API) helpers.
 *
 * Mirrors the shape of meta-api.ts on purpose: every function takes a
 * single options object (named parameters) and resolves to
 * `{ messageId }`, so the provider dispatcher can swap Meta ↔ uazapi
 * without touching callers or DB persistence.
 *
 * Auth model (differs from Meta):
 *   * `token` header  — instance token (per connected WhatsApp number).
 *   * `admintoken`    — server-level token; ONLY used by provisioning
 *     (instance create/list), never by message sending.
 *
 * Endpoints (confirmed against docs.uazapi.com + the official n8n node):
 *   POST /send/text      { number, text }
 *   POST /send/media     { number, type, file, caption }
 *   POST /message/react  { number, id, text }
 *   POST /instance/connect | GET /instance/status | POST /instance/init
 *
 * The exact response envelope varies between uazapi server versions, so
 * `extractMessageId` scans the known field shapes defensively instead of
 * assuming one. See plano/04-referencia-uazapi.md.
 */

export interface UazapiContext {
  /** Base URL of the uazapi server, no trailing slash, e.g. https://xxx.uazapi.com */
  baseUrl: string
  /** Instance token (decrypted). */
  token: string
}

export interface UazapiSendResult {
  messageId: string
}

interface UazapiErrorResponse {
  error?: string | { message?: string }
  message?: string
}

/** Strip a trailing slash so `${baseUrl}${path}` never doubles up. */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

async function throwUazapiError(
  response: Response,
  fallback: string,
): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as UazapiErrorResponse
    if (typeof data.error === 'string' && data.error) message = data.error
    else if (typeof data.error === 'object' && data.error?.message)
      message = data.error.message
    else if (data.message) message = data.message
  } catch {
    // body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

async function uazapiPost(
  ctx: UazapiContext,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${normalizeBaseUrl(ctx.baseUrl)}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      token: ctx.token,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwUazapiError(response, `uazapi error ${response.status} on ${path}`)
  }
  return (await response.json()) as Record<string, unknown>
}

/**
 * Pull the WhatsApp message id out of a uazapi send response.
 *
 * Known shapes across server versions:
 *   { messageid: "..." }              (v2 flat)
 *   { id: "..." }                     (flat)
 *   { key: { id: "..." } }            (raw Baileys envelope)
 *   { message: { messageid | id } }   (nested)
 *   { response: { ... same ... } }    (wrapped)
 *
 * Returns '' when nothing matches — callers persist the row anyway
 * (message_id is nullable); status tracking just won't match acks.
 */
export function extractMessageId(data: unknown): string {
  const seen = new Set<unknown>()
  const walk = (node: unknown, depth: number): string => {
    if (!node || typeof node !== 'object' || depth > 3 || seen.has(node)) return ''
    seen.add(node)
    const obj = node as Record<string, unknown>
    for (const field of ['messageid', 'messageId', 'id']) {
      const v = obj[field]
      if (typeof v === 'string' && v) return v
    }
    for (const nested of ['key', 'message', 'response', 'data']) {
      const found = walk(obj[nested], depth + 1)
      if (found) return found
    }
    return ''
  }
  return walk(data, 0)
}

// ============================================================
// Message sending
// ============================================================

export interface UazapiSendTextArgs {
  ctx: UazapiContext
  /** Recipient phone, digits with country code (e.g. 5511999999999). */
  to: string
  text: string
}

export async function uazapiSendText(
  args: UazapiSendTextArgs,
): Promise<UazapiSendResult> {
  const { ctx, to, text } = args
  if (!text) throw new Error('uazapiSendText requires text.')
  const data = await uazapiPost(ctx, '/send/text', { number: to, text })
  return { messageId: extractMessageId(data) }
}

/** Same kinds meta-api.ts exports as MediaKind — keep them assignable. */
export type UazapiMediaKind = 'image' | 'video' | 'document' | 'audio'

export interface UazapiSendMediaArgs {
  ctx: UazapiContext
  to: string
  kind: UazapiMediaKind
  /** Public URL (or data the server accepts, e.g. base64) for the file. */
  file: string
  caption?: string
  /** Document-only on WhatsApp; harmless elsewhere. */
  filename?: string
}

export async function uazapiSendMedia(
  args: UazapiSendMediaArgs,
): Promise<UazapiSendResult> {
  const { ctx, to, kind, file, caption, filename } = args
  if (!file) throw new Error('uazapiSendMedia requires a file.')
  const body: Record<string, unknown> = { number: to, type: kind, file }
  // Audio is a voice note on WhatsApp — no caption support (mirrors the
  // Meta constraint so behavior is identical across providers).
  if (caption && kind !== 'audio') body.caption = caption
  if (filename && kind === 'document') body.docName = filename
  const data = await uazapiPost(ctx, '/send/media', body)
  return { messageId: extractMessageId(data) }
}

export interface UazapiSendPresenceArgs {
  ctx: UazapiContext
  /** Recipient phone/jid, same shape as a send. */
  to: string
  /** 'composing' shows "digitando…"; 'recording' shows "gravando áudio…". */
  presence?: 'composing' | 'recording' | 'paused'
  /** How long the server keeps the presence up, ms. */
  delayMs?: number
}

/**
 * Show a typing / recording presence indicator in the chat.
 *
 *   POST /message/presence { number, presence, delay }
 *
 * Best-effort by design: presence is cosmetic anti-ban signalling, so a
 * failure here must NEVER break the actual send that follows — every
 * error is swallowed to a console.warn.
 */
export async function uazapiSendPresence(
  args: UazapiSendPresenceArgs,
): Promise<void> {
  const { ctx, to, presence = 'composing', delayMs = 2000 } = args
  try {
    await uazapiPost(ctx, '/message/presence', {
      number: to,
      presence,
      delay: delayMs,
    })
  } catch (err) {
    console.warn(
      '[uazapi] presence failed (non-fatal):',
      err instanceof Error ? err.message : err,
    )
  }
}

export interface UazapiSendReactionArgs {
  ctx: UazapiContext
  to: string
  /** WhatsApp id of the message being reacted to. */
  targetMessageId: string
  /** The emoji; empty string removes the reaction. */
  emoji: string
}

export async function uazapiSendReaction(
  args: UazapiSendReactionArgs,
): Promise<UazapiSendResult> {
  const { ctx, to, targetMessageId, emoji } = args
  if (!targetMessageId) throw new Error('uazapiSendReaction requires targetMessageId.')
  const data = await uazapiPost(ctx, '/message/react', {
    number: to,
    id: targetMessageId,
    text: emoji,
  })
  return { messageId: extractMessageId(data) }
}

// ============================================================
// Instance lifecycle (connect / status) — settings UI + provisioning
// ============================================================

export interface UazapiInstanceStatus {
  /** Normalized: 'connected' | 'connecting' | 'disconnected' */
  status: 'connected' | 'connecting' | 'disconnected'
  /** QR code (base64 or raw string) when the server is waiting for a scan. */
  qrcode?: string
  raw: Record<string, unknown>
}

function normalizeInstanceStatus(data: Record<string, unknown>): UazapiInstanceStatus {
  // Server variants expose { status } | { instance: { status } } |
  // { connected: boolean } — flatten them all.
  const inst =
    (data.instance as Record<string, unknown> | undefined) ?? data
  const rawStatus = String(inst.status ?? inst.state ?? '')
    .toLowerCase()
  const connectedFlag = inst.connected === true || rawStatus === 'connected' || rawStatus === 'open'
  const qrcode =
    (typeof inst.qrcode === 'string' && inst.qrcode) ||
    (typeof data.qrcode === 'string' && data.qrcode) ||
    undefined
  let status: UazapiInstanceStatus['status'] = 'disconnected'
  if (connectedFlag) status = 'connected'
  else if (qrcode || rawStatus === 'connecting' || rawStatus === 'qr') status = 'connecting'
  return { status, qrcode, raw: data }
}

/** Start (or resume) the QR pairing flow. Returns current status + QR if any. */
export async function uazapiConnectInstance(
  ctx: UazapiContext,
  args: { phone?: string } = {},
): Promise<UazapiInstanceStatus> {
  const body: Record<string, unknown> = {}
  if (args.phone) body.phone = args.phone
  const data = await uazapiPost(ctx, '/instance/connect', body)
  return normalizeInstanceStatus(data)
}

export async function uazapiInstanceStatus(
  ctx: UazapiContext,
): Promise<UazapiInstanceStatus> {
  const response = await fetch(`${normalizeBaseUrl(ctx.baseUrl)}/instance/status`, {
    headers: { Accept: 'application/json', token: ctx.token },
  })
  if (!response.ok) {
    await throwUazapiError(response, `uazapi error ${response.status} on /instance/status`)
  }
  return normalizeInstanceStatus((await response.json()) as Record<string, unknown>)
}

/**
 * Fetch a decrypted, hosted URL for a received media message.
 *
 * WhatsApp media arrives as an encrypted CDN URL (.enc) that is
 * useless without the mediaKey. The uazapi server decrypts and hosts
 * the file itself:
 *
 *   POST /message/download { id: <messageid> }
 *   → { fileURL: "https://<server>/files/<hash>.mp3", mimetype: "audio/mpeg" }
 *
 * (Confirmed live, 2026-07-05.) The URL lives on the uazapi server —
 * good enough for the inbox now; the long-term plan re-uploads to
 * Supabase Storage (plano fase-01 §1.7.3).
 */
export async function uazapiDownloadMessage(
  ctx: UazapiContext,
  args: { messageId: string },
): Promise<{ fileUrl: string; mimetype: string }> {
  if (!args.messageId) throw new Error('uazapiDownloadMessage requires messageId.')
  const data = await uazapiPost(ctx, '/message/download', { id: args.messageId })
  const fileUrl =
    (typeof data.fileURL === 'string' && data.fileURL) ||
    (typeof data.fileUrl === 'string' && data.fileUrl) ||
    (typeof data.url === 'string' && data.url) ||
    ''
  if (!fileUrl) throw new Error('uazapi /message/download returned no file URL.')
  return {
    fileUrl,
    mimetype: typeof data.mimetype === 'string' ? data.mimetype : '',
  }
}

/**
 * Configure (or replace) the instance's webhook.
 *
 * Confirmed against a live uazapiGO v2 server (cloudefender, 2026-07):
 *   POST /webhook { url, events: ['messages'], enabled: true }
 *   → [ { id, url, enabled, events, excludeMessages, ... } ]
 *   GET  /webhook → same array (null when none configured).
 *
 * Called automatically when the operator saves the uazapi config, so
 * no manual panel step is needed.
 */
export async function uazapiSetWebhook(
  ctx: UazapiContext,
  args: { url: string; events?: string[] },
): Promise<void> {
  await uazapiPost(ctx, '/webhook', {
    url: args.url,
    events: args.events ?? ['messages'],
    enabled: true,
  })
}

/**
 * Create a new instance on the server. Provisioning-only (Fase 04) —
 * requires the server admin token, NOT an instance token.
 * Returns the new instance's token.
 */
export async function uazapiInitInstance(args: {
  baseUrl: string
  adminToken: string
  name: string
}): Promise<{ instanceToken: string; raw: Record<string, unknown> }> {
  const response = await fetch(`${normalizeBaseUrl(args.baseUrl)}/instance/init`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      admintoken: args.adminToken,
    },
    body: JSON.stringify({ name: args.name }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `uazapi error ${response.status} on /instance/init`)
  }
  const data = (await response.json()) as Record<string, unknown>
  const inst = (data.instance as Record<string, unknown> | undefined) ?? data
  const instanceToken =
    (typeof inst.token === 'string' && inst.token) ||
    (typeof data.token === 'string' && data.token) ||
    ''
  if (!instanceToken) {
    throw new Error('uazapi /instance/init did not return an instance token.')
  }
  return { instanceToken, raw: data }
}
