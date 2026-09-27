import { AiError, type AiConfig, type ChatMessage, type GenerateResult } from './types'
import { HANDOFF_SENTINEL, BOOKING_SENTINEL_RE, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: { inputTokens: number; outputTokens: number } }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return { ...parseGeneration(result.text), usage: result.usage }
}

/**
 * Split the raw model output into `{ text, handoff, bookingTopic }`.
 * Either sentinel can appear alone or trailing a partial reply; both
 * are stripped from the returned text. `bookingTopic` takes priority
 * over `handoff` if a (malformed) reply somehow carried both — the
 * caller acts on whichever field is set, never both.
 */
export function parseGeneration(raw: string): Omit<GenerateResult, 'usage'> {
  const bookingMatch = raw.match(BOOKING_SENTINEL_RE)
  const bookingTopic = bookingMatch ? bookingMatch[1].trim().toLowerCase() : null
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.replace(BOOKING_SENTINEL_RE, '').split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, bookingTopic }
}
