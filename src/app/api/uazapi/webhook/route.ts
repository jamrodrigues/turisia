import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeUazapiWebhook } from '@/lib/whatsapp/uazapi-normalize'
import { uazapiDownloadMessage } from '@/lib/whatsapp/uazapi-api'
import {
  processNormalizedInbound,
  findOrCreateContact,
  findOrCreateConversation,
} from '@/lib/whatsapp/process-inbound'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { decrypt } from '@/lib/whatsapp/encryption'
import { storeInboundMediaToBucket } from '@/lib/whatsapp/store-inbound-media'

/**
 * uazapi inbound webhook.
 *
 * One URL serves every instance: the payload carries the instance
 * name, we resolve the whatsapp_config row by it, and the shared
 * secret saved on that row must match the request's secret. Unlike
 * Meta there is no HMAC signature — the secret (query `?secret=` or
 * `x-webhook-secret` header, whichever the panel lets you set) is the
 * whole authentication.
 *
 * Response contract: ALWAYS 200 fast (uazapi retries on non-2xx which
 * would double-process); heavy work runs inside after().
 *
 * Payload capture mode (plano fase-01 §1.6): set UAZAPI_WEBHOOK_DEBUG=1
 * to log every raw body — used once per server version to confirm the
 * field mapping in uazapi-normalize.ts, then TURNED OFF (LGPD: message
 * bodies must not reach production logs).
 */

export const maxDuration = 60

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  if (process.env.UAZAPI_WEBHOOK_DEBUG === '1') {
    console.log('[uazapi webhook][debug] raw payload:', JSON.stringify(body))
  }

  const url = new URL(request.url)
  const providedSecret =
    url.searchParams.get('secret') ||
    request.headers.get('x-webhook-secret') ||
    ''

  const event = normalizeUazapiWebhook(body)

  if (event.kind === 'ignored') {
    // Groups, stories, connection/presence events… nothing to do, but
    // still 200 so the server doesn't retry.
    return NextResponse.json({ ok: true, skipped: event.ignoredReason })
  }

  if (!event.instanceName) {
    console.warn('[uazapi webhook] message event without instance name — dropped')
    return NextResponse.json({ ok: true, skipped: 'no instance' })
  }

  // Resolve the account by instance name (unique index, migration 031).
  const { data: config, error: configError } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .eq('uazapi_instance_name', event.instanceName)
    .maybeSingle()

  if (configError || !config) {
    console.error(
      '[uazapi webhook] no whatsapp_config for instance:',
      event.instanceName,
    )
    return NextResponse.json({ ok: true, skipped: 'unknown instance' })
  }

  // Authenticate. The secret is stored encrypted at rest (same
  // encrypt() as tokens); a row without one is treated as
  // misconfigured — reject rather than accept unauthenticated traffic.
  let expectedSecret = ''
  try {
    expectedSecret = config.uazapi_webhook_secret
      ? decrypt(config.uazapi_webhook_secret)
      : ''
  } catch {
    // corrupted ciphertext → fall through to the mismatch branch
  }
  if (!expectedSecret || providedSecret !== expectedSecret) {
    console.warn(
      '[uazapi webhook] secret mismatch for instance:',
      event.instanceName,
    )
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ACK now, process after — same pattern as the Meta webhook route.
  after(processEvent(event, config))

  return NextResponse.json({ ok: true })
}

type NormalizedEvent = ReturnType<typeof normalizeUazapiWebhook>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConfigRow = any

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Has this provider message_id already been persisted in the
 * conversation? Polls a few times (total ~3s) so a fromMe echo that
 * races ahead of the CRM send path's messages INSERT still resolves to
 * "yes, ours" instead of being misread as an external phone-side send.
 * Runs inside after() (maxDuration 60), so the short wait is safe.
 */
async function isAlreadyPersisted(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  conversationId: string,
  messageId: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('message_id', messageId)
      .maybeSingle()
    if (data) return true
    if (attempt < 3) await sleep(750)
  }
  return false
}

