/**
 * Provider-agnostic inbound message pipeline.
 *
 * Both webhook routes (Meta: /api/whatsapp/webhook, uazapi:
 * /api/uazapi/webhook) parse their provider-specific payload into a
 * `NormalizedInbound` and hand it here. Everything downstream of
 * normalization — contact/conversation resolution, message insert,
 * broadcast reply flagging, flows → automations → AI dispatch order,
 * public webhook fan-out — lives in this ONE place so the two
 * providers can never drift apart.
 *
 * Extracted from the Meta webhook route's processMessage
 * (src/app/api/whatsapp/webhook/route.ts) — behavior preserved
 * 1:1 for the Meta path, plus one addition: a cheap dedup guard on
 * (conversation_id, message_id), because uazapi redelivers events
 * (Meta effectively never does, so the guard is a no-op there).
 */

import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToBrain } from '@/lib/ai/dispatch'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/** Values allowed by the messages.content_type CHECK constraint
 *  (001 + widened in 010). Normalizers must map provider types INTO
 *  this set — see mapToAllowedContentType. */
export const ALLOWED_CONTENT_TYPES = [
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'template',
  'interactive',
] as const
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number]

/**
 * Map an arbitrary provider message type onto the CHECK-constraint set
 * so the INSERT can never fail on an exotic type. Unknown types degrade
 * to 'text'; callers should put a readable placeholder (e.g.
 * '[sticker]') in contentText when they do this.
 */
export function mapToAllowedContentType(providerType: string): AllowedContentType {
  if ((ALLOWED_CONTENT_TYPES as readonly string[]).includes(providerType)) {
    return providerType as AllowedContentType
  }
  if (providerType === 'sticker') return 'image'
  return 'text'
}

export interface NormalizedInbound {
  /** Tenancy — every row created downstream is stamped with this. */
  accountId: string
  /** Sender-of-record for NOT NULL user_id FK columns (the admin who
   *  saved the WhatsApp config; stable, arbitrary post-017). */
  configOwnerUserId: string
  /** Customer phone as the provider reported it — normalized here. */
  fromPhone: string
  /** Push name / profile name; falls back to the phone when empty. */
  pushName: string
  /** Provider-side message id (Meta wamid / uazapi messageid). */
  waMessageId: string
  /** When the customer sent it. */
  timestamp: Date
  contentType: AllowedContentType
  contentText: string | null
  mediaUrl: string | null
  /** Tapped button/list-row id (Meta interactive replies). uazapi
   *  sends plain text answers → always null there. */
  interactiveReplyId: string | null
  /** Provider-side id of the message being swipe-replied to, if any. */
  replyToWaMessageId: string | null
}

export interface ProcessInboundResult {
  outcome: 'processed' | 'duplicate' | 'error'
  conversationId?: string
  contactId?: string
}

