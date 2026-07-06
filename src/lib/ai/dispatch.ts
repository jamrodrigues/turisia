import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './admin-client'
import { loadAiConfig, loadTierConfig } from './config'
import { isBotEligible } from './eligibility'
import { dispatchInboundToAiReply } from './auto-reply'
import { dispatchInboundToN8n } from './n8n-dispatch'
import { transcribeAudio } from './transcribe'

interface DispatchArgs {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
}

const DEBOUNCE_MS = (() => {
  const n = Number(process.env.AI_DEBOUNCE_SECONDS)
  return Number.isFinite(n) && n >= 0 ? n * 1000 : 8000
})()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Route an inbound to the account's AI brain (or none), with burst
 * debouncing so 4 quick messages become ONE aggregated reply.
 *
 * Called from the shared inbound pipeline (process-inbound) for BOTH
 * providers, only for plain-text the flow runner did not consume.
 * Owns its try/catch — never throws into the webhook.
 *
 * Tier routing:
 *   off      → nothing
 *   simple   → built-in RAG auto-reply (auto-reply.ts, own gates)
 *   advanced → n8n round-trip (n8n-dispatch.ts)
 */
export async function dispatchInboundToBrain(args: DispatchArgs): Promise<void> {
  const { accountId, conversationId } = args
  try {
    const db = supabaseAdmin()

    const tier = await loadTierConfig(db, accountId)
    if (!tier) return // no config / master off / tier 'off'

    // Cheap pre-check: if a human owns the thread / handoff is active /
    // cap reached, skip the debounce sleep entirely.
    const { data: conv } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (!conv || !isBotEligible(conv, tier.autoReplyMaxPerConversation)) return

    // The `auto_reply_enabled` toggle is the intended off-switch for the
    // bot while keeping is_active/tier untouched. The simple tier honors
    // it inside auto-reply.ts; the advanced (n8n) tier does not, so
    // enforce it here for BOTH tiers — no reply of any tier goes out
    // when the admin has switched auto-reply off. (Skips the debounce
    // sleep + transcription cost too: bot off ⇒ no bot work.)
    if (!tier.autoReplyEnabled) return

    // ----- Debounce (last-message-wins) -----
    // Every eligible inbound bumps ai_debounce_until to now()+N and
    // sleeps N. After waking, the message whose stamp is still the
    // latest is the winner and processes the whole aggregated burst
    // (buildConversationContext reads all messages since the last bot
    // reply); earlier messages see a later stamp and stand down.
    if (DEBOUNCE_MS > 0) {
      const myStamp = Date.now() + DEBOUNCE_MS
      const myStampIso = new Date(myStamp).toISOString()
      // Monotonic bump: advance the stamp, never move it backwards.
      // Two near-simultaneous inbounds otherwise race — the EARLIER
      // one's smaller stamp could land LAST and overwrite the later
      // one's, after which both pass the `current > myStamp` test below
      // and the brain runs twice (two n8n calls / two LLM replies). A
      // conditional UPDATE (write only where the stored stamp is null or
      // older) is one atomic statement, so the row always ends up holding
      // the MAX stamp regardless of write order → exactly one winner.
      await db
        .from('conversations')
        .update({ ai_debounce_until: myStampIso })
        .eq('id', conversationId)
        .or(`ai_debounce_until.is.null,ai_debounce_until.lt.${myStampIso}`)

      await sleep(DEBOUNCE_MS)

      const { data: after } = await db
        .from('conversations')
        .select('ai_debounce_until')
        .eq('id', conversationId)
        .maybeSingle()
      const current = after?.ai_debounce_until
        ? new Date(after.ai_debounce_until).getTime()
        : 0
      // A newer inbound bumped the stamp past mine → it will handle the
      // burst; I stand down.
      if (current > myStamp) return
    }

    // Voice notes are invisible to a text brain — transcribe the latest
    // one in place so both the LLM and the human (on handoff) can read
    // it. Best-effort; needs an OpenAI key (Whisper). Advanced-only
    // accounts without a key skip it and let n8n transcribe.
    await maybeTranscribeLatestAudio(db, accountId, conversationId)

    if (tier.tier === 'advanced') {
      await dispatchInboundToN8n(args, tier)
    } else {
      // simple — the built-in responder has its own full eligibility
      // gates + atomic cap; we pass through unchanged.
      await dispatchInboundToAiReply(args)
    }
  } catch (err) {
    console.error('[ai dispatch] failed:', err)
  }
}

/**
 * If the newest customer message is an untranscribed voice note, run
 * Whisper and write the transcript into content_text (prefixed) so the
 * downstream context builder + the inbox both surface it. Best-effort.
 */
async function maybeTranscribeLatestAudio(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<void> {
  try {
    const { data: msg } = await db
      .from('messages')
      .select('id, content_type, content_text, media_url')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!msg || msg.content_type !== 'audio' || !msg.media_url) return
    // Already has real text (a caption, or a prior transcription).
    if (msg.content_text && !msg.content_text.startsWith('[')) return

    // Whisper is OpenAI-only: use the chat key if the provider is
    // OpenAI, else the (OpenAI) embeddings key if present.
    const cfg = await loadAiConfig(db, accountId)
    const key =
      cfg?.provider === 'openai' ? cfg.apiKey : cfg?.embeddingsApiKey ?? null
    if (!key) return

    const text = await transcribeAudio({ url: msg.media_url, apiKey: key })
    if (!text) return

    await db
      .from('messages')
      .update({ content_text: `[áudio] ${text}` })
      .eq('id', msg.id)
  } catch (err) {
    console.warn(
      '[ai dispatch] transcription step failed:',
      err instanceof Error ? err.message : err,
    )
  }
}
