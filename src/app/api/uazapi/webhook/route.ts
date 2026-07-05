import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  normalizeUazapiWebhook,
  uazapiTypeToContentKind,
} from '@/lib/whatsapp/uazapi-normalize'
import {
  processNormalizedInbound,
  findOrCreateContact,
  findOrCreateConversation,
} from '@/lib/whatsapp/process-inbound'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

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

  // Authenticate. A row without a secret is treated as misconfigured —
  // reject rather than accept unauthenticated traffic.
  if (!config.uazapi_webhook_secret || providedSecret !== config.uazapi_webhook_secret) {
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

async function processEvent(event: NormalizedEvent, config: ConfigRow) {
  try {
    const { contentType, placeholder } = uazapiTypeToContentKind(event.providerType)
    const contentText = event.text ?? placeholder

    if (event.kind === 'from_me') {
      await mirrorFromMe(event, config, contentType, contentText)
      return
    }

    await processNormalizedInbound({
      accountId: config.account_id,
      configOwnerUserId: config.user_id,
      fromPhone: event.fromPhone,
      pushName: event.pushName,
      waMessageId: event.waMessageId,
      timestamp: event.timestamp,
      contentType,
      contentText,
      // TODO(fase-01 §1.7.3): download and re-upload to Supabase
      // Storage instead of trusting the uazapi server URL long-term.
      mediaUrl: event.mediaUrl,
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
  contentType: string,
  contentText: string | null,
) {
  const db = supabaseAdmin()
  const phone = normalizePhone(event.fromPhone)

  const contactOutcome = await findOrCreateContact(
    config.account_id,
    config.user_id,
    phone,
    event.pushName,
  )
  if (!contactOutcome) return

  const convResult = await findOrCreateConversation(
    config.account_id,
    config.user_id,
    contactOutcome.contact.id,
  )
  if (!convResult) return
  const conversation = convResult.conversation

  // Dedup: CRM-originated sends already inserted this message_id.
  if (event.waMessageId) {
    const { data: dupe } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', conversation.id)
      .eq('message_id', event.waMessageId)
      .maybeSingle()
    if (dupe) return
  }

  const { error: msgError } = await db.from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'agent', // human on the handset; no sender_id to attribute
    content_type: contentType,
    content_text: contentText,
    media_url: event.mediaUrl,
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
      // The owner answered by hand — silence the bot on this thread.
      ai_autoreply_disabled: true,
    })
    .eq('id', conversation.id)
}
