/**
 * Tabela de preços dos modelos (USD por 1 MILHÃO de tokens).
 *
 * Fonte da verdade do CUSTO ESTIMADO gravado em ai_usage_events. O
 * custo é calculado no momento do insert (snapshot) — atualizar esta
 * tabela NÃO recalcula eventos antigos, só os próximos.
 *
 * Manutenção: confira periodicamente as tabelas oficiais
 * (openai.com/api/pricing · anthropic.com/pricing) e ajuste aqui.
 * Modelo fora da lista → tokens são gravados normalmente e o custo fica
 * 0 (o painel mostra os tokens mesmo assim; adicione o modelo aqui para
 * passar a custear).
 */

export interface ModelPrice {
  /** USD por 1M tokens de entrada. */
  inputPerM: number
  /** USD por 1M tokens de saída. */
  outputPerM: number
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // ---- OpenAI (chat) ----
  'gpt-4.1': { inputPerM: 2.0, outputPerM: 8.0 },
  'gpt-4.1-mini': { inputPerM: 0.4, outputPerM: 1.6 },
  'gpt-4.1-nano': { inputPerM: 0.1, outputPerM: 0.4 },
  'gpt-4o': { inputPerM: 2.5, outputPerM: 10.0 },
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6 },
  // ---- OpenAI (transcrição; input = tokens de áudio) ----
  'gpt-4o-mini-transcribe': { inputPerM: 3.0, outputPerM: 5.0 },
  'gpt-4o-transcribe': { inputPerM: 6.0, outputPerM: 10.0 },
  'whisper-1': { inputPerM: 6.0, outputPerM: 0 }, // aprox. ($0.006/min)
  // ---- OpenAI (embeddings) ----
  'text-embedding-3-small': { inputPerM: 0.02, outputPerM: 0 },
  'text-embedding-3-large': { inputPerM: 0.13, outputPerM: 0 },
  // ---- Anthropic ----
  'claude-sonnet-4-5': { inputPerM: 3.0, outputPerM: 15.0 },
  'claude-haiku-4-5': { inputPerM: 1.0, outputPerM: 5.0 },
  'claude-3-5-haiku-latest': { inputPerM: 0.8, outputPerM: 4.0 },
}

/** Match exato, senão por prefixo (cobre sufixos datados tipo
 *  `gpt-4o-mini-2024-07-18` / `claude-sonnet-4-5-20250929`). */
export function priceFor(model: string): ModelPrice | null {
  if (model in MODEL_PRICES) return MODEL_PRICES[model]
  for (const key of Object.keys(MODEL_PRICES)) {
    if (model.startsWith(key)) return MODEL_PRICES[key]
  }
  return null
}

/** Custo estimado em USD (0 quando o modelo não está na tabela). */
export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = priceFor(model)
  if (!p) return 0
  const cost =
    (inputTokens / 1_000_000) * p.inputPerM +
    (outputTokens / 1_000_000) * p.outputPerM
  // 6 casas — bate com NUMERIC(12,6) da tabela.
  return Math.round(cost * 1e6) / 1e6
}
