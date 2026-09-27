import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Package categories the AI is allowed to hand off to an automated
 * booking Flow for (061_ai_topic_flow_trigger.sql). Read live from
 * `flows` rather than hardcoded so an admin activating/deactivating a
 * flow immediately changes what the AI will (and won't) offer to
 * close automatically — no code change, no redeploy.
 *
 * Best-effort: any failure degrades to `[]`, which just means the AI
 * falls back to plain conversation (never a crash in the reply path).
 */
export async function retrieveBookableTopics(
  db: SupabaseClient,
  accountId: string,
): Promise<string[]> {
  try {
    const { data, error } = await db
      .from('flows')
      .select('ai_topic')
      .eq('account_id', accountId)
      .eq('status', 'active')
      .not('ai_topic', 'is', null)
    if (error || !data) return []
    const topics = (data as { ai_topic: string | null }[])
      .map((r) => r.ai_topic)
      .filter((t): t is string => !!t)
    return Array.from(new Set(topics))
  } catch (err) {
    console.error('[ai booking-topics] retrieval failed:', err)
    return []
  }
}
