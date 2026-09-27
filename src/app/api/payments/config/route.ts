import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/payments/config
 *
 * Admin+ only (mirrors ai_configs/whatsapp_config post-035 — this row
 * carries encrypted financial credentials). Never returns the
 * decrypted secrets, only has_* flags.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data, error } = await supabase
      .from('payment_config')
      .select('provider, access_token_encrypted, webhook_secret_encrypted, is_active')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[payments/config GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load payment configuration' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ configured: false })

    return NextResponse.json({
      configured: true,
      provider: data.provider,
      is_active: data.is_active,
      has_access_token: !!data.access_token_encrypted,
      has_webhook_secret: !!data.webhook_secret_encrypted,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/payments/config (admin+)
 *
 * Upsert the account's Mercado Pago config. `access_token` /
 * `webhook_secret` are encrypted before storage; omitted fields leave
 * the stored value unchanged (the form only sends a secret when the
 * admin re-enters it), and an explicit `null` clears it.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`payments-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const isActive = body.is_active === true

    const rawToken = typeof body.access_token === 'string' ? body.access_token.trim() : ''
    const clearToken = body.access_token === null
    const rawWebhookSecret = typeof body.webhook_secret === 'string' ? body.webhook_secret.trim() : ''
    const clearWebhookSecret = body.webhook_secret === null

    const { data: existing } = await supabase
      .from('payment_config')
      .select('access_token_encrypted')
      .eq('account_id', accountId)
      .maybeSingle()

    if (isActive && !rawToken && !existing?.access_token_encrypted) {
      return bad('access_token is required to activate payments')
    }

    const shared: Record<string, unknown> = { provider: 'mercadopago', is_active: isActive }
    if (rawToken) shared.access_token_encrypted = encrypt(rawToken)
    else if (clearToken) shared.access_token_encrypted = null
    if (rawWebhookSecret) shared.webhook_secret_encrypted = encrypt(rawWebhookSecret)
    else if (clearWebhookSecret) shared.webhook_secret_encrypted = null

    if (existing) {
      const { error: upErr } = await supabase
        .from('payment_config')
        .update(shared)
        .eq('account_id', accountId)
      if (upErr) {
        console.error('[payments/config POST] update error:', upErr)
        return NextResponse.json({ error: 'Failed to save payment configuration' }, { status: 500 })
      }
    } else {
      const { error: insErr } = await supabase
        .from('payment_config')
        .insert({ account_id: accountId, created_by: userId, ...shared })
      if (insErr) {
        console.error('[payments/config POST] insert error:', insErr)
        return NextResponse.json({ error: 'Failed to save payment configuration' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/payments/config (admin+) — removes the account's
 * payment config (turns automated charging off and forgets the
 * token). Also the recovery path for a corrupted encrypted token.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase.from('payment_config').delete().eq('account_id', accountId)
    if (error) {
      console.error('[payments/config DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete payment configuration' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
