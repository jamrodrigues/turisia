import { supabaseAdmin } from './admin-client'
import { buildConversationContext } from './context'
import { latestUserMessage } from './query'
import { engineSendMedia, engineSendText } from '@/lib/flows/meta-send'
import { sendWithRetry } from './send-retry'
import { fixMojibake } from './fix-mojibake'
import { recordAiUsage } from './usage'
import { isBotEligible, markHandoff } from './eligibility'
import type { TierConfig } from './config'
import type { MediaKind } from '@/lib/whatsapp/meta-api'

/**
 * Media attachment in the n8n reply. Lets the workflow send e.g. car
 * photos WITH its text answer — through the CRM (persisted, capped,
 * provider-dispatched), never directly via uazapi. A direct n8n→uazapi
 * send would echo back as fromMe and mute the bot as a phone takeover.
 */
interface N8nReplyMedia {
  /** Public URL the provider fetches at send time. */
  url: string
  caption?: string
  /** image (default) | video | document | audio */
  kind?: string
}

const MEDIA_KINDS: MediaKind[] = ['image', 'video', 'document', 'audio']
/** Hard cap per reply turn so a runaway workflow can't flood a customer. */
const MAX_MEDIA_PER_REPLY = 5

interface DispatchArgs {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
}

/**
 * Advanced-tier brain: delegate the inbound to the account's n8n
 * workflow (which owns the LLM + tools — Supabase agenda, etc) and act
 * on its reply.
 *
 * Contract (mirrors auto-reply.ts): owns its try/catch, NEVER throws —
 * a slow or failing n8n must not affect the webhook's 200.
 *
 * Round-trip (CRM is the control plane):
 *   CRM → POST n8n_webhook_url { conversation, contact, message, history }
 *         header x-crm-secret: <n8n_shared_secret>
 *   n8n → "Respond to Webhook" { reply?, media?, handoff?, reason? }
 *   CRM → handoff? mark + stand down ; reply/media? claim ONE slot +
 *         send text then attachments via provider
 *
 * The CRM sends (engineSendText → provider dispatcher → uazapi/Meta) so
 * the message is persisted and the inbox stays the single source of
 * truth — n8n never talks to WhatsApp directly anymore.
 */
export async function dispatchInboundToN8n(
  args: DispatchArgs,
  tier: TierConfig,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    if (!tier.n8nWebhookUrl) return

    const db = supabaseAdmin()

    // Stand down if the account has an active message-level automation
    // (new_message_received / keyword_match). process-inbound dispatches
    // those for the SAME inbound and they may send their own reply, so
    // the bot must not also fire or the customer gets two replies. This
    // mirrors the guard in auto-reply.ts (simple tier); the advanced
    // (n8n) path dropped it. Relationship triggers (first_inbound_message,
    // new_contact_created) don't count — they're not per-message auto-responders.
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (!isBotEligible(conv, tier.autoReplyMaxPerConversation)) return

    const history = await buildConversationContext(db, conversationId)
    if (history.length === 0) return

    const { data: contact } = await db
      .from('contacts')
      .select('phone, name')
      .eq('id', contactId)
      .maybeSingle()

    const controller = new AbortController()
    // The webhook route runs with maxDuration=60; cap the n8n round-trip
    // well under that so a hung workflow can't wedge the function.
    const timeout = setTimeout(() => controller.abort(), 25_000)

    let out: {
      reply?: string
      media?: N8nReplyMedia[]
      handoff?: boolean
      reason?: string
      /** Optional LLM usage the workflow reports back (metering, 039):
       *  { model, input_tokens, output_tokens }. The CRM can't see the
       *  n8n-side LLM call otherwise. */
      usage?: { model?: string; input_tokens?: number; output_tokens?: number }
    } | null = null
    try {
      const res = await fetch(tier.n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tier.n8nSharedSecret ? { 'x-crm-secret': tier.n8nSharedSecret } : {}),
        },
        body: JSON.stringify({
          accountId,
          conversationId,
          contactId,
          contact: { phone: contact?.phone ?? null, name: contact?.name ?? null },
          message: latestUserMessage(history),
          history,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        console.error('[n8n dispatch] non-2xx from n8n:', res.status)
        return
      }
      // n8n may legitimately return an empty body (ack-only) — tolerate it.
      const text = await res.text()
      out = text ? JSON.parse(text) : {}
    } finally {
      clearTimeout(timeout)
    }

    if (!out) return

    // Metering (039): the workflow self-reports its LLM usage.
    if (out.usage && (out.usage.input_tokens || out.usage.output_tokens)) {
      void recordAiUsage({
        accountId,
        conversationId,
        feature: 'n8n_reply',
        provider: 'openai',
        model: out.usage.model || 'unknown',
        inputTokens: out.usage.input_tokens ?? 0,
        outputTokens: out.usage.output_tokens ?? 0,
      })
    }

    if (out.handoff) {
      await markHandoff(db, conversationId, {
        reason: 'n8n',
        by: 'bot',
      })
      return
    }

    const media = Array.isArray(out.media)
      ? out.media
          .filter((m): m is N8nReplyMedia => !!m && typeof m.url === 'string' && !!m.url)
          .slice(0, MAX_MEDIA_PER_REPLY)
      : []
    const hasReplyText = !!out.reply && !!out.reply.trim()

    if (hasReplyText || media.length > 0) {
      // Atomic cap: cap-check + increment in one UPDATE so concurrent
      // inbounds can never overshoot. Reuses the 029 RPC. ONE slot per
      // reply turn — text + its media attachments count as one reply.
      const { data: claimed, error: claimErr } = await db.rpc('claim_ai_reply_slot', {
        conversation_id: conversationId,
        max_replies: tier.autoReplyMaxPerConversation,
      })
      if (claimErr || claimed !== true) return

      if (hasReplyText) {
        // Retry once on transient provider failure — the slot is already
        // claimed, so losing this send loses the reply for good.
        // fixMojibake: the n8n workflow's text is double-encoded upstream
        // (see fix-mojibake.ts) — repair before it reaches the customer.
        await sendWithRetry(() =>
          engineSendText({
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            text: fixMojibake(out!.reply!),
            humanize: true,
          }),
        )
      }

      // Media after the text (matches how the old n8n workflow ordered
      // it: answer, then car photos). Best-effort per item — one broken
      // URL must not kill the remaining attachments.
      for (const m of media) {
        const kind = MEDIA_KINDS.includes(m.kind as MediaKind)
          ? (m.kind as MediaKind)
          : 'image'
        try {
          await sendWithRetry(() =>
            engineSendMedia({
              accountId,
              userId: configOwnerUserId,
              conversationId,
              contactId,
              kind,
              link: m.url,
              caption: m.caption ? fixMojibake(m.caption) : m.caption,
            }),
          )
        } catch (err) {
          console.error(
            '[n8n dispatch] media send failed:',
            err instanceof Error ? err.message : err,
          )
        }
      }
    }
  } catch (err) {
    console.error('[n8n dispatch] failed:', err)
  }
}
