import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The per-conversation fields that gate whether the bot may answer.
 * Shared by the simple (built-in) and advanced (n8n) brains so the two
 * can never diverge on when to stay silent.
 */
export interface ConversationBotState {
  assigned_agent_id: string | null
  ai_autoreply_disabled: boolean
  ai_reply_count: number
}

/**
 * May the bot answer this conversation right now?
 *
 * Silent no-op (returns false) when:
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled here (a prior handoff — sticky)
 *   - the per-conversation reply cap is already reached
 *
 * The cap here is an early-out; the authoritative, race-free check is
 * still the atomic claim_ai_reply_slot RPC at send time.
 */
export function isBotEligible(
  conv: ConversationBotState,
  maxRepliesPerConversation: number,
): boolean {
  if (conv.assigned_agent_id) return false
  if (conv.ai_autoreply_disabled) return false
  if (conv.ai_reply_count >= maxRepliesPerConversation) return false
  return true
}

/**
 * Mark a conversation as handed off to a human: the bot stands down
 * (sticky) and the reason/actor are recorded for the inbox + audit.
 * Optionally assigns an agent. Used by every handoff trigger (AI
 * sentinel, n8n, keyword) so they write the same shape.
 */
export async function markHandoff(
  db: SupabaseClient,
  conversationId: string,
  opts: {
    reason: 'ai_sentinel' | 'n8n' | 'manual' | 'manual_phone' | 'keyword'
    by: string // 'bot' | agent user_id
    assignAgentId?: string | null
  },
): Promise<void> {
  await db
    .from('conversations')
    .update({
      ai_autoreply_disabled: true,
      handoff_at: new Date().toISOString(),
      handoff_reason: opts.reason,
      handoff_by: opts.by,
      ...(opts.assignAgentId ? { assigned_agent_id: opts.assignAgentId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
}