async function processEvent(event: NormalizedEvent, config: ConfigRow) {
  try {
    // Media arrives as an encrypted WhatsApp CDN URL — worthless. Ask
    // the uazapi server for the decrypted, hosted file (confirmed:
    // POST /message/download → { fileURL }). That URL lives on the uazapi
    // server and is ephemeral, so we immediately re-upload the bytes to
    // our own `chat-media` bucket (fase-01 §1.7.3) — durable + served
    // from Supabase. Best-effort at every step: on failure the message
    // still lands (with the provider URL, or a readable placeholder).
    let mediaUrl: string | null = null
    let contentText = event.text
    if (event.hasMedia && event.waMessageId) {
      try {
        const dl = await uazapiDownloadMessage(
          {
            baseUrl: config.uazapi_base_url,
            token: decrypt(config.uazapi_instance_token),
          },
          { messageId: event.waMessageId },
        )
        const stored = await storeInboundMediaToBucket(
          supabaseAdmin(),
          config.account_id,
          dl.fileUrl,
          dl.mimetype,
        )
        // Prefer our durable copy; fall back to the provider URL if the
        // re-upload failed for any reason.
        mediaUrl = stored ?? dl.fileUrl
      } catch (err) {
        console.warn(
          '[uazapi webhook] media download failed:',
          err instanceof Error ? err.message : err,
        )
        contentText = contentText ?? `[${event.contentType} não baixado]`
      }
    }

    if (event.kind === 'from_me') {
      await mirrorFromMe(event, config, mediaUrl, contentText)
      return
    }

    await processNormalizedInbound({
      accountId: config.account_id,
      configOwnerUserId: config.user_id,
      fromPhone: event.fromPhone,
      pushName: event.pushName,
      waMessageId: event.waMessageId,
      timestamp: event.timestamp,
      contentType: event.contentType,
      contentText,
      mediaUrl,
      interactiveReplyId: null, // uazapi replies arrive as plain text
      replyToWaMessageId: null,
    })
  } catch (err) {
    console.error('[uazapi webhook] processing failed:', err)
  }
}

/**
 * fromMe:true — someone answered from the phone itself (the owner's
 * handset), outside the CRM. Product policy (plano fase-01 §1.7.7):
 *   1. Mirror it into the inbox as an outbound message so the history
 *      stays complete.
 *   2. MUTE the bot on that conversation (ai_autoreply_disabled) —
 *      a human has visibly taken over; bot and owner must not talk
 *      over each other. Sticky until "return to bot".
 *
 * Sends made THROUGH the CRM also echo back as fromMe — the dedup
 * check on message_id drops those (they're already persisted by the
 * send path), so only true phone-side sends reach the mute.
 */
async function mirrorFromMe(
  event: NormalizedEvent,
  config: ConfigRow,
  mediaUrl: string | null,
  contentText: string | null,
) {
  const contentType = event.contentType
  const db = supabaseAdmin()
  const phone = normalizePhone(event.fromPhone)

  // fromPhone is the CUSTOMER (the chat jid), but event.pushName is the
  // SENDER's name — for a fromMe event that's the business OWNER, not the
  // customer. Passing it here would rename the customer contact to the
  // owner's name (findOrCreateContact updates on any name mismatch),
  // destroying identity data after a day of phone-side replies. The
  // customer's real name only ever arrives on their own inbound events,
  // so mirror with no name and let those set it.
  const contactOutcome = await findOrCreateContact(
    config.account_id,
    config.user_id,
    phone,
    '',
  )
  if (!contactOutcome) return

  const convResult = await findOrCreateConversation(
    config.account_id,
    config.user_id,
    contactOutcome.contact.id,
  )
  if (!convResult) return
  const conversation = convResult.conversation

  // Dedup: CRM/bot-originated sends already inserted this message_id, so
  // this echo must be dropped (not re-inserted, not treated as a
  // phone-side takeover). But the uazapi echo can BEAT the CRM send
  // path's DB insert — the provider API returns fast, the messages
  // insert is a separate roundtrip. A single point-in-time check would
  // then miss the dupe, double the message AND wrongly mute the bot with
  // handoff_reason='manual_phone'. Poll briefly to let that insert land
  // before concluding this is a genuine phone-side send.
  if (event.waMessageId && (await isAlreadyPersisted(db, conversation.id, event.waMessageId))) {
    return
  }

  const { error: msgError } = await db.from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'agent', // human on the handset; no sender_id to attribute
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: event.waMessageId || null,
    status: 'sent',
    created_at: event.timestamp.toISOString(),
  })
  if (msgError) {
    console.error('[uazapi webhook] fromMe insert failed:', msgError)
    return
  }

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${contentType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // The owner answered by hand — silence the bot on this thread and
      // record why (surfaces as "aguardando atendente"; migration 033).
      ai_autoreply_disabled: true,
      handoff_at: new Date().toISOString(),
      handoff_reason: 'manual_phone',
      handoff_by: 'agent',
    })
    .eq('id', conversation.id)
}
