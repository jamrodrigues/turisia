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
import type { ParsedInbound } from '@/lib/flows/types'
import { dispatchInboundToBrain } from '@/lib/ai/dispatch'
import { findOrCreateConversationRow } from '@/lib/whatsapp/find-or-create-conversation'
import type { Conversation } from '@/types'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { engineSendText } from '@/lib/flows/meta-send'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/** Content types that carry a media URL the flow engine can consume. */
/**
 * Build the normalized message the flow engine receives. Order matters:
 *  1. native menu tap (interactive_reply) — has an explicit reply id;
 *  2. plain text (default) — the flow engine has no media-consuming
 *     node, so a media inbound degrades to text using whatever
 *     caption/placeholder the normalizer put in contentText (the
 *     mediaUrl itself is still stored on the `messages` row — this
 *     only affects what the flow runner sees).
 */
export function buildDispatchMessage(input: NormalizedInbound): ParsedInbound {
  if (input.interactiveReplyId) {
    return {
      kind: 'interactive_reply',
      reply_id: input.interactiveReplyId,
      reply_title: input.contentText ?? '',
      meta_message_id: input.waMessageId,
    }
  }

  return {
    kind: 'text',
    text: input.contentText ?? '',
    meta_message_id: input.waMessageId,
  }
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
  /** MIME reported by the uazapi download (e.g. 'image/jpeg',
   *  'application/pdf'). Null for non-media or when the download failed.
   *  Persisted on the `messages` row (069) for the inbox/API; NOT yet
   *  exposed to the flow engine — `buildDispatchMessage` below still
   *  degrades every media message to `kind: 'text'`, so a flow can't
   *  branch on it today. That's a real follow-up, not done here. */
  mediaMimeType?: string | null
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

/** How long a conversation can sit silent before the next inbound is
 *  treated as a new atendimento instead of a continuation. */
export const CONVERSATION_RESET_AFTER_MS = 24 * 60 * 60 * 1000

/** Pure gap check, exported for testing — see resetStaleConversation. */
export function isConversationStale(
  lastMessageAt: string | null | undefined,
  now: Date,
): boolean {
  if (!lastMessageAt) return false
  return now.getTime() - new Date(lastMessageAt).getTime() > CONVERSATION_RESET_AFTER_MS
}

/**
 * "Novo atendimento": clears handoff/reply-cap state (same fields as
 * `return_conversation_to_bot`, migration 033) and force-ends any still-
 * 'active' flow_run for this contact, so a customer texting back after
 * 24h+ of silence starts fresh rather than resuming a stale handoff or
 * mid-flow state. Mutates `conversation` in place so the caller's
 * subsequent gates see the reset within this same request. Best-effort —
 * logs and continues on failure rather than blocking message delivery.
 */
async function resetStaleConversation(
  conversation: Conversation,
  contactId: string,
): Promise<void> {
  const db = supabaseAdmin()
  const { error: convError } = await db
    .from('conversations')
    .update({
      ai_autoreply_disabled: false,
      assigned_agent_id: null,
      ai_reply_count: 0,
      handoff_at: null,
      handoff_reason: null,
      handoff_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)
  if (convError) {
    console.error('[inbound] error resetting stale conversation:', convError)
  } else {
    conversation.ai_autoreply_disabled = false
    conversation.assigned_agent_id = undefined
    conversation.handoff_reason = null
  }

  const { data: endedRuns, error: runError } = await db
    .from('flow_runs')
    .update({
      status: 'timed_out',
      ended_at: new Date().toISOString(),
      end_reason: 'conversation_reset_24h',
    })
    .eq('contact_id', contactId)
    .eq('status', 'active')
    .select('id')
  if (runError) {
    console.error('[inbound] error ending stale flow_run:', runError)
  } else if (endedRuns && endedRuns.length > 0) {
    await db.from('flow_run_events').insert(
      endedRuns.map((r) => ({
        flow_run_id: r.id,
        event_type: 'timeout',
        payload: { reason: 'conversation_reset_24h' },
      })),
    )
  }
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

  // Conversa parada há mais de 24h — "novo atendimento": não deixar o
  // cliente cair de volta num handoff/flow travado de dias atrás.
  // Zera handoff + reply cap (mesmo shape de return_conversation_to_bot,
  // migration 033) e encerra qualquer flow_run ainda 'active' desse
  // contato, para que esta mensagem seja tratada como o início de um
  // atendimento novo, não a continuação de onde parou. Mutamos o
  // `conversation` local também, senão o gate de ai_autoreply_disabled
  // logo abaixo ainda veria o valor antigo nesta mesma execução.
  if (
    !convResult.created &&
    isConversationStale(conversation.last_message_at, input.timestamp)
  ) {
    await resetStaleConversation(conversation, contactRecord.id)
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

  // Native menu taps (uazapi `buttonOrListid`) arrive with only the reply
  // id and an EMPTY content_text — the provider never sends the tapped
  // option's TITLE, so there's nothing readable to store here. We keep the
  // cell blank on purpose: the flow engine knows the option title from the
  // suspended node's config and stamps it back onto this row once it matches
  // the tap (see labelTappedMessage in src/lib/flows/engine.ts). That
  // downstream UPDATE only fills a blank cell, so the blank we write here is
  // exactly what it keys off of.
  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: input.contentType,
    content_text: input.contentText,
    media_url: input.mediaUrl,
    media_mime_type: input.mediaMimeType ?? null,
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

  // Incremento ATÔMICO do não-lidas + carimbo da última mensagem, num
  // UPDATE só (migration 052). O read-modify-write anterior
  // (`unread_count: <valor lido> + 1`) perdia contagem quando duas
  // mensagens do mesmo contato chegavam juntas: as duas liam N, as duas
  // gravavam N+1.
  const { error: convError } = await supabaseAdmin().rpc(
    'increment_conversation_unread',
    {
      p_conversation_id: conversation.id,
      p_last_message_text: input.contentText || `[${input.contentType}]`,
    },
  )
  if (convError) {
    console.error('[inbound] error updating conversation:', convError)
  }

  // Broadcast reply tracking (replied_count via the migration-003 trigger).
  await flagBroadcastReplyIfAny(input.accountId, contactRecord.id)

  // Satisfaction-survey answer (074) — checked BEFORE flows/automations/
  // AI, same "consumed" precedence a flow gets, so a customer replying
  // "5" or "5, adorei!" to /api/surveys/cron's message never gets
  // reinterpreted as a keyword trigger or handed to the bot. A message
  // that doesn't parse as a 1-5 rating falls through untouched — the
  // customer might be saying something else entirely.
  const surveyConsumed =
    !input.interactiveReplyId &&
    (await tryConsumeSurveyResponse(
      input.accountId,
      input.configOwnerUserId,
      contactRecord.id,
      conversation.id,
      input.contentText ?? '',
    ))

  // ============================================================
  // Dispatch order — flows win over automations' content triggers,
  // and both win over the LLM. See the Meta route's original comment
  // block for the full rationale; the semantics are identical here.
  // ============================================================
  // Cliente aguardando atendente humano — quando a conversa foi passada a um
  // humano (ai_autoreply_disabled=true, seja por handoff do bot ou ação de um
  // atendente), o bot fica mudo (flow E ia) até return_conversation_to_bot
  // reabrir. O brain já é barrado por isBotEligible; aqui pulamos o flow para
  // que ele não responda a keyword ("menu"/"voltar"/"início") durante a espera.
  // Quando false/null, o comportamento é inalterado — o flow roda normalmente.
  // Seeded with surveyConsumed so the existing `!flowConsumed` guards
  // below (automations, AI) automatically also skip for a message the
  // survey handler already answered — one flag, same precedence chain.
  let flowConsumed = surveyConsumed
  if (!surveyConsumed && conversation.ai_autoreply_disabled !== true) {
    const flowResult = await dispatchInboundToFlows({
      accountId: input.accountId,
      userId: input.configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      message: buildDispatchMessage(input),
      isFirstInboundMessage,
    })
    flowConsumed = flowResult.consumed
  }

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
  // for plain text the flow runner did not consume. Voice notes carry
  // no text but MUST reach the brain: the dispatcher transcribes the
  // latest audio in place (Whisper / n8n) before replying, so gate them
  // in too — otherwise transcription is unreachable dead code and pure
  // voice notes never get answered.
  const isAudioInbound = input.contentType === 'audio'
  if (
    !flowConsumed &&
    !input.interactiveReplyId &&
    (inboundText.trim() || isAudioInbound)
  ) {
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
      source: 'whatsapp',
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

/** Uma conversa por (account_id, contact_id) — ver migration 052. */
/**
 * Same race-recovery core the outbound send path uses
 * (resolve-conversation.ts) — see find-or-create-conversation.ts. The
 * webhook wants the full row (downstream code reads more than `id` off
 * it) and a null-on-failure convention rather than a throw, so it wraps
 * the shared core instead of sharing its own bespoke copy.
 */
export async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
) {
  const result = await findOrCreateConversationRow<Conversation>({
    db: supabaseAdmin(),
    accountId,
    ownerUserId: configOwnerUserId,
    contactId,
    select: '*',
  })
  if (!result.row) {
    console.error('[inbound] error creating conversation:', result.error)
    return null
  }
  return { conversation: result.row, created: result.created }
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

/** `5`, `nota 5`, `5 - adorei!`, `Nota: 5, foi ótimo` — a leading 1-5
 *  digit (optionally preceded by "nota"), rest of the line kept as an
 *  optional comment. Exported for unit testing. */
export function parseSurveyReply(text: string): { nota: number; comentario: string | null } | null {
  const match = text.trim().match(/^(?:nota\s*[:]?\s*)?([1-5])\b\s*[-:.,]?\s*(.*)$/i)
  if (!match) return null
  const comentario = match[2]?.trim() || null
  return { nota: Number(match[1]), comentario }
}

/**
 * Checks for a pending ('enviado') satisfaction survey (074) for this
 * contact and, if the inbound text parses as a 1-5 rating, records the
 * answer and thanks the customer. Returns true when it consumed the
 * message (caller must not also hand it to flows/automations/AI).
 *
 * Only ever looks at the single most-recently-sent pending survey —
 * a customer with two trips in flight answering "5" answers whichever
 * survey went out last, which matches what they're most likely
 * replying to.
 */
async function tryConsumeSurveyResponse(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  conversationId: string,
  text: string,
): Promise<boolean> {
  if (!text.trim()) return false

  const db = supabaseAdmin()
  const { data: pending } = await db
    .from('avaliacoes')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'enviado')
    .order('enviado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!pending) return false

  const parsed = parseSurveyReply(text)
  if (!parsed) return false

  // Idempotent guard in the WHERE clause — a redelivered/duplicate
  // inbound (uazapi) can't double-process the same survey.
  const { data: updated, error: updErr } = await db
    .from('avaliacoes')
    .update({
      status: 'respondido',
      nota: parsed.nota,
      comentario: parsed.comentario,
      respondido_em: new Date().toISOString(),
    })
    .eq('id', pending.id)
    .eq('status', 'enviado')
    .select('id')
    .maybeSingle()
  if (updErr || !updated) return false

  const thankYou =
    parsed.nota >= 4
      ? 'Que ótimo! 🙌 Muito obrigado pela nota, é isso que a gente busca todo dia!'
      : 'Valeu por avaliar! 🙏 Vamos usar esse feedback pra melhorar — se quiser contar mais algum detalhe, é só responder aqui.'

  try {
    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text: thankYou,
    })
  } catch (err) {
    console.error('[inbound] survey thank-you send failed:', err instanceof Error ? err.message : err)
  }

  return true
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
