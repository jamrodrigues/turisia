import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { uazapiInstanceStatus } from '@/lib/whatsapp/uazapi-api'

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

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

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

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ configured: false, reason: 'no_account' })
    }

    const { data: config } = await supabaseAdmin()
      .from('whatsapp_config')
      .select(
        'provider, uazapi_base_url, uazapi_instance_name, uazapi_instance_token, uazapi_webhook_secret, status',
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
      instance,
    })
  } catch (err) {
    console.error('[uazapi config] GET failed:', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'no account' }, { status: 400 })
    }

    const body = await request.json()
    const base_url = String(body.base_url || '').trim().replace(/\/$/, '')
    const instance_name = String(body.instance_name || '').trim().toLowerCase()
    const instance_token = String(body.instance_token || '').trim()

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

    const row = {
      account_id: accountId,
      user_id: user.id,
      provider: 'uazapi',
      // Synthetic, stable, unique — satisfies the NOT NULL + UNIQUE
      // constraints from migrations 001/013 (see 031's header comment).
      phone_number_id: `uazapi:${instance_name}`,
      // access_token is NOT NULL; store an encrypted placeholder the
      // Meta path can never mistake for a real token.
      access_token: encrypt('uazapi-placeholder'),
      uazapi_base_url: base_url,
      uazapi_instance_name: instance_name,
      uazapi_instance_token: encrypt(instance_token),
      uazapi_webhook_secret: encrypt(webhookSecret),
      status: 'connected',
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { data: existing } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    const query = existing
      ? supabaseAdmin().from('whatsapp_config').update(row).eq('id', existing.id)
      : supabaseAdmin().from('whatsapp_config').insert(row)
    const { error: saveError } = await query
    if (saveError) {
      console.error('[uazapi config] save failed:', saveError)
      return NextResponse.json({ error: 'failed to save config' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      webhook_url: `${siteUrl()}/api/uazapi/webhook?secret=${webhookSecret}`,
    })
  } catch (err) {
    console.error('[uazapi config] POST failed:', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'no account' }, { status: 400 })
    }

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
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
