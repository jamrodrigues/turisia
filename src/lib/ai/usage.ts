import { supabaseAdmin } from './admin-client'
import { computeCostUsd } from './pricing'

/**
 * Grava um evento de consumo de IA (tabela ai_usage_events, migration
 * 039). Fire-and-forget por contrato: medir consumo NUNCA pode derrubar
 * o caminho que responde o cliente — qualquer falha vira console.warn.
 *
 * Sempre via service-role (a tabela não tem policy de INSERT para
 * clients), então funciona igual do webhook, de rota de dashboard ou de
 * job.
 */

export type AiUsageFeature =
  | 'auto_reply'
  | 'n8n_reply'
  | 'draft'
  | 'playground'
  | 'transcription'
  | 'embedding'

export interface AiUsageEvent {
  accountId: string
  conversationId?: string | null
  feature: AiUsageFeature
  provider: string
  model: string
  inputTokens?: number
  outputTokens?: number
  status?: 'ok' | 'error'
}

export async function recordAiUsage(event: AiUsageEvent): Promise<void> {
  try {
    const inputTokens = Math.max(0, Math.round(event.inputTokens ?? 0))
    const outputTokens = Math.max(0, Math.round(event.outputTokens ?? 0))
    const { error } = await supabaseAdmin().from('ai_usage_events').insert({
      account_id: event.accountId,
      conversation_id: event.conversationId ?? null,
      feature: event.feature,
      provider: event.provider,
      model: event.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: computeCostUsd(event.model, inputTokens, outputTokens),
      status: event.status ?? 'ok',
    })
    if (error) console.warn('[ai usage] insert failed:', error.message)
  } catch (err) {
    console.warn(
      '[ai usage] record failed:',
      err instanceof Error ? err.message : err,
    )
  }
}
