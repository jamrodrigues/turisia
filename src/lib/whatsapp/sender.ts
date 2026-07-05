/**
 * Provider dispatcher — the single place that knows which WhatsApp API
 * an account talks to.
 *
 * Callers (flows/automations engines, inbox send, AI auto-reply) build
 * their message and call `providerSend*` with the raw `whatsapp_config`
 * row; this module picks Meta or uazapi, decrypts the right token, and
 * returns the provider's message id. DB persistence stays in the
 * callers — nothing about `messages` / `conversations` changes per
 * provider.
 *
 * Provider differences handled here:
 *   * Auth — Meta: Bearer access_token + phone_number_id path;
 *     uazapi: `token` header + base URL per instance.
 *   * Interactive buttons/lists — native on Meta; degraded to a
 *     numbered text menu on uazapi (see renderInteractiveAsText).
 *   * contextMessageId (swipe-reply) — Meta-only; silently ignored on
 *     uazapi rather than failing the send.
 *   * Templates — Meta-only concept. Callers must guard (throw) before
 *     reaching this module; there is deliberately no providerSendTemplate.
 */

import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendReactionMessage,
  sendTextMessage,
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from './meta-api'
import {
  uazapiSendMedia,
  uazapiSendReaction,
  uazapiSendText,
  type UazapiContext,
} from './uazapi-api'
import { decrypt } from './encryption'

export type WhatsAppProvider = 'meta' | 'uazapi'

/**
 * The subset of a `whatsapp_config` row the dispatcher needs. Callers
 * select('*') so the extra columns ride along untyped; declaring the
 * subset keeps this module honest about what it reads.
 */
export interface ProviderSendConfig {
  provider?: string | null
  phone_number_id: string
  access_token: string
  uazapi_base_url?: string | null
  uazapi_instance_token?: string | null
}

export function providerOf(config: ProviderSendConfig): WhatsAppProvider {
  return config.provider === 'uazapi' ? 'uazapi' : 'meta'
}

function uazapiCtx(config: ProviderSendConfig): UazapiContext {
  if (!config.uazapi_base_url || !config.uazapi_instance_token) {
    throw new Error(
      'uazapi provider selected but uazapi_base_url / uazapi_instance_token are missing on whatsapp_config.',
    )
  }
  return {
    baseUrl: config.uazapi_base_url,
    token: decrypt(config.uazapi_instance_token),
  }
}

// ============================================================
// Text / media / reaction
// ============================================================

export interface ProviderSendTextArgs {
  config: ProviderSendConfig
  to: string
  text: string
  /** Meta-only (swipe-reply context). Ignored on uazapi. */
  contextMessageId?: string
}

export async function providerSendText(
  args: ProviderSendTextArgs,
): Promise<{ messageId: string }> {
  const { config, to, text, contextMessageId } = args
  if (providerOf(config) === 'uazapi') {
    return uazapiSendText({ ctx: uazapiCtx(config), to, text })
  }
  return sendTextMessage({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    to,
    text,
    contextMessageId,
  })
}

export interface ProviderSendMediaArgs {
  config: ProviderSendConfig
  to: string
  kind: MediaKind
  /** Public URL the provider fetches at send time. */
  link: string
  caption?: string
  filename?: string
  /** Meta-only. Ignored on uazapi. */
  contextMessageId?: string
}

export async function providerSendMedia(
  args: ProviderSendMediaArgs,
): Promise<{ messageId: string }> {
  const { config, to, kind, link, caption, filename, contextMessageId } = args
  if (providerOf(config) === 'uazapi') {
    return uazapiSendMedia({
      ctx: uazapiCtx(config),
      to,
      kind,
      file: link,
      caption,
      filename,
    })
  }
  return sendMediaMessage({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    to,
    kind,
    link,
    caption,
    filename,
    contextMessageId,
  })
}

export interface ProviderSendReactionArgs {
  config: ProviderSendConfig
  to: string
  targetMessageId: string
  /** Empty string removes the reaction (both providers). */
  emoji: string
}

export async function providerSendReaction(
  args: ProviderSendReactionArgs,
): Promise<{ messageId: string }> {
  const { config, to, targetMessageId, emoji } = args
  if (providerOf(config) === 'uazapi') {
    return uazapiSendReaction({ ctx: uazapiCtx(config), to, targetMessageId, emoji })
  }
  return sendReactionMessage({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    to,
    targetMessageId,
    emoji,
  })
}

// ============================================================
// Interactive buttons / lists
// ============================================================
//
// uazapi has no stable equivalent of Meta's interactive messages, so we
// degrade to a numbered text menu. The customer replies with the number
// (or the option text); flows that depend on exact button-id matching
// should use keyword branches for uazapi accounts. The rendered shape:
//
//   <headerText>
//
//   <bodyText>
//
//   1. Option A
//   2. Option B
//
//   <footerText>

export function renderButtonsAsText(args: {
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}): string {
  const lines: string[] = []
  if (args.headerText) lines.push(`*${args.headerText}*`, '')
  lines.push(args.bodyText, '')
  args.buttons.forEach((b, i) => lines.push(`${i + 1}. ${b.title}`))
  if (args.footerText) lines.push('', `_${args.footerText}_`)
  return lines.join('\n')
}

export function renderListAsText(args: {
  bodyText: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}): string {
  const lines: string[] = []
  if (args.headerText) lines.push(`*${args.headerText}*`, '')
  lines.push(args.bodyText, '')
  let n = 0
  for (const section of args.sections) {
    if (section.title) lines.push(`*${section.title}*`)
    for (const row of section.rows) {
      n += 1
      lines.push(`${n}. ${row.title}${row.description ? ` — ${row.description}` : ''}`)
    }
    lines.push('')
  }
  while (lines[lines.length - 1] === '') lines.pop()
  if (args.footerText) lines.push('', `_${args.footerText}_`)
  return lines.join('\n')
}

export interface ProviderSendButtonsArgs {
  config: ProviderSendConfig
  to: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

export async function providerSendInteractiveButtons(
  args: ProviderSendButtonsArgs,
): Promise<{ messageId: string }> {
  const { config, to, ...rest } = args
  if (providerOf(config) === 'uazapi') {
    return uazapiSendText({
      ctx: uazapiCtx(config),
      to,
      text: renderButtonsAsText(rest),
    })
  }
  return sendInteractiveButtons({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    to,
    ...rest,
  })
}

export interface ProviderSendListArgs {
  config: ProviderSendConfig
  to: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

export async function providerSendInteractiveList(
  args: ProviderSendListArgs,
): Promise<{ messageId: string }> {
  const { config, to, buttonLabel, ...rest } = args
  if (providerOf(config) === 'uazapi') {
    return uazapiSendText({
      ctx: uazapiCtx(config),
      to,
      text: renderListAsText(rest),
    })
  }
  return sendInteractiveList({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    to,
    buttonLabel,
    ...rest,
  })
}
