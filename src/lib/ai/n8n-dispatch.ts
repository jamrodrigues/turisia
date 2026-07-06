import { supabaseAdmin } from './admin-client'
import { buildConversationContext } from './context'
import { latestUserMessage } from './query'
import { engineSendText } from '@/lib/flows/meta-send'
import { isBotEligible, markHandoff } from './eligibility'
import type { TierConfig } from './config'

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
 *   n8n → "Respond to Webhook" { reply?, handoff?, reason? }
 *   CRM → handoff? mark + stand down ; reply? claim slot + send via provider
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

    let out: { reply?: string; handoff?: boolean; reason?: string } | null = null
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

    if (out.handoff) {
      await markHandoff(db, conversationId, {
        reason: 'n8n',
        by: 'bot',
      })
      return
    }

    if (out.reply && out.reply.trim()) {
      // Atomic cap: cap-check + increment in one UPDATE so concurrent
      // inbounds can never overshoot. Reuses the 029 RPC.
      const { data: claimed, error: claimErr } = await db.rpc('claim_ai_reply_slot', {
        conversation_id: conversationId,
        max_replies: tier.autoReplyMaxPerConversation,
      })
      if (claimErr || claimed !== true) return

      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text: out.reply,
      })
    }
  } catch (err) {
    console.error('[n8n dispatch] failed:', err)
  }
}
