import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireRole, ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { uazapiSetWebhook, uazapiGetWebhook } from '@/lib/whatsapp/uazapi-api'
import {
  buildUazapiWebhookUrl,
  maskWebhookSecret,
  parseWebhookList,
} from '@/lib/whatsapp/uazapi-webhook-url'

/**
 * POST /api/uazapi/config/repoint-webhook — re-point the connected
 * instance's webhook at this app.
 *
 * When the client deletes/recreates their uazapi instance (new token +
 * name saved in Settings), the fresh instance has no webhook, so sending
 * still works but INBOUND messages stop arriving. This route re-applies
 * the webhook using the account's own stored config — no input from the
 * body (nothing to inject), and scoped to the caller's account like the
 * sibling config routes.
 *
 * It sets the webhook, reads it back to confirm, and returns the result
 * with the secret masked. The webhook secret NEVER reaches the browser.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '')
}

export async function POST() {
  let accountId: string
  try {
    ;({ accountId } = await requireRole('admin'))
  } catch (err) {
    const status =
      err instanceof ForbiddenError ? 403 : err instanceof UnauthorizedError ? 401 : 500
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unauthorized' },
      { status },
    )
  }

  // Read the account's own uazapi config — never trust an instance name
  // from the request body (zero injection surface).
  const { data: config } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('provider, uazapi_base_url, uazapi_instance_token, uazapi_webhook_secret')
    .eq('account_id', accountId)
    .maybeSingle()

  if (
    !config ||
    config.provider !== 'uazapi' ||
    !config.uazapi_base_url ||
    !config.uazapi_instance_token ||
    !config.uazapi_webhook_secret
  ) {
    return NextResponse.json(
      { error: 'Conecte a instância primeiro.' },
      { status: 400 },
    )
  }

  const site = siteUrl()
  if (!site) {
    return NextResponse.json(
      { error: 'A URL do site (NEXT_PUBLIC_SITE_URL) não está configurada no servidor.' },
      { status: 500 },
    )
  }

  let secret: string
  let token: string
  try {
    secret = decrypt(config.uazapi_webhook_secret)
    token = decrypt(config.uazapi_instance_token)
  } catch (err) {
    console.error('[uazapi repoint] decrypt failed:', err)
    return NextResponse.json(
      { error: 'Não foi possível ler as credenciais salvas da instância.' },
      { status: 500 },
    )
  }

  const ctx = { baseUrl: config.uazapi_base_url, token }
  const url = buildUazapiWebhookUrl(site, secret)

  try {
    await uazapiSetWebhook(ctx, { url, events: ['messages'] })
    const list = await uazapiGetWebhook(ctx)
    const verification = parseWebhookList(list, url)
    return NextResponse.json({
      ok: true,
      url_masked: maskWebhookSecret(url, secret),
      enabled: verification.enabled,
      events: verification.events,
    })
  } catch (err) {
    console.error('[uazapi repoint] failed:', err)
    return NextResponse.json(
      {
        error: `Não foi possível apontar o webhook no servidor uazapi: ${
          err instanceof Error ? err.message : 'erro desconhecido'
        }`,
      },
      { status: 502 },
    )
  }
}
