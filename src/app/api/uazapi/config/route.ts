import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { uazapiInstanceStatus, uazapiSetWebhook } from '@/lib/whatsapp/uazapi-api'

/**
 * uazapi provider configuration (admin/operator only — the settings
 * section is not reachable by agents once Fase 03 lands, but the
 * route still authenticates and scopes by the caller's account).
 *
 * GET    → saved config (never the tokens) + live instance status
 * POST   → save { base_url, instance_name, instance_token } — encrypts
 *          tokens, generates the webhook secret, flips provider to
 *          'uazapi' and stores the synthetic phone_number_id
 * DELETE → clear the uazapi fields and flip the account back to 'meta'
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

/**
 * Parse an optional daily_send_limit from the request body.
 *   absent      → undefined (leave unchanged)
 *   null | ''   → { value: null } (clear the cap)
 *   positive int→ { value: n }
 *   otherwise   → { error }
 */
function parseDailyLimit(
  raw: unknown,
): { value: number | null } | { error: string } | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return { value: null }
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    return { error: 'daily_send_limit must be a positive integer or null' }
  }
  return { value: n }
}

export async function GET() {
  try {
    // Admin-only: the response includes the webhook URL with its secret.
    const { accountId } = await requireRole('admin')

    const { data: config } = await supabaseAdmin()
      .from('whatsapp_config')
      .select(
        'provider, uazapi_base_url, uazapi_instance_name, uazapi_instance_token, uazapi_webhook_secret, status, daily_send_limit',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (!config || config.provider !== 'uazapi' || !config.uazapi_instance_token) {
      return NextResponse.json({ configured: false, reason: 'no_config' })
    }

    // The operator needs the full webhook URL (with secret) to paste
    // into the uazapi panel — this is an authenticated admin surface.
    let webhookUrl: string | null = null
    try {
      const secret = decrypt(config.uazapi_webhook_secret)
      webhookUrl = `${siteUrl()}/api/uazapi/webhook?secret=${secret}`
    } catch {
      webhookUrl = null
    }

    // Live status straight from the uazapi server (best-effort).
    let instance: { status: string; qrcode?: string } | null = null
    try {
      const s = await uazapiInstanceStatus({
        baseUrl: config.uazapi_base_url,
        token: decrypt(config.uazapi_instance_token),
      })
      instance = { status: s.status, qrcode: s.qrcode }
    } catch (err) {
      instance = null
      console.warn(
        '[uazapi config] status check failed:',
        err instanceof Error ? err.message : err,
      )
    }

    return NextResponse.json({
      configured: true,
      base_url: config.uazapi_base_url,
      instance_name: config.uazapi_instance_name,
      webhook_url: webhookUrl,
      daily_send_limit: config.daily_send_limit ?? null,
      instance,
    })
  } catch (err) {
    console.error('[uazapi config] GET failed:', err)
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')

    const body = await request.json()
    const base_url = String(body.base_url || '').trim().replace(/\/$/, '')
    const instance_name = String(body.instance_name || '').trim().toLowerCase()
    const instance_token = String(body.instance_token || '').trim()

    const daily = parseDailyLimit(body.daily_send_limit)
    if (daily && 'error' in daily) {
      return NextResponse.json({ error: daily.error }, { status: 400 })
    }

    // Settings-only update: change just the daily send ceiling without
    // re-submitting the instance token (the form clears it after
    // connect). Requires an existing uazapi config on this account.
    if (!instance_token && daily) {
      const { data: current } = await supabaseAdmin()
        .from('whatsapp_config')
        .select('id, provider')
        .eq('account_id', accountId)
        .maybeSingle()
      if (!current || current.provider !== 'uazapi') {
        return NextResponse.json(
          { error: 'uazapi is not configured for this account.' },
          { status: 400 },
        )
      }
      const { error: updErr } = await supabaseAdmin()
        .from('whatsapp_config')
        .update({
          daily_send_limit: daily.value,
          updated_at: new Date().toISOString(),
        })
        .eq('id', current.id)
      if (updErr) {
        console.error('[uazapi config] daily_send_limit update failed:', updErr)
        return NextResponse.json({ error: 'failed to save config' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, daily_send_limit: daily.value })
    }

    if (!base_url || !instance_name || !instance_token) {
      return NextResponse.json(
        { error: 'base_url, instance_name and instance_token are required' },
        { status: 400 },
      )
    }
    if (!/^https:\/\//.test(base_url)) {
      return NextResponse.json(
        { error: 'base_url must be an https:// URL' },
        { status: 400 },
      )
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(instance_name)) {
      return NextResponse.json(
        { error: 'instance_name: lowercase letters, digits, dot, dash, underscore' },
        { status: 400 },
      )
    }

    // Validate the token against the server before saving — a typo'd
    // token would otherwise only surface on the first send.
    try {
      await uazapiInstanceStatus({ baseUrl: base_url, token: instance_token })
    } catch (err) {
      return NextResponse.json(
        {
          error: `Could not reach the uazapi instance: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        },
        { status: 400 },
      )
    }

    // One instance maps to exactly one account (unique index, 031) —
    // service role sees across tenants for the conflict check.
    const { data: claimed } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('uazapi_instance_name', instance_name)
      .neq('account_id', accountId)
      .maybeSingle()
    if (claimed) {
      return NextResponse.json(
        { error: 'This instance is already connected to another account.' },
        { status: 409 },
      )
    }

    const webhookSecret = crypto.randomBytes(24).toString('hex')

    const { data: existing } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, provider, access_token, phone_number_id')
      .eq('account_id', accountId)
      .maybeSingle()

    // Preserve a pre-existing Meta connection. uazapi shares this row and
    // must not clobber the account's real Meta access_token /
    // phone_number_id — otherwise removing uazapi later leaves the Meta
    // path decrypting a placeholder token and posting to a synthetic
    // phone_number_id (client must re-enter Meta creds to recover).
    // A row with provider='meta' AND an access_token holds real Meta
    // creds (placeholders are only ever written under provider='uazapi').
    // When present we leave phone_number_id + access_token untouched; the
    // uazapi webhook/sender resolve by instance_name + provider, so the
    // dormant Meta values are inert while uazapi is active.
    const hasMetaCreds =
      !!existing && existing.provider === 'meta' && !!existing.access_token

    const row: Record<string, unknown> = {
      account_id: accountId,
      user_id: userId,
      provider: 'uazapi',
      uazapi_base_url: base_url,
      uazapi_instance_name: instance_name,
      uazapi_instance_token: encrypt(instance_token),
      uazapi_webhook_secret: encrypt(webhookSecret),
      status: 'connected',
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    // Carry the daily send ceiling through a full connect save too.
    if (daily) row.daily_send_limit = daily.value

    if (!hasMetaCreds) {
      // No Meta creds to protect (fresh account or already on uazapi):
      // seed the synthetic, stable, unique phone_number_id + an encrypted
      // placeholder to satisfy the NOT NULL + UNIQUE constraints
      // (migrations 001/013; see 031's header comment).
      row.phone_number_id = `uazapi:${instance_name}`
      row.access_token = encrypt('uazapi-placeholder')
    }

    const query = existing
      ? supabaseAdmin().from('whatsapp_config').update(row).eq('id', existing.id)
      : supabaseAdmin().from('whatsapp_config').insert(row)
    const { error: saveError } = await query
    if (saveError) {
      console.error('[uazapi config] save failed:', saveError)
      return NextResponse.json({ error: 'failed to save config' }, { status: 500 })
    }

    // Auto-configure the instance's webhook on the uazapi server —
    // no manual panel step. Best-effort: if it fails (older server
    // without /webhook), the UI still shows the URL to paste by hand.
    const webhookUrl = `${siteUrl()}/api/uazapi/webhook?secret=${webhookSecret}`
    let webhookConfigured = false
    try {
      await uazapiSetWebhook(
        { baseUrl: base_url, token: instance_token },
        { url: webhookUrl },
      )
      webhookConfigured = true
    } catch (err) {
      console.warn(
        '[uazapi config] auto webhook setup failed (configure manually):',
        err instanceof Error ? err.message : err,
      )
    }

    return NextResponse.json({
      ok: true,
      webhook_url: webhookUrl,
      webhook_configured: webhookConfigured,
    })
  } catch (err) {
    console.error('[uazapi config] POST failed:', err)
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const { accountId } = await requireRole('admin')

    // Flip back to Meta and clear the uazapi fields. access_token /
    // phone_number_id are intentionally left untouched: POST preserved
    // any real Meta creds, so this restores a working Meta connection
    // automatically. An account that was uazapi-only keeps its
    // placeholder token (there is no Meta config to restore) and stays
    // 'disconnected' until the admin enters Meta creds.
    const { error } = await supabaseAdmin()
      .from('whatsapp_config')
      .update({
        provider: 'meta',
        uazapi_base_url: null,
        uazapi_instance_name: null,
        uazapi_instance_token: null,
        uazapi_webhook_secret: null,
        status: 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
    if (error) {
      console.error('[uazapi config] DELETE failed:', error)
      return NextResponse.json({ error: 'failed to clear config' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[uazapi config] DELETE failed:', err)
    return toErrorResponse(err)
  }
}