export async function processNormalizedInbound(
  input: NormalizedInbound,
): Promise<ProcessInboundResult> {
  const senderPhone = normalizePhone(input.fromPhone)

  const contactOutcome = await findOrCreateContact(
    input.accountId,
    input.configOwnerUserId,
    senderPhone,
    input.pushName,
  )
  if (!contactOutcome) return { outcome: 'error' }
  const contactRecord = contactOutcome.contact

  const convResult = await findOrCreateConversation(
    input.accountId,
    input.configOwnerUserId,
    contactRecord.id,
  )
  if (!convResult) return { outcome: 'error' }
  const conversation = convResult.conversation

  // Emit conversation.created as soon as the thread is opened, before
  // anything can short-circuit, so subscribers always see the thread
  // open before its first message.received.
  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), input.accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    })
  }

  // Dedup guard — uazapi redelivers webhook events; inserting the same
  // provider message twice would double it in the inbox AND double-fire
  // the AI. (conversation_id, message_id) is unique per provider.
  if (input.waMessageId) {
    const { data: dupe } = await supabaseAdmin()
      .from('messages')
      .select('id')
      .eq('conversation_id', conversation.id)
      .eq('message_id', input.waMessageId)
      .maybeSingle()
    if (dupe) {
      return {
        outcome: 'duplicate',
        conversationId: conversation.id,
        contactId: contactRecord.id,
      }
    }
  }

  // Resolve swipe-reply context if present. A missing parent is fine —
  // we store NULL and the UI renders the message without a quote.
  let replyToInternalId: string | null = null
  if (input.replyToWaMessageId) {
    replyToInternalId = await lookupInternalIdByProviderId(
      input.replyToWaMessageId,
      conversation.id,
    )
    if (!replyToInternalId) {
      console.warn(
        '[inbound] reply context parent not found:',
        input.replyToWaMessageId,
      )
    }
  }

  // First-ever inbound from this contact? Counted BEFORE the insert so
  // the number is accurate. Drives the first_inbound_message trigger.
  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: input.contentType,
    content_text: input.contentText,
    media_url: input.mediaUrl,
    message_id: input.waMessageId || null,
    status: 'delivered',
    created_at: input.timestamp.toISOString(),
    reply_to_message_id: replyToInternalId,
    interactive_reply_id: input.interactiveReplyId,
  })
  if (msgError) {
    console.error('[inbound] error inserting message:', msgError)
    return { outcome: 'error' }
  }

  const { error: convError } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: input.contentText || `[${input.contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)
  if (convError) {
    console.error('[inbound] error updating conversation:', convError)
  }

  // Broadcast reply tracking (replied_count via the migration-003 trigger).
  await flagBroadcastReplyIfAny(input.accountId, contactRecord.id)

  // ============================================================
  // Dispatch order — flows win over automations' content triggers,
  // and both win over the LLM. See the Meta route's original comment
  // block for the full rationale; the semantics are identical here.
  // ============================================================
  const flowResult = await dispatchInboundToFlows({
    accountId: input.accountId,
    userId: input.configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: input.interactiveReplyId
      ? {
          kind: 'interactive_reply',
          reply_id: input.interactiveReplyId,
          reply_title: input.contentText ?? '',
          meta_message_id: input.waMessageId,
        }
      : {
          kind: 'text',
          text: input.contentText ?? '',
          meta_message_id: input.waMessageId,
        },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  const inboundText = input.contentText ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId: input.accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  // AI brain (tier-routed: off / simple built-in / advanced n8n) —
  // only for plain text the flow runner did not consume. Debounces
  // bursts and owns its try/catch.
  if (!flowConsumed && !input.interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToBrain({
      accountId: input.accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId: input.configOwnerUserId,
    })
  }

  await dispatchWebhookEvent(supabaseAdmin(), input.accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: input.waMessageId,
    content_type: input.contentType,
    text: input.contentText,
  })

  return {
    outcome: 'processed',
    conversationId: conversation.id,
    contactId: contactRecord.id,
  }
}

// ============================================================
// Contact / conversation resolution (moved verbatim from the Meta
// webhook route so both providers share one definition).
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any

export interface ContactOutcome {
  contact: ContactRow
  /** True when this call created the row; drives new_contact_created. */
  wasCreated: boolean
}

export async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
): Promise<ContactOutcome | null> {
  const existingContact = await findExistingContact(
    supabaseAdmin(),
    accountId,
    phone,
  )

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id)
    }
    return { contact: existingContact, wasCreated: false }
  }

  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single()

  if (createError) {
    // Lost a race with a concurrent inbound — re-resolve instead of
    // dropping the message (unique index from migration 022).
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[inbound] error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

export async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
) {
  const { data: existing, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .single()

  if (!findError && existing) {
    return { conversation: existing, created: false }
  }

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
    })
    .select()
    .single()

  if (createError) {
    console.error('[inbound] error creating conversation:', createError)
    return null
  }

  return { conversation: newConv, created: true }
}

/**
 * Resolve a provider-side message id into the matching internal UUID,
 * scoped to one conversation.
 */
export async function lookupInternalIdByProviderId(
  providerMessageId: string,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', providerMessageId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) {
    console.error('[inbound] lookupInternalIdByProviderId failed:', error.message)
    return null
  }
  return data?.id ?? null
}

async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)

    if (updErr) {
      console.error('[inbound] error marking broadcast recipient replied:', updErr)
    }
  } catch (err) {
    console.error('[inbound] flagBroadcastReplyIfAny failed:', err)
  }
}
