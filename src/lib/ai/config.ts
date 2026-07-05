import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig } from './types'

interface AiConfigRow {
  provider: 'openai' | 'anthropic'
  model: string
  api_key: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  embeddings_api_key: string | null
}

const CONFIG_COLUMNS =
  'provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, embeddings_api_key'

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const { data, error } = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as AiConfigRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key),
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    embeddingsApiKey,
  }
}

export type AiTier = 'off' | 'simple' | 'advanced'

export interface TierConfig {
  tier: AiTier
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Advanced tier only. */
  n8nWebhookUrl: string | null
  n8nSharedSecret: string | null
}

interface TierConfigRow {
  is_active: boolean
  ai_tier: AiTier
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  n8n_webhook_url: string | null
  n8n_shared_secret: string | null
}

/**
 * Load the account's brain selector WITHOUT requiring a BYO LLM key.
 *
 * The advanced tier delegates to n8n (which owns the LLM), so an
 * advanced-only account legitimately has no provider/api_key on
 * ai_configs — loadAiConfig would return null for it. This lighter
 * loader reads only the routing fields and decrypts the n8n secret.
 *
 * Returns null when there's no config, the master switch is off, or
 * the tier is 'off' — all meaning "no bot", handled identically.
 */
export async function loadTierConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<TierConfig | null> {
  const { data, error } = await db
    .from('ai_configs')
    .select(
      'is_active, ai_tier, auto_reply_enabled, auto_reply_max_per_conversation, n8n_webhook_url, n8n_shared_secret',
    )
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as TierConfigRow
  if (!row.is_active) return null
  if (row.ai_tier === 'off') return null

  let n8nSharedSecret: string | null = null
  if (row.n8n_shared_secret) {
    try {
      n8nSharedSecret = decrypt(row.n8n_shared_secret)
    } catch {
      // A mismatched ENCRYPTION_KEY here silently breaks the n8n
      // handshake — leave a breadcrumb rather than fail opaque.
      console.error(
        `[ai config] n8n secret for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
      )
      n8nSharedSecret = null
    }
  }

  return {
    tier: row.ai_tier,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    n8nWebhookUrl: row.n8n_webhook_url,
    n8nSharedSecret,
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}
